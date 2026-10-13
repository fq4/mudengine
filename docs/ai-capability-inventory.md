# AI Capability Inventory

Status: implementation inventory completed; navigation is the verified first vertical slice. Capability classifications remain subject to live-server verification.

The inventory maps AI-facing decisions to existing MudEngine owners. The AI must call these owners through narrow adapters; it must not recreate their loops or write directly to the socket.

| Proposed AI decision | Existing subsystem | Inputs | Completion signal | Interruption/failure | Functionality gap |
|---|---|---|---|---|---|
| Inspect character/state | `CharacterTracker.current`, `SessionManager` publishers | Current session id | Snapshot is already authoritative | None; read-only | Compact AI projection and event relevance gate needed |
| Inspect room/map | `CharacterTracker`, `WorldGraph`, room/world stores | Current room, map, world database | Current room/world query result | Read-only refusal when unknown | AI-safe bounded serializer needed |
| Navigate to known room | `WorldGraph.route`, `SessionManager.walkRoute`, `Walker` | Current room, destination/route, traveller policy | `Walker` progress reaches done/idle with verified room state | `Walker.stop`, manual movement, route refusal, door/room mismatch, disconnect | AI adapter and completion observer; no new pathfinding |
| Engage ordinary NPC | `AutoCombat.alsoFight`, `AutoCombat.onCharacter` | Validated NPC target, current combat state | Combat state opens and later target dies/leaves/combat ends | Combat lease, death, target disappearance, manual break, PvP policy | Risk/target classification and AI lifecycle wrapper |
| Recover health/resources | `Recovery`, `AutoHeal`, potions/cures/regen modules | Current vitals/conditions and existing config | Recovery state/health update or explicit refusal | Manual command, combat, death, unavailable supplies | Adapter must report delegated progress; no duplicate healing logic |
| Manage equipment | `EquipmentManager.onCharacter`, gear stores | Character, inventory, movement state | Inventory/equipment state changes or manager settles | Walking/manual gear changes/invalid item | Permission/cost classification and lifecycle wrapper |
| Run existing automation | `SessionManager` automation switches, profile config | Named switch and desired state | Published automation snapshot/config result | Manual override, profile reload, invalid switch | Central AI permission gateway for settings |
| Send local speech | Existing Talk/parser/`CommandQueue` path | Message, current session | Parsed local conversation block or refusal | Queue pacing, manual input, communication throttle | Central social pacing/relevance gate |
| Send gossip/public message | Existing conversation parser and queue command syntax | Message, channel | `conversation-gossip` block or refusal | Same as local plus social rate limits | Server command aliases must be verified; do not infer `gos` universally |
| Tell/telepath/private message | Existing directed/telepath parser and queue | Target, message | Directed/telepath receipt or incoming reply | Unknown target, refusal, throttle, disconnect | Private retention/redaction policy |
| Execute general command | `CommandQueue`, command definitions, classifier, echoed command handling | Raw command plus session state | Echo/typed block, prompt, parsed result, refusal | Queue unavailable, unknown command, fumble, manual override | New centralized risk/evidence gateway; this is the primary genuine gap |
| Wait/listen | Existing event stream and timers | Wake conditions/deadline | Meaningful event, timeout, or user resume | Stop/emergency stop | Agent scheduler; no polling |

## First vertical slice

The first slice should use `navigate_to` because the repository already owns route calculation and multi-step execution. It must include:

1. A session-scoped agent with a typed observation and one OpenRouter decision.
2. A narrow navigation capability that accepts only a validated room destination/route.
3. Execution through `SessionManager.walkRoute`/`Walker`, never direct queue writes.
4. A lifecycle state of requested → accepted → executing → completed/failed/interrupted.
5. Completion driven by Walker progress and verified character room state, not by another provider request after every step.
6. A compact observable snapshot/diagnostic event for the panel and tests.

The initial slice began with navigation, but the repository now also contains guarded general-command handling, paced social adapters, scoped persistent memory, and approval/policy UI. These additions remain behind the same permission and validation boundaries; they are not evidence that every capability is ready for live autonomous use.

## Verified reuse decisions

- Do not add a second route planner, combat loop, recovery engine, equipment loop, parser, or command scheduler.
- Do not treat `CommandQueue` acceptance as command completion.
- Do not use player presence as a room destination; `PlayerBook` records presence and not reliable remote location.
- Do not wake the provider for every `onCharacter` call, combat round, movement leg, or status update.
- Keep all new state keyed by `SessionId` and current character identity.

## Test matrix for the inventory

- Navigation request produces one route/execution delegation and no per-step provider calls.
- Verified arrival completes the action; route refusal and disconnect fail it.
- Manual movement interrupts or invalidates the AI navigation action without blocking manual input.
- NPC combat delegates to `AutoCombat`; PvP-looking targets are rejected by policy.
- Recovery/equipment adapters report accepted versus completed distinctly.
- Conversation echoes do not count as incoming replies; public chatter does not wake an unrelated conversation.
- Unknown general commands require approval and cannot bypass named-capability or queue safeguards.

## Current implementation boundary

- Verified locally: one agent per session, OpenRouter decision flow, validated `navigate_to` delegation through `Walker`, room-confirmed completion, stale approval invalidation, budget pause behavior, scoped memory persistence/editing and relevance ranking, manual interruption handling, social pacing, layered global/server/profile policy resolution, effective-policy provenance, and session-addressed UI/IPC controls.
- Requires additional integration coverage: combat target lifecycle, recovery/equipment completion observers, identity-change and reconnect restoration, aggregate budgets across simultaneous sessions, policy reload propagation while a session is active, and end-to-end live command evidence.
- Not yet suitable for unattended live use: autonomous PvP, destructive/irreversible actions, real-money actions, private-data handling, or unclassified commands without an explicit approval.
