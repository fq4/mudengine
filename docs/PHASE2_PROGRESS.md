# Phase 2 progress

## Current checkpoint

The canonical action policy is implemented in `src/main/ai/ActionPolicy.ts`.
Every provider action now declares its risk, default authorization, argument
validation, completion mode, failure behavior, and audit event. `SessionManager`
validates provider and UI actions through this contract before dispatching to
Walker, Recovery, EquipmentManager, AutoCombat, the social gate, or
CommandQueue. Existing permission, approval, emergency-stop, and manual-input
boundaries remain authoritative.

Supported action families are observation (`inspect_character`, `inspect_room`,
`inspect_inventory`, `inspect_map`, `inspect_npc`, `inspect_combat_result`), bounded navigation,
non-consuming recovery, NPC engagement, equipment delegation, social messaging,
verified/general command fallback, and wait. NPC engagement, equipment, social,
and unknown-command actions remain approval-gated or otherwise restricted by
their existing safety adapters.

## Evidence

- Action-policy and observation regressions: 9 tests passed, including safe NPC
  inspection and player-target rejection.
- Node and renderer typechecks passed after the policy integration.
- Provider contract regressions: 14 OpenRouter tests passed after adding the
  `inspect_npc` schema and safety guidance.
- Production build and `check:secrets` passed; the build retains the existing
  renderer chunk-size warning only.
- The bounded live `kefka` harness passed all eight scenarios with zero safety
  violations: inspection, one-room navigation, exact two-room navigation,
  invalid destination refusal, unknown-command approval, manual interruption,
  budget enforcement, and emergency stop.
- Live usage: four provider requests for navigation, under the harness token
  and cost limits. No combat, PvP, social, equipment, item, or spending action
  was issued.

## Local live configuration

The existing user-scoped `rush` profile was internally named `kefka`. A local
`profiles/kefka/profile.yaml` alias was created for the harness. Automatic
combat is disabled in that harness alias so safe navigation cannot start a
fight; the original `rush` profile is unchanged. Credentials and the provider
key remain outside the repository.

## Remaining Phase 2 work

- Add deterministic coverage for each policy adapter's completion and failure
  lifecycle, including non-consuming recovery and harmless NPC inspection.
- Improve multi-step objective decomposition and completion evidence for
  inspection, recovery, and interaction objectives.
- Add mocked reconnect, interrupted-objective, denied-approval, and invalid
  command scenarios to the bounded harness tests.
- The current approval store is command-payload based; extending approval to
  high-risk structured actions requires a dedicated action payload model before
  those actions can be approval-gated through the agent path.
- Repeat permitted live checks only after each adapter is covered locally.
