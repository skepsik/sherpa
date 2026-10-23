import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  OutboundCreateTopic,
  OutboundCreateTopicOk,
  OutboundError,
  OutboundErrorCode,
  OutboundQuestionOk,
  OutboundResolveQuestion,
  OutboundSendMessage,
  OutboundSendOk,
  OutboundSendQuestion,
  OutboundSetStatus,
} from '../src/outbound';

import {
  encodeOutbound,
  encodeOutboundResult,
  tryDecodeOutbound,
  tryDecodeOutboundResult,
} from '../src/outbound';
import { isTopicPlace } from '../src/place';

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
  void it('roundtrip send_message', () => {
    const command: OutboundSendMessage = {
      place: { chatId: 'chat-1', kind: 'direct' },
      text: 'ответ',
      type: 'send_message',
    };
    const decoded = tryDecodeOutbound(encodeOutbound('c1', command));
    assert.deepEqual(decoded, { command, id: 'c1' });
  });

  void it('roundtrip send_question (question_answer-совместимо)', () => {
    const command: OutboundSendQuestion = {
      buttons: [
        { data: 'allow', label: 'Разрешить' },
        { data: 'deny', label: 'Отклонить' },
      ],
      place: { chatId: 'chat-2', kind: 'topic', topicId: 't-9' },
      requestId: 'perm-42',
      text: 'Нужен доступ?',
      type: 'send_question',
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

  void it('roundtrip resolve_question', () => {
    const command: OutboundResolveQuestion = {
      messageId: 'msg-9',
      place: { chatId: 'chat-2', kind: 'topic', topicId: 't-9' },
      text: 'выбрано: allow',
      type: 'resolve_question',
    };
    assert.deepEqual(tryDecodeOutbound(encodeOutbound('c-resolve', command)), {
      command,
      id: 'c-resolve',
    });
  });

  void it('roundtrip set_status busy|idle', () => {
    for (const status of ['busy', 'idle'] as const) {
      const command: OutboundSetStatus = {
        place: { chatId: 'chat-1', kind: 'direct' },
        status,
        type: 'set_status',
      };
      assert.deepEqual(
        tryDecodeOutbound(encodeOutbound(`status-${status}`, command)),
        { command, id: `status-${status}` },
      );
    }
  });

  void it('roundtrip отказ транспорта — все OutboundErrorCode', () => {
    const codes: OutboundErrorCode[] = [
      'create_topic_failed',
      'place_unavailable',
      'send_failed',
      'transport_rejected',
    ];
    for (const code of codes) {
      const result: OutboundError = {
        code,
        commandType: 'send_message',
        message: `err-${code}`,
        type: 'error',
      };
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

  void it('roundtrip send_ok без messageId', () => {
    const cases: OutboundSendOk[] = [
      { commandType: 'send_message', type: 'send_ok' },
      { commandType: 'resolve_question', type: 'send_ok' },
      { commandType: 'set_status', type: 'send_ok' },
    ];
    for (const [i, result] of cases.entries()) {
      assert.deepEqual(
        tryDecodeOutboundResult(encodeOutboundResult(`c${i}`, result)),
        { id: `c${i}`, result },
      );
    }
  });

  void it('roundtrip question_ok с messageId', () => {
    const result: OutboundQuestionOk = {
      commandType: 'send_question',
      messageId: 'm-q',
      type: 'question_ok',
    };
    assert.deepEqual(
      tryDecodeOutboundResult(encodeOutboundResult('cq', result)),
      { id: 'cq', result },
    );
  });

  void it('отказ на невалидный wire команды', () => {
    const validSend = {
      place: { chatId: 'c', kind: 'direct' },
      text: 'hi',
      type: 'send_message',
    };
    const cases: { name: string; raw: string }[] = [
      { name: 'битый json', raw: '{' },
      {
        name: 'inbound envelope',
        raw: JSON.stringify({ direction: 'inbound', event: {}, v: 1 }),
      },
      {
        name: 'send_message без text',
        raw: outboundCommandWire({
          place: { chatId: 'c', kind: 'direct' },
          type: 'send_message',
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
          type: 'send_message',
        }),
      },
      {
        name: 'topic без topicId',
        raw: outboundCommandWire({
          place: { chatId: 'c', kind: 'topic' },
          text: 'hi',
          type: 'send_message',
        }),
      },
      {
        name: 'send_question с пустым topicId',
        raw: outboundCommandWire({
          buttons: [{ data: 'allow', label: 'Ok' }],
          place: { chatId: 'c', kind: 'topic', topicId: '' },
          requestId: 'r1',
          text: 'hi',
          type: 'send_question',
        }),
      },
      {
        name: 'пустой text',
        raw: outboundCommandWire({
          place: { chatId: 'c', kind: 'direct' },
          text: '',
          type: 'send_message',
        }),
      },
      {
        name: 'пустые buttons',
        raw: outboundCommandWire({
          buttons: [],
          place: { chatId: 'c', kind: 'direct' },
          requestId: 'r1',
          text: 'q',
          type: 'send_question',
        }),
      },
      {
        name: 'пустой requestId',
        raw: outboundCommandWire({
          buttons: [{ data: 'allow', label: 'Ok' }],
          place: { chatId: 'c', kind: 'direct' },
          requestId: '',
          text: 'q',
          type: 'send_question',
        }),
      },
      {
        name: 'пустой data кнопки',
        raw: outboundCommandWire({
          buttons: [{ data: '', label: 'Ok' }],
          place: { chatId: 'c', kind: 'direct' },
          requestId: 'r1',
          text: 'q',
          type: 'send_question',
        }),
      },
      {
        name: 'пустой label кнопки',
        raw: outboundCommandWire({
          buttons: [{ data: 'allow', label: '' }],
          place: { chatId: 'c', kind: 'direct' },
          requestId: 'r1',
          text: 'q',
          type: 'send_question',
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
            commandType: 'send_message',
            type: 'send_ok',
          },
        }),
      },
      {
        name: 'resolve_question пустой messageId',
        raw: outboundCommandWire({
          messageId: '',
          place: { chatId: 'c', kind: 'direct' },
          text: 'x',
          type: 'resolve_question',
        }),
      },
      {
        name: 'resolve_question пустой text',
        raw: outboundCommandWire({
          messageId: 'm1',
          place: { chatId: 'c', kind: 'direct' },
          text: '',
          type: 'resolve_question',
        }),
      },
      {
        name: 'set_status неизвестный status',
        raw: outboundCommandWire({
          place: { chatId: 'c', kind: 'direct' },
          status: 'thinking',
          type: 'set_status',
        }),
      },
      {
        name: 'старый type send_text',
        raw: outboundCommandWire({
          place: { chatId: 'c', kind: 'direct' },
          text: 'hi',
          type: 'send_text',
        }),
      },
      {
        name: 'старый type edit_text',
        raw: outboundCommandWire({
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
        raw: outboundResultWire({
          code: 'unknown',
          commandType: 'send_message',
          message: 'x',
          type: 'error',
        }),
      },
      {
        name: 'send_ok с commandType create_topic',
        raw: outboundResultWire({
          commandType: 'create_topic',
          type: 'send_ok',
        }),
      },
      {
        name: 'send_ok с messageId',
        raw: outboundResultWire({
          commandType: 'send_message',
          messageId: 'm1',
          type: 'send_ok',
        }),
      },
      {
        name: 'send_ok с commandType send_question',
        raw: outboundResultWire({
          commandType: 'send_question',
          type: 'send_ok',
        }),
      },
      {
        name: 'question_ok без messageId',
        raw: outboundResultWire({
          commandType: 'send_question',
          type: 'question_ok',
        }),
      },
      {
        name: 'question_ok с чужим commandType',
        raw: outboundResultWire({
          commandType: 'send_message',
          messageId: 'm1',
          type: 'question_ok',
        }),
      },
      {
        name: 'error без commandType',
        raw: outboundResultWire({
          code: 'send_failed',
          message: 'x',
          type: 'error',
        }),
      },
      {
        name: 'error без message',
        raw: outboundResultWire({
          code: 'send_failed',
          commandType: 'send_message',
          type: 'error',
        }),
      },
      {
        name: 'error с пустым message',
        raw: outboundResultWire({
          code: 'send_failed',
          commandType: 'send_message',
          message: '',
          type: 'error',
        }),
      },
      {
        name: 'error message не строка',
        raw: outboundResultWire({
          code: 'send_failed',
          commandType: 'send_message',
          message: 1,
          type: 'error',
        }),
      },
      {
        name: 'error невалидный commandType',
        raw: outboundResultWire({
          code: 'send_failed',
          commandType: 'nope',
          message: 'x',
          type: 'error',
        }),
      },
      {
        name: 'command+result вместе',
        raw: outboundResultWire(
          { commandType: 'send_message', type: 'send_ok' },
          {
            command: {
              place: { chatId: 'c', kind: 'direct' },
              text: 'x',
              type: 'send_message',
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
