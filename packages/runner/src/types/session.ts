import type { MessageDelivery } from '@sherpa/contract';

/** Порт сессии харнесса (адаптер). */

export type OpenSession = {
  abort(): Promise<void>;
  /**
   * Ответ на `permission_ask` с тем же `requestId`.
   * Нет открытого ask — мягкий no-op (teardown / повтор).
   */
  answerPermission(input: {
    decision: SessionPermissionDecision;
    requestId: string;
  }): Promise<void>;
  /** Прервать текущий ход (break); сессию не закрывает. */
  interruptTurn(): Promise<void>;
  pushMessage(text: string, delivery: MessageDelivery): Promise<void>;
  readonly sessionId: string;
  subscribe(listener: (event: SessionEvent) => void): void;
};

export type OpenSessionDouble = OpenSession & {
  /**
   * Эмит `permission_ask` и Promise решения (для тестов UI-пути).
   * Резолвится из `answerPermission` / reject при kill.
   */
  emitPermissionAsk(input: {
    action: string;
    requestId: string;
    resource: string;
  }): Promise<SessionPermissionDecision>;
  isAlive(): boolean;
  isTurnActive(): boolean;
  kill(): void;
  readonly pushes: { delivery: MessageDelivery; text: string }[];
};

export type PlaceSessionSlots = {
  dropHandle(key: string): void;
  findLiveSession(key: string): null | OpenSession;
  getGeneration(key: string): number;
  hasActiveTurn(key: string): boolean;
  interruptTurn(key: string): Promise<void>;
  pushMessage(input: {
    cwd: string;
    delivery: MessageDelivery;
    key: string;
    text: string;
  }): Promise<void>;
};

export type PlaceSessionSlotsDeps = {
  getPlaceSessionId: (key: string) => string;
  onEvent: (key: string, event: SessionEvent) => void;
  sessionPort: SessionPort;
  setPlaceSessionId: (key: string, sessionId: string) => void;
};

export type SessionDoubleCall =
  | { cwd: string; sessionId: string; type: 'resume' }
  | { cwd: string; type: 'start' }
  | {
      decision: SessionPermissionDecision;
      requestId: string;
      sessionId: string;
      type: 'answer_permission';
    }
  | {
      delivery: MessageDelivery;
      sessionId: string;
      text: string;
      type: 'push';
    }
  | { sessionId: string; type: 'abort' }
  | { sessionId: string; type: 'interrupt_turn' };

export type SessionEvent =
  | {
      action: string;
      requestId: string;
      resource: string;
      type: 'permission_ask';
    }
  | { message: string; type: 'error' }
  | {
      text: string;
      type: 'assistant_text';
    }
  | { type: 'closed' }
  | { type: 'turn_ended' }
  | { type: 'turn_started' };

/** Решение на permission ask: once / always / reject. */
export type SessionPermissionDecision = 'always' | 'once' | 'reject';

export type SessionPort = {
  resume(input: SessionResumeInput): Promise<OpenSession>;
  start(input: SessionStartInput): Promise<OpenSession>;
};

export type SessionResumeInput = {
  cwd: string;
  sessionId: string;
};

export type SessionStartInput = {
  cwd: string;
};

export type SessionTestDouble = SessionPort & {
  readonly calls: SessionDoubleCall[];
  /** Resume бросает обычный Error (не SessionResumeError) — session_id не сбрасывать. */
  crashResumeFor(sessionId: string): void;
  failResumeFor(sessionId: string): void;
  readonly opened: OpenSessionDouble[];
};
