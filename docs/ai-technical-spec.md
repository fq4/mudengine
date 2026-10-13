# AI-Enhanced MudEngine: Technical Specification for Review

Status: proposal — research complete, implementation not started

## 1. Goal and constraints

Add an optional, provider-neutral AI decision layer that operates one agent per connected MudEngine session and active character. The agent selects high-level actions; existing MudEngine systems execute movement, combat, recovery, equipment, communication, and queue pacing.

The original client remains fully functional without an API key, network access, or enabled agent. Manual input always has priority. The AI must not become a second command engine, bypass validation, or mix state between sessions.

The initial provider is OpenRouter. Provider-specific transport stays behind a minimal interface so future cloud or local providers do not affect gameplay, permissions, memory, or UI code.

## 2. Repository findings

### Session and identity boundaries

- `SessionHost` owns a `Map<SessionId, SessionSlot>` and constructs one `SessionManager` per session.
- `SessionManager` owns the connection state, `CharacterTracker`, `CommandQueue`, `Walker`, combat/recovery/equipment automation, world graph, player registry, and parser/replay flow.
- `ProfileStore` loads one character directory per profile and resolves a sparse profile overlay over live global configuration. Profiles identify server, character, realm database, and client preferences.
- A character reset/identity change is already represented by `ResetNotice`; this is the boundary at which an agent must suspend, invalidate pending work, and revalidate.

### Authoritative gameplay data

- `CharacterTracker` folds classified `Block` values into authoritative character, room, combat, inventory, presence, and session state.
- `BlockType` and `BlockDomain` distinguish session, status, room, combat, conversation, movement, items, presence, and failures.
- Conversation blocks include gossip, broadcast, telepath, directed, yell, local speech, auction, gangpath, and action. Their groups carry the speaker/target/message when available.
- `WorldGraph`, `WorldMemory`, `PlayerBook`, quest stores, spell/item data, and realm resources already hold durable domain knowledge. AI memory must reference and supplement these stores rather than duplicate them.
- Parsed facts are preferable to raw transcript text. Unknown and stale values must remain unknown rather than being converted into guesses.

### Execution and automation

- `CommandQueue` is the central automation arbiter. It has priority bands, pacing, acknowledgement windows, duplicate/coalescing behavior, typing holds, unavailable-command checks, and resend handling.
- User commands use the `user` priority; automation uses lower bands. The AI must enter through audited queue intents and must never write directly to the socket.
- `Walker` executes validated routes; combat automation manages extended NPC fights; recovery, equipment, supplies, quests, loops, and other modules expose deterministic `onCharacter`/progress behavior.
- The AI action executor must distinguish requested, accepted, executing, completed, failed, timed out, interrupted, and canceled. Queue acceptance is not gameplay completion.

### Persistence and UI

- Configuration is YAML-backed through `ConfigStore`, `ProfileStore`, `ServerStore`, and settings editors. Profile files are sparse overlays and are watched/reloaded.
- Session logs, captures, backscroll, talk history, world memory, player books, and realm stores already have separate ownership and retention semantics.
- IPC contracts are centralized in `shared/ipc.ts`, with Electron preload and web bridges implementing the same API.
- The renderer uses card/panel layout, pins, drag/resize hooks, and `FloatLayer`; the AI panel should use those mechanisms rather than create a separate window system.

## 3. Proposed architecture

Add a modular `main/ai` subsystem with these boundaries:

