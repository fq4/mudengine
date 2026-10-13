import { observationHash, type AiAction, type AiActionName, type AiBudgetLimits, type AiDecision, type AiObservation, type AiProvider, type AiState } from '../../shared/ai';
import { AiAggregateBudget, AiBudget } from './Budget';

export interface AiExecutor { execute(action: AiAction): Promise<{ ok: boolean; message: string; pendingApproval?: boolean }>; }
export class AutonomousAgent {
  readonly state: AiState;
  private aborter: AbortController | null = null;
  private ticking = false;
  private delegatedOperationActive: ((action: AiActionName) => boolean) | null = null;
  private delegatedOperationStatus: ((action: AiActionName) => 'active' | 'completed' | 'failed' | null) | null = null;
  private lastFailedAction = '';
  constructor(private readonly provider: AiProvider, private readonly executor: AiExecutor, private readonly budget = new AiBudget(), private readonly aggregateBudget?: AiAggregateBudget, initial?: Partial<AiState>) {
    this.state = { enabled: false, status: 'disabled', objective: '', objectiveComplete: false, activity: '', explanation: '', lastActionResult: '', memories: [], recent: [], usage: provider.usage(), model: 'openrouter', consecutiveFailures: 0, currentAction: null, pendingApprovals: [], approvalHistory: [], budgetLimits: budget.getLimits(), ...initial };
  }
  configureBudget(limits: Partial<AiBudgetLimits>): AiBudgetLimits { const next = this.budget.configure(limits); this.state.budgetLimits = next; return next; }
  enable(objective = this.state.objective): void { this.aborter?.abort(); this.state.lastObservationHash = undefined; this.state.enabled = true; this.state.status = 'idle'; this.state.objective = objective; this.state.objectiveComplete = false; this.state.consecutiveFailures = 0; this.lastFailedAction = ''; }
  pause(): void { this.aborter?.abort(); this.state.status = this.state.enabled ? 'paused' : 'disabled'; }
  stop(): void { this.aborter?.abort(); this.state.enabled = false; this.state.status = 'disabled'; if (this.state.currentAction && ['requested', 'accepted', 'executing'].includes(this.state.currentAction.phase)) this.state.currentAction = { ...this.state.currentAction, phase: 'interrupted', message: 'AI action interrupted' }; }
  setDelegatedOperationActive(check: (action: AiActionName) => boolean): void { this.delegatedOperationActive = check; }
  setDelegatedOperationStatus(check: (action: AiActionName) => 'active' | 'completed' | 'failed' | null): void { this.delegatedOperationStatus = check; }
  approvalResolved(message: string): void {
    if (this.state.status !== 'paused' || this.state.currentAction?.phase !== 'requested') return;
    this.state.status = this.state.enabled ? 'idle' : 'disabled';
    this.state.currentAction = { ...this.state.currentAction, message };
    this.state.lastActionResult = message;
  }
  async tick(observation: AiObservation): Promise<AiDecision | null> {
    if (!this.state.enabled || this.state.status === 'paused' || this.state.objectiveComplete === true || !this.state.objective) return null;
    if (this.ticking) return null;
    const hash = observationHash(observation);
    if (this.state.currentAction?.phase === 'accepted') {
      const delegatedStatus = this.delegatedOperationStatus?.(this.state.currentAction.name) ?? null;
      if (delegatedStatus === 'active' || (delegatedStatus === null && this.delegatedOperationActive?.(this.state.currentAction.name))) return null;
      if (hash === this.state.lastObservationHash) return null;
      if (delegatedStatus === 'failed' || this.isFailureEvent(observation.event)) {
        this.state.currentAction = { ...this.state.currentAction, phase: 'failed', message: `Delegated action failed: ${observation.event}` };
        this.state.lastActionResult = this.state.currentAction.message;
        this.state.consecutiveFailures += 1;
        this.lastFailedAction = this.state.currentAction.name;
      } else {
        this.state.currentAction = { ...this.state.currentAction, phase: 'completed', message: 'Observed a state change after the delegated action' };
        this.state.consecutiveFailures = 0;
        this.lastFailedAction = '';
      }
    }
    if (hash === this.state.lastObservationHash) return null;
    if (this.state.consecutiveFailures >= 2 && this.lastFailedAction) { this.state.status = 'error'; this.state.lastActionResult = 'Repeated action suppressed; change the objective or strategy'; return null; }
    const budget = this.budget.check(this.provider.usage());
    if (!budget.ok) { this.state.status = 'budget-paused'; this.state.budgetResetAt = budget.resetAt; this.state.lastActionResult = `Budget Paused: ${budget.reason}`; return null; }
    const aggregate = this.aggregateBudget?.check();
    if (aggregate && !aggregate.ok) { this.state.status = 'budget-paused'; this.state.budgetResetAt = aggregate.resetAt; this.state.lastActionResult = `Budget Paused: ${aggregate.reason}`; return null; }
    this.state.budgetResetAt = undefined;
    this.state.lastObservationHash = hash; this.state.status = 'thinking'; this.aborter = new AbortController(); this.ticking = true;
    const controller = this.aborter;
    this.budget.noteRequest();
    this.aggregateBudget?.reserve();
    const usageBefore = this.provider.usage();
    try {
      const context: AiObservation = { ...observation, execution: { action: this.state.currentAction ? { ...this.state.currentAction } : null, lastResult: this.state.lastActionResult, recent: this.state.recent.map((text) => text.slice(0, 400)) } };
      const decision = await this.provider.decide(context, this.state.objective, controller.signal);
      if (controller.signal.aborted) { this.state.usage = this.provider.usage(); return null; }
      this.state.activity = decision.action.name; this.state.explanation = decision.explanation; this.state.status = 'executing'; this.state.currentAction = { name: decision.action.name, phase: 'requested', message: 'Action requested' }; this.remember('note', decision.explanation);
      this.state.currentAction = { ...this.state.currentAction!, phase: 'executing', message: 'Executing through MudEngine capability' };
      const result = await this.executor.execute(decision.action);
      if (controller.signal.aborted) { this.state.usage = this.provider.usage(); return null; }
      if (result.pendingApproval) {
        this.remember('note', result.message);
        this.state.currentAction = { name: decision.action.name, phase: 'requested', message: result.message };
        this.state.lastActionResult = result.message;
        this.state.status = 'paused';
        this.state.usage = this.provider.usage();
        return decision;
      }
      this.remember(result.ok ? 'success' : 'failure', result.message);
      const delegated = new Set(['navigate_to', 'engage_enemy', 'recover_health', 'manage_equipment']); const phase = result.ok ? (delegated.has(decision.action.name) ? 'accepted' : 'completed') : 'failed'; this.state.currentAction = { name: decision.action.name, phase, message: result.message }; this.state.lastActionResult = result.message; if (!result.ok) { this.state.consecutiveFailures += 1; this.lastFailedAction = JSON.stringify(decision.action); } else if (phase === 'completed') { this.state.consecutiveFailures = 0; this.lastFailedAction = ''; } this.state.status = result.ok ? 'idle' : 'error'; this.state.usage = this.provider.usage();
      if (result.ok && decision.done === true && phase === 'completed') { this.state.objectiveComplete = true; this.state.activity = 'objective_complete'; this.state.explanation = 'Objective completed; waiting for a new objective.'; this.state.enabled = false; }
      return decision;
    } catch (error) {
      if (controller.signal.aborted) { this.state.usage = this.provider.usage(); return null; }
      const message = error instanceof Error ? error.message : String(error);
      this.state.status = 'error'; this.state.consecutiveFailures++;
      this.state.lastActionResult = `AI decision failed: ${message}`;
      this.state.explanation = 'The objective is preserved. Correct the objective or resume to retry.';
      this.remember('failure', message); this.state.usage = this.provider.usage(); return null;
    }
    finally { const usageAfter = this.provider.usage(); this.aggregateBudget?.settle({ inputTokens: Math.max(0, usageAfter.inputTokens - usageBefore.inputTokens), outputTokens: Math.max(0, usageAfter.outputTokens - usageBefore.outputTokens), estimatedCostUsd: Math.max(0, usageAfter.estimatedCostUsd - usageBefore.estimatedCostUsd) }); this.aborter = null; this.ticking = false; }
  }
  private remember(kind: 'success' | 'failure' | 'note', text: string): void { this.state.memories.push({ at: Date.now(), kind, text }); this.state.memories = this.state.memories.slice(-50); this.state.recent = this.state.memories.slice(-8).map((m) => m.text); }
  private isFailureEvent(event: string | undefined): boolean {
    return event === 'direction-failed' || event === 'peek-failed' || event === 'command-not-understood' || event === 'command-refused' || event === 'user-search-failed' || event === 'spell-refused' || event === 'user-dies';
  }
}
