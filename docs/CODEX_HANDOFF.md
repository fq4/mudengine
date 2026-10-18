# MudEngine Codex Handoff

Persistent coding-agent principles are in the repository-root `AGENTS.md`.
Read it together with this handoff before making changes.

## Current state

- Branch: `development`
- Latest pushed commit: check `git log -1 --oneline` (Phase 6 work is in
  `docs/PHASE6_PROGRESS.md`)
- Working tree: check `git status`; pre-existing untracked `.npm-cache/` is
  preserved
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
- NPC and mandatory-combat objectives delegate target search to reachable,
  unvisited frontiers when no suitable target is visible. Optional combat is
  skipped only when no safe hostile mob is present.
- When the room observation places a named realm resident and the server lists
  the same occupant, the tracker attaches the resident identity to that
  visible occupant so NPC inspection does not guess from a name alone.
- Walker lifecycle tests exercise actual arrival and verified refusal
  callbacks. AI stop interrupts only its own active route, preserves journal
  history, and does not resume stale navigation.
- A deterministic SessionManager scenario searches successive frontiers,
  observes a resident through CharacterTracker, and completes the objective
  only after inspection.
- Objective completion guards, meaningful-event gating, compact observations, and objective-scoped capability advertisement.
- Session approvals with expiry, state invalidation, history, rejection/expiration feedback, emergency stop, layered permissions, and hard/aggregate budgets.
- Scoped persistent memory with provenance, confidence, verification, editing, and relevance retrieval.
- Manual-input priority and reconnect/realm-leave identity cleanup.
- Guarded adapters for combat, recovery, equipment, communication, and general-command fallback. Approved PvE uses a session-scoped, exact-target AutoCombat lease and does not change profile combat settings.
- Phase 4 PvE target safety gate: engagement requires authoritative hostile mob
  evidence and rejects players, unknowns, charmed mobs, passive targets, and
  always-costly alignment targets before AutoCombat.
- Phase 4 inventory safety gate: item use requires an exact identified carried
  item and rejects equipped, depleted, protected, absent, or unknown items.
- General-command safeguards: unknown commands require approval; known safe commands queue directly; empty, oversized, multiline, NUL-containing, and prohibited commands are refused.

## Safety boundaries

Manual input always wins. AI must not bypass `CommandQueue`, permissions, approvals, budgets, or emergency stop. Live `kefka` testing is bounded; combat requires fresh authoritative target, health, escape, and budget checks.

Do not enable unattended live testing for combat, PvP, social interaction, equipment changes, item use, spending, destructive/irreversible actions, private-data handling, or unclassified commands. The opt-in gossip mode below is limited to an explicitly authorized, supervised Kefka run. Never disable TLS verification or commit credentials.

## Verification and limitations

- Latest offline Phase 6 verification: `npm test` passed 7,088 tests with 2
  skipped across 253 files; `npm run test:realm` passed 18/18;
  `npm run typecheck`, `npm run build`, `npm run check:secrets`,
  `node --check scripts/ai-live.mjs`, and `git diff --check` passed. The build
  retains the existing renderer chunk-size warning; the secret scan found no
  configured password in 55 user-scoped files.
- AI suite and planner regressions pass, including ordered-plan and
  same-observation reassessment coverage.
- Focused AutoCombat and SessionManager suites: 497 tests passed, including
  approved exact-target execution with passive combat disabled and manual
  interruption of the temporary engagement.
- Node/web typechecks passed.
- Production Electron build passed; the existing large-renderer-chunk warning remains.
- Bounded `kefka` provider-driven phase passed with one OpenRouter request,
  `inspect_room` selected from ranked candidates, authoritative completion,
  and zero safety violations. The broader harness also covers inventory/NPC
  inspection, navigation, invalid destination, unknown-command approval,
  manual interruption, budget enforcement, and emergency stop; legacy
  navigation cases may fail when recovery takes priority or the model omits a
  resolvable destination.
- Bounded live follow-up (2026-10-17): Arena navigation again verified
  `1/2190` → `1/2150` through Walker. The approved exact-target combat probe
  hit the unsafe-health guard and emergency-stopped; the harness skipped
  post-combat actions and further navigation. The run used 2 provider
  requests, 5,813 tokens, about $0.00095115, and had zero policy violations.
  Two combat mobs were visible, but no separate inspectable room resident
  (`kind === 'npc'`) was present. It exited non-zero for the combat safety
  result; no victory is claimed.
- Latest bounded run (2026-10-17): all listed scenarios passed with zero
  policy violations, 4 provider requests, 12,460 tokens, and estimated cost
  $0.00207375, within the unchanged 120,000 ms / 16 / 60,000 / $0.05 limits.
  Arena and one-/two-room navigation passed. Two authoritative mobs were
  discovered, but the exact-target encounter ended without XP or target-death
  evidence; no victory is claimed. Post-combat HP was already full, so live
  low-health recovery remains unverified.
- Recovery harness follow-up: the earlier 45-second failure omitted HP/rest/
  combat diagnostics, so its precise cause is unknown. Existing recovery notes
  document 2 HP per 5 seconds while resting; 40/100 to 60% can take about 50
  seconds. Recovery waiting now uses only the remaining existing runtime
  budget and records authoritative HP, rest/combat/target state, profile
  thresholds, and action result without requiring the character to stand up.
  This does not alter production Recovery or the combat safety gate.
- Subsequent bounded attempt: Arena arrival, two-mob discovery, and exact-target
  preflight passed, but the fight remained active through the former 30-second
  settle window and classified `unsafe`. No XP or target-death evidence was
  observed, and the report lacked final HP, so death versus low positive HP
  cannot be determined. Combat settling now uses the remaining portion of the
  same runtime cap and records authoritative HP/target/attacker state; it does
  not change combat policy or the global 120-second/request/token/cost limits.
  The next live attempt did not reach a room identity, and subsequent retries
  remained `authenticating` after credential submission; they issued no
  gameplay/provider actions. Login-timeout reporting now includes only parsed
  phase, room, HP, combat state, and a capped count of parser block types (no
  block text or raw traffic). Pause further live runs until Kefka's login and
  placement are confirmed.
- Latest bounded login diagnostic (2026-10-17): `login-welcome` and 146
  `unknown` parser blocks were observed without a recognized in-game status
  line. Kefka's local profile has only two login-script steps, for the account
  prompts; its inline server entry supplies no shared menu script. A new or
  unmatched post-credential prompt is plausible but unconfirmed, since its
  text is not retained. The timeout report now includes the configured login
  step count, never trigger text or credentials. Do not guess a response.
- A subsequent diagnostic run remained `authenticating`, with no room/vitals
  or provider/gameplay activity. Its sanitized final eight blocks were seven
  `unknown[other]` entries and one `unknown[choose]:flush`. This is only a
  keyword category, not a recognized prompt or evidence of a safe response.
  Timeout output now contains only the capped parser types, predefined
  categories, and terminator marker; do not resume live attempts until the
  expected login prompt is confirmed.
- After the user replenished Kefka's lives, a bounded run reached in-game state
  and passed all 25 scenarios with zero policy violations (4 requests, 12,587
  tokens, approximately $0.002071). Within unchanged 120,000 ms / 16 /
  60,000 / $0.05 limits, Walker verified `1/2140` -> `1/2150`, then one-room
  and two-room routes to `1/2146` and `1/2144`. The approved exact-target
  SessionManager combat against an authoritative hostile produced `victory`
  with XP evidence; target-death evidence was not observed. At settlement HP
  was 32/51 and combat was inactive. Recovery reported readiness at its 60%
  threshold but took no rest action, so live low-health recovery remains
  unverified. No inspectable room resident was present. This successful login
  supersedes the prior authentication-stall pause; keep future live runs within
  the existing bounds and ceilings.
- The live NPC scenario was then found to use the impossible check
  `occupant.kind === 'npc'`: the real `RoomOccupant.kind` union is
  `player | mob | unknown`, and realm-backed identity lives on `.npc`. The
  harness now calls production `findSafeNpc`, which continues to exclude
  players. A subsequent live route from `1/2144` to `1/2147` refreshed the
  room, matched Corwyn's realm identity to the listed occupant, and returned
  `Observed NPC Corwyn`.
- An intermediate combat run recorded XP but still had two attackers after
  target/engagement cleared; the old observer overlooked them and recovery
  waited out the run. `waitForCombatSettlement` now marks any remaining
  authoritative attackers unresolved, and the harness fails that combat
  scenario and skips recovery/navigation/resident movement. A deterministic
  regression covers the target-cleared/attackers-remain case.
