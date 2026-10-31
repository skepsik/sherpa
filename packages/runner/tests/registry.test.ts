import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, it } from 'node:test';

import { loadRegistryConfig } from '../src/config';
import {
  DenyPatternError,
  normalizeWorkdirPath,
  openRegistry,
  validateDenyPattern,
  WorkdirNotFoundError,
} from '../src/registry';

void describe('registry', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  void it('loadRegistryConfig: обязателен SHERPA_REGISTRY_PATH', () => {
    assert.throws(() => loadRegistryConfig({}), /SHERPA_REGISTRY_PATH/);
    assert.deepEqual(
      loadRegistryConfig({ SHERPA_REGISTRY_PATH: 'data/registry.sqlite' }),
      { path: 'data/registry.sqlite' },
    );
  });

  void it('пустое хранилище: схема workdirs/places/roles/grant/deny/deny_global', () => {
    const { dbPath, registry } = openTempRegistry(temps);
    registry.close();

    const db = new DatabaseSync(dbPath);
    const names = (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name);

    assert.deepEqual(
      names.filter(
        (n) =>
          n === 'deny' ||
          n === 'deny_global' ||
          n === 'grant' ||
          n === 'places' ||
          n === 'roles' ||
          n === 'workdirs',
      ),
      ['deny', 'deny_global', 'grant', 'places', 'roles', 'workdirs'],
    );
    db.close();
  });

  void it('миграции идемпотентны при повторном open', () => {
    const { dbPath, registry } = openTempRegistry(temps);
    registry.close();
    const again = openRegistry({ path: dbPath });
    again.close();
  });

  void it('seed: workdir + place; lookup по key; нет ключа — null', () => {
    const root = makeTempDir(temps);
    const workdirPath = join(root, 'project');
    mkdirSync(workdirPath);

    const { registry } = openTempRegistry(temps);
    const seeded = registry.seedWorkdirPlace({
      cwd: workdirPath,
      description: 'когда сюда',
      name: 'demo',
      placeKey: 'place-opaque-1',
    });

    assert.equal(seeded.cwd, normalizeWorkdirPath(workdirPath));
    assert.equal(seeded.placeKey, 'place-opaque-1');
    assert.equal(registry.findCwdByPlaceKey('place-opaque-1'), seeded.cwd);
    assert.equal(registry.findCwdByPlaceKey('missing'), null);

    registry.close();
  });

  void it('cwd: литерал с .. нормализуется к realpath', () => {
    const root = makeTempDir(temps);
    const workdirPath = join(root, 'real-project');
    mkdirSync(workdirPath);
    // строка с сегментом `..` (path.join схлопнул бы до входа в API)
    const withDots = `${root}/x/../real-project`;
    assert.ok(withDots.includes('..'));

    const { registry } = openTempRegistry(temps);
    const seeded = registry.seedWorkdirPlace({
      cwd: withDots,
      description: 'd',
      name: 'n-dots',
      placeKey: 'p-dots',
    });

    assert.equal(seeded.cwd, resolve(workdirPath));
    assert.equal(seeded.cwd.includes('..'), false);
    registry.close();
  });

  void it('cwd: относительный путь нормализуется к realpath', () => {
    const root = makeTempDir(temps);
    const workdirPath = join(root, 'rel-project');
    mkdirSync(workdirPath);
    const relativeCwd = relative(process.cwd(), workdirPath);
    assert.ok(!isAbsolute(relativeCwd));

    const { registry } = openTempRegistry(temps);
    const seeded = registry.seedWorkdirPlace({
      cwd: relativeCwd,
      description: 'd',
      name: 'n-rel',
      placeKey: 'p-rel',
    });

    assert.equal(seeded.cwd, resolve(workdirPath));
    assert.ok(isAbsolute(seeded.cwd));
    registry.close();
  });

  void it('places.key: пустой или whitespace — отказ insert и seed', () => {
    const root = makeTempDir(temps);
    const workdirPath = join(root, 'project');
    const seedPath = join(root, 'seed-project');
    mkdirSync(workdirPath);
    mkdirSync(seedPath);

    const { registry } = openTempRegistry(temps);
    registry.insertWorkdir({
      cwd: workdirPath,
      description: 'd',
      name: 'n',
    });

    assert.throws(
      () => registry.insertPlace({ cwd: workdirPath, key: '' }),
      /places\.key/,
    );
    assert.throws(
      () => registry.insertPlace({ cwd: workdirPath, key: 'has space' }),
      /places\.key/,
    );
    assert.throws(
      () =>
        registry.seedWorkdirPlace({
          cwd: seedPath,
          description: 'd',
          name: 'seed-n',
          placeKey: '\t',
        }),
      /places\.key/,
    );
    registry.close();
  });

  void it('cwd: несуществующий путь — отказ', () => {
    const { registry } = openTempRegistry(temps);
    assert.throws(
      () =>
        registry.insertWorkdir({
          cwd: join(makeTempDir(temps), 'no-such'),
          description: 'd',
          name: 'n',
        }),
      /не существует/,
    );
    registry.close();
  });

  void it('UNIQUE(places.cwd): второе place на тот же cwd — отказ', () => {
    const root = makeTempDir(temps);
    const workdirPath = join(root, 'project');
    mkdirSync(workdirPath);

    const { registry } = openTempRegistry(temps);
    registry.seedWorkdirPlace({
      cwd: workdirPath,
      description: 'd',
      name: 'n',
      placeKey: 'place-a',
    });

    assert.throws(
      () =>
        registry.insertPlace({
          cwd: workdirPath,
          key: 'place-b',
        }),
      /UNIQUE|constraint/i,
    );
    registry.close();
  });

  void it('FK ON DELETE CASCADE: удаление workdir убирает place', () => {
    const root = makeTempDir(temps);
    const workdirPath = join(root, 'project');
    mkdirSync(workdirPath);

    const { dbPath, registry } = openTempRegistry(temps);
    const { cwd } = registry.seedWorkdirPlace({
      cwd: workdirPath,
      description: 'd',
      name: 'n',
      placeKey: 'place-cascade-del',
    });
    registry.close();

    const db = openSqliteWithFk(dbPath);
    db.prepare(`DELETE FROM workdirs WHERE cwd = ?`).run(cwd);
    const left = db
      .prepare(`SELECT COUNT(*) AS n FROM places WHERE key = ?`)
      .get('place-cascade-del') as { n: number };
    assert.equal(left.n, 0);
    db.close();
  });

  void it('FK ON UPDATE CASCADE: смена workdirs.cwd обновляет places.cwd', () => {
    const root = makeTempDir(temps);
    const workdirPath = join(root, 'project');
    const renamedPath = join(root, 'renamed');
    mkdirSync(workdirPath);
    mkdirSync(renamedPath);

    const { dbPath, registry } = openTempRegistry(temps);
    const { cwd } = registry.seedWorkdirPlace({
      cwd: workdirPath,
      description: 'd',
      name: 'n',
      placeKey: 'place-cascade-upd',
    });
    registry.close();

    const newCwd = normalizeWorkdirPath(renamedPath);
    const db = openSqliteWithFk(dbPath);
    db.prepare(`UPDATE workdirs SET cwd = ? WHERE cwd = ?`).run(newCwd, cwd);
    const row = db
      .prepare(`SELECT cwd FROM places WHERE key = ?`)
      .get('place-cascade-upd') as { cwd: string };
    assert.equal(row.cwd, newCwd);
    db.close();
  });

  void it('grant: upsert с нормализацией path; level none; плохой level — отказ', () => {
    const root = makeTempDir(temps);
    const workdirPath = join(root, 'project');
    const targetPath = join(root, 'shared');
    mkdirSync(workdirPath);
    mkdirSync(targetPath);

    const { registry } = openTempRegistry(temps);
    const { cwd } = registry.seedWorkdirPlace({
      cwd: workdirPath,
      description: 'd',
      name: 'n-grant',
      placeKey: 'p-grant',
    });

    const first = registry.upsertGrant({
      cwd,
      level: 'ro',
      path: `${root}/x/../shared`,
    });
    assert.equal(first.path, resolve(targetPath));
    assert.equal(first.path.includes('..'), false);
    assert.equal(first.level, 'ro');

    const lowered = registry.upsertGrant({
      cwd,
      level: 'none',
      path: targetPath,
    });
    assert.equal(lowered.level, 'none');

    const rights = registry.loadWorkdirRights(cwd);
    assert.equal(rights.grants.length, 1);
    assert.equal(rights.grants[0]?.level, 'none');

    assert.throws(
      () =>
        registry.upsertGrant({
          cwd,
          level: 'write' as 'rw',
          path: targetPath,
        }),
      /grant\.level/,
    );
    registry.close();
  });

  void it('grant.level CHECK: сырой INSERT плохого level — отказ', () => {
    const root = makeTempDir(temps);
    const workdirPath = join(root, 'project');
    mkdirSync(workdirPath);

    const { dbPath, registry } = openTempRegistry(temps);
    const { cwd } = registry.seedWorkdirPlace({
      cwd: workdirPath,
      description: 'd',
      name: 'n-check',
      placeKey: 'p-check',
    });
    registry.close();

    const db = openSqliteWithFk(dbPath);
    assert.throws(
      () =>
        db
          .prepare(`INSERT INTO "grant" (cwd, path, level) VALUES (?, ?, ?)`)
          .run(cwd, cwd, 'full'),
      /CHECK|constraint/i,
    );
    db.close();
  });

  void it('deny / deny_global: валидный insert; мусор — DenyPatternError', () => {
    const root = makeTempDir(temps);
    const workdirPath = join(root, 'project');
    mkdirSync(workdirPath);

    const { registry } = openTempRegistry(temps);
    const { cwd } = registry.seedWorkdirPlace({
      cwd: workdirPath,
      description: 'd',
      name: 'n-deny',
      placeKey: 'p-deny',
    });

    const okPatterns = [
      'write:.onto/**',
      'read:**/.env*',
      'write:!**/.env.example',
      '//absolute/secret/**',
      '.claude/',
    ];
    for (const pattern of okPatterns) {
      registry.insertDenyGlobal({ pattern });
    }
    registry.insertDeny({ cwd, pattern: 'write:.onto/**' });

    assert.throws(
      () => registry.insertDenyGlobal({ pattern: 'readx:foo' }),
      (err: unknown) => err instanceof DenyPatternError,
    );
    assert.throws(
      () => registry.insertDeny({ cwd, pattern: 'Read:secret' }),
      DenyPatternError,
    );
    assert.throws(
      () => registry.insertDenyGlobal({ pattern: 'read:' }),
      /пуст/,
    );
    assert.throws(() => registry.insertDenyGlobal({ pattern: '!' }), /голый/);
    assert.throws(
      () => registry.insertDenyGlobal({ pattern: 'write:!' }),
      /голый/,
    );

    assert.throws(
      () => registry.insertDenyGlobal({ pattern: 'write:.onto/**' }),
      /UNIQUE|constraint/i,
    );
    registry.close();
  });

  void it('loadWorkdirRights: одна транзакция; нет кэша; неизвестный cwd — отказ', () => {
    const root = makeTempDir(temps);
    const workdirPath = join(root, 'project');
    const otherPath = join(root, 'other');
    mkdirSync(workdirPath);
    mkdirSync(otherPath);

    const { dbPath, registry } = openTempRegistry(temps);
    const { cwd } = registry.seedWorkdirPlace({
      cwd: workdirPath,
      description: 'd',
      name: 'n-load',
      placeKey: 'p-load',
    });

    registry.upsertGrant({ cwd, level: 'rw', path: otherPath });
    registry.insertDeny({ cwd, pattern: 'read:**/.env*' });
    registry.insertDenyGlobal({ pattern: 'AGENTS.md' });

    const first = registry.loadWorkdirRights(cwd);
    assert.equal(first.cwd, cwd);
    assert.equal(first.grants.length, 1);
    assert.equal(first.denies.length, 1);
    assert.equal(first.denyGlobals.length, 1);

    const db = openSqliteWithFk(dbPath);
    db.prepare(`UPDATE "grant" SET level = ? WHERE cwd = ?`).run('ro', cwd);
    db.prepare(`INSERT INTO deny_global (pattern) VALUES (?)`).run('CLAUDE.md');
    db.close();

    const second = registry.loadWorkdirRights(cwd);
    assert.equal(second.grants[0]?.level, 'ro');
    assert.equal(second.denyGlobals.length, 2);

    const missing = join(root, 'no-such-workdir');
    mkdirSync(missing);
    assert.throws(
      () => registry.loadWorkdirRights(missing),
      (err: unknown) =>
        err instanceof WorkdirNotFoundError && err.code === 'workdir_not_found',
    );
    registry.close();
  });

  void it('loadWorkdirRights: workdir есть, таблиц прав пусто — пустые списки', () => {
    const root = makeTempDir(temps);
    const workdirPath = join(root, 'bare');
    mkdirSync(workdirPath);

    const { registry } = openTempRegistry(temps);
    const { cwd } = registry.seedWorkdirPlace({
      cwd: workdirPath,
      description: 'd',
      name: 'bare-n',
      placeKey: 'p-bare',
    });

    const rights = registry.loadWorkdirRights(cwd);
    assert.deepEqual(rights.grants, []);
    assert.deepEqual(rights.denies, []);
    assert.deepEqual(rights.denyGlobals, []);
    registry.close();
  });

  void it('FK CASCADE: удаление workdir убирает grant и deny', () => {
    const root = makeTempDir(temps);
    const workdirPath = join(root, 'project');
    const targetPath = join(root, 'target');
    mkdirSync(workdirPath);
    mkdirSync(targetPath);

    const { dbPath, registry } = openTempRegistry(temps);
    const { cwd } = registry.seedWorkdirPlace({
      cwd: workdirPath,
      description: 'd',
      name: 'n-casc-rights',
      placeKey: 'p-casc-rights',
    });
    registry.upsertGrant({ cwd, level: 'append', path: targetPath });
    registry.insertDeny({ cwd, pattern: '.onto/**' });
    registry.close();

    const db = openSqliteWithFk(dbPath);
    db.prepare(`DELETE FROM workdirs WHERE cwd = ?`).run(cwd);
    const grants = db.prepare(`SELECT COUNT(*) AS n FROM "grant"`).get() as {
      n: number;
    };
    const denies = db.prepare(`SELECT COUNT(*) AS n FROM deny`).get() as {
      n: number;
    };
    assert.equal(grants.n, 0);
    assert.equal(denies.n, 0);
    db.close();
  });
});

