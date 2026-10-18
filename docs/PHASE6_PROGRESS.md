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
  No eligible authoritative hostile mob target was visible, so no live PvE
  engagement was attempted. The harness exited non-zero; do not describe the
  live run as a full pass.

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
  inspectable room resident (`kind === 'npc'`) was visible; mob targets are
  checked separately. A uniquely identified hostile `acid slime` passed
  preflight; after exact-target approval through
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

## Bounded navigation follow-up (2026-10-17)

- The next documented bounded Kefka run again reached the Arena through
  Walker: `1/2190` → `1/2150`, with `arrived` and authoritative room
  verification. This is a fifth observed successful Arena route on the
  corrected single-dispatch lifecycle path; it still does not establish the
  exact cause of the missing historical timeout capture.
- The run used 2 provider requests, 5,813 tokens, and an estimated $0.00095115,
  within the unchanged 120-second, 16-request, 60,000-token, and $0.05 caps.
  There were zero policy violations. No inspectable room resident
  (`kind === 'npc'`) was visible; two authoritative combat mobs were
  discovered and `acid slime` passed combat preflight.
- The approved exact-target attack was dispatched, but the bounded combat
  observation reported `unsafe` and triggered emergency stop. The harness
  correctly skipped post-combat actions and one-/two-room navigation rather
  than attempting movement after an unsafe health state. The combat scenario
  failed as intended; no victory, death, or recovery is claimed. All other
  listed safety, approval, budget, and emergency-stop checks passed.
- Focused harness verification after this follow-up: `node --check
  scripts/ai-live.mjs` passed, and the bounded live run exercised the route
  skip while reporting the combat safety failure. One-/two-room movement was
  not exercised in this run because combat reached the unsafe guard.

## Recovery timing and bounded gameplay follow-up (2026-10-17)

- The prior low-health harness attempt spent its 45-second recovery window
  without recording HP, rest state, combat state, or the profile thresholds.
  Its exact failure cause is therefore unconfirmed. The checked-in recovery
  notes document 2 HP per 5 seconds while resting on a measured realm; for
  example, 40/100 to the harness's 60% combat threshold can take about 50
  seconds. The old fixed timeout could therefore reject legitimate recovery,
  but this calculation does not prove that was the cause of that attempt.
- The harness now treats authoritative HP >= 60% and no active combat as
  recovery-ready even if the character remains resting; a verified movement
  naturally ends rest. It waits only for the remaining portion of the existing
  max-runtime budget (checking the runtime limit while polling), rather than
  using an independent 45-second timeout. On timeout it records HP/max HP,
  resting/meditating, combat/target/attacker state, configured `restBelow` /
  `restTo`, and the AI action result. Production Recovery behavior and combat
  preflight were not weakened.
- Focused AI tests passed 27/27. Full `npm test` passed 7,014 tests with 2
  skipped across 253 files; `npm run typecheck`, `npm run build`,
  `npm run check:secrets`, `node --check scripts/ai-live.mjs`, and
  `git diff --check` passed. The build retains the existing renderer
  chunk-size warning.
- The next capped live run passed every listed scenario with zero harness
  violations, 4 provider requests, 12,460 total tokens, and estimated cost
  $0.00207375 (under the unchanged 120,000 ms / 16 request / 60,000 token /
  $0.05 caps). Walker verified Arena arrival `1/2144` -> `1/2150`, and the
  one-room and two-room navigation cases also passed. Two authoritative combat
  mobs were found; no inspectable resident NPC was visible. The approved
  exact-target combat action ended without target-death or XP evidence
  (`outcome=ended`, `targetDeathObserved=false`, `xpVictory=false`), so no kill
  or victory is claimed. HP was already full at the post-combat check, so the
  low-health recovery wait was not exercised live in this run.
- A subsequent bounded run again reached the Arena and its two-mob discovery
  and combat preflight passed, but the exact-target fight remained active until
  the former 30-second settle window ended; the final classification was
  `unsafe`, with no target-death or XP evidence. The trace confirms the attack
  command and a later observation, but the report did not yet include final HP,
  so death versus active combat below the 30% classifier threshold is unknown.
  Post-combat steps and routes were correctly skipped.
