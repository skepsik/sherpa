/** Фильтр «свой» пользователь + allowlist чатов (личка / супергруппа). */
export type AccessFilter = {
  allowedChatIds: ReadonlySet<string>;
  userId: string;
};
