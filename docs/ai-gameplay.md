# Optional AI gameplay

AI is disabled by default and is deliberately a high-level controller. It observes a character snapshot, asks the configured provider for one validated decision, and delegates the result to existing movement, combat, recovery, and `CommandQueue` implementations. It never writes to the socket directly.

## Configuration

Set `OPENROUTER_API_KEY` in the environment of the main Electron process. The key is never sent to the renderer or included in logs. Select a model with `MUDENGINE_AI_MODEL` (default: `openai/gpt-4o-mini`). If the key is absent, enabling AI reports a configuration error and performs no gameplay.

The agent is opt-in per character. Enable it only after connecting, enter a natural-language objective, and use pause or stop for immediate takeover. Any manual input pauses the agent before deterministic automation resumes. Repeated unchanged observations are suppressed. The panel restores each character's objective, bounded recent memories, recent activity, and last action result across renderer/application restarts; this persisted state contains no credentials.

## Safety and limitations

Only the allow-listed structured actions are accepted. Provider failures, invalid JSON, timeouts, and repeated failures leave the agent stopped in an error state. The provider is instructed not to PvP or perform irreversible actions; the executor must enforce those rules and route all supported commands through the session's existing queue. The current provider adapter reports token-based estimated usage; exact billing depends on the selected OpenRouter model.

Future providers can implement the small `AiProvider` interface without changing gameplay orchestration.

## State and decision model

The provider receives a bounded `AiStateView` assembled from the live
`CharacterTracker` state and `Walker.progress`. It includes character identity
and progression, vitals, conditions and buffs, inventory freshness and items,
known spells and abilities, the resolved room with exits and occupants, and
navigation progress. Values that have not been observed remain `null` with a
null observation timestamp; an empty known listing is therefore distinct from
an unobserved listing. Credentials, profile passwords, and provider settings
are never part of the view.

The model chooses a high-level action. Named destinations are resolved through
`WorldGraph.searchByName` and routed through `WorldGraph.route`; execution is
then delegated to `Walker`. Numeric room references remain supported. The
model never supplies a route that is accepted without engine validation.

Action results distinguish completed inspection from an action accepted by a
deterministic subsystem and still awaiting server/state confirmation. The
panel shows the current subgoal, action phase, room, and navigation progress.
While Walker is walking, the agent does not spend another provider request for
each confirmed step; it waits for arrival or an interruption before planning
again. This keeps deterministic movement in MudEngine and reserves provider
calls for meaningful decisions.

## Social objectives and failures

For roleplay objectives the agent can use `send_message` with `local`,
`gossip`, `tell`, `telepath`, or `broadcast`. Local speech uses the room's
communication prefix; gossip and remote channels are kept distinct in the
action trace. Player names from presence data are never treated as room
destinations. A player outside the current room has no navigable location
unless the existing state explicitly provides one.

OpenRouter failures include the provider's bounded error body and a category
such as invalid request, unsupported parameter, context limit, authentication,
rate limit, or server error. Authorization headers and keys are never included.
Permanent HTTP 400 failures are not retried against the same request. Failed
gameplay actions are passed back as planner feedback so the next decision can
change strategy instead of repeating an impossible action.
