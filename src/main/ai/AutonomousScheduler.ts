import type { AiAction, AiActionName } from '../../shared/ai';
import type { ActivityCandidate } from './ActivitySelector';

export type SchedulerStatus = 'idle' | 'executing' | 'completed' | 'blocked' | 'interrupted';
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
  constructor(private readonly maxFailures = 3) {}
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
    const next = candidates.find(({ action }) => !this.state.completed.includes(action.name));
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
    if (ok) {
      this.state.completed.push(this.state.current.name);
      this.state.failures = 0;
      this.state.current = null;
      this.state.status = 'idle';
    } else {
      this.state.failures += 1;
      this.state.current = null;
      this.state.status = this.state.failures >= this.maxFailures ? 'blocked' : 'idle';
    }
    this.state.lastObservation = observation;
  }
  interrupt(): void {
    this.state.current = null;
    this.state.status = 'interrupted';
  }
}
