import type { ChannelConfig, RunnerConfig } from './types';

/** `SHERPA_CHANNEL_URL` + `SHERPA_CHANNEL_SECRET`; без — отказ. */
export function loadChannelConfig(
  env: NodeJS.ProcessEnv = process.env,
): ChannelConfig {
  const secret = requireEnv(env, 'SHERPA_CHANNEL_SECRET');
  const url = requireEnv(env, 'SHERPA_CHANNEL_URL');
  validateChannelUrl(url);
  return { secret, url };
}

/** Читает URL и секрет канала; промах обязательных ключей → throw. */
export function loadRunnerConfig(
  env: NodeJS.ProcessEnv = process.env,
): RunnerConfig {
  return { channel: loadChannelConfig(env) };
}

function requireEnv(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key}: обязательная переменная окружения`);
  return value;
}

function validateChannelUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('SHERPA_CHANNEL_URL: нужен полный ws:// или wss:// URL');
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error('SHERPA_CHANNEL_URL: нужен полный ws:// или wss:// URL');
  }
}
