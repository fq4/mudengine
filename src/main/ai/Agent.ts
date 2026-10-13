import { observationHash, type AiAction, type AiActionName, type AiDecision, type AiObservation, type AiProvider, type AiState } from '../../shared/ai';
import { AiBudget } from './Budget';

export interface AiExecutor { execute(action: AiAction): Promise<{ ok: boolean; message: string }>; }
export class AutonomousAgent {
  readonly state: AiState;
  private aborter: AbortController | null = null;
  private ticking = false;
  private delegatedOperationActive: ((action: AiActionName) => boolean) | null = null;
  private lastFailedAction = '';
  constructor(private readonly provider: AiProvider, private readonly executor: AiExecutor, private readonly budget = new AiBudget(), initial?: Partial<AiState>) {
    this.state = { enabled: false, status: 'disabled', objective: '', activity: '', explanation: '', lastActionResult: '', memories: [], recent: [], usage: provider.usage(), model: 'openrouter', consecutiveFailures: 0, currentAction: null, pendingApprovals: [], approvalHistory: [], ...initial };
  }
  enable(objective = this.state.objective): void { this.state.enabled = true; this.state.status = 'idle'; this.state.objective = objective; this.state.consecutiveFailures = 0; this.lastFailedAction = ''; }
  pause(): void { this.aborter?.abort(); this.state.status = this.state.enabled ? 'paused' : 'disabled'; }
  stop(): void { this.aborter?.abort(); this.state.enabled = false; this.state.status = 'disabled'; }
  setDelegatedOperationActive(check: (action: AiActionName) => boolean): void { this.delegatedOperationActive = check; }
  async tick(observation: AiObservation): Promise<AiDecision | null> {
    if (!this.state.enabled || this.state.status === 'paused' || !this.state.objective) return null;
    if (this.ticking) return null;
    const hash = observationHash(observation);
    if (this.state.currentAction?.phase === 'accepted') {
      if (this.delegatedOperationActive?.(this.state.currentAction.name)) return null;
      if (hash === this.state.lastObservationHash) return null;
      this.state.currentAction = { ...this.state.currentAction, phase: 'completed', message: 'Observed a state change after the delegated action' };
    }
    if (hash === this.state.lastObservationHash) return null;
    if (this.state.consecutiveFailures >= 2 && this.lastFailedAction) { this.state.status = 'error'; this.state.lastActionResult = 'Repeated action suppressed; change the objective or strategy'; return null; }
    const budget = this.budget.check(this.provider.usage());
    if (!budget.ok) { this.state.status = 'error'; this.state.lastActionResult = `Budget Paused: ${budget.reason}`; return null; }
    this.state.lastObservationHash = hash; this.state.status = 'thinking'; this.aborter = new AbortController(); this.ticking = true;
    this.budget.noteRequest();
    try {
      const decision = await this.provider.decide(observation, this.state.objective, this.aborter.signal);
      this.state.activity = decision.action.name; this.state.explanation = decision.explanation; this.state.status = 'executing'; this.state.currentAction = { name: decision.action.name, phase: 'requested', message: 'Action requested' }; this.remember('note', decision.explanation);
      const result = await this.executor.execute(decision.action); this.remember(result.ok ? 'success' : 'failure', result.message);
      const delegated = new Set(['navigate_to', 'engage_enemy', 'recover_health', 'manage_equipment']); const phase = result.ok ? (delegated.has(decision.action.name) ? 'accepted' : 'completed') : 'failed'; this.state.currentAction = { name: decision.action.name, phase, message: result.message }; this.state.lastActionResult = result.message; this.state.consecutiveFailures = result.ok ? 0 : this.state.consecutiveFailures + 1; this.state.status = result.ok ? 'idle' : 'error'; this.state.usage = this.provider.usage(); this.lastFailedAction = result.ok ? '' : JSON.stringify(decision.action);
      return decision;
    } catch (error) {
      if (this.aborter?.signal.aborted) { this.state.status = this.state.enabled ? 'paused' : 'disabled'; return null; }
      this.state.status = 'error'; this.state.consecutiveFailures++; this.remember('failure', error instanceof Error ? error.message : String(error)); this.state.usage = this.provider.usage(); return null;
    }
    finally { this.aborter = null; this.ticking = false; }
  }
  private remember(kind: 'success' | 'failure' | 'note', text: string): void { this.state.memories.push({ at: Date.now(), kind, text }); this.state.memories = this.state.memories.slice(-50); this.state.recent = this.state.memories.slice(-8).map((m) => m.text); }
}
