/** Cold start (resume→start / start) не удался — не mid-run push. */
export class SessionColdStartError extends Error {
  readonly code = 'session_cold_start_failed' as const;

  constructor(detail: string, cause?: unknown) {
    super(
      `session cold start: ${detail}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = 'SessionColdStartError';
  }
}
