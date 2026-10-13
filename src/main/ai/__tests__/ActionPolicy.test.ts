import { describe, expect, it } from 'vitest';
import type { AiAction } from '../../../shared/ai';
import { actionPolicy, validateActionPolicy } from '../ActionPolicy';

const context = { objective: 'inspect my room', connected: true, inRealm: true };

describe('canonical AI action policy', () => {
  it('defines every provider action exactly once', async () => {
    const { AI_ACTIONS } = await import('../../../shared/ai');
    for (const name of AI_ACTIONS) expect(actionPolicy(name).name).toBe(name);
  });

  it('requires authoritative destinations for navigation', () => {
    const action = { name: 'navigate_to', reason: 'route', args: {} } as AiAction;
    expect(validateActionPolicy(action, context)).toMatch(/destination/);
    expect(validateActionPolicy({ ...action, args: { destination: '1/2' } }, context)).toBeNull();
  });

  it('keeps NPC engagement approval-gated and rejects player targets', () => {
    expect(actionPolicy('engage_enemy').authorization).toBe('ask-first');
    expect(
      validateActionPolicy(
        { name: 'engage_enemy', reason: 'fight', args: { name: '@player' } },
        context
      )
    ).toMatch(/Player targets/);
  });

  it('requires a message before social policy can run', () => {
    expect(
      validateActionPolicy({ name: 'send_message', reason: 'say', args: {} }, context)
    ).toMatch(/message/);
  });

  it('allows safe NPC inspection but rejects player targets', () => {
    expect(validateActionPolicy({ name: 'inspect_npc', reason: 'learn facts', args: { name: 'guard' } }, context)).toBeNull();
    expect(validateActionPolicy({ name: 'inspect_npc', reason: 'learn facts', args: { name: '@player' } }, context)).toMatch(/Player inspection/);
  });
});
