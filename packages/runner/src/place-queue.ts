/**
 * Очередь задач на ключ Place: следующий стартует после завершения предыдущего
 * (успех / отказ / классифицированная ошибка ожидания — зона вызывающего).
 */
export function createPlaceQueues() {
  const tails = new Map<string, Promise<void>>();

  return {
    enqueue<T>(place: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(place) ?? Promise.resolve();
      const run = previous.then(task, task);
      tails.set(
        place,
        run.then(
          () => undefined,
          () => undefined,
        ),
      );
      return run;
    },
  };
}
