import type { MessageDelivery } from '@sherpa/contract';

import type {
  OpenSession,
  PlaceSessionSlots,
  PlaceSessionSlotsDeps,
  SessionEvent,
} from '../types/session';

import { EnsureDenyGlobalError } from '../rights';
import { SessionColdStartError } from './cold-start-error';
import {
  DIARY_FIXATION_NUDGE_TEXT,
  DIARY_READ_NUDGE_TEXT,
} from './diary-nudge';
import { SessionResumeError } from './resume-error';

type LiveHandle = {
  generation: number;
  session: OpenSession;
  turnActive: boolean;
  /** Ожидание конца хода после diary-read nudge на cold start. */
  turnEndWait: (() => void) | null;
  /** За текущий ход был pushMessage из Place (user-вклад задачи). */
  turnHasTaskUser: boolean;
  /** Единственный user-вклад хода — runner-nudge. */
  turnIsNudgeOnly: boolean;
};

type PlaceSlotState = {
  generation: number;
  live: LiveHandle | null;
};

/**
 * ≤1 живой handle на Place; generation после смерти — в старый канал нельзя.
 * Diary-nudge: cold start → read; turn_ended с task-вкладом → fixation.
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

  function resolveTurnEndWait(handle: LiveHandle) {
    const resolve = handle.turnEndWait;
    if (resolve === null) return;
    handle.turnEndWait = null;
    resolve();
  }

  function forwardEvent(key: string, handle: LiveHandle, event: SessionEvent) {
    if (event.type === 'assistant_text') {
      onEvent(key, { ...event, nudgeOnly: handle.turnIsNudgeOnly });
      return;
    }
    if (event.type === 'turn_started' || event.type === 'turn_ended') {
      onEvent(key, { ...event, nudgeOnly: handle.turnIsNudgeOnly });
      return;
    }
    onEvent(key, event);
  }

  async function pushRunnerNudge(handle: LiveHandle, text: string) {
    if (!handle.turnActive) {
      handle.turnIsNudgeOnly = !handle.turnHasTaskUser;
    } else if (!handle.turnHasTaskUser) {
      handle.turnIsNudgeOnly = true;
    }
    try {
      await handle.session.pushMessage(text, 'interject');
      return true;
    } catch (error: unknown) {
      console.warn('diary-nudge: сбой push', error);
      return false;
    }
  }

  async function pushTaskMessage(
    handle: LiveHandle,
    text: string,
    delivery: MessageDelivery,
  ) {
    handle.turnHasTaskUser = true;
    handle.turnIsNudgeOnly = false;
    await handle.session.pushMessage(text, delivery);
  }

  async function ensureLiveHandle(
    key: string,
    cwd: string,
  ): Promise<{ coldStarted: boolean; handle: LiveHandle }> {
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

  async function openLiveHandle(
    key: string,
    cwd: string,
  ): Promise<{ coldStarted: boolean; handle: LiveHandle }> {
    const slot = getOrCreateSlot(key);
    if (slot.live !== null && slot.live.generation === slot.generation) {
      return { coldStarted: false, handle: slot.live };
    }

    const storedId = getPlaceSessionId(key);
    let session: OpenSession;
    let coldStarted = false;
    if (storedId !== '') {
      try {
        session = await sessionPort.resume({ cwd, sessionId: storedId });
      } catch (error: unknown) {
        if (!(error instanceof SessionResumeError)) throw error;
        setPlaceSessionId(key, '');
        session = await sessionPort.start({ cwd });
        coldStarted = true;
      }
    } else {
      session = await sessionPort.start({ cwd });
      coldStarted = true;
    }

    setPlaceSessionId(key, session.sessionId);

    const handle: LiveHandle = {
      generation: slot.generation,
      session,
      turnActive: false,
      turnEndWait: null,
      turnHasTaskUser: false,
      turnIsNudgeOnly: false,
    };
    slot.live = handle;

    session.subscribe((event) => {
      if (event.type === 'turn_started') {
        handle.turnActive = true;
        if (slot.live !== handle) return;
        forwardEvent(key, handle, event);
        return;
      }

      if (event.type === 'turn_ended') {
        const hadTask = handle.turnHasTaskUser;
        const nudgeOnly = handle.turnIsNudgeOnly;
        const isCurrent = slot.live === handle;
        handle.turnActive = false;
        handle.turnHasTaskUser = false;
        handle.turnIsNudgeOnly = false;
        resolveTurnEndWait(handle);
        if (!isCurrent) return;
        onEvent(key, { nudgeOnly, type: 'turn_ended' });
        if (hadTask) {
          void pushRunnerNudge(handle, DIARY_FIXATION_NUDGE_TEXT);
        }
        return;
      }

      if (event.type === 'error') {
        handle.turnActive = false;
        handle.turnHasTaskUser = false;
        handle.turnIsNudgeOnly = false;
        resolveTurnEndWait(handle);
        if (slot.live !== handle) return;
        forwardEvent(key, handle, event);
        return;
      }

      if (event.type === 'closed') {
        handle.turnActive = false;
        handle.turnHasTaskUser = false;
        handle.turnIsNudgeOnly = false;
        resolveTurnEndWait(handle);
        if (slot.live !== handle) return;
        markDead(slot, handle);
        forwardEvent(key, handle, event);
        return;
      }

      if (slot.live !== handle) return;
      forwardEvent(key, handle, event);
    });

    return { coldStarted, handle };
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
      const { coldStarted, handle } = await ensureLiveHandle(
        input.key,
        input.cwd,
      );
      const slot = getOrCreateSlot(input.key);
      if (handle.generation !== slot.generation) {
        throw new Error(
          `pushMessage: чужой generation (${handle.generation}≠${slot.generation})`,
        );
      }

      if (coldStarted) {
        const waitEnded = new Promise<void>((resolve) => {
          handle.turnEndWait = resolve;
        });
        const nudged = await pushRunnerNudge(handle, DIARY_READ_NUDGE_TEXT);
        if (!nudged) {
          handle.turnEndWait = null;
        } else {
          await waitEnded;
        }
      }

      await pushTaskMessage(handle, input.text, input.delivery);
    },
  };
}
