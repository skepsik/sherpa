import { existsSync, realpathSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  resolve,
} from 'node:path';

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
 * Запрошенный путь (без follow symlink) и реальный.
 * Несуществующий: realpath ближайшего существующего предка + хвост
 * (промежуточные symlink-каталоги не дают rw «снаружи»).
 */
export function resolveTargetPaths(targetPath: string): {
  real: string;
  requested: string;
} {
  const requested = normalizeLexicalPath(targetPath);
  if (existsSync(requested)) {
    try {
      return {
        real: normalizeLexicalPath(realpathSync(requested)),
        requested,
      };
    } catch {
      return { real: requested, requested };
    }
  }

  const missing: string[] = [];
  let current = requested;
  while (current !== '/' && current !== '') {
    missing.unshift(basename(current));
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
    if (!existsSync(current)) {
      continue;
    }
    try {
      const realParent = normalizeLexicalPath(realpathSync(current));
      const real =
        missing.length === 0
          ? realParent
          : normalizeLexicalPath(join(realParent, ...missing));
      return { real, requested };
    } catch {
      return { real: requested, requested };
    }
  }

  return { real: requested, requested };
}
