import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  encodeInbound,
  type InboundCallback,
  type InboundUserMessage,
  tryDecodeInbound,
} from './inbound';
import { isDirectPlace, isTopicPlace } from './place';

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
        JSON.stringify({
          direction: 'inbound',
          event: {
            data: 'allow',
            place: { chatId: 'c', kind: 'direct' },
            type: 'callback',
          },
          v: 1,
        }),
      ),
      null,
    );
  });
});
