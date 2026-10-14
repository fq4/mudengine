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
  });
});
