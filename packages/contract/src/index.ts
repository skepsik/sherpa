/** Публичная точка входа контракта транспорт ↔ раннер. */

export { assertNever } from './assert';

export type {
  InboundCallback,
  InboundDecoded,
  InboundEnvelope,
  InboundEvent,
  InboundEventType,
  InboundUserMessage,
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
  OutboundEditText,
  OutboundError,
  OutboundErrorCode,
  OutboundInlineButton,
  OutboundResult,
  OutboundResultEnvelope,
  OutboundResultType,
  OutboundSendButtons,
  OutboundSendOk,
  OutboundSendOkCommandType,
  OutboundSendText,
} from './outbound';
export {
  encodeOutbound,
  encodeOutboundResult,
  OUTBOUND_COMMAND_TYPES,
  OUTBOUND_ERROR_CODES,
  OUTBOUND_RESULT_TYPES,
  OUTBOUND_SEND_OK_COMMAND_TYPES,
  tryDecodeOutbound,
  tryDecodeOutboundResult,
} from './outbound';

export type { Place, TopicPlace } from './place';
export { isDirectPlace, isTopicPlace } from './place';

export type { WireDirection } from './wire';
export { findNonEmptyString, isRecord, WIRE_VERSION } from './wire';
