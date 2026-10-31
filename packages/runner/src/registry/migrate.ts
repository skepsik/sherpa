import type { DatabaseSync } from 'node:sqlite';

/** Идемпотентное создание схемы реестра (workdirs…deny_global). */
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS "grant" (
      cwd TEXT NOT NULL,
      path TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('none', 'ro', 'append', 'rw')),
      PRIMARY KEY (cwd, path),
      FOREIGN KEY (cwd) REFERENCES workdirs(cwd)
        ON UPDATE CASCADE
        ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS deny (
      cwd TEXT NOT NULL,
      pattern TEXT NOT NULL,
      PRIMARY KEY (cwd, pattern),
      CHECK (length(pattern) > 0),
      FOREIGN KEY (cwd) REFERENCES workdirs(cwd)
        ON UPDATE CASCADE
        ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS deny_global (
      pattern TEXT PRIMARY KEY NOT NULL,
      CHECK (length(pattern) > 0)
    )
  `);
}
