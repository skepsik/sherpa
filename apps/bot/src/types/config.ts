import type { AccessFilter } from './access';
import type { ChannelConfig } from './channel';

export type BotConfig = {
  access: AccessFilter;
  channel: ChannelConfig;
  token: string;
};
