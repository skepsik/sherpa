import type { Place, TopicPlace } from './place';
import type { WireDirection } from './wire';

import { findPlace } from './place';
import { WIRE_VERSION } from './wire';

/**
 * Команда раннер → транспорт.
 * Нет project / access / cwd — маршрутизацию решает раннер.
 */
export type OutboundCommand =
  OutboundCreateTopic | OutboundSendButtons | OutboundSendText;

/** Envelope команды на проводе. */
export type OutboundCommandEnvelope = {
  command: OutboundCommand;
  direction: Extract<WireDirection, 'outbound'>;
  /** Корреляция с `OutboundResultEnvelope.id`. */
  id: string;
  v: typeof WIRE_VERSION;
};

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
 * `code` — invent; канал — ответ на команду.
 */
export type OutboundError = {
  code: OutboundErrorCode;
  /** Тип исходной команды, если известен. */
  commandType?: OutboundCommand['type'];
  message?: string;
  type: 'error';
};

export type OutboundErrorCode =
  | 'create_topic_failed'
  | 'place_unavailable'
  | 'send_failed'
  | 'transport_rejected';

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

/** Успешная отправка текста или кнопок. */
export type OutboundSendOk = {
  commandType: 'send_buttons' | 'send_text';
  type: 'send_ok';
};

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
  if (!Array.isArray(value) || value.length === 0) return null;
  const buttons: OutboundInlineButton[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (typeof item.label !== 'string' || item.label.length === 0) return null;
    if (typeof item.data !== 'string' || item.data.length === 0) return null;
    buttons.push({ data: item.data, label: item.label });
  }
  return buttons;
}

function findCommand(value: unknown): null | OutboundCommand {
  if (!isRecord(value)) return null;
  if (value.type === 'send_text') return findSendText(value);
  if (value.type === 'send_buttons') return findSendButtons(value);
  if (value.type === 'create_topic') return findCreateTopic(value);
  return null;
}

function findCreateTopic(
  value: Record<string, unknown>,
): null | OutboundCreateTopic {
  if (typeof value.chatId !== 'string' || value.chatId.length === 0) {
    return null;
  }
  if (typeof value.title !== 'string' || value.title.length === 0) return null;
  return { chatId: value.chatId, title: value.title, type: 'create_topic' };
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
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if ('result' in value && value.result !== undefined) return null;
  const command = findCommand(value.command);
  if (!command) return null;
  return { command, id: value.id };
}

function findOutboundResultEnvelope(
  value: unknown,
): null | { id: string; result: OutboundResult } {
  if (!isRecord(value)) return null;
  if (value.v !== WIRE_VERSION) return null;
  if (value.direction !== 'outbound') return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if ('command' in value && value.command !== undefined) return null;
  const result = findResult(value.result);
  if (!result) return null;
  return { id: value.id, result };
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
  if (typeof value.text !== 'string' || value.text.length === 0) return null;
  if (typeof value.requestId !== 'string' || value.requestId.length === 0) {
    return null;
  }
  const buttons = findButtons(value.buttons);
  if (!buttons) return null;
  return {
    buttons,
    place,
    requestId: value.requestId,
    text: value.text,
    type: 'send_buttons',
  };
}

function findSendOk(value: Record<string, unknown>): null | OutboundSendOk {
  if (
    value.commandType !== 'send_text' &&
    value.commandType !== 'send_buttons'
  ) {
    return null;
  }
  return { commandType: value.commandType, type: 'send_ok' };
}

function findSendText(value: Record<string, unknown>): null | OutboundSendText {
  const place = findPlace(value.place);
  if (!place) return null;
  if (typeof value.text !== 'string' || value.text.length === 0) return null;
  return { place, text: value.text, type: 'send_text' };
}

function isCommandType(value: unknown): value is OutboundCommand['type'] {
  return (
    value === 'send_text' ||
    value === 'send_buttons' ||
    value === 'create_topic'
  );
}

function isErrorCode(value: unknown): value is OutboundErrorCode {
  return (
    value === 'send_failed' ||
    value === 'create_topic_failed' ||
    value === 'place_unavailable' ||
    value === 'transport_rejected'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
