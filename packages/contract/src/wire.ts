import type { WireVersion } from './types';

/** Версия envelope на проводе (inbound и outbound — один стиль). */
export const WIRE_VERSION = 1 satisfies WireVersion;

export function findNonEmptyString(value: unknown): null | string {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
