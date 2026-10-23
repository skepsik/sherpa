import type { Api } from 'grammy';

export type NotifyApi = Pick<Api, 'sendMessage'>;
