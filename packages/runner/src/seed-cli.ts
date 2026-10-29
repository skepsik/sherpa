/**
 * Ручной seed: один workdir + одно place через API реестра.
 *
 *   npm run seed -w @sherpa/runner -- \
 *     --cwd /path/to/workdir \
 *     --name my-project \
 *     --description 'когда сюда' \
 *     --place <opaque-Place>
 *
 * `SHERPA_REGISTRY_PATH` — обязателен (см. `.env.example`).
 * Place для проверки — opaque id «вне реестра» (issue-3-4) или известный кодек бота.
 */
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRegistryConfig } from './config';
import { openRegistry } from './registry';

const repoRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../..',
);
loadDotenv({ path: resolve(repoRoot, '.env') });

const args = parseArgs(process.argv.slice(2));
const config = loadRegistryConfig();
const registry = openRegistry(config);

try {
  const result = registry.seedWorkdirPlace({
    cwd: args.cwd,
    description: args.description,
    name: args.name,
    placeKey: args.place,
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  registry.close();
}

function parseArgs(argv: string[]) {
  const out: Partial<{
    cwd: string;
    description: string;
    name: string;
    place: string;
  }> = {};

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (
      !flag?.startsWith('--') ||
      value === undefined ||
      value.startsWith('--')
    ) {
      throw new Error(
        'usage: --cwd <path> --name <name> --description <text> --place <Place>',
      );
    }
    const key = flag.slice(2);
    if (
      key === 'cwd' ||
      key === 'name' ||
      key === 'description' ||
      key === 'place'
    ) {
      out[key] = value;
      i++;
      continue;
    }
    throw new Error(`неизвестный флаг: ${flag}`);
  }

  if (!out.cwd || !out.name || !out.description || !out.place) {
    throw new Error(
      'usage: --cwd <path> --name <name> --description <text> --place <Place>',
    );
  }

  return {
    cwd: out.cwd,
    description: out.description,
    name: out.name,
    place: out.place,
  };
}
