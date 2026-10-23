import type { InboundEvent, Place } from '@sherpa/contract';

import type { AccessFilter } from './access';
import type {
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
} from './telegram-update';

import { isAllowedSender } from './access';
import { tryUnpackCallbackData } from './callback-data';

/** Готовое inbound (+ eventId) для отдачи наружу модуля приёма. */
export type AcceptedInbound = {
  event: InboundEvent;
  eventId: string;
};

/**
 * Результат разбора Update:
 * - `inbound` — эмитить на канал (или `null`, если отбросить);
 * - `answerCallbackQueryId` — локальный ответ Telegram на callback (если нужен).
 */
export type MappedUpdate = {
  answerCallbackQueryId: null | string;
  inbound: AcceptedInbound | null;
};

const IGNORE: MappedUpdate = {
  answerCallbackQueryId: null,
  inbound: null,
};

/** Update → inbound контракта или отброс; для callback — id для answerCallbackQuery. */
export function mapTelegramUpdate(
  update: TelegramUpdate,
  access: AccessFilter,
): MappedUpdate {
  if (update.callback_query) {
    return mapCallback(update.update_id, update.callback_query, access);
  }
  if (update.message) {
    return mapUserMessage(update.update_id, update.message, access);
  }
  return IGNORE;
}

/**
 * Личка → `direct`; форумный топик с `message_thread_id` → `topic`.
 * General без thread / прочие чаты → `null`.
 */
function findPlace(message: TelegramMessage): null | Place {
  if (message.chat.type === 'private') {
    return { chatId: String(message.chat.id), kind: 'direct' };
  }
  if (message.message_thread_id === undefined) return null;
  return {
    chatId: String(message.chat.id),
    kind: 'topic',
    topicId: String(message.message_thread_id),
  };
}

function mapCallback(
  updateId: number,
  query: TelegramCallbackQuery,
  access: AccessFilter,
): MappedUpdate {
  const answered: MappedUpdate = {
    answerCallbackQueryId: query.id,
    inbound: null,
  };

  const message = query.message;
  if (!message) return answered;

  const userId = String(query.from.id);
  const chatId = String(message.chat.id);
  if (!isAllowedSender(access, userId, chatId)) return answered;

  const place = findPlace(message);
  if (!place) return answered;

  if (query.data === undefined) return answered;

  const payload = tryUnpackCallbackData(query.data);
  if (!payload) return answered;

  return {
    answerCallbackQueryId: query.id,
    inbound: {
      event: {
        data: payload.data,
        place,
        requestId: payload.requestId,
        type: 'callback',
      },
      eventId: String(updateId),
    },
  };
}

function mapUserMessage(
  updateId: number,
  message: TelegramMessage,
  access: AccessFilter,
): MappedUpdate {
  if (message.from === undefined) return IGNORE;
  if (message.text === undefined || message.text === '') return IGNORE;

  const userId = String(message.from.id);
  const chatId = String(message.chat.id);
  if (!isAllowedSender(access, userId, chatId)) return IGNORE;

  const place = findPlace(message);
  if (!place) return IGNORE;

  return {
    answerCallbackQueryId: null,
    inbound: {
      event: {
        place,
        text: message.text,
        type: 'user_message',
      },
      eventId: String(updateId),
    },
  };
}
