import type {
  OpenCodeHost,
  OpenCodeHostEvent,
  OpenCodeLiveSession,
  OpenCodePermissionAsk,
  OpenCodeSessionPortDeps,
} from '../../types/opencode';
import type {
  OpenSession,
  SessionEvent,
  SessionPort,
  SessionResumeInput,
  SessionStartInput,
} from '../../types/session';

import { buildLaunchRights } from '../../rights';
import { SessionResumeError } from '../../session/resume-error';
import { listTextChunks } from './chunk-text';
import { expressLaunchRights } from './express-launch-rights';

/**
 * SessionPort поверх OpenCode embedded host.
 * Shared host на процесс; права — на createSession (не cross-talk Place).
 */
export function createOpenCodeSessionPort(
  deps: OpenCodeSessionPortDeps,
): SessionPort {
  const { createHost, loadWorkdirRights, registryPath, replyPermissionAsk } =
    deps;

  let hostPromise: null | Promise<OpenCodeHost> = null;
  let pumpStarted = false;
  const liveById = new Map<string, OpenCodeLiveSession>();

  function ensureHost() {
    if (hostPromise === null) {
      hostPromise = createHost();
    }
    // Pump поднимается и после обрыва: host уже есть, а pumpStarted сброшен.
    return hostPromise.then((host) => {
      if (!pumpStarted) {
        pumpStarted = true;
        void pumpEvents(host);
      }
      return host;
    });
  }

  async function pumpEvents(host: OpenCodeHost) {
    try {
      for await (const event of host.subscribeEvents()) {
        handleHostEvent(host, event);
      }
      closeAllLive('error', 'поток событий OpenCode завершился');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      closeAllLive('error', message);
    } finally {
      pumpStarted = false;
    }
  }

  function closeAllLive(kind: 'error' | 'silent', message?: string) {
    for (const live of [...liveById.values()]) {
      if (live.closed) continue;
      live.closed = true;
      liveById.delete(live.sessionId);
      if (kind === 'error' && message !== undefined) {
        live.emit({ message, type: 'error' });
      }
      live.emit({ type: 'closed' });
    }
  }

  function handleHostEvent(host: OpenCodeHost, event: OpenCodeHostEvent) {
    const sessionId = event.data?.sessionID;
    if (typeof sessionId !== 'string') return;
    const live = liveById.get(sessionId);
    if (live === undefined || live.closed) return;

    switch (event.type) {
      case 'permission.asked': {
        const action =
          typeof event.data?.action === 'string' ? event.data.action : '';
        const resource = resolveAskResource(event.data?.resources);
        const requestId =
          typeof event.data?.id === 'string' ? event.data.id : '';
        live.emit({ action, resource, type: 'permission_ask' });
        console.warn(
          'opencode: permission_ask (UI — 5-3)',
          sessionId,
          action,
          resource,
        );
        void settlePermissionAsk(host, {
          action,
          requestId,
          resource,
          sessionId,
        });
        return;
      }
      case 'session.execution.failed': {
        const message = formatHostError(event.data?.error);
        live.emit({ message, type: 'error' });
        live.emit({ type: 'turn_ended' });
        return;
      }
      case 'session.execution.interrupted': {
        if (live.aborting) return;
        live.emit({ type: 'turn_ended' });
        return;
      }
      case 'session.execution.started':
        live.emit({ type: 'turn_started' });
        return;
      case 'session.execution.succeeded':
        live.emit({ type: 'turn_ended' });
        return;
      case 'session.text.ended': {
        const text =
          typeof event.data?.text === 'string' ? event.data.text : '';
        for (const chunk of listTextChunks(text)) {
          live.emit({ text: chunk, type: 'assistant_text' });
        }
        return;
      }
      default:
        return;
    }
  }

  async function settlePermissionAsk(
    host: OpenCodeHost,
    ask: OpenCodePermissionAsk,
  ) {
    if (ask.requestId === '') return;
    const decision =
      replyPermissionAsk === undefined
        ? 'reject'
        : await replyPermissionAsk(ask);
    try {
      await host.replyPermission({
        decision,
        requestId: ask.requestId,
        sessionId: ask.sessionId,
      });
    } catch (error: unknown) {
      console.warn('opencode: replyPermission failed', ask.sessionId, error);
    }
  }

  function attachSession(sessionId: string): OpenSession {
    const prev = liveById.get(sessionId);
    if (prev !== undefined && !prev.closed) {
      prev.closed = true;
      liveById.delete(sessionId);
      prev.emit({ type: 'closed' });
    }

    const listeners = new Set<(event: SessionEvent) => void>();
    const live: OpenCodeLiveSession = {
      aborting: false,
      closed: false,
      emit(event) {
        for (const listener of listeners) listener(event);
      },
      listeners,
      sessionId,
    };
    liveById.set(sessionId, live);

    return {
      async abort() {
        if (live.closed) return;
        live.aborting = true;
        const host = await ensureHost();
        try {
          await host.interrupt(sessionId);
        } catch (error: unknown) {
          console.warn('opencode: interrupt failed', sessionId, error);
        }
        if (live.closed) return;
        live.closed = true;
        if (liveById.get(sessionId) === live) {
          liveById.delete(sessionId);
        }
        live.emit({ type: 'closed' });
      },
      async pushMessage(text) {
        if (live.closed) {
          throw new Error(`pushMessage: сессия закрыта (${sessionId})`);
        }
        const host = await ensureHost();
        await host.prompt({ delivery: 'steer', sessionId, text });
      },
      get sessionId() {
        return sessionId;
      },
      subscribe(listener) {
        listeners.add(listener);
      },
    };
  }

  function buildPermissionsForCwd(cwd: string) {
    const snapshot = loadWorkdirRights(cwd);
    const launch = buildLaunchRights(snapshot, { registryPath });
    return expressLaunchRights(launch).permissions;
  }

  return {
    async resume(input: SessionResumeInput) {
      const host = await ensureHost();
      try {
        const session = await host.getSession(input.sessionId);
        return attachSession(session.id);
      } catch (error: unknown) {
        throw new SessionResumeError(input.sessionId, error);
      }
    },
    async start(input: SessionStartInput) {
      const permissions = buildPermissionsForCwd(input.cwd);
      const host = await ensureHost();
      const session = await host.createSession({
        directory: input.cwd,
        permissions,
      });
      return attachSession(session.id);
    },
  };
}

function formatHostError(error: unknown) {
  if (typeof error === 'string' && error !== '') return error;
  if (error !== null && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message !== '') return message;
  }
  return 'ошибка хода OpenCode';
}

function resolveAskResource(resources: unknown) {
  if (!Array.isArray(resources)) return '*';
  const first: unknown = resources[0];
  return typeof first === 'string' ? first : '*';
}
