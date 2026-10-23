/** Публичная точка входа контракта транспорт ↔ раннер. */

export { assertNever } from './assert';

export type {
  InboundDecoded,
  InboundEnvelope,
  InboundEvent,
  InboundEventType,
  InboundMessage,
  InboundQuestionAnswer,
} from './inbound';
export {
  encodeInbound,
  INBOUND_EVENT_TYPES,
  tryDecodeInbound,
} from './inbound';

export type {
  OutboundCommand,
  OutboundCommandEnvelope,
  OutboundCommandType,
  OutboundCreateTopic,
  OutboundCreateTopicOk,
  OutboundError,
  OutboundErrorCode,
  OutboundInlineButton,
  OutboundQuestionOk,
  OutboundResolveQuestion,
  OutboundResult,
  OutboundResultEnvelope,
  OutboundResultType,
  OutboundSendMessage,
  OutboundSendOk,
  OutboundSendOkCommandType,
  OutboundSendQuestion,
  OutboundSetStatus,
  OutboundStatus,
} from './outbound';
export {
  encodeOutbound,
  encodeOutboundResult,
  OUTBOUND_COMMAND_TYPES,
  OUTBOUND_ERROR_CODES,
  OUTBOUND_RESULT_TYPES,
  OUTBOUND_SEND_OK_COMMAND_TYPES,
  OUTBOUND_STATUS_VALUES,
  tryDecodeOutbound,
  tryDecodeOutboundResult,
} from './outbound';

export type { Place, TopicPlace } from './place';
export { isDirectPlace, isTopicPlace } from './place';

export type { WireDirection } from './wire';
export { findNonEmptyString, isRecord, WIRE_VERSION } from './wire';
