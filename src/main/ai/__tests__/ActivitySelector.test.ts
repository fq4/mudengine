import { describe, expect, it } from 'vitest';
import { EMPTY_CHARACTER } from '../../../shared/character';
import { selectActivity } from '../ActivitySelector';

describe('policy-filtered activity selection', () => {
  it('offers a safe observation activity when no explicit goal is set', () => {
    const result = selectActivity(structuredClone(EMPTY_CHARACTER), '');
    expect(result.candidate?.action.name).toBe('inspect_room');
    expect(result.candidate?.rationale).toContain('observe');
  });

  it('prioritizes recovery over a requested activity when HP is hurt', () => {
    const state = {
      ...structuredClone(EMPTY_CHARACTER),
      vitals: { ...EMPTY_CHARACTER.vitals, hp: 40, hpMax: 100 }
    };
    const result = selectActivity(state, 'explore the arena');
    expect(result.candidate?.action.name).toBe('recover_health');
    expect(result.considered.map(({ action }) => action.name)).toContain('inspect_room');
  });

  it('bases exploration on valid room exits and current world-state context', () => {
    const state = structuredClone(EMPTY_CHARACTER);
    state.vitals = { ...state.vitals, hp: 90, hpMax: 100 };
    state.room.exits = [
      {
        direction: 'north',
        note: null,
        targetMap: 1,
        targetRoom: 2,
        targetName: null,
        requirement: null
      }
    ] as typeof state.room.exits;
    const result = selectActivity(state, 'explore the area');
    expect(result.candidate?.action.name).toBe('navigate_to');
    expect(result.candidate?.rationale).toContain('valid exits');
  });

  it('ranks unexplored exits ahead of visited or repeatedly failed routes', () => {
    const state = structuredClone(EMPTY_CHARACTER);
    state.room.map = 1;
    state.room.number = 1;
    state.room.exits = [
      {
        direction: 'north',
        note: null,
        targetMap: 1,
        targetRoom: 2,
        targetName: null,
        requirement: null
      },
      {
        direction: 'east',
        note: null,
        targetMap: 1,
        targetRoom: 3,
        targetName: null,
        requirement: null
      },
      {
        direction: 'south',
        note: null,
        targetMap: 1,
        targetRoom: 4,
        targetName: null,
        requirement: null
      }
    ];
    const result = selectActivity(state, 'explore', {
      visitedRooms: ['1/2'],
      deadEnds: [],
      routeOutcomes: [{ from: '1/1', to: '1/3', failures: 2 }]
    });
    expect(result.candidate?.action).toMatchObject({
      name: 'navigate_to',
      args: { destination: '1/4' }
    });
    expect(result.considered.find(({ action }) => action.name === 'navigate_to')?.priority).toBe(70);
  });

  it('does not offer revisited destinations or exits marked as dead ends', () => {
    const state = structuredClone(EMPTY_CHARACTER);
    state.room.exits = [
      {
        direction: 'north',
        note: null,
        targetMap: 1,
        targetRoom: 2,
        targetName: null,
        requirement: null
      }
    ];
    expect(
      selectActivity(state, 'explore', {
        visitedRooms: ['1/2'],
        deadEnds: [],
        routeOutcomes: []
      }).candidate?.action.name
    ).toBe('inspect_room');
    expect(
      selectActivity(state, 'explore', {
        visitedRooms: [],
        deadEnds: ['1/2'],
        routeOutcomes: []
      }).candidate?.action.name
    ).toBe('inspect_room');
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
