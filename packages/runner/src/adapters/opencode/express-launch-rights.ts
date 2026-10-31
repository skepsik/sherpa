import type {
  OpenCodeLaunchPermissions,
  OpenCodePermissionRule,
} from '../../types/opencode';
import type { GrantLevel } from '../../types/registry';
import type { DenyEffect, LaunchRights, ParsedDeny } from '../../types/rights';

import {
  isGitignoreMatch,
  isInsideWhollyClosedDirectory,
  parseDenyLine,
} from '../../rights/deny-match';
import { isGrantLevelAboveNone } from '../../rights/path-utils';

export class OpenCodeExpressError extends Error {
  readonly code = 'opencode_express_invalid' as const;

  constructor(detail: string) {
    super(`opencode express: ${detail}`);
    this.name = 'OpenCodeExpressError';
  }
}

/**
 * Плоский снимок 4-2 → permissions OpenCode для запуска.
 * Без живой сессии; ask UI и append_file — эпики 5 / 8.
 */
export function expressLaunchRights(
  rights: LaunchRights,
): OpenCodeLaunchPermissions {
  validateLaunchRights(rights);

  const permissions: OpenCodePermissionRule[] = [];
  const roots = listLaunchRoots(rights);

  // Дефолт OpenCode: external без правила — без prompt. Закрываем дыру.
  permissions.push({
    action: 'external_directory',
    effect: 'ask',
    resource: '*',
  });

  permissions.push({ action: 'shell', effect: 'deny', resource: '*' });

  for (const root of rights.foreignRoots) {
    permissions.push({
      action: 'external_directory',
      effect: 'allow',
      resource: `${root.path}/*`,
    });
  }

  const parsed = rights.denyPatterns.map(parseDenyLine);
  appendDenyRules(permissions, parsed, 'write', roots);
  appendDenyRules(permissions, parsed, 'read', roots);

  for (const path of rights.registryDenyPaths) {
    permissions.push({ action: 'read', effect: 'deny', resource: path });
    permissions.push({ action: 'edit', effect: 'deny', resource: path });
  }

  // Уровни ro/append — после deny/`!`, чтобы carve-out не открыл запись в ro.
  for (const root of rights.foreignRoots) {
    if (isEditClosedByLevel(root.level)) {
      permissions.push({
        action: 'edit',
        effect: 'deny',
        resource: `${root.path}/*`,
      });
      permissions.push({
        action: 'edit',
        effect: 'deny',
        resource: root.path,
      });
    }
  }

  return { permissions };
}

function actionsForDenyEffect(effect: DenyEffect): string[] {
  return effect === 'read' ? ['read', 'edit'] : ['edit'];
}

function appendDenyRules(
  permissions: OpenCodePermissionRule[],
  parsed: readonly ParsedDeny[],
  effect: DenyEffect,
  roots: readonly string[],
) {
  const ordinary = parsed.filter(
    (row) => row.effect === effect && !row.isException,
  );
  const exceptions = parsed.filter(
    (row) => row.effect === effect && row.isException,
  );
  const writeOrdinary = parsed.filter(
    (row) => row.effect === 'write' && !row.isException,
  );
  const writeExceptions = parsed.filter(
    (row) => row.effect === 'write' && row.isException,
  );

  for (const row of ordinary) {
    for (const resource of listOpenCodeResources(row.gitignore)) {
      for (const action of actionsForDenyEffect(effect)) {
        permissions.push({ action, effect: 'deny', resource });
      }
    }
  }

  // `!` в OpenCode нет: last-match allow на конкретный resource (не allow-all).
  for (const row of exceptions) {
    if (isExceptionNoOp(row.gitignore, ordinary, roots)) {
      continue;
    }
    const actions = listExceptionAllowActions(
      effect,
      row.gitignore,
      writeOrdinary,
      writeExceptions,
      roots,
    );
    for (const resource of listOpenCodeResources(row.gitignore)) {
      for (const action of actions) {
        permissions.push({ action, effect: 'allow', resource });
      }
    }
  }
}

function concretizeGlobSegments(pattern: string) {
  return pattern.replace(/\*\*/g, 'x').replace(/\*/g, 'x').replace(/\?/g, 'x');
}

function expandPathResources(pattern: string): string[] {
  const out = new Set<string>([pattern]);
  if (pattern.endsWith('/**')) {
    const base = pattern.slice(0, -3);
    out.add(`${base}/*`);
    out.add(base);
  } else if (pattern.endsWith('/*')) {
    out.add(pattern.slice(0, -2));
  }
  return [...out];
}

function isEditClosedByLevel(level: GrantLevel) {
  return level === 'ro' || level === 'append';
}

/**
 * `!` no-op, если все probe-пути исключения лежат внутри каталога,
 * закрытого ordinary того же эффекта целиком.
 */
function isExceptionNoOp(
  exceptionGitignore: string,
  ordinary: readonly ParsedDeny[],
  roots: readonly string[],
) {
  const probes = listExceptionProbePaths(exceptionGitignore, roots);
  let matched = false;
  for (const probe of probes) {
    if (!isGitignoreMatch(exceptionGitignore, probe, roots)) {
      continue;
    }
    matched = true;
    if (!isInsideWhollyClosedDirectory(probe, ordinary, roots)) {
      return false;
    }
  }
  return matched;
}

