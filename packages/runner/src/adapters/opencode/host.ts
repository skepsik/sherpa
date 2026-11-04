import type {
  OpenCodeHost,
  OpenCodeHostEvent,
  OpenCodeHostEventData,
} from '../../types/opencode';

/**
 * Embedded host `@opencode/sdk` (in-memory router, без HTTP-слушателя).
 * Требует Node с `await using` (проверено на ≥26; 22 — SyntaxError в util).
 */
export async function createOpenCodeHost(
  options: {
    /** Путь БД сессий OpenCode; без — in-memory. */
    databasePath?: string;
  } = {},
): Promise<OpenCodeHost> {
  const { OpenCode } = await import('@opencode/sdk');
  const client = await OpenCode.create({
    ...(options.databasePath !== undefined
      ? { database: { path: options.databasePath } }
      : {}),
  });

  return {
    async close() {
      await client.close();
    },
    async createSession(input) {
      const session = await client.sessions.create({
        location: { directory: input.directory },
        permissions: [...input.permissions],
      });
      return { id: session.id };
    },
    async getSession(sessionId) {
      const session = await client.sessions.get({ sessionID: sessionId });
      return { id: session.id };
    },
    async interrupt(sessionId) {
      await client.sessions.interrupt({ sessionID: sessionId });
    },
    async prompt(input) {
      await client.sessions.prompt({
        delivery: input.delivery,
        sessionID: input.sessionId,
        text: input.text,
      });
    },
    async replyPermission(input) {
      await client.permission.reply({
        decision: input.decision,
        requestID: input.requestId,
        sessionID: input.sessionId,
      });
    },
    subscribeEvents() {
      return mapHostEvents(client.events.subscribe());
    },
  };
}

function findHostEventData(data: unknown): OpenCodeHostEventData | undefined {
  if (data === null || typeof data !== 'object') return undefined;
  return data as OpenCodeHostEventData;
}

async function* mapHostEvents(
  source: AsyncIterable<{ data?: unknown; type: string }>,
): AsyncIterable<OpenCodeHostEvent> {
  for await (const event of source) {
    yield {
      data: findHostEventData(event.data),
      type: event.type,
    };
  }
}
