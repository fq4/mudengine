import type { Combat, Vitals } from '../../shared/character';

export type CombatOutcome = 'active' | 'ended' | 'unsafe' | 'unknown';

/** Classify only authoritative combat/vitals facts; never infer a kill. */
export function combatOutcome(
  combat: Pick<Combat, 'engaged' | 'target'>,
  vitals: Pick<Vitals, 'hp' | 'hpMax'>
): CombatOutcome {
  if (vitals.hp !== null && vitals.hp <= 0) return 'unsafe';
  if (vitals.hp !== null && vitals.hpMax !== null && vitals.hp / vitals.hpMax < 0.3)
    return 'unsafe';
  if (combat.engaged && combat.target !== null) return 'active';
  if (!combat.engaged && combat.target === null) return 'ended';
  return 'unknown';
}
