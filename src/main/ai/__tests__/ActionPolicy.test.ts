import { describe, expect, it } from 'vitest';
import type { AiAction } from '../../../shared/ai';
import { actionPolicy, validateActionPolicy } from '../ActionPolicy';

const context = {
  objective: 'inspect my room',
  connected: true,
  inRealm: true,
  visibleNpcNames: ['guard'],
  safeCombatTargetNames: ['goblin'],
  usableItemNames: ['healing potion'],
  recentGossipReplyAuthorized: true
};

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
        { ...context, objective: 'fight enemies' }
      )
    ).toMatch(/Player targets/);
    expect(
      validateActionPolicy(
        { name: 'engage_enemy', reason: 'fight', args: { name: 'goblin' } },
        { ...context, objective: 'fight enemies' }
      )
    ).toBeNull();
    expect(
      validateActionPolicy(
        { name: 'engage_enemy', reason: 'fight', args: { name: 'unknown' } },
        { ...context, objective: 'fight enemies' }
      )
    ).toMatch(/authoritative safe hostile NPC/);
    expect(
      validateActionPolicy(
        { name: 'engage_enemy', reason: 'fight', args: { name: 'goblin' } },
        context
      )
    ).toMatch(/objective does not request PvE combat/);
  });

  it('requires a message before social policy can run', () => {
    expect(
      validateActionPolicy(
        { name: 'send_message', reason: 'say', args: {} },
        { ...context, objective: 'chat with nearby players' }
      )
    ).toMatch(/message/);
  });

  it('allows safe NPC inspection but rejects player targets', () => {
    expect(
      validateActionPolicy(
        { name: 'inspect_npc', reason: 'learn facts', args: { name: 'guard' } },
        context
      )
    ).toBeNull();
    expect(
      validateActionPolicy(
        { name: 'inspect_npc', reason: 'learn facts', args: { name: 'missing' } },
        context
      )
    ).toMatch(/not authoritatively visible/);
    expect(
      validateActionPolicy(
        { name: 'inspect_npc', reason: 'learn facts', args: { name: 'guard' } },
        { ...context, visibleNpcNames: ['guard', 'Guard'] }
      )
    ).toMatch(/not authoritatively visible/);
    expect(
      validateActionPolicy(
        { name: 'inspect_npc', reason: 'learn facts', args: { name: '@player' } },
        context
      )
    ).toMatch(/Player inspection/);
  });

  it('keeps recovery autonomous, delegated, and argument-free', () => {
    expect(actionPolicy('recover_health')).toMatchObject({
      authorization: 'autonomous',
      completion: 'delegated'
    });
    expect(validateActionPolicy({ name: 'recover_health', reason: 'restore health' }, context)).toBeNull();
  });

  it('requires objective intent and authoritative carried-item evidence', () => {
    const action = { name: 'use_item', reason: 'heal', args: { name: 'healing potion' } } as AiAction;
    expect(validateActionPolicy(action, context)).toMatch(/objective does not request item use/);
    expect(
      validateActionPolicy(action, {
        ...context,
        objective: 'use a healing item if needed',
        usableItemNames: []
      })
    ).toMatch(/eligible carried item/);
    expect(
      validateActionPolicy(action, {
        ...context,
        objective: 'use a healing item if needed'
      })
    ).toBeNull();
  });

  it('fails closed when the session or message authorization is missing', () => {
    expect(
      validateActionPolicy(
        { name: 'navigate_to', reason: 'explore', args: { destination: '1/2' } },
        { ...context, connected: false }
      )
    ).toMatch(/active in-game session/);
    const reply = {
      name: 'send_message',
      reason: 'reply to gossip',
      args: { channel: 'gossip', message: 'Hello' }
    } as AiAction;
    expect(
      validateActionPolicy(reply, {
        ...context,
        objective: 'Reply to new gossip messages',
        recentGossipReplyAuthorized: false
      })
    ).toMatch(/recent inbound gossip/);
  });

  it('routes general-command authorization to command classification', () => {
    expect(actionPolicy('execute_supported_command')).toMatchObject({
      authorization: 'ask-first',
      authorizationScope: 'command'
    });
    expect(
      validateActionPolicy(
        {
          name: 'execute_supported_command',
          reason: 'check status',
          args: { command: 'look' }
        },
        context
      )
    ).toBeNull();
  });
});
