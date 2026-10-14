import type { AiAction, AiActionName } from '../../shared/ai';
import type { ActivityCandidate } from './ActivitySelector';

export type SchedulerStatus = 'idle' | 'executing' | 'completed' | 'blocked' | 'interrupted';
export interface ActivityJournalEntry {
  successes: number;
  failures: number;
  stalls: number;
}
/** Cumulative campaign memory; survives reset/interrupt, cleared only by orget. */
export interface SchedulerJournal {
  activities: Partial<Record<AiActionName, ActivityJournalEntry>>;
  avoided: AiActionName[];
  strategyChanges: number;
  lastStrategyChange: string | null;
}
export interface SchedulerSnapshot {
  version: 1;
  journal: SchedulerJournal;
  completed: AiActionName[];
}
const blankJournal = (): SchedulerJournal => ({
  activities: {},
  avoided: [],
  strategyChanges: 0,
  lastStrategyChange: null
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
  private lastResult: string | null = null;
  constructor(
    private readonly maxFailures = 3,
    private readonly stallLimit = 2
  ) {}
  /** Drops the long-horizon journal, for an explicitly cleared goal. */
  forget(): void {
    this.journal = blankJournal();
    this.lastResult = null;
    this.reset();
  }
  snapshot(): SchedulerSnapshot {
    return {
      version: 1,
      journal: structuredClone(this.journal),
      completed: [...this.state.completed]
    };
  }
  restore(snapshot: SchedulerSnapshot): void {
    if (snapshot?.version !== 1) return;
    this.reset();
    this.journal = { ...blankJournal(), ...structuredClone(snapshot.journal) };
    this.state.completed = [...snapshot.completed];
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
  finish(ok: boolean, observation: string): void {
    if (!this.state.current) return;
    const name = this.state.current.name;
    const entry = this.entry(name);
    if (ok) {
      entry.successes += 1;
      // A success that changes nothing the world reports is not progress.
      if (observation === this.lastResult) {
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
    this.lastResult = observation;
    this.state.lastObservation = observation;
  }
  interrupt(): void {
    this.state.current = null;
    this.state.status = 'interrupted';
    this.state.lastObservation = null;
  }
}
