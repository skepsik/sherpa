import type { AccessFilter } from './types';

export function isAllowedSender(
  access: AccessFilter,
  userId: string,
  chatId: string,
) {
  return userId === access.userId && access.allowedChatIds.has(chatId);
}
