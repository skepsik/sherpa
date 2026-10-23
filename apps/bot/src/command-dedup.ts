/**
 * Дедуп исходящих команд по `id` (в полёте и в окне TTL после кэшируемого исхода).
 * Сериализации между разными id нет.
 */

export type CommandDedup = {
  /**
   * Один проход `run` на `id` в полёте; после исхода с `cacheable: true` —
   * повтор в TTL возвращает тот же `value` без второго `run`.
   */
  run: <T>(
    id: string,
    run: () => Promise<CommandDedupOutcome<T>>,
  ) => Promise<T>;
};

/** Исход `run`: кэшировать ли `value` в окне TTL. */
export type CommandDedupOutcome<T> = {
  cacheable: boolean;
  value: T;
};

const DEFAULT_DEDUP_TTL_MS = 60_000;

/** Эфемерная память процесса; окно дедупа после кэшируемого исхода — `dedupTtlMs`. */
export function createCommandDedup(
  dedupTtlMs: number = DEFAULT_DEDUP_TTL_MS,
): CommandDedup {
  const inflight = new Map<string, Promise<unknown>>();
  const recent = new Map<string, { expiresAt: number; value: unknown }>();

  return {
    run(id, run) {
      pruneExpired(recent);
      const cached = recent.get(id);
      if (cached !== undefined) {
        return Promise.resolve(
          cached.value as Awaited<ReturnType<typeof run>>['value'],
        );
      }

      const existing = inflight.get(id);
      if (existing !== undefined) {
        return existing as Promise<Awaited<ReturnType<typeof run>>['value']>;
      }

      const task = run().then(
        (outcome) => {
          inflight.delete(id);
          if (outcome.cacheable) {
            recent.set(id, {
              expiresAt: Date.now() + dedupTtlMs,
              value: outcome.value,
            });
          }
          return outcome.value;
        },
        (error: unknown) => {
          inflight.delete(id);
          throw error;
        },
      );
      inflight.set(id, task);
      return task;
    },
  };
}

function pruneExpired(
  recent: Map<string, { expiresAt: number; value: unknown }>,
) {
  const now = Date.now();
  for (const [id, entry] of recent) {
    if (entry.expiresAt <= now) recent.delete(id);
  }
}
