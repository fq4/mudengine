/** Public, provider-neutral contract for optional autonomous gameplay. */
export type AiStatus =
  'disabled' | 'paused' | 'budget-paused' | 'idle' | 'thinking' | 'executing' | 'error';
export type AiActionName =
  | 'inspect_character'
  | 'inspect_room'
  | 'inspect_inventory'
  | 'use_item'
  | 'inspect_map'
  | 'inspect_npc'
  | 'navigate_to'
  | 'engage_enemy'
  | 'recover_health'
  | 'inspect_combat_result'
  | 'send_message'
  | 'manage_equipment'
  | 'execute_supported_command'
  | 'wait';

export interface AiObservation {
  character: unknown;
  room: unknown;
  inventory?: unknown;
  memories?: Array<
    Pick<AiMemoryRecord, 'category' | 'text' | 'provenance' | 'confidence' | 'verified'>
  >;
  map?: unknown;
  availableActions: readonly AiActionName[];
  actionPolicies?: Array<{
    name: AiActionName;
    risk: 'safe' | 'routine' | 'high' | 'unknown' | 'prohibited';
    authorization: 'autonomous' | 'ask-first' | 'rejected';
    summary: string;
  }>;
  activityCandidates?: Array<{
    action: AiAction;
    priority: number;
    rationale: string;
  }>;
  event?: string;
  execution?: { action: AiState['currentAction']; lastResult: string; recent: string[] };
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

export interface AiMemory {
  at: number;
  kind: 'success' | 'failure' | 'note';
  text: string;
}
export interface AiMemoryRecord {
  id: string;
  server: string;
  character: string;
  category: 'fact' | 'hypothesis' | 'strategy' | 'social' | 'preference' | 'objective' | 'outcome';
  text: string;
  provenance: string;
  confidence: number;
  verified: boolean;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  pinned: boolean;
}
export interface AiApproval {
  id: string;
  command: string;
  reason: string;
  risk: 'high' | 'unknown';
  contextHash: string;
  target?: string;
  knownFacts?: string[];
  prediction?: string;
  action?: AiAction;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'executed' | 'rejected' | 'expired';
}
export interface AiTemporaryGrant {
  id: string;
  command: string;
  contextHash: string;
  createdAt: number;
  expiresAt: number;
  remainingUses: number | null;
  status: 'active' | 'expired' | 'exhausted' | 'revoked';
}
export interface AiUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}
export interface AiBudgetLimits {
  requestsPerMinute: number;
  requestsPerHour: number;
  sessionCostUsd: number;
  sessionTokens?: number;
}
export interface AiGameplayLimits {
  commands: number;
  movements: number;
  runtimeMs: number;
}
export type AiBudgetProfileName = 'smoke' | 'exploration' | 'adventure' | 'extended';
export interface AiBudgetProfile {
  name: AiBudgetProfileName;
  provider: AiBudgetLimits;
  gameplay: AiGameplayLimits;
}
export interface AiAggregateBudgetSnapshot {
  limits: AiBudgetLimits;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}
export interface AiProvider {
  decide(observation: AiObservation, objective: string, signal?: AbortSignal): Promise<AiDecision>;
  usage(): AiUsage;
}
export interface AiProviderDiagnostic {
  ok: boolean;
  provider: string;
  model?: string;
  message: string;
  at: number;
}
export interface AiState {
  enabled: boolean;
  status: AiStatus;
  objective: string;
  objectiveComplete?: boolean;
  activity: string;
  explanation: string;
  lastActionResult: string;
  memories: AiMemory[];
  recent: string[];
  usage: AiUsage;
  model: string;
  lastObservationHash?: string;
  consecutiveFailures: number;
  budgetResetAt?: number;
  budgetLimits?: AiBudgetLimits;
  budgetProfile?: AiBudgetProfileName;
  currentAction?: {
    name: AiActionName;
    phase: 'requested' | 'accepted' | 'executing' | 'completed' | 'failed' | 'interrupted';
    message: string;
  } | null;
  plan?: Array<{
    id: string;
    action: AiActionName;
    label: string;
    status: 'pending' | 'active' | 'completed' | 'blocked';
    destination?: string;
  }>;
  pendingApprovals: AiApproval[];
  approvalHistory: AiApproval[];
  temporaryGrants?: AiTemporaryGrant[];
}
export interface AiPolicyRule {
  command: string;
  authorization: 'autonomous' | 'ask-first' | 'rejected';
  source: 'global' | 'server' | 'profile';
}
export interface AiSnapshot {
  state: AiState;
  observation: AiObservation;
  policy?: AiPolicyRule[];
  aggregateBudget?: AiAggregateBudgetSnapshot;
}

export const AI_ACTIONS: readonly AiActionName[] = [
  'inspect_character',
  'inspect_room',
  'inspect_inventory',
  'use_item',
  'inspect_map',
  'inspect_npc',
  'navigate_to',
  'engage_enemy',
  'recover_health',
  'inspect_combat_result',
  'send_message',
  'manage_equipment',
  'execute_supported_command',
  'wait'
];

export function validateDecision(value: unknown): AiDecision {
  if (!value || typeof value !== 'object') throw new Error('AI response must be an object');
  const v = value as Record<string, unknown>;
  const action = v.action;
  if (
    typeof v.objective !== 'string' ||
    typeof v.explanation !== 'string' ||
    !action ||
    typeof action !== 'object'
  )
    throw new Error('AI response requires objective, explanation and action');
  const a = action as Record<string, unknown>;
  const aliases: Record<string, AiActionName> = {
    look: 'inspect_room',
    inspect: 'inspect_room'
  };
  const normalizedName = typeof a.name === 'string' ? a.name.trim().toLowerCase() : a.name;
  const actionName =
    typeof normalizedName === 'string'
      ? (aliases[normalizedName] ?? normalizedName)
      : normalizedName;
  if (!AI_ACTIONS.includes(actionName as AiActionName))
    throw new Error(`AI response contains an unsupported action: ${String(a.name)}`);
  const safeInspection = [
    'inspect_character',
    'inspect_room',
    'inspect_inventory',
    'inspect_map',
    'inspect_npc',
    'manage_equipment',
    'wait'
  ].includes(actionName as string);
  const reason =
    typeof a.reason === 'string' && a.reason.trim()
      ? a.reason.trim()
      : safeInspection
        ? `Model requested ${actionName}`
        : null;
  if (reason === null) throw new Error(`AI response is missing a reason for action: ${actionName}`);
  if (a.args !== undefined && (!a.args || typeof a.args !== 'object' || Array.isArray(a.args)))
    throw new Error('AI action args must be an object');
  return {
    objective: v.objective,
    explanation: v.explanation,
    action: {
      name: actionName as AiActionName,
      reason,
      args: a.args as Record<string, unknown> | undefined
    },
    done: v.done === true
  };
}

export function observationHash(observation: AiObservation): string {
  return JSON.stringify(observation);
}
