import type { OutboundCommand, OutboundResult } from '@sherpa/contract';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { RawData } from 'ws';

import {
  encodeInbound,
  encodeOutboundResult,
  tryDecodeOutbound,
} from '@sherpa/contract';
import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';

import type { CommandQueue } from './command-queue';
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

const HEARTBEAT_INTERVAL_MS = 30_000;
const CLOSE_INVALID_WIRE = 1003;

type LiveSocket = WebSocket & { isAlive: boolean };

/**
 * WebSocket-слушатель: auth на upgrade, одно активное соединение,
 * inbound → клиент, outbound → очередь/дедуп → `execute` → result с тем же `id`.
 */
export function createChannelServer(options: {
  config: ChannelConfig;
  execute: (command: OutboundCommand) => Promise<OutboundResult>;
  queue: CommandQueue;
}): ChannelServer {
  const { config, execute, queue } = options;
  let httpServer: HttpServer | null = null;
  let wss: null | WebSocketServer = null;
  let active: LiveSocket | null = null;
  let heartbeatTimer: null | ReturnType<typeof setInterval> = null;

  return {
    start() {
      if (httpServer !== null) {
        throw new Error('channel server already started');
      }

      const server = createServer((_req, res) => {
        res.writeHead(404);
        res.end();
      });
      const sockets = new WebSocketServer({ noServer: true });

      server.on('upgrade', (req, socket, head) => {
        handleUpgrade(req, socket, head, sockets);
      });

      sockets.on('connection', (socket) => {
        attachClient(socket as LiveSocket);
      });

      httpServer = server;
      wss = sockets;

      return new Promise<void>((resolve, reject) => {
        server.listen(config.port, config.host, () => resolve());
        server.once('error', reject);
      });
    },

    stop() {
      return stopServer();
    },

    tryPublishInbound(inbound) {
      if (active === null || active.readyState !== WebSocket.OPEN) return false;
      try {
        active.send(encodeInbound(inbound.eventId, inbound.event));
        return true;
      } catch {
        return false;
      }
    },
  };

  function attachClient(socket: LiveSocket) {
    if (active !== null && active !== socket) {
      active.close(1000, 'displaced');
    }
    active = socket;
    socket.isAlive = true;

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', (data) => {
      void handleMessage(socket, rawFromData(data));
    });

    socket.on('close', () => {
      if (active === socket) active = null;
    });

    ensureHeartbeat();
  }

  async function handleMessage(socket: LiveSocket, raw: string) {
    const decoded = tryDecodeOutbound(raw);
    if (decoded === null) {
      socket.close(CLOSE_INVALID_WIRE, 'invalid wire');
      return;
    }

    try {
      const result = await queue.run(decoded.id, () =>
        execute(decoded.command),
      );
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(encodeOutboundResult(decoded.id, result));
      }
    } catch (error) {
      console.warn('outbound execute failed', error);
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1011, 'execute failed');
      }
    }
  }

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    sockets: WebSocketServer,
  ) {
    const url = new URL(
      req.url ?? '/',
      `http://${req.headers.host ?? 'localhost'}`,
    );
    if (url.pathname !== config.path) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const token = findHandshakeToken(url, req.headers.authorization);
    if (token !== config.secret) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    sockets.handleUpgrade(req, socket, head, (ws) => {
      sockets.emit('connection', ws, req);
    });
  }

  function ensureHeartbeat() {
    if (heartbeatTimer !== null) return;
    heartbeatTimer = setInterval(() => {
      if (active === null) return;
      if (!active.isAlive) {
        active.terminate();
        active = null;
        return;
      }
      active.isAlive = false;
      active.ping();
    }, HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();
  }

  async function stopServer() {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (active !== null) {
      active.close(1001, 'server stop');
      active = null;
    }
    await new Promise<void>((resolve) => {
      if (wss === null) {
        resolve();
        return;
      }
      wss.close(() => resolve());
      wss = null;
    });
    await new Promise<void>((resolve, reject) => {
      if (httpServer === null) {
        resolve();
        return;
      }
      httpServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
      httpServer = null;
    });
  }
}

/** Секрет из query `token` или `Authorization: Bearer …`. */
export function findHandshakeToken(
  url: URL,
  authorization: string | undefined,
): null | string {
  const fromQuery = url.searchParams.get('token');
  if (fromQuery !== null && fromQuery !== '') return fromQuery;
  if (authorization === undefined) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

function rawFromData(data: RawData) {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}
