import type { AiActionName } from '../../shared/ai';

export type ObjectiveStepStatus = 'pending' | 'active' | 'completed' | 'blocked';

export interface ObjectiveStep {
  id: string;
  action: AiActionName;
  label: string;
  status: ObjectiveStepStatus;
  destination?: string;
}

const destination = (objective: string): string | undefined =>
  objective.match(/\b(?:to|destination)\s+(\d+\/\d+)\b/i)?.[1];

export function buildObjectivePlan(objective: string): ObjectiveStep[] {
  const value = objective.trim();
  const lower = value.toLowerCase();
  const steps: ObjectiveStep[] = [];
  const add = (action: AiActionName, label: string, extra: Partial<ObjectiveStep> = {}) =>
    steps.push({ id: `${steps.length + 1}:${action}`, action, label, status: 'pending', ...extra });
  if (/\b(inventory|backpack|pack)\b/.test(lower)) add('inspect_inventory', 'Inspect inventory');
  if (!/\bnon[- ]player\b/.test(lower) && /\b(character|status|stats?)\b/.test(lower))
    add('inspect_character', 'Inspect character');
  const target = destination(value);
  if (target) add('navigate_to', `Navigate to ${target}`, { destination: target });
  else if (/\b(navigate|travel|go to|walk to|explore)\b/.test(lower))
    add('navigate_to', 'Navigate safely');
  if (/\b(inspect|observe|look|check)\b.*\b(room|location|area|surroundings?)\b/.test(lower))
    add('inspect_room', 'Inspect surroundings');
  if (/\b(find|discover|locate)\b.*\b(npc|non[- ]player|townsperson|villager)\b/.test(lower))
    add('inspect_room', 'Discover visible NPCs');
  if (/\b(npc|non[- ]player|townsperson|villager)\b/.test(lower))
    add('inspect_npc', 'Inspect a visible NPC');
  if (/\b(recover|health|heal|rest)\b/.test(lower))
    add('recover_health', 'Recover without consuming resources');
  if (/\b(equipment|gear|armor|armour|weapon|wear|dress)\b/.test(lower))
    add('manage_equipment', 'Inspect or manage equipment');
  if (steps.length === 0) return [];
  const order = (step: ObjectiveStep): number => {
    const terms: Record<AiActionName, RegExp> = {
      inspect_inventory: /inventory|backpack|pack/i,
      inspect_character: /character|status|stats?/i,
      navigate_to: /navigate|travel|go to|walk to|explore|destination\s+\d+\/\d+/i,
      inspect_room: /room|location|area|surroundings?/i,
      inspect_npc: /npc|non[- ]player|townsperson|villager/i,
      recover_health: /recover|health|heal|rest/i,
      manage_equipment: /equipment|gear|armor|armour|weapon|wear|dress/i,
      inspect_map: /map/i,
      inspect_combat_result: /combat|fight/i,
      engage_enemy: /engage|enemy/i,
      send_message: /message|communicat|talk|speak/i,
      execute_supported_command: /command|execute|run/i,
      wait: /wait/i
    };
    return lower.search(terms[step.action] ?? /$a/);
  };
  steps.sort((a, b) => order(a) - order(b));
  steps.forEach((step, index) => {
    step.id = `${index + 1}:${step.action}`;
  });
  return steps;
}

export function advanceObjectivePlan(
  plan: ObjectiveStep[],
  action: AiActionName,
  succeeded: boolean
): ObjectiveStep[] {
  const next = plan.map((step) => ({ ...step }));
  // Do not let a provider skip an active prerequisite by completing a later
  // pending step first.
  const active = next.find((step) => step.status === 'active' && step.action === action);
  if (!active) return next;
  active.status = succeeded ? 'completed' : 'blocked';
  const following = succeeded ? next.find((step) => step.status === 'pending') : undefined;
  if (following) following.status = 'active';
  return next;
}

export function objectivePlanComplete(plan: ObjectiveStep[]): boolean {
  return plan.length > 0 && plan.every((step) => step.status === 'completed');
}
