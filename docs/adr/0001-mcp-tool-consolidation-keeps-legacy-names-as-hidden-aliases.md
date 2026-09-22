# 1. MCP tool consolidation keeps legacy names as hidden aliases

* **Status**: ACCEPTED
* **Decision ID**: `dec-b5f5dc5e`
* **Date**: 2026-09-22
* **Author**: `claude-code-opus` (agent)
* **Tags**: `mcp`, `tools`, `compatibility`

## Context

54 listed tools cost ~7.7k tokens per agent context. Existing AGENTS.md files in many repos reference old tool names.

## Decision

List ~27 merged tools; keep every legacy tool name callable via the CallTool switch but omit it from tools/list. moo_quick_start stays listed because every generated AGENTS.md references it.

## Rationale & Consequences

Halves the schema tokens without breaking raw callers or older integrations; clients that only expose listed tools see the new merged surface.
