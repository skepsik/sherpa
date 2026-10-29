import type { OutboundCommand, OutboundResult } from '@sherpa/contract';
import type { RawData } from 'ws';

import {
  encodeOutbound,
  tryDecodeInbound,
  tryDecodeOutboundResult,
} from '@sherpa/contract';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

import type {
  ChannelClient,
  ChannelClientOptions,
  ChannelPendingWait,
  ChannelSendOptions,
  ChannelSendOutcome,
  ChannelUnknownCause,
} from './types';

import { classifyOutboundOutcome } from './outcome';
import { createPlaceQueues } from './place-queue';

/** Default ожидания исхода — с запасом на обычный Telegram RTT. */
const DEFAULT_OUTCOME_TIMEOUT_MS = 60_000;

const RECONNECT_BACKOFF_MS = [
  1_000, 2_000, 4_000, 8_000, 16_000, 30_000,
] as const;

const DISPLACED_REASON = 'displaced';

/**
 * Клиент канала с ботом: inbound → подписчик; outbound с wait по `id`;
 * сериализация по Place; reconnect / displaced.
 */
export function createChannelClient(
  options: ChannelClientOptions,
): ChannelClient {
  const { config, onInbound } = options;
  const defaultTimeoutMs =
    options.outcomeTimeoutMs ?? DEFAULT_OUTCOME_TIMEOUT_MS;
  const queues = createPlaceQueues();
  const pending = new Map<string, ChannelPendingWait>();

  let socket: null | WebSocket = null;
  let lifecycle: 'displaced' | 'idle' | 'running' | 'stopping' = 'idle';
  let reconnectAttempt = 0;
  let reconnectTimer: null | ReturnType<typeof setTimeout> = null;
  let openWaiters: Array<{
    reject: (error: Error) => void;
    resolve: () => void;
  }> = [];
  /** Поколение сокета: игнор close/message от уже заменённого. */
  let generation = 0;

  return {
    send(command, sendOptions) {
      if (lifecycle === 'idle') {
        throw new Error('channel client: start не вызван');
      }
      return queues.enqueue(command.place, () =>
        sendThroughSocket(command, sendOptions),
      );
    },

    async start() {
      if (lifecycle === 'running') {
        throw new Error('channel client: уже запущен');
      }
      if (lifecycle === 'displaced') {
        throw new Error(
          'channel client: displaced — восстановление только внешним рестартом',
        );
      }
      lifecycle = 'running';
      reconnectAttempt = 0;
      try {
        await openSocket();
      } catch (error) {
        lifecycle = 'idle';
        clearReconnectTimer();
        generation += 1;
        socket = null;
        throw error;
      }
    },

    stop() {
      return stopClient();
    },
  };

  function clearReconnectTimer() {
    if (reconnectTimer === null) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  /** После await lifecycle мог смениться (displaced / stop). */
  function findUnknownCause(): ChannelUnknownCause {
    return lifecycle === 'displaced' ? 'displaced' : 'disconnect';
  }

  function failOpenWaiters(error: Error) {
    const waiters = openWaiters;
    openWaiters = [];
    for (const waiter of waiters) waiter.reject(error);
  }

  function handleClose(gen: number, code: number, reasonBuf: Buffer) {
    if (gen !== generation) return;
    socket = null;
    const reason = reasonBuf.toString('utf8');
    const isDisplaced = code === 1000 && reason === DISPLACED_REASON;

    settleAllPending(isDisplaced ? 'displaced' : 'disconnect');

    if (openWaiters.length > 0) {
      failOpenWaiters(
        new Error(`channel: closed before open (${code} ${reason})`),
      );
    }

    if (lifecycle === 'stopping' || lifecycle === 'idle') {
      return;
    }

    if (isDisplaced) {
      lifecycle = 'displaced';
      clearReconnectTimer();
      console.warn(
        'channel: displaced — клиент остановлен, процесс жив; восстановление — рестарт процесса',
      );
      return;
    }

    scheduleReconnect();
  }

  function handleMessage(gen: number, raw: string) {
    if (gen !== generation) return;

    const inbound = tryDecodeInbound(raw);
    if (inbound !== null) {
      void Promise.resolve(onInbound(inbound)).catch((error: unknown) => {
        console.warn('channel: onInbound failed', error);
      });
      return;
    }

    const decoded = tryDecodeOutboundResult(raw);
    if (decoded === null) {
      console.warn('channel: невалидный кадр, пропуск');
      return;
    }

    const wait = pending.get(decoded.id);
    if (wait === undefined) {
      console.warn('channel: исход без pending id=', decoded.id);
      return;
    }

    clearTimeout(wait.timer);
    pending.delete(decoded.id);
    wait.settle(buildOutcome(wait.command, decoded.result));
  }

  function openSocket() {
    clearReconnectTimer();
    generation += 1;
    const gen = generation;

    if (socket !== null) {
      const previous = socket;
      socket = null;
      previous.removeAllListeners();
      previous.close();
    }

    return new Promise<void>((resolve, reject) => {
      openWaiters.push({ reject, resolve });

      const ws = new WebSocket(config.url, {
        headers: { Authorization: `Bearer ${config.secret}` },
      });
      socket = ws;

      ws.once('open', () => {
        if (gen !== generation) return;
        reconnectAttempt = 0;
        resolveOpenWaiters();
      });

      ws.on('message', (data) => {
        handleMessage(gen, rawFromData(data));
      });

      ws.once('close', (code, reason) => {
        handleClose(gen, code, reason);
      });

      ws.once('error', (error) => {
        if (gen !== generation) return;
        // handshake / обрыв до open: отклонить waiters (close придёт следом)
        if (openWaiters.length > 0) {
          failOpenWaiters(
            error instanceof Error ? error : new Error(String(error)),
          );
          return;
        }
        console.warn('channel: socket error', error);
      });
    });
  }

  function resolveOpenWaiters() {
    const waiters = openWaiters;
    openWaiters = [];
    for (const waiter of waiters) waiter.resolve();
  }

  function scheduleReconnect() {
    if (lifecycle !== 'running') return;
    clearReconnectTimer();
    const delay =
      RECONNECT_BACKOFF_MS[
        Math.min(reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)
      ];
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (lifecycle !== 'running') return;
      // reconnect только из handleClose (close после ошибки); иначе двойной attempt++/backoff
      void openSocket().catch((error: unknown) => {
        console.warn('channel: reconnect failed', error);
      });
    }, delay);
    reconnectTimer.unref?.();
  }

  async function sendThroughSocket(
    command: OutboundCommand,
    sendOptions: ChannelSendOptions | undefined,
  ): Promise<ChannelSendOutcome> {
    if (lifecycle === 'displaced') {
      return { cause: 'displaced', kind: 'unknown' };
    }
    if (lifecycle === 'stopping' || lifecycle === 'idle') {
      return { cause: 'disconnect', kind: 'unknown' };
    }

    const timeoutMs = sendOptions?.timeoutMs ?? defaultTimeoutMs;
    const id = sendOptions?.id ?? randomUUID();

    try {
      await waitUntilOpen(timeoutMs);
    } catch {
      return { cause: findUnknownCause(), kind: 'unknown' };
    }

    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      return { cause: findUnknownCause(), kind: 'unknown' };
    }

    return await new Promise<ChannelSendOutcome>((resolve) => {
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        resolve({ cause: 'timeout', kind: 'unknown' });
      }, timeoutMs);

      pending.set(id, {
        command,
        settle: resolve,
        timer,
      });

      try {
        socket!.send(encodeOutbound(id, command));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        console.warn('channel: send failed', error);
        resolve({ cause: 'disconnect', kind: 'unknown' });
      }
    });
  }

  function settleAllPending(cause: ChannelUnknownCause) {
    const entries = [...pending.entries()];
    pending.clear();
    for (const [, wait] of entries) {
      clearTimeout(wait.timer);
      wait.settle({ cause, kind: 'unknown' });
    }
  }

  async function stopClient() {
    if (lifecycle === 'idle') return;
    const wasDisplaced = lifecycle === 'displaced';
    lifecycle = 'stopping';
    clearReconnectTimer();
    settleAllPending(wasDisplaced ? 'displaced' : 'disconnect');
    generation += 1;
    const current = socket;
    socket = null;
    if (current !== null) {
      await new Promise<void>((resolve) => {
        current.once('close', () => resolve());
        current.close(1000, 'client stop');
        setTimeout(resolve, 100).unref?.();
      });
    }
    failOpenWaiters(new Error('channel: stopped'));
    lifecycle = 'idle';
  }

  function waitUntilOpen(timeoutMs: number) {
    if (socket !== null && socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (lifecycle === 'displaced') {
      return Promise.reject(new Error('displaced'));
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('timeout waiting for channel'));
      }, timeoutMs);
      openWaiters.push({
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });
  }
}

function buildOutcome(
  command: OutboundCommand,
  result: OutboundResult,
): ChannelSendOutcome {
  const kind = classifyOutboundOutcome(command, result);
  switch (kind) {
    case 'protocol_mismatch':
      return { kind, result };
    case 'success':
      return { kind, result };
    case 'transport_reject':
      if (result.type !== 'error') {
        return { kind: 'protocol_mismatch', result };
      }
      return { kind, result };
  }
}

function rawFromData(data: RawData) {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}
