import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import type { LaunchRights, Registry } from '../src/types';
import type { OpenCodePermissionRule } from '../src/types/opencode';

import {
  expressLaunchRights,
  OpenCodeExpressError,
} from '../src/adapters/opencode';
import { normalizeWorkdirPath, openRegistry } from '../src/registry';
import { buildLaunchRights, resolvePathAccess } from '../src/rights';

void describe('opencode expressLaunchRights', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  void it('только cwd: нет чужих external-корней; shell deny', () => {
    const ctx = setupTree(temps);
    const snap = ctx.registry.loadWorkdirRights(ctx.cwd);
    const launch = buildLaunchRights(snap, opts(ctx));
    const { permissions } = expressLaunchRights(launch);

    assert.equal(findEffect(permissions, 'shell', 'anything'), 'deny');
    assert.equal(
      findEffect(permissions, 'external_directory', '/tmp/stranger/*'),
      'ask',
    );
    assert.equal(
      findEffect(permissions, 'external_directory', `${ctx.roots.sibling}/*`),
      'ask',
    );
    assert.ok(
      !permissions.some(
        (rule) =>
          rule.action === 'external_directory' &&
          rule.effect === 'allow' &&
          rule.resource !== '*',
      ),
    );
    ctx.registry.close();
  });

  void it('grant ro на /tmp/other: чтение ок; create/edit закрыты', () => {
    const ctx = setupTree(temps);
    const other = join(ctx.root, 'other');
    mkdirSync(other);
    const otherNorm = normalizeWorkdirPath(other);
    ctx.registry.upsertGrant({ cwd: ctx.cwd, level: 'ro', path: otherNorm });

    const launch = buildLaunchRights(
      ctx.registry.loadWorkdirRights(ctx.cwd),
      opts(ctx),
    );
    const { permissions } = expressLaunchRights(launch);

    assert.equal(
      findEffect(permissions, 'external_directory', `${otherNorm}/*`),
      'allow',
    );
    assert.equal(
      findEffect(permissions, 'edit', `${otherNorm}/new-file.txt`),
      'deny',
    );
    assert.equal(
      findEffect(permissions, 'edit', `${otherNorm}/existing.txt`),
      'deny',
    );
    assert.notEqual(
      findEffect(permissions, 'read', `${otherNorm}/existing.txt`),
      'deny',
    );
    ctx.registry.close();
  });

  void it('grant none / отсутствие — корня нет в external allow', () => {
    const ctx = setupTree(temps);
    ctx.registry.upsertGrant({
      cwd: ctx.cwd,
      level: 'none',
      path: ctx.roots.sibling,
    });

    const launch = buildLaunchRights(
      ctx.registry.loadWorkdirRights(ctx.cwd),
      opts(ctx),
    );
    assert.equal(launch.foreignRoots.length, 0);
    const { permissions } = expressLaunchRights(launch);
    assert.equal(
      findEffect(permissions, 'external_directory', `${ctx.roots.sibling}/*`),
      'ask',
    );
    ctx.registry.close();
  });

  void it('write:.onto/**: запись закрыта, чтение не full-deny', () => {
    const ctx = setupTree(temps);
    ctx.registry.insertDeny({ cwd: ctx.cwd, pattern: 'write:.onto/**' });

    const launch = buildLaunchRights(
      ctx.registry.loadWorkdirRights(ctx.cwd),
      opts(ctx),
    );
    const { permissions } = expressLaunchRights(launch);
    const ontoFile = `${ctx.cwd}/.onto/note.md`;

    assert.equal(findEffect(permissions, 'edit', ontoFile), 'deny');
    assert.notEqual(findEffect(permissions, 'read', ontoFile), 'deny');
    ctx.registry.close();
  });

  void it('read:**/.env* — чтение закрыто', () => {
    const ctx = setupTree(temps);
    ctx.registry.insertDenyGlobal({ pattern: 'read:**/.env*' });

    const launch = buildLaunchRights(
      ctx.registry.loadWorkdirRights(ctx.cwd),
      opts(ctx),
    );
    const { permissions } = expressLaunchRights(launch);

    assert.equal(findEffect(permissions, 'read', `${ctx.cwd}/.env`), 'deny');
    assert.equal(
      findEffect(permissions, 'read', `${ctx.cwd}/nested/.env.local`),
      'deny',
    );
    ctx.registry.close();
  });

  void it('относительный read:**/.env* действует на grant-корень вне cwd', () => {
    const ctx = setupTree(temps);
    ctx.registry.upsertGrant({
      cwd: ctx.cwd,
      level: 'rw',
      path: ctx.roots.dev,
    });
    ctx.registry.insertDenyGlobal({ pattern: 'read:**/.env*' });

    const launch = buildLaunchRights(
      ctx.registry.loadWorkdirRights(ctx.cwd),
      opts(ctx),
    );
    const { permissions } = expressLaunchRights(launch);
    const envUnderGrant = `${ctx.roots.dev}/pkg/.env`;

    assert.equal(findEffect(permissions, 'read', envUnderGrant), 'deny');
    assert.equal(
      findEffect(permissions, 'external_directory', `${ctx.roots.dev}/*`),
      'allow',
    );
    ctx.registry.close();
  });

  void it('write:**/.env* + write:!**/.env.example — example не закрыт', () => {
    const ctx = setupTree(temps);
    ctx.registry.insertDenyGlobal({ pattern: 'write:**/.env*' });
    ctx.registry.insertDenyGlobal({ pattern: 'write:!**/.env.example' });

    const launch = buildLaunchRights(
      ctx.registry.loadWorkdirRights(ctx.cwd),
      opts(ctx),
    );
    const { permissions } = expressLaunchRights(launch);

    assert.equal(findEffect(permissions, 'edit', `${ctx.cwd}/.env`), 'deny');
    assert.equal(
      findEffect(permissions, 'edit', `${ctx.cwd}/.env.local`),
      'deny',
    );
    assert.notEqual(
      findEffect(permissions, 'edit', `${ctx.cwd}/.env.example`),
      'deny',
    );
    // не allow-all: широкий allow на * для edit отсутствует
    assert.ok(
      !permissions.some(
        (rule) =>
          rule.action === 'edit' &&
          rule.resource === '*' &&
          rule.effect === 'allow',
      ),
    );
    ctx.registry.close();
  });

  void it('write:! внутри write:.onto/** — no-op, edit остаётся deny', () => {
    const ctx = setupTree(temps);
    mkdirSync(join(ctx.cwd, '.onto'));
    writeFileSync(join(ctx.cwd, '.onto', 'keep.txt'), 'k');
    ctx.registry.insertDeny({ cwd: ctx.cwd, pattern: 'write:.onto/**' });
    ctx.registry.insertDeny({ cwd: ctx.cwd, pattern: 'write:!.onto/keep.txt' });

    const launch = buildLaunchRights(
      ctx.registry.loadWorkdirRights(ctx.cwd),
      opts(ctx),
    );
    const { permissions } = expressLaunchRights(launch);
    const keep = `${ctx.cwd}/.onto/keep.txt`;

    assert.equal(findEffect(permissions, 'edit', keep), 'deny');
    assert.notEqual(findEffect(permissions, 'read', keep), 'deny');
    ctx.registry.close();
  });

  void it('write:! не открывает edit при активном read-deny', () => {
    const ctx = setupTree(temps);
    ctx.registry.insertDenyGlobal({ pattern: 'read:**/.env*' });
    ctx.registry.insertDenyGlobal({ pattern: 'write:!**/.env.example' });

    const launch = buildLaunchRights(
      ctx.registry.loadWorkdirRights(ctx.cwd),
      opts(ctx),
    );
    const { permissions } = expressLaunchRights(launch);
    const example = `${ctx.cwd}/.env.example`;

    assert.equal(findEffect(permissions, 'read', example), 'deny');
    assert.equal(findEffect(permissions, 'edit', example), 'deny');
    ctx.registry.close();
  });

  void it('read:! не открывает edit при активном write-deny', () => {
    const ctx = setupTree(temps);
    ctx.registry.insertDenyGlobal({ pattern: 'write:**/.env*' });
    ctx.registry.insertDenyGlobal({ pattern: 'read:!**/.env.example' });

    const launch = buildLaunchRights(
      ctx.registry.loadWorkdirRights(ctx.cwd),
      opts(ctx),
    );
    const { permissions } = expressLaunchRights(launch);
    const example = `${ctx.cwd}/.env.example`;

    assert.equal(findEffect(permissions, 'edit', example), 'deny');
    assert.notEqual(findEffect(permissions, 'read', example), 'deny');
    ctx.registry.close();
  });

  void it('write+read ordinary + оба ! → edit не deny (домен rw)', () => {
    const ctx = setupTree(temps);
    writeFileSync(join(ctx.cwd, '.env.example'), 'ok');
    ctx.registry.insertDenyGlobal({ pattern: 'write:**/.env*' });
    ctx.registry.insertDenyGlobal({ pattern: 'write:!**/.env.example' });
    ctx.registry.insertDenyGlobal({ pattern: 'read:**/.env*' });
    ctx.registry.insertDenyGlobal({ pattern: 'read:!**/.env.example' });

    const snap = ctx.registry.loadWorkdirRights(ctx.cwd);
    const example = join(ctx.cwd, '.env.example');
    assert.equal(
      resolvePathAccess(ctx.cwd, example, snap, opts(ctx)).level,
      'rw',
    );

    const { permissions } = expressLaunchRights(
      buildLaunchRights(snap, opts(ctx)),
    );
    assert.notEqual(findEffect(permissions, 'read', example), 'deny');
    assert.notEqual(findEffect(permissions, 'edit', example), 'deny');
    ctx.registry.close();
  });

  void it('константные пути реестра → deny read+edit', () => {
    const ctx = setupTree(temps);
    const launch = buildLaunchRights(
      ctx.registry.loadWorkdirRights(ctx.cwd),
      opts(ctx),
    );
    const { permissions } = expressLaunchRights(launch);

    assert.ok(launch.registryDenyPaths.includes(ctx.dbPath));
    for (const path of launch.registryDenyPaths) {
      assert.equal(findEffect(permissions, 'read', path), 'deny');
      assert.equal(findEffect(permissions, 'edit', path), 'deny');
    }
    ctx.registry.close();
  });

  void it('shell выключен в результирующем конфиге', () => {
    const ctx = setupTree(temps);
    const launch = buildLaunchRights(
      ctx.registry.loadWorkdirRights(ctx.cwd),
      opts(ctx),
    );
    const { permissions } = expressLaunchRights(launch);
    assert.equal(findEffect(permissions, 'shell', 'ls -la'), 'deny');
    assert.equal(findEffect(permissions, 'shell', 'git status'), 'deny');
    ctx.registry.close();
  });

  void it('невалидный снимок — ошибка, не best-effort', () => {
    const bad: LaunchRights = {
      cwd: '/tmp/proj',
      denyPatterns: [],
      foreignRoots: [{ level: 'none', path: '/tmp/x' }],
      ownRoot: { level: 'rw', path: '/tmp/proj' },
      registryDenyPaths: [],
      shellEnabled: false,
    };
    assert.throws(() => expressLaunchRights(bad), OpenCodeExpressError);

    const badShell: LaunchRights = {
      cwd: '/tmp/proj',
      denyPatterns: [],
      foreignRoots: [],
      ownRoot: { level: 'rw', path: '/tmp/proj' },
      registryDenyPaths: [],
      shellEnabled: false,
    };
    // подмена поля вне типа
    const broken = {
      ...badShell,
      shellEnabled: true as unknown as false,
    };
    assert.throws(() => expressLaunchRights(broken), OpenCodeExpressError);
  });

  void it('адаптер не дописывает рекомендуемые deny_global пути', () => {
    const ctx = setupTree(temps);
    writeFileSync(join(ctx.cwd, 'AGENTS.md'), 'x');
    const launch = buildLaunchRights(
      ctx.registry.loadWorkdirRights(ctx.cwd),
      opts(ctx),
    );
    assert.ok(!launch.denyPatterns.some((p) => p.includes('AGENTS.md')));
    const { permissions } = expressLaunchRights(launch);
    assert.ok(
      !permissions.some(
        (rule) => rule.effect === 'deny' && rule.resource.includes('AGENTS.md'),
      ),
    );
    ctx.registry.close();
  });
});

