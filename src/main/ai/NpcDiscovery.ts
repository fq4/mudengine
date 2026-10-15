import type { RoomOccupant } from '../../shared/character';

/** Select only an authoritative, non-player NPC from the current room. */
export function findSafeNpc(
  occupants: readonly RoomOccupant[],
  preferred?: string
): RoomOccupant | null {
  const requested = preferred?.trim().toLowerCase();
  return (
    occupants.find((occupant) => {
      if (!occupant.npc || occupant.kind === 'player') return false;
      return requested === undefined || occupant.name.toLowerCase() === requested;
    }) ?? null
  );
}

/**
 * Select a conservative PvE target from authoritative room data. Unknown
 * occupants, players, charmed creatures, alignment-costly monsters, and
 * non-hostile dispositions are excluded rather than guessed safe.
 */
export function findSafeCombatNpc(
  occupants: readonly RoomOccupant[],
  preferred?: string
): RoomOccupant | null {
  const requested = preferred?.trim().toLowerCase();
  return (
    occupants.find((occupant) => {
      if (
        occupant.kind !== 'mob' ||
        !occupant.mob ||
        occupant.uncertain ||
        occupant.charmed
      )
        return false;
      if (occupant.costly === 'always' || occupant.disposition !== 'hostile') return false;
      return requested === undefined || occupant.name.toLowerCase() === requested;
    }) ?? null
  );
}
