import { compactCharacterObservation } from '../observation';
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
