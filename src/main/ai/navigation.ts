import type { ExitEntity } from '../../shared/entities';
import { roomId } from '../../shared/world';

/** Preserve an exact room target stated by the objective over a model shortcut. */
export function objectiveNavigationDestination(objective: string, requested: string): string {
  const address = objective.match(/\b(\d+)\s*\/\s*(\d+)\b/);
  return address === null ? requested.trim() : roomId(Number(address[1]), Number(address[2]));
}

/** Resolve only destinations supported by authoritative room data. */
export function resolveAiNavigationTarget(
  destination: string,
  exits: readonly Pick<ExitEntity, 'direction' | 'targetMap' | 'targetRoom'>[]
): string | null {
  const value = destination.trim();
  const address = value.match(/(?:room\s+)?(\d+)\s*\/\s*(\d+)/i);
  if (address) return roomId(Number(address[1]), Number(address[2]));
  const exit = exits.find((item) => item.direction.toLowerCase() === value.toLowerCase());
  return exit !== undefined && exit.targetMap !== null && exit.targetRoom !== null
    ? roomId(exit.targetMap, exit.targetRoom)
    : null;
}
