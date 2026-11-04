import type { OutboundCommand } from '@sherpa/contract';

import type {
  InboundRouter,
  InboundRouterDeps,
  MessageJob,
} from './types/routing';
import type { PlaceSessionSlots, SessionEvent } from './types/session';

import { createEventIdDedup } from './event-dedup';
import { createPlaceMessageQueues } from './message-queue';
import { createPlaceSessionSlots } from './session';

/** Stub-ack на `question_answer` до permission UI (5-3). */
export const STUB_ACCEPTED_TEXT = 'Принято.';

/** Текст «вне реестра» — одна формулировка; opaque id обязателен. */
export function buildOutsideRegistryText(placeKey: string) {
  return `Место вне реестра: ${placeKey}`;
}

/**
 * Маршрутизация inbound: дедуп → lookup → «вне реестра» / очередь /
 * stub `question_answer`. Drain `message` → порт сессии (push).
 */
export function createInboundRouter(deps: InboundRouterDeps): InboundRouter {
  const {
    findCwdByPlaceKey,
    getPlaceSessionId,
    send,
    sessionPort,
    setPlaceSessionId,
  } = deps;
  const dedup = createEventIdDedup();
  /** Исходящие от стрима — по очереди на Place (busy → текст → idle). */
  const streamOutboundTails = new Map<string, Promise<void>>();

  const placeSessions = createPlaceSessionSlots({
    getPlaceSessionId,
    onEvent: (key, event) => {
      const previous = streamOutboundTails.get(key) ?? Promise.resolve();
      const run = previous.then(
        () => handleSessionEvent(key, event, send),
        () => handleSessionEvent(key, event, send),
      );
      streamOutboundTails.set(
        key,
        run.then(
          () => undefined,
          () => undefined,
        ),
      );
    },
    sessionPort,
    setPlaceSessionId,
  });

  const queues = createPlaceMessageQueues({
    drainJob: (job) => drainMessageJob(job, placeSessions),
  });

  return {
    async handleInbound(inbound) {
      if (dedup.tryAccept(inbound.eventId) === null) {
        console.warn('inbound: повтор eventId, drop', inbound.eventId);
        return;
      }

      const key = inbound.event.place;
      const cwd = findCwdByPlaceKey(key);
      if (cwd === null) {
        await sendBestEffort(send, {
          place: key,
          text: buildOutsideRegistryText(key),
          type: 'send_message',
        });
        return;
      }

      if (inbound.event.type === 'question_answer') {
        await sendBestEffort(send, {
          place: key,
          text: STUB_ACCEPTED_TEXT,
          type: 'send_message',
        });
        return;
      }

      queues.enqueue({
        cwd,
        event: inbound.event,
        eventId: inbound.eventId,
        key,
      });
    },
  };
}

async function drainMessageJob(
  job: MessageJob,
  placeSessions: PlaceSessionSlots,
) {
  await placeSessions.pushMessage({
    cwd: job.cwd,
    key: job.key,
    text: job.event.text,
  });
}

async function handleSessionEvent(
  key: string,
  event: SessionEvent,
  send: InboundRouterDeps['send'],
) {
  switch (event.type) {
    case 'assistant_text':
      await sendBestEffort(send, {
        place: key,
        text: event.text,
        type: 'send_message',
      });
      return;
    case 'closed':
      await sendBestEffort(send, {
        place: key,
        status: 'idle',
        type: 'set_status',
      });
      return;
    case 'error':
      console.warn('session: error', key, event.message);
      return;
    case 'permission_ask':
      console.warn(
        'session: permission_ask (UI — 5-3)',
        key,
        event.action,
        event.resource,
      );
      return;
    case 'turn_ended':
      await sendBestEffort(send, {
        place: key,
        status: 'idle',
        type: 'set_status',
      });
      return;
    case 'turn_started':
      await sendBestEffort(send, {
        place: key,
        status: 'busy',
        type: 'set_status',
      });
      return;
  }
}

async function sendBestEffort(
  send: InboundRouterDeps['send'],
  command: OutboundCommand,
) {
  try {
    const outcome = await send(command);
    if (outcome.kind !== 'success') {
      console.warn(
        'outbound: сбой в stub/маршруте',
        command.type,
        command.place,
        outcome.kind,
      );
    }
  } catch (error: unknown) {
    console.warn(
      'outbound: исключение в stub/маршруте',
      command.type,
      command.place,
      error,
    );
  }
}
