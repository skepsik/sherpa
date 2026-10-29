import type { OutboundCommand } from '@sherpa/contract';

import type {
  InboundRouter,
  InboundRouterDeps,
  MessageJob,
} from './types/routing';

import { createEventIdDedup } from './event-dedup';
import { createPlaceMessageQueues } from './message-queue';

/** Фиксированный stub-ответ на `message` / ack на `question_answer`. */
export const STUB_ACCEPTED_TEXT = 'Принято.';

/** Текст «вне реестра» — одна формулировка; opaque id обязателен. */
export function buildOutsideRegistryText(placeKey: string) {
  return `Место вне реестра: ${placeKey}`;
}

/**
 * Маршрутизация inbound: дедуп → lookup → «вне реестра» / очередь /
 * stub `question_answer`. Drain сообщений — stub без Agent SDK.
 */
export function createInboundRouter(deps: InboundRouterDeps): InboundRouter {
  const { findCwdByPlaceKey, send } = deps;
  const dedup = createEventIdDedup();
  const queues = createPlaceMessageQueues({
    drainJob: (job) => drainMessageJob(job, send),
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
  send: InboundRouterDeps['send'],
) {
  await sendBestEffort(send, {
    place: job.key,
    status: 'busy',
    type: 'set_status',
  });
  await sendBestEffort(send, {
    place: job.key,
    text: STUB_ACCEPTED_TEXT,
    type: 'send_message',
  });
  await sendBestEffort(send, {
    place: job.key,
    status: 'idle',
    type: 'set_status',
  });
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
