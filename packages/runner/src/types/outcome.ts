import type { OutboundError, OutboundResult } from '@sherpa/contract';

/**
 * Класс завершения ожидания outbound (эпики 5–6 / ретраи выше).
 * Очередь Place освобождается при любом из них.
 */
export type ChannelSendOutcome =
  | { cause: ChannelUnknownCause; kind: 'unknown' }
  | { kind: 'protocol_mismatch'; result: OutboundResult }
  | { kind: 'success'; result: OutboundResult }
  | { kind: 'transport_reject'; result: OutboundError };

/** Причина `unknown`: таймаут или обрыв до исхода. */
export type ChannelUnknownCause = 'disconnect' | 'displaced' | 'timeout';
