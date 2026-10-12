import { observationHash, type AiAction, type AiDecision, type AiObservation, type AiProvider, type AiState } from '../../shared/ai';

export interface AiExecutor { execute(action: AiAction): Promise<{ ok: boolean; message: string }>; }
export class AutonomousAgent {
  readonly state: AiState;
  private aborter: AbortController | null = null;
  constructor(private readonly provider: AiProvider, private readonly executor: AiExecutor, initial?: Partial<AiState>) {
    this.state = { enabled: false, status: 'disabled', objective: '', activity: '', explanation: '', lastActionResult: '', memories: [], recent: [], usage: provider.usage(), model: 'openrouter', consecutiveFailures: 0, ...initial };
  }
  enable(objective = this.state.objective): void { this.state.enabled = true; this.state.status = 'idle'; this.state.objective = objective; }
  pause(): void { this.aborter?.abort(); this.state.status = this.state.enabled ? 'paused' : 'disabled'; }
  stop(): void { this.aborter?.abort(); this.state.enabled = false; this.state.status = 'disabled'; }
  async tick(observation: AiObservation): Promise<AiDecision | null> {
    if (!this.state.enabled || this.state.status === 'paused' || !this.state.objective) return null;
    const hash = observationHash(observation); if (hash === this.state.lastObservationHash) return null;
    this.state.lastObservationHash = hash; this.state.status = 'thinking'; this.aborter = new AbortController();
    try {
      const decision = await this.provider.decide(observation, this.state.objective, this.aborter.signal);
      this.state.activity = decision.action.name; this.state.explanation = decision.explanation; this.state.status = 'executing'; this.remember('note', decision.explanation);
      const result = await this.executor.execute(decision.action); this.remember(result.ok ? 'success' : 'failure', result.message);
      this.state.lastActionResult = result.message; this.state.consecutiveFailures = result.ok ? 0 : this.state.consecutiveFailures + 1; this.state.status = result.ok ? (decision.done ? 'idle' : 'idle') : 'error'; this.state.usage = this.provider.usage();
      return decision;
    } catch (error) {
      if (this.aborter?.signal.aborted) { this.state.status = this.state.enabled ? 'paused' : 'disabled'; return null; }
      this.state.status = 'error'; this.state.consecutiveFailures++; this.remember('failure', error instanceof Error ? error.message : String(error)); this.state.usage = this.provider.usage(); return null;
    }
    finally { this.aborter = null; }
  }
  private remember(kind: 'success' | 'failure' | 'note', text: string): void { this.state.memories.push({ at: Date.now(), kind, text }); this.state.memories = this.state.memories.slice(-50); this.state.recent = this.state.memories.slice(-8).map((m) => m.text); }
}
