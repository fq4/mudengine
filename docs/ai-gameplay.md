# Optional AI gameplay

AI is disabled by default and is deliberately a high-level controller. It observes a character snapshot, asks the configured provider for one validated decision, and delegates the result to existing movement, combat, recovery, and `CommandQueue` implementations. It never writes to the socket directly.

## Configuration

Set `OPENROUTER_API_KEY` in the environment of the main Electron process. The key is never sent to the renderer or included in logs. Select a model with `MUDENGINE_AI_MODEL` (default: `openai/gpt-4o-mini`). If the key is absent, enabling AI reports a configuration error and performs no gameplay.

The agent is opt-in per character. Enable it only after connecting, enter a natural-language objective, and use pause, stop, or Emergency stop for immediate takeover. Informational manual commands can leave the objective running; conflicting manual commands cancel queued AI work and pause the agent so it cannot immediately reverse the player's decision. Repeated unchanged observations are suppressed, and the agent records bounded recent memories and provider usage for the character.

## Safety and limitations

Structured capabilities are preferred, but general commands are supported through the centralized classifier. Provider failures, invalid JSON, timeouts, and repeated failures leave the agent stopped in an error state. The provider is instructed not to PvP or perform irreversible actions; the executor must enforce those rules and route all supported commands through the session's existing queue. Safe informational commands are autonomous, routine commands are policy-bound, unknown commands require Ask First approval, and prohibited commands are rejected. The current provider adapter reports token-based estimated usage; exact billing depends on the selected OpenRouter model.

Future providers can implement the small `AiProvider` interface without changing gameplay orchestration.

## Current implementation boundaries

`navigate_to` delegates route calculation and execution to `WorldGraph`, `planFromHere`, and `Walker`. Combat, recovery, and equipment decisions delegate to `AutoCombat`, the recovery manager, and `EquipmentManager`; acceptance is recorded separately from eventual completion. The agent waits for a changed authoritative observation before requesting another decision for delegated work.

General commands pass through the centralized risk classifier: known informational commands are autonomous, known routine commands remain policy-bound, unknown commands create an Ask First approval, and prohibited/PvP patterns are rejected. Approvals are session-scoped, deduplicated, expire after a risk-dependent interval, and are exposed in the AI panel with approve/reject controls and history.

Social messages use typed channels and application pacing. Gossip uses the MUD's `gos` command; local speech uses the room-only dot command. A 30-second minimum interval and near-duplicate suppression are enforced before queueing an AI message, and self-echoed or incomplete conversation output does not wake the agent. Manual commands remain outside these AI gates.

Provider requests are independently limited by the AI budget controller (currently 6 requests/minute, 60/hour, 25,000 tokens, and $0.25/session defaults). When a hard limit is reached, the panel shows `budget-paused`; new AI decisions stop while deterministic MudEngine automation and manual gameplay continue. OpenRouter connectivity can be tested from the panel without exposing the credential.

Unknown-command approvals are exact-command and current-state bound. They expire after 60 seconds for high-risk and 120 seconds for unknown actions. A user may approve once or grant a narrowly scoped, session-only exact-command authorization for up to 60 minutes and 20 uses; grants can be revoked from the panel. Pending approvals and their approved, rejected, or expired history are visible in the panel. Memory is server/character scoped and can be edited or forgotten from the panel.
