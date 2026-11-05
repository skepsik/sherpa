import type { OutboundCommand, OutboundResult } from '@sherpa/contract';

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import type { ChannelSendOutcome } from '../src/types';
import type { WorkdirRights } from '../src/types/registry';
import type { SessionTestDouble } from '../src/types/session';

import {
  buildOutsideRegistryText,
  createInboundRouter,
} from '../src/inbound-router';
import {
  createSessionTestDouble,
  DIARY_FIXATION_NUDGE_TEXT,
  DIARY_READ_NUDGE_TEXT,
} from '../src/session';
import { listPermissionButtons } from '../src/session/permission-ask';

void describe('inbound router', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  void it('seed-место: message → start + push; в Place эхо double, не stub', async () => {
    const port = createSessionTestDouble();
    const sessionIds = new Map<string, string>();
    const { router, sent } = makeHarness({
      places: { 'place-a': '/tmp/a' },
      sessionIds,
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'привет', type: 'message' },
      eventId: 'e1',
    });
    await settle();

    assert.ok(
      sent.some((c) => c.type === 'send_message' && c.text === 'echo:привет'),
    );
    assert.ok(sent.some((c) => c.type === 'set_status' && c.status === 'busy'));
    assert.ok(sent.some((c) => c.type === 'set_status' && c.status === 'idle'));
    assert.deepEqual(
      port.calls.filter((c) => c.type === 'start' || c.type === 'push'),
      [
        { cwd: '/tmp/a', type: 'start' },
        {
          delivery: 'interject',
          sessionId: 'double-1',
          text: DIARY_READ_NUDGE_TEXT,
          type: 'push',
        },
        {
          delivery: 'interject',
          sessionId: 'double-1',
          text: 'привет',
          type: 'push',
        },
        {
          delivery: 'interject',
          sessionId: 'double-1',
          text: DIARY_FIXATION_NUDGE_TEXT,
          type: 'push',
        },
      ],
    );
    assert.equal(sessionIds.get('place-a'), 'double-1');
  });

  void it('нет в places: «вне реестра» с opaque id; порта нет', async () => {
    const place = 'opaque-unknown-42';
    const port = createSessionTestDouble();
    const { router, sent } = makeHarness({
      places: {},
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place, text: 'hi', type: 'message' },
      eventId: 'e1',
    });
    await settle();

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.type, 'send_message');
    if (sent[0]?.type !== 'send_message') return;
    assert.equal(sent[0].text, buildOutsideRegistryText(place));
    assert.equal(port.calls.length, 0);
  });

  void it('два message подряд при живом ходе: оба push без ожидания конца хода', async () => {
    const port = createSessionTestDouble();
    const gate = createGate();
    let turnStarted = 0;
    const { router, sent } = makeHarness({
      beforeSend: async (command) => {
        if (
          command.type === 'set_status' &&
          command.status === 'busy' &&
          command.place === 'place-a'
        ) {
          turnStarted += 1;
          if (turnStarted === 1) await gate.wait;
        }
      },
      places: { 'place-a': '/tmp/a' },
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'one', type: 'message' },
      eventId: 'e1',
    });
    await router.handleInbound({
      event: { place: 'place-a', text: 'two', type: 'message' },
      eventId: 'e2',
    });
    await settle();

    const pushes = port.calls.filter((c) => c.type === 'push');
    // diary-read (cold) + one + two; fixation ещё после отпускания gate
    assert.ok(pushes.length >= 3, 'diary + оба user push ушли, пока busy/gate');
    assert.equal(port.opened.length, 1, 'второго handle нет');
    assert.equal(
      sent.filter(
        (c) => c.type === 'send_message' && c.text.startsWith('echo:'),
      ).length,
      0,
      'эхо ещё на gate после busy',
    );

    gate.release();
    await settle();

    assert.ok(
      sent.some((c) => c.type === 'send_message' && c.text === 'echo:one'),
    );
    assert.ok(
      sent.some((c) => c.type === 'send_message' && c.text === 'echo:two'),
    );
  });

  void it('убийство handle: следующий message → reopen; старый без push; closed → idle', async () => {
    const port = createSessionTestDouble();
    const sessionIds = new Map<string, string>([['place-a', '']]);
    const gate = createGate();
    let busyCount = 0;
    const { router, sent } = makeHarness({
      beforeSend: async (command) => {
        if (
          command.type === 'set_status' &&
          command.status === 'busy' &&
          command.place === 'place-a'
        ) {
          busyCount += 1;
          if (busyCount === 1) await gate.wait;
        }
      },
      places: { 'place-a': '/tmp/a' },
      sessionIds,
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'first', type: 'message' },
      eventId: 'e1',
    });
    await settle();

    const oldSession = port.opened[0];
    assert.ok(oldSession);
    // diary-read уже завершён; user «first» в полёте на gate
    assert.ok(oldSession.pushes.length >= 2);
    assert.equal(sessionIds.get('place-a'), 'double-1');

    oldSession.kill();
    gate.release();
    await settle();

    assert.ok(
      sent.some((c) => c.type === 'set_status' && c.status === 'idle'),
      'closed mid-turn → idle',
    );

    const pushesBeforeReopen = oldSession.pushes.length;

    await router.handleInbound({
      event: { place: 'place-a', text: 'after-kill', type: 'message' },
      eventId: 'e2',
    });
    await settle();

    assert.equal(
      oldSession.pushes.length,
      pushesBeforeReopen,
      'в старый handle не писали',
    );
    assert.ok(
      port.calls.some((c) => c.type === 'resume' && c.sessionId === 'double-1'),
    );
    assert.ok(
      port.calls.some(
        (c) =>
          c.type === 'push' &&
          c.delivery === 'interject' &&
          c.text === 'after-kill' &&
          c.sessionId === 'double-1',
      ),
    );
    assert.equal(port.opened.length, 2);
    assert.notEqual(port.opened[1], oldSession);
  });

  void it('resume-fail → сброс session_id и cold start', async () => {
    const port = createSessionTestDouble();
    const sessionIds = new Map<string, string>([['place-a', 'stale-id']]);
    port.failResumeFor('stale-id');
    const { router } = makeHarness({
      places: { 'place-a': '/tmp/a' },
      sessionIds,
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'hi', type: 'message' },
      eventId: 'e1',
    });
    await settle();

    assert.ok(
      port.calls.some((c) => c.type === 'resume' && c.sessionId === 'stale-id'),
    );
    assert.ok(port.calls.some((c) => c.type === 'start' && c.cwd === '/tmp/a'));
    assert.equal(sessionIds.get('place-a'), 'double-1');
  });

  void it('question_answer при занятом ходе — без FIFO; без pending — drop', async () => {
    const port = createSessionTestDouble();
    const gate = createGate();
    const { router, sent } = makeHarness({
      beforeSend: async (command) => {
        if (
          command.type === 'set_status' &&
          command.status === 'busy' &&
          command.place === 'place-a'
        ) {
          await gate.wait;
        }
      },
      places: { 'place-a': '/tmp/a' },
      sessionPort: port,
    });

    void router.handleInbound({
      event: { place: 'place-a', text: 'long', type: 'message' },
      eventId: 'm1',
    });
    await settle();

    const before = sent.length;
    await router.handleInbound({
      event: {
        data: 'allow',
        place: 'place-a',
        requestId: 'orphan-req',
        type: 'question_answer',
      },
      eventId: 'qa1',
    });

    assert.equal(sent.length, before, 'без pending — нет outbound');
    assert.ok(
      !sent.some((c) => c.type === 'set_status' && c.status === 'busy'),
      'busy ещё не прошёл beforeSend',
    );
    assert.equal(
      port.calls.filter((c) => c.type === 'answer_permission').length,
      0,
    );

    gate.release();
    await settle();

    assert.ok(
      sent.some((c) => c.type === 'send_message' && c.text === 'echo:long'),
    );
    assert.ok(sent.some((c) => c.type === 'set_status' && c.status === 'busy'));
  });

  void it('pending ask + занятый ход: question_answer → answerPermission без FIFO', async () => {
    const port = createSessionTestDouble();
    const gate = createGate();
    let busyHolds = 0;
    const { router, sent } = makeHarness({
      beforeSend: async (command) => {
        if (
          command.type === 'set_status' &&
          command.status === 'busy' &&
          command.place === 'place-a'
        ) {
          busyHolds += 1;
          if (busyHolds === 2) await gate.wait;
        }
      },
      places: { 'place-a': '/tmp/proj' },
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'open', type: 'message' },
      eventId: 'm-open',
    });
    await settle();

    const session = port.opened[0];
    assert.ok(session);
    const decisionPromise = session.emitPermissionAsk({
      action: 'edit',
      requestId: 'harness-busy',
      resource: '/tmp/proj/x',
    });
    await settle();
    assert.ok(sent.some((c) => c.type === 'send_question'));

    void router.handleInbound({
      event: { place: 'place-a', text: 'busy-msg', type: 'message' },
      eventId: 'm-busy',
    });
    await settle();
    assert.equal(busyHolds, 2, 'второй busy на gate');

    await router.handleInbound({
      event: {
        data: 'allow',
        place: 'place-a',
        requestId: 'p1',
        type: 'question_answer',
      },
      eventId: 'qa-busy',
    });

    assert.equal(await decisionPromise, 'once');
    assert.ok(
      port.calls.some(
        (c) =>
          c.type === 'answer_permission' &&
          c.decision === 'once' &&
          c.requestId === 'harness-busy',
      ),
      'answer дошёл, пока message ход на busy/gate',
    );
    assert.ok(
      !sent.some(
        (c) => c.type === 'send_message' && c.text === 'echo:busy-msg',
      ),
      'эхо busy-msg ещё за gate',
    );

    gate.release();
    await settle();
    assert.ok(
      sent.some((c) => c.type === 'send_message' && c.text === 'echo:busy-msg'),
    );
  });

  void it('question_answer с чужим place — pending не снимает', async () => {
    const port = createSessionTestDouble();
    const { router, sent } = makeHarness({
      places: { 'place-a': '/tmp/a', 'place-b': '/tmp/b' },
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'go', type: 'message' },
      eventId: 'm1',
    });
    await settle();
    const session = port.opened[0];
    assert.ok(session);
    const decisionPromise = session.emitPermissionAsk({
      action: 'edit',
      requestId: 'harness-place',
      resource: '/tmp/a/x',
    });
    await settle();

    await router.handleInbound({
      event: {
        data: 'allow',
        place: 'place-b',
        requestId: 'p1',
        type: 'question_answer',
      },
      eventId: 'qa-wrong-place',
    });
    await settle();

    assert.equal(
      port.calls.filter((c) => c.type === 'answer_permission').length,
      0,
    );
    assert.ok(!sent.some((c) => c.type === 'resolve_question'));

    await router.handleInbound({
      event: {
        data: 'deny',
        place: 'place-a',
        requestId: 'p1',
        type: 'question_answer',
      },
      eventId: 'qa-right-place',
    });
    await settle();
    assert.equal(await decisionPromise, 'reject');
  });

  void it('ask → send_question allow/deny/always; answer allow → once + resolve', async () => {
    const port = createSessionTestDouble();
    const { router, sent } = makeHarness({
      places: { 'place-a': '/tmp/proj' },
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'go', type: 'message' },
      eventId: 'm1',
    });
    await settle();

    const session = port.opened[0];
    assert.ok(session);
    const decisionPromise = session.emitPermissionAsk({
      action: 'external_directory',
      requestId: 'harness-1',
      resource: '/outside/path',
    });
    await settle();

    const question = sent.find((c) => c.type === 'send_question');
    assert.ok(question);
    if (question?.type !== 'send_question') return;
    assert.deepEqual(
      question.buttons.map((b) => b.data),
      listPermissionButtons().map((b) => b.data),
    );
    assert.equal(question.requestId, 'p1');

    await router.handleInbound({
      event: {
        data: 'allow',
        place: 'place-a',
        requestId: 'p1',
        type: 'question_answer',
      },
      eventId: 'qa-allow',
    });
    await settle();

    assert.equal(await decisionPromise, 'once');
    assert.ok(
      port.calls.some(
        (c) =>
          c.type === 'answer_permission' &&
          c.decision === 'once' &&
          c.requestId === 'harness-1',
      ),
    );
    assert.ok(
      sent.some(
        (c) =>
          c.type === 'resolve_question' &&
          c.messageId === 'm1' &&
          c.text === 'Разрешено.',
      ),
    );
  });

  void it('question_answer deny → reject; silent allow нет', async () => {
    const port = createSessionTestDouble();
    const { router, sent } = makeHarness({
      places: { 'place-a': '/tmp/proj' },
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'go', type: 'message' },
      eventId: 'm1',
    });
    await settle();
    const session = port.opened[0];
    assert.ok(session);
    const decisionPromise = session.emitPermissionAsk({
      action: 'edit',
      requestId: 'harness-deny',
      resource: '/tmp/proj/file.txt',
    });
    await settle();

    await router.handleInbound({
      event: {
        data: 'deny',
        place: 'place-a',
        requestId: 'p1',
        type: 'question_answer',
      },
      eventId: 'qa-deny',
    });
    await settle();

    assert.equal(await decisionPromise, 'reject');
    assert.ok(
      sent.some(
        (c) => c.type === 'resolve_question' && c.text === 'Отклонено.',
      ),
    );
  });

  void it('allow на путь под deny → в харнесс всё равно reject', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sherpa-perm-'));
    temps.push(cwd);
    const secret = join(cwd, 'secret.txt');
    writeFileSync(secret, 'no');

    const port = createSessionTestDouble();
    const { router, sent } = makeHarness({
      loadWorkdirRights: () =>
        ({
          cwd,
          denies: [{ cwd, pattern: 'read:secret.txt' }],
          denyGlobals: [],
          grants: [],
        }) satisfies WorkdirRights,
      places: { 'place-a': cwd },
      registryPath: ':memory:',
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'go', type: 'message' },
      eventId: 'm1',
    });
    await settle();
    const session = port.opened[0];
    assert.ok(session);
    const decisionPromise = session.emitPermissionAsk({
      action: 'read',
      requestId: 'harness-blocked',
      resource: secret,
    });
    await settle();

    await router.handleInbound({
      event: {
        data: 'allow',
        place: 'place-a',
        requestId: 'p1',
        type: 'question_answer',
      },
      eventId: 'qa-blocked',
    });
    await settle();

    assert.equal(await decisionPromise, 'reject');
    assert.ok(
      sent.some(
        (c) => c.type === 'resolve_question' && c.text === 'Отклонено.',
      ),
    );
  });

  void it('allow на путь под registry ban → reject', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sherpa-reg-'));
    temps.push(cwd);
    const registryFile = join(cwd, 'registry.sqlite');
    writeFileSync(registryFile, '');

    const port = createSessionTestDouble();
    const { router } = makeHarness({
      places: { 'place-a': cwd },
      registryPath: registryFile,
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'go', type: 'message' },
      eventId: 'm1',
    });
    await settle();
    const session = port.opened[0];
    assert.ok(session);
    const decisionPromise = session.emitPermissionAsk({
      action: 'read',
      requestId: 'harness-reg',
      resource: registryFile,
    });
    await settle();

    await router.handleInbound({
      event: {
        data: 'always',
        place: 'place-a',
        requestId: 'p1',
        type: 'question_answer',
      },
      eventId: 'qa-reg',
    });
    await settle();

    assert.equal(await decisionPromise, 'reject');
  });

  void it('teardown хода снимает pending; поздний answer — drop', async () => {
    const port = createSessionTestDouble();
    const { router, sent } = makeHarness({
      places: { 'place-a': '/tmp/proj' },
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'go', type: 'message' },
      eventId: 'm1',
    });
    await settle();
    const session = port.opened[0];
    assert.ok(session);
    const decisionPromise = session.emitPermissionAsk({
      action: 'edit',
      requestId: 'harness-tear',
      resource: '/tmp/proj/x',
    });
    await settle();

    assert.ok(sent.some((c) => c.type === 'send_question'));
    session.kill();
    await settle();

    assert.equal(await decisionPromise, 'reject');
    assert.ok(
      sent.some(
        (c) => c.type === 'resolve_question' && c.text === 'Отклонено.',
      ),
    );

    const answersBefore = port.calls.filter(
      (c) => c.type === 'answer_permission',
    ).length;
    await router.handleInbound({
      event: {
        data: 'allow',
        place: 'place-a',
        requestId: 'p1',
        type: 'question_answer',
      },
      eventId: 'qa-late',
    });
    await settle();
    assert.equal(
      port.calls.filter((c) => c.type === 'answer_permission').length,
      answersBefore,
      'поздний answer не доходит до харнесса повторно',
    );
  });

  void it('сбой outbound на эхо — следующий job всё же обрабатывается', async () => {
    const port = createSessionTestDouble();
    let echoAttempts = 0;
    const { router, sent } = makeHarness({
      places: { 'place-a': '/tmp/a' },
      sendOutcome: (command) => {
        if (
          command.type === 'send_message' &&
          command.text.startsWith('echo:')
        ) {
          echoAttempts += 1;
          if (echoAttempts === 1) {
            return { cause: 'timeout', kind: 'unknown' };
          }
        }
        return { kind: 'success', result: successResult(command) };
      },
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'one', type: 'message' },
      eventId: 'e1',
    });
    await router.handleInbound({
      event: { place: 'place-a', text: 'two', type: 'message' },
      eventId: 'e2',
    });
    await settle();

    assert.equal(echoAttempts, 2);
    assert.ok(
      sent.some((c) => c.type === 'send_message' && c.text === 'echo:two'),
    );
  });

  void it('повтор eventId — один эффект (в т.ч. «вне реестра»)', async () => {
    const place = 'unknown-dup';
    const { router, sent } = makeHarness({
      places: {},
      sessionPort: createSessionTestDouble(),
    });

    await router.handleInbound({
      event: { place, text: 'a', type: 'message' },
      eventId: 'same',
    });
    await router.handleInbound({
      event: { place, text: 'b', type: 'message' },
      eventId: 'same',
    });
    await settle();

    assert.equal(sent.length, 1);
    assert.equal(
      sent[0]?.type === 'send_message' ? sent[0].text : '',
      buildOutsideRegistryText(place),
    );
  });

  void it('message без delivery → дефолт interject на push', async () => {
    const port = createSessionTestDouble();
    const { router } = makeHarness({
      places: { 'place-a': '/tmp/a' },
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'plain', type: 'message' },
      eventId: 'def-1',
    });
    await settle();

    assert.ok(
      port.calls.some(
        (c) =>
          c.type === 'push' && c.delivery === 'interject' && c.text === 'plain',
      ),
    );
  });

  void it('override after → push с delivery after', async () => {
    const port = createSessionTestDouble();
    const { router } = makeHarness({
      places: { 'place-a': '/tmp/a' },
      sessionPort: port,
    });

    await router.handleInbound({
      event: {
        delivery: 'after',
        place: 'place-a',
        text: 'потом',
        type: 'message',
      },
      eventId: 'after-1',
    });
    await settle();

    assert.ok(
      port.calls.some(
        (c) =>
          c.type === 'push' && c.delivery === 'after' && c.text === 'потом',
      ),
    );
  });

  void it('env-дефолт after без override на wire', async () => {
    const port = createSessionTestDouble();
    const { router } = makeHarness({
      midRunDefaultDelivery: 'after',
      places: { 'place-a': '/tmp/a' },
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'plain', type: 'message' },
      eventId: 'def-after-1',
    });
    await settle();

    assert.ok(
      port.calls.some(
        (c) =>
          c.type === 'push' && c.delivery === 'after' && c.text === 'plain',
      ),
    );
  });

  void it('session_break при активном ходе → interrupt_turn', async () => {
    const port = createSessionTestDouble({ holdTurn: true });
    // resume — без cold diary-nudge, иначе holdTurn зависает на read-ходе
    const sessionIds = new Map<string, string>([['place-a', 'held-1']]);
    const { router } = makeHarness({
      places: { 'place-a': '/tmp/a' },
      sessionIds,
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'run', type: 'message' },
      eventId: 'brk-1',
    });
    await settle();

    assert.equal(port.opened[0]?.isTurnActive(), true);

    await router.handleInbound({
      event: { place: 'place-a', type: 'session_break' },
      eventId: 'brk-2',
    });
    await settle();

    assert.ok(
      port.calls.some((c) => c.type === 'interrupt_turn'),
      'break → interrupt',
    );
    // после task turn_ended уходит fixation-nudge (holdTurn — ход жив)
    assert.ok(
      port.calls.some(
        (c) => c.type === 'push' && c.text === DIARY_FIXATION_NUDGE_TEXT,
      ),
    );
    assert.equal(port.opened[0]?.isTurnActive(), true);

    await router.handleInbound({
      event: { place: 'place-a', type: 'session_break' },
      eventId: 'brk-3',
    });
    await settle();

    assert.equal(port.opened[0]?.isTurnActive(), false);
  });

  void it('session_break без живой сессии → no-op, порта нет', async () => {
    const port = createSessionTestDouble();
    const { router } = makeHarness({
      places: { 'place-a': '/tmp/a' },
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', type: 'session_break' },
      eventId: 'brk-idle-1',
    });
    await settle();

    assert.equal(port.calls.length, 0);
  });

  void it('session_break без активного хода → no-op interrupt', async () => {
    const port = createSessionTestDouble();
    const { router } = makeHarness({
      places: { 'place-a': '/tmp/a' },
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'done', type: 'message' },
      eventId: 'brk-idle-2',
    });
    await settle();
    assert.equal(port.opened[0]?.isTurnActive(), false);

    const callsBefore = port.calls.length;
    await router.handleInbound({
      event: { place: 'place-a', type: 'session_break' },
      eventId: 'brk-idle-3',
    });
    await settle();

    assert.equal(
      port.calls.filter((c) => c.type === 'interrupt_turn').length,
      0,
    );
    assert.equal(port.calls.length, callsBefore);
  });

  void it('два места — независимые слоты', async () => {
    const port = createSessionTestDouble();
    const gateA = createGate();
    const { router, sent } = makeHarness({
      beforeSend: async (command) => {
        if (
          command.type === 'set_status' &&
          command.place === 'place-a' &&
          command.status === 'busy'
        ) {
          await gateA.wait;
        }
      },
      places: { 'place-a': '/tmp/a', 'place-b': '/tmp/b' },
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'a', type: 'message' },
      eventId: 'ea',
    });
    await router.handleInbound({
      event: { place: 'place-b', text: 'b', type: 'message' },
      eventId: 'eb',
    });
    await settle();

    assert.ok(
      sent.some((c) => c.type === 'send_message' && c.text === 'echo:b'),
    );
    assert.ok(
      !sent.some((c) => c.type === 'send_message' && c.text === 'echo:a'),
    );

    gateA.release();
    await settle();
    assert.ok(
      sent.some((c) => c.type === 'send_message' && c.text === 'echo:a'),
    );
    assert.equal(port.opened.length, 2);
  });
});

