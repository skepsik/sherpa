import type { OutboundInlineButton } from '@sherpa/contract';

import type {
  PermissionAnswerMapping,
  PermissionButtonData,
  PermissionConfirmInput,
} from '../types/permission';
import type { SessionPermissionDecision } from '../types/session';

import {
  computeDenyEffects,
  isPathEqualOrUnder,
  isRegistryBannedPath,
  listRegistryDenyPaths,
  resolvePathAccess,
  resolveTargetPaths,
} from '../rights';

/** Бюджет контракта: UTF-8 байты `requestId` + `data` на кнопку. */
export const PERMISSION_CALLBACK_BUDGET_BYTES = 48;

export const PERMISSION_BUTTON_DATA = [
  'allow',
  'deny',
  'always',
] as const satisfies readonly PermissionButtonData[];

export function buildPermissionQuestionText(action: string, resource: string) {
  return `Разрешить действие «${action}»?\n${resource}`;
}

export function buildPermissionResolveText(data: PermissionButtonData) {
  switch (data) {
    case 'allow':
      return 'Разрешено.';
    case 'always':
      return 'Разрешено всегда.';
    case 'deny':
      return 'Отклонено.';
  }
}

/**
 * Пара requestId + data каждой кнопки укладывается в бюджет контракта.
 */
export function canPackPermissionButtons(requestId: string) {
  const requestBytes = Buffer.byteLength(requestId, 'utf8');
  for (const data of PERMISSION_BUTTON_DATA) {
    if (
      requestBytes + Buffer.byteLength(data, 'utf8') >
      PERMISSION_CALLBACK_BUDGET_BYTES
    ) {
      return false;
    }
  }
  return true;
}

export function decidePermissionAnswer(input: {
  blocked: boolean;
  mapping: PermissionAnswerMapping;
}): SessionPermissionDecision {
  if (input.mapping.kind === 'unknown') return 'reject';
  if (input.blocked) return 'reject';
  return input.mapping.decision;
}

/**
 * deny / deny_global / реестр / явный grant none / shell —
 * подтверждением не снимаются. Нет grant снаружи cwd — не блок
 * (ask как раз для этого).
 */
export function isPermissionConfirmationBlocked(input: PermissionConfirmInput) {
  if (input.action === 'shell') return true;

  const resource = input.resource.trim();
  if (resource === '' || resource === '*') return false;

  const { real, requested } = resolveTargetPaths(resource);
  const registryDenyPaths = listRegistryDenyPaths(input.options.registryPath);
  if (
    isRegistryBannedPath(requested, registryDenyPaths) ||
    isRegistryBannedPath(real, registryDenyPaths)
  ) {
    return true;
  }

  const deny = computeDenyEffects(
    requested === real ? [requested] : [requested, real],
    input.snapshot,
  );
  if (deny.readDenied) return true;
  if (isWriteLikeAction(input.action) && deny.writeDenied) return true;

  if (hasExplicitGrantNone(resource, input.snapshot)) {
    return true;
  }

  if (!isWriteLikeAction(input.action)) return false;

  const access = resolvePathAccess(
    input.cwd,
    resource,
    input.snapshot,
    input.options,
  );
  // ro/append под grant — запись через ask не открываем.
  return access.level === 'ro' || access.level === 'append';
}

/**
 * Кнопки permission ask. `data` — алфавит allow|deny|always;
 * подписи — invent.
 */
export function listPermissionButtons(): OutboundInlineButton[] {
  return [
    { data: 'allow', label: 'Разрешить' },
    { data: 'deny', label: 'Запретить' },
    { data: 'always', label: 'Всегда' },
  ];
}

/**
 * `allow`→`once`, `always`→`always`, `deny`→`reject`.
 * Прочий `data` — unknown (вызывающий шлёт reject).
 */
export function mapPermissionAnswerData(data: string): PermissionAnswerMapping {
  switch (data) {
    case 'allow':
      return { decision: 'once', kind: 'mapped' };
    case 'always':
      return { decision: 'always', kind: 'mapped' };
    case 'deny':
      return { decision: 'reject', kind: 'mapped' };
    default:
      return { kind: 'unknown' };
  }
}

/**
 * Явный `grant.level === none`, покрывающий путь.
 * Отсутствие grant снаружи cwd — не сюда (это не запрет таблицы).
 */
function hasExplicitGrantNone(
  resource: string,
  snapshot: PermissionConfirmInput['snapshot'],
) {
  const { real, requested } = resolveTargetPaths(resource);
  for (const path of requested === real ? [requested] : [requested, real]) {
    for (const grant of snapshot.grants) {
      if (grant.level !== 'none') continue;
      if (isPathEqualOrUnder(path, grant.path)) return true;
    }
  }
  return false;
}

function isWriteLikeAction(action: string) {
  return action === 'edit' || action === 'write';
}
