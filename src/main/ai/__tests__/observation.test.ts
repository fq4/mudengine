import {
  compactCharacterObservation,
  objectiveActionPolicies,
  objectiveAvailableActions
} from '../observation';
import { describe, expect, it } from 'vitest';

describe('AI character observation projection', () => {
  it('keeps character facts but does not duplicate room or inventory', () => {
    const room = { map: 1, number: 2 };
    const inventory = { items: ['lamp'] };
    const character = compactCharacterObservation({
      name: 'hero',
      vitals: { health: [10, 10] },
      room,
      inventory
    });
    expect(character).toEqual({ name: 'hero', vitals: { health: [10, 10] } });
    expect(character).not.toHaveProperty('room');
    expect(character).not.toHaveProperty('inventory');
  });
});

describe('objective capability advertisement', () => {
  it('keeps unrelated risky capabilities out of informational objectives', () => {
    const actions = objectiveAvailableActions('Inspect my current character and room, then stop.');
    expect(actions).toContain('inspect_character');
    expect(actions).not.toContain('send_message');
    expect(actions).not.toContain('engage_enemy');
    expect(actions).not.toContain('execute_supported_command');
  });

  it('advertises only the named capability families requested by the objective', () => {
    const actions = objectiveAvailableActions('Explore safely, then communicate with the group.');
    expect(actions).toEqual(expect.arrayContaining(['navigate_to', 'send_message']));
    expect(actions).not.toContain('manage_equipment');
  });
  it('uses communication intent consistently for questions and replies', () => {
    expect(objectiveAvailableActions('Ask the nearby shopkeeper a question.')).toContain(
      'send_message'
    );
  });

  it('advertises gossip replies without unrelated item-use capability', () => {
    const actions = objectiveAvailableActions(
      'Reply briefly and politely to each new incoming gossip message from another player. Use send_message with channel gossip, and base each reply only on the message received. Keep listening for more gossip. Do not initiate messages, use another channel, or reply to my own messages.'
    );
    expect(actions).toContain('send_message');
    expect(actions).not.toContain('use_item');
  });

  it('exposes policy metadata alongside advertised capabilities', () => {
    const policies = objectiveActionPolicies('Navigate safely to 1/2.');
    const navigation = policies.find((policy) => policy.name === 'navigate_to');
    expect(navigation).toMatchObject({
      risk: 'routine',
      authorization: 'autonomous',
      authorizationScope: 'capability',
      completion: 'delegated'
    });
    expect(navigation?.summary).toMatch(/Walker/);
    expect(navigation?.failure).toMatch(/authoritative reachable destination/);

    const command = objectiveActionPolicies('Execute a verified command.').find(
      (policy) => policy.name === 'execute_supported_command'
    );
    expect(command).toMatchObject({
      authorization: 'ask-first',
      authorizationScope: 'command',
      completion: 'approval'
    });
  });
});
