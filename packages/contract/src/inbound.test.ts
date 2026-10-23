import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { InboundCallback, InboundUserMessage } from './inbound';

import { encodeInbound, tryDecodeInbound } from './inbound';
import { isDirectPlace, isTopicPlace } from './place';

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
  void it('roundtrip user_message в личке с eventId', () => {
    const event: InboundUserMessage = {
      place: { chatId: 'chat-1', kind: 'direct' },
      text: 'привет',
      type: 'user_message',
    };
    const decoded = tryDecodeInbound(encodeInbound('42', event));
    assert.deepEqual(decoded, { event, eventId: '42' });
    assert.ok(decoded && isDirectPlace(decoded.event.place));
  });

  void it('roundtrip callback в топике', () => {
    const event: InboundCallback = {
      data: 'allow',
      place: { chatId: 'chat-2', kind: 'topic', topicId: 'topic-9' },
      requestId: 'perm-42',
      type: 'callback',
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
          { place: { chatId: 'c', kind: 'direct' }, type: 'user_message' },
          { eventId: undefined },
        ),
      },
      {
        name: 'пустой eventId',
        raw: inboundWire(
          { place: { chatId: 'c', kind: 'direct' }, type: 'user_message' },
          { eventId: '' },
        ),
      },
      {
        name: 'callback без requestId',
        raw: inboundWire({
          data: 'allow',
          place: { chatId: 'c', kind: 'direct' },
          type: 'callback',
        }),
      },
      {
        name: 'пустой chatId',
        raw: inboundWire({
          place: { chatId: '', kind: 'direct' },
          type: 'user_message',
        }),
      },
      {
        name: 'topic без topicId',
        raw: inboundWire({
          place: { chatId: 'c', kind: 'topic' },
          type: 'user_message',
        }),
      },
      {
        name: 'пустой topicId',
        raw: inboundWire({
          place: { chatId: 'c', kind: 'topic', topicId: '' },
          type: 'user_message',
        }),
      },
      {
        name: 'версия 2',
        raw: inboundWire(
          { place: { chatId: 'c', kind: 'direct' }, type: 'user_message' },
          { v: 2 },
        ),
      },
      {
        name: 'пустой data',
        raw: inboundWire({
          data: '',
          place: { chatId: 'c', kind: 'direct' },
          requestId: 'r1',
          type: 'callback',
        }),
      },
      {
        name: 'пустой requestId',
        raw: inboundWire({
          data: 'allow',
          place: { chatId: 'c', kind: 'direct' },
          requestId: '',
          type: 'callback',
        }),
      },
      {
        name: 'text не строка',
        raw: inboundWire({
          place: { chatId: 'c', kind: 'direct' },
          text: 1,
          type: 'user_message',
        }),
      },
    ];
    for (const { name, raw } of cases) {
      assert.equal(tryDecodeInbound(raw), null, name);
    }
  });
});
