import { AI_ACTIONS, type AiAction, type AiActionName } from '../../shared/ai';
import type { ActivityCandidate } from './ActivitySelector';

export type SchedulerStatus = 'idle' | 'executing' | 'completed' | 'blocked' | 'interrupted';
export interface ActivityJournalEntry {
  successes: number;
  failures: number;
  stalls: number;
}
export interface SchedulerProgress {
  room: string | null;
  experience: number | null;
  hpRatio: number | null;
}
/** Cumulative campaign memory; survives reset/interrupt, cleared only by forget. */
export interface SchedulerJournal {
  activities: Partial<Record<AiActionName, ActivityJournalEntry>>;
  avoided: AiActionName[];
  strategyChanges: number;
  lastStrategyChange: string | null;
  visitedRooms: string[];
  highestExperience: number | null;
  bestHpRatio: number | null;
}
export interface SchedulerSnapshot {
  version: 1;
  journal: SchedulerJournal;
  completed: AiActionName[];
}
export interface SchedulerSnapshotStore {
  read(): unknown | null;
  write(snapshot: SchedulerSnapshot): void;
}
const blankJournal = (): SchedulerJournal => ({
  activities: {},
  avoided: [],
  strategyChanges: 0,
  lastStrategyChange: null,
  visitedRooms: [],
  highestExperience: null,
  bestHpRatio: null
});
/** Recovery is never abandoned by strategy: it is the safety priority. */
const NEVER_AVOID: readonly AiActionName[] = ['recover_health'];

export interface SchedulerState {
  status: SchedulerStatus;
  current: AiAction | null;
  completed: AiActionName[];
  failures: number;
  lastObservation: string | null;
}

/** Small transition guard for long-lived activity selection. */
export class AutonomousScheduler {
  readonly state: SchedulerState = {
    status: 'idle',
    current: null,
    completed: [],
    failures: 0,
    lastObservation: null
  };
  journal: SchedulerJournal = blankJournal();
  private readonly visitedRooms = new Set<string>();
  constructor(
    private readonly maxFailures = 3,
    private readonly stallLimit = 2
  ) {}
  /** Drops the long-horizon journal, for an explicitly cleared goal. */
  forget(): void {
    this.journal = blankJournal();
    this.visitedRooms.clear();
    this.reset();
  }
  snapshot(): SchedulerSnapshot {
    return {
      version: 1,
      journal: structuredClone(this.journal),
      completed: [...this.state.completed]
    };
  }
  restore(value: unknown): boolean {
    if (!isSchedulerSnapshot(value)) return false;
    this.reset();
    this.journal = { ...blankJournal(), ...structuredClone(value.journal) };
    this.visitedRooms.clear();
    for (const room of this.journal.visitedRooms) this.visitedRooms.add(room);
    this.state.completed = [...value.completed];
    return true;
  }

