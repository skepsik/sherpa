import type { OutboundResult } from '@sherpa/contract';
import type { AddressInfo } from 'node:net';
import type { RawData, WebSocket } from 'ws';

import {
  encodeInbound,
  encodeOutboundResult,
  tryDecodeOutbound,
} from '@sherpa/contract';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, describe, it } from 'node:test';
import { WebSocketServer } from 'ws';

import type { ChannelClient } from '../src/types';

import { createChannelClient } from '../src/channel';
import { loadChannelConfig } from '../src/config';

const SECRET = 'runner-channel-secret';

void describe('loadChannelConfig', () => {
  void it('без URL / секрета — отказ', () => {
    assert.throws(() => loadChannelConfig({}), /SHERPA_CHANNEL_SECRET/);
    assert.throws(
      () =>
        loadChannelConfig({
          SHERPA_CHANNEL_SECRET: SECRET,
        }),
      /SHERPA_CHANNEL_URL/,
    );
    assert.throws(
      () =>
        loadChannelConfig({
          SHERPA_CHANNEL_SECRET: SECRET,
          SHERPA_CHANNEL_URL: 'http://127.0.0.1/v1/channel',
        }),
      /ws:\/\//,
    );
  });

  void it('полный ws URL + секрет', () => {
    const config = loadChannelConfig({
      SHERPA_CHANNEL_SECRET: SECRET,
      SHERPA_CHANNEL_URL: 'ws://127.0.0.1:8787/v1/channel',
    });
    assert.equal(config.secret, SECRET);
    assert.equal(config.url, 'ws://127.0.0.1:8787/v1/channel');
  });
});

