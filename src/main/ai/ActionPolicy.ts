import type { AiAction, AiActionName } from '../../shared/ai';

export type ActionAuthorization = 'autonomous' | 'ask-first' | 'rejected';
export type ActionRisk = 'safe' | 'routine' | 'high' | 'unknown' | 'prohibited';

export interface ActionPolicyContext {
  objective: string;
  connected: boolean;
  inRealm: boolean;
}

export interface ActionPolicy {
  name: AiActionName;
  risk: ActionRisk;
  authorization: ActionAuthorization;
  summary: string;
  failure: string;
  audit: string;
  validate(action: AiAction, context: ActionPolicyContext): string | null;
  completion: 'immediate' | 'delegated' | 'approval';
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const immediate = (name: AiActionName, summary: string): ActionPolicy => ({
  name,
  risk: 'safe',
  authorization: 'autonomous',
  summary,
  failure: 'Refuse when authoritative state is unavailable; never guess.',
  audit: `ai.${name}.observed`,
  completion: 'immediate',
  validate: () => null
});

export const AI_ACTION_POLICIES: Readonly<Record<AiActionName, ActionPolicy>> = {
  inspect_character: immediate('inspect_character', 'Read the authoritative character state'),
  inspect_room: immediate('inspect_room', 'Read the authoritative room state'),
  inspect_inventory: immediate('inspect_inventory', 'Read the authoritative inventory state'),
  use_item: {
    name: 'use_item',
    risk: 'high',
    authorization: 'ask-first',
    summary: 'Use one exactly identified carried item through CommandQueue',
    failure: 'Require approval and refuse items absent from the authoritative inventory.',
    audit: 'ai.use_item.submitted',
    completion: 'approval',
    validate: (action) =>
      nonEmpty(action.args?.name) ? null : 'Item use requires an exact item name'
  },
  inspect_map: immediate('inspect_map', 'Read the known world route/map state'),
  inspect_npc: {
    name: 'inspect_npc',
    risk: 'safe',
    authorization: 'autonomous',
    summary: 'Read authoritative facts about a named non-player character',
    failure: 'Refuse unknown or player targets; never infer private data.',
    audit: 'ai.inspect_npc.observed',
    completion: 'immediate',
    validate: (action) => {
      const name = action.args?.name;
      if (typeof name !== 'string' || !name.trim()) return 'NPC inspection requires a name';
      return name.trim().startsWith('@') ? 'Player inspection is prohibited' : null;
    }
  },
  inspect_combat_result: immediate('inspect_combat_result', 'Read the latest combat result'),
  wait: immediate('wait', 'Wait for a meaningful state change'),
  navigate_to: {
    name: 'navigate_to',
    risk: 'routine',
    authorization: 'autonomous',
    summary: 'Delegate a bounded route to Walker',
    failure: 'Refuse unknown or unreachable destinations and preserve the objective.',
    audit: 'ai.navigate_to.delegated',
    completion: 'delegated',
    validate: (action, context) => {
      return nonEmpty(action.args?.destination)
        ? null
        : 'Navigation requires an authoritative destination or available exit';
    }
  },
  recover_health: {
    name: 'recover_health',
    risk: 'routine',
    authorization: 'autonomous',
    summary: 'Delegate non-consuming recovery to Recovery and CommandQueue',
    failure: 'Report queue or recovery refusal and do not consume items or currency.',
    audit: 'ai.recover_health.delegated',
    completion: 'delegated',
    validate: () => null
  },
  engage_enemy: {
    name: 'engage_enemy',
    risk: 'high',
    authorization: 'ask-first',
    summary: 'Delegate an ordinary NPC engagement to AutoCombat',
    failure: 'Require approval and refuse player targets or ambiguous names.',
    audit: 'ai.engage_enemy.delegated',
    completion: 'delegated',
    validate: (action, context) => {
      if (!nonEmpty(action.args?.name)) return 'NPC engagement requires an enemy name';
      return action.args.name.startsWith('@') ? 'Player targets are prohibited' : null;
    }
  },
  manage_equipment: {
    name: 'manage_equipment',
    risk: 'high',
    authorization: 'ask-first',
    summary: 'Delegate equipment inspection or dressing to EquipmentManager',
    failure: 'Require approval and report the deterministic manager outcome.',
    audit: 'ai.manage_equipment.delegated',
    completion: 'delegated',
    validate: () => null
  },
  send_message: {
    name: 'send_message',
    risk: 'high',
    authorization: 'ask-first',
    summary: 'Send a bounded message through the social safety gate',
    failure: 'Require approval or refuse invalid channels, targets, and message syntax.',
    audit: 'ai.send_message.submitted',
    completion: 'approval',
    validate: (action, context) => {
      return nonEmpty(action.args?.message) ? null : 'Communication requires a message';
    }
  },
  execute_supported_command: {
    name: 'execute_supported_command',
    risk: 'unknown',
    authorization: 'ask-first',
    summary: 'Submit one command to command evidence and permission checks',
    failure: 'Refuse prohibited syntax; approval-gate unknown or risky commands.',
    audit: 'ai.execute_supported_command.submitted',
    completion: 'approval',
    validate: (action, context) => {
      return nonEmpty(action.args?.command) ? null : 'command cannot be empty';
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
