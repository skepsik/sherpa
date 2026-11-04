import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  DenyGlobalInput,
  DenyGlobalRecord,
  DenyInput,
  DenyRecord,
  GrantInput,
  GrantLevel,
  GrantRecord,
  PlaceInput,
  Registry,
  RegistryConfig,
  SeedWorkdirPlaceInput,
  SeedWorkdirPlaceResult,
  WorkdirInput,
  WorkdirRights,
} from '../types/registry';

import { validateDenyPattern } from './deny-pattern';
import { migrateRegistrySchema } from './migrate';
import { normalizeWorkdirPath } from './normalize-path';

const GRANT_LEVELS = [
  'none',
  'ro',
  'append',
  'rw',
] as const satisfies readonly GrantLevel[];

export class PlaceNotFoundError extends Error {
  readonly code = 'place_not_found' as const;

  constructor(key: string) {
    super(`places: ключ не найден: ${key}`);
    this.name = 'PlaceNotFoundError';
  }
}

export class WorkdirNotFoundError extends Error {
  readonly code = 'workdir_not_found' as const;

  constructor(cwd: string) {
    super(`loadWorkdirRights: workdir не найден: ${cwd}`);
    this.name = 'WorkdirNotFoundError';
  }
}

/** Открывает (или создаёт) файл SQLite и накатывает схему. */
export function openRegistry(config: RegistryConfig): Registry {
  const dbPath = config.path.trim();
  if (!dbPath) {
    throw new Error('SHERPA_REGISTRY_PATH: пустой путь');
  }

  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  migrateRegistrySchema(db);

  const insertWorkdirStmt = db.prepare(
    `INSERT INTO workdirs (cwd, name, description) VALUES (?, ?, ?)`,
  );
  const insertPlaceStmt = db.prepare(
    `INSERT INTO places (key, cwd, session_id) VALUES (?, ?, ?)`,
  );
  const findCwdStmt = db.prepare(`SELECT cwd FROM places WHERE key = ?`);
  const findSessionIdStmt = db.prepare(
    `SELECT session_id FROM places WHERE key = ?`,
  );
  const updateSessionIdStmt = db.prepare(
    `UPDATE places SET session_id = ? WHERE key = ?`,
  );
  const findWorkdirStmt = db.prepare(`SELECT cwd FROM workdirs WHERE cwd = ?`);
  const upsertGrantStmt = db.prepare(
    `INSERT INTO "grant" (cwd, path, level) VALUES (?, ?, ?)
     ON CONFLICT(cwd, path) DO UPDATE SET level = excluded.level`,
  );
  const insertDenyStmt = db.prepare(
    `INSERT INTO deny (cwd, pattern) VALUES (?, ?)`,
  );
  const insertDenyGlobalStmt = db.prepare(
    `INSERT INTO deny_global (pattern) VALUES (?)`,
  );
  const selectGrantsStmt = db.prepare(
    `SELECT cwd, path, level FROM "grant" WHERE cwd = ? ORDER BY path`,
  );
  const selectDeniesStmt = db.prepare(
    `SELECT cwd, pattern FROM deny WHERE cwd = ? ORDER BY pattern`,
  );
  const selectDenyGlobalsStmt = db.prepare(
    `SELECT pattern FROM deny_global ORDER BY pattern`,
  );

  function insertWorkdir(input: WorkdirInput) {
    const cwd = normalizeWorkdirPath(input.cwd);
    const name = input.name.trim();
    const description = input.description.trim();
    if (!name) throw new Error('workdir.name: не пусто');
    if (!description) throw new Error('workdir.description: не пусто');

    insertWorkdirStmt.run(cwd, name, description);
    return { cwd, description, name };
  }

  function insertPlace(input: PlaceInput) {
    validatePlaceKey(input.key);
    const cwd = normalizeWorkdirPath(input.cwd);
    const sessionId = input.sessionId ?? '';

    insertPlaceStmt.run(input.key, cwd, sessionId);
    return { cwd, key: input.key, sessionId };
  }

  function findCwdByPlaceKey(key: string): null | string {
    const row = findCwdStmt.get(key) as undefined | { cwd: string };
    return row?.cwd ?? null;
  }

  function getPlaceSessionId(key: string): string {
    const row = findSessionIdStmt.get(key) as
      undefined | { session_id: string };
    if (row === undefined) throw new PlaceNotFoundError(key);
    return row.session_id;
  }

  function setPlaceSessionId(key: string, sessionId: string) {
    const result = updateSessionIdStmt.run(sessionId, key);
    if (result.changes === 0) throw new PlaceNotFoundError(key);
  }

  function upsertGrant(input: GrantInput): GrantRecord {
    const cwd = normalizeWorkdirPath(input.cwd);
    const path = normalizeWorkdirPath(input.path);
    const level = ensureGrantLevel(input.level);

    upsertGrantStmt.run(cwd, path, level);
    return { cwd, level, path };
  }

  function insertDeny(input: DenyInput): DenyRecord {
    const cwd = normalizeWorkdirPath(input.cwd);
    validateDenyPattern(input.pattern);
    const pattern = input.pattern.trim();

    insertDenyStmt.run(cwd, pattern);
    return { cwd, pattern };
  }

  function insertDenyGlobal(input: DenyGlobalInput): DenyGlobalRecord {
    validateDenyPattern(input.pattern);
    const pattern = input.pattern.trim();

    insertDenyGlobalStmt.run(pattern);
    return { pattern };
  }

  function loadWorkdirRights(cwdInput: string): WorkdirRights {
    const cwd = normalizeWorkdirPath(cwdInput);

    db.exec('BEGIN');
    try {
      const workdir = findWorkdirStmt.get(cwd) as undefined | { cwd: string };
      if (!workdir) {
        throw new WorkdirNotFoundError(cwd);
      }

      const grants = (
        selectGrantsStmt.all(cwd) as Array<{
          cwd: string;
          level: GrantLevel;
          path: string;
        }>
      ).map((row) => ({ cwd: row.cwd, level: row.level, path: row.path }));

      const denies = (
        selectDeniesStmt.all(cwd) as Array<{ cwd: string; pattern: string }>
      ).map((row) => ({ cwd: row.cwd, pattern: row.pattern }));

      const denyGlobals = (
        selectDenyGlobalsStmt.all() as Array<{ pattern: string }>
      ).map((row) => ({ pattern: row.pattern }));

      db.exec('COMMIT');
      return { cwd, denies, denyGlobals, grants };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function seedWorkdirPlace(
    input: SeedWorkdirPlaceInput,
  ): SeedWorkdirPlaceResult {
    db.exec('BEGIN');
    try {
      const workdir = insertWorkdir({
        cwd: input.cwd,
        description: input.description,
        name: input.name,
      });
      insertPlace({ cwd: workdir.cwd, key: input.placeKey });
      db.exec('COMMIT');
      return { cwd: workdir.cwd, placeKey: input.placeKey };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    close() {
      db.close();
    },
    findCwdByPlaceKey,
    getPlaceSessionId,
    insertDeny,
    insertDenyGlobal,
    insertPlace,
    insertWorkdir,
    loadWorkdirRights,
    seedWorkdirPlace,
    setPlaceSessionId,
    upsertGrant,
  };
}

function ensureGrantLevel(level: string): GrantLevel {
  if ((GRANT_LEVELS as readonly string[]).includes(level)) {
    return level as GrantLevel;
  }
  throw new Error(
    `grant.level: ожидался none|ro|append|rw, получено «${level}»`,
  );
}

function validatePlaceKey(key: string) {
  if (!key || /\s/.test(key)) {
    throw new Error('places.key: непустая строка без whitespace');
  }
}
