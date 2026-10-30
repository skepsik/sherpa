import type { OutboundCommand, OutboundResult } from '@sherpa/contract';

import { assertNever } from '@sherpa/contract';

/**
 * Сверка исхода с отправленной командой (контракт: соответствие по `id`).
 * `transport_reject` — только валидный `error` с тем же `commandType`.
 */
export function classifyOutboundOutcome(
  command: OutboundCommand,
  result: OutboundResult,
): 'protocol_mismatch' | 'success' | 'transport_reject' {
  if (result.type === 'error') {
    return result.commandType === command.type
      ? 'transport_reject'
      : 'protocol_mismatch';
  }

  switch (command.type) {
    case 'create_place':
      return result.type === 'create_place_ok'
        ? 'success'
        : 'protocol_mismatch';
    case 'resolve_question':
    case 'send_message':
    case 'set_status':
      return result.type === 'send_ok' && result.commandType === command.type
        ? 'success'
        : 'protocol_mismatch';
    case 'send_question':
      return result.type === 'question_ok' ? 'success' : 'protocol_mismatch';
    default:
      return assertNever(command);
  }
}
