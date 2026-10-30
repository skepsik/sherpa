import type {
  OutboundCommand,
  OutboundCommandEnvelope,
  OutboundCommandType,
  OutboundCreatePlace,
  OutboundCreatePlaceOk,
  OutboundError,
  OutboundErrorCode,
  OutboundInlineButton,
  OutboundQuestionOk,
  OutboundResolveQuestion,
  OutboundResult,
  OutboundResultEnvelope,
  OutboundResultType,
  OutboundSendMessage,
  OutboundSendOk,
  OutboundSendOkCommandType,
  OutboundSendQuestion,
  OutboundSetStatus,
  OutboundStatus,
} from './types';

import { assertNever } from './assert';
import { findPlace } from './place';
import { findNonEmptyString, isRecord, WIRE_VERSION } from './wire';

export const OUTBOUND_COMMAND_TYPES = [
  'send_message',
  'send_question',
  'resolve_question',
  'set_status',
  'create_place',
] as const satisfies readonly OutboundCommandType[];

export const OUTBOUND_ERROR_CODES = [
  'place_create_failed',
  'place_unavailable',
  'send_failed',
  'transport_rejected',
] as const satisfies readonly OutboundErrorCode[];

export const OUTBOUND_RESULT_TYPES = [
  'create_place_ok',
  'error',
  'question_ok',
  'send_ok',
] as const satisfies readonly OutboundResultType[];

export const OUTBOUND_SEND_OK_COMMAND_TYPES = [
  'send_message',
  'resolve_question',
  'set_status',
] as const satisfies readonly OutboundSendOkCommandType[];

export const OUTBOUND_STATUS_VALUES = [
  'busy',
  'idle',
] as const satisfies readonly OutboundStatus[];

export function encodeOutbound(id: string, command: OutboundCommand): string {
  const envelope: OutboundCommandEnvelope = {
    command,
    direction: 'outbound',
    id,
    v: WIRE_VERSION,
  };
  return JSON.stringify(envelope);
}

export function encodeOutboundResult(
  id: string,
  result: OutboundResult,
): string {
  const envelope: OutboundResultEnvelope = {
    direction: 'outbound',
    id,
    result,
    v: WIRE_VERSION,
  };
  return JSON.stringify(envelope);
}

/** Мягкий разбор команды: невалидный wire → `null`. */
export function tryDecodeOutbound(
  raw: string,
): null | { command: OutboundCommand; id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return findOutboundCommandEnvelope(parsed);
}

/** Мягкий разбор исхода: невалидный wire → `null`. */
export function tryDecodeOutboundResult(
  raw: string,
): null | { id: string; result: OutboundResult } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return findOutboundResultEnvelope(parsed);
}

function findButtons(value: unknown): null | OutboundInlineButton[] {
  if (!Array.isArray(value)) return null;
  const buttons: OutboundInlineButton[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const label = findNonEmptyString(item.label);
    if (!label) return null;
    const data = findNonEmptyString(item.data);
    if (!data) return null;
    buttons.push({ data, label });
  }
  return buttons;
}

function findCommand(value: unknown): null | OutboundCommand {
  if (!isRecord(value)) return null;
  if (!isCommandType(value.type)) return null;
  switch (value.type) {
    case 'create_place':
      return findCreatePlace(value);
    case 'resolve_question':
      return findResolveQuestion(value);
    case 'send_message':
      return findSendMessage(value);
    case 'send_question':
      return findSendQuestion(value);
    case 'set_status':
      return findSetStatus(value);
    default:
      return assertNever(value.type);
  }
}

function findCreatePlace(
  value: Record<string, unknown>,
): null | OutboundCreatePlace {
  const place = findPlace(value.place);
  if (!place) return null;
  const title = findNonEmptyString(value.title);
  if (!title) return null;
  return { place, title, type: 'create_place' };
}

function findCreatePlaceOk(
  value: Record<string, unknown>,
): null | OutboundCreatePlaceOk {
  const place = findPlace(value.place);
  if (!place) return null;
  return { place, type: 'create_place_ok' };
}

function findError(value: Record<string, unknown>): null | OutboundError {
  if (!isErrorCode(value.code)) return null;
  if (!isCommandType(value.commandType)) return null;
  const message = findNonEmptyString(value.message);
  if (!message) return null;
  return {
    code: value.code,
    commandType: value.commandType,
    message,
    type: 'error',
  };
}

