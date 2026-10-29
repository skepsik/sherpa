import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { InboundMessage, InboundQuestionAnswer } from '../src/types';

import { encodeInbound, tryDecodeInbound } from '../src/inbound';
import { WIRE_VERSION } from '../src/wire';

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
  void it('WIRE_VERSION === 1', () => {
    assert.equal(WIRE_VERSION, 1);
  });

  void it('roundtrip message со строковым place', () => {
    const event: InboundMessage = {
      place: 'tg1:d:chat-1',
      text: 'привет',
      type: 'message',
    };
    const decoded = tryDecodeInbound(encodeInbound('42', event));
    assert.deepEqual(decoded, { event, eventId: '42' });
  });

  void it('roundtrip question_answer со строковым place', () => {
    const event: InboundQuestionAnswer = {
      data: 'allow',
      place: 'tg1:t:chat-2:topic-9',
      requestId: 'perm-42',
      type: 'question_answer',
    };
    const decoded = tryDecodeInbound(encodeInbound('99', event));
    assert.deepEqual(decoded, { event, eventId: '99' });
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
          { place: 'p1', type: 'message' },
          { eventId: undefined },
        ),
      },
      {
        name: 'пустой eventId',
        raw: inboundWire({ place: 'p1', type: 'message' }, { eventId: '' }),
      },
      {
        name: 'question_answer без requestId',
        raw: inboundWire({
          data: 'allow',
          place: 'p1',
          type: 'question_answer',
        }),
      },
      {
        name: 'пустой place',
        raw: inboundWire({
          place: '',
          text: 'hi',
          type: 'message',
        }),
      },
      {
        name: 'place с пробелом',
        raw: inboundWire({
          place: 'tg1:d:1 2',
          text: 'hi',
          type: 'message',
        }),
      },
      {
        name: 'place с табом',
        raw: inboundWire({
          place: 'tg1:d:1\t2',
          text: 'hi',
          type: 'message',
        }),
      },
      {
        name: 'structural place (старая форма)',
        raw: inboundWire({
          place: { chatId: 'c', kind: 'direct' },
          text: 'hi',
          type: 'message',
        }),
      },
      {
        name: 'версия 2',
        raw: inboundWire({ place: 'p1', type: 'message' }, { v: 2 }),
      },
      {
        name: 'пустой data',
        raw: inboundWire({
          data: '',
          place: 'p1',
          requestId: 'r1',
          type: 'question_answer',
        }),
      },
      {
        name: 'пустой requestId',
        raw: inboundWire({
          data: 'allow',
          place: 'p1',
          requestId: '',
          type: 'question_answer',
        }),
      },
      {
        name: 'text не строка',
        raw: inboundWire({
          place: 'p1',
          text: 1,
          type: 'message',
        }),
      },
      {
        name: 'message без text',
        raw: inboundWire({
          place: 'p1',
          type: 'message',
        }),
      },
      {
        name: 'message с пустым text',
        raw: inboundWire({
          place: 'p1',
          text: '',
          type: 'message',
        }),
      },
      {
        name: 'старый type user_message',
        raw: inboundWire({
          place: 'p1',
          text: 'hi',
          type: 'user_message',
        }),
      },
      {
        name: 'старый type callback',
        raw: inboundWire({
          data: 'allow',
          place: 'p1',
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
