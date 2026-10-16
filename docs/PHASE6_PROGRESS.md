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
- **Prerequisite-aware target search and Walker lifecycle**:
  - NPC and required-combat objectives can delegate navigation to a reachable
    unvisited frontier when no suitable target is currently visible. Walker
    remains the sole route executor and confirms arrival through its real
    `onCharacter()`/`ended` lifecycle.
  - When an authoritative room observation places a named resident and the
    server lists that same occupant, the tracker now links the resident entity
    to that visible occupant. NPC inspection can use the room's realm-backed
    identity without guessing from capitalization or a bare name.
  - Combat selection requires an authoritative hostile mob accepted by
    `findSafeCombatNpc`; uncertain, player, passive, charmed, and
    alignment-costly occupants are excluded. Explicitly optional combat and
    its result-review step are skipped only when no suitable hostile is
    visible; mandatory combat continues searching reachable frontiers.
  - Mixed objectives containing unsupported intent do not enter the
    scheduler-backed path. An empty candidate set now reports why the active
    target-search step is waiting instead of silently appearing to succeed.
  - AI stop, goal replacement/clear, and emergency stop interrupt an
    AI-owned Walker route without recording an unverified failure. A manual
    route is not stopped, and the scheduler journal survives AI stop.
  - The SessionManager integration fixture feeds room-location, room-name,
    occupant, and exit observations through `CharacterTracker`, verifies two
    actual Walker arrival callbacks across successive frontiers, then checks
    that NPC inspection and objective completion occur only in the tracker-
    confirmed resident room.
- Tests: scheduler/store/objective coverage plus SessionManager/SessionHost
  coverage verify progress signals, snapshot persistence, broad-objective
  routing, NPC frontier search, resident discovery, and session isolation.

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
5. Define an explicit action-to-policy mapping before hiding named
   capabilities by policy.

## Known issues

- `npm run lint` fails the pre-existing repo-wide Prettier baseline. Do not
  mass-format.
- Legacy live navigation scenarios may fail when recovery takes priority or
  the model omits a destination; this is intended safety behaviour.
- Windows PowerShell here-strings with `${...}` interpolate; write TS files
  with the editor tools, not shell string rewrites.

## Verification (this checkpoint)

- Focused tracker, SessionManager, and NPC discovery suites: 888 passed across
  three test files.
- Full deterministic suite: 6,989 passed, 2 skipped across 253 files.
- Realm coverage: 18 passed across 2 files.
- Node and renderer typechecks: passed. Production build: passed; the existing
  large-renderer-chunk warning remains.
- Secret scan: passed against 45 files under the configured user-scoped
  profile; no configured password was found.
- Bounded Kefka live harness (2026-10-14): 24/24 scenarios passed with no
  policy violations; 5 provider requests, 11,653 total tokens, estimated cost
  ~$0.002. Broad-objective/provider and scheduler selection both chose
  `inspect_room`; the harness also verified inspection, safety refusals,
  bounded combat, navigation, manual interruption, budget enforcement, and
  emergency stop. It did not exercise persisted frontier selection.
- Public-chat testing remains opt-in and isolated from the default harness. A
  five-minute Kefka mode only approves up to five `send_message(gossip)`
  actions matched to recent inbound gossip, retains the production social
  pacing and provider ceilings, and redacts message text from its trace.
  Production reply objectives expose a gossip `send_message` candidate only
  while a recent inbound event authorizes it. Conversation blocks wake the
  session agent even when tracker state is unchanged; waiting remains a no-op
  until a meaningful event. Deterministic tests cover candidate visibility,
  reply gating, and the monitor bounds. Item-use intent requires item or
  consumption language, so "Use send_message" and "use another channel" do
  not create an inventory-use objective.
- Bounded Kefka gossip run (2026-10-15): five minutes, 2 provider requests,
  4,475 tokens, estimated cost ~$0.00074, zero monitor violations. No inbound
  gossip arrived, so no reply was sent; this run is inconclusive for live
  server acceptance of `gos`.
