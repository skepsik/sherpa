import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { InboundCallback, InboundUserMessage } from './inbound';

import { encodeInbound, tryDecodeInbound } from './inbound';
import { isDirectPlace, isTopicPlace } from './place';

function inboundWire(event: unknown, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ direction: 'inbound', event, v: 1, ...overrides });
}

void describe('inbound encode/decode', () => {
  void it('roundtrip user_message в личке', () => {
    const event: InboundUserMessage = {
      place: { chatId: 'chat-1', kind: 'direct' },
      text: 'привет',
      type: 'user_message',
    };
    const decoded = tryDecodeInbound(encodeInbound(event));
    assert.deepEqual(decoded, event);
    assert.ok(decoded && isDirectPlace(decoded.place));
  });

  void it('roundtrip callback в топике', () => {
    const event: InboundCallback = {
      data: 'allow',
      place: { chatId: 'chat-2', kind: 'topic', topicId: 'topic-9' },
      requestId: 'perm-42',
      type: 'callback',
    };
    const decoded = tryDecodeInbound(encodeInbound(event));
    assert.deepEqual(decoded, event);
    assert.ok(decoded && isTopicPlace(decoded.place));
  });

  void it('отказ на невалидный wire', () => {
    assert.equal(tryDecodeInbound('{'), null);
    assert.equal(
      tryDecodeInbound(
        JSON.stringify({ direction: 'outbound', event: {}, v: 1 }),
      ),
      null,
    );
    assert.equal(
      tryDecodeInbound(
        inboundWire({
          data: 'allow',
          place: { chatId: 'c', kind: 'direct' },
          type: 'callback',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeInbound(
        inboundWire({
          place: { chatId: '', kind: 'direct' },
          type: 'user_message',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeInbound(
        inboundWire({
          place: { chatId: 'c', kind: 'topic' },
          type: 'user_message',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeInbound(
        inboundWire({
          place: { chatId: 'c', kind: 'topic', topicId: '' },
          type: 'user_message',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeInbound(
        inboundWire(
          {
            place: { chatId: 'c', kind: 'direct' },
            type: 'user_message',
          },
          { v: 2 },
        ),
      ),
      null,
    );
    assert.equal(
      tryDecodeInbound(
        inboundWire({
          data: '',
          place: { chatId: 'c', kind: 'direct' },
          requestId: 'r1',
          type: 'callback',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeInbound(
        inboundWire({
          data: 'allow',
          place: { chatId: 'c', kind: 'direct' },
          requestId: '',
          type: 'callback',
        }),
      ),
      null,
    );
    assert.equal(
      tryDecodeInbound(
        inboundWire({
          place: { chatId: 'c', kind: 'direct' },
          text: 1,
          type: 'user_message',
        }),
      ),
      null,
    );
  });
});
