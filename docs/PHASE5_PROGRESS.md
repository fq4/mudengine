# Phase 5 Progress

## Current state

Phase 5 handoff preparation is in progress on `development`. Phase 4 is
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

## Phase 5 findings

- The selector is now available as a pure decision component. It is not yet
  wired as the default autonomous objective source for a long-lived session;
  that integration must preserve explicit player goals and approval policy.
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

## Continuation prompt

Read `docs/CODEX_HANDOFF.md`, `docs/PHASE4_PROGRESS.md`, and this file. Start
with the policy-filtered activity candidate interface and deterministic tests.
Do not weaken safety gates, duplicate production automation, expose secrets,
or expand live combat scope without fresh authoritative state.
