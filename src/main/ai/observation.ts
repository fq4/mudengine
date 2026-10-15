/** Remove fields that are carried separately in the AI observation contract. */
export function compactCharacterObservation<T extends { room: unknown; inventory: unknown }>(
  state: T
): Omit<T, 'room' | 'inventory'> {
  const { room: _room, inventory: _inventory, ...character } = state;
  return character;
}

import type { AiActionName } from '../../shared/ai';
import { actionPolicy } from './ActionPolicy';
import { objectiveRequestsItemUse } from './objectiveIntents';

/**
 * Advertise only capabilities relevant to the current objective. This is a
 * prompt/context optimization, not a permission boundary; executeAiAction
 * still validates every action independently.
 */
export function objectiveAvailableActions(objective: string): AiActionName[] {
  const value = objective.toLowerCase();
  const actions: AiActionName[] = [
    'inspect_character',
    'inspect_room',
    'inspect_inventory',
    'inspect_map',
    'wait'
  ];
  if (/\b(npc|non[- ]player|townsperson|villager|talk|speak)\b/.test(value))
    actions.push('inspect_npc');
  if (/\b(navigate|travel|go to|walk to|explore)\b/.test(value)) actions.push('navigate_to');
  if (/\b(recover|health|heal|rest)\b/.test(value)) actions.push('recover_health');
  if (objectiveRequestsItemUse(objective)) actions.push('use_item');
  if (/\b(equipment|gear|armor|armour|weapon|wear|dress)\b/.test(value))
    actions.push('manage_equipment');
  if (/\b(fight|combat|attack|engage|enemy|npc)\b/.test(value)) {
    actions.push('engage_enemy', 'inspect_combat_result');
  }
  if (
    /\b(communicat\w*|conversation\w*|chat|message\w*|talk|tell|gossip|say|speak|social)\b/.test(
      value
    )
  )
    actions.push('send_message');
  if (/\b(command|execute|run|unknown)\b/.test(value)) actions.push('execute_supported_command');
  return actions;
}

/** The provider sees the same policy metadata the executor enforces. */
export function objectiveActionPolicies(objective: string) {
  return objectiveAvailableActions(objective).map((name) => {
    const policy = actionPolicy(name);
    return {
      name,
      risk: policy.risk,
      authorization: policy.authorization,
      summary: policy.summary
    };
  });
}
