import type { BotConfig, ChannelConfig } from './types';

const DEFAULT_CHANNEL_HOST = '127.0.0.1';
const DEFAULT_CHANNEL_PATH = '/v1/channel';
const DEFAULT_CHANNEL_PORT = 8787;

/** Читает токен, фильтр доступа и канал из env; промах обязательных ключей → throw. */
export function loadBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const token = requireEnv(env, 'TELEGRAM_BOT_TOKEN');
  const userId = requireEnv(env, 'TELEGRAM_USER_ID');
  const allowedRaw = requireEnv(env, 'TELEGRAM_ALLOWED_CHAT_IDS');
  const allowedChatIds = parseAllowedChatIds(allowedRaw);
  if (allowedChatIds.size === 0) {
    throw new Error('TELEGRAM_ALLOWED_CHAT_IDS: нужен хотя бы один chat id');
  }
  return {
    access: { allowedChatIds, userId },
    channel: loadChannelConfig(env),
    token,
  };
}

/** Host/port/path/секрет канала; секрет обязателен. */
export function loadChannelConfig(
  env: NodeJS.ProcessEnv = process.env,
): ChannelConfig {
  const secret = requireEnv(env, 'SHERPA_CHANNEL_SECRET');
  const host = env.SHERPA_CHANNEL_HOST?.trim() || DEFAULT_CHANNEL_HOST;
  const path = env.SHERPA_CHANNEL_PATH?.trim() || DEFAULT_CHANNEL_PATH;
  const portRaw = env.SHERPA_CHANNEL_PORT?.trim();
  const port =
    portRaw === undefined || portRaw === ''
      ? DEFAULT_CHANNEL_PORT
      : Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SHERPA_CHANNEL_PORT: нужен порт 1–65535');
  }
  if (!path.startsWith('/')) {
    throw new Error('SHERPA_CHANNEL_PATH: путь должен начинаться с /');
  }
  return { host, path, port, secret };
}

function parseAllowedChatIds(raw: string): Set<string> {
  const ids = new Set<string>();
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id !== '') ids.add(id);
  }
  return ids;
}

function requireEnv(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key}: обязательная переменная окружения`);
  return value;
}
