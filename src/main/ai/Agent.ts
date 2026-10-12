import { observationHash, type AiAction, type AiDecision, type AiObservation, type AiPersistedState, type AiProvider, type AiState, type AiActionResult } from '../../shared/ai';

export interface AiExecutor { execute(action: AiAction): Promise<AiActionResult>; }
export class AutonomousAgent {
  readonly state: AiState;
  private aborter: AbortController | null = null;
  constructor(private readonly provider: AiProvider, private readonly executor: AiExecutor, initial?: Partial<AiState>) {
    this.state = { enabled: false, status: 'disabled', objective: '', subgoal: '', plan: [], activity: '', explanation: '', lastActionResult: '', memories: [], recent: [], usage: provider.usage(), model: 'openrouter', currentAction: null, knowledge: [], consecutiveFailures: 0, ...initial };
  }
  enable(objective = this.state.objective): void { this.state.enabled = true; this.state.status = 'idle'; this.state.objective = objective; }
  pause(): void { this.aborter?.abort(); this.state.status = this.state.enabled ? 'paused' : 'disabled'; }
  stop(): void { this.aborter?.abort(); this.state.enabled = false; this.state.status = 'disabled'; }
  restore(saved: AiPersistedState): void { this.state.objective = saved.objective; this.state.subgoal = saved.subgoal ?? ''; this.state.plan = (saved.plan ?? []).slice(0, 8); this.state.knowledge = (saved.knowledge ?? []).slice(-50); this.state.memories = saved.memories.slice(-50); this.state.recent = saved.recent.slice(-8); this.state.lastActionResult = saved.lastActionResult; }
  async tick(observation: AiObservation): Promise<AiDecision | null> {
    if (!this.state.enabled || this.state.status === 'paused' || !this.state.objective) return null;
    const hash = observationHash(observation);
    if (this.state.currentAction?.phase === 'accepted') {
      const navigation = observation.state?.navigation;
      const action = this.state.currentAction.name;
      if (action === 'navigate_to' && navigation?.status === 'walking') {
        this.state.status = 'executing'; this.state.lastObservationHash = hash; return null;
      }
      if (action === 'send_message' && !observation.event) return null;
      if (hash !== this.state.lastObservationHash) {
        this.state.currentAction = { ...this.state.currentAction, phase: 'completed', at: Date.now(), message: `Verified state change after ${action}` };
        this.state.lastActionResult = this.state.currentAction.message;
      }
    }
    if (hash === this.state.lastObservationHash) return null;
    this.state.lastObservationHash = hash; this.state.status = 'thinking'; this.aborter = new AbortController();
    try {
      const decision = await this.provider.decide(observation, this.state.objective, this.aborter.signal);
      this.state.subgoal = decision.subgoal ?? this.state.subgoal; this.state.plan = decision.plan?.slice(0, 8) ?? this.state.plan; this.state.activity = decision.action.name; this.state.explanation = decision.explanation; this.state.status = 'executing'; this.state.currentAction = { name: decision.action.name, phase: 'requested', at: Date.now(), message: 'Action requested' }; this.remember('note', decision.explanation);
      const result = await this.executor.execute(decision.action); const phase = result.phase ?? (result.ok ? 'completed' : 'failed'); this.state.currentAction = { name: decision.action.name, phase, at: Date.now(), message: result.message }; this.remember(result.ok ? 'success' : 'failure', result.message);
      this.state.lastActionResult = result.message; if (result.ok) { this.learn(observation, decision); this.state.lastFailure = undefined; } else { this.state.lastFailure = { action: decision.action.name, message: result.message, phase, at: Date.now() }; } this.state.consecutiveFailures = result.ok ? 0 : this.state.consecutiveFailures + 1; this.state.status = result.ok ? 'idle' : 'error'; this.state.usage = this.provider.usage();
      return decision;
    } catch (error) {
      if (this.aborter?.signal.aborted) { this.state.status = this.state.enabled ? 'paused' : 'disabled'; return null; }
      this.state.status = 'error'; this.state.consecutiveFailures++; this.remember('failure', error instanceof Error ? error.message : String(error)); this.state.usage = this.provider.usage(); return null;
    }
    finally { this.aborter = null; }
  }
  private remember(kind: 'success' | 'failure' | 'note', text: string): void { this.state.memories.push({ at: Date.now(), kind, text }); this.state.memories = this.state.memories.slice(-50); this.state.recent = this.state.memories.slice(-8).map((m) => m.text); }
  private learn(observation: AiObservation, decision: AiDecision): void {
    const view = observation.state;
    if (!view) return;
    const facts: Array<[string, string | null]> = [
      ['location', view.room.name],
      ['navigation', view.navigation.destination ? `${view.navigation.destination} (${view.navigation.status})` : null],
      ['decision', decision.subgoal ?? decision.explanation]
    ];
    for (const [topic, fact] of facts) if (fact) this.state.knowledge.push({ at: Date.now(), topic, fact });
    this.state.knowledge = this.state.knowledge.slice(-50);
  }
}
