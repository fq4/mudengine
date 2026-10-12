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
  it('waits for deterministic navigation instead of asking on every step', async () => {
    const decide = vi.fn()
      .mockResolvedValueOnce({ objective: 'travel', explanation: 'Go there', action: { name: 'navigate_to', reason: 'route' } })
      .mockResolvedValueOnce({ objective: 'travel', explanation: 'Arrived, inspect', action: { name: 'inspect_room', reason: 'arrival' } });
    const provider: AiProvider = { decide, usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }) };
    const execute = vi.fn().mockResolvedValue({ ok: true, phase: 'accepted', message: 'walking' });
    const agent = new AutonomousAgent(provider, { execute }); agent.enable('travel');
    const walking: any = { state: { navigation: { status: 'walking' } }, character: {}, room: {}, availableActions: [] };
    const arrived: any = { state: { navigation: { status: 'arrived' } }, character: {}, room: {}, availableActions: [] };
    await agent.tick(walking); await agent.tick({ ...walking, state: { navigation: { status: 'walking' }, step: 2 } }); await agent.tick(arrived);
    expect(decide).toHaveBeenCalledTimes(2);
  });
});
