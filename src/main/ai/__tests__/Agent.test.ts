import { describe, expect, it, vi } from 'vitest';
import { AutonomousAgent } from '../Agent';
import type { AiProvider } from '../../../shared/ai';

const observation = {
  character: { hp: 10 },
  room: { id: 1 },
  availableActions: ['inspect_character'] as const
};
describe('AutonomousAgent', () => {
  it.each(['pause', 'stop', 'redirect'] as const)(
    'discards a late provider response after %s',
    async (control) => {
      let release!: (value: unknown) => void;
      const decide = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      const provider: AiProvider = {
        decide,
        usage: () => ({ requests: 1, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })
      };
      const execute = vi.fn();
      const agent = new AutonomousAgent(provider, { execute });
      agent.enable('old objective');
      const pending = agent.tick(observation);
      if (control === 'redirect') agent.enable('new objective');
      else agent[control]();
      release({
        objective: 'old objective',
        explanation: 'go',
        action: { name: 'navigate_to', reason: 'old objective' }
      });
      expect(await pending).toBeNull();
      expect(execute).not.toHaveBeenCalled();
      expect(agent.state.status).toBe(
        control === 'pause' ? 'paused' : control === 'stop' ? 'disabled' : 'idle'
      );
      expect(agent.state.objective).toBe(
        control === 'redirect' ? 'new objective' : 'old objective'
      );
    }
  );
  it('suppresses unchanged observations and executes validated decisions', async () => {
    const decide = vi.fn().mockResolvedValue({
      objective: 'survive',
      explanation: 'Inspect first',
      action: { name: 'inspect_character', reason: 'safety' }
    });
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })
    };
    const execute = vi.fn().mockResolvedValue({ ok: true, message: 'observed' });
    const agent = new AutonomousAgent(provider, { execute });
    agent.enable('survive');
    await agent.tick(observation);
    await agent.tick(observation);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(agent.state.status).toBe('idle');
  });
  it('reassesses after an explicit resume even when the observation is unchanged', async () => {
    const decide = vi.fn().mockResolvedValue({
      objective: 'observe',
      explanation: 'Inspect current state',
      action: { name: 'inspect_character', reason: 'reassess' }
    });
    const provider: AiProvider = {
      decide,
      usage: () => ({
        requests: decide.mock.calls.length,
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostUsd: 0
      })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockResolvedValue({ ok: true, message: 'observed' })
    });
    agent.enable('observe');
    await agent.tick(observation);
    agent.pause();
    agent.enable('observe');
    await agent.tick(observation);
    expect(decide).toHaveBeenCalledTimes(2);
  });
  it('cancels pending inference on pause', async () => {
    let reject!: (e: Error) => void;
    const provider: AiProvider = {
      decide: () =>
        new Promise((_, r) => {
          reject = r;
        }),
      usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, { execute: vi.fn() });
    agent.enable('x');
    const pending = agent.tick(observation);
    agent.pause();
    reject(new Error('aborted'));
    await pending;
    expect(agent.state.status).toBe('paused');
  });
  it('preserves the objective and exposes provider validation failures', async () => {
    const provider: AiProvider = {
      decide: vi.fn().mockRejectedValue(new Error('AI response contains an unsupported action')),
      usage: () => ({ requests: 1, inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, { execute: vi.fn() });
    agent.enable('inspect the room');
    await agent.tick(observation);
    expect(agent.state.objective).toBe('inspect the room');
    expect(agent.state.lastActionResult).toContain('unsupported action');
    expect(agent.state.explanation).toContain('objective is preserved');
    expect(agent.state.status).toBe('error');
  });
  it('waits for navigation state to change before requesting another decision', async () => {
    const decide = vi.fn().mockResolvedValue({
      objective: 'travel',
      explanation: 'Route to the destination',
      action: { name: 'navigate_to', reason: 'travel', args: { destination: '1/2' } }
    });
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })
    };
    const execute = vi.fn().mockResolvedValue({ ok: true, message: 'Walker accepted route' });
    const agent = new AutonomousAgent(provider, { execute });
    agent.enable('travel');
    await agent.tick({ ...observation, availableActions: ['navigate_to'] });
    await agent.tick({ ...observation, availableActions: ['navigate_to'] });
    expect(decide).toHaveBeenCalledTimes(1);
    await agent.tick({ ...observation, room: { id: 2 }, availableActions: ['navigate_to'] });
    expect(decide).toHaveBeenCalledTimes(2);
  });
  it('does not re-plan while a delegated operation is still active', async () => {
    const decide = vi.fn().mockResolvedValue({
      objective: 'travel',
      explanation: 'Route',
      action: { name: 'navigate_to', reason: 'travel' }
    });
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockResolvedValue({ ok: true, message: 'accepted' })
    });
    agent.setDelegatedOperationActive(() => true);
    agent.enable('travel');
    await agent.tick(observation);
    await agent.tick({ ...observation, room: { id: 2 } });
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('does not re-plan while a multi-step delegated route is between legs', async () => {
    const decide = vi.fn().mockResolvedValue({
      objective: 'travel',
      explanation: 'Route',
      action: { name: 'navigate_to', reason: 'travel' }
    });
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockResolvedValue({ ok: true, message: 'accepted' })
    });
    let active = true;
    agent.setDelegatedOperationStatus(() => (active ? 'active' : 'completed'));
    agent.enable('travel');
    await agent.tick(observation);
    await agent.tick({ ...observation, room: { id: 2 }, event: 'arrival' });
    expect(decide).toHaveBeenCalledTimes(1);
    active = false;
    await agent.tick({ ...observation, room: { id: 3 }, event: 'arrival' });
    expect(decide).toHaveBeenCalledTimes(2);
  });
  it('uses an explicit delegated lifecycle before re-planning navigation', async () => {
    const decide = vi
      .fn()
      .mockResolvedValueOnce({
        objective: 'travel',
        explanation: 'Route',
        action: { name: 'navigate_to', reason: 'travel' }
      })
      .mockResolvedValueOnce({
        objective: 'travel',
        explanation: 'Arrived',
        action: { name: 'inspect_room', reason: 'confirm arrival' }
      });
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockResolvedValue({ ok: true, message: 'Walker accepted' })
    });
    let lifecycle: 'active' | 'completed' | 'failed' = 'active';
    agent.setDelegatedOperationStatus(() => lifecycle);
    agent.enable('travel');
    await agent.tick(observation);
    await agent.tick({ ...observation, room: { id: 2 } });
    expect(decide).toHaveBeenCalledTimes(1);
    lifecycle = 'completed';
    await agent.tick({ ...observation, room: { id: 3 } });
    expect(decide).toHaveBeenCalledTimes(2);
    expect(agent.state.currentAction?.name).toBe('inspect_room');
  });
  it('stops a bounded navigation objective when Walker reports completion', async () => {
    const decide = vi.fn().mockResolvedValue({
      objective: 'Explore one adjacent room using an available exit, then stop',
      explanation: 'Take the south exit',
      action: { name: 'navigate_to', reason: 'explore one room', args: { destination: '1/2' } }
    });
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 1, inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockResolvedValue({ ok: true, message: 'Walker accepted route' })
    });
    agent.setDelegatedOperationStatus(() => 'completed');
    agent.enable('Explore one adjacent room using an available exit, then stop');
    await agent.tick({ ...observation, room: { id: 1 } });
    await agent.tick({ ...observation, room: { id: 2 } });
    expect(agent.state.objectiveComplete).toBe(true);
    expect(agent.state.enabled).toBe(false);
    expect(agent.state.explanation).toContain('Bounded objective completed');
    expect(decide).toHaveBeenCalledTimes(1);
  });
  it('does not complete an equipment objective from inventory inspection alone', async () => {
    const decide = vi.fn().mockResolvedValue({
      objective: 'manage equipment',
      explanation: 'Inspect first',
      done: true,
      action: { name: 'inspect_inventory', reason: 'inspect' }
    });
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 1, inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockResolvedValue({ ok: true, message: 'Observed inventory' })
    });
    agent.enable('Review equipment and manage it, then stop');
    await agent.tick(observation);
    expect(agent.state.objectiveComplete).toBe(false);
    expect(agent.state.enabled).toBe(true);
  });
  it('does not complete a travel objective from an unrelated inspection', async () => {
    const decide = vi.fn().mockResolvedValue({
      objective: 'travel to the bank',
      explanation: 'Inspecting first',
      done: true,
      action: { name: 'inspect_room', reason: 'reassess' }
    });
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 1, inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockResolvedValue({ ok: true, message: 'Observed inspect room' })
    });
    agent.enable('travel to the bank');
    await agent.tick({ ...observation, availableActions: ['inspect_room', 'navigate_to'] });
    expect(agent.state.objectiveComplete).toBe(false);
    expect(agent.state.status).toBe('idle');
  });
  it('completes a bounded inspection objective when the model omits done', async () => {
    const decide = vi
      .fn()
      .mockResolvedValueOnce({
        objective: 'inspect',
        explanation: 'Read status',
        done: false,
        action: { name: 'inspect_character', reason: 'inspect' }
      })
      .mockResolvedValueOnce({
        objective: 'inspect',
        explanation: 'Read room',
        done: false,
        action: { name: 'inspect_room', reason: 'inspect' }
      });
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 1, inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockResolvedValue({ ok: true, message: 'Observed character' })
    });
    agent.enable('Inspect my current character and room, then stop.');
    await agent.tick(observation);
    expect(agent.state.objectiveComplete).toBe(false);
    await agent.tick({ ...observation, room: { id: 2 } });
    expect(agent.state.objectiveComplete).toBe(true);
    expect(agent.state.enabled).toBe(false);
  });

  it('reassesses the next synchronous plan step without a wire-state change', async () => {
    const decide = vi
      .fn()
      .mockResolvedValueOnce({
        objective: 'inspect',
        explanation: 'Read status',
        action: { name: 'inspect_character', reason: 'inspect' }
      })
      .mockResolvedValueOnce({
        objective: 'inspect',
        explanation: 'Read room',
        action: { name: 'inspect_room', reason: 'inspect' }
      });
    const provider: AiProvider = {
      decide,
      usage: () => ({
        requests: decide.mock.calls.length,
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostUsd: 0
      })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockResolvedValue({ ok: true, message: 'observed' })
    });
    agent.enable('Inspect my current character and room, then stop.');
    await agent.tick(observation);
    await agent.tick(observation);
    expect(decide).toHaveBeenCalledTimes(2);
    expect(agent.state.objectiveComplete).toBe(true);
  });
  it('uses the delegated combat lifecycle after an NPC engagement settles', async () => {
    const decide = vi
      .fn()
      .mockResolvedValueOnce({
        objective: 'fight',
        explanation: 'Engage the NPC',
        action: { name: 'engage_enemy', reason: 'fight' }
      })
      .mockResolvedValueOnce({
        objective: 'fight',
        explanation: 'Confirm the result',
        action: { name: 'inspect_combat_result', reason: 'confirm' }
      });
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockResolvedValue({ ok: true, message: 'AutoCombat accepted' })
    });
    let lifecycle: 'active' | 'completed' = 'active';
    agent.setDelegatedOperationStatus(() => lifecycle);
    agent.enable('fight');
    await agent.tick(observation);
    await agent.tick({ ...observation, room: { id: 2 } });
    expect(decide).toHaveBeenCalledTimes(1);
    lifecycle = 'completed';
    await agent.tick({ ...observation, room: { id: 3 } });
    expect(decide).toHaveBeenCalledTimes(2);
    expect(agent.state.currentAction?.name).toBe('inspect_combat_result');
  });
  it('does not re-plan while a delegated recovery operation remains active', async () => {
    const decide = vi
      .fn()
      .mockResolvedValueOnce({
        objective: 'recover health, then stop',
        explanation: 'Rest',
        action: { name: 'recover_health', reason: 'recover' }
      })
      .mockResolvedValueOnce({
        objective: 'recover health, then stop',
        explanation: 'Confirm recovery',
        done: true,
        action: { name: 'inspect_character', reason: 'confirm' }
      });
    const provider: AiProvider = {
      decide,
      usage: () => ({
        requests: decide.mock.calls.length,
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostUsd: 0
      })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockResolvedValue({ ok: true, message: 'Recovery delegated' })
    });
    let active: 'active' | 'completed' = 'active';
    agent.setDelegatedOperationStatus(() => active);
    agent.enable('Recover health, then stop.');
    await agent.tick({ ...observation, character: { hp: 10 } });
    await agent.tick({ ...observation, character: { hp: 10 } });
    expect(decide).toHaveBeenCalledTimes(1);
    active = 'completed';
    await agent.tick({ ...observation, character: { hp: 41 } });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(agent.state.objectiveComplete).toBe(true);
    expect(agent.state.enabled).toBe(false);
  });
  it('records equipment completion when inventory is unchanged', async () => {
    const decide = vi.fn().mockResolvedValue({
      objective: 'manage equipment',
      explanation: 'Delegate equipment review',
      done: true,
      action: { name: 'manage_equipment', reason: 'review gear' }
    });
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 1, inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockResolvedValue({ ok: true, message: 'Equipment delegated' })
    });
    agent.setDelegatedOperationStatus(() => 'completed');
    agent.enable('Review my equipment, then stop');
    await agent.tick(observation);
    await agent.tick(observation);
    expect(agent.state.objectiveComplete).toBe(true);
    expect(agent.state.enabled).toBe(false);
    expect(agent.state.currentAction?.phase).toBe('completed');
    expect(decide).toHaveBeenCalledTimes(1);
  });
  it('treats a meaningful failure event as delegated-action failure', async () => {
    const decide = vi
      .fn()
      .mockResolvedValueOnce({
        objective: 'travel',
        explanation: 'Route',
        action: { name: 'navigate_to', reason: 'travel' }
      })
      .mockResolvedValueOnce({
        objective: 'travel',
        explanation: 'Try another route',
        action: { name: 'inspect_room', reason: 'reassess' }
      });
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })
    };
    const execute = vi.fn().mockResolvedValue({ ok: true, message: 'accepted' });
    const agent = new AutonomousAgent(provider, { execute });
    agent.enable('travel');
    await agent.tick(observation);
    await agent.tick({ ...observation, event: 'direction-failed' });
    expect(agent.state.currentAction?.name).toBe('inspect_room');
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[1]?.[0]).toMatchObject({
      execution: {
        action: { name: 'navigate_to', phase: 'failed' },
        lastResult: 'Delegated action failed: direction-failed'
      }
    });
  });
  it('suppresses provider calls after repeated delegated failures', async () => {
    const decide = vi.fn().mockResolvedValue({
      objective: 'travel',
      explanation: 'Route',
      action: { name: 'navigate_to', reason: 'travel' }
    });
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockResolvedValue({ ok: true, message: 'accepted' })
    });
    agent.enable('travel');
    await agent.tick({ ...observation, room: { id: 1 } });
    await agent.tick({ ...observation, room: { id: 2 }, event: 'direction-failed' });
    await agent.tick({ ...observation, room: { id: 3 }, event: 'direction-failed' });
    expect(decide).toHaveBeenCalledTimes(2);
    expect(agent.state.status).toBe('error');
    expect(agent.state.lastActionResult).toContain('Repeated action suppressed');
  });
  it('coalesces provider calls while a decision is in flight', async () => {
    let release!: (decision: unknown) => void;
    const decide = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockResolvedValue({ ok: true, message: 'done' })
    });
    agent.enable('observe');
    const first = agent.tick(observation);
    const second = agent.tick({ ...observation, room: { id: 2 } });
    expect(decide).toHaveBeenCalledTimes(1);
    release({
      objective: 'observe',
      explanation: 'look',
      action: { name: 'inspect_room', reason: 'observe' }
    });
    await Promise.all([first, second]);
  });
  it('stops requesting decisions after a provider marks the objective complete', async () => {
    const decide = vi.fn().mockResolvedValue({
      objective: 'observe',
      explanation: 'done',
      done: true,
      action: { name: 'inspect_room', reason: 'complete' }
    });
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockResolvedValue({ ok: true, message: 'observed' })
    });
    agent.enable('observe');
    await agent.tick(observation);
    await agent.tick({ ...observation, room: { id: 2 } });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(agent.state.objectiveComplete).toBe(true);
    expect(agent.state.enabled).toBe(false);
  });
  it('marks an accepted delegated action interrupted when stopped', async () => {
    const provider: AiProvider = {
      decide: vi.fn().mockResolvedValue({
        objective: 'travel',
        explanation: 'go',
        action: { name: 'navigate_to', reason: 'travel' }
      }),
      usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockResolvedValue({ ok: true, message: 'accepted' })
    });
    agent.enable('travel');
    await agent.tick(observation);
    agent.stop();
    expect(agent.state.currentAction?.phase).toBe('interrupted');
  });
  it('reports executing while the capability delegate is in flight', async () => {
    let release!: (result: { ok: boolean; message: string }) => void;
    const provider: AiProvider = {
      decide: vi.fn().mockResolvedValue({
        objective: 'observe',
        explanation: 'observe',
        action: { name: 'inspect_room', reason: 'observe' }
      }),
      usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      )
    });
    agent.enable('observe');
    const pending = agent.tick(observation);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(agent.state.currentAction?.phase).toBe('executing');
    release({ ok: true, message: 'done' });
    await pending;
  });
  it('does not mark a delegated objective complete on queue acceptance', async () => {
    const decide = vi.fn().mockResolvedValue({
      objective: 'travel',
      explanation: 'arrive',
      done: true,
      action: { name: 'navigate_to', reason: 'travel' }
    });
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi.fn().mockResolvedValue({ ok: true, message: 'route accepted' })
    });
    agent.enable('travel');
    await agent.tick(observation);
    expect(agent.state.objectiveComplete).toBe(false);
    expect(agent.state.currentAction?.phase).toBe('accepted');
  });

  it('pauses only the pending action instead of treating Ask First as a failure', async () => {
    const decide = vi.fn().mockResolvedValue({
      objective: 'recover supplies',
      explanation: 'Buy supplies',
      action: {
        name: 'execute_supported_command',
        args: { command: 'buy potion' },
        reason: 'recover supplies'
      }
    });
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })
    };
    const execute = vi.fn().mockResolvedValue({
      ok: false,
      pendingApproval: true,
      message: 'Approval required (a): spending requires approval'
    });
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
    const decide = vi.fn().mockResolvedValue({
      objective: 'supplies',
      explanation: 'Buy',
      action: {
        name: 'execute_supported_command',
        args: { command: 'buy potion' },
        reason: 'supplies'
      }
    });
    const provider: AiProvider = {
      decide,
      usage: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })
    };
    const agent = new AutonomousAgent(provider, {
      execute: vi
        .fn()
        .mockResolvedValue({ ok: false, pendingApproval: true, message: 'Approval required' })
    });
    agent.enable('supplies');
    await agent.tick(observation);
    agent.approvalResolved('Approved command queued');
    expect(agent.state.status).toBe('idle');
    await agent.tick(observation);
    expect(decide).toHaveBeenCalledTimes(1);
  });
});
