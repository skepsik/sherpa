import { encodeInbound, tryDecodeInbound } from '@sherpa/contract';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AccessFilter } from './access';
import type { TelegramUpdate } from './telegram-update';

import { tryPackCallbackData } from './callback-data';
import { mapTelegramUpdate } from './map-update';

const access: AccessFilter = {
  allowedChatIds: new Set(['-200', '100']),
  userId: '42',
};

void describe('mapTelegramUpdate', () => {
  void it('текст в личке → user_message + eventId; encodeInbound ок', () => {
    const update: TelegramUpdate = {
      message: {
        chat: { id: 100, type: 'private' },
        from: { id: 42 },
        text: 'привет',
      },
      update_id: 7,
    };
    const mapped = mapTelegramUpdate(update, access);
    assert.equal(mapped.answerCallbackQueryId, null);
    assert.deepEqual(mapped.inbound, {
      event: {
        place: { chatId: '100', kind: 'direct' },
        text: 'привет',
        type: 'user_message',
      },
      eventId: '7',
    });
    assert.ok(mapped.inbound);
    const decoded = tryDecodeInbound(
      encodeInbound(mapped.inbound.eventId, mapped.inbound.event),
    );
    assert.deepEqual(decoded, mapped.inbound);
  });

  void it('текст в топике форума → Place topic', () => {
    const update: TelegramUpdate = {
      message: {
        chat: { id: -200, type: 'supergroup' },
        from: { id: 42 },
        message_thread_id: 99,
        text: 'в топике',
      },
      update_id: 8,
    };
    const mapped = mapTelegramUpdate(update, access);
    assert.deepEqual(mapped.inbound?.event.place, {
      chatId: '-200',
      kind: 'topic',
      topicId: '99',
    });
  });

  void it('callback с валидным pack → callback + answer id', () => {
    const packed = tryPackCallbackData('req-1', 'yes');
    assert.ok(packed);
    const update: TelegramUpdate = {
      callback_query: {
        data: packed,
        from: { id: 42 },
        id: 'cq-9',
        message: {
          chat: { id: 100, type: 'private' },
          text: 'кнопки',
        },
      },
      update_id: 11,
    };
    const mapped = mapTelegramUpdate(update, access);
    assert.equal(mapped.answerCallbackQueryId, 'cq-9');
    assert.deepEqual(mapped.inbound, {
      event: {
        data: 'yes',
        place: { chatId: '100', kind: 'direct' },
        requestId: 'req-1',
        type: 'callback',
      },
      eventId: '11',
    });
  });

  void it('чужой пользователь → нет inbound', () => {
    const update: TelegramUpdate = {
      message: {
        chat: { id: 100, type: 'private' },
        from: { id: 999 },
        text: 'нет',
      },
      update_id: 1,
    };
    assert.deepEqual(mapTelegramUpdate(update, access), {
      answerCallbackQueryId: null,
      inbound: null,
    });
  });

  void it('чужой чат → нет inbound', () => {
    const update: TelegramUpdate = {
      message: {
        chat: { id: 555, type: 'private' },
        from: { id: 42 },
        text: 'нет',
      },
      update_id: 2,
    };
    assert.equal(mapTelegramUpdate(update, access).inbound, null);
  });

  void it('callback от чужого пользователя → answer без inbound', () => {
    const packed = tryPackCallbackData('req-1', 'yes');
    assert.ok(packed);
    const update: TelegramUpdate = {
      callback_query: {
        data: packed,
        from: { id: 999 },
        id: 'cq-foreign-user',
        message: {
          chat: { id: 100, type: 'private' },
        },
      },
      update_id: 12,
    };
    const mapped = mapTelegramUpdate(update, access);
    assert.equal(mapped.answerCallbackQueryId, 'cq-foreign-user');
    assert.equal(mapped.inbound, null);
  });

  void it('callback из чужого чата → answer без inbound', () => {
    const packed = tryPackCallbackData('req-1', 'yes');
    assert.ok(packed);
    const update: TelegramUpdate = {
      callback_query: {
        data: packed,
        from: { id: 42 },
        id: 'cq-foreign-chat',
        message: {
          chat: { id: 555, type: 'private' },
        },
      },
      update_id: 13,
    };
    const mapped = mapTelegramUpdate(update, access);
    assert.equal(mapped.answerCallbackQueryId, 'cq-foreign-chat');
    assert.equal(mapped.inbound, null);
  });

  void it('пустой text → нет inbound', () => {
    const update: TelegramUpdate = {
      message: {
        chat: { id: 100, type: 'private' },
        from: { id: 42 },
        text: '',
      },
      update_id: 14,
    };
    assert.equal(mapTelegramUpdate(update, access).inbound, null);
  });

  void it('media / caption без text → нет inbound', () => {
    const update: TelegramUpdate = {
      message: {
        caption: 'только подпись',
        chat: { id: 100, type: 'private' },
        from: { id: 42 },
      },
      update_id: 3,
    };
    assert.equal(mapTelegramUpdate(update, access).inbound, null);
  });

  void it('edited_message → нет inbound', () => {
    const update: TelegramUpdate = {
      edited_message: {
        chat: { id: 100, type: 'private' },
        from: { id: 42 },
        text: 'правка',
      },
      update_id: 4,
    };
    assert.equal(mapTelegramUpdate(update, access).inbound, null);
  });

  void it('General без message_thread_id → нет inbound', () => {
    const update: TelegramUpdate = {
      message: {
        chat: { id: -200, type: 'supergroup' },
        from: { id: 42 },
        text: 'general',
      },
      update_id: 5,
    };
    assert.equal(mapTelegramUpdate(update, access).inbound, null);
  });

  void it('callback без message → answer без inbound', () => {
    const update: TelegramUpdate = {
      callback_query: {
        from: { id: 42 },
        id: 'cq-no-msg',
      },
      update_id: 15,
    };
    const mapped = mapTelegramUpdate(update, access);
    assert.equal(mapped.answerCallbackQueryId, 'cq-no-msg');
    assert.equal(mapped.inbound, null);
  });

  void it('битый callback_data → answer без inbound', () => {
    const update: TelegramUpdate = {
      callback_query: {
        data: 'not-json',
        from: { id: 42 },
        id: 'cq-bad',
        message: {
          chat: { id: 100, type: 'private' },
        },
      },
      update_id: 6,
    };
    const mapped = mapTelegramUpdate(update, access);
    assert.equal(mapped.answerCallbackQueryId, 'cq-bad');
    assert.equal(mapped.inbound, null);
  });
});
