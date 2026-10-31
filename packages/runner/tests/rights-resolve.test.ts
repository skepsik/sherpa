import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import type { Registry, WorkdirRights } from '../src/types/registry';

import { normalizeWorkdirPath, openRegistry } from '../src/registry';
import {
  buildLaunchRights,
  resolvePathAccess,
  RightsConfigError,
} from '../src/rights';

void describe('rights resolve', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  void it('самый глубокий предок среди grant', () => {
    const ctx = setupTree(temps);
    const { cwd, registry, roots } = ctx;
    const shallow = roots.dev;
    const deep = roots.lib;
    registry.upsertGrant({ cwd, level: 'ro', path: shallow });
    registry.upsertGrant({ cwd, level: 'append', path: deep });

    const snap = registry.loadWorkdirRights(cwd);
    const file = join(deep, 'a.ts');
    writeFileSync(file, 'x');

    assert.equal(resolvePathAccess(cwd, file, snap, opts(ctx)).level, 'append');
    assert.equal(
      resolvePathAccess(cwd, join(shallow, 'other.txt'), snap, opts(ctx)).level,
      'ro',
    );
    registry.close();
  });

  void it('граница сегмента holt vs holt-old; хвостовой / после нормализации', () => {
    const ctx = setupTree(temps);
    const { cwd, registry, roots } = ctx;
    registry.upsertGrant({ cwd, level: 'rw', path: `${roots.holt}/` });

    const snap = registry.loadWorkdirRights(cwd);
    assert.equal(snap.grants[0]?.path, roots.holt);

    assert.equal(
      resolvePathAccess(cwd, join(roots.holt, 'f'), snap, opts(ctx)).level,
      'rw',
    );
    assert.equal(
      resolvePathAccess(cwd, join(roots.holtOld, 'f'), snap, opts(ctx)).level,
      'none',
    );
    registry.close();
  });

  void it('deny / deny_global сильнее grant и сильнее своего cwd', () => {
    const ctx = setupTree(temps);
    const { cwd, registry, roots } = ctx;
    registry.upsertGrant({ cwd, level: 'rw', path: roots.dev });
    registry.insertDeny({ cwd, pattern: 'read:**/secret.txt' });
    registry.insertDenyGlobal({ pattern: 'write:**/.onto/**' });

    const snap = registry.loadWorkdirRights(cwd);
    const secretInCwd = join(cwd, 'secret.txt');
    writeFileSync(secretInCwd, 'no');
    const ontoInGrant = join(roots.dev, '.onto', 'x');
    mkdirSync(join(roots.dev, '.onto'));
    writeFileSync(ontoInGrant, 'y');

    assert.equal(
      resolvePathAccess(cwd, secretInCwd, snap, opts(ctx)).level,
      'none',
    );
    assert.equal(
      resolvePathAccess(cwd, ontoInGrant, snap, opts(ctx)).level,
      'ro',
    );
    assert.equal(
      resolvePathAccess(cwd, join(cwd, 'ok.txt'), snap, opts(ctx)).level,
      'rw',
    );
    registry.close();
  });

  void it('grant на предка cwd не действует внутри cwd', () => {
    const ctx = setupTree(temps);
    const { cwd, registry, root, roots } = ctx;
    registry.upsertGrant({ cwd, level: 'ro', path: root });

    const snap = registry.loadWorkdirRights(cwd);
    const inside = join(cwd, 'file.txt');
    writeFileSync(inside, '1');
    const outsideSibling = join(roots.sibling, 'f.txt');
    writeFileSync(outsideSibling, '2');

    assert.equal(resolvePathAccess(cwd, inside, snap, opts(ctx)).level, 'rw');
    assert.equal(
      resolvePathAccess(cwd, outsideSibling, snap, opts(ctx)).level,
      'ro',
    );
    registry.close();
  });

  void it('.. и симлинк наружу не расширяют доступ', () => {
    const ctx = setupTree(temps);
    const { cwd, registry, roots } = ctx;
    registry.upsertGrant({ cwd, level: 'ro', path: roots.lib });

    const snap = registry.loadWorkdirRights(cwd);
    const viaDots = join(cwd, '..', 'sibling', 'f.txt');
    writeFileSync(join(roots.sibling, 'f.txt'), 'x');

    assert.equal(
      resolvePathAccess(cwd, viaDots, snap, opts(ctx)).level,
      'none',
    );

    const link = join(cwd, 'out-link');
    symlinkSync(roots.sibling, link);
    assert.equal(
      resolvePathAccess(cwd, join(link, 'f.txt'), snap, opts(ctx)).level,
      'none',
    );

    // несуществующий путь через symlink-каталог под cwd → снаружи, не rw
    const createOutside = join(link, 'brand-new.txt');
    assert.equal(
      resolvePathAccess(cwd, createOutside, snap, opts(ctx)).level,
      'none',
    );
    registry.close();
  });

  void it('cwd ≠ snapshot.cwd — отказ', () => {
    const ctx = setupTree(temps);
    const { cwd, registry } = ctx;
    const snap = registry.loadWorkdirRights(cwd);
    assert.throws(
      () =>
        resolvePathAccess('/tmp/other-cwd', join(cwd, 'x'), snap, opts(ctx)),
      /не совпадает со snapshot\.cwd/,
    );
    registry.close();
  });

  void it('константный запрет: db и sidecar поверх grant / своего cwd', () => {
    const ctx = setupTree(temps);
    const { cwd, dbPath, registry } = ctx;
    writeFileSync(`${dbPath}-wal`, '');
    writeFileSync(`${dbPath}-shm`, '');
    writeFileSync(`${dbPath}-journal`, '');

    // реестр лежит внутри cwd (типичный data/)
    const snap = registry.loadWorkdirRights(cwd);
    for (const path of [
      dbPath,
      `${dbPath}-wal`,
      `${dbPath}-shm`,
      `${dbPath}-journal`,
    ]) {
      assert.equal(
        resolvePathAccess(cwd, path, snap, opts(ctx)).level,
        'none',
        path,
      );
    }
    registry.close();
  });

  void it('вердикт одинаков при разном порядке deny vs deny_global', () => {
    const ctx = setupTree(temps);
    const { cwd, registry } = ctx;
    const file = join(cwd, 'a.env');
    writeFileSync(file, 'x');

    registry.insertDeny({ cwd, pattern: 'read:**/*.env' });
    registry.insertDenyGlobal({ pattern: 'write:**/*.env' });
    const snapA = registry.loadWorkdirRights(cwd);
    const levelA = resolvePathAccess(cwd, file, snapA, opts(ctx)).level;

    // новый реестр с обратным порядком insert
    registry.close();
    const ctx2 = setupTree(temps);
    ctx2.registry.insertDenyGlobal({ pattern: 'write:**/*.env' });
    ctx2.registry.insertDeny({
      cwd: ctx2.cwd,
      pattern: 'read:**/*.env',
    });
    writeFileSync(join(ctx2.cwd, 'a.env'), 'x');
    const snapB = ctx2.registry.loadWorkdirRights(ctx2.cwd);
    const levelB = resolvePathAccess(
      ctx2.cwd,
      join(ctx2.cwd, 'a.env'),
      snapB,
      opts(ctx2),
    ).level;

    assert.equal(levelA, 'none');
    assert.equal(levelB, levelA);
    ctx2.registry.close();
  });

  void it('!: свой префикс; no-op внутри целого каталога; не снимает registry', () => {
    const ctx = setupTree(temps);
    const { cwd, dbPath, registry, roots } = ctx;
    registry.upsertGrant({ cwd, level: 'rw', path: roots.dev });
    registry.insertDenyGlobal({ pattern: 'read:**/.env*' });
    registry.insertDenyGlobal({ pattern: 'read:!**/.env.example' });
    registry.insertDeny({ cwd, pattern: 'write:.onto/**' });
    registry.insertDeny({ cwd, pattern: 'write:!.onto/keep.txt' });

    const snap = registry.loadWorkdirRights(cwd);
    const envBad = join(cwd, '.env');
    const envOk = join(cwd, '.env.example');
    writeFileSync(envBad, 's');
    writeFileSync(envOk, 'ok');
    mkdirSync(join(cwd, '.onto'));
    writeFileSync(join(cwd, '.onto', 'keep.txt'), 'k');

    assert.equal(resolvePathAccess(cwd, envBad, snap, opts(ctx)).level, 'none');
    assert.equal(resolvePathAccess(cwd, envOk, snap, opts(ctx)).level, 'rw');
    // write:! внутри write:.onto/** — no-op; чтение (cwd) остаётся, запись нет → ro
    assert.equal(
      resolvePathAccess(cwd, join(cwd, '.onto', 'keep.txt'), snap, opts(ctx))
        .level,
      'ro',
    );

    // ! не снимает константный запрет
    registry.insertDenyGlobal({ pattern: `read:!//${dbPath}` });
    const snap2 = registry.loadWorkdirRights(cwd);
    assert.equal(
      resolvePathAccess(cwd, dbPath, snap2, opts(ctx)).level,
      'none',
    );

    // write:! не открывает путь, закрытый только read:
    assert.equal(
      resolvePathAccess(cwd, envBad, snap2, opts(ctx)).level,
      'none',
    );
    registry.close();
  });

  void it('относительный deny_global закрывает путь под чужим grant-корнем', () => {
    const ctx = setupTree(temps);
    const { cwd, registry, roots } = ctx;
    registry.upsertGrant({ cwd, level: 'rw', path: roots.dev });
    registry.insertDenyGlobal({ pattern: 'read:**/.env*' });

    const snap = registry.loadWorkdirRights(cwd);
    const envUnderGrant = join(roots.dev, '.env.local');
    writeFileSync(envUnderGrant, 'x');

    assert.equal(
      resolvePathAccess(cwd, envUnderGrant, snap, opts(ctx)).level,
      'none',
    );
    registry.close();
  });

  void it('grant внутри закрытого запретом префикса — отказ; ! no-op — не отказ', () => {
    const ctx = setupTree(temps);
    const { cwd, registry, roots } = ctx;
    mkdirSync(join(roots.dev, 'closed', 'hole'), { recursive: true });
    registry.insertDenyGlobal({ pattern: `read://${roots.dev}/closed/**` });
    registry.upsertGrant({
      cwd,
      level: 'ro',
      path: join(roots.dev, 'closed', 'hole'),
    });

    const snap = registry.loadWorkdirRights(cwd);
    assert.throws(
      () => buildLaunchRights(snap, opts(ctx)),
      (err: unknown) =>
        err instanceof RightsConfigError &&
        err.code === 'rights_config_invalid',
    );

    // write-only закрытие каталога + grant внутри — не отказ конфигурации
    registry.close();
    const ctxWrite = setupTree(temps);
    mkdirSync(join(ctxWrite.roots.dev, 'wclosed', 'hole'), {
      recursive: true,
    });
    ctxWrite.registry.insertDenyGlobal({
      pattern: `write://${ctxWrite.roots.dev}/wclosed/**`,
    });
    ctxWrite.registry.upsertGrant({
      cwd: ctxWrite.cwd,
      level: 'ro',
      path: join(ctxWrite.roots.dev, 'wclosed', 'hole'),
    });
    const snapWrite = ctxWrite.registry.loadWorkdirRights(ctxWrite.cwd);
    const launchWrite = buildLaunchRights(snapWrite, opts(ctxWrite));
    assert.equal(launchWrite.foreignRoots.length, 1);
    ctxWrite.registry.close();

    // ! no-op внутри закрытого каталога — не отказ конфигурации
    const ctx2 = setupTree(temps);
    mkdirSync(join(ctx2.cwd, '.onto'));
    ctx2.registry.insertDeny({ cwd: ctx2.cwd, pattern: 'write:.onto/**' });
    ctx2.registry.insertDeny({
      cwd: ctx2.cwd,
      pattern: 'write:!.onto/x.txt',
    });
    writeFileSync(join(ctx2.cwd, '.onto', 'x.txt'), '1');
    const snap2 = ctx2.registry.loadWorkdirRights(ctx2.cwd);
    const launch = buildLaunchRights(snap2, opts(ctx2));
    assert.equal(launch.shellEnabled, false);
    assert.equal(launch.ownRoot.path, ctx2.cwd);
    assert.deepEqual(launch.foreignRoots, []);
    ctx2.registry.close();
  });

  void it('повторный resolve после смены строк в БД без кэша процесса', () => {
    const ctx = setupTree(temps);
    const { cwd, registry, roots } = ctx;
    registry.upsertGrant({ cwd, level: 'ro', path: roots.dev });
    const file = join(roots.dev, 'f.txt');
    writeFileSync(file, '1');

    const first = registry.loadWorkdirRights(cwd);
    assert.equal(resolvePathAccess(cwd, file, first, opts(ctx)).level, 'ro');

    registry.upsertGrant({ cwd, level: 'rw', path: roots.dev });
    registry.insertDenyGlobal({ pattern: `read://${file}` });
    const second = registry.loadWorkdirRights(cwd);
    assert.equal(resolvePathAccess(cwd, file, second, opts(ctx)).level, 'none');
    registry.close();
  });

  void it('плоский снимок: корни, объединение deny, shell выкл', () => {
    const ctx = setupTree(temps);
    const { cwd, dbPath, registry, roots } = ctx;
    registry.upsertGrant({ cwd, level: 'none', path: roots.holt });
    registry.upsertGrant({ cwd, level: 'append', path: roots.lib });
    registry.insertDeny({ cwd, pattern: 'write:.onto/**' });
    registry.insertDenyGlobal({ pattern: 'read:**/.env*' });

    const snap = registry.loadWorkdirRights(cwd);
    const launch = buildLaunchRights(snap, opts(ctx));

    assert.equal(launch.cwd, cwd);
    assert.equal(launch.ownRoot.level, 'rw');
    assert.equal(launch.shellEnabled, false);
    assert.deepEqual(launch.foreignRoots, [
      { level: 'append', path: roots.lib },
    ]);
    assert.ok(launch.denyPatterns.includes('write:.onto/**'));
    assert.ok(launch.denyPatterns.includes('read:**/.env*'));
    assert.ok(launch.registryDenyPaths.includes(dbPath));
    assert.ok(launch.registryDenyPaths.includes(`${dbPath}-wal`));
    registry.close();
  });

  void it('симлинк: deny по requested или real; grant только оба', () => {
    const ctx = setupTree(temps);
    const { cwd, registry, roots } = ctx;
    registry.upsertGrant({ cwd, level: 'rw', path: roots.lib });
    const target = join(roots.lib, 'real.txt');
    writeFileSync(target, '1');
    const linkOutside = join(roots.sibling, 'alias.txt');
    symlinkSync(target, linkOutside);

    // deny на real-путь срабатывает и через чужой symlink-requested
    registry.insertDenyGlobal({ pattern: `read://${target}` });
    const snap = registry.loadWorkdirRights(cwd);
    assert.equal(
      resolvePathAccess(cwd, linkOutside, snap, opts(ctx)).level,
      'none',
    );

    // grant: link снаружи cwd на файл под grant — requested не под grant
    registry.close();
    const ctx2 = setupTree(temps);
    ctx2.registry.upsertGrant({
      cwd: ctx2.cwd,
      level: 'rw',
      path: ctx2.roots.lib,
    });
    const real2 = join(ctx2.roots.lib, 'ok.txt');
    writeFileSync(real2, '1');
    const link2 = join(ctx2.roots.sibling, 'to-ok.txt');
    symlinkSync(real2, link2);
    const snap2 = ctx2.registry.loadWorkdirRights(ctx2.cwd);
    assert.equal(
      resolvePathAccess(ctx2.cwd, link2, snap2, opts(ctx2)).level,
      'none',
    );
    assert.equal(
      resolvePathAccess(ctx2.cwd, real2, snap2, opts(ctx2)).level,
      'rw',
    );
    ctx2.registry.close();
  });
});

