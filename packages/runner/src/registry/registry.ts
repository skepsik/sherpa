import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  PlaceInput,
  Registry,
  RegistryConfig,
  SeedWorkdirPlaceInput,
  SeedWorkdirPlaceResult,
  WorkdirInput,
} from '../types/registry';

import { migrateRegistrySchema } from './migrate';
import { normalizeWorkdirPath } from './normalize-path';

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
    insertPlace,
    insertWorkdir,
    seedWorkdirPlace,
  };
}

function validatePlaceKey(key: string) {
  if (!key || /\s/.test(key)) {
    throw new Error('places.key: непустая строка без whitespace');
  }
}
