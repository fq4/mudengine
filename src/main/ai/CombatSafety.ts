import type { Room, RoomOccupant, Vitals } from '../../shared/character';
import { findSafeCombatNpc } from './NpcDiscovery';

export interface CombatEligibility {
  ok: boolean;
  reason: string;
  target: RoomOccupant | null;
}

export function hasMappedCombatEscape(room: Pick<Room, 'exits'> | null | undefined): boolean {
  return (
    room?.exits.some(
      (exit) => exit.targetMap !== null && exit.targetRoom !== null && exit.requirement === null
    ) ?? false
  );
}

/** Bounded PvE preflight; direct attacker evidence may resolve disposition, never identity. */
export function assessCombatEligibility(
  occupants: readonly RoomOccupant[],
  vitals: Pick<Vitals, 'hp' | 'hpMax'>,
  preferred?: string,
  minimumFraction = 0.6,
  escapeAvailable = true,
  verifiedAttackers: readonly string[] = []
): CombatEligibility {
  const target = findSafeCombatNpc(occupants, preferred, verifiedAttackers);
  if (!target)
    return {
      ok: false,
      reason: 'no uniquely identified eligible realm mob is visible or attacking',
      target
    };
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
