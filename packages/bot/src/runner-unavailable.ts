import type { Place } from '@sherpa/contract';

import type { NotifyApi, TelegramPlace } from './types';

import { findTelegramPlace } from './place-id';

/** Plain-text от бота, когда канал к раннеру отсутствует или упал. */
export const RUNNER_UNAVAILABLE_TEXT = 'Раннер недоступен. Попробуй позже.';

/** Короткий ответ пользователю в тот же Place; ошибка API — warn, без throw. */
export async function notifyRunnerUnavailable(api: NotifyApi, place: Place) {
  const telegramPlace = findTelegramPlace(place);
  if (!telegramPlace) {
    console.warn('runner-unavailable: unknown place id', place);
    return;
  }

  try {
    await api.sendMessage(
      telegramPlace.chatId,
      RUNNER_UNAVAILABLE_TEXT,
      threadOptions(telegramPlace),
    );
  } catch (error) {
    console.warn('runner-unavailable notify failed', error);
  }
}

function threadOptions(place: TelegramPlace) {
  if (place.kind === 'direct') return {};
  return { message_thread_id: Number(place.topicId) };
}
