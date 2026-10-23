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
  void it('send_text → send_ok с messageId; без parse_mode', async () => {
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
      type: 'send_text',
    });

    assert.deepEqual(result, {
      commandType: 'send_text',
      messageId: '42',
      type: 'send_ok',
    });
    assert.deepEqual(captured, {
      chatId: '100',
      other: {},
      text: 'привет',
    });
  });

  void it('send_text в топик передаёт message_thread_id', async () => {
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
      type: 'send_text',
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
      type: 'send_text',
    });

    assert.equal(called, false);
    assert.deepEqual(result, {
      code: 'transport_rejected',
      commandType: 'send_text',
      message: 'text exceeds Telegram limit of 4096 characters',
      type: 'error',
    });
  });

  void it('edit_text длиннее 4096 → transport_rejected, API не вызывается', async () => {
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
      type: 'edit_text',
    });

    assert.equal(called, false);
    assert.deepEqual(result, {
      code: 'transport_rejected',
      commandType: 'edit_text',
      message: 'text exceeds Telegram limit of 4096 characters',
      type: 'error',
    });
  });

  void it('send_buttons пакует callback_data через pack', async () => {
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
      type: 'send_buttons',
    });

    assert.deepEqual(result, {
      commandType: 'send_buttons',
      messageId: '9',
      type: 'send_ok',
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
      type: 'send_buttons',
    });

    assert.equal(called, false);
    assert.equal(result.type, 'error');
    if (result.type === 'error') {
      assert.equal(result.code, 'transport_rejected');
    }
  });

  void it('edit_text без buttons — markup не передаётся', async () => {
    let other: unknown;
    const api = mockApi({
      editMessageText: async (chatId, messageId, text, opts) => {
        other = { chatId, messageId, opts, text };
        return { message_id: messageId } as Awaited<
          ReturnType<OutboundApi['editMessageText']>
        >;
      },
    });

    const result = await executeOutbound(api, {
      messageId: '11',
      place: { chatId: '3', kind: 'direct' },
      text: 'обновлено',
      type: 'edit_text',
    });

    assert.deepEqual(result, {
      commandType: 'edit_text',
      messageId: '11',
      type: 'send_ok',
    });
    assert.deepEqual(other, {
      chatId: '3',
      messageId: 11,
      opts: undefined,
      text: 'обновлено',
    });
  });

  void it('edit_text buttons [] — снимает inline-кнопки', async () => {
    let markup: unknown;
    const api = mockApi({
      editMessageText: async (_c, _m, _t, opts) => {
        markup = opts?.reply_markup;
        return true;
      },
    });

    const result = await executeOutbound(api, {
      buttons: [],
      messageId: '12',
      place: { chatId: '3', kind: 'direct' },
      text: 'готово',
      type: 'edit_text',
    });

    assert.deepEqual(result, {
      commandType: 'edit_text',
      messageId: '12',
      type: 'send_ok',
    });
    assert.deepEqual(markup, { inline_keyboard: [] });
  });

  void it('edit_text замена кнопок — pack с requestId', async () => {
    let markup: unknown;
    const api = mockApi({
      editMessageText: async (_c, _m, _t, opts) => {
        markup = opts?.reply_markup;
        return { message_id: 13 } as Awaited<
          ReturnType<OutboundApi['editMessageText']>
        >;
      },
    });

    const result = await executeOutbound(api, {
      buttons: [{ data: 'retry', label: 'Ещё' }],
      messageId: '13',
      place: { chatId: '3', kind: 'direct' },
      requestId: 'perm-2',
      text: 'ещё раз?',
      type: 'edit_text',
    });

    assert.deepEqual(result, {
      commandType: 'edit_text',
      messageId: '13',
      type: 'send_ok',
    });
    const rows = (markup as { inline_keyboard: { callback_data: string }[][] })
      .inline_keyboard;
    assert.deepEqual(tryUnpackCallbackData(rows[0][0].callback_data), {
      data: 'retry',
      requestId: 'perm-2',
    });
  });

  void it('edit_text замена кнопок без requestId → transport_rejected', async () => {
    const api = mockApi({});
    const result = await executeOutbound(api, {
      buttons: [{ data: 'x', label: 'X' }],
      messageId: '1',
      place: { chatId: '1', kind: 'direct' },
      text: '?',
      type: 'edit_text',
    });
    assert.deepEqual(result, {
      code: 'transport_rejected',
      commandType: 'edit_text',
      message: 'requestId required when replacing buttons',
      type: 'error',
    });
  });

  void it('message is not modified → send_ok с тем же messageId', async () => {
    const api = mockApi({
      editMessageText: async () => {
        throw grammyError(400, 'Bad Request: message is not modified');
      },
    });

    const result = await executeOutbound(api, {
      messageId: '99',
      place: { chatId: '1', kind: 'direct' },
      text: 'то же',
      type: 'edit_text',
    });

    assert.deepEqual(result, {
      commandType: 'edit_text',
      messageId: '99',
      type: 'send_ok',
    });
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
      type: 'send_text',
    });

    assert.equal(calls, 2);
    assert.deepEqual(result, {
      commandType: 'send_text',
      messageId: '5',
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
      type: 'send_text',
    });

    assert.equal(calls, RATE_LIMIT_MAX_ATTEMPTS);
    assert.deepEqual(result, {
      code: 'send_failed',
      commandType: 'send_text',
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
      type: 'send_text',
    });

    assert.deepEqual(result, {
      code: 'place_unavailable',
      commandType: 'send_text',
      message: 'Forbidden: bot was blocked by the user',
      type: 'error',
    });
  });
});
