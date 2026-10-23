import type { Place } from './place';
import type { WireDirection } from './wire';

import { WIRE_VERSION } from './wire';

/**
 * Нажатие inline-кнопки.
 * `requestId` — корреляция с исходящим запросом permission/кнопки
 * (тот же id, что раннер положил в outbound с кнопками).
 * `data` — opaque payload выбора кнопки.
 */
export type InboundCallback = {
  data: string;
  place: Place;
  requestId: string;
  type: 'callback';
};

/** Envelope inbound на проводе. */
export type InboundEnvelope = {
  direction: Extract<WireDirection, 'inbound'>;
  event: InboundEvent;
  v: typeof WIRE_VERSION;
};

export type InboundEvent = InboundCallback | InboundUserMessage;

/** Сообщение пользователя в месте разговора. */
export type InboundUserMessage = {
  place: Place;
  /** Текст, если в апдейте он был. */
  text?: string;
  type: 'user_message';
};

export function encodeInbound(event: InboundEvent): string {
  const envelope: InboundEnvelope = {
    direction: 'inbound',
    event,
    v: WIRE_VERSION,
  };
  return JSON.stringify(envelope);
}

/** Мягкий разбор: невалидный wire → `null` (событие не принимать). */
export function tryDecodeInbound(raw: string): InboundEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return findInboundEvent(parsed);
}

function findCallback(value: Record<string, unknown>): InboundCallback | null {
  const place = findPlace(value.place);
  if (!place) return null;
  if (typeof value.data !== 'string' || value.data.length === 0) return null;
  if (typeof value.requestId !== 'string' || value.requestId.length === 0) {
    return null;
  }
  return {
    data: value.data,
    place,
    requestId: value.requestId,
    type: 'callback',
  };
}

function findEventBody(value: unknown): InboundEvent | null {
  if (!isRecord(value)) return null;
  if (value.type === 'user_message') return findUserMessage(value);
  if (value.type === 'callback') return findCallback(value);
  return null;
}

function findInboundEvent(value: unknown): InboundEvent | null {
  if (!isRecord(value)) return null;
  if (value.v !== WIRE_VERSION) return null;
  if (value.direction !== 'inbound') return null;
  return findEventBody(value.event);
}

function findPlace(value: unknown): null | Place {
  if (!isRecord(value)) return null;
  if (typeof value.chatId !== 'string' || value.chatId.length === 0)
    return null;
  if (value.kind === 'direct') return { chatId: value.chatId, kind: 'direct' };
  if (value.kind === 'topic') {
    if (typeof value.topicId !== 'string' || value.topicId.length === 0) {
      return null;
    }
    return { chatId: value.chatId, kind: 'topic', topicId: value.topicId };
  }
  return null;
}

function findUserMessage(
  value: Record<string, unknown>,
): InboundUserMessage | null {
  const place = findPlace(value.place);
  if (!place) return null;
  if (value.text === undefined) return { place, type: 'user_message' };
  if (typeof value.text !== 'string') return null;
  return { place, text: value.text, type: 'user_message' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
