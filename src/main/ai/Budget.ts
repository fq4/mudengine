import type { AiUsage } from '../../shared/ai';

export interface AiBudgetLimits { requestsPerMinute: number; requestsPerHour: number; sessionCostUsd: number; }
export const DEFAULT_AI_BUDGETS: AiBudgetLimits = { requestsPerMinute: 6, requestsPerHour: 60, sessionCostUsd: 0.25 };

export class AiBudget {
  private readonly requests: number[] = [];
  constructor(private readonly limits: AiBudgetLimits = DEFAULT_AI_BUDGETS) {}
  check(usage: AiUsage, now = Date.now()): { ok: true } | { ok: false; reason: string } {
    while (this.requests[0] !== undefined && this.requests[0] <= now - 60 * 60_000) this.requests.shift();
    const minute = this.requests.filter((at) => at > now - 60_000).length;
    if (minute >= this.limits.requestsPerMinute) return { ok: false, reason: `Request budget reached (${this.limits.requestsPerMinute}/minute)` };
    if (this.requests.length >= this.limits.requestsPerHour) return { ok: false, reason: `Request budget reached (${this.limits.requestsPerHour}/hour)` };
    if (usage.estimatedCostUsd >= this.limits.sessionCostUsd) return { ok: false, reason: `Session spending budget reached ($${this.limits.sessionCostUsd.toFixed(2)})` };
    return { ok: true };
  }
  noteRequest(at = Date.now()): void { this.requests.push(at); }
}
