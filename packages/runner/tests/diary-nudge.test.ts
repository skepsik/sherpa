import type { OutboundCommand, OutboundResult } from '@sherpa/contract';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChannelSendOutcome } from '../src/types';

import { createInboundRouter } from '../src/inbound-router';
import {
  createPlaceSessionSlots,
  createSessionTestDouble,
  DIARY_FIXATION_NUDGE_TEXT,
  DIARY_READ_NUDGE_TEXT,
} from '../src/session';

void describe('diary nudge', () => {
  void it('cold start: start → diary-read → user text', async () => {
    const port = createSessionTestDouble();
    const sessionIds = new Map<string, string>([['place-a', '']]);
    const slots = createPlaceSessionSlots({
      getPlaceSessionId: (key) => sessionIds.get(key) ?? '',
      onEvent: () => undefined,
      sessionPort: port,
      setPlaceSessionId: (key, id) => {
        sessionIds.set(key, id);
      },
    });

    await slots.pushMessage({
      cwd: '/tmp/a',
      delivery: 'interject',
      key: 'place-a',
      text: 'задача',
    });
    await settle();

    const sequence = port.calls
      .filter((c) => c.type === 'start' || c.type === 'push')
      .map((c) => {
        if (c.type === 'start') return 'start';
        return c.text;
      });

    assert.deepEqual(sequence.slice(0, 3), [
      'start',
      DIARY_READ_NUDGE_TEXT,
      'задача',
    ]);
  });

  void it('resume без cold start — diary-read нет', async () => {
    const port = createSessionTestDouble();
    const sessionIds = new Map<string, string>([['place-a', 'existing-1']]);
    const slots = createPlaceSessionSlots({
      getPlaceSessionId: (key) => sessionIds.get(key) ?? '',
      onEvent: () => undefined,
      sessionPort: port,
      setPlaceSessionId: (key, id) => {
        sessionIds.set(key, id);
      },
    });

    await slots.pushMessage({
      cwd: '/tmp/a',
      delivery: 'interject',
      key: 'place-a',
      text: 'снова',
    });
    await settle();

    assert.ok(!port.calls.some((c) => c.type === 'start'));
    assert.ok(
      port.calls.some(
        (c) =>
          c.type === 'resume' &&
          c.sessionId === 'existing-1' &&
          c.cwd === '/tmp/a',
      ),
    );
    const pushes = port.calls.filter((c) => c.type === 'push');
    assert.equal(pushes.length, 2);
    assert.equal(pushes[0]?.type === 'push' && pushes[0].text, 'снова');
    assert.equal(
      pushes[1]?.type === 'push' && pushes[1].text,
      DIARY_FIXATION_NUDGE_TEXT,
    );
    assert.ok(
      !pushes.some(
        (c) => c.type === 'push' && c.text === DIARY_READ_NUDGE_TEXT,
      ),
    );
  });

  void it('ход с task push → на turn_ended уходит fixation', async () => {
    const port = createSessionTestDouble();
    const sessionIds = new Map<string, string>([['place-a', 's1']]);
    const slots = createPlaceSessionSlots({
      getPlaceSessionId: (key) => sessionIds.get(key) ?? '',
      onEvent: () => undefined,
      sessionPort: port,
      setPlaceSessionId: (key, id) => {
        sessionIds.set(key, id);
      },
    });

    await slots.pushMessage({
      cwd: '/tmp/a',
      delivery: 'interject',
      key: 'place-a',
      text: 'работа',
    });
    await settle();

    assert.ok(
      port.calls.some(
        (c) => c.type === 'push' && c.text === DIARY_FIXATION_NUDGE_TEXT,
      ),
    );
  });

  void it('ход только с runner-nudge — fixation не уходит (нет цикла)', async () => {
    const port = createSessionTestDouble();
    const sessionIds = new Map<string, string>([['place-a', '']]);
    const slots = createPlaceSessionSlots({
      getPlaceSessionId: (key) => sessionIds.get(key) ?? '',
      onEvent: () => undefined,
      sessionPort: port,
      setPlaceSessionId: (key, id) => {
        sessionIds.set(key, id);
      },
    });

    await slots.pushMessage({
      cwd: '/tmp/a',
      delivery: 'interject',
      key: 'place-a',
      text: 'user',
    });
    await settle();

    const fixationPushes = port.calls.filter(
      (c) => c.type === 'push' && c.text === DIARY_FIXATION_NUDGE_TEXT,
    );
    // один fixation после user-хода; после nudge-only fixation-хода — второго нет
    assert.equal(fixationPushes.length, 1);

    const readPushes = port.calls.filter(
      (c) => c.type === 'push' && c.text === DIARY_READ_NUDGE_TEXT,
    );
    assert.equal(readPushes.length, 1);
  });

  void it('ошибка push diary-read → log; user push и слот живы', async () => {
    const port = createSessionTestDouble();
    const sessionIds = new Map<string, string>([['place-a', '']]);
    let nudgeFails = 1;
    const opened = port.opened;
    const slots = createPlaceSessionSlots({
      getPlaceSessionId: (key) => sessionIds.get(key) ?? '',
      onEvent: () => undefined,
      sessionPort: {
        ...port,
        async start(input) {
          const session = await port.start(input);
          const originalPush = session.pushMessage.bind(session);
          session.pushMessage = async (text, delivery) => {
            if (
              nudgeFails > 0 &&
              (text === DIARY_READ_NUDGE_TEXT ||
                text === DIARY_FIXATION_NUDGE_TEXT)
            ) {
              nudgeFails -= 1;
              throw new Error('nudge transport down');
            }
            return originalPush(text, delivery);
          };
          return session;
        },
      },
      setPlaceSessionId: (key, id) => {
        sessionIds.set(key, id);
      },
    });

    const warnings: unknown[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      await slots.pushMessage({
        cwd: '/tmp/a',
        delivery: 'interject',
        key: 'place-a',
        text: 'после-сбоя',
      });
      await settle();
    } finally {
      console.warn = originalWarn;
    }

    assert.ok(
      warnings.some(
        (args) =>
          Array.isArray(args) &&
          String(args[0]).includes('diary-nudge: сбой push'),
      ),
      'сбой nudge залогирован',
    );
    assert.ok(slots.findLiveSession('place-a') !== null, 'слот жив');
    assert.ok(
      port.calls.some((c) => c.type === 'push' && c.text === 'после-сбоя'),
      'user text ушёл',
    );
    assert.equal(opened.length, 1);
  });

  void it('nudge-only ход: в Place нет echo и нет busy/idle этого хода', async () => {
    const port = createSessionTestDouble();
    const { router, sent } = makeHarness({
      places: { 'place-a': '/tmp/a' },
      sessionPort: port,
    });

    await router.handleInbound({
      event: { place: 'place-a', text: 'привет', type: 'message' },
      eventId: 'e1',
    });
    await settle();

    assert.ok(
      !sent.some(
        (c) =>
          c.type === 'send_message' &&
          c.text === `echo:${DIARY_READ_NUDGE_TEXT}`,
      ),
      'echo diary-read не в Place',
    );
    assert.ok(
      !sent.some(
        (c) =>
          c.type === 'send_message' &&
          c.text === `echo:${DIARY_FIXATION_NUDGE_TEXT}`,
      ),
      'echo fixation не в Place',
    );
    assert.ok(
      sent.some((c) => c.type === 'send_message' && c.text === 'echo:привет'),
    );

    const busy = sent.filter(
      (c) => c.type === 'set_status' && c.status === 'busy',
    );
    const idle = sent.filter(
      (c) => c.type === 'set_status' && c.status === 'idle',
    );
    // один task-ход: busy+idle; nudge-only ходы без status
    assert.equal(busy.length, 1);
    assert.equal(idle.length, 1);
  });
});

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function makeHarness(options: {
  places: Record<string, string>;
  sessionPort: ReturnType<typeof createSessionTestDouble>;
}) {
  const sent: OutboundCommand[] = [];
  const sessionIds = new Map<string, string>();
  for (const key of Object.keys(options.places)) {
    sessionIds.set(key, '');
  }

  const router = createInboundRouter({
    findCwdByPlaceKey: (key) => options.places[key] ?? null,
    getPlaceSessionId: (key) => sessionIds.get(key) ?? '',
    loadWorkdirRights: (cwd) => ({
      cwd,
      denies: [],
      denyGlobals: [],
      grants: [],
    }),
    midRunDefaultDelivery: 'interject',
    registryPath: ':memory:',
    send: async (command) => {
      sent.push(command);
      return {
        kind: 'success',
        result: successResult(command),
      } satisfies ChannelSendOutcome;
    },
    sessionPort: options.sessionPort,
    setPlaceSessionId: (key, sessionId) => {
      sessionIds.set(key, sessionId);
    },
  });
  return { router, sent };
}

async function settle() {
  for (let i = 0; i < 40; i += 1) {
    await Promise.resolve();
  }
  await delay(40);
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
