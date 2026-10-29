import type { Place } from '@sherpa/contract';

import type { TelegramPlace } from './types';

/**
 * Версия кодека в префиксе id.
 * Смена формата, ломающая уже выданные id, — только с явной миграцией.
 */
export const PLACE_ID_CODEC = 'tg1';

/** Telegram-место → opaque Place (стабильная строка без whitespace). */
export function encodePlaceId(place: TelegramPlace): Place {
  if (place.kind === 'direct') {
    return `${PLACE_ID_CODEC}:d:${place.chatId}`;
  }
  return `${PLACE_ID_CODEC}:t:${place.chatId}:${place.topicId}`;
}

/** Opaque Place → Telegram-место; чужой / битый id → `null`. */
export function findTelegramPlace(placeId: Place): null | TelegramPlace {
  const parts = placeId.split(':');
  if (parts[0] !== PLACE_ID_CODEC) return null;
  if (parts[1] === 'd') {
    if (parts.length !== 3) return null;
    const chatId = parts[2];
    if (chatId === undefined || chatId === '' || /\s/.test(chatId)) {
      return null;
    }
    return { chatId, kind: 'direct' };
  }
  if (parts[1] === 't') {
    if (parts.length !== 4) return null;
    const chatId = parts[2];
    const topicId = parts[3];
    if (
      chatId === undefined ||
      chatId === '' ||
      /\s/.test(chatId) ||
      topicId === undefined ||
      topicId === '' ||
      /\s/.test(topicId)
    ) {
      return null;
    }
    return { chatId, kind: 'topic', topicId };
  }
  return null;
}
