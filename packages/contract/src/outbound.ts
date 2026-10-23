import type { Place, TopicPlace } from './place';
import type { WireDirection } from './wire';

import { assertNever } from './assert';
import { findPlace } from './place';
import { findNonEmptyString, isRecord, WIRE_VERSION } from './wire';

export const OUTBOUND_COMMAND_TYPES = [
  'send_message',
  'send_question',
  'resolve_question',
  'set_status',
  'create_topic',
] as const;

export const OUTBOUND_ERROR_CODES = [
  'create_topic_failed',
  'place_unavailable',
  'send_failed',
  'transport_rejected',
] as const;

export const OUTBOUND_RESULT_TYPES = [
  'create_topic_ok',
  'error',
  'question_ok',
  'send_ok',
] as const;

export const OUTBOUND_SEND_OK_COMMAND_TYPES = [
  'send_message',
  'resolve_question',
  'set_status',
] as const;

export const OUTBOUND_STATUS_VALUES = ['busy', 'idle'] as const;

/**
 * Команда раннер → транспорт.
 * Нет project / access / cwd — маршрутизацию решает раннер.
 */
export type OutboundCommand =
  | OutboundCreateTopic
  | OutboundResolveQuestion
  | OutboundSendMessage
  | OutboundSendQuestion
  | OutboundSetStatus;

/** Envelope команды на проводе. */
export type OutboundCommandEnvelope = {
  command: OutboundCommand;
  direction: Extract<WireDirection, 'outbound'>;
  /** Корреляция с `OutboundResultEnvelope.id`. */
  id: string;
  v: typeof WIRE_VERSION;
};

export type OutboundCommandType = (typeof OUTBOUND_COMMAND_TYPES)[number];

/** Создать топик в супергруппе (forum). */
export type OutboundCreateTopic = {
  /** Чат супергруппы, где создать топик. */
  chatId: string;
  title: string;
  type: 'create_topic';
};

/** Успешное создание топика: место для маршрутизации. */
export type OutboundCreateTopicOk = {
  place: TopicPlace;
  type: 'create_topic_ok';
};

/**
 * Отказ транспорта: команда не исполнена.
 * `commandType` — тип команды, на которой отказ.
 */
export type OutboundError = {
  code: OutboundErrorCode;
  commandType: OutboundCommandType;
  message?: string;
  type: 'error';
};

export type OutboundErrorCode = (typeof OUTBOUND_ERROR_CODES)[number];

/** Кнопка: `data` станет `InboundQuestionAnswer.data` при нажатии. */
export type OutboundInlineButton = {
  data: string;
  label: string;
};

/**
 * Успех `send_question`: id сообщения нужен для `resolve_question`.
 */
export type OutboundQuestionOk = {
  commandType: 'send_question';
  messageId: string;
  type: 'question_ok';
};

/**
 * Зафиксировать выбор на сообщении-вопросе: новый текст, кнопки снять.
 * Единственный edit на проводе.
 */
export type OutboundResolveQuestion = {
  messageId: string;
  place: Place;
  text: string;
  type: 'resolve_question';
};

/** Исход команды транспорт → раннер. */
export type OutboundResult =
  OutboundCreateTopicOk | OutboundError | OutboundQuestionOk | OutboundSendOk;

/** Envelope исхода на проводе (тот же `direction`, поле `result`). */
export type OutboundResultEnvelope = {
  direction: Extract<WireDirection, 'outbound'>;
  /** Тот же id, что у команды. */
  id: string;
  result: OutboundResult;
  v: typeof WIRE_VERSION;
};

export type OutboundResultType = (typeof OUTBOUND_RESULT_TYPES)[number];

/** Отправить текст в место (личка или топик). */
export type OutboundSendMessage = {
  place: Place;
  text: string;
  type: 'send_message';
};

/** Успех `send_message` / `resolve_question` / `set_status` — без `messageId`. */
export type OutboundSendOk = {
  commandType: OutboundSendOkCommandType;
  type: 'send_ok';
};

