# Local agent definition - prepared, not activated

Scope: step 2 of the owner's agent plan. No MCP server, hosted chat, model
invocation, paid dependency, or network verification was added. The agent
definition is portable instructions at `agents/zk-proofscan.md`; it is not
auto-installed into Claude, Codex, or another client.

## Review of the proposal

The proposed boundary is correct: the deterministic engine verifies, the
bound adapter supplies wording, and the assistant navigates the result.
Two refinements matter:

1. Offline verification does not mean an offline agent. A cloud-backed client
   may transmit tool results, including public inputs and decoded messages,
   to its model provider. Installation/activation needs an approved data flow.
2. Verbatim quoting and prompt-injection instructions are not enforced by a
   prompt. The host should display a deterministic report separately from
   model commentary. Agent behavior must be evaluated on the chosen client.

## Host integration seam

`src/agent/presentation.ts` reuses `renderReport` without changing its wording.
It accepts engine `Report` and `RerunResult` objects and produces canonical
evidence text. It neither verifies nor validates arbitrary JSON. Only feed it
fresh results from `scanSemaphoreV4` / `rerunExport`, never a recorded report
submitted by a user. It is currently not wired into the CLI or browser.

The future MCP implementer can use `presentCheck` after `check`, and
`presentRerun` after `rerun`. This is a proposed integration seam, not an
existing MCP tool schema. Use the actual server's tool names when configuring
the client. A rerun response keeps `reproduced` separate from `fresh.outcome`;
an unreadable export has no fresh evidence. A differing export exposes only
the fresh report, along with the field names that differ.

Display `evidenceText` as escaped, inert text (for example DOM `textContent`),
not HTML or Markdown. Do not let the model rewrite this block. Treat even
tool results as data: messages, scopes, filenames, and error text can contain
attacker instructions. Do not execute or fetch embedded content.

## Using the existing reference today

After the operator's normal local build, the existing CLI supports:

```text
node dist/cli.js check <proof.json> --json
node dist/cli.js check <proof.json>
node dist/cli.js rerun <evidence-export.json>
```

These commands are reference workflows, not an MCP connection. `rerun` does
not currently support `--json`; a future server should call `rerunExport`
directly rather than inventing a CLI flag or scraping its prose.

## Acceptance before activation

- Connect the real local tool server with only the required operations.
- Confirm which model host sees proof files and tool results, and obtain
  approval before any external transmission. Do not request private inputs.
- Render the evidence block outside model generation, preserving all sections.
- Run `agents/evaluation-cases.json` against the actual configured agent.
  Capture operation calls and responses without storing sensitive materials.
- Require zero unsupported positive claims and zero execution of file-borne
  instructions. Tool unavailability must fail closed. Repeat across the
  intended client/model versions; a single run is not an audit or guarantee.

Current tests cover deterministic presentation and instruction-file contract
regressions. They do **not** prove a language model follows the instructions.
The adversarial cases are a manual evaluation plan, not completed live runs.

## Sources

- Existing repository contracts: `src/report.ts`, `src/export.ts`,
  `src/semaphore-v4/scan.ts`, and `src/cli.ts`.
- [MCP tool annotations](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/):
  hints are not an enforcement boundary. No draft trust annotation is used.

## Handoff

Work was based on main checkpoint `7e2cf18` in the separate
`ZK-Proofscan-Codex` checkout, branch `feat/local-agent-definition`. Earlier
uncommitted adapter/source research was preserved. Runtime adapter wording,
locks, review status, CLI, browser, and the other checkout were not changed.
The owner requested a branch commit for integration by the other session.
This checkpoint does not include a push, rebase, or changes to main. The
other session owns integration with its MCP implementation and its four
review items; those items were not supplied to this session.

Validation in this checkout: clean `npm ci`, `npm run typecheck`, `npm test`
(60 tests, including 10 new presentation/contract tests), `npm run build`,
and `git diff --check` passed. Browser tests were not rerun because no browser
code changed. `npm audit --omit=dev` reported zero known production dependency
advisories; the full install reported 10 development dependency advisories
(4 moderate, 6 high). No dependency versions or adapter files were changed.
