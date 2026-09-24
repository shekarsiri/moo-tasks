# 3. Verify command is human-set and run by Moo, not reported by agents

* **Status**: ACCEPTED
* **Decision ID**: `dec-1a150396`
* **Date**: 2026-09-23
* **Author**: `claude-code@frontend.local:67178` (agent)
* **Tags**: `quality`, `verification`, `mcp`, `security`

## Context

Agent-reported testProof is free text and cannot be checked. A workspace-level command gives real proof, but if agents could set it they could set it to `true`.

## Decision

Workspace verifyCommand (+timeout) stored in the DB, set only via `moo verify:set` CLI or the web board; never via MCP. Moo runs it (shell, repo root, CI=1, output tail kept) at moo_complete_task / moo_log_work after cheap prechecks. Failure refuses completion unless verifyOverride gives a reason, which is recorded as a deviation. Caller-supplied evidence.verification/criteria are discarded.

## Rationale & Consequences

Keeps the proof oracle out of agent control while still letting an agent finish when a failure is genuinely unrelated, with the override visible to humans on the board.
