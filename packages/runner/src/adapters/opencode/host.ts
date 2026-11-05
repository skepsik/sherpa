import type {
  OpenCodeHost,
  OpenCodeHostEvent,
  OpenCodeHostEventData,
} from '../../types/opencode';

/**
 * Хост OpenCode: локальный background service (`@opencode/client`),
 * иначе embedded `@opencode/sdk`.
 *
 * Модель сессии (порядок OpenCode): явный `model` на create → иначе
 * `opencode.json` / конфиг cwd → иначе дефолт провайдера.
 */
export async function createOpenCodeHost(
  options: {
    /** Путь БД сессий OpenCode (только embed); без — in-memory. */
    databasePath?: string;
    /**
     * Явная модель (`provider/model`). Нет — OpenCode берёт из конфига cwd /
     * своего дефолта.
     */
    model?: string;
  } = {},
): Promise<OpenCodeHost> {
  const model = findModelRef(options.model);
  const serviceHost = await tryCreateServiceHost(model);
  if (serviceHost !== undefined) return serviceHost;
  return createEmbeddedHost(options.databasePath, model);
}

async function createEmbeddedHost(
  databasePath: string | undefined,
  model: ReturnType<typeof findModelRef>,
): Promise<OpenCodeHost> {
  const { OpenCode } = await import('@opencode/sdk');
  const client = await OpenCode.create({
    ...(databasePath !== undefined ? { database: { path: databasePath } } : {}),
  });

  return {
    async close() {
      await client.close();
    },
    async createSession(input) {
      const session = await client.sessions.create({
        location: { directory: input.directory },
        ...(model !== undefined ? { model } : {}),
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

/** `provider/model` → ref SDK; пусто / нет — undefined. */
function findModelRef(raw: string | undefined) {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (value === '') return undefined;
  const slash = value.indexOf('/');
  if (slash <= 0 || slash === value.length - 1) {
    throw new Error(
      `SHERPA_OPENCODE_MODEL: ожидается provider/model, получено «${value}»`,
    );
  }
  return {
    id: value.slice(slash + 1),
    providerID: value.slice(0, slash),
  };
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

async function tryCreateServiceHost(
  model: ReturnType<typeof findModelRef>,
): Promise<OpenCodeHost | undefined> {
  const { OpenCode } = await import('@opencode/client');
  const { Service } = await import('@opencode/client/service');
  const endpoint = await Service.discover();
  if (endpoint === undefined) return undefined;

  const authHeaders = Service.headers(endpoint);
  const client = OpenCode.make({
    baseUrl: endpoint.url,
    ...(authHeaders !== undefined ? { headers: authHeaders } : {}),
  });

  return {
    async close() {
      /* HTTP-клиент к внешнему service — закрывать нечего. */
    },
    async createSession(input) {
      const session = await client.session.create({
        location: { directory: input.directory },
        ...(model !== undefined ? { model } : {}),
        permissions: [...input.permissions],
      });
      return { id: session.id };
    },
    async getSession(sessionId) {
      const session = await client.session.get({ sessionID: sessionId });
      return { id: session.id };
    },
    async interrupt(sessionId) {
      await client.session.interrupt({ sessionID: sessionId });
    },
    async prompt(input) {
      await client.session.prompt({
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
      return mapHostEvents(client.event.subscribe());
    },
  };
}
