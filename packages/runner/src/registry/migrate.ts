import type { DatabaseSync } from 'node:sqlite';

/** Идемпотентное создание схемы `workdirs` / `places` / `roles`. */
export function migrateRegistrySchema(db: DatabaseSync) {
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS workdirs (
      cwd TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      CHECK (length(name) > 0),
      CHECK (length(description) > 0)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS places (
      key TEXT PRIMARY KEY NOT NULL,
      cwd TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL DEFAULT '',
      CHECK (length(key) > 0),
      FOREIGN KEY (cwd) REFERENCES workdirs(cwd)
        ON UPDATE CASCADE
        ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      cwd TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('gatekeeper')),
      PRIMARY KEY (cwd, role),
      FOREIGN KEY (cwd) REFERENCES workdirs(cwd)
        ON UPDATE CASCADE
        ON DELETE CASCADE
    )
  `);
}
