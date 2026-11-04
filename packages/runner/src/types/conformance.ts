import type { GrantLevel } from './registry';

/** Действие-провокация suite (без диалекта харнесса). */
export type ConformanceAction = 'read' | 'write';

/** Контекст ask, который драйвер отдаёт suite / колбэку. */
export type ConformanceAskInfo = {
  action: ConformanceAction;
  path: string;
};

/** Программный ответ на ask. */
export type ConformanceAskReply = 'always' | 'once' | 'reject';

/** Исход одного кейса suite. */
export type ConformanceCaseResult = {
  actual: ConformanceVerdict;
  expected: readonly ConformanceVerdict[];
  id: string;
  ok: boolean;
  title: string;
};

/**
 * Спека кейса MVP: продуктовые allow/deny/ask, без флагов OpenCode.
 * Пути в layout / target / grants — относительно корня фикстуры.
 */
export type ConformanceCaseSpec = {
  action: ConformanceAction;
  /** Относительный cwd узла. */
  cwd: string;
  deny?: readonly string[];
  denyGlobal?: readonly string[];
  /** Ожидаемый вердикт или допустимое множество (напр. deny|ask). */
  expect: ConformanceVerdict | readonly ConformanceVerdict[];
  grants?: readonly { level: ConformanceGrantSeed['level']; path: string }[];
  id: string;
  layout: ConformanceLayout;
  /**
   * Ответ на ask; без поля — вердикт остаётся `ask` (не авто-reject).
   */
  onAsk?: ConformanceAskReply;
  /** Относительный путь провокации. */
  target: string;
  title: string;
};

/**
 * Драйвер адаптера для conformance suite.
 * Suite формулирует allow/deny/ask; диалект харнесса — только внутри драйвера.
 */
export type ConformanceDriver = {
  /**
   * Поднять сессию с заданным снимком прав; выполнить провокацию;
   * вернуть продуктовый вердикт. На ask — `onAsk`, затем применить ответ.
   */
  provoke(input: ConformanceProvokeInput): Promise<ConformanceVerdict>;
};

/** Grant в фикстуре suite (пути абсолютные, уже нормализованные). */
export type ConformanceGrantSeed = {
  level: GrantLevel;
  path: string;
};

export type ConformanceLayout = {
  dirs?: readonly string[];
  files?: Readonly<Record<string, string>>;
};

/** Кейс после материализации абсолютных путей. */
export type ConformancePreparedCase = {
  action: ConformanceAction;
  expect: readonly ConformanceVerdict[];
  id: string;
  onAsk?: ConformanceAskReply;
  path: string;
  rights: ConformanceRightsSeed;
  title: string;
};

/** Вход провокации: снимок прав + действие + путь. */
export type ConformanceProvokeInput = {
  action: ConformanceAction;
  /**
   * На ask: с колбэком — применить once/always/reject и вернуть итог;
   * без колбэка — вернуть `ask` (не авто-reject).
   * После once/always deny таблицы / registry всё равно не снимаются.
   */
  onAsk?: (
    ask: ConformanceAskInfo,
  ) => ConformanceAskReply | Promise<ConformanceAskReply>;
  path: string;
  rights: ConformanceRightsSeed;
};

/**
 * Снимок прав для драйвера (продуктовые понятия, не флаги OpenCode).
 * Пути — абсолютные без хвостового `/`.
 */
export type ConformanceRightsSeed = {
  cwd: string;
  deny?: readonly string[];
  denyGlobal?: readonly string[];
  grants?: readonly ConformanceGrantSeed[];
  /** Файл реестра (константный запрет + sidecar). */
  registryPath: string;
};

/** Агрегат прогона suite. */
export type ConformanceSuiteResult = {
  failed: ConformanceCaseResult[];
  passed: number;
  results: ConformanceCaseResult[];
  total: number;
};

/** Продуктовый вердикт матрицы. */
export type ConformanceVerdict = 'allow' | 'ask' | 'deny';
