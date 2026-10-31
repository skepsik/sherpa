import { existsSync, realpathSync } from 'node:fs';

import { normalizeLexicalPath } from './path-utils';

const SIDE_CAR_SUFFIXES = ['-wal', '-shm', '-journal'] as const;

export function isRegistryBannedPath(
  path: string,
  registryDenyPaths: readonly string[],
) {
  return registryDenyPaths.includes(path);
}

/**
 * Константный запрет реестра: основной файл БД и sidecar SQLite.
 * `:memory:` и пустой путь — пустой список.
 */
export function listRegistryDenyPaths(registryPath: string): string[] {
  const trimmed = registryPath.trim();
  if (!trimmed || trimmed === ':memory:') {
    return [];
  }

  const lexical = normalizeLexicalPath(trimmed);
  const dbPath = existsSync(lexical)
    ? normalizeLexicalPath(realpathSync(lexical))
    : lexical;

  return [dbPath, ...SIDE_CAR_SUFFIXES.map((suffix) => `${dbPath}${suffix}`)];
}
