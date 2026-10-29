import type {
  InboundDecoded,
  InboundMessage,
  OutboundCommand,
} from '@sherpa/contract';

import type { ChannelSendOutcome } from './outcome';

/** Исходящий канал с точки зрения маршрутизации inbound. */
export type InboundOutboundSend = (
  command: OutboundCommand,
) => Promise<ChannelSendOutcome>;

export type InboundRouter = {
  handleInbound: (inbound: InboundDecoded) => Promise<void>;
};

export type InboundRouterDeps = {
  findCwdByPlaceKey: (key: string) => null | string;
  send: InboundOutboundSend;
};

/** Job очереди сообщений места (stub / эпик 3). */
export type MessageJob = {
  cwd: string;
  event: InboundMessage;
  eventId: string;
  /** Opaque Place ≡ ключ `places`. */
  key: string;
};
