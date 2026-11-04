import type {
  OpenCodePermissionEffect,
  OpenCodePermissionRule,
} from '../../types/opencode';

/**
 * Last-match эффект правила OpenCode для action + resource.
 * Нет совпадения — `null` (дефолт харнесса / сессии).
 */
export function findPermissionEffect(
  rules: readonly OpenCodePermissionRule[],
  action: string,
  resource: string,
): null | OpenCodePermissionEffect {
  let effect: null | OpenCodePermissionEffect = null;
  for (const rule of rules) {
    if (rule.action !== action && rule.action !== '*') {
      continue;
    }
    if (matchesPermissionResource(rule.resource, resource)) {
      effect = rule.effect;
    }
  }
  return effect;
}

/**
 * Wildcard OpenCode: `*` кроет и `/`, `?` — один символ.
 * Совпадает с семантикой, на которой держится express-тесты.
 */
export function matchesPermissionResource(pattern: string, value: string) {
  let pi = 0;
  let vi = 0;
  let starPi = -1;
  let starVi = -1;
  while (vi < value.length) {
    if (
      pi < pattern.length &&
      (pattern[pi] === '?' || pattern[pi] === value[vi])
    ) {
      pi += 1;
      vi += 1;
      continue;
    }
    if (pi < pattern.length && pattern[pi] === '*') {
      starPi = pi;
      starVi = vi;
      pi += 1;
      continue;
    }
    if (starPi !== -1) {
      pi = starPi + 1;
      starVi += 1;
      vi = starVi;
      continue;
    }
    return false;
  }
  while (pi < pattern.length && pattern[pi] === '*') {
    pi += 1;
  }
  return pi === pattern.length;
}
