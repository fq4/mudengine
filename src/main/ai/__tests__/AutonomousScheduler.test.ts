import { describe, expect, it } from 'vitest';
import { AutonomousScheduler, type SchedulerProgress } from '../AutonomousScheduler';

const progress = (
  room: string | null = null,
  experience: number | null = null,
  hpRatio: number | null = null
): SchedulerProgress => ({ room, experience, hpRatio });

const candidates = [
  {
    action: { name: 'inspect_room' as const, reason: 'observe' },
    priority: 10,
    rationale: 'observe'
  },
  { action: { name: 'inspect_inventory' as const, reason: 'pack' }, priority: 5, rationale: 'pack' }
];

describe('AutonomousScheduler', () => {
  it('transitions activity completion and avoids repeated observation loops', () => {
    const scheduler = new AutonomousScheduler();
    expect(scheduler.choose(candidates, 'room-a')?.name).toBe('inspect_room');
    scheduler.finish(true, progress('1/1'));
    expect(scheduler.choose(candidates, 'inventory-needed')?.name).toBe('inspect_inventory');
    scheduler.finish(true, progress('1/2'));
    expect(scheduler.choose(candidates, 'fresh-complete-observation')).toBeNull();
    expect(scheduler.state.status).toBe('completed');
  });
  it('blocks after repeated failures and supports interruption', () => {
    const scheduler = new AutonomousScheduler(2);
    scheduler.choose(candidates, 'fresh');
    scheduler.finish(false, progress());
    scheduler.choose(candidates, 'fresh-2');
    scheduler.finish(false, progress());
    expect(scheduler.state.status).toBe('blocked');
    scheduler.interrupt();
    expect(scheduler.state.status).toBe('interrupted');
    expect(scheduler.state.lastObservation).toBeNull();
  });
  it('resets stale observation state when restarting autonomous work', () => {
    const scheduler = new AutonomousScheduler();
    scheduler.choose(candidates, 'room-a');
    scheduler.finish(true, progress('1/1'));
    expect(scheduler.state.completed).toContain('inspect_room');
    scheduler.interrupt();
    scheduler.reset();
    expect(scheduler.state.status).toBe('idle');
    expect(scheduler.state.completed).toEqual([]);
    expect(scheduler.state.lastObservation).toBeNull();
  });

  it('supports a full transition cycle across repeated authoritative observations', () => {
    const scheduler = new AutonomousScheduler(2);
    expect(scheduler.choose(candidates, 'initial-room')).toBeDefined();
    scheduler.finish(true, progress('1/1'));
    expect(scheduler.choose(candidates, 'inventory-needed')?.name).toBe('inspect_inventory');
    scheduler.finish(false, progress('1/1'));
    expect(scheduler.state.status).toBe('idle');
    expect(scheduler.choose(candidates, 'inventory-needed-again')?.name).toBe('inspect_inventory');
    scheduler.finish(true, progress('1/1', 25));
    expect(scheduler.state.status).toBe('idle');
    expect(scheduler.choose(candidates, 'fresh-observation')).toBeNull();
    expect(scheduler.state.status).toBe('completed');
  });

  describe('long-horizon journal', () => {
    it('abandons an activity that keeps producing the same result across cycles', () => {
      const scheduler = new AutonomousScheduler(3, 2);
      for (let cycle = 0; cycle < 3; cycle++) {
        const action = scheduler.choose(candidates, 'room-' + cycle);
        if (!action) break;
        scheduler.finish(true, progress('1/1'));
        scheduler.interrupt();
        scheduler.reset();
      }
      expect(scheduler.journal.avoided).toContain('inspect_room');
      expect(scheduler.journal.strategyChanges).toBe(1);
      expect(scheduler.choose(candidates, 'fresh')?.name).toBe('inspect_inventory');
    });
    it('never avoids recovery', () => {
      const recover = [
        { action: { name: 'recover_health' as const, reason: 'hp' }, priority: 100, rationale: 'hp' }
      ];
      const scheduler = new AutonomousScheduler(3, 1);
      for (let i = 0; i < 3; i++) {
        expect(scheduler.choose(recover, 'low-' + i)?.name).toBe('recover_health');
        scheduler.finish(true, progress('1/1', null, 0.4));
        scheduler.reset();
      }
      expect(scheduler.journal.avoided).toEqual([]);
    });
    it('keeps the journal through interrupt and reset but drops it on forget', () => {
      const scheduler = new AutonomousScheduler();
      scheduler.choose(candidates, 'a');
      scheduler.finish(false, progress());
      scheduler.interrupt();
      scheduler.reset();
      expect(scheduler.journal.activities.inspect_room?.failures).toBe(1);
      scheduler.forget();
      expect(scheduler.journal.activities).toEqual({});
    });
    it('resumes an interrupted campaign without losing completed work', () => {
      const scheduler = new AutonomousScheduler();
      scheduler.choose(candidates, 'a');
      scheduler.finish(true, progress());
      scheduler.interrupt();
      expect(scheduler.choose(candidates, 'b')).toBeNull();
      scheduler.resume();
      expect(scheduler.choose(candidates, 'b')?.name).toBe('inspect_inventory');
      expect(scheduler.state.completed).toEqual(['inspect_room']);
    });
    it('round-trips a snapshot', () => {
      const a = new AutonomousScheduler(3, 1);
      a.choose(candidates, 'a');
      a.finish(true, progress('1/1'));
      a.reset();
      a.choose(candidates, 'b');
      a.finish(true, progress('1/1'));
      const b = new AutonomousScheduler();
      b.restore(JSON.parse(JSON.stringify(a.snapshot())));
      expect(b.journal.avoided).toEqual(['inspect_room']);
      expect(b.snapshot()).toEqual(a.snapshot());
    });

    it('rejects malformed or unsupported snapshots without changing current state', () => {
      const scheduler = new AutonomousScheduler();
      scheduler.choose(candidates, 'current');
      const before = scheduler.snapshot();
      expect(scheduler.restore({ version: 2 })).toBe(false);
      expect(scheduler.snapshot()).toEqual(before);
    });

    it('counts newly visited rooms, XP, and improved HP as authoritative progress', () => {
      const scheduler = new AutonomousScheduler(3, 1);
      scheduler.choose(candidates, 'a');
      scheduler.finish(true, progress('2/4', 100, 0.25));
      expect(scheduler.journal.visitedRooms).toEqual(['2/4']);
      expect(scheduler.journal.highestExperience).toBe(100);
      expect(scheduler.journal.bestHpRatio).toBe(0.25);
      scheduler.reset();
      scheduler.choose(candidates, 'b');
      scheduler.finish(true, progress('2/4', 101, 0.5));
      expect(scheduler.journal.avoided).toEqual([]);
      expect(scheduler.journal.visitedRooms).toEqual(['2/4']);
      expect(scheduler.journal.highestExperience).toBe(101);
      expect(scheduler.journal.bestHpRatio).toBe(0.5);
    });

    it('persists bounded route outcomes and revisable dead-end observations', () => {
      const scheduler = new AutonomousScheduler();
      scheduler.recordRouteOutcome('1/1', '1/2', false);
      scheduler.recordRouteOutcome('1/1', '1/2', true);
      expect(scheduler.rememberDeadEnd('1/3', true)).toBe(true);
      expect(scheduler.rememberDeadEnd('1/3', true)).toBe(false);
      const restored = new AutonomousScheduler();
      expect(restored.restore(scheduler.snapshot())).toBe(true);
      expect(restored.journal.routeOutcomes).toEqual([
        { from: '1/1', to: '1/2', attempts: 2, arrivals: 1, failures: 1 }
      ]);
      expect(restored.journal.deadEnds).toEqual(['1/3']);
      expect(restored.rememberDeadEnd('1/3', false)).toBe(true);
      expect(restored.journal.deadEnds).toEqual([]);
    });

    it('stores bounded authoritative room exits and marks observed rooms visited', () => {
      const scheduler = new AutonomousScheduler();
      const exits = [
        { direction: 'north', to: '1/2' },
        { direction: 'east', to: '1/3' }
      ];
      expect(scheduler.recordRoomObservation('1/1', exits, false)).toBe(true);
      expect(scheduler.recordRoomObservation('1/1', exits, false)).toBe(false);
      expect(scheduler.journal.visitedRooms).toEqual(['1/1']);
      expect(scheduler.journal.observedExits).toEqual([{ room: '1/1', exits }]);
      const restored = new AutonomousScheduler();
      expect(restored.restore(scheduler.snapshot())).toBe(true);
      expect(restored.journal.observedExits).toEqual([{ room: '1/1', exits }]);
    });

    it('restores version-one snapshots created before exploration memory', () => {
      const scheduler = new AutonomousScheduler();
      const legacySnapshot = scheduler.snapshot();
      delete (legacySnapshot.journal as Partial<typeof legacySnapshot.journal>).deadEnds;
      delete (legacySnapshot.journal as Partial<typeof legacySnapshot.journal>).routeOutcomes;
      delete (legacySnapshot.journal as Partial<typeof legacySnapshot.journal>).observedExits;
      const restored = new AutonomousScheduler();
      expect(restored.restore(legacySnapshot)).toBe(true);
      expect(restored.journal.deadEnds).toEqual([]);
      expect(restored.journal.routeOutcomes).toEqual([]);
      expect(restored.journal.observedExits).toEqual([]);
    });

    it('rejects malformed remembered exit graphs without changing scheduler state', () => {
      const scheduler = new AutonomousScheduler();
      const invalid = scheduler.snapshot();
      invalid.journal.observedExits = [{ room: '1/1', exits: [{ direction: 'north', to: 'wrong' }] }];
      expect(scheduler.restore(invalid)).toBe(false);
      expect(scheduler.journal.observedExits).toEqual([]);
    });
  });
});
