import type {
  ConformanceAskReply,
  ConformanceCaseResult,
  ConformanceCaseSpec,
  ConformanceDriver,
  ConformancePreparedCase,
  ConformanceSuiteResult,
  ConformanceVerdict,
} from '../types/conformance';

export function listExpectedVerdicts(
  expect: ConformanceVerdict | readonly ConformanceVerdict[],
): ConformanceVerdict[] {
  return typeof expect === 'string' ? [expect] : [...expect];
}

/**
 * Обязательный MVP-набор (issue-5-5). Формулировки — вердикты, не OC-флаги.
 */
export function listMvpConformanceCases(): ConformanceCaseSpec[] {
  return [
    {
      action: 'read',
      cwd: 'project',
      expect: 'allow',
      id: 'mvp-own-cwd-read',
      layout: {
        dirs: ['project'],
        files: { 'project/note.txt': 'hello' },
      },
      target: 'project/note.txt',
      title: 'файл внутри своего cwd — allow read',
    },
    {
      action: 'read',
      cwd: 'project',
      expect: ['ask', 'deny'],
      id: 'mvp-parent-no-grant',
      layout: {
        dirs: ['project'],
        files: { 'parent-secret.txt': 'nope' },
      },
      target: 'parent-secret.txt',
      title: 'родитель без grant — deny или ask (не silent allow)',
    },
    {
      action: 'read',
      cwd: 'project',
      expect: ['ask', 'deny'],
      id: 'mvp-sibling-no-grant',
      layout: {
        dirs: ['project', 'sibling'],
        files: { 'sibling/x.txt': 'nope' },
      },
      target: 'sibling/x.txt',
      title: 'сосед без grant — deny или ask (не silent allow)',
    },
    {
      action: 'write',
      cwd: 'project',
      expect: 'deny',
      grants: [{ level: 'ro', path: 'other' }],
      id: 'mvp-ro-write-block',
      layout: {
        dirs: ['project', 'other'],
        files: { 'other/a.txt': 'ro' },
      },
      target: 'other/a.txt',
      title: 'запись в узел с ro — блок',
    },
    {
      action: 'write',
      cwd: 'project',
      deny: ['write:locked.txt'],
      expect: 'deny',
      id: 'mvp-write-deny-block',
      layout: {
        dirs: ['project'],
        files: { 'project/locked.txt': 'x' },
      },
      target: 'project/locked.txt',
      title: 'запись при write-deny — блок',
    },
    {
      action: 'read',
      cwd: 'project',
      denyGlobal: ['read:**/.env*'],
      expect: 'deny',
      id: 'mvp-env-read-block',
      layout: {
        dirs: ['project'],
        files: { 'project/.env': 'SECRET=1' },
      },
      target: 'project/.env',
      title: 'read:**/.env* внутри разрешённого — блок чтения',
    },
    {
      action: 'read',
      cwd: 'project',
      denyGlobal: ['read:**/.env*'],
      expect: 'deny',
      grants: [{ level: 'rw', path: 'granted' }],
      id: 'mvp-global-deny-on-grant-root',
      layout: {
        dirs: ['project', 'granted'],
        files: { 'granted/.env.local': 'SECRET=2' },
      },
      target: 'granted/.env.local',
      title: 'относительный global deny на grant-корень вне cwd',
    },
    {
      action: 'read',
      cwd: 'project',
      expect: 'ask',
      id: 'mvp-ask-outside',
      layout: {
        dirs: ['project', 'outside'],
        files: { 'outside/f.txt': 'x' },
      },
      target: 'outside/f.txt',
      title: 'запрос вне правил → ask',
    },
    {
      action: 'read',
      cwd: 'project',
      expect: 'allow',
      id: 'mvp-ask-then-allow',
      layout: {
        dirs: ['project', 'outside'],
        files: { 'outside/ok.txt': 'x' },
      },
      onAsk: 'once',
      target: 'outside/ok.txt',
      title: 'ask → programmatic once доходит (allow)',
    },
    {
      action: 'read',
      cwd: 'project',
      expect: 'deny',
      id: 'mvp-ask-then-reject',
      layout: {
        dirs: ['project', 'outside'],
        files: { 'outside/no.txt': 'x' },
      },
      onAsk: 'reject',
      target: 'outside/no.txt',
      title: 'ask → programmatic reject → deny',
    },
    {
      action: 'read',
      cwd: 'project',
      denyGlobal: ['read:**/.env*'],
      expect: 'deny',
      id: 'mvp-ask-cannot-bypass-deny',
      layout: {
        dirs: ['project', 'outside'],
        files: { 'outside/.env': 'SECRET=3' },
      },
      onAsk: 'always',
      target: 'outside/.env',
      title: 'deny таблицы не обходится allow пользователя',
    },
    {
      action: 'read',
      cwd: 'project',
      expect: 'deny',
      id: 'mvp-ask-cannot-bypass-registry',
      layout: {
        dirs: ['project'],
      },
      onAsk: 'always',
      target: 'registry.sqlite',
      title: 'константный запрет registry не обходится allow пользователя',
    },
  ];
}

/**
 * Прогон подготовленных кейсов против драйвера.
 * Suite не знает диалекта харнесса.
 */
export async function runConformanceSuite(
  driver: ConformanceDriver,
  cases: readonly ConformancePreparedCase[],
): Promise<ConformanceSuiteResult> {
  const results: ConformanceCaseResult[] = [];
  for (const item of cases) {
    const askReply: ConformanceAskReply | undefined = item.onAsk;
    const actual = await driver.provoke({
      action: item.action,
      onAsk: askReply === undefined ? undefined : async () => askReply,
      path: item.path,
      rights: item.rights,
    });
    const expected = item.expect;
    const ok = expected.includes(actual);
    results.push({
      actual,
      expected,
      id: item.id,
      ok,
      title: item.title,
    });
  }
  const failed = results.filter((row) => !row.ok);
  return {
    failed,
    passed: results.length - failed.length,
    results,
    total: results.length,
  };
}
