# MudEngine Codex Handoff

## Current state

- Branch: `development`
- Latest commit: `2f1b801` (`Cover safe AI command queue execution`)
- Working tree: clean at handoff
- Repository: `https://github.com/fq4/mudengine.git`
- Phase 2 development is not started.

## Project and architecture

MudEngine is a cross-platform Electron/Vite client, terminal, parser, world model, and deterministic automation engine for MajorMUD, GreaterMUD, and Paradigm-style MUDs. The original client works without AI.

- `SessionHost` owns session slots; each `SessionManager` owns one connection/character context.
- `SessionManager` owns `CharacterTracker`, `CommandQueue`, `Walker`, world graph, combat/recovery/equipment automation, AI agent, provider, approvals, budgets, and memory integration.
- `src/shared/` contains main/renderer contracts and domain models.
- `src/main/automation/` contains existing deterministic systems. AI delegates to them and never writes directly to the socket.
- `src/main/ai/` contains the agent, provider, budgets, permissions, approvals, memory, observation/event helpers, social gate, navigation helpers, and live monitor.
- `src/renderer/src/components/AiPanel.tsx` is the per-session AI panel. IPC is session-addressed through `src/shared/ipc.ts`, `src/preload/index.ts`, and the web bridge.
- `scripts/ai-live.mjs` is the opt-in real-server harness.

## Implemented AI capabilities

- One provider-neutral agent per connected session and active character.
- OpenRouter integration with structured response validation, diagnostics, cancellation, bounded retry, usage, and estimated cost tracking.
- One high-level validated action at a time, delegated to existing systems.
- Exact-destination and bounded multi-room navigation through `WorldGraph`/`Walker`, with verified arrival and lifecycle states.
- Objective completion guards, meaningful-event gating, compact observations, and objective-scoped capability advertisement.
- Session approvals with expiry, state invalidation, history, rejection/expiration feedback, emergency stop, layered permissions, and hard/aggregate budgets.
- Scoped persistent memory with provenance, confidence, verification, editing, and relevance retrieval.
- Manual-input priority and reconnect/realm-leave identity cleanup.
- Guarded adapters for combat, recovery, equipment, communication, and general-command fallback.
- General-command safeguards: unknown commands require approval; known safe commands queue directly; empty, oversized, multiline, NUL-containing, and prohibited commands are refused.

## Safety boundaries

Manual input always wins. AI must not bypass `CommandQueue`, permissions, approvals, budgets, or emergency stop. Live `kefka` testing is restricted to observation and safe navigation.

Do not enable unattended live testing for combat, PvP, social interaction, equipment changes, item use, spending, destructive/irreversible actions, private-data handling, or unclassified commands. Never disable TLS verification or commit credentials.

## Verification and limitations

- AI suite: 83 tests passed.
- SessionManager suite: 248 tests passed.
- Node/web typechecks passed.
- Production Electron build passed; the existing large-renderer-chunk warning remains.
- Bounded `kefka` harness passed all eight scenarios with zero violations: inspection, one/two-room navigation, invalid destination, unknown-command approval, manual interruption, budget enforcement, and emergency stop.
- Full application coverage previously passed 6,888 tests with one concurrency-only migration temporary-home race; that test passes in isolation. Realm coverage passed 18/18.
- `npm run lint` currently fails the repository-wide pre-existing Prettier baseline. Do not perform a broad formatter rewrite as handoff work.

Read `docs/ai-live-test.md` for the chronology, `docs/ai-capability-inventory.md` for capability mapping, and `docs/ai-technical-spec.md` for architecture and decisions.

## Outstanding work

1. Add broader integration coverage without expanding unsafe live scope.
2. Define an explicit action-to-policy mapping before hiding named capabilities by policy.
3. Improve general-command completion feedback beyond queue acceptance while preserving CommandQueue ownership.
4. Investigate the concurrent migration-test temporary-home race.
5. Do not begin Phase 2 feature development until this handoff is accepted.

## Setup on another computer

Requirements: Node.js 20+, Git, npm, network access for dependencies, and normal Electron platform prerequisites.

```powershell
git clone https://github.com/fq4/mudengine.git
cd mudengine
git switch development
git pull --ff-only origin development
npm ci
```

For an existing checkout:

```powershell
cd path\to\MudEngine
git switch development
git pull --ff-only origin development
npm ci
```

## Configuration and secrets

Never commit secret values. Copy `.env.example` to an untracked `.env` only for the live AI harness:

```powershell
Copy-Item .env.example .env
notepad .env
```

Names only; never document values:

- `OPENROUTER_API_KEY` - local OpenRouter credential.
- `MUDENGINE_AI_MODEL` - optional model override.

The `kefka` profile and connection credentials are user-scoped local settings. Recreate them through the normal profile/settings UI if absent. Corporate TLS/proxy settings must use the OS trust store or approved CA configuration.

Check for secrets before committing:

```powershell
npm run check:secrets
```

## Build, run, and test

```powershell
npm run typecheck
npm run build
npm test
npm run test:realm
npm run test:full
npm run dev
```

`npm run dev` builds main/preload, starts Vite, and launches Electron. The AI panel is optional and disabled until configured and started.

`npm run lint` is available but currently reports the documented repository-wide Prettier baseline.

## Safe live harness

```powershell
Copy-Item .env.example .env
# Set OPENROUTER_API_KEY locally in .env
npm run test:ai-live -- --live --profile kefka
```

The harness withholds credentials from output and enforces bounded runtime, requests, tokens, cost, movement, and command safety. It performs only inspection, safe navigation, approval-path, interruption, budget, and emergency-stop scenarios. Never run it unattended or expand its allowed commands without explicit authorization.

## Next Codex session instruction

After cloning, tell Codex:

> Read `docs/CODEX_HANDOFF.md`, `docs/ai-technical-spec.md`, `docs/ai-capability-inventory.md`, and `docs/ai-live-test.md`. Do not start Phase 2. Verify the branch, working tree, latest commit, tests, and secret state first. Preserve all live-test safety boundaries and ask before expanding scope.
