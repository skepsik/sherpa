import type { InboundEvent } from '@sherpa/contract';

/** Готовое inbound (+ eventId) для отдачи наружу модуля приёма. */
export type AcceptedInbound = {
  event: InboundEvent;
  eventId: string;
};

/**
 * Результат разбора Update:
 * - `inbound` — эмитить на канал (или `null`, если отбросить);
 * - `answerCallbackQueryId` — локальный ответ Telegram на callback (если нужен).
 */
export type MappedUpdate = {
  answerCallbackQueryId: null | string;
  inbound: AcceptedInbound | null;
};