- Corrected bounded run: 27 scenarios passed, zero policy violations, 4
  requests, 12,120 tokens, ~$0.002004. It verified Arena and one-/two-room
  navigation, XP-confirmed exact-target victory with 0 attackers at 37/51 HP,
  and Corwyn inspection at `1/2147`. A later bounded run again inspected
  Corwyn and verified navigation; it correctly refused combat when the visible
  mob was not an eligible hostile (4 requests, 11,679 tokens, ~$0.001937,
  zero policy violations). Low-health rest recovery remains unverified because
  no run reached the configured `restBelow=0.35` threshold.
- Latest bounded run (2026-10-17): all 27 scenarios passed with zero policy
  violations, 4 provider requests, 11,626 tokens, and estimated cost $0.001897,
  within the unchanged 120,000 ms / 16 / 60,000 / $0.05 limits. It verified
  Arena and one-/two-room navigation, Corwyn inspection, and another
  XP-confirmed exact-target victory against lashworm. Combat settled with
  HP 43/51, no target or attackers; exact target-death evidence was not
  observed. Two authoritative mobs were present; one was excluded for
  uncertain realm classification and one was eligible. Recovery did not rest:
  HP was above `restBelow=0.35`. The harness now reports this as “rest not due”
  and only counts recovery as exercised if a `rest` command is observed and
  HP reaches configured `restTo`.
- The integrated live objective has since completed once: Walker moved
  `1/2147` -> `1/2150`, the room was inspected, and the production plan
  completed with zero policy violations (4 provider requests, 11,682 tokens,
  estimated cost $0.00193545). No eligible target was present, so
  combat/result-review were skipped; HP was above `restBelow`, so recovery
  correctly did not rest. Its route report now prints the observed
  before/after room keys.
- `recover_health` now refuses unknown HP, reports recovery as not due at or
  above configured `restBelow`; due recovery goes through Recovery's own
  configured guards and CommandQueue path, after SessionManager confirms that
  resting is safe. It no longer queues an emergency-priority `rest` directly.
  Recovery reports queued, regeneration-deferred, and not-started outcomes,
  and rejected queue requests do not claim a rest is in flight. It recognizes
  an active, in-flight, or queued Recovery rest and does not duplicate it.
  Focused tests cover unknown, at/above-threshold, below-threshold, unsafe,
  rejected-queue, and duplicate-rest states; queue acceptance is not presented
  as completed recovery. An explicit recovery step completes cleanly when the
  result says rest is not due, rather than failing merely because HP did not
  change. The integrated objective is skipped if an earlier encounter/recovery
  remains unresolved.
- Follow-up hardening routes explicit recovery through `Recovery.requestRest`
  and SessionManager's `mayRest()` instead of directly enqueueing an
  emergency-priority command. Recovery now distinguishes queued,
  regeneration-deferred, and not-started requests, and does not set its
  in-flight/resting bookkeeping if CommandQueue rejects the request. Focused
  SessionManager and Recovery tests cover the safe-rest refusal and queue
  outcomes. This improves offline correctness but is not live evidence.
- Activity selection now uses the configured per-session `restBelow`
  threshold in both AI observation and autonomous scheduling, rather than
  independently prioritizing recovery at 50% HP. This avoids selecting a rest
  action the Recovery owner must refuse as not due. Selector and
  SessionManager regressions verify the configured boundary; live recovery is
  still unverified.
- The no-goal scheduler can now re-activate `recover_health` after its prior
  activity cycle completed, but only when a changed observation makes recovery
  eligible again. The recovery action is not duplicated in completion history,
  and the same completed observation cannot trigger a repeated action. This
  preserves retry/failure limits and keeps live recovery unverified.
- If repeated failures have blocked autonomous scheduling, a newly eligible
  recovery candidate may get one bounded attempt, and only after a changed
  observation; the scheduler stays blocked on duplicate evidence. That
  exception dispatches recovery specifically, not an earlier candidate in the
  list. If recovery fails, the scheduler remains blocked; subsequent
  observations do not turn the override into an unbounded retry path. A
  successful recovery re-arms it for a later failure cycle.
- Latest bounded live attempt (2026-10-18) reached `phase=in-game` but failed
  the authoritative room-identity gate: `room=unknown/unknown`, HP 42/51,
  `combatEngaged=false`, no target, and two attackers were reported. The
  harness made 0 provider requests, used 0 tokens, spent $0, and ran no
  objective/combat/recovery scenario. This is inconclusive about gameplay and
  is not a navigation failure. Do not continue live activity until room and
  target state are authoritatively resolved.
- A bounded follow-up added one request through `SessionManager.askWhereIAm()`,
  but it was safely refused because the session had already retired the
  configured `rm` command as unavailable. The active Kefka profile uses an
  inline server address, so `resolveServer()` gives it the global default
  locator (`rm`); it does not inherit a locator from a saved server entry. The
  attempt again had unknown room identity, HP 36/51, and two attackers; no
  alternate location command is verified, so do not guess one. Inline
  profiles can now set their own locator in Settings, or Kefka can reference a
  saved server configured with the confirmed method; changing an unrelated
  saved entry will not change this inline profile.
  `SessionManager.locationRequestState()` now distinguishes available,
  disabled-by-configuration, and server-unavailable states in the secret-safe
  harness diagnostic.
- The live combat harness matches `mob-dies` evidence to its chosen target
  using the shared `mobKey` normalization: leading articles are harmless, but
  modifiers remain part of the identity and absent names do not count.
  Focused deterministic tests cover this matcher. It does not establish a live
  target death. The current full suite includes those regressions and passes
  7,031 tests with 2 skipped across 253 files.
- Latest local validation after the bounded room-location retry and diagnostic:
  `npm test -- --maxWorkers=1 --minWorkers=1` passed 7,035 tests with 2 skipped
  across 253 files. A parallel full-suite run reproduced two
  `SessionLog.test.ts` cleanup `ENOTEMPTY` errors; that file passed 14/14 in
  isolation, and the serial full run passed. The configured-threshold
  and repeatable-recovery changes passed focused SessionManager, selector, and
  scheduler tests (303/303); blocked-scheduler recovery guards passed focused
  scheduler and SessionManager tests (289/289). Regressions cover retaining
  the blocked state on duplicate evidence and dispatching recovery even when
  another candidate is listed first. The room-location retry/helper and
  SessionManager integration tests passed 300/300. Typecheck, production
  build, secret scan, harness syntax check, and `git diff --check` passed. The
  renderer chunk-size warning remains.
- After the combat-settlement change, focused AI tests passed 27/27 and
  `node --check scripts/ai-live.mjs` / `git diff --check` passed. The live
  follow-up was blocked before gameplay as described above; no live combat
  result is claimed for the longer bound. A further retry also remained in
  authentication; syntax and diff checks passed after adding parsed
  login-state diagnostics. Parser-block-type counts were subsequently added to
  the timeout report; syntax, Problems, secret scan, and diff checks passed.
- Earlier full validation passed 250 test files (6,920 tests passed, 2 skipped),
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
- The prior arena-navigation failure's original capture was unavailable, so
  its exact server-side cause is unconfirmed. The old harness could redispatch
  `navigate_to` while Walker still owned a route; it now dispatches once and
  checks Walker's terminal status plus the authoritative destination before
  continuing. Four bounded Kefka attempts have reached Arena `1/2150`;
  the latest trace verified `1/2190` → `1/2150` via `e`, `d`.
- Latest bounded live run (2026-10-17) stayed within 120,000 ms / 16 requests /
  60,000 tokens / $0.05, using 4 requests, 11,682 tokens, about $0.001938, and
  zero policy violations. Walker verified Arena navigation (`1/2147` to
  `1/2150`), one-/two-room routes, and the return to the Guild (`1/2147`);
  production inspection again observed resident Corwyn. One authoritative
  Arena mob was visible but did not qualify as a conservative hostile, so
  combat was correctly refused without an attack. This run did not exercise
  post-combat or low-health recovery. A previous bounded run did verify an
  XP-confirmed PvE victory; exact-target death evidence remains unobserved.
- The no-objective scheduler-selection flow is covered deterministically and is
  not considered live-verified until a future bounded run reports it.
- The migration suite passes in isolation: 374/374 tests. The `ENOTEMPTY`
  cleanup issue remains limited to concurrent full-suite execution and is not a
  Phase 5 production defect.

Read `docs/ai-live-test.md` for the chronology, `docs/ai-capability-inventory.md` for capability mapping, and `docs/ai-technical-spec.md` for architecture and decisions.

## Outstanding work

1. Multiple bounded runs now verified XP-confirmed PvE victory, Corwyn's
   production inspection at `1/2147`, and repeated navigation. Still exercise
   low-health recovery live and seek exact-target death evidence. The latest
   run had an eligible lashworm and safely excluded a second mob with
   uncertain realm classification. Do not manufacture a target or weaken
   combat safeguards to force either result.
2. One integrated production objective now completes live, but no hostile was
   eligible and recovery was not due in that run. After confirming Kefka's
   placement/combat state, repeat it under the same caps and seek real
   combat/rest evidence without manufacturing a target or weakening policy.
   Exact-target death and low-health recovery remain unverified.
