# Phase 4 progress

## Current checkpoint

Phase 4 begins from the verified Phase 3 baseline at commit `7611fe9`.

The first capability expansion adds a conservative PvE target gate in
`src/main/ai/NpcDiscovery.ts`. AI engagement now requires authoritative room
evidence that the selected occupant is a realm-known mob with hostile
disposition, is not charmed, and does not always cost alignment. Players,
unknown occupants, ordinary NPC residents, passive or conditional creatures,
charmed mobs, and always-costly targets are refused before `AutoCombat` is
given a target. AutoCombat remains the sole combat executor and continues to
own health, retreat, pacing, and recovery behavior.

Combat preflight also requires authoritative player HP and HP maximum at or
above 60% before delegation. Unknown or low health refuses the action rather
than assuming the character is ready; AutoCombat remains responsible for
ongoing retreat and recovery decisions after a verified start.

Inventory work now has a dedicated `use_item` action. It accepts only an exact
name present in the authoritative carried-item listing and routes the command
through `CommandQueue`; the canonical policy keeps it approval-gated until a
specific ordinary item is verified safe for supervised live use. Unknown item
names never reach the wire.

Inventory preflight now also requires realm identity, rejects equipped or
depleted items, and refuses protected items. This keeps organization and use
decisions grounded in the authoritative carried listing rather than names
alone.

Combat objectives now decompose into room discovery, NPC inspection, verified
PvE engagement, combat-result assessment, and recovery steps. The planner
cannot mark a combat objective complete from inspection alone.

Blocked steps now support a bounded replan: a materially new authoritative
observation reactivates the failed step while preserving completed prerequisites
and failure memory. Repeated failures remain subject to the agent's existing
loop suppression and budget limits.

Combat-result inspection now reports `active`, `ended`, `unsafe`, or `unknown`
from authoritative engagement and vitals. Low health and missing facts are
never presented as a successful combat result, so the planner can choose
recovery or stop safely.

## Verification

- NPC discovery and action-policy regressions pass.
- Connected SessionManager coverage passes (248 tests), including the guarded
  engagement adapter.
- AI policy, planner, observation, typecheck, production build, and secret
  scan pass after adding the inventory action contract.
- Planner regressions cover the complete discovery-to-combat-to-recovery
  sequence without requiring a live server.
- Agent regressions cover reactivation after a changed observation and prevent
  retries on an unchanged state.
- Combat-outcome regressions cover active, ended, unsafe, and unknown states.
- Inventory-safety regressions cover exact matching, identity, equipped,
  depleted, and protected-item refusals.
- Node and renderer typechecks pass.
- No live combat has been attempted. The `kefka` harness remains restricted to
  observation and safe navigation until a live target, health state, escape
  route, and hard combat limits can be established from authoritative data.
- The harness includes a live combat-safety refusal check for an unverified
  target; it must refuse before AutoCombat or the wire is reached.

## Remaining Phase 4 work

- Add explicit threat and health eligibility evaluation around AutoCombat's
  existing deterministic survival decisions.
- Add bounded ordinary inventory inspection/use and equipment evaluation behind
  canonical policies, with approvals for costly or irreversible actions.
- Extend objective planning and persistent memory for combat, recovery, and
  inventory outcomes.
- Add deterministic fixtures for combat retreat, target loss, reconnect, and
  multi-capability objectives before any live PvE scenario.
