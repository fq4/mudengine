# Phase 3 progress

## First checkpoint

`src/main/ai/ObjectivePlan.ts` now decomposes bounded objectives into ordered,
capability-level steps. Each step tracks pending, active, completed, or blocked
state; failed steps do not mark an objective complete. `AutonomousAgent` exposes
the plan in `AiState`, advances it after deterministic execution, and requires
all planned steps to complete before bounded objective completion.

This preserves the one-action provider contract while enabling multi-step
reassessment. Existing Walker, policy validation, approvals, budgets, and
emergency-stop paths remain authoritative.

## Evidence

- Planner and agent regressions: 30 tests passed.
- Node and renderer typechecks passed.
- Phase 2 live evidence remains the baseline: bounded `kefka` observation,
  inventory, navigation, approval, interruption, budget, and emergency-stop
  checks passed with zero violations.

## Current checkpoint

The planner now enforces ordered prerequisites: a provider cannot complete a
later pending step while an earlier step is active, and a failed prerequisite
does not activate subsequent work. Synchronous observation steps trigger one
bounded reassessment even when the compact wire observation is unchanged. The
AI panel renders each planned step and its pending, active, completed, or
blocked state.

Deterministic regressions cover NPC selection, passive recovery classification,
ordered planning, same-observation reassessment, interruption, budgets, and
emergency stop. The live harness budget is explicitly aligned to its eight
request ceiling.

The final bounded `kefka` run passed all ten approved scenarios with zero
violations: multi-step character/room inspection, inventory inspection, safe
one-room and exact two-room navigation, conditional NPC inspection, invalid
destination refusal, unknown-command approval, manual interruption, budget
enforcement, and emergency stop. No combat, PvP, purchases, spending,
consumption, equipment changes, or destructive commands were issued. The trace
masked login credentials.

Validation after this checkpoint: 250 test files passed (6,920 tests passed,
2 skipped), realm tests passed (18 tests), both TypeScript typechecks passed,
the production build passed, and `check:secrets` found no configured password
in generated or user-scoped client files. The repository-wide `npm run lint`
command still reports 612 pre-existing Prettier failures in untouched files;
all files changed by this checkpoint pass Prettier's check.

## Next work

- Add deterministic fixtures for NPC discovery/search and non-destructive NPC
  interaction without requiring a visible live NPC.
- Add recovery fixtures distinguishing passive rest from resource-consuming
  actions and feed their outcomes into plan progress.
- Add bounded return-to-start live coverage using only safe navigation and
  observation.