- Follow-up supervised gossip run (2026-10-15): 282 seconds, 7 provider
  requests, 16,554 tokens, estimated cost ~$0.00275, no inbound gossip, and
  zero replies. No server reply path was exercised. Messages received before
  the harness connected were not replayed to it. The social harness suppresses
  profile `onEnterRealm` probes
  while retaining conservative movement detection (`st` remains counted as a
  possible room-exit alias); this avoids entry-probe ambiguity without
  weakening the zero-movement limit.
- First live gossip reply observed (2026-10-15): a configured sender session
  sent one test message through `CommandQueue`, and the sender received a
  `conversation-gossip` reply from Kefka. The AI reply path reached the live
  server. Two runs observed the reply, but the harness exited before writing a
  final report: first the `sink.character` callback was missing; the second
  exposed a missing `sink.dropped` callback. Both callbacks are now implemented,
  and unexpected drops are recorded as failures.
- Clean-report retry (2026-10-15): the responder disconnected after 24 seconds,
  before receiving gossip; 4 requests, 9,276 tokens, about $0.00152, 0 replies.
  The responder and configured sender profiles share the same login and server,
  so concurrent use may have caused the drop, but this is unconfirmed. Do not
  use them simultaneously.
- Sender-side follow-up (2026-10-15): one fresh test gossip was sent, a reply
  was received, the sender did not disconnect, and it was retained through the
  responder window. This confirms live communication and that the sender
  remained connected while the reply arrived. The sender-side check did not
  provide a complete responder harness report with request, token, cost, and
  monitor totals. No message text was retained.

## Action-to-policy mapping checkpoint (2026-10-16)

- `ActionPolicy.ts` defines a typed policy for every AI action. Policies state
  risk, authorization, authorization scope, failure behavior, audit label,
  completion owner, and capability-specific validation.
- `SessionManager.executeAiAction()` is the shared enforcement gateway for
  direct, provider, scheduler, and approved actions. It validates against the
  current session and authoritative tracker evidence before approval or side
  effects; approval execution revalidates against current state.
- NPC inspection and combat require one uniquely identified visible NPC,
  combat additionally requires a conservatively classified hostile mob,
  item use requires explicit objective intent and one eligible carried item,
  and gossip replies require the channel plus a recent inbound message.
  Movement, recovery, equipment, communication, and commands retain their
  existing production owners and queue path. General commands defer
  authorization to command classification rather than blanket-gating the
  wrapper capability.
- Policy scope, failure behavior, and completion owner are included in the
  provider-neutral action-policy observation. Shared objective-intent helpers
  keep social/equipment authorization consistent between observation,
  candidate selection, and execution. Duplicate NPC/mob names are excluded
  from both candidate selection and execution.
- Focused tests passed: 303/303 across policy, activity selection, NPC
  discovery, observation, and SessionManager suites. Candidate selection
  refuses ambiguous target names; the scheduler regression suite verifies
  blocking after repeated failures and avoiding repeated no-progress work.
- Final full suite passed: 6,996 passed, 2 skipped across 253 files. Typecheck,
  production build, and secret scan passed. An earlier concurrent run hit the
  known `SessionLog.test.ts` `ENOTEMPTY` cleanup race; that file passed 14/14
  in isolation and the final full-suite rerun was clean.
- Bounded Kefka harness (2026-10-16): 20 scenarios, 16 passed, zero policy
  violations, 4 provider requests, 11,930 total tokens, estimated cost
  ~$0.00193. Broad-objective inspection, inventory/equipment/combat safety
  refusals, unknown-command approval, manual interruption, budget enforcement,
  emergency stop, and one-/two-room navigation passed. The legacy
  `newhaven-arena-navigation` scenario stalled on an unanswered move; later
  arena inspection/target/combat scenarios were consequently unavailable.
  No authoritative hostile NPC was visible, so no live PvE engagement was
  attempted. The harness exited non-zero; do not describe the live run as a
  full pass.

