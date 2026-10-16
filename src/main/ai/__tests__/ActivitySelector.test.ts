import { describe, expect, it, vi } from 'vitest';
import { EMPTY_CHARACTER } from '../../../shared/character';
import { reachableExplorationFrontiers, selectActivity } from '../ActivitySelector';

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

  it('offers a gossip reply only when a recent inbound reply authorization exists', () => {
    const state = structuredClone(EMPTY_CHARACTER);
    const goal = 'Respond to anyone on the gossip channel';

    expect(
      selectActivity(state, goal).considered.some(({ action }) => action.name === 'send_message')
    ).toBe(false);
    expect(
      selectActivity(state, 'Explore the gossip channel', undefined, true).considered.some(
        ({ action }) => action.name === 'send_message'
      )
    ).toBe(false);

    const result = selectActivity(state, goal, undefined, true);
    expect(result.candidate?.action).toMatchObject({
      name: 'send_message',
      args: { channel: 'gossip' }
    });
    expect(result.candidate?.rationale).toContain('recent inbound gossip message');
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
      routeOutcomes: [{ from: '1/1', to: '1/3', failures: 2 }],
      frontiers: []
    });
    expect(result.candidate?.action).toMatchObject({
      name: 'navigate_to',
      args: { destination: '1/4' }
    });
    expect(result.considered.find(({ action }) => action.name === 'navigate_to')?.priority).toBe(70);
  });

  it('finds nearest reachable frontiers from recent authoritative exit observations', () => {
    const routeCosts = new Map([
      ['1/4', 5],
      ['1/5', null],
      ['1/6', 2]
    ]);
    const frontiers = reachableExplorationFrontiers(
      '1/9',
      [
        {
          room: '1/1',
          exits: [{ to: '1/2' }, { to: '1/3' }, { to: '1/4' }, { to: '1/5' }]
        },
        { room: '1/8', exits: [{ to: '1/6' }, { to: '1/9' }] }
      ],
      ['1/1', '1/2', '1/8'],
      ['1/3'],
      (destination) => routeCosts.get(destination) ?? null
    );
    expect(frontiers).toEqual([
      { destination: '1/6', steps: 2 },
      { destination: '1/4', steps: 5 }
    ]);
  });

  it('caps route checks to the most recently observed frontier destinations', () => {
    const observedExits = Array.from({ length: 40 }, (_, index) => ({
      room: `1/${index + 1}`,
      exits: [{ to: `2/${index + 1}` }]
    }));
    const routeSteps = vi.fn((_destination: string) => 1);
    const frontiers = reachableExplorationFrontiers(
      '1/999',
      observedExits,
      [],
      [],
      routeSteps
    );
    expect(routeSteps).toHaveBeenCalledTimes(32);
    expect(routeSteps.mock.calls[0]?.[0]).toBe('2/40');
    expect(frontiers.map(({ destination }) => destination)).toContain('2/9');
    expect(frontiers.map(({ destination }) => destination)).toContain('2/40');
    expect(frontiers.map(({ destination }) => destination)).not.toContain('2/8');
  });

  it('delegates travel to the nearest frontier outside the current room', () => {
    const state = structuredClone(EMPTY_CHARACTER);
    state.room.map = 1;
    state.room.number = 9;
    const result = selectActivity(state, 'explore the area', {
      visitedRooms: ['1/9', '1/2'],
      deadEnds: ['1/3'],
      routeOutcomes: [],
      frontiers: [
        { destination: '1/4', steps: 5 },
        { destination: '1/5', steps: 2 }
      ]
    });
    expect(result.candidate?.action).toMatchObject({
      name: 'navigate_to',
      args: { destination: '1/5' }
    });
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
        routeOutcomes: [],
        frontiers: []
      }).candidate?.action.name
    ).toBe('inspect_room');
    expect(
      selectActivity(state, 'explore', {
        visitedRooms: [],
        deadEnds: ['1/2'],
        routeOutcomes: [],
        frontiers: []
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

  it('does not expose duplicate hostile names as attack candidates', () => {
    const state = structuredClone(EMPTY_CHARACTER);
    const mob = {
      name: 'filthbug',
      kind: 'mob' as const,
      mob: {} as never,
      disposition: 'hostile' as const,
      uncertain: false,
      costly: 'never' as const,
      charmed: false,
      hidden: false,
      free: false
    };
    state.room.occupants = [mob, { ...mob, name: 'Filthbug' }];
    expect(
      selectActivity(state, 'fight an enemy').considered.some(
        ({ action }) => action.name === 'engage_enemy'
      )
    ).toBe(false);
  });

  it('uses reachable frontiers to search for an NPC without pretending one is visible', () => {
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
      }
    ];

    const result = selectActivity(state, 'Find an NPC and inspect it.');

    expect(result.considered.map(({ action }) => action.name)).toEqual(['navigate_to']);
    expect(result.candidate?.action.args).toEqual({ destination: '1/2' });
  });

  it('searches valid frontiers for a required combat target but not optional combat', () => {
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
      }
    ];

    const required = selectActivity(state, 'Fight a suitable hostile mob.');
    expect(required.candidate?.action).toMatchObject({
      name: 'navigate_to',
      args: { destination: '1/2' }
    });
    expect(required.considered.some(({ action }) => action.name === 'engage_enemy')).toBe(false);

    const optional = selectActivity(state, 'Fight a suitable hostile mob if one is available.');
    expect(optional.considered).toEqual([]);

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
    expect(
      selectActivity(state, 'Fight a suitable hostile mob if one is available.').candidate?.action
    ).toMatchObject({ name: 'engage_enemy', args: { name: 'filthbug' } });
  });

  it('never selects an unverified, friendly, or player occupant for combat', () => {
    const state = structuredClone(EMPTY_CHARACTER);
    state.room.occupants = [
      {
        name: 'unknown creature',
        kind: 'mob',
        mob: {} as never,
        disposition: 'hostile',
        uncertain: true,
        costly: 'never',
        charmed: false,
        hidden: false,
        free: false
      },
      {
        name: 'friendly guardian',
        kind: 'mob',
        mob: {} as never,
        disposition: 'passive',
        uncertain: false,
        costly: 'never',
        charmed: false,
        hidden: false,
        free: false
      },
      {
        name: 'another player',
        kind: 'player',
        disposition: null,
        uncertain: false,
        costly: 'never',
        charmed: false,
        hidden: false,
        free: false
      }
    ];

    expect(
      selectActivity(state, 'Fight a suitable hostile mob').considered.some(
        ({ action }) => action.name === 'engage_enemy'
      )
    ).toBe(false);
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
