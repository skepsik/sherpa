import type { InboundDecoded, OutboundCommand } from '@sherpa/contract';

import type { ChannelConfig } from './config';
import type { ChannelSendOutcome } from './outcome';

export type ChannelClient = {
  /**
   * Отправить команду и дождаться исхода с тем же `id`.
   * Сериализация по `command.place`: следующий в том же Place — после завершения.
   */
  send: (
    command: OutboundCommand,
    options?: ChannelSendOptions,
  ) => Promise<ChannelSendOutcome>;
  /** Подключиться; при обычном обрыве — reconnect с backoff. */
  start: () => Promise<void>;
  /** Остановить reconnect и закрыть сокет; pending → unknown. */
  stop: () => Promise<void>;
};

export type ChannelClientOptions = {
  config: ChannelConfig;
  onInbound: (inbound: InboundDecoded) => Promise<void> | void;
  /** Default таймаут ожидания исхода; иначе внутри клиента. */
  outcomeTimeoutMs?: number;
};

/** Ожидание исхода outbound по корреляционному `id`. */
export type ChannelPendingWait = {
  command: OutboundCommand;
  settle: (outcome: ChannelSendOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type ChannelSendOptions = {
  /** Корреляция; без — новый UUID. */
  id?: string;
  /** Перекрыть default таймаут ожидания исхода. */
  timeoutMs?: number;
};
