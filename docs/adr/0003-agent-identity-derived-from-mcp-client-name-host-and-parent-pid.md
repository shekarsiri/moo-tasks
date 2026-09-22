# 3. Agent identity derived from MCP client name, host and parent pid

* **Status**: ACCEPTED
* **Decision ID**: `dec-31a93dac`
* **Date**: 2026-09-22
* **Author**: `claude-code-opus` (agent)
* **Tags**: `mcp`, `identity`, `claims`, `leases`

## Context

agentId defaulted to 'agent', so every agent shared one identity and ownership checks were meaningless; fallbacks to the current holder let anyone pass.

## Decision

Default identity is `${clientInfo.name}@${hostname}:${ppid}` (ppid = the IDE/agent host process). Explicit agentId still wins. A lease whose holder is a dead local pid is treated as expired.

## Rationale & Consequences

Stable per agent session, distinct across concurrent sessions, and lets crashed sessions' claims be recovered immediately instead of waiting out the lease.