- Combat settling now uses only the remaining existing max-runtime budget,
  with a runtime check on each poll, and reports final HP/max HP, target,
  engagement, and attacker count. This leaves the exact-target production
  AutoCombat owner in control longer without changing the 60% preflight, the
  `CombatOutcome` classification, or the 120-second / request / token / cost
  ceilings. The follow-up live invocation after this edit did not reach room
  placement; a further connection stopped in `authenticating`. Neither reached
  provider or gameplay scenarios, and no raw login response was retained.
- A later bounded retry again remained `authenticating` after credential
  submission and issued no gameplay/provider action. The harness now includes
  only parsed phase/room/HP/combat state plus a capped count of parser block
  types in login-timeout reports; it never retains block text or raw traffic.
  The latest run reported `login-welcome` and 146 `unknown` blocks, but no
  recognized in-game status line. Kefka's local profile has two login script
  steps, both account prompts; its inline server definition supplies no server
  menu script. A changed/unmatched post-credential menu is one possible
  explanation, not a confirmed cause because its text is deliberately not
  captured. Timeout reporting also exposes only the configured step count.
  Do not guess a menu answer or retry login further until login availability
  and the required prompts are confirmed.
- One additional bounded diagnostic run (2026-10-17) remained at
  `authenticating`, with no room/vitals, no provider requests, and no gameplay.
  The capped sanitized tail contained seven `unknown[other]` blocks followed
  by `unknown[choose]:flush`; this keyword category does not identify a menu
  or establish what response, if any, is expected. The harness now reports
  only the last eight parser types, predefined keyword categories, and flush
  markers, never block text. Do not retry until login availability and the
  expected prompt are confirmed.
- After the user replenished Kefka's lives, the next bounded harness run
  reached in-game state and all 25 scenarios passed with zero policy
  violations. It used 4 provider requests, 12,587 tokens, and approximately
  $0.002071, within the unchanged 120,000 ms / 16 / 60,000 / $0.05 limits.
  Walker verified Arena arrival `1/2140` -> `1/2150`, followed by successful
  one-room and two-room routes (`1/2150` -> `1/2146` -> `1/2144`). The harness
  observed two authoritative mobs and engaged the eligible exact target through
  the approved SessionManager path. The result was `victory` with authoritative
  XP evidence; target-death evidence was not observed. Settlement state was
  HP 32/51, no engagement, target, or attackers. Recovery reported the
  character ready at the 60% threshold, but took no rest action; low-health
  recovery remains unverified. No inspectable room resident was present.
  This successful login supersedes the prior pause on live retries, subject
  to the same bounded harness and spend ceilings.
- A bounded follow-up exposed two harness defects while trying to exercise
  resident inspection. The harness compared `RoomOccupant.kind` with
  `'npc'`, although the actual union is `player | mob | unknown`; realm-backed
  resident identity is carried on `.npc`. Reusing the production `findSafeNpc`
  selector fixed this false skip without treating players as NPCs. An
  intermediate live encounter also recorded XP while two attackers remained
  after engagement/target cleared. The old settlement helper ignored that
  list, then spent the remaining run time waiting for recovery and attempted a
  resident route despite unresolved attackers. Settlement now reports the
  encounter unresolved if attackers remain; the harness neither reports a
  completed combat scenario nor recovers or moves on in that state.
- Corrected bounded run (2026-10-17): 27 scenarios passed with zero policy
  violations, 4 provider requests, 12,120 tokens, and estimated cost $0.002004,
  within the unchanged 120,000 ms / 16 / 60,000 / $0.05 limits. Walker verified
  arena and one-/two-room navigation, then reached Newhaven Adventurers' Guild
  (`1/2147`) from `1/2144`. The room listing and realm-backed identity matched
  Corwyn, and production `inspect_npc` returned `Observed NPC Corwyn`. In the
  Arena, two authoritative mobs were found; the eligible exact target was
  engaged through SessionManager and produced XP-confirmed `victory` evidence.
  Target-death evidence was not observed; settlement was HP 37/51, no active
  target/engagement, and zero attackers. Recovery readiness passed, but the
  character was above the configured rest threshold (`restBelow=0.35`), so no
  rest action occurred and live low-health recovery remains unverified.