3. Investigate the historical arena movement report further if its missing
   capture becomes available. Repeated current routes pass, but the exact
   server-side cause of the original timeout cannot be established without it.
4. Improve general-command completion feedback beyond queue acceptance while
   preserving CommandQueue ownership.
5. Investigate the concurrent migration-test temporary-home race.
6. Phase 3 is complete for the approved safe capability scope. Keep live use
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

Never commit secret values. Copy `.env.example` to an untracked `.env` for local development or the live AI harness:

```powershell
Copy-Item .env.example .env
notepad .env
```

Names only; never document values:

- `OPENROUTER_API_KEY` - local OpenRouter credential.
- `MUDENGINE_AI_MODEL` - optional model override.

`npm run dev` loads an existing `.env` into the Electron main-process environment;
without `.env`, development continues with the normal inherited environment.
Do not rename the key with a `VITE_` prefix.

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

The harness withholds credentials from output and enforces bounded runtime, requests, tokens, cost, movement, and command safety. It performs inspection, safety-refusal checks, bounded PvE when a verified safe NPC is present, safe navigation, approval-path, interruption, budget, and emergency-stop scenarios. Never run it unattended or expand its allowed commands without explicit authorization.

The default live harness intentionally rejects public-chat commands such as
`gos` and `gossip`. A separate, explicit `--gossip-reply-test` mode is available
for a supervised Kefka run only: it lasts at most five minutes, permits at
most five replies with the production 30-second social pacing, and approves
only `send_message` actions for recent inbound gossip. It does not move Kefka
or initiate messages. Provider ceilings remain capped at 16 requests, 60,000
tokens, and $0.05. Message text is redacted from the harness trace. If no
inbound gossip arrives, the run is inconclusive rather than a pass.

Production reply objectives also require a recent inbound gossip event before
the ranked activity selector exposes `send_message` or it can enter approval.
Conversation events wake the session agent even when the character tracker has
no other state change. Reply objectives remain active while waiting for further
events. The `wait` action is an event-driven no-op.

An earlier bounded gossip run (2026-10-15) lasted 282 seconds and used 7
provider requests, 16,554 tokens, and about $0.00275. It received no inbound
gossip and sent no replies, so that run was inconclusive. A fresh message from
another player is required because prior chat is not replayed.
The social harness disables profile `onEnterRealm` probes but still counts
`st` as possible movement because it can be a room-exit alias.

A later supervised test sent one public test message from a configured sender
session through `CommandQueue`; the sender received a gossip reply from Kefka.
A follow-up sender-side monitor reported the message sent, reply received, no
sender disconnect, and retention through the responder window. Live
communication is demonstrated. The responder harness was missing required
`character` and `dropped` sink callbacks; both are now handled, and unexpected
disconnects are recorded as test failures. A clean-report retry disconnected
Kefka after 24 seconds with no inbound message. The Kefka and sender profiles
share the same login and server, so do not use them concurrently; whether that
caused the earlier drop is unconfirmed. The sender-side check did not provide a
full responder harness report with request, token, cost, and monitor totals.

```powershell
npm run test:ai-live -- --live --profile kefka --gossip-reply-test --max-ms 300000 --max-requests 16 --max-tokens 60000 --max-cost 0.05
```

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
- Target-search fallback now explores reachable frontiers for NPC and required
  combat steps; optional combat skips only when no suitable hostile is visible.
  Unsupported clauses in mixed objectives remain on the provider/planner path,
  and unavailable target-search steps expose a specific waiting reason.
- Walker lifecycle coverage now uses actual `onCharacter()` arrival and
  verified exit-refusal callbacks. It confirms AI stop cancels an AI-owned
  route, preserves journal history, and selects a fresh destination on restart.
- `ActionPolicy.ts` now declares the policy for every AI action, including risk,
  authorization scope, capability validation, failure behavior, and delegated
  completion. `SessionManager.executeAiAction()` enforces it for direct,
  provider, scheduler, and approved execution using current session and
  authoritative tracker evidence. Approved actions are revalidated before
  execution; general commands defer to command classification. Provider
  observations expose policy scope, failure behavior, and completion owner.
  Shared intent helpers align objective gating, and duplicate NPC/mob names
  are withheld from candidates and rejected during execution.
- Focused policy, activity-selection, NPC-discovery, observation, and session
  validation passed 303/303 tests. The final full suite passed 6,996 tests
  (2 skipped across 253 files); typecheck, production build, and secret scan
  passed. An earlier concurrent run hit the known SessionLog `ENOTEMPTY`
  cleanup race; isolated rerun and final full-suite rerun passed.
- Bounded Kefka harness (2026-10-16): 16/20 scenarios passed, zero policy
  violations, 4 provider requests, 11,930 total tokens, estimated cost
  ~$0.00193. Safety refusals, unknown-command approval, interruption, budgets,
  emergency stop, and one-/two-room navigation passed. The legacy arena
  navigation scenario timed out waiting for a movement response; dependent
  arena inspection/target/combat scenarios were unavailable. No authoritative
  eligible hostile mob target was visible, so no live combat was attempted.
  This run exited non-zero and is not a full live pass.
- The 2026-10-17 bounded follow-up verified the single-dispatch Arena route
  again. One-/two-room routes were skipped after combat hit the unsafe-health
  guard; they need another bounded observation when safe to do so. Historical
  server-side timeout cause remains unconfirmed because its capture is absent.
- Earlier bounded Kefka live harness passed all 24 scenarios on 2026-10-14 with zero
  policy violations (5 provider requests, 11,653 tokens, estimated cost ~$0.002).
  It verifies the production baseline, not persisted frontier selection.
- Run `git log -1 --oneline` on `development` for the latest commit.

## Initial inline locator checkpoint (2026-10-18)

- Inline profile locator overrides are implemented in settings. The active
  Kefka profile uses `sys-status`, but the live server has not confirmed that
  command.
- The room-only diagnostic now passes the resolved locator into
  `SessionManager.configure()` before connecting. Its automation config keeps
  the master switch off; the explicit Room-card probe is user-priority, while
  Walker probes remain automation-priority.
- A bounded probe connected and sent `sys status` once. It received no parsed
  coordinates within five seconds (`room=null/null`, no server-family
  evidence). Provider usage and cost were zero; no gameplay action ran. Queue
  acceptance and `locationRequestState=available` are not evidence that the
  remote command is supported.
- Do not start gameplay or try another guessed locator until the authoritative
  room command for this endpoint is confirmed. The original Arena timeout
  remains unconfirmed because its capture is unavailable.
- Offline validation: 7,037 tests passed, 2 skipped across 253 files; realm
  tests 18/18; focused harness/session tests 301/301; typecheck, production
  build, secret scan, script syntax, and diff checks passed. The existing
  renderer chunk-size warning remains.
- The room-key formatter now falls back to the parsed room name instead of
  showing `null/null` when nullable coordinates are absent. Focused harness
  tests pass 31/31; this improves diagnostics only and does not resolve the
  live locator blocker.
- The subsequent full serial suite run recorded 7,037 passing, 2 skipped, and
  one unrelated flaky `ConfigStore.test.ts` watcher timeout. Its focused test
  passed 1/1 on retry; do not attribute this to the locator changes (no
  ConfigStore files were modified).

## Latest provider-free probe checkpoint (2026-10-18)

- Current branch/HEAD at session start: `development` / `1a44afd`.
  The workspace already contained uncommitted changes in the live harness,
  `LiveHarness`, and `SessionManager` from the locator/probe continuation. Keep
  those changes; `.npm-cache/` is unrelated and must remain untracked.
- The verified provider-free probe changes were committed and pushed on
  `development` as `7719a0a`; at that checkpoint, the only remaining worktree
  entry was the pre-existing untracked `.npm-cache/`.
- A command-local Git `safe.directory` override was used because the checkout
  is owned by `BUILTIN\\Administrators`; no global Git trust setting was
  changed.
- Live `pro` resolved room `1/2150` on GreaterMUD; `sys status` did not yield a
  location block. The read-only health probe later showed HP `20/51`, no
  current combat target/engagement, and one attacker. The latest listed mob
  was uncertain by realm classification, so combat was correctly refused.
- Walker navigation was also refused while attackers were present. A separate
  exact-target PvE run did engage `fat kobold thief` via SessionManager and
  observed XP, but no exact target-death evidence; it ended at HP `22/51` with
  one attacker. Do not report this as a kill or victory. The queue-enabled
  Walker probe disables all unrelated automation and door bashing.
- The provider-free PvE probe exposed a movement-monitor false positive:
  production `Routines` sent the exact `st` status-sheet query, which the
  generic monitor counts as a possible movement alias. The PvE mode now
  authorizes only that exact status query; ordinary movement remains capped.
  This change has focused deterministic tests but is not yet live-reverified.
