import type { RoomOccupant } from '../../shared/character';
import { mobKey } from '../../shared/world';

/** Select only an authoritative, non-player NPC from the current room. */
export function findSafeNpc(
  occupants: readonly RoomOccupant[],
  preferred?: string
): RoomOccupant | null {
  const safeNpcs = occupants.filter((occupant) => occupant.npc && occupant.kind !== 'player');
  return uniqueNameMatch(safeNpcs, preferred);
}

/**
 * Select a conservative PvE target from authoritative room data. A uniquely
 * identified realm mob that has attacked this character is also eligible even
 * when its realm rows disagree about disposition. Unknown occupants, players,
 * charmed creatures, alignment-costly monsters, and ambiguous names stay out.
 */
export function findSafeCombatNpc(
  occupants: readonly RoomOccupant[],
  preferred?: string,
  verifiedAttackers: readonly string[] = []
): RoomOccupant | null {
  const safeHostiles = safeCombatHostiles(occupants);
  const attackerHostiles = verifiedAttackerHostiles(occupants, verifiedAttackers);
  const candidates = [...safeHostiles, ...attackerHostiles].filter(
    (occupant, index, all) => all.indexOf(occupant) === index
  );
  const requested = preferred === undefined ? undefined : mobKey(preferred);
  return (
    candidates.find((candidate) => {
      const key = mobKey(candidate.name);
      return (
        (requested === undefined || requested === key) &&
        candidates.filter((item) => mobKey(item.name) === key).length === 1 &&
        occupants.filter((item) => mobKey(item.name) === key).length === 1
      );
    }) ?? null
  );
}

/** Summarize why currently visible mobs are excluded, without changing selection. */
export function summarizeCombatCandidates(
  occupants: readonly RoomOccupant[],
  verifiedAttackers: readonly string[] = []
): string {
  const mobs = occupants.filter((occupant) => occupant.kind === 'mob');
  if (mobs.length === 0) return 'visible mobs=0; eligible=0';

  const exclusions = new Map<string, number>();
  const attackEvidence = new Set(
    verifiedAttackerHostiles(occupants, verifiedAttackers).map((occupant) => mobKey(occupant.name))
  );
  let attackerEvidenceCount = 0;
  const exclude = (reason: string, count = 1): void => {
    exclusions.set(reason, (exclusions.get(reason) ?? 0) + count);
  };
  const classifiedHostiles: RoomOccupant[] = [];
  for (const mob of mobs) {
    const verifiedAttacker = attackEvidence.has(mobKey(mob.name));
    if (!mob.mob) exclude('realm data unavailable');
    else if (mob.charmed) exclude('charmed');
    else if (mob.costly === 'always') exclude('alignment cost');
    else if (!verifiedAttacker && mob.uncertain) exclude('uncertain realm classification');
    else if (!verifiedAttacker && mob.disposition !== 'hostile')
      exclude(`disposition ${mob.disposition ?? 'unknown'}`);
    else {
      classifiedHostiles.push(mob);
      if (verifiedAttacker) attackerEvidenceCount += 1;
    }
  }

  const ambiguous = classifiedHostiles.filter((mob) => {
    const key = mobKey(mob.name);
    return (
      classifiedHostiles.filter((candidate) => mobKey(candidate.name) === key).length > 1 ||
      occupants.filter((candidate) => mobKey(candidate.name) === key).length > 1
    );
  }).length;
  if (ambiguous > 0) exclude('ambiguous name', ambiguous);

  const eligible = classifiedHostiles.length - ambiguous;
  const exclusionSummary = [...exclusions]
    .map(([reason, count]) => `${reason}=${count}`)
    .join(', ');
  return `visible mobs=${mobs.length}; eligible=${eligible}${
    exclusionSummary ? `; excluded: ${exclusionSummary}` : ''
  }${attackerEvidenceCount > 0 ? `; verified attacker evidence=${attackerEvidenceCount}` : ''}`;
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

function verifiedAttackerHostiles(
  occupants: readonly RoomOccupant[],
  attackers: readonly string[]
): RoomOccupant[] {
  const attackerKeys = new Set(attackers.map(mobKey));
  if (attackerKeys.size === 0) return [];

  return occupants.filter((occupant) => {
    const key = mobKey(occupant.name);
    if (
      !attackerKeys.has(key) ||
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

    // A combat log name is evidence only when it identifies one visible room
    // occupant, with no player or unknown occupant sharing that name.
    return occupants.filter((candidate) => mobKey(candidate.name) === key).length === 1;
  });
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
