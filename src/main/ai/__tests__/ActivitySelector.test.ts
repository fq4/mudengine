import { describe, expect, it } from 'vitest';
import { EMPTY_CHARACTER } from '../../../shared/character';
import { selectActivity } from '../ActivitySelector';

describe('policy-filtered activity selection', () => {
  it('prioritizes recovery over a requested activity when HP is hurt', () => {
    const state = {
      ...structuredClone(EMPTY_CHARACTER),
      vitals: { ...EMPTY_CHARACTER.vitals, hp: 40, hpMax: 100 }
    };
    const result = selectActivity(state, 'explore the arena');
    expect(result.candidate?.action.name).toBe('recover_health');
    expect(result.considered.map(({ action }) => action.name)).toContain('inspect_room');
  });

  it('selects only a classified mob for a combat goal', () => {
    const state = structuredClone(EMPTY_CHARACTER);
    state.room.occupants = [
      {
        name: 'filthbug',
        kind: 'mob',
        mob: {} as never,
        disposition: 'hostile',
        uncertain: false,
        costly: 'never',
        charmed: false,
        hidden: false,
        free: false
      }
    ];
    expect(selectActivity(state, 'fight an enemy').candidate?.action).toMatchObject({
      name: 'engage_enemy',
      args: { name: 'filthbug' }
    });
  });

  it('does not invent combat when the goal or target evidence is missing', () => {
    const state = structuredClone(EMPTY_CHARACTER);
    state.room.occupants = [
      {
        name: 'Stranger',
        kind: 'unknown',
        disposition: null,
        uncertain: true,
        costly: 'never',
        charmed: false,
        hidden: false,
        free: false
      }
    ];
    expect(selectActivity(state, 'explore safely').candidate?.action.name).toBe('inspect_room');
    expect(selectActivity(state, 'fight an enemy').candidate).toBeNull();
  });
});