- Every live probe used zero provider requests/tokens/cost. No character
  movement occurred in the navigation-refusal runs. Low-health recovery,
  escape from an unresolved/uncertain attacker, target death, and complete
  autonomous live objectives remain unverified.
- Final validation: the first full serial run had one unrelated
  `ConfigStore.test.ts` watcher timeout; its focused 12-test rerun passed, and
  the subsequent full serial suite passed 7,045 tests with 2 skipped across
  253 files. Typecheck, build, realm tests, secret scan, script syntax, and
  diff checks passed. The build retains its existing renderer chunk-size
  warning.
- Fresh post-checkpoint read-only probe: authoritative `pro` again resolved
  `1/2150`; `sys status` still produced no parsed location. Health was `20/51`,
  with no active target/engagement and two listed attackers. The separate
  bounded PvE probe found two visible mobs, both uncertain by realm
  classification, and correctly refused combat. It used zero provider
  requests/tokens/cost, issued no attack or movement, and recorded zero
  violations. The `st` monitor exception remains unverified in an actual fight.
- The locally configured GreaterMUD graph identifies `1/2150` as Newhaven,
  Arena, with exits north/up/down but no room-local NPC or lair. The live mobs
  are present, but the room has no spawn record to settle their shared-name
  realm rows; nearest-spawn resolution did not select an unambiguous row.
  This is a legitimate target-identity ambiguity, not a lack of visible mobs;
  do not weaken the combat gate to force a target.
- Target-policy follow-up: a parsed attack against Kefka can resolve
  disposition uncertainty only when that attacker uniquely matches one
  currently visible, realm-identified mob. Players/unknown occupants sharing
  the name, duplicate mob names, charmed mobs, wire-only mobs, and
  always-alignment-costly mobs remain refused. The SessionManager still asks
  approval and delegates to AutoCombat; this evidence does not relax identity,
  PvP, emergency-stop, budget, or action-loop safeguards.
- One bounded provider-free follow-up selected `nasty giant rat` from the
  authoritative attacker list and executed exact-target approval through
  SessionManager. The observed result was `outcome=ended`, HP `22/51` (up from
  `20/51`), no XP or target-death evidence, and two attackers still listed;
  settlement remained unresolved, so this is not a kill or victory. There were
  zero provider requests/tokens/cost and zero policy violations. Do not run
  another live combat/movement/recovery attempt while those attackers remain.
- Next: improve the underlying encounter interpretation and let hostile state
  clear before trying Walker or Recovery. A future bounded PvE test may use
  direct attacker evidence only with the exact identity checks above, and must
  report target death/XP and settlement separately. Low-health rest, safe
  escape, target-death evidence, and a complete live objective remain open.
- Validation after this policy refinement: the focused target, activity,
  action-policy, and SessionManager suites passed 314/314; the full serial suite
  passed 7,051 tests with 2 skipped across 253 files; realm tests passed 18/18.
  Typecheck, production build, secret scan, live-script syntax, and
  `git diff --check` passed. The production build retains the existing renderer
  chunk-size warning. No additional live gameplay was attempted because the
  latest observation still had two attackers and the last encounter was
  unresolved.
- Fresh read-only probe after the push: authoritative `pro` output located
  Kefka in `1/2150`; the configured `sys status` produced no response. Health
  was `22/51`, combat was not engaged, and two attackers remained. The probe
  issued only `sys status`, `pro`, and `health`, with zero provider usage and
  zero violations. Do not start combat, navigation, or recovery yet; recheck
  with this zero-movement probe before deciding whether hostile pressure has
  cleared.
- Latest bounded follow-up (2026-10-18) supersedes that snapshot: a read-only
  probe found one uniquely matching visible hostile, `large filthbug`, at
  `18/51` HP. Exact-target approval dispatched it through SessionManager;
  after the 60-second bound the encounter was still active, with no XP or
  target-death event. Post-combat recovery was correctly skipped. A subsequent
  read-only probe showed `20/51` HP, no active target/engagement, and two
  visible hostile attackers (`small kobold thief`, `large filthbug`). All three
  probes used zero provider requests/tokens/cost, zero movement, and reported
  zero policy violations. The combat is unresolved; do not send another attack,
  movement, or rest command until fresh authoritative state shows no attackers.
- Verification after these changes: focused approval, harness, AutoCombat,
  and SessionManager tests passed 558/558; the serial full suite passed 7,057
  tests with 2 skipped across 253 files; realm tests passed 18/18. Typecheck,
  production build, secret scan, live-script syntax, and diff checks passed.
  The existing renderer chunk-size warning remains. Low-health recovery,
  verified exact-target death, safe escape under pressure, and a complete live
  objective remain unverified.

## Sustained-combat diagnostic follow-up (2026-10-18)

- Fresh provider-free preflight before the next bounded attempt found room
  `1/2150`, HP `24/51`, no active target, and two visible, certain,
  realm-backed hostile attackers (`small kobold thief`, `large filthbug`).
  The run used the authorized disposable `kefka` character and no provider.
- The attempted harness run dispatched the exact command `a large filthbug`
  and issued two production `st` status probes. It then threw
  `selectedTargetEvidence is not defined` while assembling the result. That
  variable had accidentally been declared in the navigation branch rather
  than the PvE branch. The exception occurred after combat dispatch; no parsed
  hit/miss, damage, XP, exact death, or terminal outcome was retained. This
  run is not evidence of either a win or a combat-system defect.
- A fresh read-only probe afterward found HP `5/51`, no active combat target,
  and two different visible authoritative hostiles (`thin carrion beast`,
  `small kobold thief`). HP fell during the attempted encounter window, but
  without the lost parsed telemetry the damage source and the filthbug's
  outcome cannot be established. The current pressure and low health make a
  second live encounter inappropriate; no recovery, movement, or further
  combat was attempted.
- The live runner now reserves an explicitly requested post-deadline
  observation tail (0–30 seconds, only for `--pve-probe-only`), keeps the
  exact-target combat owner connected during that tail, then emergency-stops
  unresolved automation. It records a bounded set of structured health,
  room, target, attacker, scheduler, command-interval, and parsed combat
  snapshots, and persists a secret-safe artifact under
  `$MudEngineHome/state/live-diagnostics/` before disconnect. The exception
  path also saves its current structured state. No raw server lines or login
  commands are put in that artifact.
- The scoping error is corrected and the PvE scenario is now staged in the
  output before dispatch, so a later runner exception leaves the selected
  target and starting state visible. No production combat, eligibility,
  approval, recovery, or navigation behavior was changed.
- Validation: focused LiveHarness tests passed 44/44; the full deterministic
  suite passed 7,062 tests with 2 skipped across 253 files and realm tests
  passed 18/18. Typecheck, production build, secret scan, script syntax, and
  diff checks passed. The first parallel full-suite run had one
  intermittent `SessionLog.test.ts` Windows temp-directory cleanup failure;
  the isolated file passed 14/14 and the full serial rerun passed. The
  existing renderer chunk-size warning remains.
- The corrected PvE report/persistence path has not yet been exercised live.
  Do not repeat combat at `5/51` while attackers remain. Next: obtain a fresh
  read-only preflight showing a suitable safe state (or use another
  controlled disposable character), then run the documented 100-second PvE
  budget with a 30-second post-deadline observation window and inspect the
  persisted artifact. A verified target death, XP, and resolved attacker
  state remain unproven.
- Final zero-movement recheck after validation again resolved `1/2150` through
  `pro`: HP `22/51`, no active target/engagement, and the same two visible
  hostiles (`small kobold thief`, `large filthbug`) in the attacker list. It
  sent only location/status/health reads with zero provider usage and zero
  violations. Hostile pressure has not cleared; do not attempt combat,
  navigation, or recovery.
- The parser intentionally preserves attackers across `*Combat Off*`: that
  signal can follow retreat or a temporary combat break and is not evidence
  that a mob died or left. Since the current room also lists both hostiles,
  settlement remains unresolved. The live report now captures bounded parsed
  hit/miss target identities and damage, attacker blows, combat status,
  refusal/ineffective event types, XP, and death identity, without retaining
  raw server lines. This improves diagnosis but is deterministic-only until a
  later authorized bounded encounter is appropriate. The 42-test focused
  LiveHarness suite, typecheck, production build, secret scan, script syntax,
  and diff checks pass; the existing renderer chunk-size warning remains.
- A final read-only check after the telemetry build still reports HP `22/51`,
  no active target/engagement, and the same two attackers at `1/2150`. No game
  action was sent; wait for fresh authoritative evidence of cleared pressure
  before the next live combat/navigation/recovery step.
