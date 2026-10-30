/** Сколько недавних `eventId` держать в памяти процесса. */
const DEFAULT_CAPACITY = 4096;

/**
 * In-memory дедуп inbound `eventId` на процесс.
 * После рестарта набор пуст — повтор с транспорта возможен.
 */
export function createEventIdDedup(capacity = DEFAULT_CAPACITY) {
  if (capacity < 1) {
    throw new Error('eventId dedup: capacity >= 1');
  }

  const order: string[] = [];
  const seen = new Set<string>();

  return {
    /**
     * Новый id — запомнить и вернуть его; повтор — `null`
     * (тихий drop у вызывающего).
     */
    tryAccept(eventId: string): null | string {
      if (seen.has(eventId)) return null;
      seen.add(eventId);
      order.push(eventId);
      while (order.length > capacity) {
        const oldest = order.shift();
        if (oldest !== undefined) seen.delete(oldest);
      }
      return eventId;
    },
  };
}
