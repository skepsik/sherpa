/** Версия envelope на проводе (inbound и outbound — один стиль). */
export const WIRE_VERSION = 1 as const;

export type WireDirection = 'inbound' | 'outbound';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
