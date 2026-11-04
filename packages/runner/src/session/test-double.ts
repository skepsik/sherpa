import type {
  OpenSessionDouble,
  SessionDoubleCall,
  SessionEvent,
  SessionResumeInput,
  SessionStartInput,
  SessionTestDouble,
} from '../types/session';

import { SessionResumeError } from './resume-error';

type DoubleOptions = {
  /** Стабильный префикс session_id; иначе `double-`. */
  sessionIdPrefix?: string;
};

/**
 * In-memory адаптер порта: фиксирует start/resume/push, эхо текста
 * → `assistant_text`, ход через microtask (mid-run push успевает до конца).
 */
export function createSessionTestDouble(
  options: DoubleOptions = {},
): SessionTestDouble {
  const prefix = options.sessionIdPrefix ?? 'double-';
  const calls: SessionDoubleCall[] = [];
  const opened: OpenSessionDouble[] = [];
  const resumeFailIds = new Set<string>();
  const resumeCrashIds = new Set<string>();
  let nextSeq = 1;

  function openSession(sessionId: string): OpenSessionDouble {
    const listeners = new Set<(event: SessionEvent) => void>();
    const pendingTexts: string[] = [];
    let alive = true;
    let turnActive = false;
    let endScheduled = false;
    const pushes: string[] = [];

    function emit(event: SessionEvent) {
      for (const listener of listeners) listener(event);
    }

    function scheduleTurnEnd() {
      if (endScheduled) return;
      endScheduled = true;
      // macrotask: serial drain следующего message успевает mid-run push
      setTimeout(() => {
        endScheduled = false;
        if (!alive || !turnActive) return;
        const batch = pendingTexts.splice(0);
        for (const text of batch) {
          emit({ text: `echo:${text}`, type: 'assistant_text' });
        }
        turnActive = false;
        emit({ type: 'turn_ended' });
      }, 0);
    }

    const session: OpenSessionDouble = {
      async abort() {
        calls.push({ sessionId, type: 'abort' });
        session.kill();
      },
      isAlive() {
        return alive;
      },
      kill() {
        if (!alive) return;
        alive = false;
        turnActive = false;
        pendingTexts.length = 0;
        emit({ type: 'closed' });
      },
      pushes,
      async pushMessage(text: string) {
        if (!alive) {
          throw new Error(`pushMessage: сессия закрыта (${sessionId})`);
        }
        calls.push({ sessionId, text, type: 'push' });
        pushes.push(text);
        pendingTexts.push(text);
        if (!turnActive) {
          turnActive = true;
          emit({ type: 'turn_started' });
        }
        scheduleTurnEnd();
      },
      get sessionId() {
        return sessionId;
      },
      subscribe(listener) {
        listeners.add(listener);
      },
    };

    opened.push(session);
    return session;
  }

  return {
    calls,
    crashResumeFor(sessionId) {
      resumeCrashIds.add(sessionId);
    },
    failResumeFor(sessionId) {
      resumeFailIds.add(sessionId);
    },
    opened,
    async resume(input: SessionResumeInput) {
      calls.push({
        cwd: input.cwd,
        sessionId: input.sessionId,
        type: 'resume',
      });
      if (resumeCrashIds.has(input.sessionId)) {
        resumeCrashIds.delete(input.sessionId);
        throw new Error(`resume crashed: ${input.sessionId}`);
      }
      if (resumeFailIds.has(input.sessionId)) {
        resumeFailIds.delete(input.sessionId);
        throw new SessionResumeError(input.sessionId);
      }
      return openSession(input.sessionId);
    },
    async start(input: SessionStartInput) {
      calls.push({ cwd: input.cwd, type: 'start' });
      const sessionId = `${prefix}${nextSeq}`;
      nextSeq += 1;
      return openSession(sessionId);
    },
  };
}
