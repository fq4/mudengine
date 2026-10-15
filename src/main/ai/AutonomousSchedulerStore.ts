import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  SchedulerSnapshot,
  SchedulerSnapshotStore
} from './AutonomousScheduler';

export class FileSchedulerSnapshotStore implements SchedulerSnapshotStore {
  constructor(private readonly file: string) {}

  read(): unknown | null {
    let serialized: string;
    try {
      serialized = fs.readFileSync(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    return JSON.parse(serialized) as unknown;
  }

  write(snapshot: SchedulerSnapshot): void {
    const directory = path.dirname(this.file);
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(snapshot), { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporary, this.file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
}