void describe('validateDenyPattern', () => {
  void it('принимает канонические формы', () => {
    for (const pattern of [
      'write:.onto/**',
      'read:**/.env*',
      'write:!**/.env.example',
      '//abs/**',
      'CLAUDE.md',
    ]) {
      validateDenyPattern(pattern);
    }
  });

  void it('отклоняет мусор отличимо', () => {
    assert.throws(() => validateDenyPattern('readx:foo'), DenyPatternError);
    assert.throws(() => validateDenyPattern('Read:x'), DenyPatternError);
    assert.throws(() => validateDenyPattern('write:'), DenyPatternError);
    assert.throws(() => validateDenyPattern('!'), DenyPatternError);
    assert.throws(() => validateDenyPattern('write:!'), DenyPatternError);
    assert.throws(() => validateDenyPattern(''), DenyPatternError);
  });
});

void describe('normalizeWorkdirPath', () => {
  void it('отвергает пустой путь', () => {
    assert.throws(() => normalizeWorkdirPath(''), /пустой/);
    assert.throws(() => normalizeWorkdirPath('   '), /пустой/);
  });
});

function makeTempDir(temps: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'sherpa-registry-'));
  temps.push(dir);
  return dir;
}

function openSqliteWithFk(dbPath: string) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

function openTempRegistry(temps: string[]) {
  const dir = makeTempDir(temps);
  const dbPath = join(dir, 'registry.sqlite');
  const registry = openRegistry({ path: dbPath });
  return { dbPath, registry };
}