function createGate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release: () => release(), wait };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function makeHarness(options: {
  beforeSend?: (command: OutboundCommand) => Promise<void>;
  loadWorkdirRights?: (cwd: string) => WorkdirRights;
  midRunDefaultDelivery?: 'after' | 'interject';
  places: Record<string, string>;
  registryPath?: string;
  sendOutcome?: (command: OutboundCommand) => ChannelSendOutcome;
  sessionIds?: Map<string, string>;
  sessionPort: SessionTestDouble;
}) {
  const sent: OutboundCommand[] = [];
  const sessionIds = options.sessionIds ?? new Map<string, string>();
  for (const key of Object.keys(options.places)) {
    if (!sessionIds.has(key)) sessionIds.set(key, '');
  }

  const router = createInboundRouter({
    findCwdByPlaceKey: (key) => options.places[key] ?? null,
    getPlaceSessionId: (key) => {
      if (!(key in options.places)) {
        throw new Error(`getPlaceSessionId: нет места ${key}`);
      }
      return sessionIds.get(key) ?? '';
    },
    loadWorkdirRights:
      options.loadWorkdirRights ??
      ((cwd) => ({
        cwd,
        denies: [],
        denyGlobals: [],
        grants: [],
      })),
    midRunDefaultDelivery: options.midRunDefaultDelivery ?? 'interject',
    registryPath: options.registryPath ?? ':memory:',
    send: async (command) => {
      await options.beforeSend?.(command);
      sent.push(command);
      return (
        options.sendOutcome?.(command) ?? {
          kind: 'success',
          result: successResult(command),
        }
      );
    },
    sessionPort: options.sessionPort,
    setPlaceSessionId: (key, sessionId) => {
      if (!(key in options.places)) {
        throw new Error(`setPlaceSessionId: нет места ${key}`);
      }
      sessionIds.set(key, sessionId);
    },
  });
  return { router, sent, sessionIds };
}

async function settle() {
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve();
  }
  await delay(20);
}

function successResult(command: OutboundCommand): OutboundResult {
  switch (command.type) {
    case 'create_place':
      return { place: 'new', type: 'create_place_ok' };
    case 'resolve_question':
    case 'send_message':
    case 'set_status':
      return { commandType: command.type, type: 'send_ok' };
    case 'send_question':
      return {
        commandType: 'send_question',
        messageId: 'm1',
        type: 'question_ok',
      };
  }
}
