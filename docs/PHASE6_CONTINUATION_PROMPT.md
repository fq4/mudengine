# Copilot continuation prompt (paste as-is)

You are continuing development of MudEngine (repo fq4/mudengine, branch `development`), an Electron/Vite MUD client with deterministic automation and an optional AI player. You have no prior conversation context; everything needed is in the repo.

First, before changing anything:
1. `git switch development; git pull --ff-only origin development; git status; git log -5 --oneline`
2. Read `AGENTS.md`, `docs/CODEX_HANDOFF.md`, `docs/PHASE5_PROGRESS.md`, `docs/PHASE6_PROGRESS.md`, `docs/ai-technical-spec.md`, `docs/ai-capability-inventory.md`.
3. `npm ci`, then verify: `npm run typecheck; npm test; npm run build; npm run check:secrets`. All should pass (known: `npm run lint` fails a pre-existing Prettier baseline; do not mass-format). The secret scan needs the local user-scoped profile data; if it reports missing config, that is an environment note, not a code failure.

Goal: Phase 6 — make the autonomous player explore, learn the world, pick useful activities, recover from setbacks and make progress without constant instructions. Scheduler journal persistence and tracker-measured progress are implemented. Continue with the current "Next recommended task" in `docs/PHASE6_PROGRESS.md`: add a deterministic multi-room NPC-search fixture that verifies Walker-confirmed frontier arrivals, room inspection, target discovery, and tracker-verified objective completion. Keep tests offline and provider-free. Extend the activity candidate set only with activities delegated to existing production owners (Walker, AutoCombat, Recovery, EquipmentManager) and policy-gated.

Rules (from AGENTS.md):
- Reuse existing systems. `SessionManager` is the AI boundary; `CommandQueue` is the execution funnel. Do not create a parallel execution engine or write to the socket directly.
- Kefka is a disposable test character: ordinary PvE risk, death and item loss are acceptable; do not make the AI needlessly timid. Real-world protections stay strict: no PvP, no attacking players, no credentials/keys/raw logins in code, logs or commits, keep TLS validation, emergency stop, manual override, loop/failure limits, provider spending ceilings, and the approval/policy gateway.
- Do NOT run paid OpenRouter / live provider tests or raise request/token/cost limits without explicit user approval. Use deterministic tests and fixtures only.
- Never commit `.env`, `.npm-cache/`, `out/`, `dist/`, captures or machine paths. `OPENROUTER_API_KEY` lives only in an untracked `.env` (copy `.env.example`).
- Edit TypeScript with editor tools; PowerShell double-quoted strings corrupt `${...}` template literals.

Workflow: small changes with focused tests; run the relevant vitest files, then `npm run typecheck`, `npm test`, `npm run build`, `npm run check:secrets`; update `docs/PHASE6_PROGRESS.md` and `docs/CODEX_HANDOFF.md`; commit with clear messages and push to `development`; confirm `git status` is clean. Continue autonomously through routine decisions; stop only for genuine blockers.
