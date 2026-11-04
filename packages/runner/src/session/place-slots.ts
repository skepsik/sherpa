import type {
  OpenSession,
  PlaceSessionSlots,
  PlaceSessionSlotsDeps,
} from '../types/session';

import { SessionResumeError } from './resume-error';

type LiveHandle = {
  generation: number;
  session: OpenSession;
};

type PlaceSlotState = {
  generation: number;
  live: LiveHandle | null;
};

/**
 * ≤1 живой handle на Place; generation после смерти — в старый канал нельзя.
 */
export function createPlaceSessionSlots(
  deps: PlaceSessionSlotsDeps,
): PlaceSessionSlots {
  const { getPlaceSessionId, onEvent, sessionPort, setPlaceSessionId } = deps;
  const slots = new Map<string, PlaceSlotState>();

  function getOrCreateSlot(key: string): PlaceSlotState {
    const existing = slots.get(key);
    if (existing !== undefined) return existing;
    const created: PlaceSlotState = { generation: 0, live: null };
    slots.set(key, created);
    return created;
  }

  function markDead(slot: PlaceSlotState, handle: LiveHandle) {
    if (slot.live !== handle) return;
    slot.live = null;
    slot.generation += 1;
  }

  async function ensureLiveHandle(
    key: string,
    cwd: string,
  ): Promise<LiveHandle> {
    const slot = getOrCreateSlot(key);
    if (slot.live !== null && slot.live.generation === slot.generation) {
      return slot.live;
    }

    const storedId = getPlaceSessionId(key);
    let session: OpenSession;
    if (storedId !== '') {
      try {
        session = await sessionPort.resume({ cwd, sessionId: storedId });
      } catch (error: unknown) {
        if (!(error instanceof SessionResumeError)) throw error;
        setPlaceSessionId(key, '');
        session = await sessionPort.start({ cwd });
      }
    } else {
      session = await sessionPort.start({ cwd });
    }

    setPlaceSessionId(key, session.sessionId);

    const handle: LiveHandle = {
      generation: slot.generation,
      session,
    };
    slot.live = handle;

    session.subscribe((event) => {
      if (event.type === 'closed') {
        if (slot.live !== handle) return;
        markDead(slot, handle);
        onEvent(key, event);
        return;
      }
      if (slot.live !== handle) return;
      onEvent(key, event);
    });

    return handle;
  }

  return {
    dropHandle(key) {
      const slot = slots.get(key);
      if (slot === undefined || slot.live === null) return;
      const handle = slot.live;
      void handle.session.abort();
      if (slot.live === handle) {
        markDead(slot, handle);
        onEvent(key, { type: 'closed' });
      }
    },
    findLiveSession(key) {
      const slot = slots.get(key);
      if (slot === undefined || slot.live === null) return null;
      if (slot.live.generation !== slot.generation) return null;
      return slot.live.session;
    },
    getGeneration(key) {
      return getOrCreateSlot(key).generation;
    },
    async pushMessage(input) {
      const handle = await ensureLiveHandle(input.key, input.cwd);
      const slot = getOrCreateSlot(input.key);
      if (handle.generation !== slot.generation) {
        throw new Error(
          `pushMessage: чужой generation (${handle.generation}≠${slot.generation})`,
        );
      }
      await handle.session.pushMessage(input.text);
    },
  };
}
