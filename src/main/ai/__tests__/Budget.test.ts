import { describe, expect, it } from 'vitest';
import { AiAggregateBudget, AiBudget } from '../Budget';

const usage = { requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
describe('AiBudget', () => {
  it('clamps per-session overrides to safe practical bounds', () => {
    const budget = new AiBudget();
    expect(budget.configure({ requestsPerMinute: 0, requestsPerHour: 9_999, sessionCostUsd: 0, sessionTokens: 1 })).toEqual({ requestsPerMinute: 1, requestsPerHour: 1_000, sessionCostUsd: 0.01, sessionTokens: 100 });
  });
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
  it('counts reservations from multiple agents against one shared request window', () => {
    const budget = new AiAggregateBudget({ requestsPerMinute: 1, requestsPerHour: 10, sessionCostUsd: 1, sessionTokens: 100 });
    expect(budget.check(1000)).toEqual({ ok: true });
    budget.reserve(1000);
    expect(budget.check(2000)).toMatchObject({ ok: false, reason: 'Aggregate request budget reached (1/minute)' });
  });
  it('includes settled tokens and cost while a request is still pending', () => {
    const budget = new AiAggregateBudget({ requestsPerMinute: 10, requestsPerHour: 10, sessionCostUsd: 0.25, sessionTokens: 100 });
    budget.reserve(1000);
    budget.settle({ inputTokens: 60, outputTokens: 40, estimatedCostUsd: 0.25 });
    expect(budget.check(2000)).toMatchObject({ ok: false, reason: 'Aggregate token budget reached (100 tokens)' });
  });
});
