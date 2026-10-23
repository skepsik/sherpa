import { Bot } from 'grammy';

import type { BotConfig } from './config';
import type { AcceptedInbound } from './map-update';
import type { TelegramUpdate } from './telegram-update';

import { mapTelegramUpdate } from './map-update';

/** Сторона канала (issue-2-3) подписывается на готовое inbound. */
export type OnInbound = (inbound: AcceptedInbound) => Promise<void> | void;

export type TelegramReceiver = {
  bot: Bot;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

/**
 * Long-polling приём Update → фильтр/маппинг → `onInbound`.
 * На callback локально вызывает `answerCallbackQuery`.
 */
export function createTelegramReceiver(options: {
  config: BotConfig;
  onInbound: OnInbound;
}): TelegramReceiver {
  const { config, onInbound } = options;
  const bot = new Bot(config.token);

  bot.use(async (ctx) => {
    const mapped = mapTelegramUpdate(ctx.update, config.access);

    if (mapped.answerCallbackQueryId !== null) {
      try {
        await ctx.api.answerCallbackQuery(mapped.answerCallbackQueryId);
      } catch (error) {
        console.warn('answerCallbackQuery failed', error);
      }
    }

    if (mapped.inbound === null) {
      if (shouldLogDrop(ctx.update)) {
        console.warn('inbound dropped', {
          update_id: ctx.update.update_id,
        });
      }
      return;
    }

    await onInbound(mapped.inbound);
  });

  return {
    bot,
    start: async () => {
      await bot.start({
        allowed_updates: ['message', 'callback_query'],
      });
    },
    stop: async () => {
      await bot.stop();
    },
  };
}

function shouldLogDrop(update: TelegramUpdate) {
  return update.message !== undefined || update.callback_query !== undefined;
}