void describe('channel client', () => {
  const cleanups: Array<() => Promise<void>> = [];

  after(async () => {
    for (const cleanup of cleanups) {
      await cleanup();
    }
  });

  void it('lifecycle: send до start / повторный start / start после displaced', async () => {
    const mock = await startMockServer({ secret: SECRET });
    cleanups.push(async () => mock.stop());

    const client = createChannelClient({
      config: { secret: SECRET, url: mock.url },
      onInbound: () => undefined,
    });
    cleanups.push(async () => client.stop());

    assert.throws(
      () =>
        void client.send({
          place: 'p1',
          text: 'early',
          type: 'send_message',
        }),
      /start не вызван/,
    );

    await client.start();
    await assert.rejects(() => client.start(), /уже запущен/);

    mock.displaceActive();
    await delay(50);
    await assert.rejects(() => client.start(), /displaced/);
  });

  void it('connect с Bearer; без секрета — отказ', async () => {
    const mock = await startMockServer({ secret: SECRET });
    cleanups.push(async () => mock.stop());

    const ok = createChannelClient({
      config: { secret: SECRET, url: mock.url },
      onInbound: () => undefined,
    });
    await ok.start();
    await ok.stop();

    const bad = createChannelClient({
      config: { secret: 'wrong', url: mock.url },
      onInbound: () => undefined,
    });
    await assert.rejects(() => bad.start(), /401|Unexpected server response/i);
  });

  void it('inbound доходит до onInbound', async () => {
    const mock = await startMockServer({ secret: SECRET });
    cleanups.push(async () => mock.stop());

    let resolveGot!: (value: { eventId: string; text: string }) => void;
    const got = new Promise<{ eventId: string; text: string }>((resolve) => {
      resolveGot = resolve;
    });
    const client = createChannelClient({
      config: { secret: SECRET, url: mock.url },
      onInbound: (inbound) => {
        if (inbound.event.type === 'message') {
          resolveGot({
            eventId: inbound.eventId,
            text: inbound.event.text,
          });
        }
      },
    });
    cleanups.push(async () => client.stop());
    await client.start();

    mock.publishInbound('42', {
      place: 'place-a',
      text: 'привет',
      type: 'message',
    });

    assert.deepEqual(await got, { eventId: '42', text: 'привет' });
  });

  void it('один Place: вторая outbound после завершения первой', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started: string[] = [];

    const mock = await startMockServer({
      onCommand: async (decoded) => {
        const text =
          decoded.command.type === 'send_message' ? decoded.command.text : '?';
        started.push(text);
        if (text === 'first') await firstGate;
        return {
          commandType: 'send_message' as const,
          type: 'send_ok' as const,
        };
      },
      secret: SECRET,
    });
    cleanups.push(async () => mock.stop());

    const client = createChannelClient({
      config: { secret: SECRET, url: mock.url },
      onInbound: () => undefined,
    });
    cleanups.push(async () => client.stop());
    await client.start();

    const first = client.send({
      place: 'same',
      text: 'first',
      type: 'send_message',
    });
    const second = client.send({
      place: 'same',
      text: 'second',
      type: 'send_message',
    });

    await delay(30);
    assert.deepEqual(started, ['first']);
    releaseFirst();

    assert.deepEqual(await first, {
      kind: 'success',
      result: { commandType: 'send_message', type: 'send_ok' },
    });
    assert.deepEqual(await second, {
      kind: 'success',
      result: { commandType: 'send_message', type: 'send_ok' },
    });
    assert.deepEqual(started, ['first', 'second']);
  });

  void it('разные Place — параллель', async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const started: string[] = [];

    const mock = await startMockServer({
      onCommand: async (decoded) => {
        const text =
          decoded.command.type === 'send_message' ? decoded.command.text : '?';
        started.push(text);
        if (text === 'a') await gateA;
        return {
          commandType: 'send_message' as const,
          type: 'send_ok' as const,
        };
      },
      secret: SECRET,
    });
    cleanups.push(async () => mock.stop());

    const client = createChannelClient({
      config: { secret: SECRET, url: mock.url },
      onInbound: () => undefined,
    });
    cleanups.push(async () => client.stop());
    await client.start();

    const sendA = client.send({
      place: 'pa',
      text: 'a',
      type: 'send_message',
    });
    const sendB = client.send({
      place: 'pb',
      text: 'b',
      type: 'send_message',
    });

    await delay(30);
    assert.deepEqual(started.sort(), ['a', 'b']);
    releaseA();
    assert.equal((await sendA).kind, 'success');
    assert.equal((await sendB).kind, 'success');
  });

  void it('mismatch — не success и не transport_reject', async () => {
    const mock = await startMockServer({
      onCommand: async () => ({
        commandType: 'set_status' as const,
        type: 'send_ok' as const,
      }),
      secret: SECRET,
    });
    cleanups.push(async () => mock.stop());

    const client = createChannelClient({
      config: { secret: SECRET, url: mock.url },
      onInbound: () => undefined,
    });
    cleanups.push(async () => client.stop());
    await client.start();

    const outcome = await client.send({
      place: 'p1',
      text: 'x',
      type: 'send_message',
    });
    assert.equal(outcome.kind, 'protocol_mismatch');
    assert.notEqual(outcome.kind, 'success');
    assert.notEqual(outcome.kind, 'transport_reject');
  });

  void it('transport_reject освобождает очередь Place', async () => {
    const mock = await startMockServer({
      onCommand: async (decoded) => {
        if (
          decoded.command.type === 'send_message' &&
          decoded.command.text === 'bad'
        ) {
          return {
            code: 'send_failed' as const,
            commandType: 'send_message' as const,
            message: 'nope',
            type: 'error' as const,
          };
        }
        return {
          commandType: 'send_message' as const,
          type: 'send_ok' as const,
        };
      },
      secret: SECRET,
    });
    cleanups.push(async () => mock.stop());

    const client = createChannelClient({
      config: { secret: SECRET, url: mock.url },
      onInbound: () => undefined,
    });
    cleanups.push(async () => client.stop());
    await client.start();

    const first = await client.send({
      place: 'p1',
      text: 'bad',
      type: 'send_message',
    });
    assert.equal(first.kind, 'transport_reject');

    const second = await client.send({
      place: 'p1',
      text: 'ok',
      type: 'send_message',
    });
    assert.equal(second.kind, 'success');
  });

  void it('timeout → unknown; очередь Place не зависла', async () => {
    let releaseSlow!: (result: OutboundResult) => void;
    const slowResult = new Promise<OutboundResult>((resolve) => {
      releaseSlow = resolve;
    });

    const mock = await startMockServer({
      onCommand: async () => slowResult,
      secret: SECRET,
    });
    cleanups.push(async () => mock.stop());

    const client = createChannelClient({
      config: { secret: SECRET, url: mock.url },
      onInbound: () => undefined,
      outcomeTimeoutMs: 40,
    });
    cleanups.push(async () => client.stop());
    await client.start();

    const first = await client.send({
      place: 'p1',
      text: 'slow',
      type: 'send_message',
    });
    assert.deepEqual(first, { cause: 'timeout', kind: 'unknown' });
    releaseSlow({
      commandType: 'send_message',
      type: 'send_ok',
    });

    mock.setOnCommand(async () => ({
      commandType: 'send_message' as const,
      type: 'send_ok' as const,
    }));

    const second = await client.send({
      place: 'p1',
      text: 'next',
      type: 'send_message',
    });
    assert.equal(second.kind, 'success');
  });

  void it('обрыв → unknown; reconnect; очередь не зависла', async () => {
    const mock = await startMockServer({ secret: SECRET });
    cleanups.push(async () => mock.stop());

    const client = createChannelClient({
      config: { secret: SECRET, url: mock.url },
      onInbound: () => undefined,
      outcomeTimeoutMs: 5_000,
    });
    cleanups.push(async () => client.stop());
    await client.start();

    mock.setOnCommand(async () => {
      mock.dropActive();
      return {
        commandType: 'send_message' as const,
        type: 'send_ok' as const,
      };
    });

    const pending = client.send({
      place: 'p1',
      text: 'lost',
      type: 'send_message',
    });
    assert.deepEqual(await pending, {
      cause: 'disconnect',
      kind: 'unknown',
    });

    await mock.waitForConnections(2);

    mock.setOnCommand(async () => ({
      commandType: 'send_message' as const,
      type: 'send_ok' as const,
    }));
    const again = await client.send({
      place: 'p1',
      text: 'after',
      type: 'send_message',
    });
    assert.equal(again.kind, 'success');
  });

  void it('displaced — без auto-reconnect; процесс/клиент жив', async () => {
    const mock = await startMockServer({ secret: SECRET });
    cleanups.push(async () => mock.stop());

    const client = createChannelClient({
      config: { secret: SECRET, url: mock.url },
      onInbound: () => undefined,
    });
    cleanups.push(async () => client.stop());
    await client.start();
    assert.equal(mock.connectionCount, 1);

    mock.displaceActive();
    await delay(80);
    // backoff первого reconnect ~1s; ждём чуть больше окна без reconnect
    await delay(1_200);
    assert.equal(mock.connectionCount, 1);

    const outcome = await client.send({
      place: 'p1',
      text: 'after-displace',
      type: 'send_message',
    });
    assert.deepEqual(outcome, { cause: 'displaced', kind: 'unknown' });
    // клиент отвечает, процесс не exit — send вернулся
    assertClientAlive(client);
  });
});

