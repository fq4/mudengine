import { describe, expect, it } from 'vitest';
import { aiStateView } from '../StateView';
import { EMPTY_CHARACTER } from '../../../shared/character';

describe('aiStateView', () => {
  it('preserves unknown values and exposes structured room/navigation state', () => {
    const state = aiStateView({ ...EMPTY_CHARACTER, room: { ...EMPTY_CHARACTER.room, name: 'Guild Street', arrival: 42 } }, {
      status: 'walking', asked: true, done: 2, total: 5, destination: 'Bank', destinationRoom: { map: 1, room: 9 },
      step: null, path: [], ahead: ['Bank'], reason: null, hold: null
    });
    expect(state.character.vitals.hp.value).toBeNull();
    expect(state.character.vitals.hp.observedAt).toBeNull();
    expect(state.room.name).toBe('Guild Street');
    expect(state.room.knownAt).toBe(42);
    expect(state.navigation).toMatchObject({ status: 'walking', done: 2, total: 5 });
  });
});
