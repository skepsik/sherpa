import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  OpenSession,
  SessionEvent,
  SessionPort,
} from '../src/types/session';

import {
  createPlaceSessionSlots,
  createSessionTestDouble,
} from '../src/session';

void describe('place session slots', () => {
  void it('cold start: start → сразу user text; runner-prompt нет', async () => {
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

    assert.deepEqual(sequence, ['start', 'задача']);
  });

  void it('ход с user push → на turn_ended runner-prompt нет', async () => {
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

    const pushes = port.calls.filter((c) => c.type === 'push');
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0]?.type === 'push' && pushes[0].text, 'работа');
  });

  void it('resume SessionGoneError → сброс id, cold start, user-текст', async () => {
    const port = createSessionTestDouble();
    port.failResumeFor('gone');
    const sessionIds = new Map([['place-a', 'gone']]);

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
      text: 'после-gone',
    });
    await settle();

    const sequence = port.calls
      .filter(
        (c) => c.type === 'resume' || c.type === 'start' || c.type === 'push',
      )
      .map((c) => {
        if (c.type === 'resume') return `resume:${c.sessionId}`;
        if (c.type === 'start') return 'start';
        return c.text;
      });

    assert.deepEqual(sequence, ['resume:gone', 'start', 'после-gone']);
    assert.notEqual(sessionIds.get('place-a'), 'gone');
    assert.notEqual(sessionIds.get('place-a'), '');
  });

  void it('push SessionGoneError (сессия удалена) → cold start и повторный push', async () => {
    const port = createSessionTestDouble();
    port.failPushFor('gone');
    const sessionIds = new Map([['place-a', 'gone']]);

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

    const sequence = port.calls
      .filter(
        (c) => c.type === 'resume' || c.type === 'start' || c.type === 'push',
      )
      .map((c) => {
        if (c.type === 'resume') return `resume:${c.sessionId}`;
        if (c.type === 'start') return 'start';
        return c.text;
      });

    assert.deepEqual(sequence, ['resume:gone', 'start', 'снова']);
    assert.notEqual(sessionIds.get('place-a'), 'gone');
    assert.notEqual(sessionIds.get('place-a'), '');
  });

  void it('resume ≠ SessionGoneError — session_id не сбрасывается, start нет', async () => {
    const port = createSessionTestDouble();
    port.crashResumeFor('keep-me');
    const sessionIds = new Map([['place-a', 'keep-me']]);

    const slots = createPlaceSessionSlots({
      getPlaceSessionId: (key) => sessionIds.get(key) ?? '',
      onEvent: () => undefined,
      sessionPort: port,
      setPlaceSessionId: (key, id) => {
        sessionIds.set(key, id);
      },
    });

    await assert.rejects(
      () =>
        slots.pushMessage({
          cwd: '/tmp/a',
          delivery: 'interject',
          key: 'place-a',
          text: 'hi',
        }),
      /resume crashed/,
    );

    assert.equal(sessionIds.get('place-a'), 'keep-me');
    assert.ok(!port.calls.some((c) => c.type === 'start'));
    assert.equal(slots.findLiveSession('place-a'), null);
  });

  void it('после closed события старого handle (turn_ended) не в onEvent', async () => {
    const controllable = createControllablePort();
    const sessionIds = new Map([['place-a', 'ctrl-pre']]);
    const forwarded: SessionEvent['type'][] = [];

    const slots = createPlaceSessionSlots({
      getPlaceSessionId: (key) => sessionIds.get(key) ?? '',
      onEvent: (_key, event) => {
        forwarded.push(event.type);
      },
      sessionPort: controllable.port,
      setPlaceSessionId: (key, id) => {
        sessionIds.set(key, id);
      },
    });

    await slots.pushMessage({
      cwd: '/tmp/a',
      delivery: 'interject',
      key: 'place-a',
      text: 'one',
    });
    assert.equal(slots.getGeneration('place-a'), 0);

    controllable.emit(0, { type: 'turn_started' });
    controllable.emit(0, { type: 'closed' });
    assert.equal(slots.getGeneration('place-a'), 1);
    assert.equal(slots.findLiveSession('place-a'), null);

    controllable.emit(0, { type: 'turn_ended' });
    controllable.emit(0, { text: 'late', type: 'assistant_text' });

    assert.deepEqual(forwarded, ['turn_started', 'closed']);
  });

  void it('dropHandle→abort: closed → idle; поздний closed чужого не поверх нового хода', async () => {
    const controllable = createControllablePort();
    const sessionIds = new Map([['place-a', 'ctrl-pre']]);
    const forwarded: SessionEvent['type'][] = [];

    const slots = createPlaceSessionSlots({
      getPlaceSessionId: (key) => sessionIds.get(key) ?? '',
      onEvent: (_key, event) => {
        forwarded.push(event.type);
      },
      sessionPort: controllable.port,
      setPlaceSessionId: (key, id) => {
        sessionIds.set(key, id);
      },
    });

    await slots.pushMessage({
      cwd: '/tmp/a',
      delivery: 'interject',
      key: 'place-a',
      text: 'one',
    });
    controllable.emit(0, { type: 'turn_started' });
    slots.dropHandle('place-a');

    assert.equal(slots.getGeneration('place-a'), 1);
    assert.deepEqual(forwarded, ['turn_started', 'closed']);

    await slots.pushMessage({
      cwd: '/tmp/a',
      delivery: 'interject',
      key: 'place-a',
      text: 'two',
    });
    controllable.emit(1, { type: 'turn_started' });
    // поздний closed старого handle (индекс 0) — не поверх нового хода
    controllable.emit(0, { type: 'closed' });

    assert.deepEqual(forwarded, ['turn_started', 'closed', 'turn_started']);
  });

  void it('dropHandle: async abort без sync closed — idle сразу, generation++', async () => {
    const listeners = new Set<(event: SessionEvent) => void>();
    let closedLater: (() => void) | undefined;
    const session: OpenSession = {
      async abort() {
        await Promise.resolve();
        for (const listener of listeners) listener({ type: 'closed' });
        closedLater?.();
      },
      async answerPermission() {
        return;
      },
      async interruptTurn() {
        return;
      },
      async pushMessage() {
        return;
      },
      sessionId: 'async-1',
      subscribe(listener) {
        listeners.add(listener);
      },
    };
    const port: SessionPort = {
      async resume() {
        return session;
      },
      async start() {
        return session;
      },
    };
    const forwarded: SessionEvent['type'][] = [];
    const slots = createPlaceSessionSlots({
      getPlaceSessionId: () => 'async-1',
      onEvent: (_key, event) => {
        forwarded.push(event.type);
      },
      sessionPort: port,
      setPlaceSessionId: () => undefined,
    });

    await slots.pushMessage({
      cwd: '/tmp/a',
      delivery: 'interject',
      key: 'place-a',
      text: 'one',
    });
    slots.dropHandle('place-a');

    assert.equal(slots.getGeneration('place-a'), 1);
    assert.deepEqual(forwarded, ['closed']);
    assert.equal(slots.findLiveSession('place-a'), null);

    await new Promise<void>((resolve) => {
      closedLater = resolve;
    });
    assert.deepEqual(
      forwarded,
      ['closed'],
      'поздний closed abort не дублирует idle',
    );
  });
});

function createControllablePort() {
  const sessions: Array<{
    emit: (event: SessionEvent) => void;
    session: OpenSession;
  }> = [];
  let nextId = 1;

  function openSession() {
    const listeners = new Set<(event: SessionEvent) => void>();
    const sessionId = `ctrl-${nextId}`;
    nextId += 1;

    function emit(event: SessionEvent) {
      for (const listener of listeners) listener(event);
    }

    const session: OpenSession = {
      async abort() {
        emit({ type: 'closed' });
      },
      async answerPermission() {
        return;
      },
      async interruptTurn() {
        return;
      },
      async pushMessage() {
        return;
      },
      sessionId,
      subscribe(listener) {
        listeners.add(listener);
      },
    };

    sessions.push({ emit, session });
    return session;
  }

  const port: SessionPort = {
    async resume() {
      return openSession();
    },
    async start() {
      return openSession();
    },
  };

  return {
    emit(index: number, event: SessionEvent) {
      const entry = sessions[index];
      if (entry === undefined) {
        throw new Error(`controllable session[${index}] нет`);
      }
      entry.emit(event);
    },
    port,
  };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function settle() {
  for (let i = 0; i < 40; i += 1) {
    await Promise.resolve();
  }
  await delay(40);
}
