/** Лимит Telegram на `callback_data` (байты UTF-8). */
export const CALLBACK_DATA_MAX_BYTES = 64;

export type CallbackPayload = {
  data: string;
  requestId: string;
};

/**
 * Упаковка `requestId` + `data` в один `callback_data`.
 * Формат: JSON-массив из двух непустых строк — `[requestId, data]`.
 * Не умещается в 64 байт → `null` (outbound даст `transport_rejected`).
 */
export function tryPackCallbackData(
  requestId: string,
  data: string,
): null | string {
  if (requestId === '' || data === '') return null;
  const packed = JSON.stringify([requestId, data]);
  if (Buffer.byteLength(packed, 'utf8') > CALLBACK_DATA_MAX_BYTES) return null;
  return packed;
}

/** Симметричная распаковка; битый / чужой формат → `null`. */
export function tryUnpackCallbackData(raw: string): CallbackPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const requestId: unknown = parsed[0];
  const data: unknown = parsed[1];
  if (typeof requestId !== 'string' || requestId === '') return null;
  if (typeof data !== 'string' || data === '') return null;
  return { data, requestId };
}
