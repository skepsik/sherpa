import type {
  ConformanceAction,
  ConformanceDriver,
  ConformanceProvokeInput,
  ConformanceRightsSeed,
  ConformanceVerdict,
} from '../../types/conformance';
import type { OpenCodePermissionRule } from '../../types/opencode';
import type { WorkdirRights } from '../../types/registry';

import { buildLaunchRights } from '../../rights';
import { isPathEqualOrUnder } from '../../rights/path-utils';
import {
  decidePermissionAnswer,
  isPermissionConfirmationBlocked,
} from '../../session/permission-ask';
import { expressLaunchRights } from './express-launch-rights';
import { findPermissionEffect } from './match-permission';

/**
 * Fake-драйвер OpenCode для CI: `expressLaunchRights` + last-match +
 * эмуляция ask (once/always/reject) с блоком deny/registry как в порте.
 * Live SDK / модель не вызываются.
 */
export function createOpenCodeConformanceDriver(): ConformanceDriver {
  return {
    async provoke(input) {
      return provokeOpenCodeFake(input);
    },
  };
}

function buildSnapshot(seed: ConformanceRightsSeed): WorkdirRights {
  const cwd = seed.cwd;
  return {
    cwd,
    denies: (seed.deny ?? []).map((pattern) => ({ cwd, pattern })),
    denyGlobals: (seed.denyGlobal ?? []).map((pattern) => ({ pattern })),
    grants: (seed.grants ?? []).map((grant) => ({
      cwd,
      level: grant.level,
      path: grant.path,
    })),
  };
}

/**
 * Вердикт до ответа на ask.
 * Снаружи cwd — сначала `external_directory`; внутри — дефолт сессии allow,
 * пока last-match не скажет иначе.
 */
function evaluateOpenCodeAction(
  permissions: readonly OpenCodePermissionRule[],
  cwd: string,
  action: ConformanceAction,
  path: string,
): ConformanceVerdict {
  const external = !isPathEqualOrUnder(path, cwd);
  if (external) {
    const ext = findPermissionEffect(permissions, 'external_directory', path);
    if (ext === 'deny') return 'deny';
    if (ext === 'ask' || ext === null) return 'ask';
  }

  return evaluateToolEffect(permissions, action, path, {
    defaultAllow: true,
  });
}

function evaluateToolAfterExternalAllow(
  permissions: readonly OpenCodePermissionRule[],
  action: ConformanceAction,
  path: string,
): ConformanceVerdict {
  // после once/always на external — только tool-правила (read/edit)
  return evaluateToolEffect(permissions, action, path, {
    defaultAllow: true,
  });
}

function evaluateToolEffect(
  permissions: readonly OpenCodePermissionRule[],
  action: ConformanceAction,
  path: string,
  options: { defaultAllow: boolean },
): ConformanceVerdict {
  const effect = findPermissionEffect(
    permissions,
    openCodeToolAction(action),
    path,
  );
  if (effect === 'deny') return 'deny';
  if (effect === 'ask') return 'ask';
  if (effect === 'allow') return 'allow';
  return options.defaultAllow ? 'allow' : 'deny';
}

function openCodeToolAction(action: ConformanceAction) {
  return action === 'read' ? 'read' : 'edit';
}

async function provokeOpenCodeFake(
  input: ConformanceProvokeInput,
): Promise<ConformanceVerdict> {
  const snapshot = buildSnapshot(input.rights);
  const launch = buildLaunchRights(snapshot, {
    registryPath: input.rights.registryPath,
  });
  const { permissions } = expressLaunchRights(launch);

  const first = evaluateOpenCodeAction(
    permissions,
    input.rights.cwd,
    input.action,
    input.path,
  );
  if (first !== 'ask') {
    return first;
  }

  // Без onAsk — фиксируем сам факт ask (кейсы «вне правил → ask»).
  if (input.onAsk === undefined) {
    return 'ask';
  }

  const reply = await input.onAsk({
    action: input.action,
    path: input.path,
  });
  const ocAction = openCodeToolAction(input.action);
  const blocked = isPermissionConfirmationBlocked({
    action: ocAction,
    cwd: input.rights.cwd,
    options: { registryPath: input.rights.registryPath },
    resource: input.path,
    snapshot,
  });
  const decision = decidePermissionAnswer({
    blocked,
    mapping: { decision: reply, kind: 'mapped' },
  });
  if (decision === 'reject') {
    return 'deny';
  }

  // once/always: external ask снят; дальше — правила read/edit.
  return evaluateToolAfterExternalAllow(permissions, input.action, input.path);
}
