import { describe, expect, it } from 'vitest';
import type { RoomOccupant } from '../../../shared/character';
import {
  findSafeCombatNpc,
  findSafeNpc,
  summarizeCombatCandidates
} from '../NpcDiscovery';
import { assessCombatEligibility, hasMappedCombatEscape } from '../CombatSafety';
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
  ...(combat
    ? {
        mob: {
          name,
          rawName: name,
          source: 'hybrid',
          charmed: false,
          disposition: 'hostile',
          uncertain: false,
          costly: 'never'
        } as NonNullable<RoomOccupant['mob']>,
        disposition: 'hostile'
      }
    : {})
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
  it('restricts a preferred combat target to one exact eligible occupant', () => {
    const rat = occupant('Rat', 'mob', false, true);
    const wolf = occupant('Wolf', 'mob', false, true);
    const room = [rat, wolf];

    expect(findSafeCombatNpc(room, 'Wolf')).toBe(wolf);
    expect(findSafeCombatNpc(room, 'Unknown')).toBeNull();
    expect(findSafeCombatNpc([rat, wolf, occupant('wolf', 'mob', false, true)], 'Wolf')).toBeNull();
  });
  it('accepts a uniquely identified realm mob that has attacked this character', () => {
    const attacker = occupant('Kobold thief', 'mob', false, false, {
      disposition: 'hostile',
      uncertain: true,
      mob: {
        name: 'Kobold thief',
        rawName: 'Kobold thief',
        source: 'hybrid',
        charmed: false,
        disposition: 'hostile',
        uncertain: true,
        costly: 'never'
      } as NonNullable<RoomOccupant['mob']>
    });

    expect(findSafeCombatNpc([attacker])).toBeNull();
    expect(findSafeCombatNpc([attacker], undefined, ['the kobold thief'])).toBe(attacker);
    expect(
      assessCombatEligibility(
        [attacker],
        { hp: 20, hpMax: 51 },
        attacker.name,
        0,
        true,
        ['Kobold thief']
      )
    ).toMatchObject({ ok: true, target: attacker });
  });
  it('does not use attacker evidence for players, unknown names, or ambiguous occupants', () => {
    const attacker = occupant('Rat', 'mob', false, false, {
      disposition: 'hostile',
      uncertain: true,
      mob: {
        name: 'Rat',
        rawName: 'Rat',
        source: 'hybrid',
        charmed: false,
        disposition: 'hostile',
        uncertain: true,
        costly: 'never'
      } as NonNullable<RoomOccupant['mob']>
    });

    expect(
      findSafeCombatNpc([attacker, occupant('Rat', 'player')], undefined, ['Rat'])
    ).toBeNull();
    expect(
      findSafeCombatNpc(
        [
          attacker,
          occupant('the rat', 'mob', false, false, {
            disposition: 'hostile',
            uncertain: true,
            mob: attacker.mob
          })
        ],
        undefined,
        ['Rat']
      )
    ).toBeNull();
    expect(findSafeCombatNpc([attacker], undefined, ['unknown name'])).toBeNull();
  });
  it('retains charmed, unidentified, and always-costly refusals for attackers', () => {
    const known = occupant('Rat', 'mob', false, false, {
      disposition: 'hostile',
      uncertain: true,
      mob: {
        name: 'Rat',
        rawName: 'Rat',
        source: 'hybrid',
        charmed: false,
        disposition: 'hostile',
        uncertain: true,
        costly: 'never'
      } as NonNullable<RoomOccupant['mob']>
    });

    expect(
      findSafeCombatNpc([{ ...known, charmed: true }], undefined, ['Rat'])
    ).toBeNull();
    expect(
      findSafeCombatNpc(
        [{ ...known, costly: 'always', mob: { ...known.mob!, costly: 'always' } }],
        undefined,
        ['Rat']
      )
    ).toBeNull();
    expect(
      findSafeCombatNpc(
        [{ ...known, mob: { ...known.mob!, source: 'wire' } }],
        undefined,
        ['Rat']
      )
    ).toBeNull();
  });
  it('explains mob exclusions without changing the conservative target gate', () => {
    const mobs = [
      occupant('Unknown rat', 'mob', false, false, {
        mob: { name: 'Unknown rat' } as RoomOccupant['mob']
      }),
      occupant('Passive rat', 'mob', false, false, {
        mob: { name: 'Passive rat' } as RoomOccupant['mob'],
        disposition: 'passive'
      }),
      occupant('Guard', 'mob', false, true, { costly: 'always' }),
      occupant('Charmed rat', 'mob', false, true, { charmed: true })
    ];

    expect(summarizeCombatCandidates(mobs)).toBe(
      'visible mobs=4; eligible=0; excluded: disposition unknown=1, disposition passive=1, alignment cost=1, charmed=1'
    );
    expect(findSafeCombatNpc(mobs)).toBeNull();
  });
  it('reports when verified attack evidence resolves an uncertain realm disposition', () => {
    const attacker = occupant('Kobold thief', 'mob', false, false, {
      disposition: 'hostile',
      uncertain: true,
      mob: {
        name: 'Kobold thief',
        rawName: 'Kobold thief',
        source: 'hybrid',
        charmed: false,
        disposition: 'hostile',
        uncertain: true,
        costly: 'never'
      } as NonNullable<RoomOccupant['mob']>
    });

    expect(summarizeCombatCandidates([attacker], ['Kobold thief'])).toBe(
      'visible mobs=1; eligible=1; verified attacker evidence=1'
    );
  });
  it('reports ambiguous names and eligible targets separately', () => {
    const occupants = [
      occupant('Rat', 'mob', false, true),
      occupant('rat', 'mob', false, true),
      occupant('Ogre', 'mob', false, true)
    ];

    expect(summarizeCombatCandidates(occupants)).toBe(
      'visible mobs=3; eligible=1; excluded: ambiguous name=2'
    );
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

  it('requires a mapped exit without a key requirement for a combat escape', () => {
    const mappedExit = {
      direction: 'n',
      note: null,
      targetMap: 1,
      targetRoom: 2,
      targetName: 'North room',
      requirement: null
    };

    expect(hasMappedCombatEscape({ exits: [mappedExit] })).toBe(true);
    expect(
      hasMappedCombatEscape({
        exits: [{ ...mappedExit, targetMap: null, targetRoom: null }]
      })
    ).toBe(false);
    expect(
      hasMappedCombatEscape({
        exits: [{ ...mappedExit, requirement: { kind: 'key', raw: 'Key: 9' } }]
      })
    ).toBe(false);
    expect(hasMappedCombatEscape(null)).toBe(false);
  });

  it('classifies combat only from authoritative engagement and vitals', () => {
    expect(combatOutcome({ engaged: true, target: 'rat' }, { hp: 80, hpMax: 100 })).toBe('active');
    expect(combatOutcome({ engaged: false, target: null }, { hp: 80, hpMax: 100 })).toBe('ended');
    expect(combatOutcome({ engaged: true, target: 'rat' }, { hp: 20, hpMax: 100 })).toBe('unsafe');
    expect(combatOutcome({ engaged: false, target: null }, { hp: 20, hpMax: 100 })).toBe('ended');
    expect(combatOutcome({ engaged: false, target: null }, { hp: 0, hpMax: 100 })).toBe('unsafe');
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
