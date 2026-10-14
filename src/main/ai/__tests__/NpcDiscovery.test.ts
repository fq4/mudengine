import { describe, expect, it } from 'vitest';
import type { RoomOccupant } from '../../../shared/character';
import { findSafeCombatNpc, findSafeNpc } from '../NpcDiscovery';

const occupant = (
  name: string,
  kind: RoomOccupant['kind'],
  npc = false,
  combat = false,
  overrides: Partial<RoomOccupant> = {}
): RoomOccupant => ({
  name,
  kind,
  npc: npc ? ({ name } as RoomOccupant['npc']) : undefined,
  mob: undefined,
  player: undefined,
  disposition: null,
  uncertain: false,
  costly: 'never',
  charmed: false,
  hidden: false,
  free: false,
  ...overrides,
  ...(combat ? { mob: { name } as RoomOccupant['mob'], disposition: 'hostile' } : {})
});

describe('safe NPC discovery', () => {
  it('selects a matching authoritative NPC', () => {
    expect(
      findSafeNpc(
        [occupant('Guard', 'unknown'), occupant('Innkeeper', 'unknown', true)],
        'innkeeper'
      )?.name
    ).toBe('Innkeeper');
  });
  it('never treats players or unclassified occupants as NPCs', () => {
    expect(findSafeNpc([occupant('Player', 'player'), occupant('Stranger', 'unknown')])).toBeNull();
  });
  it('selects the first authoritative NPC when no preference is supplied', () => {
    expect(findSafeNpc([occupant('Merchant', 'unknown', true)])?.name).toBe('Merchant');
  });

  it('selects only an authoritative conservative hostile mob for PvE', () => {
    expect(findSafeCombatNpc([occupant('Guard', 'unknown', true)])).toBeNull();
    expect(findSafeCombatNpc([occupant('Rat', 'mob', false, true)])?.name).toBe('Rat');
    expect(
      findSafeCombatNpc([
        occupant('Charmed rat', 'mob', false, true, { charmed: true }),
        occupant('Good guardian', 'mob', false, true, { costly: 'always' })
      ])
    ).toBeNull();
  });
});
