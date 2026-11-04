import type { WorkdirRights } from './registry';
import type { SessionEvent } from './session';

/**
 * Узкий шов embedded-host: сессии, prompt, события, permission reply.
 * Реальный — `@opencode/sdk`; в тестах — fake без модели.
 */
export type OpenCodeHost = {
  close(): Promise<void>;
  createSession(input: OpenCodeHostCreateSessionInput): Promise<{ id: string }>;
  getSession(sessionId: string): Promise<{ id: string }>;
  interrupt(sessionId: string): Promise<void>;
  prompt(input: OpenCodeHostPromptInput): Promise<void>;
  replyPermission(input: OpenCodeHostPermissionReplyInput): Promise<void>;
  subscribeEvents(): AsyncIterable<OpenCodeHostEvent>;
};

export type OpenCodeHostCreateSessionInput = {
  directory: string;
  permissions: readonly OpenCodePermissionRule[];
};

/**
 * Событие шины host. `data` — произвольный payload SDK;
 * адаптер читает нужные поля через узкие проверки.
 */
export type OpenCodeHostEvent = {
  data?: OpenCodeHostEventData;
  type: string;
};

export type OpenCodeHostEventData = {
  [key: string]: unknown;
  action?: string;
  error?: string | { message?: string };
  id?: string;
  resources?: readonly string[];
  sessionID?: string;
  text?: string;
};

export type OpenCodeHostPermissionReplyInput = {
  decision: OpenCodePermissionDecision;
  requestId: string;
  sessionId: string;
};

export type OpenCodeHostPromptInput = {
  delivery: 'queue' | 'steer';
  sessionId: string;
  text: string;
};

/**
 * Конфиг прав запуска OpenCode (фрагмент для старта сессии).
 * Эпик 5 подставляет в create/session; ask UI — не здесь.
 */
export type OpenCodeLaunchPermissions = {
  permissions: OpenCodePermissionRule[];
};

/** Живая сессия внутри OpenCode SessionPort (память адаптера). */
export type OpenCodeLiveSession = {
  /** abort уже инициирован — interrupt → closed, без turn_ended. */
  aborting: boolean;
  closed: boolean;
  emit: (event: SessionEvent) => void;
  listeners: Set<(event: SessionEvent) => void>;
  /** requestId ask → resolve решения для `replyPermission`. */
  pendingAsks: Map<string, (decision: OpenCodePermissionDecision) => void>;
  sessionId: string;
};

export type OpenCodePermissionAsk = {
  action: string;
  requestId: string;
  resource: string;
  sessionId: string;
};

/** Решение клиента на permission ask OpenCode. */
export type OpenCodePermissionDecision = 'always' | 'once' | 'reject';

/** Эффект правила OpenCode V2 permissions. */
export type OpenCodePermissionEffect = 'allow' | 'ask' | 'deny';

/** Одно правило permissions OpenCode V2 (last matching wins). */
export type OpenCodePermissionRule = {
  action: string;
  effect: OpenCodePermissionEffect;
  resource: string;
};

export type OpenCodeSessionPortDeps = {
  createHost: () => Promise<OpenCodeHost>;
  loadWorkdirRights: (cwd: string) => WorkdirRights;
  registryPath: string;
};
