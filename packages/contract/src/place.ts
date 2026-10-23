import { findNonEmptyString, isRecord } from './wire';

/**
 * Место разговора на границе транспорт ↔ раннер:
 * личный чат (`direct`) или топик (`topic`). Идентификаторы opaque для транспорта.
 */
export type Place =
  | { chatId: string; kind: 'direct' }
  | { chatId: string; kind: 'topic'; topicId: string };

export type TopicPlace = Extract<Place, { kind: 'topic' }>;

/** Мягкий разбор Place с провода. */
export function findPlace(value: unknown): null | Place {
  if (!isRecord(value)) return null;
  const chatId = findNonEmptyString(value.chatId);
  if (!chatId) return null;
  if (value.kind === 'direct') return { chatId, kind: 'direct' };
  if (value.kind === 'topic') {
    const topicId = findNonEmptyString(value.topicId);
    if (!topicId) return null;
    return { chatId, kind: 'topic', topicId };
  }
  return null;
}

export function isDirectPlace(
  place: Place,
): place is Extract<Place, { kind: 'direct' }> {
  return place.kind === 'direct';
}

export function isTopicPlace(place: Place): place is TopicPlace {
  return place.kind === 'topic';
}
