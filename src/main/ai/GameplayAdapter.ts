import type { AiAction } from '../../shared/ai';
import type { Route } from '../../shared/world';
import type { WorldGraph } from '../world/WorldGraph';
import type { CommandQueue } from '../automation/CommandQueue';
import type { AutoCombat } from '../automation/AutoCombat';
import type { CharacterState } from '../../shared/character';

export interface GameplayAdapterDeps {
  character: CharacterState;
  world?: WorldGraph;
  queue: CommandQueue;
  combat: AutoCombat;
  traveller: unknown;
  walkRoute(route: Route, run?: boolean): string | null;
}

export function executeGameplayAction(action: AiAction, deps: GameplayAdapterDeps): { ok: boolean; message: string } {
  if (['inspect_character', 'inspect_room', 'inspect_inventory', 'inspect_map', 'inspect_combat_result'].includes(action.name))
    return { ok: true, message: `Observed ${action.name.replaceAll('_', ' ')}` };
  if (action.name === 'recover_health')
    return { ok: deps.queue.enqueue({ command: 'rest', priority: 'emergency', reason: action.reason }), message: 'Recovery delegated to CommandQueue' };
  if (action.name === 'engage_enemy') {
    const name = typeof action.args?.name === 'string' ? action.args.name : '';
    if (!name || name.startsWith('@')) return { ok: false, message: 'Refused: enemy name is required and PvP is not supported' };
    deps.combat.alsoFight(name); return { ok: true, message: `Combat delegated to AutoCombat for ${name}` };
  }
  if (action.name === 'navigate_to') {
    let route = action.args?.route as Route | undefined;
    const destination = action.args?.destination;
    const match = typeof destination === 'string' ? destination.match(/^(\d+)\/(\d+)$/) : null;
    const here = deps.character.room;
    if (!route && match && deps.world && here?.map !== null && here?.number !== null)
      route = deps.world.route(`${here.map}/${here.number}`, `${Number(match[1])}/${Number(match[2])}`, deps.traveller as never, { alternatives: false });
    if (!route || !Array.isArray(route.steps)) return { ok: false, message: 'Refused: navigation requires a validated route' };
    const refusal = deps.walkRoute(route, true); return { ok: refusal === null, message: refusal ?? 'Navigation delegated to Walker' };
  }
  if (action.name === 'execute_supported_command') {
    const command = typeof action.args?.command === 'string' ? action.args.command.trim() : '';
    if (!command || /^(kill|attack|hit)\s+@/i.test(command)) return { ok: false, message: 'Refused unsupported or PvP command' };
    return { ok: deps.queue.enqueue({ command, priority: 'user', reason: action.reason }), message: 'Command delegated to CommandQueue' };
  }
  return { ok: false, message: `Action ${action.name} requires a route or deterministic adapter` };
}
