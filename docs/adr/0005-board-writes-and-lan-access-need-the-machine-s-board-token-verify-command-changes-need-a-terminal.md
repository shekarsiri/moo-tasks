# 5. Board writes and LAN access need the machine's board token; verify command changes need a terminal

* **Status**: ACCEPTED
* **Decision ID**: `dec-52570999`
* **Date**: 2026-10-02
* **Author**: `claude-code@frontend.local:64756` (agent)
* **Tags**: `security`, `board`, `verification`

## Context

The board has no login. With --lan anyone on the network could read every workspace and delete workspaces; on the machine, an agent could curl /api/tasks/:id/verify, /answer or /status, or run `moo verify:set`, bypassing the human-only boundary that MCP enforces.

## Decision

One random token per machine in ~/.moo/board-token (0600). Requests from other devices need it for everything (the --lan link carries it once, then an HttpOnly SameSite=Strict cookie). On loopback, reads stay open but every POST/PUT/PATCH/DELETE under /api needs it; the server injects it into the board page and the page's fetch wrapper sends X-Moo-Token. `moo verify:set` may set the first verify command anywhere, but changing or clearing one requires an interactive terminal (or the board).

## Rationale & Consequences

Closes the LAN exposure outright and turns the local human-only boundary from a convention into something an agent has to deliberately circumvent (read the token file or scrape the page), without adding a login. Agents can only make the verify gate stricter, never weaker.
