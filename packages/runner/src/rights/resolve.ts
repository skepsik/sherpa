import type { GrantLevel, WorkdirRights } from '../types/registry';
import type {
  LaunchRights,
  PathAccess,
  ResolveRightsOptions,
} from '../types/rights';

import {
  computeDenyEffects,
  isInsideWhollyClosedDirectory,
  listAllowedRoots,
  listMergedDenyPatterns,
  listOrdinaryDenyLines,
} from './deny-match';
import {
  isGrantLevelAboveNone,
  isPathEqualOrUnder,
  minGrantLevel,
  resolveTargetPaths,
} from './path-utils';
import { isRegistryBannedPath, listRegistryDenyPaths } from './registry-ban';

export class RightsConfigError extends Error {
  readonly code = 'rights_config_invalid' as const;

  constructor(detail: string) {
    super(`rights config: ${detail}`);
    this.name = 'RightsConfigError';
  }
}

/**
 * Плоский снимок запуска. Grant внутри каталога, закрытого обычным
 * запретом целиком — RightsConfigError. `!` no-op — не отказ.
 */
export function buildLaunchRights(
  snapshot: WorkdirRights,
  options: ResolveRightsOptions,
): LaunchRights {
  validateGrantNotInsideDeniedTree(snapshot);
  validateGrantNotInsideNonePath(snapshot);

  const foreignRoots = snapshot.grants
    .filter((grant) => isGrantLevelAboveNone(grant.level))
    .map((grant) => ({ level: grant.level, path: grant.path }));

  const foreignClosures = listForeignClosures(
    snapshot.cwd,
    foreignRoots,
    snapshot,
  );

  return {
    cwd: snapshot.cwd,
    denyPatterns: listMergedDenyPatterns(snapshot),
    foreignClosures,
    foreignRoots,
    ownRoot: { level: 'rw', path: snapshot.cwd },
    registryDenyPaths: listRegistryDenyPaths(options.registryPath),
    shellEnabled: false,
  };
}

/**
 * Вердикт уровня доступа к пути по снимку прав.
 * Симлинк: deny — если совпал requested или real; grant — только оба.
 */
export function resolvePathAccess(
  cwd: string,
  targetPath: string,
  snapshot: WorkdirRights,
  options: ResolveRightsOptions,
): PathAccess {
  if (snapshot.cwd !== cwd) {
    throw new Error(
      `resolvePathAccess: cwd «${cwd}» не совпадает со snapshot.cwd «${snapshot.cwd}»`,
    );
  }

  const { real, requested } = resolveTargetPaths(targetPath);
  const registryDenyPaths = listRegistryDenyPaths(options.registryPath);

  if (
    isRegistryBannedPath(requested, registryDenyPaths) ||
    isRegistryBannedPath(real, registryDenyPaths)
  ) {
    return { level: 'none' };
  }

  const deny = computeDenyEffects(
    requested === real ? [requested] : [requested, real],
    snapshot,
  );
  if (deny.readDenied) {
    return { level: 'none' };
  }

  let level = resolveGrantLevelBoth(requested, real, snapshot);
  if (deny.writeDenied) {
    level = minGrantLevel(level, 'ro');
  }
  return { level };
}

/**
 * Вложенный none под чужим корнем выше none.
 * Grant на путь под своим cwd и одиночный none — не в снимок.
 */
function listForeignClosures(
  cwd: string,
  foreignRoots: readonly { path: string }[],
  snapshot: WorkdirRights,
): string[] {
  const out: string[] = [];
  for (const grant of snapshot.grants) {
    if (grant.level !== 'none') {
      continue;
    }
    if (isPathEqualOrUnder(grant.path, cwd)) {
      continue;
    }
    const underForeign = foreignRoots.some(
      (root) =>
        grant.path !== root.path && isPathEqualOrUnder(grant.path, root.path),
    );
    if (!underForeign) {
      continue;
    }
    out.push(grant.path);
  }
  return out;
}

function resolveGrantLevelBoth(
  requested: string,
  real: string,
  snapshot: WorkdirRights,
): GrantLevel {
  const a = resolveGrantLevelForPath(requested, snapshot);
  if (requested === real) {
    return a;
  }
  const b = resolveGrantLevelForPath(real, snapshot);
  return minGrantLevel(a, b);
}

function resolveGrantLevelForPath(
  path: string,
  snapshot: WorkdirRights,
): GrantLevel {
  if (isPathEqualOrUnder(path, snapshot.cwd)) {
    return 'rw';
  }

  let best: GrantLevel | null = null;
  let bestLen = -1;
  for (const grant of snapshot.grants) {
    if (!isPathEqualOrUnder(path, grant.path)) {
      continue;
    }
    if (grant.path.length > bestLen) {
      best = grant.level;
      bestLen = grant.path.length;
    }
  }
  return best ?? 'none';
}

function validateGrantNotInsideDeniedTree(snapshot: WorkdirRights) {
  const ordinaryRead = listOrdinaryDenyLines(snapshot, 'read');
  if (ordinaryRead.length === 0) {
    return;
  }
  const roots = listAllowedRoots(snapshot);

  for (const grant of snapshot.grants) {
    if (!isGrantLevelAboveNone(grant.level)) {
      continue;
    }
    if (isInsideWhollyClosedDirectory(grant.path, ordinaryRead, roots)) {
      throw new RightsConfigError(
        `grant «${grant.path}» внутри каталога, закрытого обычным deny`,
      );
    }
  }
}

/** Grant выше none внутри пути с grant none — конфигурация невыразима. */
function validateGrantNotInsideNonePath(snapshot: WorkdirRights) {
  const nonePaths = snapshot.grants
    .filter((grant) => grant.level === 'none')
    .map((grant) => grant.path);

  for (const grant of snapshot.grants) {
    if (!isGrantLevelAboveNone(grant.level)) {
      continue;
    }
    for (const nonePath of nonePaths) {
      if (grant.path !== nonePath && isPathEqualOrUnder(grant.path, nonePath)) {
        throw new RightsConfigError(
          `grant «${grant.path}» внутри пути, закрытого grant none «${nonePath}»`,
        );
      }
    }
  }
}
