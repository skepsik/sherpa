import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import type { SessionEvent } from '../src/types/session';

import {
  ASSISTANT_TEXT_CHUNK_MAX,
  createOpenCodeSessionPort,
  expressLaunchRights,
  listTextChunks,
} from '../src/adapters/opencode';
import { openRegistry } from '../src/registry';
import { buildLaunchRights } from '../src/rights';
import {
  createPlaceSessionSlots,
  DIARY_FIXATION_NUDGE_TEXT,
  DIARY_READ_NUDGE_TEXT,
  SessionResumeError,
} from '../src/session';
import { createOpenCodeFakeHost } from './opencode-fake-host';

void describe('opencode session port (fake host)', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  void it('start → push → assistant_text + session_id; shell deny в create', async () => {
    const { cwd, registry, registryPath } = setupWorkdir(temps);
    const host = createOpenCodeFakeHost();
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    const events: SessionEvent[] = [];
    const session = await port.start({ cwd });
    session.subscribe((event) => events.push(event));

    assert.ok(session.sessionId.startsWith('ses_fake_'));
    assert.equal(host.creates.length, 1);
    assert.equal(host.creates[0]?.directory, cwd);
    assert.equal(
      host.creates[0]?.permissions.find((rule) => rule.action === 'shell')
        ?.effect,
      'deny',
    );

    await session.pushMessage('привет', 'interject');
    await waitFor(
      () => events.some((event) => event.type === 'turn_ended'),
      1000,
    );

    const textEvents = events.filter(
      (event) => event.type === 'assistant_text',
    );
    assert.equal(textEvents.length, 1);
    assert.equal(textEvents[0]?.type, 'assistant_text');
    if (textEvents[0]?.type === 'assistant_text') {
      assert.equal(textEvents[0].text, 'mock:привет');
    }
    assert.ok(events.some((event) => event.type === 'turn_started'));
    assert.ok(events.some((event) => event.type === 'turn_ended'));
    assert.ok(!events.some((event) => event.type === 'closed'));

    registry.close();
  });

  void it('через слот: session_id в БД; outbound текст непустой', async () => {
    const { cwd, placeKey, registry, registryPath } = setupWorkdir(temps);
    const host = createOpenCodeFakeHost();
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    const outbound: SessionEvent[] = [];
    const slots = createPlaceSessionSlots({
      getPlaceSessionId: (key) => registry.getPlaceSessionId(key),
      onEvent: (_key, event) => outbound.push(event),
      sessionPort: port,
      setPlaceSessionId: (key, id) => registry.setPlaceSessionId(key, id),
    });

    await slots.pushMessage({
      cwd,
      delivery: 'interject',
      key: placeKey,
      text: 'job',
    });
    await waitFor(
      () =>
        outbound.some(
          (event) =>
            event.type === 'assistant_text' && event.text === 'mock:job',
        ),
      2000,
    );

    assert.ok(registry.getPlaceSessionId(placeKey).startsWith('ses_fake_'));
    assert.ok(
      outbound.some(
        (event) => event.type === 'assistant_text' && event.text === 'mock:job',
      ),
    );
    assert.deepEqual(host.prompts.map((p) => p.text).slice(0, 2), [
      DIARY_READ_NUDGE_TEXT,
      'job',
    ]);
    const diaryStarted = outbound.find(
      (event) => event.type === 'turn_started' && event.nudgeOnly === true,
    );
    const diaryText = outbound.find(
      (event) =>
        event.type === 'assistant_text' &&
        event.text === `mock:${DIARY_READ_NUDGE_TEXT}`,
    );
    assert.ok(diaryStarted, 'diary turn_started nudgeOnly');
    assert.equal(
      diaryText?.type === 'assistant_text' && diaryText.nudgeOnly,
      true,
    );
    const jobText = outbound.find(
      (event) => event.type === 'assistant_text' && event.text === 'mock:job',
    );
    assert.equal(
      jobText?.type === 'assistant_text' && jobText.nudgeOnly,
      false,
    );
    await waitFor(
      () => host.prompts.some((p) => p.text === DIARY_FIXATION_NUDGE_TEXT),
      2000,
    );
    registry.close();
  });

  void it('успешный resume: get без create; load прав не вызывается', async () => {
    const { cwd, registry, registryPath } = setupWorkdir(temps);
    const host = createOpenCodeFakeHost();
    let loadCalls = 0;
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => {
        loadCalls += 1;
        return registry.loadWorkdirRights(path);
      },
      registryPath,
    });

    const started = await port.start({ cwd });
    assert.equal(host.creates.length, 1);
    // ensure (existing) + buildPermissions
    assert.equal(loadCalls, 2);
    const sessionId = started.sessionId;

    const resumed = await port.resume({ cwd, sessionId });
    assert.equal(resumed.sessionId, sessionId);
    assert.equal(host.creates.length, 1);
    assert.equal(loadCalls, 2);

    const events: SessionEvent[] = [];
    resumed.subscribe((event) => events.push(event));
    await resumed.pushMessage('after-resume', 'interject');
    await waitFor(
      () => events.some((event) => event.type === 'turn_ended'),
      1000,
    );
    assert.ok(
      events.some(
        (event) =>
          event.type === 'assistant_text' && event.text === 'mock:after-resume',
      ),
    );

    registry.close();
  });

  void it('resume-fail → SessionResumeError; слот сбрасывает id и cold start', async () => {
    const { cwd, placeKey, registry, registryPath } = setupWorkdir(temps);
    const host = createOpenCodeFakeHost();
    const staleId = 'ses_fake_stale';
    registry.setPlaceSessionId(placeKey, staleId);
    host.failGetFor(staleId);

    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    await assert.rejects(
      () => port.resume({ cwd, sessionId: staleId }),
      (error: unknown) => error instanceof SessionResumeError,
    );

    const slots = createPlaceSessionSlots({
      getPlaceSessionId: (key) => registry.getPlaceSessionId(key),
      onEvent: () => undefined,
      sessionPort: port,
      setPlaceSessionId: (key, id) => registry.setPlaceSessionId(key, id),
    });

    await slots.pushMessage({
      cwd,
      delivery: 'interject',
      key: placeKey,
      text: 'after-fail',
    });
    assert.notEqual(registry.getPlaceSessionId(placeKey), staleId);
    assert.ok(registry.getPlaceSessionId(placeKey).startsWith('ses_fake_'));
    assert.equal(host.creates.length, 1);

    registry.close();
  });

  void it('два Place — разные сессии и разные permissions (нет cross-talk)', async () => {
    const a = setupWorkdir(temps, 'place-a');
    const b = setupWorkdir(temps, 'place-b');
    const foreignA = join(a.root, 'foreign-a');
    const foreignB = join(b.root, 'foreign-b');
    mkdirSync(foreignA);
    mkdirSync(foreignB);
    a.registry.upsertGrant({
      cwd: a.cwd,
      level: 'ro',
      path: foreignA,
    });
    b.registry.upsertGrant({
      cwd: b.cwd,
      level: 'rw',
      path: foreignB,
    });

    const host = createOpenCodeFakeHost();
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => {
        // Две отдельные БД в тесте — ensure пишет в обе (UNIQUE → no-op).
        for (const reg of [a.registry, b.registry]) {
          try {
            reg.insertDenyGlobal(input);
          } catch (error: unknown) {
            if (
              !(error instanceof Error) ||
              !/UNIQUE constraint failed/i.test(error.message)
            ) {
              throw error;
            }
          }
        }
        return { pattern: input.pattern };
      },
      loadWorkdirRights: (path) => {
        if (path === a.cwd) return a.registry.loadWorkdirRights(path);
        if (path === b.cwd) return b.registry.loadWorkdirRights(path);
        throw new Error(`unexpected cwd ${path}`);
      },
      registryPath: a.registryPath,
    });

    const sessionA = await port.start({ cwd: a.cwd });
    const sessionB = await port.start({ cwd: b.cwd });
    assert.notEqual(sessionA.sessionId, sessionB.sessionId);
    assert.equal(host.creates.length, 2);

    const permsA = host.creates[0]?.permissions ?? [];
    const permsB = host.creates[1]?.permissions ?? [];
    assert.ok(
      permsA.some(
        (rule) =>
          rule.action === 'external_directory' &&
          rule.resource.includes('foreign-a') &&
          rule.effect === 'allow',
      ),
    );
    assert.ok(
      !permsA.some(
        (rule) =>
          rule.action === 'external_directory' &&
          rule.resource.includes('foreign-b') &&
          rule.effect === 'allow',
      ),
    );
    assert.ok(
      permsB.some(
        (rule) =>
          rule.action === 'external_directory' &&
          rule.resource.includes('foreign-b') &&
          rule.effect === 'allow',
      ),
    );
    assert.ok(
      !permsB.some(
        (rule) =>
          rule.action === 'external_directory' &&
          rule.resource.includes('foreign-a') &&
          rule.effect === 'allow',
      ),
    );

    a.registry.close();
    b.registry.close();
  });

  void it('interject → steer; after → queue на host.prompt', async () => {
    const { cwd, registry, registryPath } = setupWorkdir(temps);
    const host = createOpenCodeFakeHost();
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    const session = await port.start({ cwd });
    await session.pushMessage('a', 'interject');
    await session.pushMessage('b', 'after');

    assert.deepEqual(
      host.prompts.map((p) => ({ delivery: p.delivery, text: p.text })),
      [
        { delivery: 'steer', text: 'a' },
        { delivery: 'queue', text: 'b' },
      ],
    );

    registry.close();
  });

  void it('interruptTurn → host.interrupt; turn_ended без closed', async () => {
    const { cwd, registry, registryPath } = setupWorkdir(temps);
    const host = createOpenCodeFakeHost();
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    const events: SessionEvent[] = [];
    const session = await port.start({ cwd });
    session.subscribe((event) => events.push(event));

    await session.interruptTurn();
    await waitFor(
      () => events.some((event) => event.type === 'turn_ended'),
      1000,
    );
    assert.ok(!events.some((event) => event.type === 'closed'));

    await session.pushMessage('после-break', 'interject');
    await waitFor(
      () => events.filter((event) => event.type === 'turn_ended').length >= 2,
      1000,
    );
    assert.equal(host.prompts.length, 1);

    registry.close();
  });

  void it('нормальный конец хода — следующий push без cold start', async () => {
    const { cwd, registry, registryPath } = setupWorkdir(temps);
    const host = createOpenCodeFakeHost();
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    const events: SessionEvent[] = [];
    const session = await port.start({ cwd });
    session.subscribe((event) => events.push(event));

    await session.pushMessage('one', 'interject');
    await waitFor(
      () => events.filter((event) => event.type === 'turn_ended').length >= 1,
      1000,
    );
    assert.equal(host.creates.length, 1);

    await session.pushMessage('two', 'interject');
    await waitFor(
      () => events.filter((event) => event.type === 'turn_ended').length >= 2,
      1000,
    );
    assert.equal(host.creates.length, 1);
    assert.equal(host.prompts.length, 2);
    assert.ok(!events.some((event) => event.type === 'closed'));

    registry.close();
  });

  void it('permission_ask ждёт answerPermission → replyPermission', async () => {
    const { cwd, registry, registryPath } = setupWorkdir(temps);
    const host = createOpenCodeFakeHost();
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    const events: SessionEvent[] = [];
    const session = await port.start({ cwd });
    session.subscribe((event) => events.push(event));

    host.emit({
      data: {
        action: 'edit',
        id: 'perm_1',
        resources: ['/tmp/x'],
        sessionID: session.sessionId,
      },
      type: 'permission.asked',
    });

    await waitFor(
      () => events.some((event) => event.type === 'permission_ask'),
      1000,
    );
    assert.deepEqual(
      events.filter((event) => event.type === 'permission_ask'),
      [
        {
          action: 'edit',
          requestId: 'perm_1',
          resource: '/tmp/x',
          type: 'permission_ask',
        },
      ],
    );
    assert.equal(host.replies.length, 0);

    await session.answerPermission({
      decision: 'once',
      requestId: 'perm_1',
    });
    await waitFor(() => host.replies.length >= 1, 1000);
    assert.equal(host.replies[0]?.decision, 'once');
    assert.equal(host.replies[0]?.requestId, 'perm_1');

    registry.close();
  });

  void it('permission_ask без requestId → replyPermission(reject)', async () => {
    const { cwd, registry, registryPath } = setupWorkdir(temps);
    const host = createOpenCodeFakeHost();
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    const session = await port.start({ cwd });
    host.emit({
      data: {
        action: 'edit',
        id: '',
        resources: ['/tmp/x'],
        sessionID: session.sessionId,
      },
      type: 'permission.asked',
    });

    await waitFor(() => host.replies.length >= 1, 1000);
    assert.equal(host.replies[0]?.decision, 'reject');
    assert.equal(host.replies[0]?.requestId, '');

    registry.close();
  });

  void it('abort при открытом ask → replyPermission(reject)', async () => {
    const { cwd, registry, registryPath } = setupWorkdir(temps);
    const host = createOpenCodeFakeHost();
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    const session = await port.start({ cwd });
    host.emit({
      data: {
        action: 'edit',
        id: 'perm_abort',
        resources: ['/tmp/x'],
        sessionID: session.sessionId,
      },
      type: 'permission.asked',
    });
    // дать settlePermissionAsk зарегистрировать pending
    for (let i = 0; i < 20; i += 1) await Promise.resolve();

    await session.abort();
    await waitFor(() => host.replies.length >= 1, 1000);
    assert.equal(host.replies[0]?.decision, 'reject');
    assert.equal(host.replies[0]?.requestId, 'perm_abort');

    registry.close();
  });

  void it('длинный текст режется на куски ≤4096 без потери', () => {
    const text = 'а'.repeat(ASSISTANT_TEXT_CHUNK_MAX + 10);
    const chunks = listTextChunks(text);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]?.length, ASSISTANT_TEXT_CHUNK_MAX);
    assert.equal(chunks.join(''), text);
  });

  void it('start: creates.permissions === express(load→build)', async () => {
    const { cwd, registry, registryPath } = setupWorkdir(temps);
    const host = createOpenCodeFakeHost();
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    await port.start({ cwd });
    const expected = expressLaunchRights(
      buildLaunchRights(registry.loadWorkdirRights(cwd), { registryPath }),
    );
    assert.deepEqual(host.creates[0]?.permissions, expected.permissions);

    registry.close();
  });

  void it('конец subscribe → closed на живом handle', async () => {
    const { cwd, registry, registryPath } = setupWorkdir(temps);
    const host = createOpenCodeFakeHost();
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    const events: SessionEvent[] = [];
    const session = await port.start({ cwd });
    session.subscribe((event) => events.push(event));

    host.endEvents();
    await waitFor(() => events.some((event) => event.type === 'closed'), 1000);
    assert.ok(events.some((event) => event.type === 'error'));
    assert.ok(events.some((event) => event.type === 'closed'));

    registry.close();
  });

  void it('pushMessage в закрытую сессию — отказ', async () => {
    const { cwd, registry, registryPath } = setupWorkdir(temps);
    const host = createOpenCodeFakeHost();
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    const session = await port.start({ cwd });
    await session.abort();
    await assert.rejects(
      () => session.pushMessage('late', 'interject'),
      /сессия закрыта/,
    );
    assert.equal(host.prompts.length, 0);

    registry.close();
  });

  void it('после конца subscribe новый start снова получает события', async () => {
    const { cwd, registry, registryPath } = setupWorkdir(temps);
    const host = createOpenCodeFakeHost();
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    const firstEvents: SessionEvent[] = [];
    const first = await port.start({ cwd });
    first.subscribe((event) => firstEvents.push(event));
    host.endEvents();
    await waitFor(
      () => firstEvents.some((event) => event.type === 'closed'),
      1000,
    );

    const secondEvents: SessionEvent[] = [];
    const second = await port.start({ cwd });
    second.subscribe((event) => secondEvents.push(event));
    await second.pushMessage('again', 'interject');
    await waitFor(
      () => secondEvents.some((event) => event.type === 'turn_ended'),
      1000,
    );
    assert.ok(
      secondEvents.some(
        (event) =>
          event.type === 'assistant_text' && event.text === 'mock:again',
      ),
    );

    registry.close();
  });

  void it('повторный attach того же id — closed предыдущему live', async () => {
    const { cwd, registry, registryPath } = setupWorkdir(temps);
    const host = createOpenCodeFakeHost();
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    const firstEvents: SessionEvent[] = [];
    const first = await port.start({ cwd });
    first.subscribe((event) => firstEvents.push(event));
    const sessionId = first.sessionId;

    const secondEvents: SessionEvent[] = [];
    const second = await port.resume({ cwd, sessionId });
    assert.equal(second.sessionId, sessionId);
    assert.ok(firstEvents.some((event) => event.type === 'closed'));
    await assert.rejects(
      () => first.pushMessage('orphan', 'interject'),
      /сессия закрыта/,
    );

    second.subscribe((event) => secondEvents.push(event));
    await second.pushMessage('owner', 'interject');
    await waitFor(
      () => secondEvents.some((event) => event.type === 'turn_ended'),
      1000,
    );
    assert.equal(host.creates.length, 1);
    assert.ok(
      secondEvents.some(
        (event) =>
          event.type === 'assistant_text' && event.text === 'mock:owner',
      ),
    );

    registry.close();
  });
});

function setupWorkdir(temps: string[], placeKey = 'place-1') {
  const root = mkdtempSync(join(tmpdir(), 'sherpa-oc-'));
  temps.push(root);
  const cwd = join(root, 'cwd');
  mkdirSync(cwd);
  const registryPath = join(root, 'registry.sqlite');
  const registry = openRegistry({ path: registryPath });
  const seeded = registry.seedWorkdirPlace({
    cwd,
    description: 'oc test',
    name: `proj-${placeKey}`,
    placeKey,
  });
  return {
    cwd: seeded.cwd,
    placeKey: seeded.placeKey,
    registry,
    registryPath,
    root,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs: number) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('waitFor: timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
