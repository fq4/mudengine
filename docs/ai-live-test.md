# Supervised AI gameplay test

Use this procedure for the first live test. Keep the AI attached to a disposable character or a low-consequence area, and do not test PvP, purchases, transfers, destructive commands, or private information.

## Before connecting

1. Start from the `development` branch and confirm the worktree is clean.
2. Set the OpenRouter key through the existing MudEngine credential mechanism. Do not put it in YAML, source files, screenshots, or logs.
3. Start MudEngine with `npm run dev` and use **Test provider** in the AI panel. Confirm the diagnostic reports success and the selected model is the intended configured model.
4. Confirm the panel shows the correct server and character. Enable the AI only after verifying the identity.
5. Leave the default session budget in place for the first run.

## Safe first objective

Use a bounded informational objective such as:

```text
Inspect my current character and room, then walk to room 1/2 if the route is available. Do not communicate, fight, spend resources, change equipment, or execute general commands.
```

Start the agent and verify:

- one provider request produces one validated high-level decision;
- navigation is delegated to Walker rather than issuing a movement script from the model;
- intermediate movement does not create repeated provider requests;
- completion is reported only after the authoritative room state reaches the destination;
- a refused or interrupted route reports failure and does not loop indefinitely.

## Approval and manual-control checks

After the navigation test, use a separate objective that requests an unknown informational command. Confirm it appears as **Unclassified / Ask First** with an expiration and does not execute until approved.

Reject one request and confirm the agent receives rejection feedback. Approve one request and verify the approval history records approval and execution.

While a safe delegated operation is active, issue a manual informational command and then a conflicting movement command. Manual input must execute immediately; conflicting AI work must pause or cancel without the AI immediately undoing the manual choice.

Use **Emergency stop** and verify that pending AI requests and delegated AI navigation stop while manual gameplay remains available. Resume only after inspecting the current room and objective.

## What to record

Capture the following from the AI panel and diagnostic log, with credentials and private messages redacted:

- server, character, model, and provider diagnostic;
- objective, selected action, action lifecycle, and completion result;
- provider request count, tokens, estimated cost, and budget state;
- approval request, decision, expiration or execution history;
- manual-intervention and emergency-stop behavior;
- any command refusal, route failure, reconnect, or unexpected provider response.

Do not enable autonomous combat, social messaging, equipment changes, spending, or broad command execution until the corresponding capability has been tested against the real server's command vocabulary and consequences.
