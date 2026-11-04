import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  ConformanceCaseSpec,
  ConformanceGrantSeed,
  ConformancePreparedCase,
} from '../types/conformance';

import { normalizeWorkdirPath } from '../registry';
import { listExpectedVerdicts } from './suite';

/**
 * Чистый cwd фикстуры: temp root + layout + абсолютные пути прав.
 * `registryPath` — файл под корнем (для константного запрета).
 */
export function prepareConformanceCase(spec: ConformanceCaseSpec): {
  prepared: ConformancePreparedCase;
  root: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'sherpa-conf-'));
  for (const rel of spec.layout.dirs ?? []) {
    mkdirSync(join(root, rel), { recursive: true });
  }
  for (const [rel, body] of Object.entries(spec.layout.files ?? {})) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  }

  const cwd = normalizeWorkdirPath(join(root, spec.cwd));
  const registryFile = join(root, 'registry.sqlite');
  writeFileSync(registryFile, '');
  const registryPath = normalizeWorkdirPath(registryFile);

  const grants: ConformanceGrantSeed[] | undefined =
    spec.grants === undefined
      ? undefined
      : spec.grants.map((grant) => ({
          level: grant.level,
          path: normalizeWorkdirPath(join(root, grant.path)),
        }));

  const prepared: ConformancePreparedCase = {
    action: spec.action,
    expect: listExpectedVerdicts(spec.expect),
    id: spec.id,
    onAsk: spec.onAsk,
    path: normalizeWorkdirPath(join(root, spec.target)),
    rights: {
      cwd,
      deny: spec.deny,
      denyGlobal: spec.denyGlobal,
      grants,
      registryPath,
    },
    title: spec.title,
  };

  return { prepared, root };
}
