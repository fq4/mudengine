import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AutonomousScheduler } from '../AutonomousScheduler';
import { FileSchedulerSnapshotStore } from '../AutonomousSchedulerStore';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('FileSchedulerSnapshotStore', () => {
  it('persists and restores a versioned campaign snapshot', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mud-scheduler-'));
    directories.push(directory);
    const store = new FileSchedulerSnapshotStore(path.join(directory, 'scheduler.json'));
    const scheduler = new AutonomousScheduler();
    scheduler.choose(
      [{ action: { name: 'inspect_room', reason: 'observe' }, priority: 1, rationale: 'observe' }],
      'start'
    );
    scheduler.finish(true, { room: '3/17', experience: 120, hpRatio: 0.75 });
    store.write(scheduler.snapshot());

    const restored = new AutonomousScheduler();
    expect(restored.restore(store.read())).toBe(true);
    expect(restored.snapshot()).toEqual(scheduler.snapshot());
  });

  it('returns null for a file that has not been created and surfaces malformed JSON', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mud-scheduler-empty-'));
    directories.push(directory);
    const file = path.join(directory, 'scheduler.json');
    const store = new FileSchedulerSnapshotStore(file);
    expect(store.read()).toBeNull();
    fs.writeFileSync(file, '{broken', 'utf8');
    expect(() => store.read()).toThrow(SyntaxError);
  });
});
