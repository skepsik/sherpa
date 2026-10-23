import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBotConfig } from './config';
import { createTelegramReceiver } from './receive';

const repoRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../..',
);
loadDotenv({ path: resolve(repoRoot, '.env') });

const config = loadBotConfig();
const receiver = createTelegramReceiver({
  config,
  // Канал к раннеру — issue-2-3; до него inbound принимается и отбрасывается.
  onInbound: () => undefined,
});

await receiver.start();
