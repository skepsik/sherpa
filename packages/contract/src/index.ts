/** Публичная точка входа контракта транспорт ↔ раннер. */

export { assertNever } from './assert';

export {
  encodeInbound,
  INBOUND_EVENT_TYPES,
  tryDecodeInbound,
} from './inbound';

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

export type {
  InboundDecoded,
  InboundEnvelope,
  InboundEvent,
  InboundEventType,
  InboundMessage,
  InboundQuestionAnswer,
  OutboundCommand,
  OutboundCommandEnvelope,
  OutboundCommandType,
  OutboundCreatePlace,
  OutboundCreatePlaceOk,
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
  Place,
  WireDirection,
  WireVersion,
} from './types';

export { findNonEmptyString, isRecord, WIRE_VERSION } from './wire';
