import type { RoomOccupant } from '../../shared/character';

/** Select only an authoritative, non-player NPC from the current room. */
export function findSafeNpc(
  occupants: readonly RoomOccupant[],
  preferred?: string
): RoomOccupant | null {
  const safeNpcs = occupants.filter((occupant) => occupant.npc && occupant.kind !== 'player');
  return uniqueNameMatch(safeNpcs, preferred);
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
  const safeHostiles = occupants.filter((occupant) => {
    if (
      occupant.kind !== 'mob' ||
      !occupant.mob ||
      occupant.uncertain ||
      occupant.charmed
    )
      return false;
    return occupant.costly !== 'always' && occupant.disposition === 'hostile';
  });
  return uniqueNameMatch(safeHostiles, preferred);
}

function uniqueNameMatch<T extends { name: string }>(
  candidates: readonly T[],
  preferred?: string
): T | null {
  const requested = preferred?.trim().toLowerCase();
  return (
    candidates.find((candidate) => {
      const name = candidate.name.trim().toLowerCase();
      if (requested !== undefined && name !== requested) return false;
      return candidates.filter((item) => item.name.trim().toLowerCase() === name).length === 1;
    }) ?? null
  );
}
