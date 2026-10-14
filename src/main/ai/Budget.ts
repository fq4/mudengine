import type {
  AiAggregateBudgetSnapshot,
  AiBudgetLimits,
  AiBudgetProfile,
  AiUsage
} from '../../shared/ai';

export interface AiAggregateBudgetState {
  requests: number[];
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  limits: AiBudgetLimits;
}

export const DEFAULT_AI_BUDGETS: AiBudgetLimits = {
  requestsPerMinute: 6,
  requestsPerHour: 60,
  sessionCostUsd: 0.25,
  sessionTokens: 25_000
};
export const AI_BUDGET_PROFILES: Record<AiBudgetProfile['name'], AiBudgetProfile> = {
  smoke: {
    name: 'smoke',
    provider: {
      requestsPerMinute: 2,
      requestsPerHour: 10,
      sessionCostUsd: 0.05,
      sessionTokens: 5_000
    },
    gameplay: { commands: 20, movements: 5, runtimeMs: 5 * 60_000 }
  },
  exploration: {
    name: 'exploration',
    provider: {
      requestsPerMinute: 6,
      requestsPerHour: 60,
      sessionCostUsd: 0.25,
      sessionTokens: 25_000
    },
    gameplay: { commands: 100, movements: 30, runtimeMs: 30 * 60_000 }
  },
  adventure: {
    name: 'adventure',
    provider: {
      requestsPerMinute: 10,
      requestsPerHour: 180,
      sessionCostUsd: 1,
      sessionTokens: 100_000
    },
    gameplay: { commands: 500, movements: 150, runtimeMs: 2 * 60 * 60_000 }
  },
  extended: {
    name: 'extended',
    provider: {
      requestsPerMinute: 15,
      requestsPerHour: 600,
      sessionCostUsd: 5,
      sessionTokens: 300_000
    },
    gameplay: { commands: 2_000, movements: 600, runtimeMs: 8 * 60 * 60_000 }
  }
};
export function aiBudgetProfile(name: AiBudgetProfile['name']): AiBudgetProfile {
  return structuredClone(AI_BUDGET_PROFILES[name]);
}

/** Shared quota for all agents in one MudEngine client. */
export class AiAggregateBudget {
  private readonly requests: number[] = [];
  private inputTokens = 0;
  private outputTokens = 0;
  private cost = 0;
  private pendingTokens = 0;
  private pendingCost = 0;
  constructor(
    private limits: AiBudgetLimits = {
      requestsPerMinute: 30,
      requestsPerHour: 300,
      sessionCostUsd: 1,
      sessionTokens: 100_000
    },
    private readonly changed?: () => void
  ) {}
  getLimits(): AiBudgetLimits {
    return { ...this.limits };
  }
  configure(next: Partial<AiBudgetLimits>): AiBudgetLimits {
    this.limits = {
      ...this.limits,
      ...next,
      requestsPerMinute: Math.min(
        Math.max(Math.floor(next.requestsPerMinute ?? this.limits.requestsPerMinute), 1),
        600
      ),
      requestsPerHour: Math.min(
        Math.max(Math.floor(next.requestsPerHour ?? this.limits.requestsPerHour), 1),
        10_000
      ),
      sessionCostUsd: Math.min(
        Math.max(next.sessionCostUsd ?? this.limits.sessionCostUsd, 0.01),
        1_000
      ),
      sessionTokens:
        next.sessionTokens === undefined
          ? this.limits.sessionTokens
          : Math.min(Math.max(Math.floor(next.sessionTokens), 100), 10_000_000)
    };
    this.changed?.();
    return this.getLimits();
  }
  private prune(now: number): void {
    while (this.requests[0] !== undefined && this.requests[0] <= now - 60 * 60_000)
      this.requests.shift();
  }
  check(now = Date.now()): { ok: true } | { ok: false; reason: string; resetAt: number } {
    this.prune(now);
    const minute = this.requests.filter((at) => at > now - 60_000).length;
    if (minute >= this.limits.requestsPerMinute)
      return {
        ok: false,
        reason: `Aggregate request budget reached (${this.limits.requestsPerMinute}/minute)`,
        resetAt: (this.requests.find((at) => at > now - 60_000) ?? now) + 60_000
      };
    if (this.requests.length >= this.limits.requestsPerHour)
      return {
        ok: false,
        reason: `Aggregate request budget reached (${this.limits.requestsPerHour}/hour)`,
        resetAt: (this.requests[0] ?? now) + 3_600_000
      };
    if (
      this.limits.sessionTokens !== undefined &&
      this.inputTokens + this.outputTokens + this.pendingTokens >= this.limits.sessionTokens
    )
      return {
        ok: false,
        reason: `Aggregate token budget reached (${this.limits.sessionTokens.toLocaleString()} tokens)`,
        resetAt: now
      };
    if (this.cost + this.pendingCost >= this.limits.sessionCostUsd)
      return {
        ok: false,
        reason: `Aggregate spending budget reached ($${this.limits.sessionCostUsd.toFixed(2)})`,
        resetAt: now
      };
    return { ok: true };
  }
  reserve(at = Date.now()): void {
    this.requests.push(at);
    this.changed?.();
  }
  settle(delta: { inputTokens: number; outputTokens: number; estimatedCostUsd: number }): void {
    this.inputTokens += delta.inputTokens;
    this.outputTokens += delta.outputTokens;
    this.cost += delta.estimatedCostUsd;
    this.changed?.();
  }
  resetUsage(): void {
    this.requests.length = 0;
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cost = 0;
    this.changed?.();
  }
  snapshot(now = Date.now()): AiAggregateBudgetSnapshot {
    this.prune(now);
    return {
      limits: this.getLimits(),
      requests: this.requests.length,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      estimatedCostUsd: this.cost
    };
  }
  exportState(now = Date.now()): AiAggregateBudgetState {
    this.prune(now);
    return {
      requests: [...this.requests],
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      estimatedCostUsd: this.cost,
      limits: this.getLimits()
    };
  }
  restoreState(state: unknown, now = Date.now()): void {
    if (!state || typeof state !== 'object') return;
    const value = state as Partial<AiAggregateBudgetState>;
    this.requests.splice(
      0,
      this.requests.length,
      ...(Array.isArray(value.requests)
        ? value.requests.filter(
            (at): at is number => typeof at === 'number' && Number.isFinite(at) && at <= now
          )
        : [])
    );
    this.inputTokens =
      typeof value.inputTokens === 'number' &&
      Number.isFinite(value.inputTokens) &&
      value.inputTokens >= 0
        ? value.inputTokens
        : 0;
    this.outputTokens =
      typeof value.outputTokens === 'number' &&
      Number.isFinite(value.outputTokens) &&
      value.outputTokens >= 0
        ? value.outputTokens
        : 0;
    this.cost =
      typeof value.estimatedCostUsd === 'number' &&
      Number.isFinite(value.estimatedCostUsd) &&
      value.estimatedCostUsd >= 0
        ? value.estimatedCostUsd
        : 0;
    if (value.limits && typeof value.limits === 'object') this.configure(value.limits);
    this.prune(now);
  }
}

