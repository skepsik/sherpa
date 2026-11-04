import type { InboundEvent, MessageDelivery } from '@sherpa/contract';

/** Готовое inbound (+ eventId) для отдачи наружу модуля приёма. */
export type AcceptedInbound = {
  event: InboundEvent;
  eventId: string;
};

/**
 * Результат разбора Update:
 * - `inbound` — эмитить на канал (или `null`, если отбросить);
 * - `answerCallbackQueryId` — локальный ответ Telegram на callback (если нужен);
 * - `userReply` — локальный ответ в чат без канала (голый slash и т.п.).
 */
export type MappedUpdate = {
  answerCallbackQueryId: null | string;
  inbound: AcceptedInbound | null;
  userReply: null | string;
};

/** Разбор slash mid-run в `mapTelegramUpdate`. */
export type ParsedSlash =
  | { delivery: MessageDelivery; kind: 'override'; text: string }
  | { kind: 'break' }
  | { kind: 'needs_text' }
  | { kind: 'plain'; text: string };
