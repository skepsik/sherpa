import type {
  OutboundCommand,
  OutboundCommandType,
  OutboundCreateTopic,
  OutboundEditText,
  OutboundError,
  OutboundErrorCode,
  OutboundInlineButton,
  OutboundResult,
  OutboundSendButtons,
  OutboundSendOkCommandType,
  OutboundSendText,
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
    case 'edit_text':
      return executeEditText(api, command);
    case 'send_buttons':
      return executeSendButtons(api, command);
    case 'send_text':
      return executeSendText(api, command);
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

async function executeEditText(
  api: OutboundApi,
  command: OutboundEditText,
): Promise<OutboundResult> {
  if (command.text.length > TELEGRAM_TEXT_MAX_CHARS) {
    return rejected(
      'edit_text',
      'text exceeds Telegram limit of 4096 characters',
    );
  }

  const markup = findEditReplyMarkup(command);
  if (markup === 'pack_failed') {
    return rejected('edit_text', 'callback_data exceeds 64 bytes');
  }
  if (markup === 'missing_request_id') {
    return rejected('edit_text', 'requestId required when replacing buttons');
  }

  try {
    const edited = await callWithRateLimitRetry(() =>
      api.editMessageText(
        command.place.chatId,
        Number(command.messageId),
        command.text,
        markup === undefined ? undefined : { reply_markup: markup },
      ),
    );
    const messageId =
      edited === true ? command.messageId : String(edited.message_id);
    return sendOk('edit_text', messageId);
  } catch (error) {
    if (isMessageNotModified(error)) {
      return sendOk('edit_text', command.messageId);
    }
    return mapApiError(error, 'edit_text');
  }
}

async function executeSendButtons(
  api: OutboundApi,
  command: OutboundSendButtons,
): Promise<OutboundResult> {
  if (command.text.length > TELEGRAM_TEXT_MAX_CHARS) {
    return rejected(
      'send_buttons',
      'text exceeds Telegram limit of 4096 characters',
    );
  }

  const keyboard = tryBuildInlineKeyboard(command.requestId, command.buttons);
  if (keyboard === null) {
    return rejected('send_buttons', 'callback_data exceeds 64 bytes');
  }

  try {
    const message = await callWithRateLimitRetry(() =>
      api.sendMessage(command.place.chatId, command.text, {
        ...threadOptions(command.place),
        reply_markup: { inline_keyboard: keyboard },
      }),
    );
    return sendOk('send_buttons', String(message.message_id));
  } catch (error) {
    return mapApiError(error, 'send_buttons');
  }
}

async function executeSendText(
  api: OutboundApi,
  command: OutboundSendText,
): Promise<OutboundResult> {
  if (command.text.length > TELEGRAM_TEXT_MAX_CHARS) {
    return rejected(
      'send_text',
      'text exceeds Telegram limit of 4096 characters',
    );
  }

  try {
    const message = await callWithRateLimitRetry(() =>
      api.sendMessage(
        command.place.chatId,
        command.text,
        threadOptions(command.place),
      ),
    );
    return sendOk('send_text', String(message.message_id));
  } catch (error) {
    return mapApiError(error, 'send_text');
  }
}

/**
 * `undefined` — markup не трогать;
 * объект — заменить (пустой keyboard = убрать кнопки);
 * `pack_failed` / `missing_request_id` — отказ до API.
 */
function findEditReplyMarkup(
  command: OutboundEditText,
):
  | 'missing_request_id'
  | 'pack_failed'
  | undefined
  | { inline_keyboard: InlineKeyboard } {
  if (command.buttons === undefined) return undefined;
  if (command.buttons.length === 0) {
    return { inline_keyboard: [] };
  }
  const requestId = command.requestId;
  if (requestId === undefined || requestId === '') {
    return 'missing_request_id';
  }
  const keyboard = tryBuildInlineKeyboard(requestId, command.buttons);
  if (keyboard === null) return 'pack_failed';
  return { inline_keyboard: keyboard };
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

function sendOk(
  commandType: OutboundSendOkCommandType,
  messageId: string,
): OutboundResult {
  return { commandType, messageId, type: 'send_ok' };
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
