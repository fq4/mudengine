# Phase 5 Progress

## Current state

Phase 5 session integration is in progress on `development`. Phase 4 is
implemented through `6a95e22`; the bounded kefka arena run reaches Newhaven
Arena and delegates combat, recovery decisions, inventory inspection, and
equipment evaluation to production systems.

## Verified architecture

`Agent` and `ObjectivePlan` make strategic decisions and enforce ordered
prerequisites. `SessionManager` is the adapter boundary. `CharacterTracker`
owns authoritative state; `WorldGraph` and `Walker` own route planning and
movement; `AutoCombat`, `Recovery`, `EquipmentManager`, `Routines`, and
`CommandQueue` execute repetitive gameplay. The AI never writes directly to
the socket.

Memory, approvals, aggregate budgets, manual-input priority, emergency stop,
identity cleanup, and objective-scoped action policy remain active. The live
harness is bounded and redacts credentials.

## Phase 5 implementation

`src/main/ai/ActivitySelector.ts` now provides a deterministic,
policy-filtered candidate interface. It ranks recovery ahead of risky work,
requires an explicit goal for combat, and only proposes a classified,
non-charmed, non-uncertain mob. The selector returns both the chosen candidate
and the considered candidates so the agent can explain a decision without
inventing a command. Execution remains delegated to `SessionManager` and the
production automation owners.

`ActivitySelector.test.ts` covers recovery priority, safe combat target
selection, and refusal when goal or target evidence is insufficient.

`SessionManager.aiObservation()` now evaluates the selector against the current
`CharacterTracker` snapshot on every provider decision and exposes the ranked
candidates beside the existing action policies. This keeps selection fresh and
leaves execution, permissions, approvals, budgets, and completion feedback in
the established agent/session adapters.

## Phase 5 findings

- The selector is available to the provider as fresh, ranked context, but the
  provider still owns the strategic choice under the explicit player goal. A
  future session scheduler can use the same candidates for long-lived goals
  without creating a second execution engine.
- Replanning exists for materially changed observations and preserves completed
  prerequisites, but long-lived objective queues and durable success criteria
  remain limited.
- Combat completion is deliberately conservative. `ended` means combat is no
  longer active; only authoritative `user-gain-experience` evidence can be
  reported as `victory`. The latest live encounter ended without that evidence.
- The bounded live script makes deterministic arena/preflight choices to keep
  verification reproducible. It is evidence of integration and safety, not a
  demonstration of unrestricted autonomous activity selection.

## Validation baseline

- Full suite: 6,931 passed, 2 skipped.
- Node and renderer typechecks: passed.
- Production build: passed; existing large renderer chunk warning remains.
- Secret scan: passed.
- Bounded kefka run: passed with zero harness violations.
- Repository-wide lint still reports the pre-existing Prettier baseline.

## Next work, in order

1. Define a deterministic, policy-filtered activity candidate interface and
   rank observation, recovery, navigation, and other safe activities without
   waking the provider for unchanged state.
2. Add offline integration tests proving candidate selection, interruption,
   replanning, and completion signals through production adapters.
3. Add a bounded live objective that asks the agent to choose among approved
   activities; keep combat conditional on fresh authoritative health, target,
   escape, and budget checks.
4. Investigate the server transcript/state needed for authoritative victory
   evidence; never infer victory from combat ending.

Named budget profiles are now defined in `src/main/ai/Budget.ts`: `smoke`,
`exploration`, `adventure`, and `extended`. Each separates provider request,
token, and cost ceilings from gameplay command, movement, and runtime limits.
Profiles are opt-in data; no session automatically raises its configured
limits. Selection and interface exposure still need to be wired through the
session settings path before extended live sessions are allowed.

`AutonomousScheduler` now provides bounded activity transitions: it selects an
uncompleted candidate, records completion, blocks after repeated failures,
ignores unchanged observations, and stops on interruption. It is covered by
deterministic transition tests. It is now wired into `SessionManager` for the
no-explicit-goal mode: fresh policy-filtered candidates are selected, delegated
through the existing AI action gateway, and monitored through the existing
Walker/combat/recovery/equipment lifecycle owners. Explicit goals continue to
use the provider/planner path. Safe observation is the default autonomous
candidate; the scheduler stops after exhausting candidates or after bounded
failures and is interrupted by stop, emergency stop, or a new explicit goal.

The session integration has focused offline coverage through the existing
SessionManager suite and activity-selector/scheduler tests. Provider-driven
long-lived selection for explicit objectives and a supervised live observation
of scheduler-selected activity remain the next validation steps.

## Continuation prompt

Read `docs/CODEX_HANDOFF.md`, `docs/PHASE4_PROGRESS.md`, and this file. Start
with the policy-filtered activity candidate interface and deterministic tests.
Do not weaken safety gates, duplicate production automation, expose secrets,
or expand live combat scope without fresh authoritative state.
