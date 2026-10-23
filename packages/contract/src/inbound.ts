import type { Place } from './place';
import type { WireDirection } from './wire';

import { assertNever } from './assert';
import { findPlace } from './place';
import { findNonEmptyString, isRecord, WIRE_VERSION } from './wire';

export const INBOUND_EVENT_TYPES = ['callback', 'user_message'] as const;

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

/** Успешный разбор inbound с провода. */
export type InboundDecoded = {
  event: InboundEvent;
  eventId: string;
};

/**
 * Envelope inbound на проводе.
 * `eventId` — идемпотентность при at-least-once (напр. Telegram `update_id`).
 */
export type InboundEnvelope = {
  direction: Extract<WireDirection, 'inbound'>;
  event: InboundEvent;
  eventId: string;
  v: typeof WIRE_VERSION;
};

export type InboundEvent = InboundCallback | InboundUserMessage;

export type InboundEventType = (typeof INBOUND_EVENT_TYPES)[number];

/** Сообщение пользователя в месте разговора. */
export type InboundUserMessage = {
  place: Place;
  /** Текст, если в апдейте он был. */
  text?: string;
  type: 'user_message';
};

export function encodeInbound(eventId: string, event: InboundEvent): string {
  const envelope: InboundEnvelope = {
    direction: 'inbound',
    event,
    eventId,
    v: WIRE_VERSION,
  };
  return JSON.stringify(envelope);
}

/** Мягкий разбор: невалидный wire → `null` (событие не принимать). */
export function tryDecodeInbound(raw: string): InboundDecoded | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return findInboundEnvelope(parsed);
}

function findCallback(value: Record<string, unknown>): InboundCallback | null {
  const place = findPlace(value.place);
  if (!place) return null;
  const data = findNonEmptyString(value.data);
  if (!data) return null;
  const requestId = findNonEmptyString(value.requestId);
  if (!requestId) return null;
  return { data, place, requestId, type: 'callback' };
}

function findEventBody(value: unknown): InboundEvent | null {
  if (!isRecord(value)) return null;
  if (!isEventType(value.type)) return null;
  switch (value.type) {
    case 'callback':
      return findCallback(value);
    case 'user_message':
      return findUserMessage(value);
    default:
      return assertNever(value.type);
  }
}

function findInboundEnvelope(value: unknown): InboundDecoded | null {
  if (!isRecord(value)) return null;
  if (value.v !== WIRE_VERSION) return null;
  if (value.direction !== 'inbound') return null;
  const eventId = findNonEmptyString(value.eventId);
  if (!eventId) return null;
  const event = findEventBody(value.event);
  if (!event) return null;
  return { event, eventId };
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

function isEventType(value: unknown): value is InboundEventType {
  return (
    typeof value === 'string' &&
    (INBOUND_EVENT_TYPES as readonly string[]).includes(value)
  );
}