1. `AiSessionAgent`: one instance per `SessionManager`; owns objective, bounded plan, state machine, wake/sleep logic, current action, session memory, budgets, and approval state.
2. `AiObservationBuilder`: creates a compact typed snapshot from tracker/world/walker/automation state. It includes only relevant fresh facts and explicitly marks unknown values.
3. `AiEventRouter`: classifies parser blocks, automation progress, queue outcomes, manual input, identity changes, connection changes, and timers into meaningful wake events. Routine movement/combat/status updates remain local.
4. `AiCapabilityRegistry`: named capabilities with schemas, risk metadata, preconditions, execution adapters, and completion observers.
5. `AiCommandGateway`: fallback general-command path. It resolves aliases and evidence, classifies risk, applies permissions, validates arguments, creates approvals when needed, and submits only through `CommandQueue`.
6. `AiPermissionResolver`: resolves global defaults, server policy, and character/profile overrides. Non-overridable prohibitions cannot be weakened. Temporary approvals are session-only and narrower than the rule that created them.
7. `AiMemoryStore`: structured local storage isolated by server and character, with provenance, confidence, timestamps, validity, category, retention, and user controls.
8. `AiProvider`: provider-neutral `decide(context, signal)` plus usage/capability/error reporting. OpenRouter is the first adapter.
9. `AiBudgetController`: independent request/token/cost enforcement for per-agent and aggregate limits.
10. `AiAuditLog`: significant action, approval, policy, budget, and failure history with redaction.

The exact module names may change during implementation, but these responsibilities should remain separate.

## 4. Decision and execution model

The model returns one immediate validated action and may return a bounded high-level plan. It never returns a raw batch of commands for execution.

Named capabilities are preferred: navigation delegates to `Walker`, combat to existing combat automation, recovery to recovery systems, equipment to equipment management, and communication to audited channel adapters. One AI decision may launch a long deterministic operation.

The lifecycle is:

`meaningful event → compact observation → budget check → provider decision → schema validation → permission/risk check → approval or execution → deterministic progress → outcome → selective replan`

The agent sleeps while delegated work is active and wakes on completion, failure, interruption, material environmental change, relevant incoming communication, approval result, budget state change, or explicit user instruction. It does not poll by repeatedly calling the provider.

## 5. Permission and approval policy

Default classifications:

- Known safe: autonomous.
- Known routine: autonomous within configured limits.
- Known high-risk: Ask First.
- Unknown or ambiguous: Ask First, labeled Unclassified.
- Explicitly prohibited: reject without execution.

The same gateway applies to named capabilities and general commands. Command evidence comes from existing command definitions, aliases, macros, help output, parser knowledge, verified outcomes, and server-specific records. One successful execution does not automatically grant autonomous permission.

Policy resolution is global defaults → server policy → character/profile override. More specific rules cannot silently weaken a non-overridable prohibition. Temporary grants are session-only by default and may be scoped by action, command, target, arguments, quantity, cost, objective, frequency, and expiration.

Ask First records the exact capability/command and arguments, explanation, risk, target, known facts versus predictions, expiration, and state fingerprint. Default provisional expirations are 5 minutes for low-risk routine actions, 30–60 seconds for high-risk actions, 2 minutes for unknown commands, and 30 seconds or less for time-sensitive combat/target actions. Material state changes invalidate approval immediately; expired approvals never execute or silently renew.

The panel provides Approve, Reject, temporary narrow authorization, Remember this policy, revoke, and approval history controls. Rejection/expiration feeds back to the agent without causing repeated identical requests.

## 6. Manual control and safety

Manual commands always outrank AI. The default is to yield, allow the manual command, and reassess only when a meaningful conflict or milestone exists. Informational commands normally do not cancel delegated work. Manual movement, combat, equipment, automation-setting, or destination changes suspend/cancel conflicting AI work where safe, preserve the broader objective, and avoid immediately undoing the player’s choice.

An emergency stop is session-wide for AI only: cancel pending decisions/approvals, prevent new AI queue intents, and stop AI-controlled automation where safely interruptible. It must not block manual commands or disable unrelated client operation.

The AI must be prohibited from PvP, irreversible/destructive actions, real-money spending, credential handling, private-data exfiltration, and other policy-defined hazards unless a future explicit safety design allows a narrowly scoped exception. Unknown commands are never safe by syntax alone.

## 7. Memory and persistence model

Persistent memory is automatic but structured and selective. Each record includes server/character scope, category, source/provenance, confidence, observed time, validity/expiry, verification status, evidence references, and whether it is user-pinned.

