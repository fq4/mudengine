export const ITEM_USE_OBJECTIVE_PATTERN =
  /\b(?:consume|drink|eat|quaff)\b|\buse\b[^.!?\r\n]{0,60}\b(?:item|potion|scroll|food|drink|elixir|tonic|herb|ration|consumable)s?\b/i;

const NPC_SEARCH_OBJECTIVE_PATTERN =
  /\b(?:find|discover|locate|search for)\b[^.!?\r\n]{0,80}\b(?:npc|non[- ]player|townsperson|villager)\b/i;
const COMBAT_OBJECTIVE_PATTERN = /\b(?:fight|combat|attack|engage|hunt|enemy)\b/i;
const COMBAT_NEGATION_PATTERN =
  /\b(?:do not|don't|without|never)\b[^.!?\r\n]{0,40}\b(?:fight|combat|attack)\b/i;
const OPTIONAL_COMBAT_PATTERN =
  /\b(?:fight|combat|attack|engage|hunt)\b[^.!?\r\n]{0,80}\b(?:if|when)\b[^.!?\r\n]{0,40}\b(?:available|present|visible)\b|\b(?:if|when)\b[^.!?\r\n]{0,40}\b(?:available|present|visible)\b[^.!?\r\n]{0,80}\b(?:fight|combat|attack|engage|hunt)\b/i;
const UNSUPPORTED_OBJECTIVE_PATTERN =
  /\b(?:buy|purchase|sell|trade|craft|gather|collect|deliver|claim|cast|teleport|train|loot|unlock)\b|\b(?:complete|finish|start|accept|abandon|turn in)\b[^.!?\r\n]{0,40}\b(?:quest|mission|contract)\b/i;

export function objectiveRequestsItemUse(objective: string): boolean {
  return ITEM_USE_OBJECTIVE_PATTERN.test(objective);
}

export function objectiveRequestsNpcSearch(objective: string): boolean {
  return NPC_SEARCH_OBJECTIVE_PATTERN.test(objective);
}

export function objectiveRequestsCombat(objective: string): boolean {
  return COMBAT_OBJECTIVE_PATTERN.test(objective) && !COMBAT_NEGATION_PATTERN.test(objective);
}

export function objectiveCombatIsOptional(objective: string): boolean {
  return objectiveRequestsCombat(objective) && OPTIONAL_COMBAT_PATTERN.test(objective);
}

export function hasUnsupportedObjectiveIntent(objective: string): boolean {
  return UNSUPPORTED_OBJECTIVE_PATTERN.test(objective);
}
