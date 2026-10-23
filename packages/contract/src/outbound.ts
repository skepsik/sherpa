import type { Place, TopicPlace } from './place';
import type { WireDirection } from './wire';

import { assertNever } from './assert';
import { findPlace } from './place';
import { findNonEmptyString, isRecord, WIRE_VERSION } from './wire';

export const OUTBOUND_COMMAND_TYPES = [
  'send_text',
  'send_buttons',
  'edit_text',
  'create_topic',
] as const;

export const OUTBOUND_ERROR_CODES = [
  'create_topic_failed',
  'place_unavailable',
  'send_failed',
  'transport_rejected',
] as const;

export const OUTBOUND_SEND_OK_COMMAND_TYPES = [
  'send_text',
  'send_buttons',
  'edit_text',
] as const;

/**
 * Команда раннер → транспорт.
 * Нет project / access / cwd — маршрутизацию решает раннер.
 */
export type OutboundCommand =
  | OutboundCreateTopic
  | OutboundEditText
  | OutboundSendButtons
  | OutboundSendText;

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
 * Редактировать уже отправленное сообщение (стрим в топик / снять кнопки).
 * `buttons` отсутствует — разметку не трогать; `[]` — убрать inline-кнопки.
 */
export type OutboundEditText = {
  /** Если задано (в т.ч. `[]`) — заменить reply markup. */
  buttons?: OutboundInlineButton[];
  messageId: string;
  place: Place;
  text: string;
  type: 'edit_text';
};

/**
 * Отказ транспорта: команда не исполнена.
 * `code` — invent; канал — ответ на команду.
 */
export type OutboundError = {
  code: OutboundErrorCode;
  /** Тип исходной команды, если известен. */
  commandType?: OutboundCommandType;
  message?: string;
  type: 'error';
};

export type OutboundErrorCode = (typeof OUTBOUND_ERROR_CODES)[number];

/** Кнопка: `data` станет `InboundCallback.data` при нажатии. */
export type OutboundInlineButton = {
  data: string;
  label: string;
};

/** Исход команды транспорт → раннер. */
export type OutboundResult =
  OutboundCreateTopicOk | OutboundError | OutboundSendOk;

/** Envelope исхода на проводе (тот же `direction`, поле `result`). */
export type OutboundResultEnvelope = {
  direction: Extract<WireDirection, 'outbound'>;
  /** Тот же id, что у команды. */
  id: string;
  result: OutboundResult;
  v: typeof WIRE_VERSION;
};

/**
 * Сообщение с inline-кнопками (permission / подтверждение).
 * `requestId` + `buttons[].data` совместимы с inbound `callback`.
 */
export type OutboundSendButtons = {
  buttons: OutboundInlineButton[];
  place: Place;
  requestId: string;
  text: string;
  type: 'send_buttons';
};

/** Успешная отправка или правка текста/кнопок. */
export type OutboundSendOk = {
  commandType: OutboundSendOkCommandType;
  /** Id сообщения в транспорте (для последующего edit_text). */
  messageId: string;
  type: 'send_ok';
};

export type OutboundSendOkCommandType =
  (typeof OUTBOUND_SEND_OK_COMMAND_TYPES)[number];

/** Отправить текст в место (личка или топик). */
export type OutboundSendText = {
  place: Place;
  text: string;
  type: 'send_text';
};

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
    case 'edit_text':
      return findEditText(value);
    case 'send_buttons':
      return findSendButtons(value);
    case 'send_text':
      return findSendText(value);
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

function findEditText(value: Record<string, unknown>): null | OutboundEditText {
  const place = findPlace(value.place);
  if (!place) return null;
  const messageId = findNonEmptyString(value.messageId);
  if (!messageId) return null;
  const text = findNonEmptyString(value.text);
  if (!text) return null;
  if (value.buttons === undefined) {
    return { messageId, place, text, type: 'edit_text' };
  }
  const buttons = findButtons(value.buttons);
  if (!buttons) return null;
  return { buttons, messageId, place, text, type: 'edit_text' };
}

function findError(value: Record<string, unknown>): null | OutboundError {
  if (!isErrorCode(value.code)) return null;
  const error: OutboundError = { code: value.code, type: 'error' };
  if (value.message !== undefined) {
    if (typeof value.message !== 'string') return null;
    error.message = value.message;
  }
  if (value.commandType !== undefined) {
    if (!isCommandType(value.commandType)) return null;
    error.commandType = value.commandType;
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

function findResult(value: unknown): null | OutboundResult {
  if (!isRecord(value)) return null;
  if (value.type === 'send_ok') return findSendOk(value);
  if (value.type === 'create_topic_ok') return findCreateTopicOk(value);
  if (value.type === 'error') return findError(value);
  return null;
}

function findSendButtons(
  value: Record<string, unknown>,
): null | OutboundSendButtons {
  const place = findPlace(value.place);
  if (!place) return null;
  const text = findNonEmptyString(value.text);
  if (!text) return null;
  const requestId = findNonEmptyString(value.requestId);
  if (!requestId) return null;
  const buttons = findButtons(value.buttons);
  if (!buttons || buttons.length === 0) return null;
  return { buttons, place, requestId, text, type: 'send_buttons' };
}

function findSendOk(value: Record<string, unknown>): null | OutboundSendOk {
  if (!isSendOkCommandType(value.commandType)) return null;
  const messageId = findNonEmptyString(value.messageId);
  if (!messageId) return null;
  return { commandType: value.commandType, messageId, type: 'send_ok' };
}

function findSendText(value: Record<string, unknown>): null | OutboundSendText {
  const place = findPlace(value.place);
  if (!place) return null;
  const text = findNonEmptyString(value.text);
  if (!text) return null;
  return { place, text, type: 'send_text' };
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

function isSendOkCommandType(
  value: unknown,
): value is OutboundSendOkCommandType {
  return (
    typeof value === 'string' &&
    (OUTBOUND_SEND_OK_COMMAND_TYPES as readonly string[]).includes(value)
  );
}
