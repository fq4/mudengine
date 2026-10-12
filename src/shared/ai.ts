import type { CharacterState, RoomOccupant } from './character';

export interface AiKnown<T> { value: T | null; observedAt: number | null; }
export interface AiCharacterView {
  phase: CharacterState['phase']; realm: CharacterState['realm']; name: string | null;
  race: string | null; className: string | null;
  vitals: { hp: AiKnown<number>; hpMax: AiKnown<number>; mana: AiKnown<number>; manaMax: AiKnown<number>; manaType: CharacterState['vitals']['manaType']; resting: boolean; meditating: boolean };
  progress: { level: AiKnown<number>; exp: AiKnown<number>; expNeeded: AiKnown<number>; lives: AiKnown<number> };
  conditions: { inCombat: boolean; mortallyWounded: boolean; afflictions: CharacterState['afflictions']; buffs: Array<{ spell: string; appliedAt: number; expiresAt: number | null }> };
  inventory: { knownAt: number | null; items: Array<{ name: string; quantity: number | null; equipped: boolean; slot: string | null }>; wealth: AiKnown<number>; encumbrance: AiKnown<number>; encumbranceMax: AiKnown<number>; keys: string[] };
  abilities: { spellsKnownAt: number | null; spells: Array<{ name: string; short: string | null; level: number | null; cost: number | null }>; abilitiesKnownAt: number | null };
}
export interface AiRoomView {
  knownAt: number | null; map: number | null; number: number | null; name: string | null;
  description: string | null; light: string | null;
  exits: Array<{ direction: string; destination: { map: number; room: number } | null; note: string | null }>;
  occupants: Array<Pick<RoomOccupant, 'name' | 'kind' | 'disposition' | 'uncertain' | 'charmed' | 'hidden'>>;
  items: Array<{ name: string; quantity: number | null }>;
}
export interface AiNavigationView { status: string; destination: string | null; destinationRoom: { map: number; room: number } | null; done: number; total: number; ahead: string[]; reason: string | null; hold: string | null; }
export interface AiStateView { capturedAt: number; character: AiCharacterView; room: AiRoomView; navigation: AiNavigationView; event: string | null; }

/** Public, provider-neutral contract for optional autonomous gameplay. */
export type AiStatus = 'disabled' | 'paused' | 'idle' | 'thinking' | 'executing' | 'error';
export type AiActionName =
  | 'inspect_character' | 'inspect_room' | 'inspect_inventory' | 'inspect_map'
  | 'navigate_to' | 'engage_enemy' | 'recover_health' | 'inspect_combat_result'
  | 'manage_equipment' | 'execute_supported_command' | 'wait';

export interface AiObservation {
  state?: AiStateView;
  character: unknown;
  room: unknown;
  inventory?: unknown;
  map?: unknown;
  availableActions: readonly AiActionName[];
  event?: string;
}

export interface AiAction {
  name: AiActionName;
  args?: Record<string, unknown>;
  reason: string;
}
export type AiActionPhase = 'requested' | 'accepted' | 'executing' | 'completed' | 'failed' | 'timed_out' | 'interrupted';
export interface AiActionResult { ok: boolean; message: string; phase?: AiActionPhase; }

export interface AiDecision {
  objective: string;
  explanation: string;
  action: AiAction;
  done?: boolean;
  subgoal?: string;
  plan?: string[];
}

export interface AiMemory { at: number; kind: 'success' | 'failure' | 'note'; text: string; }
export interface AiUsage { requests: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number; }
export interface AiProvider { decide(observation: AiObservation, objective: string, signal?: AbortSignal): Promise<AiDecision>; usage(): AiUsage; }
export interface AiState {
  enabled: boolean; status: AiStatus; objective: string; subgoal: string; plan: string[]; activity: string;
  explanation: string; lastActionResult: string; memories: AiMemory[]; recent: string[]; usage: AiUsage;
  model: string; currentAction: { name: AiActionName; phase: AiActionPhase; at: number; message: string } | null; lastObservationHash?: string; consecutiveFailures: number;
  knowledge: Array<{ at: number; topic: string; fact: string }>;
}
export interface AiSnapshot { state: AiState; observation: AiObservation; }
export interface AiPersistedState { objective: string; memories: AiMemory[]; recent: string[]; lastActionResult: string; subgoal?: string; plan?: string[]; knowledge?: Array<{ at: number; topic: string; fact: string }>; }

export const AI_ACTIONS: readonly AiActionName[] = [
  'inspect_character', 'inspect_room', 'inspect_inventory', 'inspect_map',
  'navigate_to', 'engage_enemy', 'recover_health', 'inspect_combat_result',
  'manage_equipment', 'execute_supported_command', 'wait'
];

export function validateDecision(value: unknown): AiDecision {
  if (!value || typeof value !== 'object') throw new Error('AI response must be an object');
  const v = value as Record<string, unknown>;
  const action = v.action;
  if (typeof v.objective !== 'string' || typeof v.explanation !== 'string' || !action || typeof action !== 'object')
    throw new Error('AI response requires objective, explanation and action');
  const a = action as Record<string, unknown>;
  if (!AI_ACTIONS.includes(a.name as AiActionName) || typeof a.reason !== 'string')
    throw new Error('AI response contains an unsupported action');
  if (a.args !== undefined && (!a.args || typeof a.args !== 'object' || Array.isArray(a.args)))
    throw new Error('AI action args must be an object');
  return { objective: v.objective, explanation: v.explanation, action: { name: a.name as AiActionName, reason: a.reason, args: a.args as Record<string, unknown> | undefined }, done: v.done === true, subgoal: typeof v.subgoal === 'string' ? v.subgoal : undefined, plan: Array.isArray(v.plan) && v.plan.every((item) => typeof item === 'string') ? v.plan.slice(0, 8) as string[] : undefined };
}

export function observationHash(observation: AiObservation): string {
  return JSON.stringify(observation);
}
