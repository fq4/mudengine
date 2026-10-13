import type { AiUsage } from '../../shared/ai';

export interface AiBudgetLimits { requestsPerMinute: number; requestsPerHour: number; sessionCostUsd: number; sessionTokens?: number; }
export const DEFAULT_AI_BUDGETS: AiBudgetLimits = { requestsPerMinute: 6, requestsPerHour: 60, sessionCostUsd: 0.25, sessionTokens: 25_000 };

export class AiBudget {
  private readonly requests: number[] = [];
  constructor(private readonly limits: AiBudgetLimits = DEFAULT_AI_BUDGETS) {}
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
