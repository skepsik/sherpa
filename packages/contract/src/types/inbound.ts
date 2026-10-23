import type { Place } from './place';
import type { WireDirection, WireVersion } from './wire';

/** Успешный разбор inbound с провода. */
export type InboundDecoded = {
  event: InboundEvent;
  eventId: string;
};

/**
 * Envelope inbound на проводе.
 * `eventId` — для Telegram строка из `update_id`.
 */
export type InboundEnvelope = {
  direction: Extract<WireDirection, 'inbound'>;
  event: InboundEvent;
  eventId: string;
  v: WireVersion;
};

export type InboundEvent = InboundMessage | InboundQuestionAnswer;

export type InboundEventType = 'message' | 'question_answer';

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
