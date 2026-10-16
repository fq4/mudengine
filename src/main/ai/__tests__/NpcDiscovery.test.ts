import { describe, expect, it } from 'vitest';
import type { RoomOccupant } from '../../../shared/character';
import { findSafeCombatNpc, findSafeNpc } from '../NpcDiscovery';
import { assessCombatEligibility } from '../CombatSafety';
import { combatOutcome } from '../CombatOutcome';
import { assessItemUse } from '../InventorySafety';

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
  it('refuses ambiguous duplicate NPC names', () => {
    const merchants = [
      occupant('Merchant', 'unknown', true),
      occupant('merchant', 'unknown', true)
    ];
    expect(findSafeNpc(merchants)).toBeNull();
    expect(findSafeNpc(merchants, 'Merchant')).toBeNull();
  });

  it('selects only an authoritative conservative hostile mob for PvE', () => {
    expect(findSafeCombatNpc([occupant('Guard', 'unknown', true)])).toBeNull();
    expect(findSafeCombatNpc([occupant('Rat', 'mob', false, true)])?.name).toBe('Rat');
    expect(
      findSafeCombatNpc([
        occupant('Charmed rat', 'mob', false, true, { charmed: true }),
        occupant('Good guardian', 'mob', false, true, { costly: 'always' }),
        occupant('Uncertain rat', 'mob', false, true, { uncertain: true })
      ])
    ).toBeNull();
  });
  it('does not select an ambiguous hostile name as an attack target', () => {
    const rats = [occupant('Rat', 'mob', false, true), occupant('rat', 'mob', false, true)];
    expect(findSafeCombatNpc(rats)).toBeNull();
    expect(findSafeCombatNpc(rats, 'Rat')).toBeNull();
  });

  it('requires authoritative health but permits authorized low-health PvE', () => {
    const rat = occupant('Rat', 'mob', false, true);
    expect(assessCombatEligibility([rat], { hp: null, hpMax: 100 }).ok).toBe(false);
    expect(assessCombatEligibility([rat], { hp: 1, hpMax: 100 }, undefined, 0, true).ok).toBe(true);
    expect(
      assessCombatEligibility([rat], { hp: 100, hpMax: 100 }, undefined, 0.6, false)
    ).toMatchObject({
      ok: false,
      reason: 'no authoritative escape route is available from the room'
    });
  });

  it('classifies combat only from authoritative engagement and vitals', () => {
    expect(combatOutcome({ engaged: true, target: 'rat' }, { hp: 80, hpMax: 100 })).toBe('active');
    expect(combatOutcome({ engaged: false, target: null }, { hp: 80, hpMax: 100 })).toBe('ended');
    expect(combatOutcome({ engaged: true, target: 'rat' }, { hp: 20, hpMax: 100 })).toBe('unsafe');
    expect(combatOutcome({ engaged: true, target: null }, { hp: null, hpMax: null })).toBe(
      'unknown'
    );
  });

  it('requires identified, carried, usable items', () => {
    const base = {
      name: 'ration',
      source: 'wire' as const,
      slot: null,
      equipped: false,
      charges: 2
    };
    expect(assessItemUse([base], 'ration').ok).toBe(false);
    expect(assessItemUse([{ ...base, id: 4 }], 'ration').ok).toBe(true);
    expect(assessItemUse([{ ...base, id: 4, equipped: true }], 'ration').ok).toBe(false);
    expect(assessItemUse([{ ...base, id: 4, charges: 0 }], 'ration').ok).toBe(false);
  });
});
