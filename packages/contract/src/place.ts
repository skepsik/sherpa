import { isRecord } from './wire';

/**
 * Место разговора на границе транспорт ↔ раннер.
 * Роли: личка (привратник) / топик (агент проекта). Идентификаторы opaque для транспорта.
 */
export type Place =
  | { chatId: string; kind: 'direct' }
  | { chatId: string; kind: 'topic'; topicId: string };

export type TopicPlace = Extract<Place, { kind: 'topic' }>;

/** Мягкий разбор Place с провода. */
export function findPlace(value: unknown): null | Place {
  if (!isRecord(value)) return null;
  if (typeof value.chatId !== 'string' || value.chatId.length === 0) {
    return null;
  }
  if (value.kind === 'direct') return { chatId: value.chatId, kind: 'direct' };
  if (value.kind === 'topic') {
    if (typeof value.topicId !== 'string' || value.topicId.length === 0) {
      return null;
    }
    return { chatId: value.chatId, kind: 'topic', topicId: value.topicId };
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