- Combat-blocker investigation (2026-10-18): the asserted failure to establish
  an engagement is not supported by the latest exact-target live trace.
  `large filthbug` was a unique visible hybrid realm mob, classified hostile,
  certain, uncharmed, and never-costly; it matched the attacker list. The exact
  action obtained approval, the wire trace contained `a large filthbug`, and
  authoritative tracker state reported an active engagement and exact target
  at the 60-second bound. Thus identity resolution, eligibility, selection,
  approval, command dispatch, and engagement establishment succeeded for that
  attempt. No XP or target-death evidence was observed; the run predates the
  parsed hit/miss telemetry, so whether a hit, miss, or damage occurred is
  unknown. It remained active, not a terminal outcome.
- Fresh live state after `cb10ff1`: read-only `pro` located room `1/2150`;
  HP `22/51`, no active target/engagement, and two visible, certain,
  realm-backed hostiles (`small kobold thief`, `large filthbug`) still in the
  attacker list. Both map uniquely to distinct mobs, hostile, uncharmed, and
  never-costly. The probe sent only `sys status`, `pro`, and `health`; zero
  provider requests/tokens/cost, zero movement, and zero violations.
- Effective Kefka automation settings were inspected without exposing profile
  secrets: retreat disabled (`belowHealth=0.30`, outnumbered threshold 0),
  flee-goto disabled with no destination, safe-haven empty, rest threshold
  `0.35` and rest-to `0.70`. Current HP is about 0.43, so configured resting
  is not due; existing recovery also refuses while attackers remain. There is
  no configured escape/recovery action suitable for this current state.
- No production bug has yet been localized in the combat establishment path,
  and no code fix is justified. The unresolved stage is combat progression and
  outcome evidence: the old trace lacks hit/miss telemetry and the latest
  state still has two active attackers. Do not interpret `*Combat Off*` alone
  as departure. The 550 focused SessionManager/AutoCombat/LiveHarness tests
  passed against this baseline. Do not repeat a 60-second PvE harness run
  while unresolved: its cleanup disconnects the live client, and no escape
  policy is configured. Next, wait for attackers to clear or use a separate
  disposable/controlled character and a supervised setup that can preserve
  the session on timeout; then use the new bounded telemetry to distinguish
  hit/miss/damage/refusal and verify a terminal outcome.

## Conservative PvE harness preflight (2026-10-18)

- A fresh provider-free room probe found Kefka at `1/2150`, HP `5/51`, no
  active target or engagement, and two authoritative visible hostiles
  (`thin carrion beast`, `small kobold thief`) also present in the attacker
  list. Only login plus `sys status`, `pro`, and `health` reads were sent;
  provider usage, movement, and policy violations were zero.
- The live PvE probe had been calling `assessCombatEligibility` with a zero
  health floor and `escapeAvailable=true` unconditionally. That meant it could
  attempt combat below the same conservative 60% threshold used by the arena
  preflight, and without verifying an escape. This is a harness safety defect,
  not evidence of a production combat defect.
- The probe now applies the existing 60% threshold and requires a room exit
  with a resolved destination and no key requirement. The arena and provider-
  free PvE paths share the same exit predicate. Production combat policy and
  profile settings are unchanged.
- Focused combat eligibility tests passed 16/16, including mapped, unresolved,
  key-required, and missing exits. The serial full suite passed 7,063 tests
  with 2 skipped across 253 files; realm tests passed 18/18. Typecheck,
  production build, secret scan, script syntax, and diff checks passed. The
  build retains its existing renderer chunk-size warning.
- The bounded `--pve-probe-only --max-ms 30000 --max-moves 0` run was repeated
  at `5/51`. It refused before combat with
  `character health is below the conservative combat threshold`. The trace
  contained only login plus `sys status`, `pro`, and `health`; it contained no
  attack, movement, recovery, or other game action, with zero provider usage
  and zero violations. This validates the harness guard only, not combat or
  recovery.
- Current hostile pressure and low health still make a combat test
  inappropriate. The effective profile has no configured retreat, flee-goto,
  or safe-haven destination, while Recovery refuses to rest with attackers
  present. Next: use an attacker-free read-only preflight or arrange another
  authorized controlled character/encounter with a verified escape. Do not
  attempt live combat until at least 60% HP and a mapped, unblocked exit are
  confirmed. Sustained combat, exact-target death, recovery, and a complete
  live objective remain unverified.

## Continuation checkpoint: verified retreat, unresolved combat

This checkpoint was developed on `development` from prior pushed commit
`c934799`. Preserve the pre-existing untracked `.npm-cache/`.

- `SessionManager.considerEscape` now allows an already-stationary character to
  take the configured retreat when the threat is authoritative (a dreaded mob,
  exact target, or parsed attacker). Generic `Combat Engaged` alone still does
  not abandon a route destination. The SessionManager regression and full
  275-test suite passed.
- `LiveHarnessMonitor` now receives the CommandQueue intent `coalesceKey`.
  Movement accounting excludes `st` only when tagged as the `probe:st` status
  sheet request; an untagged `st` still counts. This corrects the false
  13-of-12 movement-limit report (10 actual directions plus three status
  probes) without relaxing directional limits.
- The bounded escape probe temporarily enables one verified-attacker retreat
  (`whenOutnumbered: 1`) in memory, disables other automation, allows exactly
  one move, and requires an authoritative room change. It does not persist the
  Kefka profile. Two live probes each used exactly one `u` move from Arena
  (`1/2150`) to `1/2146`; attacker pressure cleared on both. The first began
  with two visible hostile attackers, the second with one. Neither used a
  provider call or recorded a policy violation.
- A subsequent read-only live probe verified current state at `1/2146`, HP
  `39/51`, no active target or attackers, and mapped exits north to `1/2147`
  and east to `1/2143`. The earlier isolated `-15` HP observation at `1/2190`
  was contradicted by a later `51/51` read without intervening gameplay and is
  not evidence of death.
- The corrected full harness reached Arena, resolved and approved the exact
  target `a thin carrion beast`, and observed XP. The engagement ended while
  `big carrion beast` remained in the attacker list. Exact selected-target
  death was not evidenced; the harness correctly skipped later guarded
  scenarios. This is not a verified kill or a complete autonomous objective.
- Deterministic verification: full serial suite 7,066 passed / 2 skipped
  before the final threshold-only escape-probe test adjustment; afterward
  `LiveHarness.test.ts` passed 46/46, `SessionManager.test.ts` passed 275/275,
  and typecheck passed. Build, realm suite (18/18), secret scan, syntax, and
  diff checks passed before that final one-line adjustment and still require
  final rerun. The production build has its pre-existing renderer chunk-size
  warning.

The retreat and movement-accounting checkpoint was validated and pushed as
`ea520e7`. The recovery follow-up below is the current work. Combat through
exact-target death and a connected multi-step gameplay loop remain unverified.

## Continuation checkpoint: live recovery progress

- Fresh read-only preflight found `1/2146`, `39/51` HP, not resting or
  meditating, no combat/target/attackers, and no visible occupants. It made no
  movement or provider call.
- The first temporary rest attempt exposed a harness-only gap: the live monitor
  flagged the dispatched `rest` as unsafe because the probe did not call its
  existing `authorizeRecovery()`. That attempt did not produce recovery
  evidence; subsequent read-only state remained `39/51`. The probe now uses the
  existing recovery authorization before temporary configuration.
- With the monitor authorization corrected, the bounded provider-free live
  probe observed `39/51` before, dispatched one `rest`, observed health,
  remained in `1/2146`, and reached `49/51` with `resting=true`. Runtime was
  capped at 60 seconds; it reached 96% but not the then-required full-health
  threshold. This is direct live recovery progress, not evidence of full
  recovery or automatic resumption. There were zero provider requests,
  movement, or violations on this corrected run.
- After the disconnect, a read-only probe showed `49/51` and `resting=false`.
  The subsequent recovery probe saw `51/51` before acting and safely refused
  without a gameplay command because HP was above its temporary 98% threshold.
  The full-health state is confirmed; the last two HP are not attributed to
  Recovery.
- The bounded `--recovery-probe-only` mode now uses an in-memory 98%-to-100%
  rest band, allows only an empty-room rest, requires known positive health,
  and has a 60-second/zero-movement limit. No saved Kefka settings were changed.
- The focused LiveHarness tests passed 47/47. After the recovery-only harness
  changes, the full serial suite passed 7,067 with 2 skipped, production
  build/typecheck passed, and the secret scan found no configured password in
  45 user-scoped files. Realm tests previously passed 18/18; the recovery
  probe does not change realm code. Script syntax and `git diff --check` pass.
  Build retains the existing renderer chunk-size warning.

## Continuation checkpoint: exact-target combat progress, outcome unresolved

- Added a bounded PVE probe option to route through Walker to one of the two
  known Newhaven test rooms and request an exact target name. Walker must verify
  arrival; combat still requires that name to uniquely resolve to an
  eligible realm-backed room occupant. A missing or ambiguous target is
  refused. The probe remains provider-free and capped by `--max-moves`.
