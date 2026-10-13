/** Public, provider-neutral contract for optional autonomous gameplay. */
export type AiStatus = 'disabled' | 'paused' | 'budget-paused' | 'idle' | 'thinking' | 'executing' | 'error';
export type AiActionName =
  | 'inspect_character' | 'inspect_room' | 'inspect_inventory' | 'inspect_map'
  | 'navigate_to' | 'engage_enemy' | 'recover_health' | 'inspect_combat_result' | 'send_message'
  | 'manage_equipment' | 'execute_supported_command' | 'wait';

export interface AiObservation {
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

export interface AiDecision {
  objective: string;
  explanation: string;
  action: AiAction;
  done?: boolean;
}

export interface AiMemory { at: number; kind: 'success' | 'failure' | 'note'; text: string; }
export interface AiMemoryRecord { id: string; server: string; character: string; category: 'fact' | 'hypothesis' | 'strategy' | 'social' | 'preference' | 'objective'; text: string; provenance: string; confidence: number; verified: boolean; createdAt: number; updatedAt: number; expiresAt: number | null; pinned: boolean; }
export interface AiApproval { id: string; command: string; reason: string; risk: 'high' | 'unknown'; contextHash: string; createdAt: number; expiresAt: number; status: 'pending' | 'approved' | 'rejected' | 'expired'; }
export interface AiTemporaryGrant { id: string; command: string; createdAt: number; expiresAt: number; remainingUses: number | null; status: 'active' | 'expired' | 'exhausted' | 'revoked'; }
export interface AiUsage { requests: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number; }
export interface AiProvider { decide(observation: AiObservation, objective: string, signal?: AbortSignal): Promise<AiDecision>; usage(): AiUsage; }
export interface AiProviderDiagnostic { ok: boolean; provider: string; model?: string; message: string; at: number; }
export interface AiState {
  enabled: boolean; status: AiStatus; objective: string; objectiveComplete?: boolean; activity: string;
  explanation: string; lastActionResult: string; memories: AiMemory[]; recent: string[]; usage: AiUsage;
  model: string; lastObservationHash?: string; consecutiveFailures: number;
  currentAction?: { name: AiActionName; phase: 'requested' | 'accepted' | 'executing' | 'completed' | 'failed'; message: string } | null;
  pendingApprovals: AiApproval[]; approvalHistory: AiApproval[]; temporaryGrants?: AiTemporaryGrant[];
}
export interface AiSnapshot { state: AiState; observation: AiObservation; }

export const AI_ACTIONS: readonly AiActionName[] = [
  'inspect_character', 'inspect_room', 'inspect_inventory', 'inspect_map',
  'navigate_to', 'engage_enemy', 'recover_health', 'inspect_combat_result', 'send_message',
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
  return { objective: v.objective, explanation: v.explanation, action: { name: a.name as AiActionName, reason: a.reason, args: a.args as Record<string, unknown> | undefined }, done: v.done === true };
}

export function observationHash(observation: AiObservation): string {
  return JSON.stringify(observation);
}
