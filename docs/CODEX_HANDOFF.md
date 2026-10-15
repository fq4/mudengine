# MudEngine Codex Handoff

Persistent coding-agent principles are in the repository-root `AGENTS.md`.
Read it together with this handoff before making changes.

## Current state

- Branch: `development`
- Latest pushed commit: run `git log -1 --oneline` (Phase 6 work is in `docs/PHASE6_PROGRESS.md`)
- Working tree: clean for tracked files; local untracked `.npm-cache/` remains
- Repository: `https://github.com/fq4/mudengine.git`
- Phase 4 implementation and bounded live verification are complete on
  `development`; Phase 5 work is tracked in `docs/PHASE5_PROGRESS.md`. Phase 2
  safety boundaries remain authoritative.

## Project and architecture

MudEngine is a cross-platform Electron/Vite client, terminal, parser, world model, and deterministic automation engine for MajorMUD, GreaterMUD, and Paradigm-style MUDs. The original client works without AI.

- `SessionHost` owns session slots; each `SessionManager` owns one connection/character context.
- `SessionManager` owns `CharacterTracker`, `CommandQueue`, `Walker`, world graph, combat/recovery/equipment automation, AI agent, provider, approvals, budgets, and memory integration.
- `src/shared/` contains main/renderer contracts and domain models.
- `src/main/automation/` contains existing deterministic systems. AI delegates to them and never writes directly to the socket.
- `src/main/ai/` contains the agent, provider, budgets, permissions, approvals, memory, observation/event helpers, social gate, navigation helpers, and live monitor.
- `src/renderer/src/components/AiPanel.tsx` is the per-session AI panel. IPC is session-addressed through `src/shared/ipc.ts`, `src/preload/index.ts`, and the web bridge.
- `scripts/ai-live.mjs` is the opt-in real-server harness.

## Implemented AI capabilities

- One provider-neutral agent per connected session and active character.
- OpenRouter integration with structured response validation, diagnostics, cancellation, bounded retry, usage, and estimated cost tracking.
- One high-level validated action at a time, delegated to existing systems.
- Ordered bounded multi-step objective plans with prerequisite enforcement,
  progress states, same-observation reassessment, and completion guards.
- Exact-destination and bounded multi-room navigation through `WorldGraph`/`Walker`, with verified arrival and lifecycle states.
- Objective completion guards, meaningful-event gating, compact observations, and objective-scoped capability advertisement.
- Session approvals with expiry, state invalidation, history, rejection/expiration feedback, emergency stop, layered permissions, and hard/aggregate budgets.
- Scoped persistent memory with provenance, confidence, verification, editing, and relevance retrieval.
- Manual-input priority and reconnect/realm-leave identity cleanup.
- Guarded adapters for combat, recovery, equipment, communication, and general-command fallback.
- Phase 4 PvE target safety gate: engagement requires authoritative hostile mob
  evidence and rejects players, unknowns, charmed mobs, passive targets, and
  always-costly alignment targets before AutoCombat.
- Phase 4 inventory safety gate: item use requires an exact identified carried
  item and rejects equipped, depleted, protected, absent, or unknown items.
- General-command safeguards: unknown commands require approval; known safe commands queue directly; empty, oversized, multiline, NUL-containing, and prohibited commands are refused.

## Safety boundaries

Manual input always wins. AI must not bypass `CommandQueue`, permissions, approvals, budgets, or emergency stop. Live `kefka` testing is bounded; combat requires fresh authoritative target, health, escape, and budget checks.

Do not enable unattended live testing for combat, PvP, social interaction, equipment changes, item use, spending, destructive/irreversible actions, private-data handling, or unclassified commands. Never disable TLS verification or commit credentials.

## Verification and limitations

- AI suite and planner regressions pass, including ordered-plan and
  same-observation reassessment coverage.
- SessionManager suite: 248 tests passed.
- Node/web typechecks passed.
- Production Electron build passed; the existing large-renderer-chunk warning remains.
- Bounded `kefka` provider-driven phase passed with one OpenRouter request,
  `inspect_room` selected from ranked candidates, authoritative completion,
  and zero safety violations. The broader harness also covers inventory/NPC
  inspection, navigation, invalid destination, unknown-command approval,
  manual interruption, budget enforcement, and emergency stop; legacy
  navigation cases may fail when recovery takes priority or the model omits a
  resolvable destination.
- Final full validation passed 250 test files (6,920 tests passed, 2 skipped),
  realm coverage 18/18, typechecks, production build, and credential scan.
- Full application coverage previously passed 6,888 tests with one concurrency-only migration temporary-home race; that test passes in isolation. Realm coverage passed 18/18.
- `npm run lint` currently fails the repository-wide pre-existing Prettier baseline. Do not perform a broad formatter rewrite as handoff work.
- Active secret scanning passes. Thirty historical credential-bearing captures
  were quarantined under the user-scoped `%APPDATA%\\mudengine\\quarantine\\credential-capture-audit-20261014-0955`; only that explicit quarantine directory is excluded. Capture, logging, diagnostics, and raw-byte redaction tests pass.
- Phase 4 arena combat integration has been live-verified. The latest encounter
  ended without authoritative victory evidence; the harness reports `ended`
  unless `user-gain-experience` is observed. Recovery was skipped at full HP,
  then inventory inspection and EquipmentManager evaluation completed safely.
- Phase 5 now exposes fresh, ranked policy-filtered activity candidates from
  `SessionManager.aiObservation()` to the provider. The provider still chooses
  strategically within the explicit player goal; execution remains delegated
  to production adapters. The bounded harness remains deterministic for live
  safety. The no-explicit-goal session mode now uses `AutonomousScheduler` to
  select and delegate safe activities through the same gateway, while explicit
  goals retain provider/planner behavior. See `docs/PHASE5_PROGRESS.md`.
