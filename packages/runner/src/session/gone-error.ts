/** Сессию по id продолжать нельзя — слот сбросит id и cold start. */
export class SessionGoneError extends Error {
  readonly code = 'session_gone' as const;

  constructor(sessionId: string, cause?: unknown) {
    super(
      `session gone: ${sessionId}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = 'SessionGoneError';
  }
}