- Latest bounded follow-up (2026-10-17): the reported scenarios passed with zero
  policy violations (4 requests, 11,682 tokens, estimated $0.001938). Walker
  verified Arena arrival (`1/2147` to `1/2150`), one-/two-room navigation, and
  the route back to `1/2147`; production inspection again returned
  `Observed NPC Corwyn`. One authoritative Arena mob was visible, but it failed
  the conservative hostile check, so combat was safely refused and no attack
  was issued. This run did not exercise combat settlement or recovery. The
  prior XP-confirmed PvE victory remains live evidence; low-health recovery and
  exact-target death are still unverified.
- A bounded rerun then exposed why the previous combat refusal report was too
  coarse, without changing target selection: 2 authoritative Arena mobs were
  visible, 1 was excluded for uncertain realm classification, and 1 eligible
  lashworm passed the existing PvE gate. SessionManager exact-target combat
  produced another XP-confirmed `victory`, settling at HP 43/51 with no target
  or attackers. Exact-target death evidence was not observed. Walker again
  verified Arena and one-/two-room routes, then returned to `1/2147` where
  Corwyn was inspected. All 27 harness scenarios passed with zero policy
  violations (4 requests, 11,626 tokens, estimated $0.001897), within unchanged
  limits. Recovery was not due: HP remained above `restBelow=0.35`.
- The harness now reports recovery as not due rather than implying a rest took
  place when HP is above `restBelow`. If resting is due, the live recovery
  scenario must observe a `rest` command and authoritative HP reaching
  configured `restTo`; merely reaching the separate 60% combat-readiness gate
  no longer counts as recovery evidence. This reporting change is covered by
  deterministic tests and typecheck, but has not yet been exercised during a
  live low-health recovery.
- Focused NPC, activity-selector and live-harness tests passed 49/49; full
  `npm test` passed 7,016 tests with 2 skipped across 253 files. Typecheck,
  production build, secret scan, live-harness syntax check, and
  `git diff --check` passed. The build retains the existing renderer chunk-size
  warning.
- A bounded integrated objective was added to the live harness. Its successful
  run navigated `1/2147` -> `1/2150`, inspected the room, and completed the
  production objective plan with zero policy violations (4 provider requests,
  11,682 tokens, estimated cost $0.00193545). No eligible target was present,
  so combat and result-review steps were safely skipped; HP remained above
  `restBelow`, so no rest was due. The route summary now prints the observed
  before/after room keys instead of incorrectly reporting `unchanged`.
- The `recover_health` adapter now refuses when authoritative HP is unknown,
  reports a truthful no-op when HP is at or above the configured
  `restBelow`, and delegates due recovery through Recovery's own guard and
  queue path, after SessionManager confirms resting is safe. It no longer
  bypasses those gates with a direct emergency-priority `rest`. Recovery
  reports queued, regeneration-deferred, and not-started outcomes; rejected
  queue requests do not claim that a rest is in flight. The adapter recognizes
  Recovery's active state, in-flight request, or queued `rest` and avoids
  duplicates. Focused SessionManager tests cover unknown, at/above-threshold,
  below-threshold, unsafe-rest, rejected-queue, and duplicate-rest states.
  The integrated objective is also skipped when a prior encounter or recovery
  remains unresolved.
- An explicit recovery objective now completes successfully when the adapter
  reports `Recovery not due`; unchanged HP is not misclassified as delegated
  recovery failure in that case. A SessionManager autonomous-tick regression
  verifies that the plan completes with the truthful no-op result.
- Explicit, due AI recovery now goes through `SessionManager.mayRest()` and
  Recovery's own `requestRest` evaluation instead of directly queueing an
  emergency-priority command. Recovery reports queue acceptance, a
  pre-rest-regeneration defer, or no start; queue rejection does not claim a
  rest is in flight. Regressions cover unsafe resting and both deferred and
  rejected Recovery requests. These are deterministic results only; live
  low-health recovery remains unverified.
- Autonomous activity ranking now uses the session's configured
  `restBelow` threshold rather than an unrelated hard-coded 50% HP trigger.
  This prevents selecting a recovery action when Recovery itself would
  correctly report that resting is not due. Focused selector and SessionManager
  regressions cover both sides of the configured threshold.
