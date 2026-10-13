import type { AiBudgetLimits, AiUsage } from '../../shared/ai';

export const DEFAULT_AI_BUDGETS: AiBudgetLimits = { requestsPerMinute: 6, requestsPerHour: 60, sessionCostUsd: 0.25, sessionTokens: 25_000 };

export class AiBudget {
  private readonly requests: number[] = [];
  constructor(private limits: AiBudgetLimits = { ...DEFAULT_AI_BUDGETS }) {}
  getLimits(): AiBudgetLimits { return { ...this.limits }; }
  configure(next: Partial<AiBudgetLimits>): AiBudgetLimits {
    this.limits = { ...this.limits, ...next, requestsPerMinute: Math.min(Math.max(Math.floor(next.requestsPerMinute ?? this.limits.requestsPerMinute), 1), 60), requestsPerHour: Math.min(Math.max(Math.floor(next.requestsPerHour ?? this.limits.requestsPerHour), 1), 1_000), sessionCostUsd: Math.min(Math.max(next.sessionCostUsd ?? this.limits.sessionCostUsd, 0.01), 100), sessionTokens: next.sessionTokens === undefined ? this.limits.sessionTokens : Math.min(Math.max(Math.floor(next.sessionTokens), 100), 1_000_000) };
    return this.getLimits();
  }
  check(usage: AiUsage, now = Date.now()): { ok: true } | { ok: false; reason: string; resetAt: number } {
    while (this.requests[0] !== undefined && this.requests[0] <= now - 60 * 60_000) this.requests.shift();
    const minute = this.requests.filter((at) => at > now - 60_000).length;
    if (minute >= this.limits.requestsPerMinute) return { ok: false, reason: `Request budget reached (${this.limits.requestsPerMinute}/minute)`, resetAt: (this.requests.filter((at) => at > now - 60_000)[0] ?? now) + 60_000 };
    if (this.requests.length >= this.limits.requestsPerHour) return { ok: false, reason: `Request budget reached (${this.limits.requestsPerHour}/hour)`, resetAt: (this.requests[0] ?? now) + 3_600_000 };
    const tokens = usage.inputTokens + usage.outputTokens;
    if (this.limits.sessionTokens !== undefined && tokens >= this.limits.sessionTokens) return { ok: false, reason: `Session token budget reached (${this.limits.sessionTokens.toLocaleString()} tokens)`, resetAt: now };
    if (usage.estimatedCostUsd >= this.limits.sessionCostUsd) return { ok: false, reason: `Session spending budget reached ($${this.limits.sessionCostUsd.toFixed(2)})`, resetAt: now };
    return { ok: true };
  }
  noteRequest(at = Date.now()): void { this.requests.push(at); }
}
