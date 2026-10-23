import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createChannelServer } from './channel';
import { createCommandQueue } from './command-queue';
import { loadBotConfig } from './config';
import { executeOutbound } from './outbound';
import { createTelegramReceiver } from './receive';
import { notifyRunnerUnavailable } from './runner-unavailable';

const repoRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../..',
);
loadDotenv({ path: resolve(repoRoot, '.env') });

const config = loadBotConfig();
const queue = createCommandQueue();

const receiver = createTelegramReceiver({
  config,
  onInbound: async (inbound) => {
    if (channel.tryPublishInbound(inbound)) return;
    await notifyRunnerUnavailable(receiver.bot.api, inbound.event.place);
  },
});

const channel = createChannelServer({
  config: config.channel,
  execute: (command) => executeOutbound(receiver.bot.api, command),
  queue,
});

await channel.start();
await receiver.start();