## Live navigation stall and bounded PvE checkpoint (2026-10-16)

- The original failed-run capture was not present in the workspace, so its
  exact movement command, server response, transition sequence, and retry
  behavior remain unverified. At commit `2874a79`, the harness itself had a
  concrete lifecycle defect: after an eight-second wait for any room change it
  could dispatch `navigate_to` again while Walker still owned the route.
  Re-dispatching could supersede or be refused by the active Walker operation;
  this is a demonstrated harness defect and a plausible cause of the reported
  stall, not proof of the missing run's exact server-side failure.
- The harness now dispatches a route once, awaits Walker's terminal lifecycle,
  and counts arrival only when Walker reports `arrived` and the authoritative
  current room equals the requested destination. A missing/failed verification
  skips dependent arena actions; it does not mark movement successful or retry
  blindly. Walker's destination, exit, and move-acknowledgement checks are
  unchanged. Regression coverage exercises arrival, intermediate transitions
  without redispatch, refusal, and timeout.
- Repeated bounded Kefka navigation evidence: four arena routes reached
  `1/2150` from `1/2143`, `1/2190`, `1/2144`, and `1/2190`; the fourth is from
  the latest harness run. The prior repeated run also completed its one-room
  and two-room routes. In the latest trace, Walker dispatched `e`, then `d`,
  finished `arrived`, and the authoritative room changed from `1/2190` to
  `1/2150`.
- Latest full harness invocation used the documented caps: 120,000 ms, 16
  requests, 60,000 tokens, and $0.05. It used 6 provider requests, 19,952
  tokens, and about $0.00320, with zero policy violations. Arena navigation,
  health observation, target discovery, and combat preflight passed. No
  authoritative non-player NPC was visible in the tested rooms, so NPC
  inspection was correctly skipped. A uniquely identified hostile `acid
  slime` passed preflight; after exact-target approval through
  `SessionManager`, the wire trace contained `a acid slime` and authoritative
  combat state became active. The fight remained active at the 15-second
  bounded observation; no kill or victory is claimed.
- Kefka's passive combat setting was disabled. The approved `engage_enemy`
  capability now creates a temporary, exact-target lease inside `AutoCombat`;
  it leaves the profile setting unchanged, requires the master automation
  switch and one authoritative hostile target, revalidates target identity and
  hostility on each room observation, and cancels on target departure/fight
  end, AI pause/stop/emergency stop, objective replacement, manual gameplay,
  or master automation disable. SessionManager remains the approval boundary
  and AutoCombat remains the sole combat loop. Focused AutoCombat and
  SessionManager suites passed 497/497, including approved execution and
  manual interruption.
- The same live run was non-zero for separate reasons: one provider-driven
  one-room action supplied no resolvable destination, and the two-room action
  was deferred by recovery priority. The harness also tried recovery while
  the authoritative combat outcome was still `active` and did not recover
  within its window. The harness now skips post-combat recovery, inventory,
  and equipment scenarios unless combat has authoritatively ended; this
  reporting/safety correction passed `node --check` but has not yet been
  exercised by another live run. These failures do not reproduce the arena
  Walker stall.
- Validation after the AutoCombat change: the full suite passed 7,009 tests
  with 2 skipped across 253 files; `npm run test:realm` passed 18/18;
  `npm run typecheck`, `npm run build`, `npm run check:secrets`,
  `node --check scripts/ai-live.mjs`, and `git diff --check` passed. The build
  retains the existing renderer chunk-size warning.

## Remaining work

The repeated arena arrival verifies the corrected Walker lifecycle path, but
the exact cause of the historical server timeout cannot be proven without its
capture. A live hostile was engaged only after exact approval, but the bounded
window ended with combat still active; victory and post-combat recovery remain
unverified. No authoritative NPC was visible in the tested rooms, and the
latest provider-driven one-/two-room objectives were separately blocked by
missing destination input and recovery priority. Keep these as distinct
limitations rather than treating them as navigation failures.

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
