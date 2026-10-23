import type { Place } from '@sherpa/contract';

import type { NotifyApi } from './types';

/** Plain-text от бота, когда канал к раннеру отсутствует или упал. */
export const RUNNER_UNAVAILABLE_TEXT = 'Раннер недоступен. Попробуй позже.';

/** Короткий ответ пользователю в тот же Place; ошибка API — warn, без throw. */
export async function notifyRunnerUnavailable(api: NotifyApi, place: Place) {
  try {
    await api.sendMessage(
      place.chatId,
      RUNNER_UNAVAILABLE_TEXT,
      threadOptions(place),
    );
  } catch (error) {
    console.warn('runner-unavailable notify failed', error);
  }
}

function threadOptions(place: Place) {
  if (place.kind === 'direct') return {};
  return { message_thread_id: Number(place.topicId) };
}