export type OutboundSendOkCommandType =
  (typeof OUTBOUND_SEND_OK_COMMAND_TYPES)[number];

/**
 * Вопрос с inline-кнопками.
 * `requestId` + `buttons[].data` совместимы с inbound `question_answer`.
 */
export type OutboundSendQuestion = {
  buttons: OutboundInlineButton[];
  place: Place;
  requestId: string;
  text: string;
  type: 'send_question';
};

/** Статус индикатора в Place; исполнение на транспорте — заглушка. */
export type OutboundSetStatus = {
  place: Place;
  status: OutboundStatus;
  type: 'set_status';
};

export type OutboundStatus = (typeof OUTBOUND_STATUS_VALUES)[number];

export function encodeOutbound(id: string, command: OutboundCommand): string {
  const envelope: OutboundCommandEnvelope = {
    command,
    direction: 'outbound',
    id,
    v: WIRE_VERSION,
  };
  return JSON.stringify(envelope);
}

export function encodeOutboundResult(
  id: string,
  result: OutboundResult,
): string {
  const envelope: OutboundResultEnvelope = {
    direction: 'outbound',
    id,
    result,
    v: WIRE_VERSION,
  };
  return JSON.stringify(envelope);
}

/** Мягкий разбор команды: невалидный wire → `null`. */
export function tryDecodeOutbound(
  raw: string,
): null | { command: OutboundCommand; id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return findOutboundCommandEnvelope(parsed);
}

/** Мягкий разбор исхода: невалидный wire → `null`. */
export function tryDecodeOutboundResult(
  raw: string,
): null | { id: string; result: OutboundResult } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return findOutboundResultEnvelope(parsed);
}

function findButtons(value: unknown): null | OutboundInlineButton[] {
  if (!Array.isArray(value)) return null;
  const buttons: OutboundInlineButton[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const label = findNonEmptyString(item.label);
    if (!label) return null;
    const data = findNonEmptyString(item.data);
    if (!data) return null;
    buttons.push({ data, label });
  }
  return buttons;
}

function findCommand(value: unknown): null | OutboundCommand {
  if (!isRecord(value)) return null;
  if (!isCommandType(value.type)) return null;
  switch (value.type) {
    case 'create_topic':
      return findCreateTopic(value);
    case 'resolve_question':
      return findResolveQuestion(value);
    case 'send_message':
      return findSendMessage(value);
    case 'send_question':
      return findSendQuestion(value);
    case 'set_status':
      return findSetStatus(value);
    default:
      return assertNever(value.type);
  }
}

function findCreateTopic(
  value: Record<string, unknown>,
): null | OutboundCreateTopic {
  const chatId = findNonEmptyString(value.chatId);
  if (!chatId) return null;
  const title = findNonEmptyString(value.title);
  if (!title) return null;
  return { chatId, title, type: 'create_topic' };
}

function findCreateTopicOk(
  value: Record<string, unknown>,
): null | OutboundCreateTopicOk {
  const place = findPlace(value.place);
  if (!place || place.kind !== 'topic') return null;
  return { place, type: 'create_topic_ok' };
}

function findError(value: Record<string, unknown>): null | OutboundError {
  if (!isErrorCode(value.code)) return null;
  if (!isCommandType(value.commandType)) return null;
  const error: OutboundError = {
    code: value.code,
    commandType: value.commandType,
    type: 'error',
  };
  if (value.message !== undefined) {
    if (typeof value.message !== 'string') return null;
    error.message = value.message;
  }
  return error;
}

function findOutboundCommandEnvelope(
  value: unknown,
): null | { command: OutboundCommand; id: string } {
  if (!isRecord(value)) return null;
  if (value.v !== WIRE_VERSION) return null;
  if (value.direction !== 'outbound') return null;
  const id = findNonEmptyString(value.id);
  if (!id) return null;
  if ('result' in value && value.result !== undefined) return null;
  const command = findCommand(value.command);
  if (!command) return null;
  return { command, id };
}

