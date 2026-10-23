import { GrammyError } from 'grammy';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OutboundApi } from './outbound';

import { tryUnpackCallbackData } from './callback-data';
import {
  executeOutbound,
  RATE_LIMIT_MAX_ATTEMPTS,
  TELEGRAM_TEXT_MAX_CHARS,
} from './outbound';

function grammyError(
  errorCode: number,
  description: string,
  parameters: { retry_after?: number } = {},
) {
  return new GrammyError(
    `Call to 'test' failed!`,
    { description, error_code: errorCode, ok: false, parameters },
    'test',
    {},
  );
}

function mockApi(handlers: {
  createForumTopic?: OutboundApi['createForumTopic'];
  editMessageText?: OutboundApi['editMessageText'];
  sendMessage?: OutboundApi['sendMessage'];
}): OutboundApi {
  return {
    createForumTopic:
      handlers.createForumTopic ??
      (async () => {
        throw new Error('createForumTopic not stubbed');
      }),
    editMessageText:
      handlers.editMessageText ??
      (async () => {
        throw new Error('editMessageText not stubbed');
      }),
    sendMessage:
      handlers.sendMessage ??
      (async () => {
        throw new Error('sendMessage not stubbed');
      }),
  };
}

void describe('executeOutbound', () => {
  void it('send_message → send_ok без messageId; без parse_mode', async () => {
    let captured: unknown;
    const api = mockApi({
      sendMessage: async (chatId, text, other) => {
        captured = { chatId, other, text };
        return { message_id: 42 } as Awaited<
          ReturnType<OutboundApi['sendMessage']>
        >;
      },
    });

    const result = await executeOutbound(api, {
      place: { chatId: '100', kind: 'direct' },
      text: 'привет',
      type: 'send_message',
    });

    assert.deepEqual(result, {
      commandType: 'send_message',
      type: 'send_ok',
    });
    assert.deepEqual(captured, {
      chatId: '100',
      other: {},
      text: 'привет',
    });
  });

  void it('send_message в топик передаёт message_thread_id', async () => {
    let captured: unknown;
    const api = mockApi({
      sendMessage: async (chatId, text, other) => {
        captured = { chatId, other, text };
        return { message_id: 7 } as Awaited<
          ReturnType<OutboundApi['sendMessage']>
        >;
      },
    });

    await executeOutbound(api, {
      place: { chatId: '-100', kind: 'topic', topicId: '55' },
      text: 'ход',
      type: 'send_message',
    });

    assert.deepEqual(captured, {
      chatId: '-100',
      other: { message_thread_id: 55 },
      text: 'ход',
    });
  });

  void it('текст длиннее 4096 → transport_rejected, API не вызывается', async () => {
    let called = false;
    const api = mockApi({
      sendMessage: async () => {
        called = true;
        return { message_id: 1 } as Awaited<
          ReturnType<OutboundApi['sendMessage']>
        >;
      },
    });

    const result = await executeOutbound(api, {
      place: { chatId: '1', kind: 'direct' },
      text: 'x'.repeat(TELEGRAM_TEXT_MAX_CHARS + 1),
      type: 'send_message',
    });

    assert.equal(called, false);
    assert.deepEqual(result, {
      code: 'transport_rejected',
      commandType: 'send_message',
      message: 'text exceeds Telegram limit of 4096 characters',
      type: 'error',
    });
  });

  void it('resolve_question длиннее 4096 → transport_rejected', async () => {
    let called = false;
    const api = mockApi({
      editMessageText: async () => {
        called = true;
        return true;
      },
    });

    const result = await executeOutbound(api, {
      messageId: '1',
      place: { chatId: '1', kind: 'direct' },
      text: 'x'.repeat(TELEGRAM_TEXT_MAX_CHARS + 1),
      type: 'resolve_question',
    });

    assert.equal(called, false);
    assert.deepEqual(result, {
      code: 'transport_rejected',
      commandType: 'resolve_question',
      message: 'text exceeds Telegram limit of 4096 characters',
      type: 'error',
    });
  });

  void it('send_question → question_ok + messageId; pack callback_data', async () => {
    let keyboard: unknown;
    const api = mockApi({
      sendMessage: async (_chatId, _text, other) => {
        keyboard = other?.reply_markup;
        return { message_id: 9 } as Awaited<
          ReturnType<OutboundApi['sendMessage']>
        >;
      },
    });

    const result = await executeOutbound(api, {
      buttons: [
        { data: 'allow', label: 'Да' },
        { data: 'deny', label: 'Нет' },
      ],
      place: { chatId: '2', kind: 'direct' },
      requestId: 'perm-1',
      text: 'доступ?',
      type: 'send_question',
    });

    assert.deepEqual(result, {
      commandType: 'send_question',
      messageId: '9',
      type: 'question_ok',
    });
    assert.ok(keyboard && typeof keyboard === 'object');
    const rows = (
      keyboard as { inline_keyboard: { callback_data: string }[][] }
    ).inline_keyboard;
    assert.equal(rows.length, 2);
    assert.deepEqual(tryUnpackCallbackData(rows[0][0].callback_data), {
      data: 'allow',
      requestId: 'perm-1',
    });
    assert.deepEqual(tryUnpackCallbackData(rows[1][0].callback_data), {
      data: 'deny',
      requestId: 'perm-1',
    });
  });

  void it('pack не влезает в 64 байт → transport_rejected', async () => {
    let called = false;
    const api = mockApi({
      sendMessage: async () => {
        called = true;
        return { message_id: 1 } as Awaited<
          ReturnType<OutboundApi['sendMessage']>
        >;
      },
    });

    const result = await executeOutbound(api, {
      buttons: [{ data: 'd'.repeat(40), label: 'Ok' }],
      place: { chatId: '1', kind: 'direct' },
      requestId: 'r'.repeat(40),
      text: '?',
      type: 'send_question',
    });

    assert.equal(called, false);
    assert.equal(result.type, 'error');
    if (result.type === 'error') {
      assert.equal(result.code, 'transport_rejected');
    }
  });

  void it('resolve_question — текст + снятие кнопок → send_ok', async () => {
    let captured: unknown;
    const api = mockApi({
      editMessageText: async (chatId, messageId, text, opts) => {
        captured = { chatId, messageId, opts, text };
        return { message_id: messageId } as Awaited<
          ReturnType<OutboundApi['editMessageText']>
        >;
      },
    });

    const result = await executeOutbound(api, {
      messageId: '11',
      place: { chatId: '3', kind: 'direct' },
      text: 'выбрано',
      type: 'resolve_question',
    });

    assert.deepEqual(result, {
      commandType: 'resolve_question',
      type: 'send_ok',
    });
    assert.deepEqual(captured, {
      chatId: '3',
      messageId: 11,
      opts: { reply_markup: { inline_keyboard: [] } },
      text: 'выбрано',
    });
  });

  void it('message is not modified → send_ok', async () => {
    const api = mockApi({
      editMessageText: async () => {
        throw grammyError(400, 'Bad Request: message is not modified');
      },
    });

    const result = await executeOutbound(api, {
      messageId: '99',
      place: { chatId: '1', kind: 'direct' },
      text: 'то же',
      type: 'resolve_question',
    });

    assert.deepEqual(result, {
      commandType: 'resolve_question',
      type: 'send_ok',
    });
  });

  void it('set_status — заглушка → send_ok; API не вызывается', async () => {
    let called = false;
    const api = mockApi({
      editMessageText: async () => {
        called = true;
        return true;
      },
      sendMessage: async () => {
        called = true;
        return { message_id: 1 } as Awaited<
          ReturnType<OutboundApi['sendMessage']>
        >;
      },
    });

    for (const status of ['busy', 'idle'] as const) {
      const result = await executeOutbound(api, {
        place: { chatId: '1', kind: 'direct' },
        status,
        type: 'set_status',
      });
      assert.deepEqual(result, {
        commandType: 'set_status',
        type: 'send_ok',
      });
    }
    assert.equal(called, false);
  });

  void it('429: повтор после retry_after, затем успех', async () => {
    let calls = 0;
    const api = mockApi({
      sendMessage: async () => {
        calls += 1;
        if (calls === 1) {
          throw grammyError(429, 'Too Many Requests: retry after 0', {
            retry_after: 0,
          });
        }
        return { message_id: 5 } as Awaited<
          ReturnType<OutboundApi['sendMessage']>
        >;
      },
    });

    const result = await executeOutbound(api, {
      place: { chatId: '1', kind: 'direct' },
      text: 'ok',
      type: 'send_message',
    });

    assert.equal(calls, 2);
    assert.deepEqual(result, {
      commandType: 'send_message',
      type: 'send_ok',
    });
  });

  void it('429 исчерпан → send_failed', async () => {
    let calls = 0;
    const api = mockApi({
      sendMessage: async () => {
        calls += 1;
        throw grammyError(429, 'Too Many Requests: retry after 0', {
          retry_after: 0,
        });
      },
    });

    const result = await executeOutbound(api, {
      place: { chatId: '1', kind: 'direct' },
      text: 'ok',
      type: 'send_message',
    });

    assert.equal(calls, RATE_LIMIT_MAX_ATTEMPTS);
    assert.deepEqual(result, {
      code: 'send_failed',
      commandType: 'send_message',
      message: 'Too Many Requests: retry after 0',
      type: 'error',
    });
  });

  void it('create_topic → create_topic_ok с Place topic', async () => {
    const api = mockApi({
      createForumTopic: async (chatId, name) => {
        assert.equal(chatId, '-1001');
        assert.equal(name, 'alpha');
        return {
          icon_color: 0,
          message_thread_id: 77,
          name,
        };
      },
    });

    const result = await executeOutbound(api, {
      chatId: '-1001',
      title: 'alpha',
      type: 'create_topic',
    });

    assert.deepEqual(result, {
      place: { chatId: '-1001', kind: 'topic', topicId: '77' },
      type: 'create_topic_ok',
    });
  });

  void it('create_topic API-отказ → create_topic_failed', async () => {
    const api = mockApi({
      createForumTopic: async () => {
        throw grammyError(400, 'Bad Request: topics are disabled');
      },
    });

    const result = await executeOutbound(api, {
      chatId: '-1001',
      title: 'x',
      type: 'create_topic',
    });

    assert.deepEqual(result, {
      code: 'create_topic_failed',
      commandType: 'create_topic',
      message: 'Bad Request: topics are disabled',
      type: 'error',
    });
  });

  void it('запрещённый чат → place_unavailable', async () => {
    const api = mockApi({
      sendMessage: async () => {
        throw grammyError(403, 'Forbidden: bot was blocked by the user');
      },
    });

    const result = await executeOutbound(api, {
      place: { chatId: '1', kind: 'direct' },
      text: 'x',
      type: 'send_message',
    });

    assert.deepEqual(result, {
      code: 'place_unavailable',
      commandType: 'send_message',
      message: 'Forbidden: bot was blocked by the user',
      type: 'error',
    });
  });
});