type MockCommandHandler = (
  decoded: NonNullable<ReturnType<typeof tryDecodeOutbound>>,
) => Promise<OutboundResult>;

function assertClientAlive(client: ChannelClient) {
  assert.equal(typeof client.send, 'function');
  assert.equal(typeof client.stop, 'function');
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function findFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    server.once('error', reject);
  });
}

function rawFromData(data: RawData) {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

async function startMockServer(options: {
  onCommand?: MockCommandHandler;
  secret: string;
}) {
  const port = await findFreePort();
  const path = '/v1/channel';
  let handler: MockCommandHandler =
    options.onCommand ??
    (async () => ({
      commandType: 'send_message' as const,
      type: 'send_ok' as const,
    }));

  let active: null | WebSocket = null;
  let connectionCount = 0;

  const httpServer = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(
      req.url ?? '/',
      `http://${req.headers.host ?? 'localhost'}`,
    );
    if (url.pathname !== path) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const auth = req.headers.authorization ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(auth);
    if (match?.[1] !== options.secret) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    connectionCount += 1;
    active = ws;
    ws.on('message', (data) => {
      void (async () => {
        const decoded = tryDecodeOutbound(rawFromData(data));
        if (decoded === null) {
          ws.close(1003, 'invalid wire');
          return;
        }
        const result = await handler(decoded);
        if (ws.readyState === ws.OPEN) {
          ws.send(encodeOutboundResult(decoded.id, result));
        }
      })();
    });
    ws.on('close', () => {
      if (active === ws) active = null;
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, '127.0.0.1', () => resolve());
    httpServer.once('error', reject);
  });

  return {
    get connectionCount() {
      return connectionCount;
    },
    displaceActive() {
      active?.close(1000, 'displaced');
    },
    dropActive() {
      active?.terminate();
    },
    publishInbound(
      eventId: string,
      event: { place: string; text: string; type: 'message' },
    ) {
      active?.send(encodeInbound(eventId, event));
    },
    setOnCommand(next: MockCommandHandler) {
      handler = next;
    },
    async stop() {
      active?.close();
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
    url: `ws://127.0.0.1:${port}${path}`,
    async waitForConnections(min: number) {
      const deadline = Date.now() + 5_000;
      while (connectionCount < min) {
        if (Date.now() > deadline) {
          throw new Error(
            `waitForConnections: got ${connectionCount}, want ${min}`,
          );
        }
        await delay(20);
      }
      return connectionCount;
    },
  };
}
