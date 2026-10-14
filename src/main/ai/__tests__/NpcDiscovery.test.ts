import { describe, expect, it } from 'vitest';
import type { RoomOccupant } from '../../../shared/character';
import { findSafeCombatNpc, findSafeNpc } from '../NpcDiscovery';
import { assessCombatEligibility } from '../CombatSafety';
import { combatOutcome } from '../CombatOutcome';

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

  it('requires authoritative health above the conservative combat threshold', () => {
    const rat = occupant('Rat', 'mob', false, true);
    expect(assessCombatEligibility([rat], { hp: null, hpMax: 100 }).ok).toBe(false);
    expect(assessCombatEligibility([rat], { hp: 50, hpMax: 100 }).ok).toBe(false);
    expect(assessCombatEligibility([rat], { hp: 60, hpMax: 100 }).ok).toBe(true);
  });

  it('classifies combat only from authoritative engagement and vitals', () => {
    expect(combatOutcome({ engaged: true, target: 'rat' }, { hp: 80, hpMax: 100 })).toBe('active');
    expect(combatOutcome({ engaged: false, target: null }, { hp: 80, hpMax: 100 })).toBe('ended');
    expect(combatOutcome({ engaged: true, target: 'rat' }, { hp: 20, hpMax: 100 })).toBe('unsafe');
    expect(combatOutcome({ engaged: true, target: null }, { hp: null, hpMax: null })).toBe(
      'unknown'
    );
  });
});
