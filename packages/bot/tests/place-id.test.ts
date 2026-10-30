import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  encodePlaceId,
  findTelegramPlace,
  PLACE_ID_CODEC,
} from '../src/place-id';

void describe('place-id codec', () => {
  void it('литерал: личка → фиксированная строка', () => {
    assert.equal(encodePlaceId({ chatId: '100', kind: 'direct' }), 'tg1:d:100');
  });

  void it('литерал: топик → фиксированная строка', () => {
    assert.equal(
      encodePlaceId({ chatId: '-200', kind: 'topic', topicId: '99' }),
      'tg1:t:-200:99',
    );
  });

  void it('разные Telegram-места → разные id; повтор → тот же', () => {
    const direct = { chatId: '100', kind: 'direct' as const };
    const topic = { chatId: '-200', kind: 'topic' as const, topicId: '99' };
    const idDirect = encodePlaceId(direct);
    const idTopic = encodePlaceId(topic);
    assert.notEqual(idDirect, idTopic);
    assert.equal(encodePlaceId(direct), idDirect);
    assert.equal(encodePlaceId(topic), idTopic);
  });

  void it('roundtrip encode → find; id без whitespace', () => {
    const places = [
      { chatId: '42', kind: 'direct' as const },
      { chatId: '-100123', kind: 'topic' as const, topicId: '7' },
    ];
    for (const place of places) {
      const id = encodePlaceId(place);
      assert.equal(/\s/.test(id), false);
      assert.deepEqual(findTelegramPlace(id), place);
    }
  });

  void it('чужой / битый id → null', () => {
    assert.equal(findTelegramPlace(''), null);
    assert.equal(findTelegramPlace('tg2:d:1'), null);
    assert.equal(findTelegramPlace('tg1:x:1'), null);
    assert.equal(findTelegramPlace('tg1:d:'), null);
    assert.equal(findTelegramPlace('tg1:d:1:extra'), null);
    assert.equal(findTelegramPlace('tg1:t:-200'), null);
    assert.equal(findTelegramPlace('tg1:t:-200:'), null);
    assert.equal(PLACE_ID_CODEC, 'tg1');
  });

  void it('сегмент chatId/topicId с whitespace → null', () => {
    assert.equal(findTelegramPlace('tg1:d:1 2'), null);
    assert.equal(findTelegramPlace('tg1:d:1\t2'), null);
    assert.equal(findTelegramPlace('tg1:t:-200 :99'), null);
    assert.equal(findTelegramPlace('tg1:t:-200:9 9'), null);
    assert.equal(findTelegramPlace('tg1:t: -200:99'), null);
  });
});