type Ctx = {
  cwd: string;
  dbPath: string;
  registry: Registry;
  root: string;
  roots: {
    dev: string;
    holt: string;
    holtOld: string;
    lib: string;
    sibling: string;
  };
};

function makeTempDir(temps: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'sherpa-rights-'));
  temps.push(dir);
  return dir;
}

function opts(ctx: Ctx) {
  return { registryPath: ctx.dbPath };
}

function setupTree(temps: string[]): Ctx {
  const root = makeTempDir(temps);
  const project = join(root, 'project');
  const sibling = join(root, 'sibling');
  const dev = join(root, 'dev');
  const lib = join(dev, 'lib');
  const holt = join(root, 'holt');
  const holtOld = join(root, 'holt-old');
  for (const dir of [project, sibling, lib, holt, holtOld, dev]) {
    mkdirSync(dir, { recursive: true });
  }

  // реестр внутри project → константный запрет пересекается с cwd
  const dbPath = join(project, 'registry.sqlite');
  const registry = openRegistry({ path: dbPath });
  const seeded = registry.seedWorkdirPlace({
    cwd: project,
    description: 'test',
    name: `n-${temps.length}`,
    placeKey: `p-${temps.length}-${Date.now()}`,
  });
  const cwd = seeded.cwd;
  assert.equal(cwd, normalizeWorkdirPath(project));

  return {
    cwd,
    dbPath: normalizeWorkdirPath(dbPath),
    registry,
    root: normalizeWorkdirPath(root),
    roots: {
      dev: normalizeWorkdirPath(dev),
      holt: normalizeWorkdirPath(holt),
      holtOld: normalizeWorkdirPath(holtOld),
      lib: normalizeWorkdirPath(lib),
      sibling: normalizeWorkdirPath(sibling),
    },
  };
}

/** Явная сверка формы WorkdirRights для typecheck потребителей. */
void describe('rights types smoke', () => {
  void it('PathAccess / LaunchRights поля', () => {
    const rights: WorkdirRights = {
      cwd: '/tmp/x',
      denies: [],
      denyGlobals: [],
      grants: [],
    };
    assert.equal(rights.grants.length, 0);
  });
});
