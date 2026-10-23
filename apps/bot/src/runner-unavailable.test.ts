import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NotifyApi } from './runner-unavailable';

import {
  notifyRunnerUnavailable,
  RUNNER_UNAVAILABLE_TEXT,
} from './runner-unavailable';

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

    await notifyRunnerUnavailable(api, { chatId: '10', kind: 'direct' });
    await notifyRunnerUnavailable(api, {
      chatId: '-100',
      kind: 'topic',
      topicId: '3',
    });

    assert.deepEqual(sent, [
      { chatId: '10', other: {}, text: RUNNER_UNAVAILABLE_TEXT },
      {
        chatId: '-100',
        other: { message_thread_id: 3 },
        text: RUNNER_UNAVAILABLE_TEXT,
      },
    ]);
  });
});
