import type { AiAction, AiActionName } from '../../shared/ai';
import {
  objectiveRequestsCombat,
  objectiveRequestsCommunication,
  objectiveRequestsEquipmentManagement,
  objectiveRequestsGossipReply,
  objectiveRequestsItemUse
} from './objectiveIntents';

export type ActionAuthorization = 'autonomous' | 'ask-first' | 'rejected';
export type ActionRisk = 'safe' | 'routine' | 'high' | 'unknown' | 'prohibited';

export interface ActionPolicyContext {
  objective: string;
  connected: boolean;
  inRealm: boolean;
  visibleNpcNames: readonly string[];
  safeCombatTargetNames: readonly string[];
  usableItemNames: readonly string[];
  recentGossipReplyAuthorized: boolean;
}

export type ActionPolicyAuthorizationScope = 'capability' | 'command';

export interface ActionPolicy {
  name: AiActionName;
  risk: ActionRisk;
  authorization: ActionAuthorization;
  authorizationScope: ActionPolicyAuthorizationScope;
  summary: string;
  failure: string;
  audit: string;
  validate(action: AiAction, context: ActionPolicyContext): string | null;
  completion: 'immediate' | 'delegated' | 'approval';
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const activeSessionError = (context: ActionPolicyContext): string | null =>
  context.connected && context.inRealm
    ? null
    : 'An active in-game session is required';

const listedName = (names: readonly string[], requested: string): boolean =>
  names.filter((name) => name.trim().toLowerCase() === requested.trim().toLowerCase()).length ===
  1;

const immediate = (name: AiActionName, summary: string): ActionPolicy => ({
  name,
  risk: 'safe',
  authorization: 'autonomous',
  authorizationScope: 'capability',
  summary,
  failure: 'Refuse when authoritative state is unavailable; never guess.',
  audit: `ai.${name}.observed`,
  completion: 'immediate',
  validate: (_action, context) => (name === 'wait' ? null : activeSessionError(context))
});

export const AI_ACTION_POLICIES: Readonly<Record<AiActionName, ActionPolicy>> = {
  inspect_character: immediate('inspect_character', 'Read the authoritative character state'),
  inspect_room: immediate('inspect_room', 'Read the authoritative room state'),
  inspect_inventory: immediate('inspect_inventory', 'Read the authoritative inventory state'),
  use_item: {
    name: 'use_item',
    risk: 'high',
    authorization: 'ask-first',
    authorizationScope: 'capability',
    summary: 'Use one exactly identified carried item through CommandQueue',
    failure:
      'Require explicit item-use intent, an active in-game session, and one uniquely identified eligible carried item; refuse otherwise.',
    audit: 'ai.use_item.submitted',
    completion: 'approval',
    validate: (action, context) => {
      const name = action.args?.name;
      if (!nonEmpty(name)) return 'Item use requires an exact item name';
      if (!objectiveRequestsItemUse(context.objective))
        return 'the objective does not request item use';
      const sessionError = activeSessionError(context);
      if (sessionError) return sessionError;
      return listedName(context.usableItemNames, name)
        ? null
        : 'Item is not an identified eligible carried item';
    }
  },
  inspect_map: immediate('inspect_map', 'Read the known world route/map state'),
  inspect_npc: {
    name: 'inspect_npc',
    risk: 'safe',
    authorization: 'autonomous',
    authorizationScope: 'capability',
    summary: 'Read authoritative facts about a named non-player character',
    failure:
      'Inspect only a uniquely identified authoritative non-player NPC visible in the current room; refuse player, missing, or ambiguous targets.',
    audit: 'ai.inspect_npc.observed',
    completion: 'immediate',
    validate: (action, context) => {
      const name = action.args?.name;
      if (typeof name !== 'string' || !name.trim()) return 'NPC inspection requires a name';
      if (name.trim().startsWith('@')) return 'Player inspection is prohibited';
      const sessionError = activeSessionError(context);
      if (sessionError) return sessionError;
      return listedName(context.visibleNpcNames, name)
        ? null
        : 'NPC target is not authoritatively visible';
    }
  },
  inspect_combat_result: immediate('inspect_combat_result', 'Read the latest combat result'),
  wait: immediate('wait', 'Wait for a meaningful state change'),
  navigate_to: {
    name: 'navigate_to',
    risk: 'routine',
    authorization: 'autonomous',
    authorizationScope: 'capability',
    summary: 'Delegate a bounded route to Walker',
    failure:
      'Require an active in-game session and an authoritative reachable destination; let Walker report route failures.',
    audit: 'ai.navigate_to.delegated',
    completion: 'delegated',
    validate: (action, context) => {
      if (!nonEmpty(action.args?.destination))
        return 'Navigation requires an authoritative destination or available exit';
      return activeSessionError(context);
    }
  },
  recover_health: {
    name: 'recover_health',
    risk: 'routine',
    authorization: 'autonomous',
    authorizationScope: 'capability',
    summary: 'Delegate non-consuming recovery to Recovery and CommandQueue',
    failure: 'Report queue or recovery refusal and do not consume items or currency.',
    audit: 'ai.recover_health.delegated',
    completion: 'delegated',
    validate: (_action, context) => activeSessionError(context)
  },
  engage_enemy: {
    name: 'engage_enemy',
    risk: 'high',
    authorization: 'ask-first',
    authorizationScope: 'capability',
    summary: 'Delegate an ordinary NPC engagement to AutoCombat',
    failure:
      'Require explicit PvE intent, an active session, and one uniquely identified safe hostile NPC; ask first and refuse player or ambiguous targets.',
    audit: 'ai.engage_enemy.delegated',
    completion: 'delegated',
    validate: (action, context) => {
      const name = action.args?.name;
      if (!nonEmpty(name)) return 'NPC engagement requires an enemy name';
      if (name.startsWith('@')) return 'Player targets are prohibited';
      if (!objectiveRequestsCombat(context.objective))
        return 'the objective does not request PvE combat';
      const sessionError = activeSessionError(context);
      if (sessionError) return sessionError;
      return listedName(context.safeCombatTargetNames, name)
        ? null
        : 'No authoritative safe hostile NPC matches the requested target';
    }
  },
  manage_equipment: {
    name: 'manage_equipment',
    risk: 'high',
    authorization: 'ask-first',
    authorizationScope: 'capability',
    summary: 'Delegate equipment inspection or dressing to EquipmentManager',
    failure:
      'Require equipment-management intent and an active session; ask first and delegate to EquipmentManager.',
    audit: 'ai.manage_equipment.delegated',
    completion: 'delegated',
    validate: (_action, context) => {
      if (!objectiveRequestsEquipmentManagement(context.objective))
        return 'the objective does not request equipment management';
      return activeSessionError(context);
    }
  },
  send_message: {
    name: 'send_message',
    risk: 'high',
    authorization: 'ask-first',
    authorizationScope: 'capability',
    summary: 'Send a bounded message through the social safety gate',
    failure:
      'Require communication intent, valid message syntax and channel, and an authorized recent inbound message for gossip replies; ask first.',
    audit: 'ai.send_message.submitted',
    completion: 'approval',
    validate: (action, context) => {
      if (!objectiveRequestsCommunication(context.objective))
        return 'the objective does not request communication';
      const message = typeof action.args?.message === 'string' ? action.args.message.trim() : '';
      const channel = action.args?.channel;
      const target = typeof action.args?.target === 'string' ? action.args.target.trim() : '';
      if (
        /[\r\n\x00]/.test(message) ||
        (target.length > 0 && !/^[\p{L}\p{N}_'-]+$/u.test(target))
      )
        return 'Message or target contains invalid command syntax';
      if (
        !['local', 'gossip', 'tell', 'telepath', 'broadcast'].includes(String(channel)) ||
        message.length === 0 ||
        message.length > 240
      )
        return 'Invalid social channel or message length';
      if ((channel === 'tell' || channel === 'telepath') && !target)
        return 'Private communication requires a target';
      const gossipReplyObjective = objectiveRequestsGossipReply(context.objective);
      if (gossipReplyObjective && channel !== 'gossip')
        return 'this reply objective is limited to the gossip channel';
      if (gossipReplyObjective && !context.recentGossipReplyAuthorized)
        return 'a recent inbound gossip message is required to reply';
      return activeSessionError(context);
    }
  },
  execute_supported_command: {
    name: 'execute_supported_command',
    risk: 'unknown',
    authorization: 'ask-first',
    authorizationScope: 'command',
    summary: 'Submit one command to command evidence and permission checks',
    failure: 'Refuse prohibited syntax; approval-gate unknown or risky commands.',
    audit: 'ai.execute_supported_command.submitted',
    completion: 'approval',
    validate: (action, context) => {
      const command = typeof action.args?.command === 'string' ? action.args.command.trim() : '';
      if (!command) return 'command cannot be empty';
      if (command.length > 240 || /[\r\n\x00]/.test(command))
        return 'command contains invalid syntax or is too long';
      return activeSessionError(context);
    }
  }
};

export function actionPolicy(name: AiActionName): ActionPolicy {
  return AI_ACTION_POLICIES[name];
}

export function validateActionPolicy(
  action: AiAction,
  context: ActionPolicyContext
): string | null {
  return actionPolicy(action.name).validate(action, context);
}