function findOutboundResultEnvelope(
  value: unknown,
): null | { id: string; result: OutboundResult } {
  if (!isRecord(value)) return null;
  if (value.v !== WIRE_VERSION) return null;
  if (value.direction !== 'outbound') return null;
  const id = findNonEmptyString(value.id);
  if (!id) return null;
  if ('command' in value && value.command !== undefined) return null;
  const result = findResult(value.result);
  if (!result) return null;
  return { id, result };
}

function findQuestionOk(
  value: Record<string, unknown>,
): null | OutboundQuestionOk {
  if (value.commandType !== 'send_question') return null;
  const messageId = findNonEmptyString(value.messageId);
  if (!messageId) return null;
  return { commandType: 'send_question', messageId, type: 'question_ok' };
}

function findResolveQuestion(
  value: Record<string, unknown>,
): null | OutboundResolveQuestion {
  const place = findPlace(value.place);
  if (!place) return null;
  const messageId = findNonEmptyString(value.messageId);
  if (!messageId) return null;
  const text = findNonEmptyString(value.text);
  if (!text) return null;
  return { messageId, place, text, type: 'resolve_question' };
}

function findResult(value: unknown): null | OutboundResult {
  if (!isRecord(value)) return null;
  if (!isResultType(value.type)) return null;
  switch (value.type) {
    case 'create_topic_ok':
      return findCreateTopicOk(value);
    case 'error':
      return findError(value);
    case 'question_ok':
      return findQuestionOk(value);
    case 'send_ok':
      return findSendOk(value);
    default:
      return assertNever(value.type);
  }
}

function findSendMessage(
  value: Record<string, unknown>,
): null | OutboundSendMessage {
  const place = findPlace(value.place);
  if (!place) return null;
  const text = findNonEmptyString(value.text);
  if (!text) return null;
  return { place, text, type: 'send_message' };
}

function findSendOk(value: Record<string, unknown>): null | OutboundSendOk {
  if (!isSendOkCommandType(value.commandType)) return null;
  if (value.messageId !== undefined) return null;
  return { commandType: value.commandType, type: 'send_ok' };
}

function findSendQuestion(
  value: Record<string, unknown>,
): null | OutboundSendQuestion {
  const place = findPlace(value.place);
  if (!place) return null;
  const text = findNonEmptyString(value.text);
  if (!text) return null;
  const requestId = findNonEmptyString(value.requestId);
  if (!requestId) return null;
  const buttons = findButtons(value.buttons);
  if (!buttons || buttons.length === 0) return null;
  return { buttons, place, requestId, text, type: 'send_question' };
}

function findSetStatus(
  value: Record<string, unknown>,
): null | OutboundSetStatus {
  const place = findPlace(value.place);
  if (!place) return null;
  if (!isStatus(value.status)) return null;
  return { place, status: value.status, type: 'set_status' };
}

function isCommandType(value: unknown): value is OutboundCommandType {
  return (
    typeof value === 'string' &&
    (OUTBOUND_COMMAND_TYPES as readonly string[]).includes(value)
  );
}

function isErrorCode(value: unknown): value is OutboundErrorCode {
  return (
    typeof value === 'string' &&
    (OUTBOUND_ERROR_CODES as readonly string[]).includes(value)
  );
}

function isResultType(value: unknown): value is OutboundResultType {
  return (
    typeof value === 'string' &&
    (OUTBOUND_RESULT_TYPES as readonly string[]).includes(value)
  );
}

function isSendOkCommandType(
  value: unknown,
): value is OutboundSendOkCommandType {
  return (
    typeof value === 'string' &&
    (OUTBOUND_SEND_OK_COMMAND_TYPES as readonly string[]).includes(value)
  );
}

function isStatus(value: unknown): value is OutboundStatus {
  return (
    typeof value === 'string' &&
    (OUTBOUND_STATUS_VALUES as readonly string[]).includes(value)
  );
}
