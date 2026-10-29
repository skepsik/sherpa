import type { RegistryConfig } from './registry';

/** Env канала: полный URL и секрет рукопожатия. */
export type ChannelConfig = {
  secret: string;
  /** Полный `ws://…` / `wss://…` URL upgrade. */
  url: string;
};

export type RunnerConfig = {
  channel: ChannelConfig;
  registry: RegistryConfig;
};
