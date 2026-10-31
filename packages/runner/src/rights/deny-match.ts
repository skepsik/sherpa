import ignore from 'ignore';
import { dirname, relative } from 'node:path';

import type { WorkdirRights } from '../types/registry';
import type { DenyEffect, DenyEffects, ParsedDeny } from '../types/rights';

import { parseDenyPatternEffect } from '../registry/deny-pattern';
import { isGrantLevelAboveNone, isPathEqualOrUnder } from './path-utils';

/**
 * Эффекты deny для набора путей (OR): read → путь закрыт целиком;
 * write → запись закрыта. `!` снимает только свой префикс; внутри
 * каталога, закрытого обычным правилом целиком — no-op.
 */
export function computeDenyEffects(
  paths: readonly string[],
  rights: WorkdirRights,
): DenyEffects {
  const parsed = listMergedDenyPatterns(rights).map(parseDenyLine);
  const roots = listAllowedRoots(rights);
  let readDenied = false;
  let writeDenied = false;

  for (const path of paths) {
    if (isEffectDenied(path, 'read', parsed, roots)) {
      readDenied = true;
    }
    if (isEffectDenied(path, 'write', parsed, roots)) {
      writeDenied = true;
    }
  }

  return { readDenied, writeDenied };
}

/** Каталог закрыт целиком обычным правилом (сам или всё под ним). */
export function isDirectoryWhollyClosed(
  dirAbs: string,
  ordinaryOfEffect: readonly ParsedDeny[],
  roots: readonly string[],
) {
  for (const row of ordinaryOfEffect) {
    if (isGitignoreMatch(row.gitignore, dirAbs, roots)) {
      return true;
    }
    if (closesEntireDirectory(row.gitignore, dirAbs, roots)) {
      return true;
    }
  }
  return false;
}

/**
 * Совпадение gitignore-шаблона с абсолютным путём.
 * Относительные — на каждом root; абсолютные (`//…`) — по fs-пути.
 */
export function isGitignoreMatch(
  gitignoreBody: string,
  absPath: string,
  roots: readonly string[],
) {
  if (gitignoreBody.startsWith('//')) {
    return isAbsoluteGitignoreMatch(gitignoreBody.slice(2), absPath);
  }
  for (const root of roots) {
    if (isRelativeGitignoreMatch(gitignoreBody, absPath, root)) {
      return true;
    }
  }
  return false;
}

/**
 * Путь строго внутри каталога, который обычное правило закрывает целиком
 * (gitignore-семантика родителя).
 */
export function isInsideWhollyClosedDirectory(
  absPath: string,
  ordinaryOfEffect: readonly ParsedDeny[],
  roots: readonly string[],
) {
  for (const ancestor of listStrictAncestors(absPath)) {
    if (isDirectoryWhollyClosed(ancestor, ordinaryOfEffect, roots)) {
      return true;
    }
  }
  return false;
}

/** Корни, на которых матчятся относительные шаблоны. */
export function listAllowedRoots(rights: WorkdirRights): string[] {
  const roots = [rights.cwd];
  for (const grant of rights.grants) {
    if (isGrantLevelAboveNone(grant.level) && !roots.includes(grant.path)) {
      roots.push(grant.path);
    }
  }
  return roots;
}

export function listMergedDenyPatterns(rights: WorkdirRights): string[] {
  return [
    ...rights.denies.map((row) => row.pattern),
    ...rights.denyGlobals.map((row) => row.pattern),
  ];
}

/** Обычные (не-`!`) правила; опционально фильтр по эффекту. */
export function listOrdinaryDenyLines(
  rights: WorkdirRights,
  effect?: DenyEffect,
): ParsedDeny[] {
  return listMergedDenyPatterns(rights)
    .map(parseDenyLine)
    .filter((row) => !row.isException)
    .filter((row) => effect === undefined || row.effect === effect);
}

export function parseDenyLine(pattern: string): ParsedDeny {
  const { effect, gitignore } = parseDenyPatternEffect(pattern);
  const isException = gitignore.startsWith('!');
  const body = isException ? gitignore.slice(1) : gitignore;
  return {
    effect,
    gitignore: body,
    isException,
  };
}

/**
 * Паттерны вроде dir/** / dir/ закрывают дерево, не всегда матча
 * сам dir. Два разных probe-имени под dir — признак tree-close,
 * не file-pattern вроде star-star/.env*.
 */
function closesEntireDirectory(
  gitignoreBody: string,
  dirAbs: string,
  roots: readonly string[],
) {
  const probeA = `${dirAbs}/.__sherpa_probe_a__`;
  const probeB = `${dirAbs}/.__sherpa_probe_b__`;
  return (
    isGitignoreMatch(gitignoreBody, probeA, roots) &&
    isGitignoreMatch(gitignoreBody, probeB, roots)
  );
}

function ignoresPath(pattern: string, pathname: string) {
  const ig = ignore().add(pattern);
  if (ig.ignores(pathname)) {
    return true;
  }
  if (!pathname.endsWith('/') && ig.ignores(`${pathname}/`)) {
    return true;
  }
  return false;
}

function isAbsoluteGitignoreMatch(
  patternAfterSlashes: string,
  absPath: string,
) {
  const pattern = patternAfterSlashes.startsWith('/')
    ? patternAfterSlashes.slice(1)
    : patternAfterSlashes;
  const pathFromRoot = absPath.startsWith('/') ? absPath.slice(1) : absPath;
  return ignoresPath(pattern, pathFromRoot);
}

function isEffectDenied(
  absPath: string,
  effect: DenyEffect,
  parsed: readonly ParsedDeny[],
  roots: readonly string[],
) {
  const ordinary = parsed.filter(
    (row) => row.effect === effect && !row.isException,
  );
  const exceptions = parsed.filter(
    (row) => row.effect === effect && row.isException,
  );

  const matchedOrdinary = ordinary.filter((row) =>
    isGitignoreMatch(row.gitignore, absPath, roots),
  );
  if (matchedOrdinary.length === 0) {
    return false;
  }

  const exceptionHits = exceptions.some((row) =>
    isGitignoreMatch(row.gitignore, absPath, roots),
  );
  if (
    exceptionHits &&
    !isInsideWhollyClosedDirectory(absPath, ordinary, roots)
  ) {
    return false;
  }

  return true;
}

function isRelativeGitignoreMatch(
  pattern: string,
  absPath: string,
  root: string,
) {
  if (!isPathEqualOrUnder(absPath, root)) {
    return false;
  }
  // ignore не принимает «.»; сам корень относительным шаблоном не матчим
  if (absPath === root) {
    return false;
  }
  const rel = relative(root, absPath).split('\\').join('/');
  if (!rel || rel.startsWith('..')) {
    return false;
  }
  return ignoresPath(pattern, rel);
}

function listStrictAncestors(absPath: string): string[] {
  const out: string[] = [];
  let current = dirname(absPath);
  while (current !== '' && current !== '.') {
    out.push(current);
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return out;
}
