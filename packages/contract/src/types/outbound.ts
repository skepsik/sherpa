import type { Place, TopicPlace } from './place';
import type { WireDirection, WireVersion } from './wire';

/**
 * Команда раннер → транспорт.
 * Нет project / access / cwd — маршрутизацию решает раннер.
 */
export type OutboundCommand =
  | OutboundCreateTopic
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
  | 'create_topic'
  | 'resolve_question'
  | 'send_message'
  | 'send_question'
  | 'set_status';

/** Создать топик в супергруппе (forum). */
export type OutboundCreateTopic = {
  /** Чат супергруппы, где создать топик. */
  chatId: string;
  title: string;
  type: 'create_topic';
};

/** Успешное создание топика: место для маршрутизации. */
export type OutboundCreateTopicOk = {
  place: TopicPlace;
  type: 'create_topic_ok';
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
  | 'create_topic_failed'
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
  OutboundCreateTopicOk | OutboundError | OutboundQuestionOk | OutboundSendOk;

/** Envelope исхода на проводе (тот же `direction`, поле `result`). */
export type OutboundResultEnvelope = {
  direction: Extract<WireDirection, 'outbound'>;
  /** Тот же id, что у команды. */
  id: string;
  result: OutboundResult;
  v: WireVersion;
};

export type OutboundResultType =
  'create_topic_ok' | 'error' | 'question_ok' | 'send_ok';

/** Отправить текст в место (личка или топик). */
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
