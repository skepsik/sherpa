import type { OutboundCommand, OutboundResult } from '@sherpa/contract';
import type { AddressInfo } from 'node:net';
import type { RawData } from 'ws';

import {
  encodeOutbound,
  tryDecodeInbound,
  tryDecodeOutboundResult,
} from '@sherpa/contract';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, describe, it } from 'node:test';
import WebSocket from 'ws';

import type { ChannelConfig } from '../src/types';

import {
  createChannelServer,
  findHandshakeToken,
  isChannelSecret,
} from '../src/channel';

const SECRET = 'test-channel-secret';

void describe('channel WebSocket', () => {
  const servers: Array<{ stop: () => Promise<void> }> = [];

  after(async () => {
    for (const server of servers) {
      await server.stop();
    }
  });

  void it('с Bearer: inbound доходит; команда → результат с тем же id', async () => {
    const { channel, path, port } = await startChannel({
      execute: async (command) => {
        assert.equal(command.type, 'send_message');
        return okSend();
      },
    });
    servers.push(channel);

    const client = await connectClient(port, path, SECRET);
    const messages = createMessageQueue(client);

    assert.equal(
      channel.tryPublishInbound({
        event: {
          place: { chatId: '1', kind: 'direct' },
          text: 'привет',
          type: 'message',
        },
        eventId: '7',
      }),
      true,
    );

    assert.deepEqual(tryDecodeInbound(await messages.next()), {
      event: {
        place: { chatId: '1', kind: 'direct' },
        text: 'привет',
        type: 'message',
      },
      eventId: '7',
    });

    client.send(
      encodeOutbound('cmd-1', {
        place: { chatId: '1', kind: 'direct' },
        text: 'ответ',
        type: 'send_message',
      }),
    );
    assert.deepEqual(tryDecodeOutboundResult(await messages.next()), {
      id: 'cmd-1',
      result: {
        commandType: 'send_message',
        type: 'send_ok',
      },
    });

    client.close();
  });

  void it('без секрета / неверный / только query — 401', async () => {
    const { channel, path, port } = await startChannel({
      execute: async () => {
        throw new Error('execute must not run');
      },
    });
    servers.push(channel);

    await assert.rejects(
      () => connectClient(port, path, null),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /401|unexpected server response/i);
        return true;
      },
    );

    await assert.rejects(
      () => connectClient(port, path, 'wrong'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /401|unexpected server response/i);
        return true;
      },
    );

    await assert.rejects(
      () => connectClientWithQueryToken(port, path, SECRET),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /401|unexpected server response/i);
        return true;
      },
    );

    assert.equal(
      channel.tryPublishInbound({
        event: {
          place: { chatId: '1', kind: 'direct' },
          text: 'x',
          type: 'message',
        },
        eventId: 'no-runner',
      }),
      false,
    );
  });

  void it('невалидный wire → close 1003, execute не вызван', async () => {
    let calls = 0;
    const { channel, path, port } = await startChannel({
      execute: async () => {
        calls += 1;
        return okSend();
      },
    });
    servers.push(channel);

    const client = await connectClient(port, path, SECRET);
    const closed = onceCloseCode(client);
    client.send('not-a-valid-envelope');
    assert.equal(await closed, 1003);
    assert.equal(calls, 0);
  });

  void it('разные id не сериализуются очередью', async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const started: string[] = [];

    const { channel, path, port } = await startChannel({
      execute: async (command) => {
        started.push(command.type === 'send_message' ? command.text : '?');
        if (command.type === 'send_message' && command.text === 'a') {
          await gateA;
        }
        return okSend();
      },
    });
    servers.push(channel);

    const client = await connectClient(port, path, SECRET);
    const messages = createMessageQueue(client);

    client.send(
      encodeOutbound('id-a', {
        place: { chatId: '1', kind: 'direct' },
        text: 'a',
        type: 'send_message',
      }),
    );
    client.send(
      encodeOutbound('id-b', {
        place: { chatId: '1', kind: 'direct' },
        text: 'b',
        type: 'send_message',
      }),
    );

    await delay(20);
    assert.deepEqual(started, ['a', 'b']);
    releaseA();

    const results = [
      tryDecodeOutboundResult(await messages.next()),
      tryDecodeOutboundResult(await messages.next()),
    ];
    const ids = results.map((r) => r?.id).sort();
    assert.deepEqual(ids, ['id-a', 'id-b']);

    client.close();
  });

  void it('два клиента подряд — активен только последний', async () => {
    const { channel, path, port } = await startChannel({
      execute: async () => okSend(),
    });
    servers.push(channel);

    const first = await connectClient(port, path, SECRET);
    const firstClosed = onceClose(first);
    const second = await connectClient(port, path, SECRET);
    const messages = createMessageQueue(second);
    await firstClosed;

    assert.equal(
      channel.tryPublishInbound({
        event: {
          place: { chatId: '1', kind: 'direct' },
          text: 'только второму',
          type: 'message',
        },
        eventId: '9',
      }),
      true,
    );

    assert.equal(tryDecodeInbound(await messages.next())?.eventId, '9');

    first.close();
    second.close();
  });

  void it('нет клиента — tryPublishInbound false; буфера нет', async () => {
    const { channel, path, port } = await startChannel({
      execute: async () => {
        throw new Error('unused');
      },
    });
    servers.push(channel);

    assert.equal(
      channel.tryPublishInbound({
        event: {
          place: { chatId: '1', kind: 'direct' },
          text: 'lost',
          type: 'message',
        },
        eventId: '1',
      }),
      false,
    );

    const client = await connectClient(port, path, SECRET);
    const messages = createMessageQueue(client);
    const raced = Promise.race([
      messages.next().then(() => 'got' as const),
      delay(50).then(() => 'timeout' as const),
    ]);
    assert.equal(await raced, 'timeout');
    client.close();
  });
});

