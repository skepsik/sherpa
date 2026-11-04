import type {
  InboundDecoded,
  InboundMessage,
  OutboundCommand,
} from '@sherpa/contract';

import type { ChannelSendOutcome } from './outcome';
import type { SessionPort } from './session';

/** Исходящий канал с точки зрения маршрутизации inbound. */
export type InboundOutboundSend = (
  command: OutboundCommand,
) => Promise<ChannelSendOutcome>;

export type InboundRouter = {
  handleInbound: (inbound: InboundDecoded) => Promise<void>;
};

export type InboundRouterDeps = {
  findCwdByPlaceKey: (key: string) => null | string;
  getPlaceSessionId: (key: string) => string;
  send: InboundOutboundSend;
  sessionPort: SessionPort;
  setPlaceSessionId: (key: string, sessionId: string) => void;
};

/** Job очереди сообщений места. */
export type MessageJob = {
  cwd: string;
  event: InboundMessage;
  eventId: string;
  /** Opaque Place ≡ ключ `places`. */
  key: string;
};