- Latest bounded live attempt stopped at its login/placement gate: phase was
  `in-game`, but the authoritative room remained `unknown/unknown`; one
  attacker was reported and no provider/objective action ran. The run had zero
  provider requests and cannot verify the integrated scenario. Do not retry
  live until Kefka's actual placement and combat state are confirmed.
- Focused Recovery/SessionManager tests passed 8/8; objective/live-harness tests
  passed 36/36. Activity selection now uses the session-configured
  `restBelow` threshold for its recovery candidate in both the observation and
  autonomous-scheduler paths, avoiding false recovery selection above the
  threshold. The no-goal scheduler may select recovery again after a prior
  campaign cycle completes, but only when a changed observation makes it
  eligible; unchanged observations do not repeat it, and completion history
  stays unique. If repeated failures have blocked the no-goal scheduler, it may
  make one attempt at newly eligible recovery only after a changed observation;
  duplicate evidence leaves it blocked. The exception dispatches recovery
  specifically even if another candidate is listed first. A failed attempt
  leaves the scheduler blocked, while success re-arms the exception for a later
  failure cycle. Focused selector, scheduler, and SessionManager suites passed
  303/303; the blocked-scheduler recovery guards passed 289/289. The latest full
  suite passes 7,031 tests with 2 skipped across 253 files. Typecheck,
  production build, secret scan, harness syntax, and diff checks passed.
  Low-health recovery and the complete gameplay session are still unverified
  live.
  An earlier concurrent run hit two `SessionLog.test.ts` cleanup `ENOTEMPTY`
  errors; the file passed in isolation (14/14), and the final full run passed.
  Typecheck, production build, secret scan, JavaScript syntax, and
  `git diff --check` passed. The existing build chunk-size warning remains.
- The live combat harness now matches a parsed `mob-dies` name to its selected
  target through the shared `mobKey` normalizer. A leading article is
  normalized, but modifiers remain significant and missing/empty names are
  rejected. Deterministic tests cover these cases. This prevents a possible
  evidence-matching miss; it is not live evidence of exact-target death.
  The bounded live attempt reached in-game status but could not resolve the
  room (`unknown/unknown`); HP was 42/51, combat was not marked engaged, no
  target was set, and two attackers were reported. It used 0 provider requests,
  tokens, and cost, and no gameplay objective ran. This remains inconclusive;
  the full suite including this matcher passes 7,031 tests with 2 skipped
  across 253 files.
- One bounded follow-up used a single `SessionManager.askWhereIAm()` request
  only after the automatic entry probe failed. The call was refused because
  the session had already retired configured `rm` as unavailable. A local
  configuration audit found that Kefka's profile uses an inline server
  address; `resolveServer()` assigns inline addresses the global default
  locator (`rm`) rather than inheriting a saved server's setting. No saved
  server entry matches the profile endpoint, and no alternate location command
  is verified. The room remained unknown, HP was 36/51, and two attackers
  remained listed. The harness now reports the safe
  `locationRequestState` (`available`, `disabled`, or `unavailable`) alongside
  its one-request result. No movement, combat, recovery, or provider action was
  run. Focused location-helper and SessionManager tests passed 300/300. A
  parallel full-suite run reproduced the known two `SessionLog.test.ts`
  cleanup `ENOTEMPTY` failures; that file passed 14/14 in isolation, and the
  serial full run passed 7,035 tests with 2 skipped across 253 files.
  Typecheck, production build, secret scan, harness syntax, and diff checks
  passed.
- To unblock safely, first confirm the exact location command this endpoint
  supports. Inline profiles can now set their own locator in Settings, or
  Kefka can reference a saved server configured with that method. Changing an
  unrelated saved entry still has no effect on the inline profile. Do not try
  an alternative command or update the profile locator based only on a family
  guess.

## Remaining work

