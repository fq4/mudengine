import type { AiAction, AiActionResult } from '../../shared/ai';
import type { Route } from '../../shared/world';
import type { WorldGraph } from '../world/WorldGraph';
import type { CommandQueue } from '../automation/CommandQueue';
import type { AutoCombat } from '../automation/AutoCombat';
import type { CharacterState } from '../../shared/character';
import type { AiActionName } from '../../shared/ai';
import type { EquipmentManager } from '../automation/EquipmentManager';

export interface GameplayAdapterDeps {
  character: CharacterState;
  world?: WorldGraph;
  queue: CommandQueue;
  combat: AutoCombat;
  traveller: unknown;
  inspect?(action: AiActionName): string | null;
  equipment?: EquipmentManager;
  moving?: boolean;
  walkRoute(route: Route, run?: boolean): string | null;
}

export function executeGameplayAction(action: AiAction, deps: GameplayAdapterDeps): AiActionResult {
  if (['inspect_character', 'inspect_room', 'inspect_inventory', 'inspect_map', 'inspect_combat_result'].includes(action.name)) {
    const detail = deps.inspect?.(action.name);
    return detail === null || detail === undefined
      ? { ok: false, phase: 'failed', message: `Inspection unavailable: ${action.name.replaceAll('_', ' ')}` }
      : { ok: true, phase: 'completed', message: detail };
  }
  if (action.name === 'recover_health') {
    const accepted = deps.queue.enqueue({ command: 'rest', priority: 'emergency', reason: action.reason });
    return { ok: accepted, phase: accepted ? 'accepted' : 'failed', message: accepted ? 'Recovery requested through CommandQueue; awaiting server confirmation' : 'Recovery was refused by CommandQueue' };
  }
  if (action.name === 'manage_equipment') {
    if (!deps.equipment) return { ok: false, phase: 'failed', message: 'Equipment automation is unavailable' };
    deps.equipment.onCharacter(deps.character, deps.moving ?? false);
    return { ok: true, phase: 'accepted', message: 'Equipment strategy delegated to EquipmentManager; awaiting inventory confirmation' };
  }
  if (action.name === 'wait') return { ok: true, phase: 'completed', message: 'Waiting for the next game-state update' };
  if (action.name === 'engage_enemy') {
    const name = typeof action.args?.name === 'string' ? action.args.name : '';
    if (!name || name.startsWith('@')) return { ok: false, message: 'Refused: enemy name is required and PvP is not supported' };
    deps.combat.alsoFight(name); return { ok: true, phase: 'accepted', message: `Combat delegated to AutoCombat for ${name}; awaiting combat state` };
  }
  if (action.name === 'navigate_to') {
    let route = action.args?.route as Route | undefined;
    const destination: unknown = action.args?.destination;
    const match = typeof destination === 'string' ? destination.match(/^(\d+)\/(\d+)$/) : null;
    const here = deps.character.room;
    if (!route && deps.world && here?.map !== null && here?.number !== null) {
      const target = match
        ? `${Number(match[1])}/${Number(match[2])}`
        : typeof destination === 'string'
          ? (() => { const graph = deps.world; if (!graph) return undefined; const room = graph.searchByName(destination, 5).find((entry) => entry.name.toLowerCase() === destination.trim().toLowerCase()) ?? graph.searchByName(destination, 1)[0]; return room ? `${room.map}/${room.room}` : undefined; })()
          : undefined;
      if (target && deps.world) route = deps.world.route(`${here.map}/${here.number}`, target, deps.traveller as never, { alternatives: false });
    }
    if (!route || !Array.isArray(route.steps)) return { ok: false, phase: 'failed', message: 'Refused: navigation requires a validated route' };
    const refusal = deps.walkRoute(route, true); return { ok: refusal === null, phase: refusal === null ? 'accepted' : 'failed', message: refusal ?? 'Navigation accepted by Walker; awaiting verified arrival' };
  }
  if (action.name === 'execute_supported_command') {
    const command = typeof action.args?.command === 'string' ? action.args.command.trim() : '';
    if (!command || /^(kill|attack|hit)\s+@/i.test(command)) return { ok: false, phase: 'failed', message: 'Refused unsupported or PvP command' };
    const accepted = deps.queue.enqueue({ command, priority: 'user', reason: action.reason }); return { ok: accepted, phase: accepted ? 'accepted' : 'failed', message: accepted ? 'Command accepted by CommandQueue; awaiting parsed result' : 'Command was refused by CommandQueue' };
  }
  return { ok: false, phase: 'failed', message: `Action ${action.name} requires a route or deterministic adapter` };
}