- The live run started at `1/2146`, `51/51` HP, no attackers, and no visible
  occupants. Walker verified the single `d` step to Arena `1/2150`. It resolved
  `big carrion beast` to hybrid entity id 4, classified hostile, certain,
  uncharmed, and not costly; exact-target SessionManager approval executed.
- Bounded combat telemetry recorded a matching user hit for 14 damage and
  `You gain 850 experience`, then `Combat Off`. At about 18.3 seconds the
  selected target and engagement were gone, but `nasty lashworm` remained as
  an attacker. During the 30-second post-timeout observation it missed
  repeatedly, hit for 3 damage once, and Kefka ended at `48/51` HP. The exact
  target death event was absent (`targetDied=false`); the run is unresolved,
  not a claimed kill. It made zero provider requests and recorded zero policy
  violations. The sanitized artifact is persisted at
  `$MudEngineHome/state/live-diagnostics/combat-2026-10-18T20-03-30-685Z-25960.json`.
- A read-only follow-up confirmed `1/2150`, `48/51` HP, and one authoritative
  attacker (`nasty lashworm`). The existing one-move escape probe then matched
  that exact realm-backed attacker, sent `u`, verified arrival at `1/2146`,
  and confirmed no attackers at `48` HP. It used no provider and had zero
  violations.
- This was an operator-selected exact-target diagnostic, not proof that the
  autonomous agent chose that target. Combat mechanics and damage are now
  live-confirmed; exact-target death, sustained autonomous target progression,
  and the full multi-step objective remain unverified. Do not repeat the same
  two-hostile Arena encounter without changing the experiment.

## Continuation checkpoint: single-target live damage, outcome unresolved

- Pushed `aee01c2` (`Add bounded recovery and exact-target probes`) after full
  validation. Additional local changes since that commit are limited to the
  bounded destination allowlist and two diagnostic-harness corrections below.
- Bounded Walker exploration verified rooms `1/2147`, `1/2143`, `1/2140`,
  `1/2148`, `1/2149`, `1/2142`, and `1/2141`. Separate read-only probes found
  Corwyn, Ferryman, Betram, and Nathaniel as passive NPCs; the other inspected
  rooms had no visible occupants. None was an eligible hostile. Health
  recovered from `48/51` to `51/51` during the bounded exploration; that was
  not attributed to a recovery command. Every probe used zero provider calls
  and reported zero policy violations.
- Returning by a four-step Walker route to `1/2150`, a fresh room probe found
  one visible hostile and attacker: `nasty lashworm`, `51/51` HP, no active
  target. The first exact-target attempt did not move or attack because the
  harness required `readOnlyNavigationPreflight` to allow navigation even
  though the authoritative current room already equaled the requested
  destination. The second refusal exposed a separate harness-only mismatch:
  the diagnostic passed `hasMappedCombatEscape(room)` to
  `assessCombatEligibility`, while production `SessionManager.aiAction`
  explicitly allows the authorized disposable-character PvE path without a
  mapped escape. The arena's server-listed `u` exit had been proven by prior
  one-step retreats, though its destination is absent from realm exit data.
- The harness was corrected narrowly: it may skip the navigation refusal only
  when authoritative room coordinates exactly equal the requested destination
  and the only refusal is hostile attention; no movement is dispatched. Its
  provider-free PvE preflight now matches SessionManager on the escape flag
  but retains its stricter 60% health floor, exact realm-backed target
  resolution, SessionManager approval, bounded runtime, and existing policy
  checks. No production combat or policy code was changed.
- The retry resolved `nasty lashworm` to unique hybrid entity id `2`,
  hostile/certain, uncharmed, not costly, and matched it to attacker evidence.
  SessionManager approved and executed exactly `a nasty lashworm`. Telemetry
  recorded six matching hits for `2+1+3+1+1+4 = 12` damage, followed by 600
  XP and `Combat Off`. No exact-target `mob-dies` event was recorded:
  `targetDied=false`, outcome remained unresolved through the 30-second
  observation window. `fat giant rat` then became the sole attacker and
  missed repeatedly; HP stayed `51/51`. XP and target disappearance are not
  sufficient to claim a kill.
- The sanitized artifact is
  `$MudEngineHome/state/live-diagnostics/combat-2026-10-18T20-30-25-678Z-12828.json`;
  it retains parsed events/telemetry, not raw server lines. The attempt made
  zero provider requests and recorded zero violations. A one-move escape probe
  matched the `fat giant rat` to attacker evidence, sent `u`, and verified
  `1/2150` -> `1/2146`, `51/51` HP, and no attackers. A fresh read-only probe
  confirmed that safe state.
- Focused LiveHarness/NpcDiscovery tests passed 66/66. Post-change full
  validation passed: 7,070 serial tests with 2 skipped across 253 files,
  18/18 realm tests, production build/typecheck, secret scan (47 files under
  the resolved roots; no configured password found), script syntax, and
  `git diff --check`. The existing renderer chunk-size warning remains.

### 2026-10-18 — exact-target kill verified

- The earlier `nasty lashworm` attempt remains unresolved: its trace had
  target-matching damage, 600 XP, and `Combat Off`, but no exact death source.
  No kill is inferred retroactively.
- Root cause of the missing result was a diagnostic evidence gap, not a
  demonstrated combat-execution failure. `CharacterTracker` passes an
  in-memory `FightRecord` with `killedBy: 'sentence'` when its exact-target
  death-sentence matcher succeeds, but the harness used `NO_FIGHTS` and only
  watched explicit `mob-dies` blocks. The parser could therefore recognize an
  exact named sentence without the harness recording it.
- The provider-free harness now supplies a bounded in-memory fight sink and
  summarizes only parsed mob identity, damage, kill status/source, and whether
  the character opened the fight. Exact death requires the normalized selected
  target, `killed: true`, and `killedBy: 'sentence'`; XP-proxy records and
  `Combat Off` alone do not count. No raw server text is retained.
- The harness also observes for up to 10 seconds, without sending commands,
  when an explicitly requested target is a unique hybrid mob with uncertain
  disposition and no attacker evidence yet. It proceeds only after the live
  attacker list changes, then re-reads state and runs the existing eligibility
  and SessionManager approval checks. Health below the 60% probe floor,
  unrelated attackers, or an active engagement still prevent the request.
- Live encounter: Walker verified `1/2146` -> `1/2150`. After 3,919 ms of
  observation, `fat giant rat` matched the authoritative attacker list. Its
  hybrid entity IDs were `[1, 109, 1116]`, disposition hostile, classification
  uncertain, uncharmed, and alignment cost `sometimes`; the existing
  attacker-evidence path selected it by its unique live room name. SessionManager
  approved and executed `a fat giant rat`. The tracker recorded 13 character
  damage, `killed: true`, `killedBy: 'sentence'`, and exact-target death; the
  stream showed 450 XP and `Combat Off`. Kefka finished at `51/51` HP with no
  active target or attackers. The configured post-combat rest threshold was
  not due. Provider requests: zero; policy violations: zero.
- The artifact
  `$MudEngineHome/state/live-diagnostics/combat-2026-10-18T20-56-35-824Z-27212.json`
  contains bounded parsed events and the fight summary, not raw server lines.
- Validation after the harness change: 7,074 passed, 2 skipped across 253
  files; realm tests 18/18; typecheck and production build passed; secret scan
  found no configured password in 48 files; script syntax and `git diff
  --check` passed. The existing renderer chunk-size warning remains.

At that checkpoint the live state was `1/2150`, `51/51`, no target or attackers.
One provider-free, explicitly targeted exact kill was live-confirmed; this does
not establish repeatability, autonomous target choice, low-health recovery, or
a connected multi-step objective. Next, repeat the core demonstration only
when a fresh room observation finds a legitimate eligible target, then run a
bounded provider-driven multi-step objective and verify discovery, inspection,
combat, recovery/resumption, and a subsequent objective without claiming
unobserved success.

### Later 2026-10-18 update — location fallback and connected live objective

- A full live run first stopped before provider activity: the GreaterMUD
  configured `sys status` locator yielded no authoritative coordinates, even
  though room text and health parsed. The existing read-only room-probe path
  then used the documented `pro` profile query and resolved the exact room.
  Root cause was inconsistent startup fallback, not navigation or combat.
- Full-session startup now uses the configured locator at user priority and,
  only for GreaterMUD after no numeric coordinates arrive, tries the documented
  read-only `pro` fallback once. Both paths still require parsed authoritative
  `map/room` coordinates. A focused regression covers an accepted configured
  request with no response followed by fallback success.
- Before this change, the full harness demonstrated the distinction between
  target victory and encounter settlement: it selected `fierce acid slime`,
  recorded exact-target death and XP, but another attacker remained at
  `45/51` HP, so it correctly marked combat unresolved and skipped
  recovery/navigation. Kefka later retreated through SessionManager with one
  `u` move and recovered in the verified empty room.
