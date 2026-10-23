/** Публичная точка входа контракта транспорт ↔ раннер. */

export type {
  InboundCallback,
  InboundEnvelope,
  InboundEvent,
  InboundUserMessage,
} from './inbound';
export { encodeInbound, tryDecodeInbound } from './inbound';

export type { Place } from './place';
export { isDirectPlace, isTopicPlace } from './place';

export type { WireDirection } from './wire';
export { WIRE_VERSION } from './wire';
