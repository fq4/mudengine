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
  const safeHostiles = safeCombatHostiles(occupants);
  return uniqueNameMatch(safeHostiles, preferred);
}

/** Summarize why currently visible mobs are excluded, without changing selection. */
export function summarizeCombatCandidates(occupants: readonly RoomOccupant[]): string {
  const mobs = occupants.filter((occupant) => occupant.kind === 'mob');
  if (mobs.length === 0) return 'visible mobs=0; eligible=0';

  const exclusions = new Map<string, number>();
  const exclude = (reason: string, count = 1): void => {
    exclusions.set(reason, (exclusions.get(reason) ?? 0) + count);
  };
  const classifiedHostiles: RoomOccupant[] = [];
  for (const mob of mobs) {
    if (!mob.mob) exclude('realm data unavailable');
    else if (mob.uncertain) exclude('uncertain realm classification');
    else if (mob.charmed) exclude('charmed');
    else if (mob.costly === 'always') exclude('alignment cost');
    else if (mob.disposition !== 'hostile')
      exclude(`disposition ${mob.disposition ?? 'unknown'}`);
    else classifiedHostiles.push(mob);
  }

  const nameCounts = new Map<string, number>();
  for (const mob of classifiedHostiles) {
    const key = mob.name.trim().toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  let ambiguous = 0;
  for (const mob of classifiedHostiles) {
    if ((nameCounts.get(mob.name.trim().toLowerCase()) ?? 0) > 1) ambiguous++;
  }
  if (ambiguous > 0) exclude('ambiguous name', ambiguous);

  const eligible = classifiedHostiles.length - ambiguous;
  const exclusionSummary = [...exclusions]
    .map(([reason, count]) => `${reason}=${count}`)
    .join(', ');
  return `visible mobs=${mobs.length}; eligible=${eligible}${
    exclusionSummary ? `; excluded: ${exclusionSummary}` : ''
  }`;
}

function safeCombatHostiles(occupants: readonly RoomOccupant[]): RoomOccupant[] {
  return occupants.filter(
    (occupant) =>
      occupant.kind === 'mob' &&
      occupant.mob !== undefined &&
      !occupant.uncertain &&
      !occupant.charmed &&
      occupant.costly !== 'always' &&
      occupant.disposition === 'hostile'
  );
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
