import type {
  InboundDecoded,
  InboundEnvelope,
  InboundEvent,
  InboundEventType,
  InboundMessage,
  InboundQuestionAnswer,
  InboundSessionBreak,
  MessageDelivery,
} from './types';

import { assertNever } from './assert';
import { findPlace } from './place';
import { findNonEmptyString, isRecord, WIRE_VERSION } from './wire';

export const INBOUND_EVENT_TYPES = [
  'message',
  'question_answer',
  'session_break',
] as const satisfies readonly InboundEventType[];

export const MESSAGE_DELIVERY_VALUES = [
  'after',
  'interject',
] as const satisfies readonly MessageDelivery[];

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
    case 'session_break':
      return findSessionBreak(value);
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
  if (!('delivery' in value) || value.delivery === undefined) {
    return { place, text, type: 'message' };
  }
  const delivery = findMessageDelivery(value.delivery);
  if (!delivery) return null;
  return { delivery, place, text, type: 'message' };
}

function findMessageDelivery(value: unknown): MessageDelivery | null {
  if (typeof value !== 'string') return null;
  if (!(MESSAGE_DELIVERY_VALUES as readonly string[]).includes(value)) {
    return null;
  }
  return value as MessageDelivery;
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

function findSessionBreak(
  value: Record<string, unknown>,
): InboundSessionBreak | null {
  const place = findPlace(value.place);
  if (!place) return null;
  return { place, type: 'session_break' };
}

function isEventType(value: unknown): value is InboundEventType {
  return (
    typeof value === 'string' &&
    (INBOUND_EVENT_TYPES as readonly string[]).includes(value)
  );
}
