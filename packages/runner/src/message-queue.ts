import type { MessageJob } from './types/routing';

type PlaceSlot = {
  draining: boolean;
  queue: MessageJob[];
};

/**
 * Очередь inbound-`message` на Place: не больше одного активного
 * serial-drain на ключ (модель stub / эпик 3).
 */
export function createPlaceMessageQueues(options: {
  drainJob: (job: MessageJob) => Promise<void>;
}) {
  const { drainJob } = options;
  const slots = new Map<string, PlaceSlot>();

  return {
    enqueue(job: MessageJob) {
      const slot = getOrCreateSlot(slots, job.key);
      slot.queue.push(job);
      void pump(slot, job.key, drainJob);
    },
  };
}

function getOrCreateSlot(slots: Map<string, PlaceSlot>, key: string) {
  const existing = slots.get(key);
  if (existing !== undefined) return existing;
  const created: PlaceSlot = { draining: false, queue: [] };
  slots.set(key, created);
  return created;
}

async function pump(
  slot: PlaceSlot,
  key: string,
  drainJob: (job: MessageJob) => Promise<void>,
) {
  if (slot.draining) return;
  slot.draining = true;
  try {
    while (slot.queue.length > 0) {
      const job = slot.queue.shift();
      if (job === undefined) break;
      try {
        await drainJob(job);
      } catch (error: unknown) {
        console.warn('message drain: job failed', key, error);
      }
    }
  } finally {
    slot.draining = false;
    if (slot.queue.length > 0) {
      void pump(slot, key, drainJob);
    }
  }
}
