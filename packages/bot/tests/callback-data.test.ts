import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CALLBACK_DATA_MAX_BYTES,
  tryPackCallbackData,
  tryUnpackCallbackData,
} from '../src/callback-data';

void describe('callback-data pack/unpack', () => {
  void it('круг pack→unpack сохраняет пару', () => {
    const packed = tryPackCallbackData('perm-42', 'allow');
    assert.ok(packed);
    assert.deepEqual(tryUnpackCallbackData(packed), {
      data: 'allow',
      requestId: 'perm-42',
    });
  });

  void it('переполнение 64 байт → отказ pack', () => {
    const requestId = 'r'.repeat(40);
    const data = 'd'.repeat(40);
    assert.equal(tryPackCallbackData(requestId, data), null);
    const ok = tryPackCallbackData('short', 'ok');
    assert.ok(ok);
    assert.ok(Buffer.byteLength(ok, 'utf8') <= CALLBACK_DATA_MAX_BYTES);
  });

  void it('пустые поля → отказ pack', () => {
    assert.equal(tryPackCallbackData('', 'x'), null);
    assert.equal(tryPackCallbackData('x', ''), null);
  });

  void it('битый unpack → null', () => {
    assert.equal(tryUnpackCallbackData('{'), null);
    assert.equal(tryUnpackCallbackData('["only"]'), null);
    assert.equal(tryUnpackCallbackData('["", "x"]'), null);
    assert.equal(tryUnpackCallbackData('[1, "x"]'), null);
  });
});
