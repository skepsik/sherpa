export type TelegramCallbackQuery = {
  data?: string;
  from: TelegramUser;
  id: string;
  message?: TelegramMessage;
};

/**
 * Минимальный срез Telegram Update для маппинга.
 * Поля вне этого среза игнорируются.
 */
export type TelegramChat = {
  id: number;
  type: string;
};

export type TelegramMessage = {
  caption?: string;
  chat: TelegramChat;
  from?: TelegramUser;
  message_thread_id?: number;
  text?: string;
};

export type TelegramUpdate = {
  callback_query?: TelegramCallbackQuery;
  edited_message?: TelegramMessage;
  message?: TelegramMessage;
  update_id: number;
};

export type TelegramUser = {
  id: number;
};