void describe('findHandshakeToken', () => {
  void it('Bearer — ок; query не читается', () => {
    assert.equal(findHandshakeToken('Bearer secret'), 'secret');
    assert.equal(findHandshakeToken('bearer secret'), 'secret');
    assert.equal(findHandshakeToken(undefined), null);
    assert.equal(findHandshakeToken('Basic secret'), null);
  });
});

void describe('isChannelSecret', () => {
  void it('совпадение / разная длина / другой текст', () => {
    assert.equal(isChannelSecret('secret', 'secret'), true);
    assert.equal(isChannelSecret('sec', 'secret'), false);
    assert.equal(isChannelSecret('secret!', 'secret'), false);
    assert.equal(isChannelSecret('wrong', 'secret'), false);
  });
});

async function connectClient(port: number, path: string, token: null | string) {
  const url = `ws://127.0.0.1:${port}${path}`;
  const headers =
    token === null ? undefined : { Authorization: `Bearer ${token}` };
  const ws = new WebSocket(url, { headers });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

async function connectClientWithQueryToken(
  port: number,
  path: string,
  token: string,
) {
  const url = `ws://127.0.0.1:${port}${path}?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

function createMessageQueue(ws: WebSocket) {
  const buffered: string[] = [];
  const waiters: Array<(raw: string) => void> = [];
  ws.on('message', (data) => {
    const raw = rawFromData(data);
    const waiter = waiters.shift();
    if (waiter !== undefined) waiter(raw);
    else buffered.push(raw);
  });
  return {
    next() {
      return new Promise<string>((resolve) => {
        const raw = buffered.shift();
        if (raw !== undefined) resolve(raw);
        else waiters.push(resolve);
      });
    },
  };
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

function okSend() {
  return { commandType: 'send_message' as const, type: 'send_ok' as const };
}

function onceClose(ws: WebSocket) {
  return new Promise<void>((resolve) => {
    ws.once('close', () => resolve());
  });
}

function onceCloseCode(ws: WebSocket) {
  return new Promise<number>((resolve) => {
    ws.once('close', (code) => resolve(code));
  });
}

function rawFromData(data: RawData) {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

async function startChannel(options: {
  execute: (command: OutboundCommand) => Promise<OutboundResult>;
}) {
  const port = await findFreePort();
  const config: ChannelConfig = {
    host: '127.0.0.1',
    path: '/v1/channel',
    port,
    secret: SECRET,
  };
  const channel = createChannelServer({
    config,
    execute: options.execute,
  });
  await channel.start();
  return { channel, path: config.path, port };
}
