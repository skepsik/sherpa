/** Фильтр «свой» пользователь + allowlist чатов (личка / супергруппа). */
export type AccessFilter = {
  allowedChatIds: ReadonlySet<string>;
  userId: string;
};

export function isAllowedSender(
  access: AccessFilter,
  userId: string,
  chatId: string,
) {
  return userId === access.userId && access.allowedChatIds.has(chatId);
}
