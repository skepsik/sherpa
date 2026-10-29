import type {
  OutboundCommand,
  OutboundCommandType,
  OutboundCreatePlace,
  OutboundError,
  OutboundErrorCode,
  OutboundInlineButton,
  OutboundResolveQuestion,
  OutboundResult,
  OutboundSendMessage,
  OutboundSendOkCommandType,
  OutboundSendQuestion,
  OutboundSetStatus,
} from '@sherpa/contract';

import { assertNever } from '@sherpa/contract';
import { GrammyError } from 'grammy';

import type { InlineKeyboard, OutboundApi, TelegramPlace } from './types';

import { tryPackCallbackData } from './callback-data';
import { encodePlaceId, findTelegramPlace } from './place-id';

/** Лимит Telegram на длину текста сообщения (символы). */
export const TELEGRAM_TEXT_MAX_CHARS = 4096;

/**
 * Сколько раз вызвать API при 429 (включая первый).
 * Между попытками — ожидание `retry_after` (или 1 с, если параметра нет).
 */
export const RATE_LIMIT_MAX_ATTEMPTS = 3;

/** Короткий fallback, если у отказа нет описания. */
const UNKNOWN_ERROR_MESSAGE = 'unknown error';

/** Команда контракта → исход после вызова Telegram. */
export async function executeOutbound(
  api: OutboundApi,
  command: OutboundCommand,
): Promise<OutboundResult> {
  switch (command.type) {
    case 'create_place':
      return executeCreatePlace(api, command);
    case 'resolve_question':
      return executeResolveQuestion(api, command);
    case 'send_message':
      return executeSendMessage(api, command);
    case 'send_question':
      return executeSendQuestion(api, command);
    case 'set_status':
      return executeSetStatus(command);
    default:
      return assertNever(command);
  }
}

async function callWithRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof GrammyError) || error.error_code !== 429) {
        throw error;
      }
      attempt += 1;
      if (attempt >= RATE_LIMIT_MAX_ATTEMPTS) throw error;
      const seconds = error.parameters.retry_after ?? 1;
      await sleep(seconds * 1000);
    }
  }
}

async function executeCreatePlace(
  api: OutboundApi,
  command: OutboundCreatePlace,
): Promise<OutboundResult> {
  const parent = findTelegramPlace(command.place);
  if (!parent) {
    return placeUnavailable('create_place', 'unknown place id');
  }

  try {
    const topic = await callWithRateLimitRetry(() =>
      api.createForumTopic(parent.chatId, command.title),
    );
    return {
      place: encodePlaceId({
        chatId: parent.chatId,
        kind: 'topic',
        topicId: String(topic.message_thread_id),
      }),
      type: 'create_place_ok',
    };
  } catch (error) {
    return mapApiError(error, 'create_place');
  }
}

async function executeResolveQuestion(
  api: OutboundApi,
  command: OutboundResolveQuestion,
): Promise<OutboundResult> {
  const place = findTelegramPlace(command.place);
  if (!place) {
    return placeUnavailable('resolve_question', 'unknown place id');
  }

  if (command.text.length > TELEGRAM_TEXT_MAX_CHARS) {
    return rejected(
      'resolve_question',
      'text exceeds Telegram limit of 4096 characters',
    );
  }

  try {
    await callWithRateLimitRetry(() =>
      api.editMessageText(
        place.chatId,
        Number(command.messageId),
        command.text,
        { reply_markup: { inline_keyboard: [] } },
      ),
    );
    return sendOk('resolve_question');
  } catch (error) {
    if (isMessageNotModified(error)) {
      return sendOk('resolve_question');
    }
    return mapApiError(error, 'resolve_question');
  }
}

async function executeSendMessage(
  api: OutboundApi,
  command: OutboundSendMessage,
): Promise<OutboundResult> {
  const place = findTelegramPlace(command.place);
  if (!place) {
    return placeUnavailable('send_message', 'unknown place id');
  }

  if (command.text.length > TELEGRAM_TEXT_MAX_CHARS) {
    return rejected(
      'send_message',
      'text exceeds Telegram limit of 4096 characters',
    );
  }

  try {
    await callWithRateLimitRetry(() =>
      api.sendMessage(place.chatId, command.text, threadOptions(place)),
    );
    return sendOk('send_message');
  } catch (error) {
    return mapApiError(error, 'send_message');
  }
}