type Ctx = {
  cwd: string;
  dbPath: string;
  registry: Registry;
  root: string;
  roots: {
    dev: string;
    sibling: string;
  };
};

function findEffect(
  rules: readonly OpenCodePermissionRule[],
  action: string,
  resource: string,
) {
  let effect: null | OpenCodePermissionRule['effect'] = null;
  for (const rule of rules) {
    if (rule.action !== action && rule.action !== '*') {
      continue;
    }
    if (matchesWildcard(rule.resource, resource)) {
      effect = rule.effect;
    }
  }
  return effect;
}

function makeTempDir(temps: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'sherpa-oc-'));
  temps.push(dir);
  return dir;
}

function matchesWildcard(pattern: string, value: string) {
  let pi = 0;
  let vi = 0;
  let starPi = -1;
  let starVi = -1;
  while (vi < value.length) {
    if (
      pi < pattern.length &&
      (pattern[pi] === '?' || pattern[pi] === value[vi])
    ) {
      pi += 1;
      vi += 1;
      continue;
    }
    if (pi < pattern.length && pattern[pi] === '*') {
      starPi = pi;
      starVi = vi;
      pi += 1;
      continue;
    }
    if (starPi !== -1) {
      pi = starPi + 1;
      starVi += 1;
      vi = starVi;
      continue;
    }
    return false;
  }
  while (pi < pattern.length && pattern[pi] === '*') {
    pi += 1;
  }
  return pi === pattern.length;
}

function opts(ctx: Ctx) {
  return { registryPath: ctx.dbPath };
}

function setupTree(temps: string[]): Ctx {
  const root = makeTempDir(temps);
  const project = join(root, 'project');
  const sibling = join(root, 'sibling');
  const dev = join(root, 'dev');
  for (const dir of [project, sibling, dev]) {
    mkdirSync(dir, { recursive: true });
  }

  const dbPath = join(project, 'registry.sqlite');
  const registry = openRegistry({ path: dbPath });
  const seeded = registry.seedWorkdirPlace({
    cwd: project,
    description: 'test',
    name: `n-${temps.length}`,
    placeKey: `p-${temps.length}-${Date.now()}`,
  });

  return {
    cwd: seeded.cwd,
    dbPath: normalizeWorkdirPath(dbPath),
    registry,
    root: normalizeWorkdirPath(root),
    roots: {
      dev: normalizeWorkdirPath(dev),
      sibling: normalizeWorkdirPath(sibling),
    },
  };
}
