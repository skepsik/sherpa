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
    assert.equal(decoded?.command.type, 'send_buttons');
    if (decoded?.command.type === 'send_buttons') {
      assert.equal(decoded.command.requestId, 'perm-42');
      assert.equal(decoded.command.buttons[0]?.data, 'allow');
    }
  });

  void it('roundtrip create_topic + успешный результат', () => {
    const command: OutboundCreateTopic = {
      chatId: 'supergroup-1',
      title: 'проект-alpha',
      type: 'create_topic',
    };
    const decodedCmd = tryDecodeOutbound(encodeOutbound('c3', command));
    assert.deepEqual(decodedCmd, { command, id: 'c3' });

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
    const sendTextOk: OutboundSendOk = {
      commandType: 'send_text',
      messageId: 'm-text',
      type: 'send_ok',
    };
    assert.deepEqual(
      tryDecodeOutboundResult(encodeOutboundResult('c5', sendTextOk)),
      { id: 'c5', result: sendTextOk },
    );
    const sendButtonsOk: OutboundSendOk = {
      commandType: 'send_buttons',
      messageId: 'm-btn',
      type: 'send_ok',
    };
    assert.deepEqual(
      tryDecodeOutboundResult(encodeOutboundResult('c6', sendButtonsOk)),
      { id: 'c6', result: sendButtonsOk },
    );
    const editOk: OutboundSendOk = {
      commandType: 'edit_text',
      messageId: 'm-edit',
      type: 'send_ok',
    };
    assert.deepEqual(
      tryDecodeOutboundResult(encodeOutboundResult('c7', editOk)),
      { id: 'c7', result: editOk },
    );
    assert.equal(
      tryDecodeOutboundResult(
        outboundResultWire({ commandType: 'send_text', type: 'send_ok' }),
      ),
      null,
    );
  });

  void it('отказ на невалидный wire команды', () => {
    assert.equal(tryDecodeOutbound('{'), null);
    assert.equal(
      tryDecodeOutbound(
        JSON.stringify({ direction: 'inbound', event: {}, v: 1 }),
      ),
      null,
    );
    assert.equal(
      tryDecodeOutbound(
        outboundCommandWire({
          place: { chatId: 'c', kind: 'direct' },
          type: 'send_text',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeOutbound(
        outboundCommandWire(
          {
            place: { chatId: 'c', kind: 'direct' },
            text: 'hi',
            type: 'send_text',
          },
          { id: '' },
        ),
      ),
      null,
    );
    assert.equal(
      tryDecodeOutbound(
        outboundCommandWire({
          place: { chatId: '', kind: 'direct' },
          text: 'hi',
          type: 'send_text',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeOutbound(
        outboundCommandWire({
          place: { chatId: 'c', kind: 'topic' },
          text: 'hi',
          type: 'send_text',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeOutbound(
        outboundCommandWire({
          buttons: [{ data: 'allow', label: 'Ok' }],
          place: { chatId: 'c', kind: 'topic', topicId: '' },
          requestId: 'r1',
          text: 'hi',
          type: 'send_buttons',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeOutbound(
        outboundCommandWire({
          place: { chatId: 'c', kind: 'direct' },
          text: '',
          type: 'send_text',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeOutbound(
        outboundCommandWire({
          buttons: [],
          place: { chatId: 'c', kind: 'direct' },
          requestId: 'r1',
          text: 'q',
          type: 'send_buttons',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeOutbound(
        outboundCommandWire({
          buttons: [{ data: 'allow', label: 'Ok' }],
          place: { chatId: 'c', kind: 'direct' },
          requestId: '',
          text: 'q',
          type: 'send_buttons',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeOutbound(
        outboundCommandWire({
          buttons: [{ data: '', label: 'Ok' }],
          place: { chatId: 'c', kind: 'direct' },
          requestId: 'r1',
          text: 'q',
          type: 'send_buttons',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeOutbound(
        outboundCommandWire({
          buttons: [{ data: 'allow', label: '' }],
          place: { chatId: 'c', kind: 'direct' },
          requestId: 'r1',
          text: 'q',
          type: 'send_buttons',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeOutbound(
        outboundCommandWire({
          chatId: '',
          title: 't',
          type: 'create_topic',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeOutbound(
        outboundCommandWire({
          chatId: 'sg',
          title: '',
          type: 'create_topic',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeOutbound(
        outboundCommandWire(
          {
            place: { chatId: 'c', kind: 'direct' },
            text: 'hi',
            type: 'send_text',
          },
          { v: 2 },
        ),
      ),
      null,
    );
    assert.equal(
      tryDecodeOutbound(
        outboundCommandWire(
          {
            place: { chatId: 'c', kind: 'direct' },
            text: 'hi',
            type: 'send_text',
          },
          { result: { commandType: 'send_text', type: 'send_ok' } },
        ),
      ),
      null,
    );
  });

  void it('отказ на невалидный wire результата', () => {
    assert.equal(tryDecodeOutboundResult('{'), null);
    assert.equal(
      tryDecodeOutboundResult(
        outboundResultWire({
          place: { chatId: 'c', kind: 'direct' },
          type: 'create_topic_ok',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeOutboundResult(
        outboundResultWire({ code: 'unknown', type: 'error' }),
      ),
      null,
    );
    assert.equal(
      tryDecodeOutboundResult(
        outboundResultWire({ commandType: 'create_topic', type: 'send_ok' }),
      ),
      null,
    );
    assert.equal(
      tryDecodeOutboundResult(
        outboundResultWire(
          { commandType: 'send_text', type: 'send_ok' },
          {
            command: {
              place: { chatId: 'c', kind: 'direct' },
              text: 'x',
              type: 'send_text',
            },
          },
        ),
      ),
      null,
    );
  });
});
