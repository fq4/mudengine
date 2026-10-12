import { describe, expect, it, vi } from 'vitest';
import { AutonomousAgent } from '../Agent';
import type { AiProvider } from '../../../shared/ai';

const observation = { character: { hp: 10 }, room: { id: 1 }, availableActions: ['inspect_character'] as const };
describe('AutonomousAgent', () => {
  it('suppresses unchanged observations and executes validated decisions', async () => {
    const decide = vi.fn().mockResolvedValue({ objective: 'survive', explanation: 'Inspect first', action: { name: 'inspect_character', reason: 'safety' } });
    const provider: AiProvider = { decide, usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }) };
    const execute = vi.fn().mockResolvedValue({ ok: true, message: 'observed' });
    const agent = new AutonomousAgent(provider, { execute }); agent.enable('survive');
    await agent.tick(observation); await agent.tick(observation);
    expect(decide).toHaveBeenCalledTimes(1); expect(execute).toHaveBeenCalledTimes(1); expect(agent.state.status).toBe('idle');
  });
  it('cancels pending inference on pause', async () => {
    let reject!: (e: Error) => void;
    const provider: AiProvider = { decide: () => new Promise((_, r) => { reject = r; }), usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }) };
    const agent = new AutonomousAgent(provider, { execute: vi.fn() }); agent.enable('x'); const pending = agent.tick(observation); agent.pause(); reject(new Error('aborted')); await pending;
    expect(agent.state.status).toBe('paused');
  });
});
