/**
 * Место разговора на границе транспорт ↔ раннер:
 * личный чат (`direct`) или топик (`topic`). Идентификаторы opaque для транспорта.
 */
export type Place =
  | { chatId: string; kind: 'direct' }
  | { chatId: string; kind: 'topic'; topicId: string };

export type TopicPlace = Extract<Place, { kind: 'topic' }>;