/**
 * Эффективный write-deny на probe (как isEffectDenied): ordinary матч,
 * затем write:! снимает, если не no-op внутри wholly-closed.
 */
function isWriteDeniedOnException(
  exceptionGitignore: string,
  writeOrdinary: readonly ParsedDeny[],
  writeExceptions: readonly ParsedDeny[],
  roots: readonly string[],
) {
  for (const probe of listExceptionProbePaths(exceptionGitignore, roots)) {
    if (!isGitignoreMatch(exceptionGitignore, probe, roots)) {
      continue;
    }
    if (isWriteEffectDenied(probe, writeOrdinary, writeExceptions, roots)) {
      return true;
    }
  }
  return false;
}

function isWriteEffectDenied(
  absPath: string,
  writeOrdinary: readonly ParsedDeny[],
  writeExceptions: readonly ParsedDeny[],
  roots: readonly string[],
) {
  const matchedOrdinary = writeOrdinary.filter((row) =>
    isGitignoreMatch(row.gitignore, absPath, roots),
  );
  if (matchedOrdinary.length === 0) {
    return false;
  }
  const exceptionHits = writeExceptions.some((row) =>
    isGitignoreMatch(row.gitignore, absPath, roots),
  );
  if (
    exceptionHits &&
    !isInsideWhollyClosedDirectory(absPath, writeOrdinary, roots)
  ) {
    return false;
  }
  return true;
}

/**
 * write:! → edit; read:! → read, и edit только если нет эффективного write-deny
 * (! снимает только свой префикс; write:! учитывается).
 */
function listExceptionAllowActions(
  effect: DenyEffect,
  exceptionGitignore: string,
  writeOrdinary: readonly ParsedDeny[],
  writeExceptions: readonly ParsedDeny[],
  roots: readonly string[],
): string[] {
  if (effect === 'write') {
    return ['edit'];
  }
  if (
    isWriteDeniedOnException(
      exceptionGitignore,
      writeOrdinary,
      writeExceptions,
      roots,
    )
  ) {
    return ['read'];
  }
  return ['read', 'edit'];
}

function listExceptionProbePaths(
  gitignoreBody: string,
  roots: readonly string[],
): string[] {
  if (gitignoreBody.startsWith('//')) {
    let abs = gitignoreBody.slice(2);
    if (!abs.startsWith('/')) {
      abs = `/${abs}`;
    }
    return [concretizeGlobSegments(abs)];
  }

  const relative = gitignoreBody.replace(/^\*\*\//, '').replace(/^\*\//, '');
  const concrete = concretizeGlobSegments(relative);
  return roots.map((root) => `${root}/${concrete}`);
}

function listLaunchRoots(rights: LaunchRights): string[] {
  const roots = [rights.cwd];
  for (const root of rights.foreignRoots) {
    if (!roots.includes(root.path)) {
      roots.push(root.path);
    }
  }
  return roots;
}

/**
 * gitignore-тело → resource OpenCode (`*` уже кроет `/`).
 * Относительные — с префиксом «звезда/», чтобы матчить под каждым корнем.
 */
function listOpenCodeResources(gitignoreBody: string): string[] {
  if (gitignoreBody.startsWith('//')) {
    let abs = gitignoreBody.slice(2);
    if (!abs.startsWith('/')) {
      abs = `/${abs}`;
    }
    return expandPathResources(abs);
  }

  const normalized = gitignoreBody.replace(/\*\*/g, '*');
  const withPrefix = normalized.startsWith('*')
    ? normalized
    : `*/${normalized}`;
  return expandPathResources(withPrefix);
}

function validateLaunchRights(rights: LaunchRights) {
  if (rights.shellEnabled !== false) {
    throw new OpenCodeExpressError('shellEnabled должен быть false');
  }
  if (rights.ownRoot.path !== rights.cwd) {
    throw new OpenCodeExpressError(
      `ownRoot.path «${rights.ownRoot.path}» ≠ cwd «${rights.cwd}»`,
    );
  }
  if (rights.ownRoot.level !== 'rw') {
    throw new OpenCodeExpressError(
      `ownRoot.level «${rights.ownRoot.level}» — ожидается rw`,
    );
  }
  for (const root of rights.foreignRoots) {
    if (!isGrantLevelAboveNone(root.level)) {
      throw new OpenCodeExpressError(
        `foreignRoot «${root.path}» с level none — в снимок не входит`,
      );
    }
    if (!root.path || root.path.endsWith('/')) {
      throw new OpenCodeExpressError(
        `foreignRoot.path «${root.path}» — пуст или с хвостовым /`,
      );
    }
  }
  if (!rights.cwd || rights.cwd.endsWith('/')) {
    throw new OpenCodeExpressError(
      `cwd «${rights.cwd}» — пуст или с хвостовым /`,
    );
  }
}
