import { config as loadDotenv } from 'dotenv';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createOpenCodeHost,
  createOpenCodeSessionPort,
} from './adapters/opencode';
import { createChannelClient } from './channel';
import { loadRunnerConfig } from './config';
import { createInboundRouter } from './inbound-router';
import { openRegistry } from './registry';

const repoRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../..',
);
loadDotenv({ path: resolve(repoRoot, '.env') });

const config = loadRunnerConfig();
const registry = openRegistry(config.registry);
/** Кэш сессий OpenCode рядом с реестром (resume после рестарта раннера). */
const openCodeDbPath = join(dirname(config.registry.path), 'opencode.sqlite');
const sessionPort = createOpenCodeSessionPort({
  createHost: () => createOpenCodeHost({ databasePath: openCodeDbPath }),
  loadWorkdirRights: (cwd) => registry.loadWorkdirRights(cwd),
  registryPath: config.registry.path,
});

const channel = createChannelClient({
  config: config.channel,
  onInbound: (inbound) => router.handleInbound(inbound),
});

const router = createInboundRouter({
  findCwdByPlaceKey: (key) => registry.findCwdByPlaceKey(key),
  getPlaceSessionId: (key) => registry.getPlaceSessionId(key),
  send: (command) => channel.send(command),
  sessionPort,
  setPlaceSessionId: (key, sessionId) =>
    registry.setPlaceSessionId(key, sessionId),
});

await channel.start();
console.log('@sherpa/runner: channel connected, registry open, OpenCode port');

async function shutdown() {
  await channel.stop();
  registry.close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
