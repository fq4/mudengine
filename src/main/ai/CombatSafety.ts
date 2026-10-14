import type { Vitals } from '../../shared/character';
import type { RoomOccupant } from '../../shared/character';
import { findSafeCombatNpc } from './NpcDiscovery';

export interface CombatEligibility {
  ok: boolean;
  reason: string;
  target: RoomOccupant | null;
}

/** Conservative preflight for bounded AI PvE. Unknown health is never treated as full health. */
export function assessCombatEligibility(
  occupants: readonly RoomOccupant[],
  vitals: Pick<Vitals, 'hp' | 'hpMax'>,
  preferred?: string,
  minimumFraction = 0.6,
  escapeAvailable = true
): CombatEligibility {
  const target = findSafeCombatNpc(occupants, preferred);
  if (!target)
    return { ok: false, reason: 'no authoritative conservative hostile NPC is visible', target };
  if (vitals.hp === null || vitals.hpMax === null || vitals.hpMax <= 0)
    return { ok: false, reason: 'character health is not authoritative', target };
  if (vitals.hp / vitals.hpMax < minimumFraction)
    return {
      ok: false,
      reason: 'character health is below the conservative combat threshold',
      target
    };
  if (!escapeAvailable)
    return {
      ok: false,
      reason: 'no authoritative escape route is available from the room',
      target
    };
  return {
    ok: true,
    reason: 'authoritative target and health are within bounded PvE limits',
    target
  };
}
