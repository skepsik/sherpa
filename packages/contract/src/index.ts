/** Публичная точка входа контракта транспорт ↔ раннер. */

export { assertNever } from './assert';

export type {
  InboundCallback,
  InboundDecoded,
  InboundEnvelope,
  InboundEvent,
  InboundUserMessage,
} from './inbound';
export { encodeInbound, tryDecodeInbound } from './inbound';

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
  OUTBOUND_SEND_OK_COMMAND_TYPES,
  tryDecodeOutbound,
  tryDecodeOutboundResult,
} from './outbound';

export type { Place, TopicPlace } from './place';
export { isDirectPlace, isTopicPlace } from './place';

export type { WireDirection } from './wire';
export { findNonEmptyString, isRecord, WIRE_VERSION } from './wire';
