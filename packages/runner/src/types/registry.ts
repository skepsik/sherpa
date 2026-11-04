export type DenyGlobalInput = {
  pattern: string;
};

export type DenyGlobalRecord = {
  pattern: string;
};

export type DenyInput = {
  cwd: string;
  pattern: string;
};

export type DenyRecord = {
  cwd: string;
  pattern: string;
};

export type GrantInput = {
  cwd: string;
  level: GrantLevel;
  path: string;
};

export type GrantLevel = 'append' | 'none' | 'ro' | 'rw';

export type GrantRecord = {
  cwd: string;
  level: GrantLevel;
  path: string;
};

export type PlaceInput = {
  cwd: string;
  key: string;
  /** Пусто, пока сессии нет. */
  sessionId?: string;
};

export type PlaceRecord = {
  cwd: string;
  key: string;
  sessionId: string;
};

export type Registry = {
  close(): void;
  /** Нет ключа — `null`. */
  findCwdByPlaceKey(key: string): null | string;
  /**
   * `places.session_id` по ключу. Нет места — `PlaceNotFoundError`.
   * Пустая строка — сессии ещё нет.
   */
  getPlaceSessionId(key: string): string;
  insertDeny(input: DenyInput): DenyRecord;
  insertDenyGlobal(input: DenyGlobalInput): DenyGlobalRecord;
  insertPlace(input: PlaceInput): PlaceRecord;
  insertWorkdir(input: WorkdirInput): WorkdirRecord;
  /**
   * Права cwd одной транзакцией: grant + deny + deny_global.
   * Нет workdir — ошибка с `code: 'workdir_not_found'`.
   */
  loadWorkdirRights(cwd: string): WorkdirRights;
  seedWorkdirPlace(input: SeedWorkdirPlaceInput): SeedWorkdirPlaceResult;
  /**
   * Запись / сброс (`''`) `places.session_id`. Нет места — `PlaceNotFoundError`.
   */
  setPlaceSessionId(key: string, sessionId: string): void;
  /** Upsert по `(cwd, path)`, включая `level: none`. */
  upsertGrant(input: GrantInput): GrantRecord;
};

/** Путь к файлу SQLite (`SHERPA_REGISTRY_PATH`). */
export type RegistryConfig = {
  path: string;
};

export type SeedWorkdirPlaceInput = {
  cwd: string;
  description: string;
  name: string;
  /** Opaque `Place` — ключ `places.key`. */
  placeKey: string;
};

export type SeedWorkdirPlaceResult = {
  cwd: string;
  placeKey: string;
};

export type WorkdirInput = {
  cwd: string;
  description: string;
  name: string;
};

export type WorkdirRecord = {
  cwd: string;
  description: string;
  name: string;
};

export type WorkdirRights = {
  cwd: string;
  denies: DenyRecord[];
  denyGlobals: DenyGlobalRecord[];
  grants: GrantRecord[];
};
