import type { Bot } from 'grammy';

import type { AcceptedInbound } from './map-update';

/** Сторона канала подписывается на готовое inbound. */
export type OnInbound = (inbound: AcceptedInbound) => Promise<void> | void;

export type TelegramReceiver = {
  bot: Bot;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};
