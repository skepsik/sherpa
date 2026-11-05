import type { OutboundCommand, OutboundResult } from '@sherpa/contract';

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, it } from 'node:test';

import type { ChannelSendOutcome } from '../src/types/outcome';

import { createOpenCodeSessionPort } from '../src/adapters/opencode';
import { createInboundRouter } from '../src/inbound-router';
import { openRegistry } from '../src/registry';
import { listMvpDenyGlobalPatterns, resolvePathAccess } from '../src/rights';
import { createOpenCodeFakeHost } from './opencode-fake-host';

void describe('project agent acceptance (эпик 6)', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  void it('happy path: seed без gatekeeper → inbound → ответ в Place; ensure+shell', async () => {
    const { cwd, placeKey, registry, registryPath } = setupProjectPlace(temps);
    writeFileSync(join(cwd, 'AGENTS.md'), 'инструкции');
    writeFileSync(join(cwd, '.env'), 'SECRET=1');
    mkdirSync(join(cwd, '.onto'), { recursive: true });
    writeFileSync(join(cwd, '.onto', 'rules.md'), 'r');

    assert.equal(countRoles(registryPath), 0, 'роль gatekeeper не seed-ится');

    const host = createOpenCodeFakeHost();
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    const sent: OutboundCommand[] = [];
    const router = createInboundRouter({
      findCwdByPlaceKey: (key) => registry.findCwdByPlaceKey(key),
      getPlaceSessionId: (key) => registry.getPlaceSessionId(key),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      midRunDefaultDelivery: 'interject',
      registryPath,
      send: async (command) => {
        sent.push(command);
        return {
          kind: 'success',
          result: successResult(command),
        } satisfies ChannelSendOutcome;
      },
      sessionPort: port,
      setPlaceSessionId: (key, sessionId) =>
        registry.setPlaceSessionId(key, sessionId),
    });

    const userText = 'сводка по задаче';
    await router.handleInbound({
      event: { place: placeKey, text: userText, type: 'message' },
      eventId: 'acc-happy-1',
    });

    await waitFor(
      () =>
        sent.some(
          (c) => c.type === 'send_message' && c.text === `mock:${userText}`,
        ),
      2000,
    );
    await waitFor(
      () =>
        sent.some(
          (c) =>
            c.type === 'set_status' &&
            c.status === 'idle' &&
            c.place === placeKey,
        ),
      2000,
    );
    await settle();

    const sessionId = registry.getPlaceSessionId(placeKey);
    assert.ok(sessionId.startsWith('ses_fake_'), `session_id: ${sessionId}`);

    assert.equal(host.creates.length, 1);
    assert.ok(
      host.creates[0]?.permissions.some(
        (rule) =>
          rule.effect === 'deny' &&
          rule.action === 'shell' &&
          rule.resource === '*',
      ),
      'shell deny в launch-permissions',
    );

    const promptTexts = host.prompts.map((p) => p.text);
    assert.deepEqual(promptTexts, [userText], 'cold start: сразу user text');

    const placeMessages = sent.filter((c) => c.type === 'send_message');
    assert.ok(
      placeMessages.some(
        (c) => c.type === 'send_message' && c.place === placeKey,
      ),
    );
    assert.ok(
      !placeMessages.some(
        (c) => c.type === 'send_message' && c.text === 'Принято.',
      ),
      'в Place нет stub',
    );
    assert.equal(
      placeMessages.filter(
        (c) => c.type === 'send_message' && c.text === `mock:${userText}`,
      ).length,
      1,
    );

    const busy = sent.filter(
      (c) => c.type === 'set_status' && c.status === 'busy',
    );
    const idle = sent.filter(
      (c) => c.type === 'set_status' && c.status === 'idle',
    );
    assert.equal(busy.length, 1, 'busy на task-ход');
    assert.equal(idle.length, 1, 'idle на task-ход');

    const patterns = registry
      .loadWorkdirRights(cwd)
      .denyGlobals.map((row) => row.pattern);
    for (const pattern of listMvpDenyGlobalPatterns()) {
      assert.ok(patterns.includes(pattern), pattern);
    }

    const snap = registry.loadWorkdirRights(cwd);
    const opts = { registryPath };
    assert.equal(
      resolvePathAccess(cwd, join(cwd, 'AGENTS.md'), snap, opts).level,
      'ro',
    );
    assert.equal(
      resolvePathAccess(cwd, join(cwd, '.onto', 'rules.md'), snap, opts).level,
      'ro',
    );
    assert.equal(
      resolvePathAccess(cwd, join(cwd, '.env'), snap, opts).level,
      'none',
    );

    assert.equal(countRoles(registryPath), 0);

    registry.close();
  });

  void it('permission ask на запрещённый путь → send_question в то же Place', async () => {
    const { cwd, placeKey, registry, registryPath } = setupProjectPlace(temps);
    writeFileSync(join(cwd, 'AGENTS.md'), 'x');

    const host = createOpenCodeFakeHost();
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    const sent: OutboundCommand[] = [];
    const router = createInboundRouter({
      findCwdByPlaceKey: (key) => registry.findCwdByPlaceKey(key),
      getPlaceSessionId: (key) => registry.getPlaceSessionId(key),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      midRunDefaultDelivery: 'interject',
      registryPath,
      send: async (command) => {
        sent.push(command);
        return {
          kind: 'success',
          result: successResult(command),
        } satisfies ChannelSendOutcome;
      },
      sessionPort: port,
      setPlaceSessionId: (key, sessionId) =>
        registry.setPlaceSessionId(key, sessionId),
    });

    await router.handleInbound({
      event: { place: placeKey, text: 'открой', type: 'message' },
      eventId: 'acc-ask-1',
    });
    await waitFor(
      () =>
        sent.some((c) => c.type === 'send_message' && c.text === 'mock:открой'),
      2000,
    );

    const sessionId = registry.getPlaceSessionId(placeKey);
    assert.ok(sessionId.startsWith('ses_fake_'));

    host.emit({
      data: {
        action: 'edit',
        id: 'perm_acc_1',
        resources: [join(cwd, 'AGENTS.md')],
        sessionID: sessionId,
      },
      type: 'permission.asked',
    });

    await waitFor(() => sent.some((c) => c.type === 'send_question'), 1000);

    const question = sent.find((c) => c.type === 'send_question');
    assert.ok(question);
    if (question?.type !== 'send_question') return;
    assert.equal(question.place, placeKey);
    assert.deepEqual(
      question.buttons.map((b) => b.data),
      ['allow', 'deny', 'always'],
    );

    registry.close();
  });
});

function countRoles(registryPath: string) {
  const db = new DatabaseSync(registryPath, { readOnly: true });
  try {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM roles`).get() as {
      n: number;
    };
    return row.n;
  } finally {
    db.close();
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function settle() {
  for (let i = 0; i < 40; i += 1) {
    await Promise.resolve();
  }
  await delay(40);
}

function setupProjectPlace(temps: string[], placeKey = 'place-project') {
  const root = mkdtempSync(join(tmpdir(), 'sherpa-acc-6-3-'));
  temps.push(root);
  const cwd = join(root, 'cwd');
  mkdirSync(cwd);
  const registryPath = join(root, 'registry.sqlite');
  const registry = openRegistry({ path: registryPath });
  const seeded = registry.seedWorkdirPlace({
    cwd,
    description: 'агент проекта без привратника',
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

async function waitFor(predicate: () => boolean, timeoutMs: number) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('waitFor: timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
