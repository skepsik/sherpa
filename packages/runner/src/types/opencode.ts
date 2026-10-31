/**
 * Конфиг прав запуска OpenCode (фрагмент для старта сессии).
 * Эпик 5 подставляет в create/session; ask UI — не здесь.
 */
export type OpenCodeLaunchPermissions = {
  permissions: OpenCodePermissionRule[];
};

/** Эффект правила OpenCode V2 permissions. */
export type OpenCodePermissionEffect = 'allow' | 'ask' | 'deny';

/** Одно правило permissions OpenCode V2 (last matching wins). */
export type OpenCodePermissionRule = {
  action: string;
  effect: OpenCodePermissionEffect;
  resource: string;
};