export class AiBudget {
  private readonly requests: number[] = [];
  constructor(private limits: AiBudgetLimits = { ...DEFAULT_AI_BUDGETS }) {}
  getLimits(): AiBudgetLimits {
    return { ...this.limits };
  }
  configure(next: Partial<AiBudgetLimits>): AiBudgetLimits {
    this.limits = {
      ...this.limits,
      ...next,
      requestsPerMinute: Math.min(
        Math.max(Math.floor(next.requestsPerMinute ?? this.limits.requestsPerMinute), 1),
        60
      ),
      requestsPerHour: Math.min(
        Math.max(Math.floor(next.requestsPerHour ?? this.limits.requestsPerHour), 1),
        1_000
      ),
      sessionCostUsd: Math.min(
        Math.max(next.sessionCostUsd ?? this.limits.sessionCostUsd, 0.01),
        100
      ),
      sessionTokens:
        next.sessionTokens === undefined
          ? this.limits.sessionTokens
          : Math.min(Math.max(Math.floor(next.sessionTokens), 100), 1_000_000)
    };
    return this.getLimits();
  }
  check(
    usage: AiUsage,
    now = Date.now()
  ): { ok: true } | { ok: false; reason: string; resetAt: number } {
    while (this.requests[0] !== undefined && this.requests[0] <= now - 60 * 60_000)
      this.requests.shift();
    const minute = this.requests.filter((at) => at > now - 60_000).length;
    if (minute >= this.limits.requestsPerMinute)
      return {
        ok: false,
        reason: `Request budget reached (${this.limits.requestsPerMinute}/minute)`,
        resetAt: (this.requests.filter((at) => at > now - 60_000)[0] ?? now) + 60_000
      };
    if (this.requests.length >= this.limits.requestsPerHour)
      return {
        ok: false,
        reason: `Request budget reached (${this.limits.requestsPerHour}/hour)`,
        resetAt: (this.requests[0] ?? now) + 3_600_000
      };
    const tokens = usage.inputTokens + usage.outputTokens;
    if (this.limits.sessionTokens !== undefined && tokens >= this.limits.sessionTokens)
      return {
        ok: false,
        reason: `Session token budget reached (${this.limits.sessionTokens.toLocaleString()} tokens)`,
        resetAt: now
      };
    if (usage.estimatedCostUsd >= this.limits.sessionCostUsd)
      return {
        ok: false,
        reason: `Session spending budget reached ($${this.limits.sessionCostUsd.toFixed(2)})`,
        resetAt: now
      };
    return { ok: true };
  }
  noteRequest(at = Date.now()): void {
    this.requests.push(at);
  }
}
