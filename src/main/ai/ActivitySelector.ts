import type { CharacterState } from '../../shared/character';
import type { AiAction, AiActionName } from '../../shared/ai';

export interface ActivityCandidate {
  action: AiAction;
  priority: number;
  rationale: string;
}

export interface ActivitySelection {
  candidate: ActivityCandidate | null;
  considered: ActivityCandidate[];
}

/**
 * Selects from already-authorized activities using authoritative state. This
 * is deliberately a small decision layer: execution remains owned by the
 * production adapters and the provider never receives arbitrary commands.
 */
export function selectActivity(state: CharacterState, goal = ''): ActivitySelection {
  const candidates: ActivityCandidate[] = [];
  const lower = goal.toLowerCase();
  const hp = state.vitals.hp;
  const hpMax = state.vitals.hpMax;
  if (hp !== null && hpMax !== null && hp < hpMax) {
    candidates.push({
      action: { name: 'recover_health', reason: 'Authoritative HP is below maximum' },
      priority: 100,
      rationale: 'recovery is required before other risky activities'
    });
  }
  if (/inventory|pack|backpack/.test(lower))
    candidates.push(observe('inspect_inventory', 80, 'the player goal requests inventory state'));
  if (/equipment|gear|armor|armour|weapon/.test(lower))
    candidates.push(
      observe('manage_equipment', 70, 'the player goal requests equipment evaluation')
    );
  if (/explore|room|surroundings|look/.test(lower))
    candidates.push(observe('inspect_room', 60, 'the player goal requests current surroundings'));
  const mob = state.room.occupants.find(
    (occupant) =>
      occupant.kind === 'mob' && occupant.mob && !occupant.charmed && !occupant.uncertain
  );
  if (/fight|combat|hunt|enemy/.test(lower) && mob)
    candidates.push({
      action: {
        name: 'engage_enemy',
        args: { name: mob.name },
        reason: 'Verified mob matches the player goal'
      },
      priority: 50,
      rationale: 'a classified mob is available; combat safety is enforced by the executor'
    });
  candidates.sort((a, b) => b.priority - a.priority);
  return { candidate: candidates[0] ?? null, considered: candidates };
}

function observe(name: AiActionName, priority: number, rationale: string): ActivityCandidate {
  return { action: { name, reason: rationale }, priority, rationale };
}
