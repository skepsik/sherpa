import type { Place } from './place';
import type { WireDirection, WireVersion } from './wire';

/**
 * Команда раннер → транспорт.
 * Нет project / access / cwd — маршрутизацию решает раннер.
 */
export type OutboundCommand =
  | OutboundCreatePlace
  | OutboundResolveQuestion
  | OutboundSendMessage
  | OutboundSendQuestion
  | OutboundSetStatus;

/** Envelope команды на проводе. */
export type OutboundCommandEnvelope = {
  command: OutboundCommand;
  direction: Extract<WireDirection, 'outbound'>;
  /** Корреляция с `OutboundResultEnvelope.id`. */
  id: string;
  v: WireVersion;
};

export type OutboundCommandType =
  | 'create_place'
  | 'resolve_question'
  | 'send_message'
  | 'send_question'
  | 'set_status';

/**
 * Создать место в транспорте.
 * `place` — opaque id родителя; `title` — заголовок нового места.
 */
export type OutboundCreatePlace = {
  place: Place;
  title: string;
  type: 'create_place';
};

/** Успешное создание места: opaque id нового места. */
export type OutboundCreatePlaceOk = {
  place: Place;
  type: 'create_place_ok';
};

/**
 * Отказ транспорта: команда не исполнена.
 * `commandType` — тип команды, на которой отказ.
 * `message` — непустая строка (описание отказа).
 */
export type OutboundError = {
  code: OutboundErrorCode;
  commandType: OutboundCommandType;
  message: string;
  type: 'error';
};

export type OutboundErrorCode =
  | 'place_create_failed'
  | 'place_unavailable'
  | 'send_failed'
  | 'transport_rejected';

/** Кнопка: `data` станет `InboundQuestionAnswer.data` при нажатии. */
export type OutboundInlineButton = {
  data: string;
  label: string;
};

/**
 * Успех `send_question`: id сообщения нужен для `resolve_question`.
 */
export type OutboundQuestionOk = {
  commandType: 'send_question';
  messageId: string;
  type: 'question_ok';
};

/**
 * Зафиксировать выбор на сообщении-вопросе: новый текст, кнопки снять.
 * Единственный edit на проводе.
 */
export type OutboundResolveQuestion = {
  messageId: string;
  place: Place;
  text: string;
  type: 'resolve_question';
};

/** Исход команды транспорт → раннер. */
export type OutboundResult =
  OutboundCreatePlaceOk | OutboundError | OutboundQuestionOk | OutboundSendOk;

/** Envelope исхода на проводе (тот же `direction`, поле `result`). */
export type OutboundResultEnvelope = {
  direction: Extract<WireDirection, 'outbound'>;
  /** Тот же id, что у команды. */
  id: string;
  result: OutboundResult;
  v: WireVersion;
};

export type OutboundResultType =
  'create_place_ok' | 'error' | 'question_ok' | 'send_ok';

/** Отправить текст в место. */
export type OutboundSendMessage = {
  place: Place;
  text: string;
  type: 'send_message';
};

/** Успех `send_message` / `resolve_question` / `set_status` — без `messageId`. */
export type OutboundSendOk = {
  commandType: OutboundSendOkCommandType;
  type: 'send_ok';
};

export type OutboundSendOkCommandType =
  'resolve_question' | 'send_message' | 'set_status';

/**
 * Вопрос с inline-кнопками.
 * `requestId` + `buttons[].data` совместимы с inbound `question_answer`.
 */
export type OutboundSendQuestion = {
  buttons: OutboundInlineButton[];
  place: Place;
  requestId: string;
  text: string;
  type: 'send_question';
};

/** Статус индикатора в Place; исполнение на транспорте — заглушка. */
export type OutboundSetStatus = {
  place: Place;
  status: OutboundStatus;
  type: 'set_status';
};

export type OutboundStatus = 'busy' | 'idle';
