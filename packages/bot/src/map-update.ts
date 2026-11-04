import type { InboundEvent, MessageDelivery } from '@sherpa/contract';

import type {
  AccessFilter,
  MappedUpdate,
  ParsedSlash,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramPlace,
  TelegramUpdate,
} from './types';

import { isAllowedSender } from './access';
import { tryUnpackCallbackData } from './callback-data';
import { encodePlaceId } from './place-id';

const IGNORE: MappedUpdate = {
  answerCallbackQueryId: null,
  inbound: null,
  userReply: null,
};

/** Текст ответа на голый `/interject` / `/after` без тела. */
const SLASH_NEEDS_TEXT_REPLY =
  'Нужен текст после команды: /interject … или /after …';

/** Update → inbound контракта или отброс; для callback — id для answerCallbackQuery. */
export function mapTelegramUpdate(
  update: TelegramUpdate,
  access: AccessFilter,
): MappedUpdate {
  if (update.callback_query) {
    return mapQuestionAnswer(update.update_id, update.callback_query, access);
  }
  if (update.message) {
    return mapMessage(update.update_id, update.message, access);
  }
  return IGNORE;
}

function buildInboundFromSlash(
  place: string,
  parsed: Exclude<ParsedSlash, { kind: 'needs_text' }>,
): InboundEvent {
  if (parsed.kind === 'break') {
    return { place, type: 'session_break' };
  }
  if (parsed.kind === 'override') {
    return {
      delivery: parsed.delivery,
      place,
      text: parsed.text,
      type: 'message',
    };
  }
  return { place, text: parsed.text, type: 'message' };
}

/**
 * Личка → `direct`; форумный топик с `message_thread_id` → `topic`.
 * General без thread / прочие чаты → `null`.
 */
function findTelegramPlaceFromMessage(
  message: TelegramMessage,
): null | TelegramPlace {
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

function mapMessage(
  updateId: number,
  message: TelegramMessage,
  access: AccessFilter,
): MappedUpdate {
  if (message.from === undefined) return IGNORE;
  if (message.text === undefined || message.text === '') return IGNORE;

  const userId = String(message.from.id);
  const chatId = String(message.chat.id);
  if (!isAllowedSender(access, userId, chatId)) return IGNORE;

  const telegramPlace = findTelegramPlaceFromMessage(message);
  if (!telegramPlace) return IGNORE;

  const place = encodePlaceId(telegramPlace);
  const parsed = parseSlashCommand(message.text);
  if (parsed.kind === 'needs_text') {
    return {
      answerCallbackQueryId: null,
      inbound: null,
      userReply: SLASH_NEEDS_TEXT_REPLY,
    };
  }

  const event = buildInboundFromSlash(place, parsed);
  return {
    answerCallbackQueryId: null,
    inbound: {
      event,
      eventId: String(updateId),
    },
    userReply: null,
  };
}

function mapQuestionAnswer(
  updateId: number,
  query: TelegramCallbackQuery,
  access: AccessFilter,
): MappedUpdate {
  const answered: MappedUpdate = {
    answerCallbackQueryId: query.id,
    inbound: null,
    userReply: null,
  };

  const message = query.message;
  if (!message) return answered;

  const userId = String(query.from.id);
  const chatId = String(message.chat.id);
  if (!isAllowedSender(access, userId, chatId)) return answered;

  const telegramPlace = findTelegramPlaceFromMessage(message);
  if (!telegramPlace) return answered;

  if (query.data === undefined) return answered;

  const payload = tryUnpackCallbackData(query.data);
  if (!payload) return answered;

  return {
    answerCallbackQueryId: query.id,
    inbound: {
      event: {
        data: payload.data,
        place: encodePlaceId(telegramPlace),
        requestId: payload.requestId,
        type: 'question_answer',
      },
      eventId: String(updateId),
    },
    userReply: null,
  };
}

/**
 * Slash mid-run: `/interject` / `/after` / `/stop` (+ опциональный @bot).
 * Голый interject/after без текста → needs_text (на раннер не слать).
 */
function parseSlashCommand(text: string): ParsedSlash {
  const match = /^\/(interject|after|stop)(?:@\S+)?(?:\s+([\s\S]*))?$/i.exec(
    text,
  );
  if (!match) return { kind: 'plain', text };

  const command = match[1].toLowerCase();
  const body = match[2]?.trim() ?? '';

  if (command === 'stop') {
    return { kind: 'break' };
  }

  if (body === '') return { kind: 'needs_text' };

  const delivery: MessageDelivery = command === 'after' ? 'after' : 'interject';
  return { delivery, kind: 'override', text: body };
}
