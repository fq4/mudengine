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

## Verification

- NPC discovery and action-policy regressions pass.
- Connected SessionManager coverage passes (248 tests), including the guarded
  engagement adapter.
- Node and renderer typechecks pass.
- No live combat has been attempted. The `kefka` harness remains restricted to
  observation and safe navigation until a live target, health state, escape
  route, and hard combat limits can be established from authoritative data.

## Remaining Phase 4 work

- Add explicit threat and health eligibility evaluation around AutoCombat's
  existing deterministic survival decisions.
- Add bounded ordinary inventory inspection/use and equipment evaluation behind
  canonical policies, with approvals for costly or irreversible actions.
- Extend objective planning and persistent memory for combat, recovery, and
  inventory outcomes.
- Add deterministic fixtures for combat retreat, target loss, reconnect, and
  multi-capability objectives before any live PvE scenario.
