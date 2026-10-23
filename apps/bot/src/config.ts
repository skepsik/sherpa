import type { AccessFilter } from './access';

export type BotConfig = {
  access: AccessFilter;
  token: string;
};

/** Читает токен и фильтр доступа из env; промах обязательных ключей → throw. */
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
    token,
  };
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