async function executeSendQuestion(
  api: OutboundApi,
  command: OutboundSendQuestion,
): Promise<OutboundResult> {
  const place = findTelegramPlace(command.place);
  if (!place) {
    return placeUnavailable('send_question', 'unknown place id');
  }

  if (command.text.length > TELEGRAM_TEXT_MAX_CHARS) {
    return rejected(
      'send_question',
      'text exceeds Telegram limit of 4096 characters',
    );
  }

  const keyboard = tryBuildInlineKeyboard(command.requestId, command.buttons);
  if (keyboard === null) {
    return rejected('send_question', 'callback_data exceeds 64 bytes');
  }

  try {
    const message = await callWithRateLimitRetry(() =>
      api.sendMessage(place.chatId, command.text, {
        ...threadOptions(place),
        reply_markup: { inline_keyboard: keyboard },
      }),
    );
    return {
      commandType: 'send_question',
      messageId: String(message.message_id),
      type: 'question_ok',
    };
  } catch (error) {
    return mapApiError(error, 'send_question');
  }
}

function executeSetStatus(command: OutboundSetStatus): OutboundResult {
  if (!findTelegramPlace(command.place)) {
    return placeUnavailable('set_status', 'unknown place id');
  }
  return sendOk('set_status');
}

function isMessageNotModified(error: unknown) {
  return (
    error instanceof GrammyError &&
    error.description.toLowerCase().includes('message is not modified')
  );
}

function isPlaceUnavailable(error: unknown) {
  if (!(error instanceof GrammyError)) return false;
  if (error.error_code === 403) return true;
  const d = error.description.toLowerCase();
  return (
    d.includes('chat not found') ||
    d.includes('bot was blocked') ||
    d.includes('bot is not a member') ||
    d.includes('have no rights') ||
    d.includes('not enough rights')
  );
}

function mapApiError(
  error: unknown,
  commandType: OutboundCommandType,
): OutboundError {
  return {
    code: resolveOutboundErrorCode(error, commandType),
    commandType,
    message: resolveErrorMessage(error),
    type: 'error',
  };
}

function placeUnavailable(
  commandType: OutboundCommandType,
  message: string,
): OutboundError {
  return {
    code: 'place_unavailable',
    commandType,
    message,
    type: 'error',
  };
}

function rejected(
  commandType: OutboundCommandType,
  message: string,
): OutboundError {
  return {
    code: 'transport_rejected',
    commandType,
    message,
    type: 'error',
  };
}

function resolveErrorMessage(error: unknown) {
  if (error instanceof GrammyError) {
    return error.description !== '' ? error.description : UNKNOWN_ERROR_MESSAGE;
  }
  if (error instanceof Error && error.message !== '') return error.message;
  return UNKNOWN_ERROR_MESSAGE;
}

function resolveOutboundErrorCode(
  error: unknown,
  commandType: OutboundCommandType,
): OutboundErrorCode {
  if (isPlaceUnavailable(error)) return 'place_unavailable';
  if (commandType === 'create_place') return 'place_create_failed';
  return 'send_failed';
}

function sendOk(commandType: OutboundSendOkCommandType): OutboundResult {
  return { commandType, type: 'send_ok' };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function threadOptions(place: TelegramPlace) {
  if (place.kind === 'direct') return {};
  return { message_thread_id: Number(place.topicId) };
}

function tryBuildInlineKeyboard(
  requestId: string,
  buttons: OutboundInlineButton[],
): InlineKeyboard | null {
  const rows: InlineKeyboard = [];
  for (const button of buttons) {
    const packed = tryPackCallbackData(requestId, button.data);
    if (packed === null) return null;
    rows.push([{ callback_data: packed, text: button.label }]);
  }
  return rows;
}
