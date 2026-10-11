# Agent definition: written, not activated

Step 2 of the owner's agent plan. The agent is a way to use ZK-Proofscan: it
runs the check through the tool server and shows the result. It does not
verify anything and does not supply the claim wording.

| Piece | Where | State |
| --- | --- | --- |
| Tool server | `src/mcp.ts`, `dist/mcp.js` | Built and tested (step 1) |
| Agent instructions | `agents/zk-proofscan.md` | Written; not installed in any client |
| Fixed presentation | `src/agent/presentation.ts` | Used by the tool server |
| Evaluation scenarios | `agents/evaluation-cases.json` | Written; not run |

No client configuration is committed, so opening this repository does not
connect any agent to the server. No model has been run with the instructions.

## Before activation: who sees the data

The tool server uses no network. The agent calling it usually does: a
cloud-hosted model receives every tool result, including the public inputs,
the message and scope, the report and the file paths. Connecting the server
to such an agent sends that data to the model's provider. The owner must
approve the provider first. The agent cannot enforce this, because a hosted
model has already received whatever it reads.

## What instructions cannot do

Quoting the report word for word and ignoring text planted in a proof are
instructions to a model, and a model can fail to follow them. Two measures
do not depend on the model:

- Each tool result carries `evidenceText`, the fixed report, in its
  structured part. A host can show that to the person directly, as plain
  text and not as Markdown or HTML, beside whatever the model says. Claude
  Code does not do this: the person reads the model's reply.
- A rerun result carries only the report from the fresh check. The report
  recorded in an export is compared against and never returned.

Tool annotations such as "read-only" are hints to the client and not a
boundary.

## Activating it, once the provider is approved

For Claude Code, add a file `.mcp.json` at the repository root after
`npm ci && npm run build`:

```json
{ "mcpServers": { "zk-proofscan": { "command": "node", "args": ["dist/mcp.js"] } } }
```

and copy `agents/zk-proofscan.md` to `.claude/agents/zk-proofscan.md` with
this at the top:

```text
---
name: zk-proofscan
description: Checks a zero-knowledge proof or evidence export with the local ZK-Proofscan tools and shows the fixed report.
tools: mcp__zk-proofscan__check_proof, mcp__zk-proofscan__rerun_export, mcp__zk-proofscan__write_export
---
```

The `tools` line leaves the agent without a shell, file access or web
access, which limits what planted text could make it do. This configuration
has not been tried.

## Acceptance (step 3)

- Run every case in `agents/evaluation-cases.json` against the configured
  agent, on test fixtures only, and record the tool calls and replies.
- The hostile-message case needs a freshly generated proof bound to that
  message. `scripts/make-fixture.mjs` has a fixed message today and needs an
  option for it. Editing a valid proof's message does not give a valid proof.
- Require no unsupported positive claim and no instruction from a file being
  followed. With the tools unavailable the agent must say "Not checked".
- Repeat for each client and model version intended for use. One passing
  run is not an audit or a guarantee.

The tests in `tests/agent-presentation.test.ts` cover the fixed presentation
and check that the instruction file keeps its key sentences. They do not
show that a model follows them.

## History

The instructions, presentation code and scenarios were written by the Codex
session in its own checkout on top of `7e2cf18`, before the tool server
existed (commit `310b529`). They were then joined to the tool server here:
real tool names, the server building its results from the presentation code,
and the data-sharing rule moved from the agent to the operator.
