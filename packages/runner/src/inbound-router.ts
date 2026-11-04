import type { OutboundCommand } from '@sherpa/contract';

import type {
  PendingPermissionAsk,
  PermissionButtonData,
} from './types/permission';
import type {
  InboundRouter,
  InboundRouterDeps,
  MessageJob,
  SessionEventCtx,
} from './types/routing';
import type { PlaceSessionSlots, SessionEvent } from './types/session';

import { createEventIdDedup } from './event-dedup';
import { createPlaceMessageQueues } from './message-queue';
import { createPlaceSessionSlots } from './session';
import {
  buildPermissionQuestionText,
  buildPermissionResolveText,
  canPackPermissionButtons,
  decidePermissionAnswer,
  isPermissionConfirmationBlocked,
  listPermissionButtons,
  mapPermissionAnswerData,
} from './session/permission-ask';

/** Текст «вне реестра» — одна формулировка; opaque id обязателен. */
export function buildOutsideRegistryText(placeKey: string) {
  return `Место вне реестра: ${placeKey}`;
}

/**
 * Маршрутизация inbound: дедуп → lookup → «вне реестра» / очередь /
 * `question_answer` → pending ask. Drain `message` → порт сессии (push).
 */
export function createInboundRouter(deps: InboundRouterDeps): InboundRouter {
  const {
    findCwdByPlaceKey,
    getPlaceSessionId,
    loadWorkdirRights,
    registryPath,
    send,
    sessionPort,
    setPlaceSessionId,
  } = deps;
  const dedup = createEventIdDedup();
  /** Исходящие от стрима — по очереди на Place (busy → текст → idle). */
  const streamOutboundTails = new Map<string, Promise<void>>();
  /** Wire requestId → открытый permission ask (память процесса). */
  const pendingAsks = new Map<string, PendingPermissionAsk>();
  let nextWireAskSeq = 1;

  const placeSessions = createPlaceSessionSlots({
    getPlaceSessionId,
    onEvent: (key, event) => {
      const previous = streamOutboundTails.get(key) ?? Promise.resolve();
      const ctx: SessionEventCtx = {
        allocateWireRequestId: () => {
          const id = `p${nextWireAskSeq}`;
          nextWireAskSeq += 1;
          return id;
        },
        findCwdByPlaceKey,
        loadWorkdirRights,
        pendingAsks,
        placeSessions,
        registryPath,
        send,
      };
      const run = previous.then(
        () => handleSessionEvent(key, event, ctx),
        () => handleSessionEvent(key, event, ctx),
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
        await handleQuestionAnswer({
          cwd,
          data: inbound.event.data,
          loadWorkdirRights,
          pendingAsks,
          placeKey: key,
          placeSessions,
          registryPath,
          requestId: inbound.event.requestId,
          send,
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

async function answerHarnessReject(
  placeKey: string,
  harnessRequestId: string,
  placeSessions: PlaceSessionSlots,
) {
  const session = placeSessions.findLiveSession(placeKey);
  if (session === null) return;
  await session.answerPermission({
    decision: 'reject',
    requestId: harnessRequestId,
  });
}

function buildAnswerResolveText(
  data: string,
  blocked: boolean,
  mappingKind: 'mapped' | 'unknown',
) {
  if (blocked || mappingKind === 'unknown') return 'Отклонено.';
  if (data === 'allow' || data === 'always' || data === 'deny') {
    const buttonData: PermissionButtonData = data;
    return buildPermissionResolveText(buttonData);
  }
  return 'Отклонено.';
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

async function handlePermissionAsk(
  key: string,
  event: Extract<SessionEvent, { type: 'permission_ask' }>,
  ctx: SessionEventCtx,
) {
  const cwd = ctx.findCwdByPlaceKey(key);
  if (cwd === null) {
    console.warn('permission_ask: нет cwd для Place', key);
    await answerHarnessReject(key, event.requestId, ctx.placeSessions);
    return;
  }
  if (event.requestId === '') {
    console.warn('permission_ask: пустой harness requestId', key);
    return;
  }

  const wireRequestId = ctx.allocateWireRequestId();
  if (!canPackPermissionButtons(wireRequestId)) {
    console.warn(
      'permission_ask: requestId+data вне бюджета, drop pack',
      wireRequestId,
    );
    await answerHarnessReject(key, event.requestId, ctx.placeSessions);
    return;
  }

  const pending: PendingPermissionAsk = {
    action: event.action,
    cwd,
    harnessRequestId: event.requestId,
    messageId: null,
    placeKey: key,
    resource: event.resource,
  };
  ctx.pendingAsks.set(wireRequestId, pending);

  const outcome = await sendCatching(ctx.send, {
    buttons: listPermissionButtons(),
    place: key,
    requestId: wireRequestId,
    text: buildPermissionQuestionText(event.action, event.resource),
    type: 'send_question',
  });

  if (outcome.kind !== 'success' || outcome.result.type !== 'question_ok') {
    console.warn('permission_ask: send_question сбой', key, outcome.kind);
    ctx.pendingAsks.delete(wireRequestId);
    await answerHarnessReject(key, event.requestId, ctx.placeSessions);
    return;
  }

  // Поздний teardown мог снять pending, пока ждали outbound.
  const still = ctx.pendingAsks.get(wireRequestId);
  if (still === undefined) {
    await sendBestEffort(ctx.send, {
      messageId: outcome.result.messageId,
      place: key,
      text: 'Отклонено.',
      type: 'resolve_question',
    });
    return;
  }
  still.messageId = outcome.result.messageId;
}

async function handleQuestionAnswer(input: {
  cwd: string;
  data: string;
  loadWorkdirRights: InboundRouterDeps['loadWorkdirRights'];
  pendingAsks: Map<string, PendingPermissionAsk>;
  placeKey: string;
  placeSessions: PlaceSessionSlots;
  registryPath: string;
  requestId: string;
  send: InboundRouterDeps['send'];
}) {
  const pending = input.pendingAsks.get(input.requestId);
  if (pending === undefined) {
    console.warn(
      'question_answer: нет pending, drop',
      input.requestId,
      input.placeKey,
    );
    return;
  }
  if (pending.placeKey !== input.placeKey) {
    console.warn(
      'question_answer: place ≠ pending, drop',
      input.requestId,
      input.placeKey,
      pending.placeKey,
    );
    return;
  }
  input.pendingAsks.delete(input.requestId);

  const mapping = mapPermissionAnswerData(input.data);
  let blocked: boolean;
  try {
    const snapshot = input.loadWorkdirRights(pending.cwd);
    blocked = isPermissionConfirmationBlocked({
      action: pending.action,
      cwd: pending.cwd,
      options: { registryPath: input.registryPath },
      resource: pending.resource,
      snapshot,
    });
  } catch (error: unknown) {
    console.warn('question_answer: сверка прав сбой → reject', error);
    blocked = true;
  }

  const decision = decidePermissionAnswer({ blocked, mapping });
  const session = input.placeSessions.findLiveSession(pending.placeKey);
  if (session !== null) {
    await session.answerPermission({
      decision,
      requestId: pending.harnessRequestId,
    });
  } else {
    console.warn(
      'question_answer: нет живой сессии',
      pending.placeKey,
      pending.harnessRequestId,
    );
  }

  if (pending.messageId !== null) {
    await sendBestEffort(input.send, {
      messageId: pending.messageId,
      place: pending.placeKey,
      text: buildAnswerResolveText(input.data, blocked, mapping.kind),
      type: 'resolve_question',
    });
  }
}

async function handleSessionEvent(
  key: string,
  event: SessionEvent,
  ctx: SessionEventCtx,
) {
  switch (event.type) {
    case 'assistant_text':
      await sendBestEffort(ctx.send, {
        place: key,
        text: event.text,
        type: 'send_message',
      });
      return;
    case 'closed':
      await teardownPendingAsks(key, ctx);
      await sendBestEffort(ctx.send, {
        place: key,
        status: 'idle',
        type: 'set_status',
      });
      return;
    case 'error':
      console.warn('session: error', key, event.message);
      await teardownPendingAsks(key, ctx);
      return;
    case 'permission_ask':
      await handlePermissionAsk(key, event, ctx);
      return;
    case 'turn_ended':
      await sendBestEffort(ctx.send, {
        place: key,
        status: 'idle',
        type: 'set_status',
      });
      return;
    case 'turn_started':
      await sendBestEffort(ctx.send, {
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

async function sendCatching(
  send: InboundRouterDeps['send'],
  command: OutboundCommand,
) {
  try {
    return await send(command);
  } catch (error: unknown) {
    console.warn(
      'outbound: исключение в stub/маршруте',
      command.type,
      command.place,
      error,
    );
    return { cause: 'timeout' as const, kind: 'unknown' as const };
  }
}

async function teardownPendingAsks(key: string, ctx: SessionEventCtx) {
  const toDrop: { pending: PendingPermissionAsk; wireId: string }[] = [];
  for (const [wireId, pending] of ctx.pendingAsks) {
    if (pending.placeKey === key) toDrop.push({ pending, wireId });
  }
  for (const { pending, wireId } of toDrop) {
    ctx.pendingAsks.delete(wireId);
    await answerHarnessReject(key, pending.harnessRequestId, ctx.placeSessions);
    if (pending.messageId !== null) {
      await sendBestEffort(ctx.send, {
        messageId: pending.messageId,
        place: key,
        text: 'Отклонено.',
        type: 'resolve_question',
      });
    }
  }
}