Repeated Arena arrivals, one-/two-room navigation, Corwyn inspection, and three
XP-confirmed live PvE victories are verified. Exact-target death has not been
observed. The latest encounter settled at 43/51 HP, above the configured
`restBelow=0.35`, so low-health resting remains unverified; the harness now
requires an observed rest command and HP reaching `restTo` before reporting it.
The integrated production objective has now completed live once, but that run
had no eligible hostile and recovery was not due; it does not demonstrate
combat or resting as part of that objective. The latest bounded attempt did
not pass the authoritative room-identity gate, so repeat the objective only
after the character's placement/combat state is confirmed. Exact-target death
and low-health resting remain unverified. The original Arena timeout's exact
server-side cause remains unknown because its capture is unavailable.

## Inline locator follow-up (2026-10-18)

Inline server profiles can now set their own `locate` method through profile
settings instead of silently inheriting the global default. Kefka's setting
was changed to `sys-status` from repository MajorMUD test evidence, but the
live endpoint has not confirmed that command.

The first room-only probe did not apply the resolved locator to
`SessionManager`; it therefore sent the constructor default `rm`. This is now
fixed in the harness by configuring the session with the profile's locator
before connecting. Probe-only setup also leaves global automation disabled.
The explicit Room-card locate request uses user priority, while Walker's
automatic locator requests continue to use probe priority; this avoids
temporarily enabling other automation merely to pass the queue's master
switch.

The latest bounded, provider-free probe connected and sent one `sys status`
request. The queue accepted it, but no fresh typed location evidence or
authoritative coordinates arrived within five seconds; `room=null/null`,
`serverFamily=null`, and `locationRequestState=available`. The latter reports
only that the configured word has not been marked unavailable. There were zero
provider requests/tokens/cost and zero policy violations; no gameplay
scenario ran. This is not a successful room resolution, and no other command
will be guessed. Resume live gameplay only after the endpoint's authoritative
locator has been confirmed.

The final serial suite passed 7,037 tests with 2 skipped across 253 files;
realm tests passed 18/18 and focused harness/SessionManager tests passed
301/301. Typecheck, production build, secret scan, harness syntax, and diff
checks passed; the existing renderer chunk-size warning remains. The probe is
the only new live evidence and does not verify gameplay.

The harness room-key formatter also no longer renders nullable coordinates
as the misleading literal `null/null`: it uses a room name when coordinates
are absent, and an empty value when neither is known. This was a diagnostic
display issue, not evidence of a different live room state. Its focused tests
pass 31/31.

A final serial full-suite attempt after that small diagnostic refinement
reported 7,037 passing and 2 skipped, with one unrelated
`ConfigStore.test.ts` file-watch timeout (`no change event`). The focused
watcher test passed on retry (1/1); the complete ConfigStore file had failed
once in isolation before the focused retry. The earlier serial full suite had
passed before the added room-key test. No ConfigStore code was changed.

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

## Provider-free Arena follow-up (2026-10-18)

- Kefka's configured `sys status` locator still produced no parsed coordinates,
  but the documented `pro` profile query produced authoritative `1/2150`
  coordinates. A user-priority `health` read produced fresh HP and combat
  evidence without enabling profile automation or contacting a provider.
- The Walker-only probe again refused movement because the tracker listed
  attackers. No direction command was issued; this is a hostile-state refusal,
  not a reproduced movement stall. The navigation probe's short-lived
  queue-enabled configuration now disables unrelated rest, party, combat,
  light, auto-get, and door-bashing behavior; only Walker owns the route.
- A separate provider-free PvE probe selected the uniquely identified
  authoritative hostile `fat kobold thief`, obtained exact-target approval,
  and delegated to production SessionManager/AutoCombat. One bounded attempt
  remained active through the 60-second window. A later attempt observed XP,
  but not exact target-death; the outcome ended with HP `22/51` and one
  attacker, so no victory is claimed.
- The combat monitor initially counted production `Routines`' exact `st`
  status-sheet probe as movement, prematurely stopping that later attempt.
  The PvE-only monitor now has a narrowly scoped authorization for this exact
  status command; ordinary directional commands remain movement-limited, and
  default harness behavior still counts `st` conservatively. Regression tests
  cover both paths.
- On the latest fresh probe, the remaining visible mob was realm-classified
  uncertain, so no second attack was issued. Health was `20/51`, with no
  active target/engagement and one listed attacker. Recovery was not attempted:
  the character was above the configured `restBelow=0.35` floor, and hostile
  attention remains. Reconnect/live recovery and safe escape are still
  unverified.
