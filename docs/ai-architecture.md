# AI architecture inventory

The autonomous agent is deliberately a consumer of MudEngine state, not a
second game model.

| Source | AI use | Ownership and freshness |
| --- | --- | --- |
| `CharacterTracker.current` / `CharacterState` | identity, realm, vitals, progression, inventory, spells, conditions, room entities, combat, party | Main-process parser and tracker own it; values remain nullable until the server or a durable character record establishes them. |
| `WorldGraph` | room-name lookup, known destinations, exit requirements, route calculation | Main-process realm database owns it; routes are calculated with the current traveller and never accepted from the model as authority. |
| `Walker.progress` | destination, step count, remaining named rooms, hold/reason, arrival/stopped state | Walker owns it and advances only after a room/state response verifies a step. |
| `CommandQueue` | supported commands and recovery requests | Queue owns ordering, priority, suppression, and wire delivery; AI only proposes intents. |
| `AutoCombat` | safe target delegation and combat strategy | AutoCombat owns target gates, PvP refusal, and combat mechanics. |
| `Recovery` and automation snapshots | health/resource state and deterministic recovery context | Existing automation modules own mechanical actions; AI chooses when to request a supported capability. |
| parsed events and `SessionManager` ticks | changed-state wakeups and action outcome context | SessionManager invokes the agent after committed parser changes; unchanged observations are hash-suppressed. |

`aiStateView` projects these sources into a bounded, read-only `AiStateView`.
It preserves unknown values as `null`, carries source timestamps where the
underlying model has them, and omits credentials and profile configuration.
The provider sees the compact projection; it does not receive the mutable
tracker object or terminal credentials.

Navigation is a two-stage operation: the model names a destination, then
`GameplayAdapter` resolves it through `WorldGraph` and sends the validated
route to `Walker`. Action records distinguish a completed inspection from a
gameplay request accepted by a subsystem but still waiting for parsed server
confirmation.
