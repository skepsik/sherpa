import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canPackPermissionButtons,
  decidePermissionAnswer,
  mapPermissionAnswerData,
  PERMISSION_CALLBACK_BUDGET_BYTES,
} from '../src/session/permission-ask';

void describe('permission-ask helpers', () => {
  void it('map: allow→once, always→always, deny→reject', () => {
    assert.deepEqual(mapPermissionAnswerData('allow'), {
      decision: 'once',
      kind: 'mapped',
    });
    assert.deepEqual(mapPermissionAnswerData('always'), {
      decision: 'always',
      kind: 'mapped',
    });
    assert.deepEqual(mapPermissionAnswerData('deny'), {
      decision: 'reject',
      kind: 'mapped',
    });
    assert.deepEqual(mapPermissionAnswerData('yes'), { kind: 'unknown' });
  });

  void it('decide: blocked / unknown → reject', () => {
    assert.equal(
      decidePermissionAnswer({
        blocked: false,
        mapping: { decision: 'once', kind: 'mapped' },
      }),
      'once',
    );
    assert.equal(
      decidePermissionAnswer({
        blocked: true,
        mapping: { decision: 'always', kind: 'mapped' },
      }),
      'reject',
    );
    assert.equal(
      decidePermissionAnswer({
        blocked: false,
        mapping: { kind: 'unknown' },
      }),
      'reject',
    );
  });

  void it('бюджет requestId+data ≤48', () => {
    assert.equal(canPackPermissionButtons('p1'), true);
    const longId = 'x'.repeat(
      PERMISSION_CALLBACK_BUDGET_BYTES - 'always'.length + 1,
    );
    assert.equal(canPackPermissionButtons(longId), false);
  });
});
