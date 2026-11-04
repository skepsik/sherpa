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
  void it('resume ≠ SessionResumeError — session_id не сбрасывается, start нет', async () => {
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
      () => slots.pushMessage({ cwd: '/tmp/a', key: 'place-a', text: 'hi' }),
      /resume crashed/,
    );

    assert.equal(sessionIds.get('place-a'), 'keep-me');
    assert.ok(!port.calls.some((c) => c.type === 'start'));
    assert.equal(slots.findLiveSession('place-a'), null);
  });

  void it('после closed события старого handle (turn_ended) не в onEvent', async () => {
    const controllable = createControllablePort();
    const sessionIds = new Map([['place-a', '']]);
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

    await slots.pushMessage({ cwd: '/tmp/a', key: 'place-a', text: 'one' });
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
    const sessionIds = new Map([['place-a', '']]);
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

    await slots.pushMessage({ cwd: '/tmp/a', key: 'place-a', text: 'one' });
    controllable.emit(0, { type: 'turn_started' });
    slots.dropHandle('place-a');

    assert.equal(slots.getGeneration('place-a'), 1);
    assert.deepEqual(forwarded, ['turn_started', 'closed']);

    await slots.pushMessage({ cwd: '/tmp/a', key: 'place-a', text: 'two' });
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
      getPlaceSessionId: () => '',
      onEvent: (_key, event) => {
        forwarded.push(event.type);
      },
      sessionPort: port,
      setPlaceSessionId: () => undefined,
    });

    await slots.pushMessage({ cwd: '/tmp/a', key: 'place-a', text: 'one' });
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
