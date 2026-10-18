import type { RoomOccupant } from './character';
import { mobKey } from './world';

export function isAuthoritativeHostileMob(occupant: RoomOccupant): boolean {
  return (
    occupant.kind === 'mob' &&
    occupant.mob !== undefined &&
    !occupant.uncertain &&
    !occupant.charmed &&
    !occupant.mob.charmed &&
    occupant.costly !== 'always' &&
    occupant.mob.costly !== 'always' &&
    occupant.disposition === 'hostile'
  );
}

export function isVerifiedAttackingMob(
  occupants: readonly RoomOccupant[],
  occupant: RoomOccupant,
  attackers: readonly string[]
): boolean {
  const key = mobKey(occupant.name);
  if (
    !key ||
    !attackers.some((attacker) => mobKey(attacker) === key) ||
    occupant.kind !== 'mob' ||
    occupant.mob?.source !== 'hybrid' ||
    occupant.mob.disposition === null ||
    occupant.charmed ||
    occupant.mob.charmed ||
    occupant.costly === 'always' ||
    occupant.mob.costly === 'always'
  ) {
    return false;
  }

  return occupants.filter((candidate) => mobKey(candidate.name) === key).length === 1;
}
