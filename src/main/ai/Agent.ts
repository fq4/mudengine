import {
  observationHash,
  type AiAction,
  type AiActionName,
  type AiBudgetLimits,
  type AiDecision,
  type AiObservation,
  type AiProvider,
  type AiState
} from '../../shared/ai';
import { AiAggregateBudget, AiBudget } from './Budget';
import { advanceObjectivePlan, buildObjectivePlan, objectivePlanComplete } from './ObjectivePlan';

export interface AiExecutor {
  execute(
    action: AiAction,
    source?: 'agent' | 'approved'
  ): Promise<{ ok: boolean; message: string; pendingApproval?: boolean }>;
}
export class AutonomousAgent {
  readonly state: AiState;
  private aborter: AbortController | null = null;
  private ticking = false;
  private delegatedOperationActive: ((action: AiActionName) => boolean) | null = null;
  private delegatedOperationStatus:
    ((action: AiActionName) => 'active' | 'completed' | 'failed' | null) | null = null;
  private lastFailedAction = '';
  constructor(
    private readonly provider: AiProvider,
    private readonly executor: AiExecutor,
    private readonly budget = new AiBudget(),
    private readonly aggregateBudget?: AiAggregateBudget,
    initial?: Partial<AiState>
  ) {
    this.state = {
      enabled: false,
      status: 'disabled',
      objective: '',
      objectiveComplete: false,
      activity: '',
      explanation: '',
      lastActionResult: '',
      memories: [],
      recent: [],
      usage: provider.usage(),
      model: 'openrouter',
      consecutiveFailures: 0,
      currentAction: null,
      plan: [],
      pendingApprovals: [],
      approvalHistory: [],
      budgetLimits: budget.getLimits(),
      ...initial
    };
  }
  configureBudget(limits: Partial<AiBudgetLimits>): AiBudgetLimits {
    const next = this.budget.configure(limits);
    this.state.budgetLimits = next;
    return next;
  }
  enable(objective = this.state.objective): void {
    this.aborter?.abort();
    this.state.lastObservationHash = undefined;
    this.state.enabled = true;
    this.state.status = 'idle';
    this.state.objective = objective;
    this.state.plan = buildObjectivePlan(objective);
    if (this.state.plan[0]) this.state.plan[0].status = 'active';
    this.state.objectiveComplete = false;
    this.state.consecutiveFailures = 0;
    this.lastFailedAction = '';
  }
  pause(): void {
    this.aborter?.abort();
    this.state.status = this.state.enabled ? 'paused' : 'disabled';
  }
  stop(): void {
    this.aborter?.abort();
    this.state.enabled = false;
    this.state.status = 'disabled';
    if (
      this.state.currentAction &&
      ['requested', 'accepted', 'executing'].includes(this.state.currentAction.phase)
    )
      this.state.currentAction = {
        ...this.state.currentAction,
        phase: 'interrupted',
        message: 'AI action interrupted'
      };
  }
  setDelegatedOperationActive(check: (action: AiActionName) => boolean): void {
    this.delegatedOperationActive = check;
  }
  setDelegatedOperationStatus(
    check: (action: AiActionName) => 'active' | 'completed' | 'failed' | null
  ): void {
    this.delegatedOperationStatus = check;
  }
  approvalResolved(message: string): void {
    if (this.state.status !== 'paused' || this.state.currentAction?.phase !== 'requested') return;
    this.state.status = this.state.enabled ? 'idle' : 'disabled';
    this.state.currentAction = { ...this.state.currentAction, message };
    this.state.lastActionResult = message;
  }
  async tick(observation: AiObservation): Promise<AiDecision | null> {
    if (
      !this.state.enabled ||
      this.state.status === 'paused' ||
      this.state.objectiveComplete === true ||
      !this.state.objective
    )
      return null;
    if (this.ticking) return null;
    const hash = observationHash(observation);
    if (this.state.currentAction?.phase === 'accepted') {
      const delegatedStatus =
        this.delegatedOperationStatus?.(this.state.currentAction.name) ?? null;
      if (
        delegatedStatus === 'active' ||
        (delegatedStatus === null && this.delegatedOperationActive?.(this.state.currentAction.name))
      )
        return null;
      if (delegatedStatus === 'failed' || this.isFailureEvent(observation.event)) {
        this.state.currentAction = {
          ...this.state.currentAction,
          phase: 'failed',
          message: `Delegated action failed: ${observation.event}`
        };
        this.state.lastActionResult = this.state.currentAction.message;
        this.state.consecutiveFailures += 1;
        this.lastFailedAction = this.state.currentAction.name;
      } else {
        this.state.currentAction = {
          ...this.state.currentAction,
          phase: 'completed',
          message: 'Observed a state change after the delegated action'
        };
        this.state.consecutiveFailures = 0;
        this.lastFailedAction = '';
        if (
          this.actionSatisfiesObjective(this.state.currentAction.name) &&
          this.planSatisfied() &&
          this.isBoundedStopObjective()
        ) {
          this.state.objectiveComplete = true;
          this.state.enabled = false;
          this.state.activity = 'objective_complete';
          this.state.explanation = 'Bounded objective completed; AI stopped.';
          this.state.lastActionResult = this.state.currentAction.message;
          return null;
        }
      }
      // A delegated subsystem may complete without changing the compact
      // observation (for example, equipment automation can determine that no
      // gear change is needed).  Its explicit lifecycle result must still be
      // recorded, but an unchanged observation must not trigger another
      // provider request.
      if (hash === this.state.lastObservationHash) return null;
    }
    if (hash === this.state.lastObservationHash) return null;
    if (this.state.consecutiveFailures >= 2 && this.lastFailedAction) {
      this.state.status = 'error';
      this.state.lastActionResult = 'Repeated action suppressed; change the objective or strategy';
      return null;
    }
    const budget = this.budget.check(this.provider.usage());
    if (!budget.ok) {
      this.state.status = 'budget-paused';
      this.state.budgetResetAt = budget.resetAt;
      this.state.lastActionResult = `Budget Paused: ${budget.reason}`;
      return null;
    }
    const aggregate = this.aggregateBudget?.check();
    if (aggregate && !aggregate.ok) {
      this.state.status = 'budget-paused';
      this.state.budgetResetAt = aggregate.resetAt;
      this.state.lastActionResult = `Budget Paused: ${aggregate.reason}`;
      return null;
    }
    this.state.budgetResetAt = undefined;
    this.state.lastObservationHash = hash;
    this.state.status = 'thinking';
    this.aborter = new AbortController();
    this.ticking = true;
    const controller = this.aborter;
    this.budget.noteRequest();
    this.aggregateBudget?.reserve();
    const usageBefore = this.provider.usage();
    try {
      const context: AiObservation = {
        ...observation,
        execution: {
          action: this.state.currentAction ? { ...this.state.currentAction } : null,
          lastResult: this.state.lastActionResult,
          recent: this.state.recent.map((text) => text.slice(0, 400))
        }
      };
      const decision = await this.provider.decide(context, this.state.objective, controller.signal);
      if (controller.signal.aborted) {
        this.state.usage = this.provider.usage();
        return null;
      }
      this.state.activity = decision.action.name;
      this.state.explanation = decision.explanation;
      this.state.status = 'executing';
      this.state.currentAction = {
        name: decision.action.name,
        phase: 'requested',
        message: 'Action requested'
      };
      this.remember('note', decision.explanation);
      this.state.currentAction = {
        ...this.state.currentAction!,
        phase: 'executing',
        message: 'Executing through MudEngine capability'
      };
      const planned = this.state.plan?.find((step) => step.status === 'active');
      const executionAction =
        planned && planned.action !== decision.action.name
          ? {
              ...decision.action,
              name: planned.action,
              args:
                planned.destination === undefined
                  ? decision.action.args
                  : { ...decision.action.args, destination: planned.destination }
            }
          : decision.action;
      const result = await this.executor.execute(executionAction, 'agent');
      if (controller.signal.aborted) {
        this.state.usage = this.provider.usage();
        return null;
      }
      if (result.pendingApproval) {
        this.remember('note', result.message);
        this.state.currentAction = {
          name: executionAction.name,
          phase: 'requested',
          message: result.message
        };
        this.state.lastActionResult = result.message;
        this.state.status = 'paused';
        this.state.usage = this.provider.usage();
        return decision;
      }
      this.remember(result.ok ? 'success' : 'failure', result.message);
      const planBefore = JSON.stringify(this.state.plan ?? []);
      this.state.plan = advanceObjectivePlan(
        this.state.plan ?? [],
        executionAction.name,
        result.ok
      );
      const planAdvanced = planBefore !== JSON.stringify(this.state.plan);
      const delegated = new Set([
        'navigate_to',
        'engage_enemy',
        'recover_health',
        'manage_equipment'
      ]);
      const phase = result.ok
        ? delegated.has(executionAction.name)
          ? 'accepted'
          : 'completed'
        : 'failed';
      this.state.currentAction = { name: executionAction.name, phase, message: result.message };
      this.state.lastActionResult = result.message;
      if (!result.ok) {
        this.state.consecutiveFailures += 1;
        this.lastFailedAction = JSON.stringify(executionAction);
      } else if (phase === 'completed') {
        this.state.consecutiveFailures = 0;
        this.lastFailedAction = '';
      }
      if (!result.ok && /^Refused: navigation/i.test(result.message))
        this.state.consecutiveFailures = 2;
      this.state.status = result.ok ? 'idle' : 'error';
      // A completed synchronous inspection can leave the compact observation
      // unchanged. The next planned step is itself the reassessment event;
      // allow one bounded provider call to advance it.
      if (
        result.ok &&
        phase === 'completed' &&
        planAdvanced &&
        (this.state.plan?.length ?? 0) > 0 &&
        !objectivePlanComplete(this.state.plan ?? [])
      )
        this.state.lastObservationHash = undefined;
      this.state.usage = this.provider.usage();
      if (
        result.ok &&
        phase === 'completed' &&
        this.actionSatisfiesObjective(executionAction.name) &&
        this.planSatisfied() &&
        (decision.done === true || this.isBoundedStopObjective())
      ) {
        this.state.objectiveComplete = true;
        this.state.activity = 'objective_complete';
        this.state.explanation = 'Objective completed; waiting for a new objective.';
        this.state.enabled = false;
      }
      if (result.ok && phase === 'completed' && objectivePlanComplete(this.state.plan ?? [])) {
        this.state.objectiveComplete = true;
        this.state.activity = 'objective_complete';
        this.state.explanation = 'All bounded objective steps completed.';
        this.state.enabled = false;
      }
      return decision;
    } catch (error) {
      if (controller.signal.aborted) {
        this.state.usage = this.provider.usage();
        return null;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.state.status = 'error';
      this.state.consecutiveFailures++;
      this.state.lastActionResult = `AI decision failed: ${message}`;
      this.state.explanation =
        'The objective is preserved. Correct the objective or resume to retry.';
      this.remember('failure', message);
      this.state.usage = this.provider.usage();
      return null;
    } finally {
      const usageAfter = this.provider.usage();
      this.aggregateBudget?.settle({
        inputTokens: Math.max(0, usageAfter.inputTokens - usageBefore.inputTokens),
        outputTokens: Math.max(0, usageAfter.outputTokens - usageBefore.outputTokens),
        estimatedCostUsd: Math.max(0, usageAfter.estimatedCostUsd - usageBefore.estimatedCostUsd)
      });
      this.aborter = null;
      this.ticking = false;
    }
  }
  private remember(kind: 'success' | 'failure' | 'note', text: string): void {
    this.state.memories.push({ at: Date.now(), kind, text });
    this.state.memories = this.state.memories.slice(-50);
    this.state.recent = this.state.memories.slice(-8).map((m) => m.text);
  }
  private isFailureEvent(event: string | undefined): boolean {
    return (
      event === 'direction-failed' ||
      event === 'peek-failed' ||
      event === 'command-not-understood' ||
      event === 'command-refused' ||
      event === 'user-search-failed' ||
      event === 'spell-refused' ||
      event === 'user-dies'
    );
  }
  private planSatisfied(): boolean {
    const plan = this.state.plan ?? [];
    return plan.length === 0 || objectivePlanComplete(plan);
  }
  private isBoundedStopObjective(): boolean {
    return /\b(stop|then stop|one adjacent|one room|single room|once)\b/i.test(
      this.state.objective
    );
  }
  private actionSatisfiesObjective(action: AiActionName): boolean {
    const objective = this.state.objective.toLowerCase();
    if (/\b(navigate|travel|go to|walk to|explore)\b/.test(objective))
      return action === 'navigate_to';
    if (/\b(npc|non[- ]player|townsperson|villager)\b/.test(objective))
      return action === 'inspect_npc' || action === 'engage_enemy';
    if (/\b(inventory|backpack|pack)\b/.test(objective)) return action === 'inspect_inventory';
    if (/\b(use|consume|drink|eat|quaff)\b/.test(objective)) return action === 'use_item';
    if (/\b(character|status|stats?)\b/.test(objective)) return action === 'inspect_character';
    if (/\b(room|location|area)\b/.test(objective)) return action === 'inspect_room';
    if (/\b(equipment|gear|armor|armour|weapon|wear|dress)\b/.test(objective))
      return action === 'manage_equipment';
    if (/\b(recover|health|heal|rest)\b/.test(objective)) return action === 'recover_health';
    return true;
  }
}
