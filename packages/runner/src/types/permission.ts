import type { WorkdirRights } from './registry';
import type { ResolveRightsOptions } from './rights';
import type { SessionPermissionDecision } from './session';

/** Открытый ask в памяти процесса (wire requestId → pending). */
export type PendingPermissionAsk = {
  action: string;
  cwd: string;
  /** Id ask в харнессе (ответ через `answerPermission`). */
  harnessRequestId: string;
  /** messageId из `question_ok`; null пока send_question не завершился. */
  messageId: null | string;
  placeKey: string;
  resource: string;
};

/** Исход маппинга `question_answer.data` → решение порта. */
export type PermissionAnswerMapping =
  { decision: SessionPermissionDecision; kind: 'mapped' } | { kind: 'unknown' };

/** Компактный код кнопки на проводе (`buttons[].data`). */
export type PermissionButtonData = 'allow' | 'always' | 'deny';

export type PermissionConfirmInput = {
  action: string;
  cwd: string;
  options: ResolveRightsOptions;
  resource: string;
  snapshot: WorkdirRights;
};
