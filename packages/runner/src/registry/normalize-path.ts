import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/**
 * Нормализация `workdirs.cwd` и `grant.path`: абсолютный путь, без хвостового `/`,
 * без сегментов `.` / `..`, через `realpath`.
 * Относительный вход — resolve от cwd процесса, затем realpath.
 */
export function normalizeWorkdirPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('cwd: пустой путь');
  }

  const absolute = isAbsolute(trimmed) ? trimmed : resolve(trimmed);

  let resolved: string;
  try {
    resolved = realpathSync(absolute);
  } catch {
    throw new Error(`cwd: путь не существует или недоступен: ${absolute}`);
  }

  if (resolved.length > 1 && resolved.endsWith('/')) {
    resolved = resolved.replace(/\/+$/, '');
  }

  if (!isAbsolute(resolved)) {
    throw new Error(
      `cwd: ожидался абсолютный путь после realpath: ${resolved}`,
    );
  }

  for (const segment of resolved.split('/')) {
    if (segment === '.' || segment === '..') {
      throw new Error(`cwd: сегменты . или .. недопустимы: ${resolved}`);
    }
  }

  return resolved;
}
