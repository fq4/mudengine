import { describe, expect, it } from 'vitest';
import { AutonomousScheduler } from '../AutonomousScheduler';

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
    scheduler.finish(true, 'room-a-observed');
    expect(scheduler.choose(candidates, 'inventory-needed')?.name).toBe('inspect_inventory');
    scheduler.finish(true, 'inventory-observed');
    expect(scheduler.choose(candidates, 'fresh-complete-observation')).toBeNull();
    expect(scheduler.state.status).toBe('completed');
  });
  it('blocks after repeated failures and supports interruption', () => {
    const scheduler = new AutonomousScheduler(2);
    scheduler.choose(candidates, 'fresh');
    scheduler.finish(false, 'failed-1');
    scheduler.choose(candidates, 'fresh-2');
    scheduler.finish(false, 'failed-2');
    expect(scheduler.state.status).toBe('blocked');
    scheduler.interrupt();
    expect(scheduler.state.status).toBe('interrupted');
    expect(scheduler.state.lastObservation).toBeNull();
  });
  it('resets stale observation state when restarting autonomous work', () => {
    const scheduler = new AutonomousScheduler();
    scheduler.choose(candidates, 'room-a');
    scheduler.finish(true, 'room-a-observed');
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
    scheduler.finish(true, 'room-observed');
    expect(scheduler.choose(candidates, 'inventory-needed')?.name).toBe('inspect_inventory');
    scheduler.finish(false, 'inventory-failed');
    expect(scheduler.state.status).toBe('idle');
    expect(scheduler.choose(candidates, 'inventory-needed-again')?.name).toBe('inspect_inventory');
    scheduler.finish(true, 'inventory-recovered');
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
        scheduler.finish(true, 'same-result');
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
        scheduler.finish(true, 'same');
        scheduler.reset();
      }
      expect(scheduler.journal.avoided).toEqual([]);
    });
    it('keeps the journal through interrupt and reset but drops it on forget', () => {
      const scheduler = new AutonomousScheduler();
      scheduler.choose(candidates, 'a');
      scheduler.finish(false, 'x');
      scheduler.interrupt();
      scheduler.reset();
      expect(scheduler.journal.activities.inspect_room?.failures).toBe(1);
      scheduler.forget();
      expect(scheduler.journal.activities).toEqual({});
    });
    it('resumes an interrupted campaign without losing completed work', () => {
      const scheduler = new AutonomousScheduler();
      scheduler.choose(candidates, 'a');
      scheduler.finish(true, 'x');
      scheduler.interrupt();
      expect(scheduler.choose(candidates, 'b')).toBeNull();
      scheduler.resume();
      expect(scheduler.choose(candidates, 'b')?.name).toBe('inspect_inventory');
      expect(scheduler.state.completed).toEqual(['inspect_room']);
    });
    it('round-trips a snapshot', () => {
      const a = new AutonomousScheduler(3, 1);
      a.choose(candidates, 'a');
      a.finish(true, 's');
      a.reset();
      a.choose(candidates, 'b');
      a.finish(true, 's');
      const b = new AutonomousScheduler();
      b.restore(JSON.parse(JSON.stringify(a.snapshot())));
      expect(b.journal.avoided).toEqual(['inspect_room']);
      expect(b.snapshot()).toEqual(a.snapshot());
    });
  });
});
