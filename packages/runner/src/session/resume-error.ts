/** Resume не нашёл сессию / завершился ошибкой — сброс + cold start. */
export class SessionResumeError extends Error {
  readonly code = 'session_resume_failed' as const;

  constructor(sessionId: string, cause?: unknown) {
    super(`session resume failed: ${sessionId}`);
    this.name = 'SessionResumeError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