- Additional exact-target live evidence from provider-free probes:
  `thin kobold thief` (realm ID `[7]`, certain hostile) died with
  `killedBy: 'sentence'` evidence and 650 XP; the uncertain hybrid
  `angry giant rat` (IDs `[1, 109, 1116]`) died with named-sentence evidence
  and 450 XP; `large lashworm` (ID `[2]`, certain hostile) died with 17
  tracked damage, named-sentence evidence, and 600 XP. The rat encounter left
  a distinct lashworm attacker, so it remained unresolved until that exact
  attacker was separately selected. The lashworm fight ended at `50/51` with
  no attackers; a later fresh observation found a new uncertain rat, which was
  not attacked and was safely retreated from.
- A second full provider-driven run passed end-to-end: the provider chose
  `inspect_room`; Walker navigated `1/2146` -> `1/2150`, then one- and
  two-room scenarios passed; the mapped resident Corwyn was inspected; the
  integrated objective navigated to and inspected the Arena. Combat and combat
  result were safely skipped because the only visible mob had uncertain realm
  classification and no verified attacker evidence. Recovery completed as a
  no-op because health was `51/51`, above configured `restBelow=0.35`. Four
  provider requests used 12,051 tokens at estimated cost `$0.0019908`
  (ceiling `$0.05`); no policy violations occurred.
- A low-health recovery probe was verified: after an encounter and
  policy-approved retreat, `36/51` HP rose to `46/51` during the first
  60-second probe (which correctly reported its full-health target unmet).
  A follow-up from `46/51` reached `51/51` within the same 60-second ceiling,
  without leaving the empty room. Later recovery from `49/51` to `51/51` also
  passed. No saved profile thresholds were changed.
- Validation after the location fallback: focused LiveHarness/NpcDiscovery
  71/71; full suite 7,075 passed and 2 skipped across 253 files; realm tests
  18/18; typecheck/build passed; secret scan found no configured password in
  51 files; script syntax and diff checks passed. The existing renderer
  chunk-size warning remains.

Latest live state is `1/2146`, `51/51`, no active target or attackers, verified
by the final one-step retreat. The startup fix and connected multi-step
objective are confirmed, but repeatable provider-selected combat is not:
combat remains correctly skipped whenever realm identity/hostility is
uncertain, and the real production recovery threshold has not been crossed in
an autonomous encounter. Next highest-value work is to make an objective
choose and pursue a verified target when one exists, then verify
recovery/resumption and a subsequent objective in one bounded live session.

## Latest continuation: bounded rat victory and production thresholds (2026-10-18)

- The current `development` base was `d76d6a5`. Kefka's saved gameplay settings
  were changed, without printing or committing profile data: rest starts below
  `0.70` and targets `0.80`; retreat is enabled at two attackers. Existing
  health retreat at `0.30` is unchanged. Provider ceilings and combat policy
  were not changed.
- `LiveHarness` now configures its supervised exact-target combat probe with
  those saved rest and retreat values while leaving unrelated automation,
  consumables, automatic combat, movement, and loops disabled.
- A bounded provider-driven run verified inspection, Arena arrival/return,
  one-/two-room navigation, Corwyn inspection, policy refusals, manual
  priority, budget enforcement, and emergency stop. It used 4 requests,
  12,039 tokens, about `$0.0019818`, with zero policy violations. The Arena
  objective skipped combat because its one visible mob was uncertain and not
  a verified attacker; recovery correctly did not run at full health under
  `restBelow=0.70`.
- A later read-only probe found Kefka at `1/2150`, `51/51`, with one
  `large giant rat` attacker. The hybrid entity had IDs `[1,109,1116]`,
  hostile disposition, uncertain classification, and `costly: sometimes`.
  Fresh attacker evidence made this exact target eligible through the
  existing policy gate. The supervised provider-free probe dispatched
  `a large giant rat` through SessionManager approval. Parsed evidence showed
  matching hits and misses, 12 tracked damage, exact named-sentence death,
  450 XP, `Combat Off`, unchanged `51/51` HP, and no remaining attackers.
  Its initial settle budget elapsed, but the bounded post-timeout observer
  captured the terminal evidence about 6 seconds later; the result was
  resolved, not left ambiguous. A bounded parsed diagnostic artifact was
  persisted; no raw server lines were retained. Provider usage and policy
  violations were zero.
- The follow-up recovery decision correctly reported "not due" at `51/51`.
  Live recovery at the new saved `0.70`/`0.80` thresholds and retreat at the
  saved two-attacker threshold are not yet directly demonstrated. Provider-
  selected combat, post-combat recovery after actual damage, and resumption
  into a subsequent objective remain the highest-value work.
- Focused SessionManager/Recovery/Walker/RecoverySafety suites passed 611/611;
  the post-change LiveHarness suite passed 55/55. Run the full suite,
  typecheck/build, secret scan, syntax, and diff checks before pushing this
  checkpoint. Last live state at probe completion: `1/2150`, `51/51`, no
  active target or attackers.

## Current checkpoint: integrated combat and verified withdrawal (2026-10-18)

- The provider-driven integrated run first exposed a harness approval-supervisor
  bug: its second eligibility check omitted the current authoritative attacker
  list, so an uncertain hybrid mob stayed pending even though the production
  target gate and preflight recognized it. The supervisor now passes that
  current evidence into the same eligibility check; SessionManager still
  revalidates target identity and policy before execution. Stale approvals now
  request fresh approval after a material state change rather than leaving an
  active objective stuck. A related regression in generic-command approval
  queueing (`context` was undefined) was fixed and covered.
- After the harness correction, one connected live objective completed:
  `big giant rat` was the exact verified attacker, its SessionManager approval
  executed, and the parsed harness reported exact-target death plus XP evidence.
  HP remained `51/51`, so recovery correctly reported not due; this run does
  not demonstrate recovery after combat damage. In the same session, one-room
  and two-room navigation succeeded, Walker reached `1/2147`, and MudEngine
  inspected Corwyn. The full harness used 4 provider requests, 12,299 tokens,
  estimated `$0.0020163`, with zero policy violations.
- A separate provider-free exact-target attempt later saw two live rat
  attackers. It dispatched `a big giant rat`, observed engagement, then sent
  one `u` and settled in `1/2146` at `51/51` with no attackers. It recorded no
  hit/miss, damage, XP, or death evidence; this is a verified withdrawal, not
  a victory. The bounded artifact
  `$MudEngineHome/state/live-diagnostics/combat-2026-10-18T22-43-30-780Z-10048.json`
  preserves the parsed target identity, attacker list, commands, and state
  snapshots without raw server lines. The exact trigger for the withdrawal
  was not separately emitted.
- Validation: full suite 7,086 passed and 2 skipped across 253 files; realm
  suite 18/18; focused approval/escape regressions passed; typecheck, production
  build, secret scan (54 user-scoped files, no configured password), script
  syntax, and diff checks passed. The existing renderer chunk-size warning
  remains.
- Latest live state: `1/2146`, `51/51`, no active target or attackers; Corwyn
  is visible. Next priority: capture the retreat reason explicitly and find a
  bounded, legitimately eligible encounter that causes real HP loss, then
  demonstrate recovery and selection of a subsequent objective in one
  connected session. Do not disable retreat or claim recovery from the
  full-health no-op.

## Current checkpoint: retreat reason and recovery after real damage (2026-10-18)

- The provider-free combat artifact
  `state/live-diagnostics/combat-2026-10-18T22-52-45-789Z-16612.json`
  identifies the selected `big giant rat` hybrid entity (IDs `[1,109,1116]`)
  as hostile and matched against the live attacker list. SessionManager
  approved and dispatched the exact target. Its bounded safety trace records
  `action=retreat`, `because="2 attackers — u (retrace)"`, `acted=true`.
  Combat transitioned Engaged then Off; Kefka moved from `1/2150` to `1/2146`
  and HP fell from `51/51` to `45/51`. No hit/miss, exact death, or XP was
  observed, so this was a withdrawal, not a victory.
- A separate read-only probe confirmed `1/2146`, `45/51`, and no target or
  attackers. A bounded provider-free recovery probe used temporary in-memory
  `restBelow=0.98` / `restTo=1.0`, issued `rest`, and observed `51/51` in the
  same room. The saved profile was not modified. Since `45/51` is above the
  saved `restBelow=0.70` threshold, production-threshold automatic recovery
  remains unverified. The separate probes also do not establish an
  integrated combat → recovery → subsequent-objective loop.
- The code change adds only a bounded summary of at most eight structured
  safety decisions to provider-free output/artifacts; raw server lines are
  not retained and policy is unchanged. Validation passed: 7,088 unit tests,
  2 skipped across 253 files; realm suite 18/18; typecheck and production
  build; secret scan (55 user-scoped files, no configured password); script
  syntax; and diff checks. The build retains the existing renderer chunk-size
  warning.
