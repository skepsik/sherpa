/**
 * Глобальная очередь исходящих команд + дедуп по `id`.
 * Параллельный send/edit на одно Place запрещён упрощением MVP (очередь на весь бот).
 */

export type CommandQueue = {
  /** Один проход `run` на `id`; повтор ждёт тот же исход без второго `run`. */
  run: <T>(id: string, run: () => Promise<T>) => Promise<T>;
};

const DEFAULT_DEDUP_TTL_MS = 60_000;

/** Создаёт очередь: строго последовательно; окно дедупа — эфемерная память процесса. */
export function createCommandQueue(
  dedupTtlMs: number = DEFAULT_DEDUP_TTL_MS,
): CommandQueue {
  let chain: Promise<unknown> = Promise.resolve();
  const inflight = new Map<string, Promise<unknown>>();
  const recent = new Map<string, { expiresAt: number; value: unknown }>();

  return {
    run(id, run) {
      pruneExpired(recent);
      const cached = recent.get(id);
      if (cached !== undefined) {
        return Promise.resolve(cached.value as Awaited<ReturnType<typeof run>>);
      }

      const existing = inflight.get(id);
      if (existing !== undefined) {
        return existing as Promise<Awaited<ReturnType<typeof run>>>;
      }

      const task = enqueue(() => run()).then(
        (value) => {
          inflight.delete(id);
          recent.set(id, { expiresAt: Date.now() + dedupTtlMs, value });
          return value;
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

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(fn, fn);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function pruneExpired(
  recent: Map<string, { expiresAt: number; value: unknown }>,
) {
  const now = Date.now();
  for (const [id, entry] of recent) {
    if (entry.expiresAt <= now) recent.delete(id);
  }
}
