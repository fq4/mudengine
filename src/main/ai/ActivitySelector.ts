import type { CharacterState } from '../../shared/character';
import type { AiAction, AiActionName } from '../../shared/ai';
import { DEFAULT_CONFIG } from '../../shared/config';
import { findSafeCombatNpc } from './NpcDiscovery';
import {
  objectiveCombatIsOptional,
  objectiveRequestsCombat,
  objectiveRequestsGossipReply,
  objectiveRequestsNpcSearch
} from './objectiveIntents';

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
  frontiers: ReadonlyArray<{ destination: string; steps: number }>;
}

export function reachableExplorationFrontiers(
  currentRoom: string,
  observedExits: ReadonlyArray<{ room: string; exits: ReadonlyArray<{ to: string }> }>,
  visitedRooms: readonly string[],
  deadEnds: readonly string[],
  routeSteps: (destination: string) => number | null
): Array<{ destination: string; steps: number }> {
  const maxRouteChecks = 32;
  const visited = new Set(visitedRooms);
  const dead = new Set(deadEnds);
  const destinations = new Set<string>();
  for (const observation of [...observedExits].reverse()) {
    for (const exit of observation.exits) {
      if (exit.to !== currentRoom && !visited.has(exit.to) && !dead.has(exit.to))
        destinations.add(exit.to);
    }
  }
  const reachable: Array<{ destination: string; steps: number }> = [];
  for (const destination of [...destinations].slice(0, maxRouteChecks)) {
    const steps = routeSteps(destination);
    if (steps !== null && Number.isInteger(steps) && steps > 0)
      reachable.push({ destination, steps });
  }
  return reachable.sort(
    (a, b) => a.steps - b.steps || a.destination.localeCompare(b.destination)
  );
}

export function summarizeWorldState(state: CharacterState, goal = ''): string {
  const hp = state.vitals.hp;
  const hpMax = state.vitals.hpMax;
  const exits = state.room.exits.filter(
    ({ targetMap, targetRoom, requirement }) =>
      targetMap !== null && targetRoom !== null && requirement === null
  );
  const hostile = findSafeCombatNpc(
    state.room.occupants,
    undefined,
    state.combat.attackers
  );
  const parts = [
    hp !== null && hpMax !== null ? `HP ${hp}/${hpMax}` : 'HP unknown',
    exits.length > 0 ? `${exits.length} valid exits` : 'no valid exits',
    hostile ? 'suitable hostile target available' : 'no suitable hostile target',
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
  exploration?: ExplorationContext,
  gossipReplyAvailable = false,
  recoveryThreshold = DEFAULT_CONFIG.automation.health.restBelow
): ActivitySelection {
  const candidates: ActivityCandidate[] = [];
  const lower = goal.toLowerCase();
  const summary = summarizeWorldState(state, goal);
  const explorationRequested = /\bexplore\b/.test(lower);
  const npcSearchRequested = objectiveRequestsNpcSearch(goal);
  const combatRequested = objectiveRequestsCombat(goal);
  const optionalCombat = objectiveCombatIsOptional(goal);
  const hp = state.vitals.hp;
  const hpMax = state.vitals.hpMax;
  const healthRatio = hp !== null && hpMax !== null && hpMax > 0 ? hp / hpMax : null;
  if (healthRatio !== null && healthRatio < recoveryThreshold) {
    candidates.push({
      action: { name: 'recover_health', reason: 'Authoritative HP is below the recovery threshold' },
      priority: 100,
      rationale: `recovery is required below the configured ${Math.round(
        recoveryThreshold * 100
      )}% threshold before other risky activities (${summary})`
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
  if (gossipReplyAvailable && objectiveRequestsGossipReply(goal)) {
    candidates.push({
      action: {
        name: 'send_message',
        args: { channel: 'gossip' },
        reason: 'Reply briefly to the inbound gossip event using only its content'
      },
      priority: 85,
      rationale: `a recent inbound gossip message matches the requested reply objective (${summary})`
    });
  }
  if (/explore|room|area|surroundings|look|observe|assess/.test(lower))
    candidates.push(
      observe('inspect_room', 60, `the player goal requests current surroundings (${summary})`)
    );
  if (explorationRequested || npcSearchRequested || (combatRequested && !optionalCombat)) {
    const currentRoom =
      state.room.map !== null && state.room.number !== null
        ? `${state.room.map}/${state.room.number}`
        : null;
    const visited = new Set(exploration?.visitedRooms ?? []);
    const exits = state.room.exits.filter(
      ({ targetMap, targetRoom, requirement }) =>
        targetMap !== null && targetRoom !== null && requirement === null
    );
    const destinations = new Set<string>();
    const addNavigation = (
      destination: string,
      steps: number,
      priorityBase = explorationRequested ? 70 : 35
    ): void => {
      if (destinations.has(destination)) return;
      destinations.add(destination);
      const failures =
        currentRoom === null
          ? 0
          : exploration?.routeOutcomes.find(
              ({ from, to }) => from === currentRoom && to === destination
            )?.failures ?? 0;
      const purpose = explorationRequested
        ? 'exploration'
        : npcSearchRequested
          ? 'NPC discovery'
          : 'finding a suitable combat target';
      candidates.push({
        action: {
          name: 'navigate_to',
          args: { destination },
          reason: 'Authoritative room exits support Walker-owned frontier navigation'
        },
        priority: Math.max(
          10,
          priorityBase - Math.min(40, Math.max(0, steps - 1) * 2) - failures * 5
        ),
        rationale: `${purpose} can delegate a reachable unvisited frontier to Walker (${summary})`
      });
    };
    for (const exit of exits) {
      if (exit.targetMap === null || exit.targetRoom === null) continue;
      const destination = `${exit.targetMap}/${exit.targetRoom}`;
      if (!visited.has(destination) && !exploration?.deadEnds.includes(destination))
        addNavigation(destination, 1);
    }
    for (const frontier of exploration?.frontiers.slice(0, 5) ?? []) {
      if (!visited.has(frontier.destination) && !exploration?.deadEnds.includes(frontier.destination))
        addNavigation(frontier.destination, frontier.steps);
    }
  }
  if (!goal.trim())
    candidates.push(
      observe('inspect_room', 10, `observe the current room before choosing further work (${summary})`)
    );
  const mob = findSafeCombatNpc(
    state.room.occupants,
    undefined,
    state.combat.attackers
  );
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
