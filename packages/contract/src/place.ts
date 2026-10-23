/**
 * Место разговора на границе транспорт → раннер.
 * Роли: личка (привратник) / топик (агент проекта). Идентификаторы opaque для транспорта.
 */
export type Place =
  | { chatId: string; kind: 'direct' }
  | { chatId: string; kind: 'topic'; topicId: string };

export function isDirectPlace(
  place: Place,
): place is Extract<Place, { kind: 'direct' }> {
  return place.kind === 'direct';
}

export function isTopicPlace(
  place: Place,
): place is Extract<Place, { kind: 'topic' }> {
  return place.kind === 'topic';
}
