import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';

import { createOpenCodeConformanceDriver } from '../src/adapters/opencode';
import {
  listMvpConformanceCases,
  prepareConformanceCase,
  runConformanceSuite,
} from '../src/conformance';

void describe('conformance suite (OpenCode fake driver)', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  void it('MVP-набор зелёный', async () => {
    const driver = createOpenCodeConformanceDriver();
    const prepared = listMvpConformanceCases().map((spec) => {
      const handle = prepareConformanceCase(spec);
      temps.push(handle.root);
      return handle.prepared;
    });

    const result = await runConformanceSuite(driver, prepared);
    assert.equal(
      result.failed.length,
      0,
      result.failed
        .map(
          (row) =>
            `${row.id}: expected ${row.expected.join('|')}, got ${row.actual}`,
        )
        .join('\n'),
    );
    assert.equal(result.passed, result.total);
    assert.ok(result.total >= 12);
  });
});
