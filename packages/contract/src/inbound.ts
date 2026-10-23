import type { Place } from './place';
import type { WireDirection } from './wire';

import { assertNever } from './assert';
import { findPlace } from './place';
import { findNonEmptyString, isRecord, WIRE_VERSION } from './wire';

export const INBOUND_EVENT_TYPES = ['message', 'question_answer'] as const;

/** Успешный разбор inbound с провода. */
export type InboundDecoded = {
  event: InboundEvent;
  eventId: string;
};

/**
 * Envelope inbound на проводе.
 * `eventId` — дедуп у раннера (для Telegram — строка из `update_id`).
 */
export type InboundEnvelope = {
  direction: Extract<WireDirection, 'inbound'>;
  event: InboundEvent;
  eventId: string;
  v: typeof WIRE_VERSION;
};

export type InboundEvent = InboundMessage | InboundQuestionAnswer;

export type InboundEventType = (typeof INBOUND_EVENT_TYPES)[number];

/** Текст пользователя в месте разговора. */
export type InboundMessage = {
  place: Place;
  /** Непустой текст сообщения. */
  text: string;
  type: 'message';
};

/**
 * Ответ на вопрос (нажатие inline-кнопки).
 * `requestId` — корреляция с исходящим `send_question`.
 * `data` — opaque payload выбора кнопки.
 */
export type InboundQuestionAnswer = {
  data: string;
  place: Place;
  requestId: string;
  type: 'question_answer';
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

function findEventBody(value: unknown): InboundEvent | null {
  if (!isRecord(value)) return null;
  if (!isEventType(value.type)) return null;
  switch (value.type) {
    case 'message':
      return findMessage(value);
    case 'question_answer':
      return findQuestionAnswer(value);
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

function findMessage(value: Record<string, unknown>): InboundMessage | null {
  const place = findPlace(value.place);
  if (!place) return null;
  const text = findNonEmptyString(value.text);
  if (!text) return null;
  return { place, text, type: 'message' };
}

function findQuestionAnswer(
  value: Record<string, unknown>,
): InboundQuestionAnswer | null {
  const place = findPlace(value.place);
  if (!place) return null;
  const data = findNonEmptyString(value.data);
  if (!data) return null;
  const requestId = findNonEmptyString(value.requestId);
  if (!requestId) return null;
  return { data, place, requestId, type: 'question_answer' };
}

function isEventType(value: unknown): value is InboundEventType {
  return (
    typeof value === 'string' &&
    (INBOUND_EVENT_TYPES as readonly string[]).includes(value)
  );
}
