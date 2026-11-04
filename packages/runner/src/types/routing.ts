import type {
  InboundDecoded,
  InboundMessage,
  MessageDelivery,
  OutboundCommand,
} from '@sherpa/contract';

import type { ChannelSendOutcome } from './outcome';
import type { PendingPermissionAsk } from './permission';
import type { WorkdirRights } from './registry';
import type { PlaceSessionSlots, SessionPort } from './session';

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
  loadWorkdirRights: (cwd: string) => WorkdirRights;
  /** Дефолт mid-run, если у `message` нет `delivery`. */
  midRunDefaultDelivery: MessageDelivery;
  registryPath: string;
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

/** Контекст обработки события стрима Place (pending ask / outbound). */
export type SessionEventCtx = {
  allocateWireRequestId: () => string;
  findCwdByPlaceKey: InboundRouterDeps['findCwdByPlaceKey'];
  loadWorkdirRights: InboundRouterDeps['loadWorkdirRights'];
  pendingAsks: Map<string, PendingPermissionAsk>;
  placeSessions: PlaceSessionSlots;
  registryPath: string;
  send: InboundOutboundSend;
};
