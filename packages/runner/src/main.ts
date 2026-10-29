import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createChannelClient } from './channel';
import { loadRunnerConfig } from './config';

const repoRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../..',
);
loadDotenv({ path: resolve(repoRoot, '.env') });

const config = loadRunnerConfig();

const channel = createChannelClient({
  config: config.channel,
  onInbound: (inbound) => {
    console.log(
      'inbound',
      inbound.eventId,
      inbound.event.type,
      inbound.event.place,
    );
  },
});

await channel.start();
console.log('@sherpa/runner: channel connected');

async function shutdown() {
  await channel.stop();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