- Named provider/gameplay budget profiles and `AutonomousScheduler` transition
  guards have deterministic coverage. The Phase 5 deterministic implementation is
  complete for the bounded scheduler/session path; live provider verification is
  deferred rather than claimed as passed.
  - Deterministic scheduler integration now verifies the full autonomous
    lifecycle across multiple transitions, interrupted objectives, failed
    activities, stale observations, and recovery after an explicit goal is
    cleared. Objective-clear, stop, and emergency-stop paths reset stale
    scheduler state so no-objective autonomous mode can recover cleanly without
    reusing old completion markers.
- The bounded kefka harness still demonstrates the provider-driven broad
  objective pattern with one OpenRouter request choosing `inspect_room` from
  ranked candidates and completing through production observation with zero
  safety violations. That live verification remains a bounded, explicit subset
  and not a claim of broad autonomous completion.
- The no-objective scheduler-selection flow is covered deterministically and is
  not considered live-verified until a future bounded run reports it.
- The migration suite passes in isolation: 374/374 tests. The `ENOTEMPTY`
  cleanup issue remains limited to concurrent full-suite execution and is not a
  Phase 5 production defect.

Read `docs/ai-live-test.md` for the chronology, `docs/ai-capability-inventory.md` for capability mapping, and `docs/ai-technical-spec.md` for architecture and decisions.

## Outstanding work

1. Add broader integration coverage without expanding unsafe live scope.
2. Define an explicit action-to-policy mapping before hiding named capabilities by policy.
3. Improve general-command completion feedback beyond queue acceptance while preserving CommandQueue ownership.
4. Investigate the concurrent migration-test temporary-home race.
5. Phase 3 is complete for the approved safe capability scope. Keep live use
   bounded to the harness safety rules; future scope expansion requires a new
   review and explicit authorization.

## Setup on another computer

Requirements: Node.js 20+, Git, npm, network access for dependencies, and normal Electron platform prerequisites.

```powershell
git clone https://github.com/fq4/mudengine.git
cd mudengine
git switch development
git pull --ff-only origin development
npm ci
```

For an existing checkout:

```powershell
cd path\to\MudEngine
git switch development
git pull --ff-only origin development
npm ci
```

## Configuration and secrets

Never commit secret values. Copy `.env.example` to an untracked `.env` only for the live AI harness:

```powershell
Copy-Item .env.example .env
notepad .env
```

Names only; never document values:

- `OPENROUTER_API_KEY` - local OpenRouter credential.
- `MUDENGINE_AI_MODEL` - optional model override.

The `kefka` profile and connection credentials are user-scoped local settings. Recreate them through the normal profile/settings UI if absent. Corporate TLS/proxy settings must use the OS trust store or approved CA configuration.

Check for secrets before committing:

```powershell
npm run check:secrets
```

## Build, run, and test

```powershell
npm run typecheck
npm run build
npm test
npm run test:realm
npm run test:full
npm run dev
```

`npm run dev` builds main/preload, starts Vite, and launches Electron. The AI panel is optional and disabled until configured and started.

`npm run lint` is available but currently reports the documented repository-wide Prettier baseline.

Conservative Phase 5 validation:

```powershell
npm test -- src/main/ai/__tests__/ActivitySelector.test.ts src/main/ai/__tests__/AutonomousScheduler.test.ts src/main/ai/__tests__/ObjectivePlan.test.ts src/main/ai/__tests__/Agent.test.ts
npm run typecheck
npm run build
npm run check:secrets
```

Do not increase live budgets without explicit approval. The current bounded
command is:

```powershell
npm run test:ai-live -- --live --profile kefka --max-ms 120000 --max-requests 16 --max-tokens 60000 --max-cost 0.05
```

## Safe live harness

```powershell
Copy-Item .env.example .env
# Set OPENROUTER_API_KEY locally in .env
npm run test:ai-live -- --live --profile kefka
```

The harness withholds credentials from output and enforces bounded runtime, requests, tokens, cost, movement, and command safety. It performs only inspection, safe navigation, approval-path, interruption, budget, and emergency-stop scenarios. Never run it unattended or expand its allowed commands without explicit authorization.

## Next Codex session instruction

After cloning, paste the prompt in `docs/PHASE6_CONTINUATION_PROMPT.md`. Phase 6 status is in `docs/PHASE6_PROGRESS.md`.

## Phase 6 checkpoint

- The session scheduler journal now persists in user-scoped state, tracks room,
  XP and HP progress from `CharacterTracker`, and drives supported explicit
  multi-step objectives through `ObjectivePlan` + `AutonomousScheduler`.
  Active actions are not resumed blindly. See `docs/PHASE6_PROGRESS.md`.
- The scheduler journal now also stores bounded route outcomes, revisable
  dead-end observations, and up to 256 room observations containing
  server-listed exits. Exploration uses `WorldGraph` to rank reachable,
  unvisited frontiers and delegates movement to Walker; old version-one
  snapshots remain readable.
- Focused exploration and session validation passed: 280 tests across
  `ActivitySelector`, `AutonomousScheduler`, and `SessionManager`.
- Typechecks, production build and secret scan passed. The full suite reports
  one unrelated intermittent failure (`ConfigStore.test.ts` file-watch timeout,
  `no change event`); `SessionLog.test.ts` passed in this run.
- Bounded Kefka live harness passed all 24 scenarios on 2026-10-14 with zero
  policy violations (5 provider requests, 11,653 tokens, estimated cost ~$0.002).
  It verifies the production baseline, not persisted frontier selection.
- Run `git log -1 --oneline` on `development` for the latest commit.
