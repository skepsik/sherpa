import type {
  OutboundCommand,
  OutboundCommandType,
  OutboundCreateTopic,
  OutboundError,
  OutboundErrorCode,
  OutboundInlineButton,
  OutboundResolveQuestion,
  OutboundResult,
  OutboundSendMessage,
  OutboundSendOkCommandType,
  OutboundSendQuestion,
  OutboundSetStatus,
  Place,
} from '@sherpa/contract';
import type { Api } from 'grammy';

import { assertNever } from '@sherpa/contract';
import { GrammyError } from 'grammy';

import { tryPackCallbackData } from './callback-data';

/** Лимит Telegram на длину текста сообщения (символы). */
export const TELEGRAM_TEXT_MAX_CHARS = 4096;

/**
 * Сколько раз вызвать API при 429 (включая первый).
 * Между попытками — ожидание `retry_after` (или 1 с, если параметра нет).
 */
export const RATE_LIMIT_MAX_ATTEMPTS = 3;

/** Срез grammY Api, нужный для outbound. */
export type OutboundApi = Pick<
  Api,
  'createForumTopic' | 'editMessageText' | 'sendMessage'
>;

type InlineKeyboard = { callback_data: string; text: string }[][];

/** Команда контракта → исход после вызова Telegram. */
export async function executeOutbound(
  api: OutboundApi,
  command: OutboundCommand,
): Promise<OutboundResult> {
  switch (command.type) {
    case 'create_topic':
      return executeCreateTopic(api, command);
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

async function executeCreateTopic(
  api: OutboundApi,
  command: OutboundCreateTopic,
): Promise<OutboundResult> {
  try {
    const topic = await callWithRateLimitRetry(() =>
      api.createForumTopic(command.chatId, command.title),
    );
    return {
      place: {
        chatId: command.chatId,
        kind: 'topic',
        topicId: String(topic.message_thread_id),
      },
      type: 'create_topic_ok',
    };
  } catch (error) {
    return mapApiError(error, 'create_topic');
  }
}

async function executeResolveQuestion(
  api: OutboundApi,
  command: OutboundResolveQuestion,
): Promise<OutboundResult> {
  if (command.text.length > TELEGRAM_TEXT_MAX_CHARS) {
    return rejected(
      'resolve_question',
      'text exceeds Telegram limit of 4096 characters',
    );
  }

  try {
    await callWithRateLimitRetry(() =>
      api.editMessageText(
        command.place.chatId,
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
  if (command.text.length > TELEGRAM_TEXT_MAX_CHARS) {
    return rejected(
      'send_message',
      'text exceeds Telegram limit of 4096 characters',
    );
  }

  try {
    await callWithRateLimitRetry(() =>
      api.sendMessage(
        command.place.chatId,
        command.text,
        threadOptions(command.place),
      ),
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
      api.sendMessage(command.place.chatId, command.text, {
        ...threadOptions(command.place),
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
  void command;
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
  const description =
    error instanceof GrammyError ? error.description : undefined;
  const code = resolveOutboundErrorCode(error, commandType);
  const result: OutboundError = { code, commandType, type: 'error' };
  if (description !== undefined) result.message = description;
  else if (error instanceof Error) result.message = error.message;
  return result;
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

function resolveOutboundErrorCode(
  error: unknown,
  commandType: OutboundCommandType,
): OutboundErrorCode {
  if (isPlaceUnavailable(error)) return 'place_unavailable';
  if (commandType === 'create_topic') return 'create_topic_failed';
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

function threadOptions(place: Place) {
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
