import type { Place, TopicPlace } from './types';

import { findNonEmptyString, isRecord } from './wire';

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
