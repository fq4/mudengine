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
