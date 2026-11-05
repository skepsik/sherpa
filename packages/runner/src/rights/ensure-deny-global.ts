import { homedir } from 'node:os';

import type { EnsureDenyGlobalDeps } from '../types/rights';

/** Отказ ensure набора MVP в `deny_global` — старт сессии неуспешен. */
export class EnsureDenyGlobalError extends Error {
  readonly code = 'ensure_deny_global_failed' as const;

  constructor(detail: string, cause?: unknown) {
    super(
      `ensure deny_global: ${detail}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = 'EnsureDenyGlobalError';
  }
}

/**
 * Идемпотентно дописывает недостающие шаблоны MVP в `deny_global`.
 * Чужие строки не трогает. Отказ load/insert — EnsureDenyGlobalError.
 */
export function ensureDenyGlobalMvp(deps: EnsureDenyGlobalDeps) {
  let existing: Set<string>;
  try {
    existing = new Set(deps.loadExistingPatterns());
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new EnsureDenyGlobalError(detail, error);
  }
  for (const pattern of listMvpDenyGlobalPatterns()) {
    if (existing.has(pattern)) continue;
    try {
      deps.insertDenyGlobal({ pattern });
      existing.add(pattern);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        existing.add(pattern);
        continue;
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new EnsureDenyGlobalError(detail, error);
    }
  }
}

/**
 * Шаблоны MVP для `deny_global` (эпик 6).
 * `<HOME>` — `homedir` процесса на момент вызова, без хвостового `/`.
 */
export function listMvpDenyGlobalPatterns(home = homedir()) {
  const root = home.replace(/\/+$/, '');
  return [
    'write:.onto/**',
    'write:AGENTS.md',
    'write:CLAUDE.md',
    'write:.claude/**',
    'read:**/.env*',
    'read:!**/.env.example',
    `read://${root}/.ssh/**`,
    `read://${root}/.aws/**`,
    `read://${root}/.gnupg/**`,
  ] as const;
}

function isUniqueConstraintError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /UNIQUE constraint failed/i.test(error.message);
}
