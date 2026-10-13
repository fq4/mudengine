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

  it('exposes policy metadata alongside advertised capabilities', () => {
    const policies = objectiveActionPolicies('Navigate safely to 1/2.');
    const navigation = policies.find((policy) => policy.name === 'navigate_to');
    expect(navigation).toMatchObject({ risk: 'routine', authorization: 'autonomous' });
    expect(navigation?.summary).toMatch(/Walker/);
  });
});
