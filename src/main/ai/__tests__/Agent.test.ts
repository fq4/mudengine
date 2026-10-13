import { describe, expect, it, vi } from 'vitest';
import { AutonomousAgent } from '../Agent';
import type { AiProvider } from '../../../shared/ai';

const observation = { character: { hp: 10 }, room: { id: 1 }, availableActions: ['inspect_character'] as const };
describe('AutonomousAgent', () => {
  it.each(['pause', 'stop', 'redirect'] as const)('discards a late provider response after %s', async (control) => {
    let release!: (value: unknown) => void;
    const decide = vi.fn().mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const provider: AiProvider = { decide, usage: () => ({ requests: 1, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }) };
    const execute = vi.fn();
    const agent = new AutonomousAgent(provider, { execute });
    agent.enable('old objective');
    const pending = agent.tick(observation);
    if (control === 'redirect') agent.enable('new objective'); else agent[control]();
    release({ objective: 'old objective', explanation: 'go', action: { name: 'navigate_to', reason: 'old objective' } });
    expect(await pending).toBeNull();
    expect(execute).not.toHaveBeenCalled();
    expect(agent.state.status).toBe(control === 'pause' ? 'paused' : control === 'stop' ? 'disabled' : 'idle');
    expect(agent.state.objective).toBe(control === 'redirect' ? 'new objective' : 'old objective');
  });
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
  it('waits for navigation state to change before requesting another decision', async () => {
    const decide = vi.fn().mockResolvedValue({ objective: 'travel', explanation: 'Route to the destination', action: { name: 'navigate_to', reason: 'travel', args: { destination: '1/2' } } });
    const provider: AiProvider = { decide, usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }) };
    const execute = vi.fn().mockResolvedValue({ ok: true, message: 'Walker accepted route' });
    const agent = new AutonomousAgent(provider, { execute }); agent.enable('travel');
    await agent.tick({ ...observation, availableActions: ['navigate_to'] });
    await agent.tick({ ...observation, availableActions: ['navigate_to'] });
    expect(decide).toHaveBeenCalledTimes(1);
    await agent.tick({ ...observation, room: { id: 2 }, availableActions: ['navigate_to'] });
    expect(decide).toHaveBeenCalledTimes(2);
  });
  it('does not re-plan while a delegated operation is still active', async () => {
    const decide = vi.fn().mockResolvedValue({ objective: 'travel', explanation: 'Route', action: { name: 'navigate_to', reason: 'travel' } });
    const provider: AiProvider = { decide, usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }) };
    const agent = new AutonomousAgent(provider, { execute: vi.fn().mockResolvedValue({ ok: true, message: 'accepted' }) });
    agent.setDelegatedOperationActive(() => true); agent.enable('travel');
    await agent.tick(observation);
    await agent.tick({ ...observation, room: { id: 2 } });
    expect(decide).toHaveBeenCalledTimes(1);
  });
  it('treats a meaningful failure event as delegated-action failure', async () => {
    const decide = vi.fn()
      .mockResolvedValueOnce({ objective: 'travel', explanation: 'Route', action: { name: 'navigate_to', reason: 'travel' } })
      .mockResolvedValueOnce({ objective: 'travel', explanation: 'Try another route', action: { name: 'inspect_room', reason: 'reassess' } });
    const provider: AiProvider = { decide, usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }) };
    const execute = vi.fn().mockResolvedValue({ ok: true, message: 'accepted' });
    const agent = new AutonomousAgent(provider, { execute }); agent.enable('travel');
    await agent.tick(observation);
    await agent.tick({ ...observation, event: 'direction-failed' });
    expect(agent.state.currentAction?.name).toBe('inspect_room');
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[1]?.[0]).toMatchObject({ execution: { action: { name: 'navigate_to', phase: 'failed' }, lastResult: 'Delegated action failed: direction-failed' } });
  });
  it('suppresses provider calls after repeated delegated failures', async () => {
    const decide = vi.fn().mockResolvedValue({ objective: 'travel', explanation: 'Route', action: { name: 'navigate_to', reason: 'travel' } });
    const provider: AiProvider = { decide, usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }) };
    const agent = new AutonomousAgent(provider, { execute: vi.fn().mockResolvedValue({ ok: true, message: 'accepted' }) }); agent.enable('travel');
    await agent.tick({ ...observation, room: { id: 1 } });
    await agent.tick({ ...observation, room: { id: 2 }, event: 'direction-failed' });
    await agent.tick({ ...observation, room: { id: 3 }, event: 'direction-failed' });
    expect(decide).toHaveBeenCalledTimes(2);
    expect(agent.state.status).toBe('error');
    expect(agent.state.lastActionResult).toContain('Repeated action suppressed');
  });
  it('coalesces provider calls while a decision is in flight', async () => {
    let release!: (decision: unknown) => void;
    const decide = vi.fn().mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const provider: AiProvider = { decide, usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }) };
    const agent = new AutonomousAgent(provider, { execute: vi.fn().mockResolvedValue({ ok: true, message: 'done' }) }); agent.enable('observe');
    const first = agent.tick(observation); const second = agent.tick({ ...observation, room: { id: 2 } });
    expect(decide).toHaveBeenCalledTimes(1); release({ objective: 'observe', explanation: 'look', action: { name: 'inspect_room', reason: 'observe' } }); await Promise.all([first, second]);
  });
  it('stops requesting decisions after a provider marks the objective complete', async () => {
    const decide = vi.fn().mockResolvedValue({ objective: 'observe', explanation: 'done', done: true, action: { name: 'inspect_room', reason: 'complete' } });
    const provider: AiProvider = { decide, usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }) };
    const agent = new AutonomousAgent(provider, { execute: vi.fn().mockResolvedValue({ ok: true, message: 'observed' }) }); agent.enable('observe');
    await agent.tick(observation); await agent.tick({ ...observation, room: { id: 2 } });
    expect(decide).toHaveBeenCalledTimes(1); expect(agent.state.objectiveComplete).toBe(true); expect(agent.state.enabled).toBe(false);
  });
  it('marks an accepted delegated action interrupted when stopped', async () => {
    const provider: AiProvider = { decide: vi.fn().mockResolvedValue({ objective: 'travel', explanation: 'go', action: { name: 'navigate_to', reason: 'travel' } }), usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }) };
    const agent = new AutonomousAgent(provider, { execute: vi.fn().mockResolvedValue({ ok: true, message: 'accepted' }) }); agent.enable('travel');
    await agent.tick(observation); agent.stop();
    expect(agent.state.currentAction?.phase).toBe('interrupted');
  });
  it('reports executing while the capability delegate is in flight', async () => {
    let release!: (result: { ok: boolean; message: string }) => void;
    const provider: AiProvider = { decide: vi.fn().mockResolvedValue({ objective: 'observe', explanation: 'observe', action: { name: 'inspect_room', reason: 'observe' } }), usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }) };
    const agent = new AutonomousAgent(provider, { execute: vi.fn().mockImplementation(() => new Promise((resolve) => { release = resolve; })) }); agent.enable('observe');
    const pending = agent.tick(observation);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(agent.state.currentAction?.phase).toBe('executing'); release({ ok: true, message: 'done' }); await pending;
  });
  it('does not mark a delegated objective complete on queue acceptance', async () => {
    const decide = vi.fn().mockResolvedValue({ objective: 'travel', explanation: 'arrive', done: true, action: { name: 'navigate_to', reason: 'travel' } });
    const provider: AiProvider = { decide, usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }) };
    const agent = new AutonomousAgent(provider, { execute: vi.fn().mockResolvedValue({ ok: true, message: 'route accepted' }) }); agent.enable('travel');
    await agent.tick(observation);
    expect(agent.state.objectiveComplete).toBe(false); expect(agent.state.currentAction?.phase).toBe('accepted');
  });

  it('pauses only the pending action instead of treating Ask First as a failure', async () => {
    const decide = vi.fn().mockResolvedValue({ objective: 'recover supplies', explanation: 'Buy supplies', action: { name: 'execute_supported_command', args: { command: 'buy potion' }, reason: 'recover supplies' } });
    const provider: AiProvider = { decide, usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }) };
    const execute = vi.fn().mockResolvedValue({ ok: false, pendingApproval: true, message: 'Approval required (a): spending requires approval' });
    const agent = new AutonomousAgent(provider, { execute });
    agent.enable('recover supplies');
    await agent.tick(observation);
    expect(agent.state.status).toBe('paused');
    expect(agent.state.consecutiveFailures).toBe(0);
    expect(agent.state.currentAction).toMatchObject({ phase: 'requested' });
    await agent.tick({ ...observation, room: { id: 2 } });
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('resumes an objective after approval resolution without forcing a new request', async () => {
    const decide = vi.fn().mockResolvedValue({ objective: 'supplies', explanation: 'Buy', action: { name: 'execute_supported_command', args: { command: 'buy potion' }, reason: 'supplies' } });
    const provider: AiProvider = { decide, usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }) };
    const agent = new AutonomousAgent(provider, { execute: vi.fn().mockResolvedValue({ ok: false, pendingApproval: true, message: 'Approval required' }) });
    agent.enable('supplies'); await agent.tick(observation); agent.approvalResolved('Approved command queued');
    expect(agent.state.status).toBe('idle');
    await agent.tick(observation);
    expect(decide).toHaveBeenCalledTimes(1);
  });
});