  /** Resumes an interrupted campaign without losing what it has learned. */
  resume(): void {
    if (this.state.status !== 'interrupted') return;
    this.state.status = 'idle';
    this.state.lastObservation = null;
  }
  private entry(name: AiActionName): ActivityJournalEntry {
    return (this.journal.activities[name] ??= { successes: 0, failures: 0, stalls: 0 });
  }
  reset(): void {
    this.state.status = 'idle';
    this.state.current = null;
    this.state.completed = [];
    this.state.failures = 0;
    this.state.lastObservation = null;
  }
  clearCompleted(): void {
    this.state.completed = [];
  }
  choose(candidates: readonly ActivityCandidate[], observation: string): AiAction | null {
    if (
      this.state.status === 'completed' ||
      this.state.status === 'blocked' ||
      this.state.status === 'interrupted'
    )
      return null;
    if (observation === this.state.lastObservation && this.state.current === null) return null;
    this.state.lastObservation = observation;
    const next = candidates.find(
      ({ action }) =>
        !this.state.completed.includes(action.name) && !this.journal.avoided.includes(action.name)
    );
    if (!next) {
      this.state.status = 'completed';
      return null;
    }
    this.state.current = next.action;
    this.state.status = 'executing';
    return next.action;
  }
  finish(ok: boolean, progress: SchedulerProgress): void {
    if (!this.state.current) return;
    const name = this.state.current.name;
    const entry = this.entry(name);
    if (ok) {
      entry.successes += 1;
      const before = this.progressFingerprint();
      this.recordProgress(progress);
      if (before === this.progressFingerprint()) {
        entry.stalls += 1;
        if (entry.stalls >= this.stallLimit && !NEVER_AVOID.includes(name)) {
          if (!this.journal.avoided.includes(name)) this.journal.avoided.push(name);
          this.journal.strategyChanges += 1;
          this.journal.lastStrategyChange = `${name} stalled after ${entry.stalls} unchanged results`;
        }
      } else entry.stalls = 0;
      this.state.completed.push(name);
      this.state.failures = 0;
      this.state.current = null;
      this.state.status = 'idle';
    } else {
      entry.failures += 1;
      this.state.failures += 1;
      this.state.current = null;
      this.state.status = this.state.failures >= this.maxFailures ? 'blocked' : 'idle';
    }
    this.state.lastObservation = JSON.stringify(progress);
  }
  interrupt(): void {
    this.state.current = null;
    this.state.status = 'interrupted';
    this.state.lastObservation = null;
  }

  private recordProgress(progress: SchedulerProgress): void {
    if (progress.room && !this.visitedRooms.has(progress.room)) {
      this.visitedRooms.add(progress.room);
      this.journal.visitedRooms.push(progress.room);
    }
    if (
      progress.experience !== null &&
      Number.isFinite(progress.experience) &&
      (this.journal.highestExperience === null ||
        progress.experience > this.journal.highestExperience)
    )
      this.journal.highestExperience = progress.experience;
    if (
      progress.hpRatio !== null &&
      Number.isFinite(progress.hpRatio) &&
      progress.hpRatio >= 0 &&
      progress.hpRatio <= 1 &&
      (this.journal.bestHpRatio === null || progress.hpRatio > this.journal.bestHpRatio)
    )
      this.journal.bestHpRatio = progress.hpRatio;
  }

  private progressFingerprint(): string {
    return JSON.stringify({
      rooms: this.journal.visitedRooms,
      experience: this.journal.highestExperience,
      hpRatio: this.journal.bestHpRatio
    });
  }
}

export function isSchedulerSnapshot(value: unknown): value is SchedulerSnapshot {
  if (value === null || typeof value !== 'object') return false;
  const snapshot = value as Partial<SchedulerSnapshot>;
  const journal = snapshot.journal;
  if (
    snapshot.version !== 1 ||
    !journal ||
    !Array.isArray(snapshot.completed) ||
    !snapshot.completed.every((name) => AI_ACTIONS.includes(name)) ||
    !Array.isArray(journal.avoided) ||
    !journal.avoided.every((name) => AI_ACTIONS.includes(name)) ||
    !Array.isArray(journal.visitedRooms) ||
    !journal.visitedRooms.every((room) => typeof room === 'string') ||
    typeof journal.activities !== 'object' ||
    journal.activities === null ||
    Array.isArray(journal.activities) ||
    !Number.isInteger(journal.strategyChanges) ||
    !(journal.lastStrategyChange === null || typeof journal.lastStrategyChange === 'string') ||
    !(journal.highestExperience === null || Number.isFinite(journal.highestExperience)) ||
    !(
      journal.bestHpRatio === null ||
      (Number.isFinite(journal.bestHpRatio) && journal.bestHpRatio >= 0 && journal.bestHpRatio <= 1)
    )
  )
    return false;
  return Object.entries(journal.activities).every(
    ([name, entry]) =>
      AI_ACTIONS.includes(name as AiActionName) &&
      entry !== undefined &&
      entry !== null &&
      typeof entry === 'object' &&
      Number.isInteger(entry.successes) &&
      Number.isInteger(entry.failures) &&
      Number.isInteger(entry.stalls)
  );
}
