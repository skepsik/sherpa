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
  insertPlace(input: PlaceInput): PlaceRecord;
  insertWorkdir(input: WorkdirInput): WorkdirRecord;
  seedWorkdirPlace(input: SeedWorkdirPlaceInput): SeedWorkdirPlaceResult;
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
