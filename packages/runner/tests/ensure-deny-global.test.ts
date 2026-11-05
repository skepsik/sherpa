import type { OutboundCommand, OutboundResult } from '@sherpa/contract';

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import type { ChannelSendOutcome } from '../src/types/outcome';

import {
  createOpenCodeSessionPort,
  expressLaunchRights,
} from '../src/adapters/opencode';
import { createInboundRouter } from '../src/inbound-router';
import { openRegistry } from '../src/registry';
import {
  buildLaunchRights,
  EnsureDenyGlobalError,
  ensureDenyGlobalMvp,
  listMvpDenyGlobalPatterns,
  resolvePathAccess,
} from '../src/rights';
import { createOpenCodeFakeHost } from './opencode-fake-host';

void describe('ensureDenyGlobalMvp', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  void it('пустой deny_global → набор MVP; повтор — без дублей PK', () => {
    const { cwd, registry } = setupWorkdir(temps);
    const patterns = listMvpDenyGlobalPatterns();

    ensureDenyGlobalMvp({
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadExistingPatterns: () =>
        registry.loadWorkdirRights(cwd).denyGlobals.map((row) => row.pattern),
    });

    const first = registry
      .loadWorkdirRights(cwd)
      .denyGlobals.map((row) => row.pattern);
    for (const pattern of patterns) {
      assert.ok(first.includes(pattern), pattern);
    }

    ensureDenyGlobalMvp({
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadExistingPatterns: () =>
        registry.loadWorkdirRights(cwd).denyGlobals.map((row) => row.pattern),
    });
    const second = registry
      .loadWorkdirRights(cwd)
      .denyGlobals.map((row) => row.pattern);
    assert.deepEqual(second, first);

    registry.close();
  });

  void it('часть строк уже есть → дописывает недостающие, чужие не трогает', () => {
    const { cwd, registry } = setupWorkdir(temps);
    registry.insertDenyGlobal({ pattern: 'write:AGENTS.md' });
    registry.insertDenyGlobal({ pattern: 'write:extra-user.md' });

    ensureDenyGlobalMvp({
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadExistingPatterns: () =>
        registry.loadWorkdirRights(cwd).denyGlobals.map((row) => row.pattern),
    });

    const patterns = registry
      .loadWorkdirRights(cwd)
      .denyGlobals.map((row) => row.pattern);
    assert.ok(patterns.includes('write:extra-user.md'));
    for (const pattern of listMvpDenyGlobalPatterns()) {
      assert.ok(patterns.includes(pattern), pattern);
    }
    assert.equal(patterns.filter((p) => p === 'write:AGENTS.md').length, 1);

    registry.close();
  });

  void it('после ensure: AGENTS/.onto запись закрыта; .env* read; .env.example ok', () => {
    const { cwd, registry, registryPath } = setupWorkdir(temps);
    writeFileSync(join(cwd, 'AGENTS.md'), 'x');
    writeFileSync(join(cwd, '.env'), 'SECRET=1');
    writeFileSync(join(cwd, '.env.example'), 'EXAMPLE=1');
    mkdirSync(join(cwd, '.onto'), { recursive: true });
    writeFileSync(join(cwd, '.onto', 'rules.md'), 'r');

    ensureDenyGlobalMvp({
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadExistingPatterns: () =>
        registry.loadWorkdirRights(cwd).denyGlobals.map((row) => row.pattern),
    });

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
    assert.equal(
      resolvePathAccess(cwd, join(cwd, '.env.example'), snap, opts).level,
      'rw',
    );

    const { permissions } = expressLaunchRights(buildLaunchRights(snap, opts));
    assert.ok(
      permissions.some(
        (rule) =>
          rule.effect === 'deny' &&
          rule.action === 'edit' &&
          rule.resource.includes('AGENTS.md'),
      ),
    );

    registry.close();
  });

  void it('expressLaunchRights не пишет в deny_global', () => {
    const { cwd, registry, registryPath } = setupWorkdir(temps);
    const before = registry.loadWorkdirRights(cwd).denyGlobals.length;
    expressLaunchRights(
      buildLaunchRights(registry.loadWorkdirRights(cwd), { registryPath }),
    );
    assert.equal(registry.loadWorkdirRights(cwd).denyGlobals.length, before);
    registry.close();
  });

  void it('отказ insert → EnsureDenyGlobalError', () => {
    assert.throws(
      () =>
        ensureDenyGlobalMvp({
          insertDenyGlobal: () => {
            throw new Error('db locked');
          },
          loadExistingPatterns: () => [],
        }),
      (error: unknown) =>
        error instanceof EnsureDenyGlobalError &&
        error.code === 'ensure_deny_global_failed' &&
        /db locked/.test(error.message),
    );
  });

  void it('отказ loadExistingPatterns → EnsureDenyGlobalError', () => {
    assert.throws(
      () =>
        ensureDenyGlobalMvp({
          insertDenyGlobal: () => {
            throw new Error('не должен вызываться');
          },
          loadExistingPatterns: () => {
            throw new Error('workdir missing');
          },
        }),
      (error: unknown) =>
        error instanceof EnsureDenyGlobalError &&
        error.code === 'ensure_deny_global_failed' &&
        /workdir missing/.test(error.message),
    );
  });

  void it('HOME в абсолютных шаблонах — без хвостового /', () => {
    const home = '/tmp/fake-home///';
    const patterns = listMvpDenyGlobalPatterns(home);
    assert.ok(patterns.includes('read:///tmp/fake-home/.ssh/**'));
    assert.ok(patterns.includes('read:///tmp/fake-home/.aws/**'));
    assert.ok(patterns.includes('read:///tmp/fake-home/.gnupg/**'));
    assert.equal(listMvpDenyGlobalPatterns(homedir()).length, 9);
  });

  void it('отказ ensure на start → в Place текст; очередь не сбрасывается', async () => {
    const { cwd, placeKey, registry, registryPath } = setupWorkdir(temps);
    const host = createOpenCodeFakeHost();
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: () => {
        throw new Error('disk full');
      },
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    const sent: OutboundCommand[] = [];
    const sessionIds = new Map<string, string>([[placeKey, '']]);
    const router = createInboundRouter({
      findCwdByPlaceKey: (key) => (key === placeKey ? cwd : null),
      getPlaceSessionId: (key) => sessionIds.get(key) ?? '',
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
      setPlaceSessionId: (key, id) => {
        sessionIds.set(key, id);
      },
    });

    await router.handleInbound({
      event: { place: placeKey, text: 'one', type: 'message' },
      eventId: 'fail-1',
    });
    await settle();

    assert.equal(host.creates.length, 0);
    assert.equal(sessionIds.get(placeKey), '');
    assert.ok(
      sent.some(
        (c) =>
          c.type === 'send_message' &&
          c.text.includes('ensure deny_global') &&
          c.text.includes('disk full'),
      ),
    );

    const okPort = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => registry.insertDenyGlobal(input),
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });
    const router2 = createInboundRouter({
      findCwdByPlaceKey: (key) => (key === placeKey ? cwd : null),
      getPlaceSessionId: (key) => sessionIds.get(key) ?? '',
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
      sessionPort: okPort,
      setPlaceSessionId: (key, id) => {
        sessionIds.set(key, id);
      },
    });

    await router2.handleInbound({
      event: { place: placeKey, text: 'two', type: 'message' },
      eventId: 'ok-2',
    });
    await settle();
    await waitFor(() => host.creates.length === 1, 1000);
    assert.ok((sessionIds.get(placeKey) ?? '').startsWith('ses_fake_'));

    registry.close();
  });

  void it('SessionPort.start вызывает ensure до createSession', async () => {
    const { cwd, registry, registryPath } = setupWorkdir(temps);
    assert.equal(registry.loadWorkdirRights(cwd).denyGlobals.length, 0);

    const host = createOpenCodeFakeHost();
    let insertCalls = 0;
    const port = createOpenCodeSessionPort({
      createHost: async () => host,
      insertDenyGlobal: (input) => {
        assert.equal(host.creates.length, 0, 'ensure до createSession');
        insertCalls += 1;
        return registry.insertDenyGlobal(input);
      },
      loadWorkdirRights: (path) => registry.loadWorkdirRights(path),
      registryPath,
    });

    await port.start({ cwd });
    assert.ok(insertCalls > 0);
    assert.equal(host.creates.length, 1);
    for (const pattern of listMvpDenyGlobalPatterns()) {
      assert.ok(
        registry
          .loadWorkdirRights(cwd)
          .denyGlobals.some((row) => row.pattern === pattern),
        pattern,
      );
    }
    registry.close();
  });
});

async function settle() {
  for (let i = 0; i < 40; i += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
}

function setupWorkdir(temps: string[], placeKey = 'place-ensure') {
  const root = mkdtempSync(join(tmpdir(), 'sherpa-ensure-'));
  temps.push(root);
  const cwd = join(root, 'cwd');
  mkdirSync(cwd);
  const registryPath = join(root, 'registry.sqlite');
  const registry = openRegistry({ path: registryPath });
  const seeded = registry.seedWorkdirPlace({
    cwd,
    description: 'ensure test',
    name: `proj-${placeKey}-${temps.length}`,
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
