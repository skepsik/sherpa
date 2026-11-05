import type {
  OpenSession,
  PlaceSessionSlots,
  PlaceSessionSlotsDeps,
} from '../types/session';

import { EnsureDenyGlobalError } from '../rights';
import { SessionColdStartError } from './cold-start-error';
import { SessionGoneError } from './gone-error';

type LiveHandle = {
  generation: number;
  session: OpenSession;
  turnActive: boolean;
};

type PlaceSlotState = {
  generation: number;
  live: LiveHandle | null;
};

type PushMessageInput = Parameters<PlaceSessionSlots['pushMessage']>[0];

/**
 * ≤1 живой handle на Place; generation после смерти — в старый канал нельзя.
 * Cold start / resume → сразу user-текст из Place, без runner-prompt.
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
    try {
      return await openLiveHandle(key, cwd);
    } catch (error: unknown) {
      if (error instanceof EnsureDenyGlobalError) throw error;
      if (error instanceof SessionColdStartError) throw error;
      throw new SessionColdStartError(
        error instanceof Error ? error.message : String(error),
        error,
      );
    }
  }

  async function openLiveHandle(key: string, cwd: string): Promise<LiveHandle> {
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
        if (!(error instanceof SessionGoneError)) throw error;
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
      turnActive: false,
    };
    slot.live = handle;

    session.subscribe((event) => {
      if (event.type === 'turn_started') {
        handle.turnActive = true;
        if (slot.live !== handle) return;
        onEvent(key, event);
        return;
      }

      if (event.type === 'turn_ended') {
        const isCurrent = slot.live === handle;
        handle.turnActive = false;
        if (!isCurrent) return;
        onEvent(key, event);
        return;
      }

      if (event.type === 'error') {
        handle.turnActive = false;
        if (slot.live !== handle) return;
        onEvent(key, event);
        return;
      }

      if (event.type === 'closed') {
        handle.turnActive = false;
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
    hasActiveTurn(key) {
      const slot = slots.get(key);
      if (slot === undefined || slot.live === null) return false;
      if (slot.live.generation !== slot.generation) return false;
      return slot.live.turnActive;
    },
    async interruptTurn(key) {
      const slot = slots.get(key);
      if (slot === undefined || slot.live === null) return;
      if (slot.live.generation !== slot.generation) return;
      await slot.live.session.interruptTurn();
    },
    async pushMessage(input) {
      await pushWithStaleSessionRetry(input, false);
    },
  };

  async function pushWithStaleSessionRetry(
    input: PushMessageInput,
    retried: boolean,
  ): Promise<void> {
    const handle = await ensureLiveHandle(input.key, input.cwd);
    const slot = getOrCreateSlot(input.key);
    if (handle.generation !== slot.generation) {
      throw new Error(
        `pushMessage: чужой generation (${handle.generation}≠${slot.generation})`,
      );
    }

    try {
      await handle.session.pushMessage(input.text, input.delivery);
    } catch (error: unknown) {
      if (retried || !(error instanceof SessionGoneError)) throw error;
      if (slot.live === handle) markDead(slot, handle);
      setPlaceSessionId(input.key, '');
      await pushWithStaleSessionRetry(input, true);
    }
  }
}
