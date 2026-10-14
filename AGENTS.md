# Agent instructions

MudEngine follows a risk-proportionate autonomy principle. Kefka is a
disposable MUD test character: authorized live experimentation may include
dangerous exploration, ordinary PvE combat, character death, failed
objectives, recovery, and loss of ordinary in-game items. Do not turn game
character preservation into real-world safety policy. Gameplay risk should be
configurable and reviewable rather than blocked by unnecessarily rigid gates.

Real-world protections remain strict. Never expose or commit credentials,
API keys, private information, or raw login traffic. Preserve provider
spending ceilings, TLS validation, filesystem integrity, server configuration,
Git safety, external-service boundaries, emergency stop, manual override,
loop prevention, and the centralized action authorization architecture.

AI may experiment with Kefka's combat, health, recovery, navigation, and death
mechanics when the user has authorized it. It must still identify targets from
authoritative game state and must never attack real players, perform PvP,
execute destructive administrative commands, change accounts without
authorization, or conduct real-money transactions. Unknown commands and
high-risk actions continue through the existing approval and policy gateway.

Reuse MudEngine's deterministic systems: `SessionManager` owns the session
agent boundary, `CommandQueue` is the execution funnel, and Walker,
AutoCombat, Recovery, EquipmentManager, and related automation own their
loops. Keep AI provider, budgets, permissions, approvals, memory, and UI
session-scoped. Read `docs/CODEX_HANDOFF.md`, `docs/PHASE5_PROGRESS.md`,
`docs/ai-technical-spec.md`, and `docs/ai-capability-inventory.md` before
changing the AI architecture.

When changing gameplay risk policy, preserve target identity, PvP prevention,
credential protections, spending ceilings, emergency stop, manual priority,
and failure/repetition limits. Add focused tests, run typecheck/build and the
relevant suites, update the handoff/progress docs, and push only verified
changes to `development` when authorized.

## Interruption-safe continuation

Before substantive work, read `docs/CODEX_HANDOFF.md` and
`docs/PHASE5_PROGRESS.md`, verify `git status`, and inspect the latest pushed
commit. Keep changes recoverable and commit documentation at meaningful
checkpoints. Provider use is opt-in and expensive: prefer deterministic tests,
fixtures, and mocked provider responses. Do not raise provider request, token,
or cost limits or start an extended live session without explicit user
approval. The only authorized live profile is `kefka`, using the bounded
harness command documented in the handoff.

If interrupted, switch to `development`, pull with `--ff-only`, read the
handoff, run focused deterministic suites first, and continue from the latest
pushed commit. Never infer credentials or environment values from conversation.
