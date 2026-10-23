import type { Api } from 'grammy';

export type InlineKeyboard = { callback_data: string; text: string }[][];

/** Срез grammY Api, нужный для outbound. */
export type OutboundApi = Pick<
  Api,
  'createForumTopic' | 'editMessageText' | 'sendMessage'
>;
