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

export interface ExplorationContext {
  visitedRooms: readonly string[];
  deadEnds: readonly string[];
  routeOutcomes: ReadonlyArray<{
    from: string;
    to: string;
    failures: number;
  }>;
}

export function summarizeWorldState(state: CharacterState, goal = ''): string {
  const hp = state.vitals.hp;
  const hpMax = state.vitals.hpMax;
  const exits = state.room.exits.filter(
    ({ targetMap, targetRoom, requirement }) =>
      targetMap !== null && targetRoom !== null && requirement === null
  );
  const hostile = state.room.occupants.filter(
    (occupant) => occupant.kind === 'mob' && occupant.mob && !occupant.charmed && !occupant.uncertain
  );
  const parts = [
    hp !== null && hpMax !== null ? `HP ${hp}/${hpMax}` : 'HP unknown',
    exits.length > 0 ? `${exits.length} valid exits` : 'no valid exits',
    hostile.length > 0 ? `${hostile.length} hostile target${hostile.length === 1 ? '' : 's'}` : 'no hostile target',
    goal.trim() ? `goal: ${goal.trim()}` : 'no explicit goal'
  ];
  return parts.join(' | ');
}

/**
 * Selects from already-authorized activities using authoritative state. This
 * is deliberately a small decision layer: execution remains owned by the
 * production adapters and the provider never receives arbitrary commands.
 */
export function selectActivity(
  state: CharacterState,
  goal = '',
  exploration?: ExplorationContext
): ActivitySelection {
  const candidates: ActivityCandidate[] = [];
  const lower = goal.toLowerCase();
  const summary = summarizeWorldState(state, goal);
  const hp = state.vitals.hp;
  const hpMax = state.vitals.hpMax;
  const healthRatio = hp !== null && hpMax !== null && hpMax > 0 ? hp / hpMax : null;
  if (healthRatio !== null && healthRatio < 0.5) {
    candidates.push({
      action: { name: 'recover_health', reason: 'Authoritative HP is below the recovery threshold' },
      priority: 100,
      rationale: `recovery is required before other risky activities (${summary})`
    });
  }
  if (/inventory|pack|backpack/.test(lower))
    candidates.push(
      observe('inspect_inventory', 80, `the player goal requests inventory state (${summary})`)
    );
  if (/equipment|gear|armor|armour|weapon/.test(lower))
    candidates.push(
      observe(
        'manage_equipment',
        70,
        `the player goal requests equipment evaluation (${summary})`
      )
    );
  if (/explore|room|area|surroundings|look|observe|assess/.test(lower))
    candidates.push(
      observe('inspect_room', 60, `the player goal requests current surroundings (${summary})`)
    );
  if (/\bexplore\b/.test(lower)) {
    const currentRoom =
      state.room.map !== null && state.room.number !== null
        ? `${state.room.map}/${state.room.number}`
        : null;
    const visited = new Set(exploration?.visitedRooms ?? []);
    const exits = state.room.exits.filter(
      ({ targetMap, targetRoom, requirement }) =>
        targetMap !== null && targetRoom !== null && requirement === null
    );
    const exit = exits
      .filter(
        ({ targetMap, targetRoom }) =>
          !visited.has(`${targetMap}/${targetRoom}`) &&
          !exploration?.deadEnds.includes(`${targetMap}/${targetRoom}`)
      )
      .sort((a, b) => {
        const failures = (targetMap: number | null, targetRoom: number | null): number =>
          currentRoom === null || targetMap === null || targetRoom === null
            ? 0
            : exploration?.routeOutcomes.find(
                ({ from, to }) => from === currentRoom && to === `${targetMap}/${targetRoom}`
              )?.failures ?? 0;
        return (
          failures(a.targetMap, a.targetRoom) - failures(b.targetMap, b.targetRoom) ||
          a.direction.localeCompare(b.direction)
        );
      })[0];
    if (exit) {
      const destination = `${exit.targetMap}/${exit.targetRoom}`;
      const failures =
        currentRoom === null
          ? 0
          : exploration?.routeOutcomes.find(
              ({ from, to }) => from === currentRoom && to === destination
            )?.failures ?? 0;
      candidates.push({
        action: {
          name: 'navigate_to',
          args: { destination },
          reason: 'An authoritative available exit supports bounded exploration'
        },
        priority: Math.max(70 - failures * 5, 20),
        rationale: `exploration can safely delegate one valid exit to Walker (${summary})`
      });
    }
  }
  if (!goal.trim())
    candidates.push(
      observe('inspect_room', 10, `observe the current room before choosing further work (${summary})`)
    );
  const mob = state.room.occupants.find(
    (occupant) =>
      occupant.kind === 'mob' && occupant.mob && !occupant.charmed && !occupant.uncertain
  );
  const combatRequested =
    /fight|combat|hunt|enemy/.test(lower) &&
    !/(?:do not|don't|without|never)[^.!?]{0,40}\b(?:fight|combat|attack)\b/.test(lower);
  if (combatRequested && mob)
    candidates.push({
      action: {
        name: 'engage_enemy',
        args: { name: mob.name },
        reason: 'Verified mob matches the player goal'
      },
      priority: 50,
      rationale: `a classified mob is available and the world-state summary supports combat (${summary})`
    });
  candidates.sort((a, b) => b.priority - a.priority);
  return { candidate: candidates[0] ?? null, considered: candidates };
}

function observe(name: AiActionName, priority: number, rationale: string): ActivityCandidate {
  return { action: { name, reason: rationale }, priority, rationale };
}
