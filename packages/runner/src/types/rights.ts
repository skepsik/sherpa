import type { GrantLevel } from './registry';

/** Эффект шаблона deny (префикс read:/write:). */
export type DenyEffect = 'read' | 'write';

/** Итог матчинга deny по путям. */
export type DenyEffects = {
  readDenied: boolean;
  writeDenied: boolean;
};

/**
 * Плоский результат резолва для адаптера харнесса.
 * Shell продуктово выключен; ask вне корней — на порте (эпик 5).
 */
export type LaunchRights = {
  cwd: string;
  /** Объединённые шаблоны deny + deny_global (как в БД). */
  denyPatterns: string[];
  /** Чужие корни с level выше none. */
  foreignRoots: LaunchRoot[];
  /** Свой узел — полный доступ (кроме deny / константного запрета). */
  ownRoot: LaunchRoot;
  /** Абсолютные пути константного запрета реестра (db + sidecar). */
  registryDenyPaths: string[];
  shellEnabled: false;
};

/** Разрешённый корень в плоском снимке запуска. */
export type LaunchRoot = {
  level: GrantLevel;
  path: string;
};

/** Разобранная строка deny / deny_global. */
export type ParsedDeny = {
  effect: DenyEffect;
  /** gitignore-часть без ведущего `!`. */
  gitignore: string;
  isException: boolean;
};

/** Вердикт доступа к пути. */
export type PathAccess = {
  level: GrantLevel;
};

/** Опции резолва: база константного запрета. */
export type ResolveRightsOptions = {
  /** Путь к файлу БД (`SHERPA_REGISTRY_PATH`). */
  registryPath: string;
};
