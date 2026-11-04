/** Порт сессии харнесса (адаптер). */

export type OpenSession = {
  abort(): Promise<void>;
  pushMessage(text: string): Promise<void>;
  readonly sessionId: string;
  subscribe(listener: (event: SessionEvent) => void): void;
};

export type OpenSessionDouble = OpenSession & {
  isAlive(): boolean;
  kill(): void;
  readonly pushes: string[];
};

export type PlaceSessionSlots = {
  dropHandle(key: string): void;
  findLiveSession(key: string): null | OpenSession;
  getGeneration(key: string): number;
  pushMessage(input: { cwd: string; key: string; text: string }): Promise<void>;
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
  | { sessionId: string; text: string; type: 'push' }
  | { sessionId: string; type: 'abort' };

export type SessionEvent =
  | { action: string; resource: string; type: 'permission_ask' }
  | { message: string; type: 'error' }
  | { text: string; type: 'assistant_text' }
  | { type: 'closed' }
  | { type: 'turn_ended' }
  | { type: 'turn_started' };

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
