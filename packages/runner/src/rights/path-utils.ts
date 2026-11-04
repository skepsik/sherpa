import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, normalize, resolve } from 'node:path';

import type { GrantLevel } from '../types/registry';

const LEVEL_RANK: Record<GrantLevel, number> = {
  append: 2,
  none: 0,
  ro: 1,
  rw: 3,
};

export function isGrantLevelAboveNone(
  level: GrantLevel,
): level is Exclude<GrantLevel, 'none'> {
  return level !== 'none';
}

export function isPathEqualOrUnder(path: string, root: string) {
  return path === root || path.startsWith(`${root}/`);
}

export function minGrantLevel(a: GrantLevel, b: GrantLevel): GrantLevel {
  return LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b;
}

/** Абсолютный путь без хвостового `/`; `.` / `..` схлопываются лексически. */
export function normalizeLexicalPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('path: пустой путь');
  }
  const absolute = isAbsolute(trimmed) ? trimmed : resolve(trimmed);
  let out = normalize(absolute);
  if (out.length > 1 && out.endsWith('/')) {
    out = out.replace(/\/+$/, '');
  }
  return out;
}

/**
 * Фактическая цель как open(2): обход сегментов с follow symlink;
 * `..` применяется к уже разрешённому префиксу.
 * Несуществующий хвост — после последнего существующего предка.
 */
export function resolveRealPathWalk(targetPath: string): string {
  const trimmed = targetPath.trim();
  if (!trimmed) {
    throw new Error('path: пустой путь');
  }
  const absolute = isAbsolute(trimmed) ? trimmed : resolve(trimmed);
  const segments = absolute.split('/').filter((segment) => segment.length > 0);

  let current = '/';
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === '.') {
      continue;
    }
    if (segment === '..') {
      current = current === '/' ? '/' : dirname(current);
      continue;
    }

    const next = current === '/' ? `/${segment}` : `${current}/${segment}`;
    if (!existsSync(next)) {
      return stripTrailingSlash(
        joinLexicalRest(current, segments.slice(index)),
      );
    }

    try {
      const stat = lstatSync(next);
      current = stat.isSymbolicLink()
        ? stripTrailingSlash(realpathSync(next))
        : next;
    } catch {
      current = next;
    }
  }

  return stripTrailingSlash(current);
}

/**
 * Запрошенный путь (лексический, без follow) и реальный (walk как open(2):
 * follow symlink по сегментам, `..` — после follow).
 */
export function resolveTargetPaths(targetPath: string): {
  real: string;
  requested: string;
} {
  const requested = normalizeLexicalPath(targetPath);
  return { real: resolveRealPathWalk(targetPath), requested };
}

/** Хвост без follow: `.` / `..` относительно уже разрешённого префикса. */
function joinLexicalRest(base: string, segments: readonly string[]): string {
  let current = base;
  for (const segment of segments) {
    if (segment === '.' || segment === '') {
      continue;
    }
    if (segment === '..') {
      current = current === '/' ? '/' : dirname(current);
      continue;
    }
    current = current === '/' ? `/${segment}` : `${current}/${segment}`;
  }
  return current;
}

function stripTrailingSlash(path: string) {
  if (path.length > 1 && path.endsWith('/')) {
    return path.replace(/\/+$/, '');
  }
  return path;
}
