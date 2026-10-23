import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCommandDedup } from './command-dedup';

void describe('createCommandDedup', () => {
  void it('разные id исполняются параллельно', async () => {
    const dedup = createCommandDedup();
    const order: number[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const a = dedup.run('a', async () => {
      await firstGate;
      order.push(1);
      return 1;
    });
    const b = dedup.run('b', async () => {
      order.push(2);
      return 2;
    });

    await delay(10);
    assert.deepEqual(order, [2]);
    releaseFirst();
    assert.deepEqual(await Promise.all([a, b]), [1, 2]);
    assert.deepEqual(order, [2, 1]);
  });

  void it('повтор id в полёте и после — один run', async () => {
    const dedup = createCommandDedup(5_000);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = dedup.run('x', async () => {
      calls += 1;
      await gate;
      return 'ok';
    });
    const second = dedup.run('x', async () => {
      calls += 1;
      return 'other';
    });

    await delay(10);
    assert.equal(calls, 1);
    release();
    assert.deepEqual(await Promise.all([first, second]), ['ok', 'ok']);
    assert.equal(calls, 1);

    assert.equal(await dedup.run('x', async () => 'new'), 'ok');
    assert.equal(calls, 1);
  });

  void it('после TTL просроченный id вытесняется и run вызывается снова', async () => {
    const dedup = createCommandDedup(20);
    let calls = 0;
    assert.equal(
      await dedup.run('ttl', async () => {
        calls += 1;
        return 'first';
      }),
      'first',
    );
    await delay(40);
    assert.equal(
      await dedup.run('ttl', async () => {
        calls += 1;
        return 'second';
      }),
      'second',
    );
    assert.equal(calls, 2);
  });
});

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
