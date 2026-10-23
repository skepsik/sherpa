import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { InboundMessage, InboundQuestionAnswer } from '../src/types';

import { encodeInbound, tryDecodeInbound } from '../src/inbound';
import { isDirectPlace, isTopicPlace } from '../src/place';

function inboundWire(event: unknown, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    direction: 'inbound',
    event,
    eventId: 'upd-1',
    v: 1,
    ...overrides,
  });
}

void describe('inbound encode/decode', () => {
  void it('roundtrip message в личке с eventId', () => {
    const event: InboundMessage = {
      place: { chatId: 'chat-1', kind: 'direct' },
      text: 'привет',
      type: 'message',
    };
    const decoded = tryDecodeInbound(encodeInbound('42', event));
    assert.deepEqual(decoded, { event, eventId: '42' });
    assert.ok(decoded && isDirectPlace(decoded.event.place));
  });

  void it('roundtrip question_answer в топике', () => {
    const event: InboundQuestionAnswer = {
      data: 'allow',
      place: { chatId: 'chat-2', kind: 'topic', topicId: 'topic-9' },
      requestId: 'perm-42',
      type: 'question_answer',
    };
    const decoded = tryDecodeInbound(encodeInbound('99', event));
    assert.deepEqual(decoded, { event, eventId: '99' });
    assert.ok(decoded && isTopicPlace(decoded.event.place));
  });

  void it('отказ на невалидный wire', () => {
    const cases: { name: string; raw: string }[] = [
      { name: 'битый json', raw: '{' },
      {
        name: 'direction outbound',
        raw: JSON.stringify({
          direction: 'outbound',
          event: {},
          eventId: '1',
          v: 1,
        }),
      },
      {
        name: 'нет eventId',
        raw: inboundWire(
          { place: { chatId: 'c', kind: 'direct' }, type: 'message' },
          { eventId: undefined },
        ),
      },
      {
        name: 'пустой eventId',
        raw: inboundWire(
          { place: { chatId: 'c', kind: 'direct' }, type: 'message' },
          { eventId: '' },
        ),
      },
      {
        name: 'question_answer без requestId',
        raw: inboundWire({
          data: 'allow',
          place: { chatId: 'c', kind: 'direct' },
          type: 'question_answer',
        }),
      },
      {
        name: 'пустой chatId',
        raw: inboundWire({
          place: { chatId: '', kind: 'direct' },
          type: 'message',
        }),
      },
      {
        name: 'topic без topicId',
        raw: inboundWire({
          place: { chatId: 'c', kind: 'topic' },
          type: 'message',
        }),
      },
      {
        name: 'пустой topicId',
        raw: inboundWire({
          place: { chatId: 'c', kind: 'topic', topicId: '' },
          type: 'message',
        }),
      },
      {
        name: 'версия 2',
        raw: inboundWire(
          { place: { chatId: 'c', kind: 'direct' }, type: 'message' },
          { v: 2 },
        ),
      },
      {
        name: 'пустой data',
        raw: inboundWire({
          data: '',
          place: { chatId: 'c', kind: 'direct' },
          requestId: 'r1',
          type: 'question_answer',
        }),
      },
      {
        name: 'пустой requestId',
        raw: inboundWire({
          data: 'allow',
          place: { chatId: 'c', kind: 'direct' },
          requestId: '',
          type: 'question_answer',
        }),
      },
      {
        name: 'text не строка',
        raw: inboundWire({
          place: { chatId: 'c', kind: 'direct' },
          text: 1,
          type: 'message',
        }),
      },
      {
        name: 'message без text',
        raw: inboundWire({
          place: { chatId: 'c', kind: 'direct' },
          type: 'message',
        }),
      },
      {
        name: 'message с пустым text',
        raw: inboundWire({
          place: { chatId: 'c', kind: 'direct' },
          text: '',
          type: 'message',
        }),
      },
      {
        name: 'старый type user_message',
        raw: inboundWire({
          place: { chatId: 'c', kind: 'direct' },
          text: 'hi',
          type: 'user_message',
        }),
      },
      {
        name: 'старый type callback',
        raw: inboundWire({
          data: 'allow',
          place: { chatId: 'c', kind: 'direct' },
          requestId: 'r1',
          type: 'callback',
        }),
      },
    ];
    for (const { name, raw } of cases) {
      assert.equal(tryDecodeInbound(raw), null, name);
    }
  });
});
