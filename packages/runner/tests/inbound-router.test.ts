import type { OutboundCommand, OutboundResult } from '@sherpa/contract';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChannelSendOutcome } from '../src/types';

import {
  buildOutsideRegistryText,
  createInboundRouter,
  STUB_ACCEPTED_TEXT,
} from '../src/inbound-router';

void describe('inbound router', () => {
  void it('seed-место: message → stub «принято»', async () => {
    const { router, sent } = makeHarness({
      places: { 'place-a': '/tmp/a' },
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'привет', type: 'message' },
      eventId: 'e1',
    });
    await settle();

    assert.equal(countStubAccepted(sent, 'place-a'), 1);
    assert.ok(sent.some((c) => c.type === 'set_status' && c.status === 'busy'));
    assert.ok(sent.some((c) => c.type === 'set_status' && c.status === 'idle'));
  });

  void it('нет в places: «вне реестра» с opaque id; stub нет', async () => {
    const place = 'opaque-unknown-42';
    const { router, sent } = makeHarness({ places: {} });

    await router.handleInbound({
      event: { place, text: 'hi', type: 'message' },
      eventId: 'e1',
    });
    await settle();

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.type, 'send_message');
    if (sent[0]?.type !== 'send_message') return;
    assert.equal(sent[0].text, buildOutsideRegistryText(place));
    assert.match(sent[0].text, new RegExp(place));
    assert.equal(countStubAccepted(sent, place), 0);
  });

  void it('два message подряд — один serial-drain; busy-reject нет', async () => {
    const gate = createGate();
    const { router, sent } = makeHarness({
      beforeSend: async (command) => {
        if (
          command.type === 'send_message' &&
          command.text === STUB_ACCEPTED_TEXT &&
          countStubAccepted(sent, 'place-a') === 0
        ) {
          await gate.wait;
        }
      },
      places: { 'place-a': '/tmp/a' },
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'one', type: 'message' },
      eventId: 'e1',
    });
    await router.handleInbound({
      event: { place: 'place-a', text: 'two', type: 'message' },
      eventId: 'e2',
    });
    await settle();

    assert.equal(
      countStubAccepted(sent, 'place-a'),
      0,
      'первый drain на gate — stub ещё нет',
    );

    gate.release();
    await settle();

    assert.equal(countStubAccepted(sent, 'place-a'), 2);
  });

  void it('question_answer при занятом drain сообщений — ack без ожидания FIFO', async () => {
    const gate = createGate();
    const { router, sent } = makeHarness({
      beforeSend: async (command) => {
        if (
          command.type === 'set_status' &&
          command.status === 'busy' &&
          command.place === 'place-a'
        ) {
          await gate.wait;
        }
      },
      places: { 'place-a': '/tmp/a' },
    });

    void router.handleInbound({
      event: { place: 'place-a', text: 'long', type: 'message' },
      eventId: 'm1',
    });
    await settle();

    await router.handleInbound({
      event: {
        data: 'yes',
        place: 'place-a',
        requestId: 'req-1',
        type: 'question_answer',
      },
      eventId: 'qa1',
    });

    assert.equal(
      countStubAccepted(sent, 'place-a'),
      1,
      'ack question_answer ушёл, пока message drain на busy/gate',
    );
    assert.ok(
      !sent.some((c) => c.type === 'set_status' && c.status === 'busy'),
      'busy drain ещё не прошёл beforeSend',
    );

    gate.release();
    await settle();

    assert.equal(countStubAccepted(sent, 'place-a'), 2);
    assert.ok(sent.some((c) => c.type === 'set_status' && c.status === 'busy'));
  });

  void it('сбой outbound на stub — следующий job всё же обрабатывается', async () => {
    let messageStubAttempts = 0;
    const { router, sent } = makeHarness({
      places: { 'place-a': '/tmp/a' },
      sendOutcome: (command) => {
        if (
          command.type === 'send_message' &&
          command.text === STUB_ACCEPTED_TEXT
        ) {
          messageStubAttempts += 1;
          if (messageStubAttempts === 1) {
            return { cause: 'timeout', kind: 'unknown' };
          }
        }
        return { kind: 'success', result: successResult(command) };
      },
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'one', type: 'message' },
      eventId: 'e1',
    });
    await router.handleInbound({
      event: { place: 'place-a', text: 'two', type: 'message' },
      eventId: 'e2',
    });
    await settle();

    assert.equal(messageStubAttempts, 2);
    assert.equal(countStubAccepted(sent, 'place-a'), 2);
  });

  void it('повтор eventId — один эффект (в т.ч. «вне реестра»)', async () => {
    const place = 'unknown-dup';
    const { router, sent } = makeHarness({ places: {} });

    await router.handleInbound({
      event: { place, text: 'a', type: 'message' },
      eventId: 'same',
    });
    await router.handleInbound({
      event: { place, text: 'b', type: 'message' },
      eventId: 'same',
    });
    await settle();

    assert.equal(sent.length, 1);
    assert.equal(
      sent[0]?.type === 'send_message' ? sent[0].text : '',
      buildOutsideRegistryText(place),
    );
  });

  void it('два места — независимые drain', async () => {
    const gateA = createGate();
    const { router, sent } = makeHarness({
      beforeSend: async (command) => {
        if (
          command.type === 'send_message' &&
          command.place === 'place-a' &&
          command.text === STUB_ACCEPTED_TEXT
        ) {
          await gateA.wait;
        }
      },
      places: { 'place-a': '/tmp/a', 'place-b': '/tmp/b' },
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'a', type: 'message' },
      eventId: 'ea',
    });
    await router.handleInbound({
      event: { place: 'place-b', text: 'b', type: 'message' },
      eventId: 'eb',
    });
    await settle();

    assert.equal(countStubAccepted(sent, 'place-b'), 1);
    assert.equal(countStubAccepted(sent, 'place-a'), 0);

    gateA.release();
    await settle();
    assert.equal(countStubAccepted(sent, 'place-a'), 1);
  });
});

function countStubAccepted(sent: OutboundCommand[], place: string) {
  return sent.filter(
    (c) =>
      c.type === 'send_message' &&
      c.place === place &&
      c.text === STUB_ACCEPTED_TEXT,
  ).length;
}

function createGate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release: () => release(), wait };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function makeHarness(options: {
  beforeSend?: (command: OutboundCommand) => Promise<void>;
  places: Record<string, string>;
  sendOutcome?: (command: OutboundCommand) => ChannelSendOutcome;
}) {
  const sent: OutboundCommand[] = [];
  const router = createInboundRouter({
    findCwdByPlaceKey: (key) => options.places[key] ?? null,
    send: async (command) => {
      await options.beforeSend?.(command);
      sent.push(command);
      return (
        options.sendOutcome?.(command) ?? {
          kind: 'success',
          result: successResult(command),
        }
      );
    },
  });
  return { router, sent };
}

async function settle() {
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve();
  }
  await delay(20);
}

function successResult(command: OutboundCommand): OutboundResult {
  switch (command.type) {
    case 'create_place':
      return { place: 'new', type: 'create_place_ok' };
    case 'resolve_question':
    case 'send_message':
    case 'set_status':
      return { commandType: command.type, type: 'send_ok' };
    case 'send_question':
      return {
        commandType: 'send_question',
        messageId: 'm1',
        type: 'question_ok',
      };
  }
}
