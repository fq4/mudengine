import { AI_ACTIONS, type AiAction, type AiActionName } from '../../shared/ai';
import type { ActivityCandidate } from './ActivitySelector';

export type SchedulerStatus = 'idle' | 'executing' | 'completed' | 'blocked' | 'interrupted';
export interface ActivityJournalEntry {
  successes: number;
  failures: number;
  stalls: number;
}
export interface ExplorationRouteOutcome {
  from: string;
  to: string;
  attempts: number;
  arrivals: number;
  failures: number;
}
export interface ObservedExplorationExit {
  direction: string;
  to: string;
}
export interface ObservedExplorationRoom {
  room: string;
  exits: ObservedExplorationExit[];
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
  deadEnds: string[];
  routeOutcomes: ExplorationRouteOutcome[];
  observedExits: ObservedExplorationRoom[];
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
  deadEnds: [],
  routeOutcomes: [],
  observedExits: [],
  highestExperience: null,
  bestHpRatio: null
});
/** Recovery is never abandoned by strategy: it is the safety priority. */
const NEVER_AVOID: readonly AiActionName[] = ['recover_health'];
const MAX_EXPLORATION_RECORDS = 256;
const MAX_OBSERVED_EXITS_PER_ROOM = 64;

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
    this.journal = {
      ...blankJournal(),
      ...structuredClone(value.journal),
      deadEnds: value.journal.deadEnds ?? [],
      routeOutcomes: value.journal.routeOutcomes ?? [],
      observedExits: value.journal.observedExits ?? []
    };
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
  rememberDeadEnd(room: string, isDeadEnd: boolean): boolean {
    if (isDeadEnd) {
      if (this.journal.deadEnds.includes(room)) return false;
      this.journal.deadEnds.push(room);
      if (this.journal.deadEnds.length > MAX_EXPLORATION_RECORDS)
        this.journal.deadEnds.shift();
      return true;
    }
    const kept = this.journal.deadEnds.filter((known) => known !== room);
    if (kept.length === this.journal.deadEnds.length) return false;
    this.journal.deadEnds = kept;
    return true;
  }
  recordRouteOutcome(from: string, to: string, arrived: boolean): void {
    let outcome = this.journal.routeOutcomes.find((route) => route.from === from && route.to === to);
    if (!outcome) {
      outcome = { from, to, attempts: 0, arrivals: 0, failures: 0 };
      this.journal.routeOutcomes.push(outcome);
      if (this.journal.routeOutcomes.length > MAX_EXPLORATION_RECORDS)
        this.journal.routeOutcomes.shift();
    }
    outcome.attempts += 1;
    if (arrived) outcome.arrivals += 1;
    else outcome.failures += 1;
  }
  recordRoomObservation(
    room: string,
    exits: readonly ObservedExplorationExit[],
    deadEnd: boolean
  ): boolean {
    let changed = false;
    if (!this.visitedRooms.has(room)) {
      this.visitedRooms.add(room);
      this.journal.visitedRooms.push(room);
      changed = true;
    }
    const observation: ObservedExplorationRoom = {
      room,
      exits: exits
        .slice(0, MAX_OBSERVED_EXITS_PER_ROOM)
        .map(({ direction, to }) => ({ direction: direction.slice(0, 64), to }))
    };
    const existing = this.journal.observedExits.findIndex((known) => known.room === room);
    if (existing >= 0) {
      const previous = this.journal.observedExits[existing];
      if (JSON.stringify(previous) !== JSON.stringify(observation)) {
        changed = true;
        this.journal.observedExits.splice(existing, 1);
        this.journal.observedExits.push(observation);
      }
    } else changed = true;
    if (existing < 0) this.journal.observedExits.push(observation);
    if (this.journal.observedExits.length > MAX_EXPLORATION_RECORDS)
      this.journal.observedExits.shift();
    return this.rememberDeadEnd(room, deadEnd) || changed;
  }
  choose(candidates: readonly ActivityCandidate[], observation: string): AiAction | null {
    const recoveryAvailable = candidates.some(({ action }) => action.name === 'recover_health');
    if (this.state.status === 'completed') {
      if (!recoveryAvailable || observation === this.state.lastObservation) return null;
      this.state.status = 'idle';
    }
    if (
      this.state.status === 'blocked' ||
      this.state.status === 'interrupted'
    )
      return null;
    if (observation === this.state.lastObservation && this.state.current === null) return null;
    this.state.lastObservation = observation;
    const next = candidates.find(
      ({ action }) =>
        (action.name === 'recover_health' || !this.state.completed.includes(action.name)) &&
        !this.journal.avoided.includes(action.name)
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
      if (!this.state.completed.includes(name)) this.state.completed.push(name);
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
    (journal.deadEnds !== undefined &&
      (!Array.isArray(journal.deadEnds) ||
        journal.deadEnds.length > MAX_EXPLORATION_RECORDS ||
        !journal.deadEnds.every((room) => typeof room === 'string'))) ||
    (journal.routeOutcomes !== undefined &&
      (!Array.isArray(journal.routeOutcomes) ||
        journal.routeOutcomes.length > MAX_EXPLORATION_RECORDS ||
        !journal.routeOutcomes.every(
          (route) =>
            route !== null &&
            typeof route === 'object' &&
            typeof route.from === 'string' &&
            typeof route.to === 'string' &&
            Number.isInteger(route.attempts) &&
            route.attempts >= 0 &&
            Number.isInteger(route.arrivals) &&
            route.arrivals >= 0 &&
            Number.isInteger(route.failures) &&
            route.failures >= 0 &&
            route.arrivals + route.failures === route.attempts
        ))) ||
    (journal.observedExits !== undefined &&
      (!Array.isArray(journal.observedExits) ||
        journal.observedExits.length > MAX_EXPLORATION_RECORDS ||
        !journal.observedExits.every(
          (observation) =>
            observation !== null &&
            typeof observation === 'object' &&
            typeof observation.room === 'string' &&
            /^\d{1,3}\/\d{1,6}$/.test(observation.room) &&
            Array.isArray(observation.exits) &&
            observation.exits.length <= MAX_OBSERVED_EXITS_PER_ROOM &&
            observation.exits.every(
              (exit) =>
                exit !== null &&
                typeof exit === 'object' &&
                typeof exit.direction === 'string' &&
                exit.direction.length <= 64 &&
                typeof exit.to === 'string' &&
                /^\d{1,3}\/\d{1,6}$/.test(exit.to)
            )
        ))) ||
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
