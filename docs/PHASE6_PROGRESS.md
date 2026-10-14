# Phase 6 Progress

Phase 6 makes the autonomous player more capable using the existing
architecture. No parallel execution engine exists or should be added:
`SessionManager` is the boundary, `CommandQueue` is the funnel, and Walker,
AutoCombat, Recovery, EquipmentManager and friends own their loops.

## Implemented (deterministic, all pushed to `development`)

- **Decision observability.** `AiDecisionTrace` (`src/shared/ai.ts`) records the
  objective, ranked candidates and reason for each decision.
- **World-state reasoning.** `summarizeWorldState` / `selectActivity`
  (`src/main/ai/ActivitySelector.ts`) rank policy-filtered activities from
  authoritative state; recovery uses the real HP ratio and always outranks
  other work.
- **Migration test race fixed** (`src/main/config/Migration.ts` ordering and
  isolated temp-home cleanup). Full suite passes repeatedly.
- **Long-horizon campaign journal** (this checkpoint,
  `src/main/ai/AutonomousScheduler.ts`):
  - `journal` records per-activity successes, failures and stalls, a list of
    `avoided` activities, `strategyChanges` and `lastStrategyChange`.
  - Stall detection: an activity that succeeds but yields the same result as
    the previous finish `stallLimit` (default 2) times is avoided, so the
    scheduler picks a different activity next cycle instead of looping.
    `recover_health` is never avoided.
  - The journal survives `reset()`, `interrupt()` and `aiStop()`/emergency
    stop; it is dropped only by `forget()`, which `aiClearGoal()` calls.
  - `resume()` continues an interrupted campaign keeping completed work.
  - `snapshot()` / `restore()` give a versioned, JSON-safe form of the
    journal and completed list.
  - `SessionManager.finishAutonomous` finishes each activity, surfaces
    "Strategy changed: ..." in the agent explanation, and records a
    24-hour `strategy` AI memory (when a memory store exists).
- Tests: `AutonomousScheduler.test.ts` (journal, stalls, never-avoid recovery,
  resume, snapshot round trip) and two `SessionManager.test.ts` cases
  (journal kept on stop, forgotten on clear goal).

## Not done yet

1. The journal and snapshot are in-memory per session; `snapshot()`/`restore()`
   are not yet written to disk or restored on reconnect. Strategy-change
   memories do persist through the memory store.
2. `ObjectivePlan` is not yet driven by the scheduler for explicit broad goals:
   the scheduler only runs in no-objective mode. Next step: let a broad goal
   decompose into scheduler activities, with progress measured against
   authoritative state (room, exits, XP, HP) rather than result text.
3. Stall detection compares the activity result text; a progress signal based
   on tracker facts (new room visited, XP gained) would be stronger.
4. Exploration memory (rooms visited, dead ends) and goal selection from
   world knowledge are not implemented.
5. Candidate set is still small (`inspect_*`, recovery, equipment, navigate,
   engage); useful exploration/combat-farming activities need adding, each
   delegated to the production owner and policy-gated.
6. Live provider verification of any Phase 5/6 behaviour remains deferred;
   no provider tests were run in Phase 6.

## Known issues

- `npm run lint` fails the pre-existing repo-wide Prettier baseline. Do not
  mass-format.
- Legacy live navigation scenarios may fail when recovery takes priority or
  the model omits a destination; this is intended safety behaviour.
- Windows PowerShell here-strings with `${...}` interpolate; write TS files
  with the editor tools, not shell string rewrites.

## Verification (this checkpoint)

See the final section of `docs/CODEX_HANDOFF.md` for the latest recorded
results and commit.

## Next recommended task

Item 2/3 above: persist the journal with the session and drive explicit broad
objectives through `ObjectivePlan` + scheduler, with tracker-based progress
signals, using deterministic tests only.

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