- Next objective: use a legitimate bounded encounter that crosses the saved
  recovery trigger, then demonstrate automatic recovery and selection of a
  subsequent objective in the same connected session. Keep retreat and all
  target/approval checks enabled.

## Current checkpoint: bounded room search, exact refusal, and safe withdrawal (2026-10-18)

- From a fresh read-only state at `1/2146`, `51/51`, no target/attackers,
  Walker verified the route to `1/2150`. A request for the documented
  `big carrion beast` was refused before combat: two visible mobs had
  uncertain realm classification and there was no unique eligible target.
  A later read-only probe in `1/2150` observed `41/51` and two attackers,
  `big giant rat` and `angry giant rat`; both remained uncertain hybrid
  identities, with combat not yet engaged.
- The bounded escape probe confirmed an authorized retreat: the
  `angry giant rat` matched realm and attacker evidence, positive HP was
  observed, and one `u` moved Kefka from `1/2150` to `1/2146`, clearing the
  attacker list. The probe reported no policy violations.
- A subsequent exact-target PvE probe waited 2,078 ms for attacker evidence,
  then SessionManager approved and dispatched only `a big giant rat`
  (hybrid IDs `[1,109,1116]`, hostile, verified attacker). The structured
  safety reason was again `2 attackers — u (retrace)`; retreat issued one
  `u` and settled in `1/2146`. There were no hit/miss, death, or XP records.
  HP ended `45/51` (starting `43/51`), so no damage-driven recovery was due at
  the saved `restBelow=0.70`. The probe correctly reported no victory. Its
  parsed artifact is
  `state/live-diagnostics/combat-2026-10-18T23-05-25-815Z-15436.json`.
- Walker then verified exploration of `1/2143`, `1/2140`, `1/2148`, `1/2149`,
  `1/2141`, and `1/2142`. The observed occupants were absent in the first
  three rooms and passive (`ferryman`, `Nathaniel`, `Betram`) in the latter
  three; no eligible hostile was found. All probes used zero provider
  requests/tokens and reported zero policy violations. Current read-only
  state: `1/2142`, `45/51`, no target/attackers, passive Betram.
- The bounded scan continued through the remaining pre-approved Guild room:
  Walker reached `1/2147` via `n,w,w,n`, and a read-only probe found passive
  Corwyn, `45/51`, and no target or attackers. Final live state is
  `1/2147`, `45/51`, no target/attackers. The approved Newhaven scan found no
  eligible single hostile outside the two-attacker Arena group.
- A distinct-target attempt from the Guild requested the historically observed
  `large filthbug`. Walker reached `1/2150`, but that target was absent; the
  harness refused combat because the two visible rats still had uncertain
  realm classification. A fresh read-only probe found `45/51` and both rats
  in the attacker list. The bounded escape probe matched `angry giant rat`
  to the attacker/realm evidence and returned via one `u` to `1/2146`, with
  attackers cleared, `45/51`, and zero violations. No combat command was
  issued for the filthbug request. Current state: `1/2146`, `45/51`, no
  target/attackers.
- The current obstacle is now concrete: the observed Arena hostiles arrive
  together and trigger the saved outnumbered retreat before combat progress;
  the other inspected, approved Newhaven rooms contain no eligible hostile.
  Do not weaken retreat or classify uncertain mobs as safe targets. Next,
  inspect another legitimately reachable area or wait for an authoritative
  single-hostile opportunity, then verify saved-threshold recovery and resumed
  objective selection if actual damage crosses the trigger.

Resume with a fresh read-only probe, then the bounded provider-driven run only
if its state remains appropriate:

```powershell
node --import ./scripts/lib/register.mjs scripts/ai-live.mjs --live --profile kefka --room-probe-only --max-ms 60000 --max-moves 0
npm run test:ai-live -- --live --profile kefka --max-ms 120000 --max-moves 12 --max-requests 16 --max-tokens 60000 --max-cost 0.05
```

## Latest checkpoint: dungeon candidate is level-gated (2026-10-18)

- `development` is the active branch. Current work adds only bounded live
  harness checks/documentation; `.npm-cache/` remains untouched.
- Fresh read-only Kefka state: `1/2146`, `45/51`, no target or attackers,
  `progress.level === null`. The read-only room probe used no provider calls
  and exposed no raw server lines.
- Offline realm evidence: `1/2156` is a `(Max 1)` cave-bear lair, but the
  three-step route crosses an Arena exit restricted to levels 0-5, the
  `(Max 3)` Dungeon Entrance at `1/2152`, and a dark-room segment. A level-6
  route is blocked; level 1 is routable. Light readiness is not verified.
- The harness now includes `1/2156` in its explicit Newhaven destination
  allowlist, reports a known tracker level, passes it to route preflight, and
  refuses to dispatch a route containing a level gate when level is unknown.
  The live four-move Walker probe returned that refusal before movement;
  Kefka stayed at `1/2146`, with zero policy violations/provider requests.
  This proves a safe refusal only, not dungeon navigation or combat.
- The first route check refused because character level was unknown. The
  exact user-initiated read-only probe allowlist now includes `st` alongside
  `health`/`pro`; arbitrary commands remain rejected. The room-only harness
  requests the status sheet at most once, with idle and entry automation
  disabled, and waits up to five seconds for the parsed level. It reports no
  raw status lines. Its live result still needs a fresh run. Light readiness
  must also be established, and the multi-mob entrance must not be traversed
  blindly.
- Focused `WorldGraph.test.ts`: 381/381 passed. Script syntax, live
  pre-dispatch refusal, and diff checks passed. No full build or full suite
  was run because this checkpoint changes only the live harness and docs.
- The earlier `1/2156` command below is historical only; do not run it
  blindly. The level gate now passes, but this route still crosses the
  multi-mob lair at `1/2152` and a dark segment with unknown light readiness.
  Current state is safer at the level-eligible `1/2190` Healer room.

Safe resume observation:

  ```powershell
  node --import ./scripts/lib/register.mjs scripts/ai-live.mjs --live --profile kefka --room-probe-only --max-ms 60000 --max-moves 0
  ```

  The overall sustained-combat and recovery loop is still unresolved.

## Follow-up: authoritative level and one-room exploration (2026-10-18)

- The read-only room probe now requests `st` once if tracker level is unknown.
  The user-priority exact read-only allowlist contains `health`, `pro`, and
  `st`; other commands remain rejected. `SessionManager.ask` tags only exact
  `st` with the existing `probe:st` queue key, so the monitor distinguishes
  the status sheet from the server-specific `st` movement alias. An initial
  run exposed the missing tag (one false movement-limit violation); focused
  tests now cover the exact command and tagged monitor behavior.
- Repeated read-only live probe: Kefka at `1/2146`, level 1, 8 lives,
  `45/51`, no target/attackers. The previous Arena gate is therefore valid.
- A one-move Walker probe verified `1/2146` → `1/2150`. Fresh read-only room
  observation found `big giant rat` and `angry giant rat` as two hostile
  current attackers; no attack was issued. The bounded escape probe sent
  exactly one `u`, verified return to `1/2146`, cleared attackers, and left
  Kefka at `47/51`, with no violations.
- A subsequent one-move Walker probe verified `1/2146` → `1/2190` (Newhaven,
  Healer). Fresh read-only observation found the passive realm-backed
  `healer`, no attackers/target, and `47/51`. No inspect or interaction action
  was issued. `1/2190` is now a pre-approved one-step destination.
- Latest observed live state: `1/2190`, level 1, 8 lives, `47/51`, passive
  healer, no attackers or target. Do not enter the dark cave route yet: light
  readiness is unknown and the path crosses the multi-mob lair at `1/2152`.
  The latest probes demonstrate status parsing, verified navigation, and
  safe retreat, not sustained combat, victory, or recovery.
- Focused tests passed: SessionManager read-only probe authorization (1),
  LiveHarness tagged status movement (1), full SessionManager (279), and
  WorldGraph (381). Full-suite runs each had one unrelated filesystem watcher
  failure in `ConfigStore.test.ts` ("no change event"); the parallel run also
  hit two `SessionLog.test.ts` `ENOTEMPTY` temp-cleanup races. Running
  `ConfigStore.test.ts` alone passed 12/12, and serializing the suite removed
  the SessionLog races but not the ConfigStore watcher timeout
  (7,087 passed, 2 skipped, 1 failed). Realm suite passed 18/18.
  `npm run build` passed both typechecks and the production build; the
  existing large-renderer-chunk warning remains. Secret scan passed over 56
  user-scoped files; no configured password was found. Syntax and diff checks
  passed. Preserve `.npm-cache/`.
- Next: re-evaluate live state. Engage only if a legitimate target appears
  and existing safety/retreat checks permit it; otherwise keep advancing
  through safe exploration and NPC inspection without risking the
  two-attacker Arena group.
