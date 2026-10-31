/**
 * Ручной seed через API реестра (MVP без админки).
 *
 * Workdir + place (как раньше, без подкоманды):
 *
 *   npm run seed -w @sherpa/runner -- \
 *     --cwd /path/to/workdir \
 *     --name my-project \
 *     --description 'когда сюда' \
 *     --place <opaque-Place>
 *
 * Права (подкоманды grant | deny | deny-global) — см. README пакета.
 * `SHERPA_REGISTRY_PATH` обязателен. Рекомендуемые шаблоны харнесса
 * в deny_global код не подмешивает — заводи руками до эпика 6.
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

const argv = process.argv.slice(2);
const command = resolveCommand(argv);
const config = loadRegistryConfig();
const registry = openRegistry(config);

try {
  console.log(JSON.stringify(runCommand(command), null, 2));
} finally {
  registry.close();
}

function parseFlags(argv: string[], required: string[]) {
  const out: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (
      !flag?.startsWith('--') ||
      value === undefined ||
      value.startsWith('--')
    ) {
      throw new Error(`usage: ${usageFor(required)}`);
    }
    const key = flag.slice(2);
    if (!required.includes(key)) {
      throw new Error(`неизвестный флаг: ${flag}`);
    }
    out[key] = value;
    i++;
  }

  for (const key of required) {
    if (!out[key]) {
      throw new Error(`usage: ${usageFor(required)}`);
    }
  }

  return out;
}

function resolveCommand(args: string[]): {
  args: string[];
  name: 'deny' | 'deny-global' | 'grant' | 'workdir';
} {
  const head = args[0];
  if (head === 'grant' || head === 'deny' || head === 'deny-global') {
    return { args: args.slice(1), name: head };
  }
  return { args, name: 'workdir' };
}

function runCommand(command: {
  args: string[];
  name: 'deny' | 'deny-global' | 'grant' | 'workdir';
}) {
  switch (command.name) {
    case 'deny': {
      const args = parseFlags(command.args, ['cwd', 'pattern']);
      return registry.insertDeny({ cwd: args.cwd, pattern: args.pattern });
    }
    case 'deny-global': {
      const args = parseFlags(command.args, ['pattern']);
      return registry.insertDenyGlobal({ pattern: args.pattern });
    }
    case 'grant': {
      const args = parseFlags(command.args, ['cwd', 'path', 'level']);
      return registry.upsertGrant({
        cwd: args.cwd,
        level: args.level as 'append' | 'none' | 'ro' | 'rw',
        path: args.path,
      });
    }
    case 'workdir': {
      const args = parseFlags(command.args, [
        'cwd',
        'name',
        'description',
        'place',
      ]);
      return registry.seedWorkdirPlace({
        cwd: args.cwd,
        description: args.description,
        name: args.name,
        placeKey: args.place,
      });
    }
  }
}

function usageFor(required: string[]) {
  return required.map((key) => `--${key} <…>`).join(' ');
}