- Verified commands, mechanics, discoveries, successful strategies, repeated failures, and objective milestones may persist automatically.
- Inferences persist as hypotheses and can gain or lose confidence through contradictory evidence.
- Social memory is conservative: concise interaction summaries may persist, but private messages, sensitive information, subjective player judgments, and relationship labels require stronger retention controls or approval.
- Explicit user preferences persist; inferred preferences never silently change settings or permissions.
- Live HP, room occupants, targets, movement, conditions, and other current state are session-only and always superseded by fresh tracker state.
- Objectives and progress may persist, but active plans/actions/approvals are revalidated after reconnect and never blindly resumed.

Memory maintenance uses deterministic deduplication, consolidation, contradiction detection, expiration, and retention limits wherever possible. The UI supports inspection, correction, verification, deletion, pinning, category clearing, and optional review notifications. Memory writes never grant authority.

## 8. Provider, budget, and security design

The first provider adapter is OpenRouter with model selection, secure credential storage, HTTPS/certificate validation, provider test, structured response validation, timeout/cancellation, bounded retry, error categories, usage and estimated cost reporting.

Provider-neutral contracts must represent authentication, context limits, structured output/tool support, latency, usage, pricing, and capabilities without leaking OpenRouter request shapes into gameplay code. Local providers such as Ollama or LM Studio remain future adapters.

Initial provisional budgets are 6 requests/minute, 60 requests/hour, $0.25/session, $1/day, and $10/month, with token limits established through benchmarking. Aggregate multi-agent limits are supported. Soft limits warn; hard limits stop new provider requests and enter Budget Paused while deterministic automation continues. Resume always reassesses live state.

Keys and private memory remain local and are excluded from source control, logs, captures, audits, and provider context unless explicitly required. Only minimum relevant memory and state are sent to the provider.

## 9. UI and IPC proposal

Each session gets an identified movable/pinnable AI panel showing server and character, provider/model, connection test, objective, bounded plan/subgoal, current delegated action and progress, state/status, pending approvals, effective policy with rule provenance, budgets/usage/cost, memory review, audit history, diagnostics, pause/resume, cancel/redirect, and emergency stop.

New IPC should be session-addressed and typed: agent snapshot/events, objective control, approval actions, policy resolution/edit/revoke, budget settings, memory queries/mutations, audit queries, provider configuration/test, and emergency stop. Electron preload and web bridge must expose the same contract. No renderer state should be authoritative for permissions or execution.

## 10. Upstream compatibility strategy

Keep AI code in additive `main/ai`, `shared/ai`, and narrowly scoped IPC/UI modules. Integrate through existing `SessionManager`/`SessionHost` callbacks and typed `Block`/automation snapshots rather than modifying parser ownership or duplicating state.

Keep provider, memory, permission, and AI UI modules independently testable. Rebase or merge upstream changes into this development branch before each implementation phase; avoid changing upstream files unless an explicit extension point is required. Preserve original behavior when AI is disabled.

## 11. Implementation phases after approval

1. Add typed observation/event contracts and a no-op agent behind a feature flag.
2. Inventory and codify named capabilities and command evidence/risk metadata from actual MudEngine behavior.
3. Add provider-neutral decision contract and OpenRouter adapter with budgets/diagnostics.
4. Add permission gateway, Ask First lifecycle, manual override, and emergency stop.
5. Add deterministic event-driven execution monitoring and one-action planning.
6. Add structured memory, persistence scopes, revalidation, and management UI.
7. Add AI panel/IPC integration and provider configuration.
8. Validate with realistic offline parser tests, queue tests, approval tests, reconnect/identity tests, provider mocks, budget tests, UI tests, and live opt-in scenarios.

No implementation phase should begin until this specification and the capability/risk inventory are approved.

## 12. Open research items and acceptance criteria

Before coding, confirm exact command aliases and risk classes from `shared/commands.ts`, parser patterns, probe scripts, queue behavior, automation switches, profile/server storage, and realm differences. Validate approval expiration against observed event frequency and benchmark compact context/token use.

Acceptance requires that a disabled AI leaves the original client unchanged; agents cannot cross sessions; manual commands remain unblocked; unknown commands cannot execute without approval; prohibited commands cannot execute; delegated navigation/combat do not trigger per-step provider calls; budgets pause only AI; stale approvals/actions cannot execute; memory is scoped and editable; social output is paced and event-aware; and upstream changes remain mergeable without rewriting the AI subsystem.