- All probes used zero provider requests, tokens, and cost. One earlier
  attempt was prematurely stopped by the `st` movement classification and
  recorded that monitor violation; no policy violation occurred. Live victory,
  low-health resting, and a complete multi-step live objective remain
  outstanding.
- Final validation for this checkpoint: the first full serial suite run had one
  unrelated `ConfigStore.test.ts` watcher timeout. That file passed 12/12 in
  isolation, and the subsequent full serial rerun passed 7,045 tests with 2
  skipped across 253 files. Typecheck, production build, realm tests, secret
  scan, script syntax, and diff checks passed. The build retains its existing
  renderer chunk-size warning.
- A fresh provider-free read-only probe after that checkpoint again resolved
  room `1/2150` through the documented `pro` query; configured `sys status`
  produced no parsed location. Health was `20/51`, with no active target or
  engagement and two listed attackers. The exact-target PvE gate saw two
  visible mobs, both with uncertain realm classification, and refused combat.
  No attack or movement was issued; provider usage and cost were zero and there
  were no monitor violations. This confirms the current blocker is
  authoritative target identity, not missing mobs or a lack of character
  location. Keep further live activity read-only until the target classification
  or hostile pressure changes.
- The configured GreaterMUD graph calls `1/2150` Newhaven, Arena and records
  exits north/up/down, but neither a local NPC nor a lair. Because both visible
  mobs have uncertain realm disposition and there is no room-specific spawn
  evidence, their nearest-spawn rows remain unresolved. This is a valid
  refusal, not evidence that the room lacks monsters or that the target gate is
  broken. A future run needs an unambiguous target or stronger authoritative
  row evidence; do not infer it from the mobs' display names.
- Gameplay-policy refinement: direct combat parser evidence that a named mob
  attacked Kefka may resolve uncertain disposition only if the same name
  uniquely matches one currently visible, realm-identified mob. Name collisions
  with players/unknown occupants, duplicate mobs, charmed mobs, wire-only
  mobs, and always-costly alignment targets remain ineligible. Activity
  selection, the central SessionManager action policy, and the bounded harness
  share this evidence; exact-target approval and AutoCombat ownership remain.
- The bounded provider-free follow-up selected `nasty giant rat` from the
  attacker list and executed exact-target approval through SessionManager.
  Combat was no longer active at settlement, but two attackers remained; HP
  was `22/51`, and neither XP nor target-death evidence was observed. The
  harness classified the encounter unresolved and reported no victory. It used
  zero provider requests/tokens/cost with zero policy violations. Do not repeat
  combat, move, or attempt recovery while hostile pressure remains. Investigate
  why combat ended without verified victory before another bounded encounter.
- Validation after the attacker-evidence refinement: focused target/activity/
  policy/session tests passed 314/314; the full serial suite passed 7,051 tests
  with 2 skipped across 253 files; realm tests passed 18/18. Typecheck,
  production build, secret scan, `node --check scripts/ai-live.mjs`, and
  `git diff --check` passed. The build reports the existing renderer
  chunk-size warning. No new live actions were sent while the two attackers
  remain.
- Post-push read-only observation: `pro` returned authoritative room `1/2150`;
  `sys status` remained unparsed. Health was `22/51`, with no active combat or
  target and two attackers. The probe sent no movement, attack, or recovery
  command and used zero provider requests/tokens/cost with zero violations.
  Hostile pressure therefore remains a live blocker.

## Bounded hostile-state follow-up (2026-10-18)

- A fresh read-only probe resolved GreaterMUD room `1/2150` through `pro`.
  Health was `18/51`; combat was inactive, and the one listed attacker,
  `large filthbug`, uniquely matched a visible, realm-backed hostile.
- One bounded provider-free exact-target attempt obtained approval and
  dispatched `a large filthbug` through SessionManager. The target was active
  at the end of the 60-second window; HP was `20/51`, with one attacker. No XP
  or `mob-dies` evidence was recorded, so the attempt did not establish a
  victory. Recovery was skipped because combat/attacker settlement was
  unresolved.
