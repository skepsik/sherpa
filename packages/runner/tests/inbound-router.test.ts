import type { OutboundCommand, OutboundResult } from '@sherpa/contract';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChannelSendOutcome } from '../src/types';
import type { SessionTestDouble } from '../src/types/session';

import {
  buildOutsideRegistryText,
  createInboundRouter,
  STUB_ACCEPTED_TEXT,
} from '../src/inbound-router';
import { createSessionTestDouble } from '../src/session';

void describe('inbound router', () => {
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

    assert.equal(countStubAccepted(sent, 'place-a'), 0);
    assert.ok(
      sent.some((c) => c.type === 'send_message' && c.text === 'echo:привет'),
    );
    assert.ok(sent.some((c) => c.type === 'set_status' && c.status === 'busy'));
    assert.ok(sent.some((c) => c.type === 'set_status' && c.status === 'idle'));
    assert.deepEqual(
      port.calls.filter((c) => c.type === 'start' || c.type === 'push'),
      [
        { cwd: '/tmp/a', type: 'start' },
        { sessionId: 'double-1', text: 'привет', type: 'push' },
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
    assert.equal(pushes.length, 2, 'оба push ушли, пока ход на busy/gate');
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
    assert.equal(oldSession.pushes.length, 1);
    assert.equal(sessionIds.get('place-a'), 'double-1');

    oldSession.kill();
    gate.release();
    await settle();

    assert.ok(
      sent.some((c) => c.type === 'set_status' && c.status === 'idle'),
      'closed mid-turn → idle',
    );

    await router.handleInbound({
      event: { place: 'place-a', text: 'after-kill', type: 'message' },
      eventId: 'e2',
    });
    await settle();

    assert.equal(oldSession.pushes.length, 1, 'в старый handle не писали');
    assert.ok(
      port.calls.some((c) => c.type === 'resume' && c.sessionId === 'double-1'),
    );
    assert.ok(
      port.calls.some(
        (c) =>
          c.type === 'push' &&
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

  void it('question_answer при занятом ходе — ack без ожидания FIFO', async () => {
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

    await router.handleInbound({
      event: {
        data: 'yes',
        place: 'place-a',
        requestId: 'req-1',
        type: 'question_answer',
      },
      eventId: 'qa1',
    });

    assert.equal(
      countStubAccepted(sent, 'place-a'),
      1,
      'ack question_answer ушёл, пока message ход на busy/gate',
    );
    assert.ok(
      !sent.some((c) => c.type === 'set_status' && c.status === 'busy'),
      'busy ещё не прошёл beforeSend',
    );

    gate.release();
    await settle();

    assert.equal(countStubAccepted(sent, 'place-a'), 1);
    assert.ok(
      sent.some((c) => c.type === 'send_message' && c.text === 'echo:long'),
    );
    assert.ok(sent.some((c) => c.type === 'set_status' && c.status === 'busy'));
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

function countStubAccepted(sent: OutboundCommand[], place: string) {
  return sent.filter(
    (c) =>
      c.type === 'send_message' &&
      c.place === place &&
      c.text === STUB_ACCEPTED_TEXT,
  ).length;
}

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
  places: Record<string, string>;
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
