import { describe, expect, it } from 'vitest';
import { AiBudget } from '../Budget';

const usage = { requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
describe('AiBudget', () => {
  it('pauses after the configured request rate', () => {
    const budget = new AiBudget({ requestsPerMinute: 1, requestsPerHour: 10, sessionCostUsd: 1 });
    budget.noteRequest(1000); budget.noteRequest(2000);
    expect(budget.check(usage, 3000)).toMatchObject({ ok: false, resetAt: 61_000 });
    expect(budget.check(usage, 61_001)).toMatchObject({ ok: false, resetAt: 62_000 });
    expect(budget.check(usage, 62001)).toMatchObject({ ok: true });
  });
  it('reports when the oldest request exits the hourly window', () => {
    const budget = new AiBudget({ requestsPerMinute: 10, requestsPerHour: 1, sessionCostUsd: 1 });
    budget.noteRequest(1000); budget.noteRequest(2000);
    expect(budget.check(usage, 3000)).toMatchObject({ ok: false, resetAt: 3_601_000 });
    expect(budget.check(usage, 3_601_001)).toMatchObject({ ok: false, resetAt: 3_602_000 });
    expect(budget.check(usage, 3_602_001)).toMatchObject({ ok: true });
  });
  it('pauses when provider-reported session cost is exhausted', () => {
    const budget = new AiBudget({ requestsPerMinute: 2, requestsPerHour: 10, sessionCostUsd: 0.25 });
    expect(budget.check({ ...usage, estimatedCostUsd: 0.25 })).toMatchObject({ ok: false });
  });
  it('pauses when provider-reported session tokens are exhausted', () => {
    const budget = new AiBudget({ requestsPerMinute: 6, requestsPerHour: 60, sessionCostUsd: 1, sessionTokens: 100 });
    expect(budget.check({ ...usage, inputTokens: 60, outputTokens: 40 })).toMatchObject({ ok: false });
  });
});
