export const ITEM_USE_OBJECTIVE_PATTERN =
  /\b(?:consume|drink|eat|quaff)\b|\buse\b[^.!?\r\n]{0,60}\b(?:item|potion|scroll|food|drink|elixir|tonic|herb|ration|consumable)s?\b/i;

export function objectiveRequestsItemUse(objective: string): boolean {
  return ITEM_USE_OBJECTIVE_PATTERN.test(objective);
}
