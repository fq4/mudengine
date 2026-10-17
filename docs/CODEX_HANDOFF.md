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

- Latest offline Phase 6 verification: `npm test` passed 7,009 tests with 2
  skipped across 253 files; `npm run test:realm` passed 18/18;
  `npm run typecheck`, `npm run build`, `npm run check:secrets`,
  `node --check scripts/ai-live.mjs`, and `git diff --check` passed. The build
  retains the existing renderer chunk-size warning; the secret scan found no
  configured password in 45 user-scoped files.
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
  The next live attempt did not reach a room identity, and a later one remained
  `authenticating`; neither reached provider/gameplay scenarios. Pause further
  live runs until Kefka's login and placement are confirmed.
- Latest local validation: 7,009 tests passed, 2 skipped across 253 files;
  typecheck, production build, secret scan, harness syntax check, and
  `git diff --check` passed. The renderer chunk-size warning remains.
- After the combat-settlement change, focused AI tests passed 27/27 and
  `node --check scripts/ai-live.mjs` / `git diff --check` passed. The live
  follow-up was blocked before gameplay as described above; no live combat
  result is claimed for the longer bound.
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
- Latest bounded live run stayed within 120,000 ms / 16 requests / 60,000
  tokens / $0.05, using 6 requests, 19,952 tokens, ~$0.00320 and zero policy
  violations. It found no authoritative NPC to inspect, but preflighted the
  visible hostile `acid slime`, executed its exact-target approval, sent
  `a acid slime`, and observed active combat state. The 15-second observation
  did not prove a kill or victory. The overall run exited non-zero because
  one provider navigation action had no destination, a later route was
  deferred by recovery priority, and recovery was attempted before combat was
  authoritatively ended. The harness now skips all post-combat actions until
  it observes `ended`; that new branch is syntax-checked, not yet live-rerun.
- The no-objective scheduler-selection flow is covered deterministically and is
  not considered live-verified until a future bounded run reports it.
- The migration suite passes in isolation: 374/374 tests. The `ENOTEMPTY`
  cleanup issue remains limited to concurrent full-suite execution and is not a
  Phase 5 production defect.

Read `docs/ai-live-test.md` for the chronology, `docs/ai-capability-inventory.md` for capability mapping, and `docs/ai-technical-spec.md` for architecture and decisions.

## Outstanding work

1. Verify a completed bounded PvE encounter with authoritative victory evidence
   and exercise low-health recovery live, after confirming Kefka can enter the
   game and has an authoritative room placement. The latest attack ended
   without XP or target-death evidence; the recovery gate was not exercised
   because HP was already full. Inspect an NPC only when authoritative NPC
   state is visible.
2. Investigate the historical arena movement report further if its missing
   capture becomes available. Repeated current routes pass, but the exact
   server-side cause of the original timeout cannot be established without it.
3. Improve general-command completion feedback beyond queue acceptance while
   preserving CommandQueue ownership.
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
