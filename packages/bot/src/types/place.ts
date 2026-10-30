/** Локальная топология Telegram; на провод не выходит. */
export type TelegramPlace =
  | { chatId: string; kind: 'direct' }
  | { chatId: string; kind: 'topic'; topicId: string };
