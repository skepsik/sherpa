/** Версия envelope на проводе (inbound и outbound — один стиль). */
export const WIRE_VERSION = 1 as const;

export type WireDirection = 'inbound' | 'outbound';
