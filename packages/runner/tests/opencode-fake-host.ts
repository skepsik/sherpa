import type {
  OpenCodeHost,
  OpenCodeHostCreateSessionInput,
  OpenCodeHostEvent,
  OpenCodeHostPermissionReplyInput,
  OpenCodeHostPromptInput,
  OpenCodePermissionRule,
} from '../src/types/opencode';

type FakeHostController = OpenCodeHost & {
  readonly creates: OpenCodeHostCreateSessionInput[];
  emit(event: OpenCodeHostEvent): void;
  /** Сразу завершить subscribe (ошибка стрима). */
  endEvents(): void;
  failGetFor(sessionId: string): void;
  readonly prompts: OpenCodeHostPromptInput[];
  readonly replies: OpenCodeHostPermissionReplyInput[];
};

type FakeSession = {
  directory: string;
  id: string;
  permissions: OpenCodePermissionRule[];
};

/**
 * In-memory OpenCode host для CI: start/prompt/events без модели.
 */
export function createOpenCodeFakeHost(): FakeHostController {
  const creates: OpenCodeHostCreateSessionInput[] = [];
  const prompts: OpenCodeHostPromptInput[] = [];
  const replies: OpenCodeHostPermissionReplyInput[] = [];
  const sessions = new Map<string, FakeSession>();
  const failGet = new Set<string>();
  let nextSeq = 1;
  const eventWaiters: Array<(event: null | OpenCodeHostEvent) => void> = [];
  const queue: Array<null | OpenCodeHostEvent> = [];
  let closed = false;

  function pushEvent(event: null | OpenCodeHostEvent) {
    const waiter = eventWaiters.shift();
    if (waiter !== undefined) {
      waiter(event);
      return;
    }
    queue.push(event);
  }

  async function* subscribeEvents(): AsyncGenerator<OpenCodeHostEvent> {
    while (!closed) {
      const next =
        queue.length > 0
          ? queue.shift()!
          : await new Promise<null | OpenCodeHostEvent>((resolve) => {
              eventWaiters.push(resolve);
            });
      if (next === null) return;
      yield next;
    }
  }

  return {
    async close() {
      closed = true;
      pushEvent(null);
    },
    creates,
    async createSession(input) {
      creates.push(input);
      const id = `ses_fake_${nextSeq}`;
      nextSeq += 1;
      sessions.set(id, {
        directory: input.directory,
        id,
        permissions: [...input.permissions],
      });
      return { id };
    },
    emit(event) {
      pushEvent(event);
    },
    endEvents() {
      pushEvent(null);
    },
    failGetFor(sessionId) {
      failGet.add(sessionId);
    },
    async getSession(sessionId) {
      if (failGet.has(sessionId)) {
        failGet.delete(sessionId);
        const error = new Error(`Session not found: ${sessionId}`);
        error.name = 'SessionNotFoundError';
        throw error;
      }
      const session = sessions.get(sessionId);
      if (session === undefined) {
        const error = new Error(`Session not found: ${sessionId}`);
        error.name = 'SessionNotFoundError';
        throw error;
      }
      return { id: session.id };
    },
    async interrupt(sessionId) {
      pushEvent({
        data: { sessionID: sessionId },
        type: 'session.execution.interrupted',
      });
    },
    async prompt(input) {
      prompts.push(input);
      const sessionId = input.sessionId;
      // Ход: started → text.ended → succeeded (как у живого SDK без модели).
      queueMicrotask(() => {
        pushEvent({
          data: { sessionID: sessionId },
          type: 'session.execution.started',
        });
        pushEvent({
          data: { sessionID: sessionId, text: `mock:${input.text}` },
          type: 'session.text.ended',
        });
        pushEvent({
          data: { sessionID: sessionId },
          type: 'session.execution.succeeded',
        });
      });
    },
    prompts,
    replies,
    async replyPermission(input) {
      replies.push(input);
    },
    subscribeEvents,
  };
}
