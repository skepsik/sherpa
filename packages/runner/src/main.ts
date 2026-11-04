import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createChannelClient } from './channel';
import { loadRunnerConfig } from './config';
import { createInboundRouter } from './inbound-router';
import { openRegistry } from './registry';
import { createSessionTestDouble } from './session';

const repoRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../..',
);
loadDotenv({ path: resolve(repoRoot, '.env') });

const config = loadRunnerConfig();
const registry = openRegistry(config.registry);
/** До OpenCode (5-2) — in-memory double на порту сессии. */
const sessionPort = createSessionTestDouble();

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
console.log('@sherpa/runner: channel connected, registry open');

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