- A subsequent read-only probe reported `20/51` HP, no active target or
  engagement, and two listed attackers: `small kobold thief` and `large
  filthbug`. Both were visible realm-backed hostile mobs. This is not evidence
  that the encounter settled: the authoritative attacker list remains
  non-empty. No more combat, movement, or recovery was attempted.
- The read-only and PvE probes used zero provider requests/tokens/cost, no
  movement, and zero policy violations. This does not verify exact-target
  death, low-health recovery, safe escape, or an integrated gameplay objective.
- Focused approval, harness, AutoCombat, and SessionManager tests passed
  558/558. The full serial suite passed 7,057 tests with 2 skipped across 253
  files; realm tests passed 18/18. Typecheck, production build, secret scan,
  script syntax, and `git diff --check` passed. The existing renderer
  chunk-size warning remains.
- A final zero-movement check after validation still found HP `22/51`, no
  active engagement or target, and the same two hostiles in the authoritative
  attacker list. Room `1/2150` was confirmed by `pro`; only read-only location,
  status, and health queries were sent. The unresolved pressure remains the
  next live blocker.
- The combat parser retains attackers after `*Combat Off*` because that event
  does not prove they died or left; the current room listing confirms both are
  still present. Do not treat this state as settled. Harness evidence now
  records bounded parsed player hit/miss target and damage, hostile blows,
  combat transitions, refusal types, XP, and death identity without raw text.
  The focused LiveHarness suite passes 42/42, typecheck/build/secret scan pass,
  and no further live combat was attempted.
- Post-build read-only recheck still finds both hostiles at room `1/2150`,
  HP `22/51`, no active target/engagement, and zero provider usage or policy
  violations. The bounded live encounter must remain paused pending a fresh
  attacker-free state.

## Live combat blocker investigation (2026-10-18)

- The claimed inability to establish a valid combat engagement is not borne
  out by the latest exact-target attempt. Before engaging, `large filthbug`
  uniquely matched a current visible hybrid realm mob; its disposition was
  hostile, classification certain, uncharmed, and never-costly, and its name
  matched the authoritative attacker list. Exact-target approval completed,
  the trace recorded `a large filthbug`, and the tracker reported that exact
  target with combat active at the 60-second bound. Identity, eligibility,
  selection, approval, dispatch, and engagement establishment therefore
  succeeded in this attempt.
- That attempt had no XP or exact death evidence and remained `active`; it is
  not a failed engagement or a terminal result. It predated the parsed hit/miss
  telemetry in the live harness, so there is no evidence whether subsequent
  server responses were hits, misses, damage, or refusals. No explanation for
  the missing terminal outcome is yet demonstrated.
- Current read-only evidence after `cb10ff1`: `pro` resolves room `1/2150`;
  HP `22/51`; no current target or engagement; attackers are
  `small kobold thief` and `large filthbug`. Both are present as distinct,
  certain hybrid realm mobs, hostile, uncharmed, and never-costly. The probe
  issued only `sys status`, `pro`, and `health`, with zero provider usage,
  movement, or violations.
- The effective Kefka profile enables general automation but has retreat
  disabled, outnumbered retreat threshold 0, flee-goto disabled/no
  destination, and no safe-haven room. Rest is configured below 35% toward
  70%; current health is ~43%, and Recovery refuses while attackers remain.
  No configured safe escape/recovery path applies to the current state.
- No production defect has been localized in the engagement chain, so no
  speculative combat change was made. The active problem is safe diagnosis
  after engagement: the old run lacks hit/miss telemetry and the current room
  still contains two attackers. `*Combat Off*` alone remains insufficient to
  clear them. A repeat of the bounded live harness would disconnect on cleanup
  while the unresolved attackers remain, so it is not an appropriate
  experiment now.
- Focused SessionManager, AutoCombat, and LiveHarness suites passed 550/550.
  These demonstrate the mocked/session execution path, not live damage or
  victory. Next experiment: wait for an attacker-free authoritative state or
  arrange a separate disposable/controlled encounter with supervised timeout
  handling that can preserve the session; then use the new capped telemetry to
  distinguish attack hit/miss/damage/refusal and verify a terminal outcome.
