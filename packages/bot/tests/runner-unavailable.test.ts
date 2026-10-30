import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NotifyApi } from '../src/types';

import {
  notifyRunnerUnavailable,
  RUNNER_UNAVAILABLE_TEXT,
} from '../src/runner-unavailable';

void describe('notifyRunnerUnavailable', () => {
  void it('шлёт тот же текст в direct и в topic', async () => {
    const sent: unknown[] = [];
    const api: NotifyApi = {
      sendMessage: async (chatId, text, other) => {
        sent.push({ chatId, other, text });
        return { message_id: 1 } as Awaited<
          ReturnType<NotifyApi['sendMessage']>
        >;
      },
    };

    await notifyRunnerUnavailable(api, 'tg1:d:10');
    await notifyRunnerUnavailable(api, 'tg1:t:-100:3');

    assert.deepEqual(sent, [
      { chatId: '10', other: {}, text: RUNNER_UNAVAILABLE_TEXT },
      {
        chatId: '-100',
        other: { message_thread_id: 3 },
        text: RUNNER_UNAVAILABLE_TEXT,
      },
    ]);
  });

  void it('неизвестный place id — без sendMessage', async () => {
    let called = false;
    const api: NotifyApi = {
      sendMessage: async () => {
        called = true;
        return { message_id: 1 } as Awaited<
          ReturnType<NotifyApi['sendMessage']>
        >;
      },
    };

    await notifyRunnerUnavailable(api, 'not-a-place');
    assert.equal(called, false);
  });
});
