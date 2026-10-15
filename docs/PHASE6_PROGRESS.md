# Phase 6 Progress

Phase 6 makes the autonomous player more capable using the existing
architecture. No parallel execution engine exists or should be added:
`SessionManager` is the boundary, `CommandQueue` is the funnel, and Walker,
AutoCombat, Recovery, EquipmentManager and friends own their loops.

## Implemented (deterministic)

- **Decision observability.** `AiDecisionTrace` (`src/shared/ai.ts`) records the
  objective, ranked candidates and reason for each decision.
- **World-state reasoning.** `summarizeWorldState` / `selectActivity`
  (`src/main/ai/ActivitySelector.ts`) rank policy-filtered activities from
  authoritative state; recovery uses the real HP ratio and always outranks
  other work.
- **Migration test race fixed** (`src/main/config/Migration.ts` ordering and
  isolated temp-home cleanup). Full suite passes repeatedly.
- **Long-horizon campaign journal** (`src/main/ai/AutonomousScheduler.ts`):
  - `journal` records per-activity successes, failures and stalls, visited
    room IDs, highest XP, best HP ratio, avoided activities, strategy changes
    and `lastStrategyChange`.
  - Stall detection uses cumulative authoritative tracker progress rather than
    comparing result text; `recover_health` is never avoided.
  - The journal survives `reset()`, `interrupt()` and `aiStop()`/emergency
    stop; it is dropped only by `forget()`, which `aiClearGoal()` calls.
  - `snapshot()` / `restore()` provide a validated, versioned JSON-safe form.
    A per-session file store restores it at session construction and saves it
    atomically under the user-scoped state directory. Active actions are not
    persisted or resumed blindly.
  - Supported multi-step explicit objectives are driven through
    `ObjectivePlan` + `AutonomousScheduler`, using fresh tracker state and
    existing policy-gated action execution. Walker, AutoCombat, Recovery and
    EquipmentManager still own their delegated activity loops. Failed steps
    are reconsidered only after an authoritative observation changes;
    unsupported plans retain the provider/planner path.
  - `SessionManager.finishAutonomous` surfaces strategy changes and records
    a 24-hour `strategy` AI memory when a memory store exists.
- **Bounded exploration memory** (`AutonomousScheduler` and
  `ActivitySelector`):
  - The session journal records confirmed dead-end rooms and per-route attempts,
    arrivals and failures. Dead-end observations are removed if a later
    authoritative room state reports exits; route history is capped at 256
    route pairs.
  - Up to 256 room observations persist server-listed, mapped exits that need
    no requirement. From each current room, the existing `WorldGraph` ranks
    reachable unvisited destinations; only bounded candidates are exposed.
    `Walker` still performs and verifies the route.
  - Exploration ranks only currently printed, mapped exits without
    requirements, excludes already visited or remembered dead-end destinations,
    and prefers nearer destinations and routes with fewer failures. Arrivals
    are confirmed by Walker's end callback, while failures require an explicit
    Walker exit-refusal signal. Unattempted or interrupted walks are not
    recorded as failed routes.
  - Version-one scheduler snapshots created before these fields are accepted
    and restored with empty exploration memory.
- Tests: `AutonomousScheduler.test.ts`, `AutonomousSchedulerStore.test.ts`,
  `ObjectivePlan.test.ts`, and SessionManager/SessionHost coverage verify
  progress signals, snapshot persistence, broad-objective routing, and
  isolation by session.

## Not done yet

1. Objectives and active plans/actions intentionally remain transient. After
   reconnect, require a fresh objective and observation rather than resuming
   stale work.
2. Scheduler-backed explicit goals are limited to supported
   `ObjectivePlan` steps; unsupported or broader plans continue on the
   provider/planner path.
3. Frontier exploration only considers exits previously listed by the server
   and reachable through the current `WorldGraph` route. Routes dependent on
   unobserved exits or unknown destinations remain unavailable.
4. Candidate selection remains deliberately small (`inspect_*`, recovery,
   equipment, navigation, engage). Add other activities only when delegated
   to production owners and policy-gated.
5. Live provider verification of any Phase 5/6 behaviour remains deferred;
   no provider tests were run in this checkpoint.

## Known issues

- `npm run lint` fails the pre-existing repo-wide Prettier baseline. Do not
  mass-format.
- Legacy live navigation scenarios may fail when recovery takes priority or
  the model omits a destination; this is intended safety behaviour.
- Windows PowerShell here-strings with `${...}` interpolate; write TS files
  with the editor tools, not shell string rewrites.

## Verification (this checkpoint)

- Focused exploration and SessionManager tests: 280 passed.
- Node and renderer typechecks: passed.
- Production build: passed; the existing large-renderer-chunk warning remains.
- Secret scan: passed against the configured user-scoped profile data.
- Full suite: 6,967 passed, 2 skipped, and 1 unrelated
  `ConfigStore.test.ts` watcher failure (`no change event`). The same watcher
  test has failed in isolation before; `SessionLog.test.ts` passed in this run.
- No provider or live-server tests were run.

## Next recommended task

Add a deterministic autonomous-session lifecycle test that completes a
Walker-owned frontier trip, records the newly observed room, and chooses the
next frontier without resuming stale navigation after interruption.

## Environment on a new computer
```powershell
git clone https://github.com/fq4/mudengine.git   # or: git pull --ff-only
cd mudengine
git switch development
git pull --ff-only origin development
npm ci
node --version   # >= 20
npm run typecheck
npm test
npm run build
npm run check:secrets
```

- No secrets are needed for any deterministic work.
- `.env` (untracked; copy from `.env.example`) holds `OPENROUTER_API_KEY` and
  optional `MUDENGINE_AI_MODEL`, needed only for the live harness.
- The `kefka` profile and game credentials are user-scoped local settings
  (under the user's app-data `mudengine` directory); recreate via the UI.
  `npm run check:secrets` scans that directory against configured passwords.
- Do not commit `.env`, `.npm-cache/`, `out/`, `dist/`, captures or logs.