function findOutboundCommandEnvelope(
  value: unknown,
): null | { command: OutboundCommand; id: string } {
  if (!isRecord(value)) return null;
  if (value.v !== WIRE_VERSION) return null;
  if (value.direction !== 'outbound') return null;
  const id = findNonEmptyString(value.id);
  if (!id) return null;
  if ('result' in value && value.result !== undefined) return null;
  const command = findCommand(value.command);
  if (!command) return null;
  return { command, id };
}

function findOutboundResultEnvelope(
  value: unknown,
): null | { id: string; result: OutboundResult } {
  if (!isRecord(value)) return null;
  if (value.v !== WIRE_VERSION) return null;
  if (value.direction !== 'outbound') return null;
  const id = findNonEmptyString(value.id);
  if (!id) return null;
  if ('command' in value && value.command !== undefined) return null;
  const result = findResult(value.result);
  if (!result) return null;
  return { id, result };
}

function findQuestionOk(
  value: Record<string, unknown>,
): null | OutboundQuestionOk {
  if (value.commandType !== 'send_question') return null;
  const messageId = findNonEmptyString(value.messageId);
  if (!messageId) return null;
  return { commandType: 'send_question', messageId, type: 'question_ok' };
}

function findResolveQuestion(
  value: Record<string, unknown>,
): null | OutboundResolveQuestion {
  const place = findPlace(value.place);
  if (!place) return null;
  const messageId = findNonEmptyString(value.messageId);
  if (!messageId) return null;
  const text = findNonEmptyString(value.text);
  if (!text) return null;
  return { messageId, place, text, type: 'resolve_question' };
}

function findResult(value: unknown): null | OutboundResult {
  if (!isRecord(value)) return null;
  if (!isResultType(value.type)) return null;
  switch (value.type) {
    case 'create_place_ok':
      return findCreatePlaceOk(value);
    case 'error':
      return findError(value);
    case 'question_ok':
      return findQuestionOk(value);
    case 'send_ok':
      return findSendOk(value);
    default:
      return assertNever(value.type);
  }
}

function findSendMessage(
  value: Record<string, unknown>,
): null | OutboundSendMessage {
  const place = findPlace(value.place);
  if (!place) return null;
  const text = findNonEmptyString(value.text);
  if (!text) return null;
  return { place, text, type: 'send_message' };
}

function findSendOk(value: Record<string, unknown>): null | OutboundSendOk {
  if (!isSendOkCommandType(value.commandType)) return null;
  if (value.messageId !== undefined) return null;
  return { commandType: value.commandType, type: 'send_ok' };
}

function findSendQuestion(
  value: Record<string, unknown>,
): null | OutboundSendQuestion {
  const place = findPlace(value.place);
  if (!place) return null;
  const text = findNonEmptyString(value.text);
  if (!text) return null;
  const requestId = findNonEmptyString(value.requestId);
  if (!requestId) return null;
  const buttons = findButtons(value.buttons);
  if (!buttons || buttons.length === 0) return null;
  return { buttons, place, requestId, text, type: 'send_question' };
}

function findSetStatus(
  value: Record<string, unknown>,
): null | OutboundSetStatus {
  const place = findPlace(value.place);
  if (!place) return null;
  if (!isStatus(value.status)) return null;
  return { place, status: value.status, type: 'set_status' };
}

function isCommandType(value: unknown): value is OutboundCommandType {
  return (
    typeof value === 'string' &&
    (OUTBOUND_COMMAND_TYPES as readonly string[]).includes(value)
  );
}

function isErrorCode(value: unknown): value is OutboundErrorCode {
  return (
    typeof value === 'string' &&
    (OUTBOUND_ERROR_CODES as readonly string[]).includes(value)
  );
}

function isResultType(value: unknown): value is OutboundResultType {
  return (
    typeof value === 'string' &&
    (OUTBOUND_RESULT_TYPES as readonly string[]).includes(value)
  );
}

function isSendOkCommandType(
  value: unknown,
): value is OutboundSendOkCommandType {
  return (
    typeof value === 'string' &&
    (OUTBOUND_SEND_OK_COMMAND_TYPES as readonly string[]).includes(value)
  );
}

function isStatus(value: unknown): value is OutboundStatus {
  return (
    typeof value === 'string' &&
    (OUTBOUND_STATUS_VALUES as readonly string[]).includes(value)
  );
}
