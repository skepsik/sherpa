import type { WebSocket } from 'ws';

import type { AcceptedInbound } from './map-update';

/** Параметры bind и секрет канала (из env). */
export type ChannelConfig = {
  host: string;
  path: string;
  port: number;
  secret: string;
};

export type ChannelServer = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Отдать inbound активному клиенту; `false` — нет соединения / send не удался. */
  tryPublishInbound: (inbound: AcceptedInbound) => boolean;
};

/** Активный сокет с флагом heartbeat. */
export type LiveSocket = WebSocket & { isAlive: boolean };
