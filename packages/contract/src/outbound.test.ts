import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  OutboundCreateTopic,
  OutboundCreateTopicOk,
  OutboundEditText,
  OutboundError,
  OutboundErrorCode,
  OutboundSendButtons,
  OutboundSendOk,
  OutboundSendText,
} from './outbound';

import {
  encodeOutbound,
  encodeOutboundResult,
  tryDecodeOutbound,
  tryDecodeOutboundResult,
} from './outbound';
import { isTopicPlace } from './place';

function outboundCommandWire(
  command: unknown,
  overrides: Record<string, unknown> = {},
) {
  return JSON.stringify({
    command,
    direction: 'outbound',
    id: 'cmd-1',
    v: 1,
    ...overrides,
  });
}

function outboundResultWire(
  result: unknown,
  overrides: Record<string, unknown> = {},
) {
  return JSON.stringify({
    direction: 'outbound',
    id: 'cmd-1',
    result,
    v: 1,
    ...overrides,
  });
}

void describe('outbound encode/decode', () => {
  void it('roundtrip send_text', () => {
    const command: OutboundSendText = {
      place: { chatId: 'chat-1', kind: 'direct' },
      text: 'ответ',
      type: 'send_text',
    };
    const decoded = tryDecodeOutbound(encodeOutbound('c1', command));
    assert.deepEqual(decoded, { command, id: 'c1' });
  });

  void it('roundtrip send_buttons (callback-совместимо)', () => {
    const command: OutboundSendButtons = {
      buttons: [
        { data: 'allow', label: 'Разрешить' },
        { data: 'deny', label: 'Отклонить' },
      ],
      place: { chatId: 'chat-2', kind: 'topic', topicId: 't-9' },
      requestId: 'perm-42',
      text: 'Нужен доступ?',
      type: 'send_buttons',
    };
    const decoded = tryDecodeOutbound(encodeOutbound('c2', command));
    assert.deepEqual(decoded, { command, id: 'c2' });
  });

  void it('roundtrip create_topic + успешный результат', () => {
    const command: OutboundCreateTopic = {
      chatId: 'supergroup-1',
      title: 'проект-alpha',
      type: 'create_topic',
    };
    assert.deepEqual(tryDecodeOutbound(encodeOutbound('c3', command)), {
      command,
      id: 'c3',
    });

    const result: OutboundCreateTopicOk = {
      place: {
        chatId: 'supergroup-1',
        kind: 'topic',
        topicId: 'new-topic-7',
      },
      type: 'create_topic_ok',
    };
    const decodedResult = tryDecodeOutboundResult(
      encodeOutboundResult('c3', result),
    );
    assert.deepEqual(decodedResult, { id: 'c3', result });
    assert.ok(
      decodedResult &&
        decodedResult.result.type === 'create_topic_ok' &&
        isTopicPlace(decodedResult.result.place),
    );
  });

  void it('roundtrip edit_text (правка и снятие кнопок)', () => {
    const edit: OutboundEditText = {
      buttons: [],
      messageId: 'msg-9',
      place: { chatId: 'chat-2', kind: 'topic', topicId: 't-9' },
      text: 'обновлено',
      type: 'edit_text',
    };
    assert.deepEqual(tryDecodeOutbound(encodeOutbound('c-edit', edit)), {
      command: edit,
      id: 'c-edit',
    });
    const editTextOnly: OutboundEditText = {
      messageId: 'msg-9',
      place: { chatId: 'chat-2', kind: 'topic', topicId: 't-9' },
      text: 'только текст',
      type: 'edit_text',
    };
    assert.deepEqual(
      tryDecodeOutbound(encodeOutbound('c-edit2', editTextOnly)),
      { command: editTextOnly, id: 'c-edit2' },
    );
    const editReplace: OutboundEditText = {
      buttons: [{ data: 'retry', label: 'Ещё' }],
      messageId: 'msg-9',
      place: { chatId: 'chat-2', kind: 'topic', topicId: 't-9' },
      requestId: 'perm-2',
      text: 'ещё раз?',
      type: 'edit_text',
    };
    assert.deepEqual(
      tryDecodeOutbound(encodeOutbound('c-edit3', editReplace)),
      { command: editReplace, id: 'c-edit3' },
    );
  });

  void it('roundtrip отказ транспорта — все OutboundErrorCode', () => {
    const codes: OutboundErrorCode[] = [
      'create_topic_failed',
      'place_unavailable',
      'send_failed',
      'transport_rejected',
    ];
    for (const code of codes) {
      const result: OutboundError = { code, type: 'error' };
      assert.deepEqual(
        tryDecodeOutboundResult(encodeOutboundResult(`err-${code}`, result)),
        { id: `err-${code}`, result },
      );
    }
    const withMeta: OutboundError = {
      code: 'create_topic_failed',
      commandType: 'create_topic',
      message: 'forum topics disabled',
      type: 'error',
    };
    assert.deepEqual(
      tryDecodeOutboundResult(encodeOutboundResult('c4', withMeta)),
      { id: 'c4', result: withMeta },
    );
  });

  void it('roundtrip send_ok с messageId', () => {
    const cases: OutboundSendOk[] = [
      { commandType: 'send_text', messageId: 'm-text', type: 'send_ok' },
      { commandType: 'send_buttons', messageId: 'm-btn', type: 'send_ok' },
      { commandType: 'edit_text', messageId: 'm-edit', type: 'send_ok' },
    ];
    for (const [i, result] of cases.entries()) {
      assert.deepEqual(
        tryDecodeOutboundResult(encodeOutboundResult(`c${i}`, result)),
        { id: `c${i}`, result },
      );
    }
  });

  void it('отказ на невалидный wire команды', () => {
    const validSend = {
      place: { chatId: 'c', kind: 'direct' },
      text: 'hi',
      type: 'send_text',
    };
    const cases: { name: string; raw: string }[] = [
      { name: 'битый json', raw: '{' },
      {
        name: 'inbound envelope',
        raw: JSON.stringify({ direction: 'inbound', event: {}, v: 1 }),
      },
      {
        name: 'send_text без text',
        raw: outboundCommandWire({
          place: { chatId: 'c', kind: 'direct' },
          type: 'send_text',
        }),
      },
      {
        name: 'пустой id',
        raw: outboundCommandWire(validSend, { id: '' }),
      },
      {
        name: 'пустой chatId',
        raw: outboundCommandWire({
          place: { chatId: '', kind: 'direct' },
          text: 'hi',
          type: 'send_text',
        }),
      },
      {
        name: 'topic без topicId',
        raw: outboundCommandWire({
          place: { chatId: 'c', kind: 'topic' },
          text: 'hi',
          type: 'send_text',
        }),
      },
      {
        name: 'send_buttons с пустым topicId',
        raw: outboundCommandWire({
          buttons: [{ data: 'allow', label: 'Ok' }],
          place: { chatId: 'c', kind: 'topic', topicId: '' },
          requestId: 'r1',
          text: 'hi',
          type: 'send_buttons',
        }),
      },
      {
        name: 'пустой text',
        raw: outboundCommandWire({
          place: { chatId: 'c', kind: 'direct' },
          text: '',
          type: 'send_text',
        }),
      },
      {
        name: 'пустые buttons',
        raw: outboundCommandWire({
          buttons: [],
          place: { chatId: 'c', kind: 'direct' },
          requestId: 'r1',
          text: 'q',
          type: 'send_buttons',
        }),
      },
      {
        name: 'пустой requestId',
        raw: outboundCommandWire({
          buttons: [{ data: 'allow', label: 'Ok' }],
          place: { chatId: 'c', kind: 'direct' },
          requestId: '',
          text: 'q',
          type: 'send_buttons',
        }),
      },
      {
        name: 'пустой data кнопки',
        raw: outboundCommandWire({
          buttons: [{ data: '', label: 'Ok' }],
          place: { chatId: 'c', kind: 'direct' },
          requestId: 'r1',
          text: 'q',
          type: 'send_buttons',
        }),
      },
      {
        name: 'пустой label кнопки',
        raw: outboundCommandWire({
          buttons: [{ data: 'allow', label: '' }],
          place: { chatId: 'c', kind: 'direct' },
          requestId: 'r1',
          text: 'q',
          type: 'send_buttons',
        }),
      },
      {
        name: 'create_topic пустой chatId',
        raw: outboundCommandWire({
          chatId: '',
          title: 't',
          type: 'create_topic',
        }),
      },
      {
        name: 'create_topic пустой title',
        raw: outboundCommandWire({
          chatId: 'sg',
          title: '',
          type: 'create_topic',
        }),
      },
      {
        name: 'версия 2',
        raw: outboundCommandWire(validSend, { v: 2 }),
      },
      {
        name: 'command+result вместе',
        raw: outboundCommandWire(validSend, {
          result: {
            commandType: 'send_text',
            messageId: 'm1',
            type: 'send_ok',
          },
        }),
      },
      {
        name: 'edit_text пустой messageId',
        raw: outboundCommandWire({
          messageId: '',
          place: { chatId: 'c', kind: 'direct' },
          text: 'x',
          type: 'edit_text',
        }),
      },
      {
        name: 'edit_text пустой text',
        raw: outboundCommandWire({
          messageId: 'm1',
          place: { chatId: 'c', kind: 'direct' },
          text: '',
          type: 'edit_text',
        }),
      },
      {
        name: 'edit_text buttons не массив',
        raw: outboundCommandWire({
          buttons: 'x',
          messageId: 'm1',
          place: { chatId: 'c', kind: 'direct' },
          text: 'x',
          type: 'edit_text',
        }),
      },
      {
        name: 'edit_text невалидная кнопка',
        raw: outboundCommandWire({
          buttons: [{ data: '', label: 'Ok' }],
          messageId: 'm1',
          place: { chatId: 'c', kind: 'direct' },
          text: 'x',
          type: 'edit_text',
        }),
      },
    ];
    for (const { name, raw } of cases) {
      assert.equal(tryDecodeOutbound(raw), null, name);
    }
  });

  void it('отказ на невалидный wire результата', () => {
    const cases: { name: string; raw: string }[] = [
      { name: 'битый json', raw: '{' },
      {
        name: 'create_topic_ok с direct',
        raw: outboundResultWire({
          place: { chatId: 'c', kind: 'direct' },
          type: 'create_topic_ok',
        }),
      },
      {
        name: 'неизвестный code',
        raw: outboundResultWire({ code: 'unknown', type: 'error' }),
      },
      {
        name: 'send_ok с commandType create_topic',
        raw: outboundResultWire({
          commandType: 'create_topic',
          messageId: 'm1',
          type: 'send_ok',
        }),
      },
      {
        name: 'send_ok без messageId',
        raw: outboundResultWire({ commandType: 'send_text', type: 'send_ok' }),
      },
      {
        name: 'error message не строка',
        raw: outboundResultWire({
          code: 'send_failed',
          message: 1,
          type: 'error',
        }),
      },
      {
        name: 'error невалидный commandType',
        raw: outboundResultWire({
          code: 'send_failed',
          commandType: 'nope',
          type: 'error',
        }),
      },
      {
        name: 'command+result вместе',
        raw: outboundResultWire(
          { commandType: 'send_text', messageId: 'm1', type: 'send_ok' },
          {
            command: {
              place: { chatId: 'c', kind: 'direct' },
              text: 'x',
              type: 'send_text',
            },
          },
        ),
      },
    ];
    for (const { name, raw } of cases) {
      assert.equal(tryDecodeOutboundResult(raw), null, name);
    }
  });
});
