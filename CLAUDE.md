# Project Instructions for Claude Code

See [AGENTS.md](./AGENTS.md) for mandatory task orchestration rules with Moo Tasks.

# Agent Guidelines & Workflow Protocol (Moo Tasks)

All autonomous coding agents (Claude Code, Cursor, Windsurf, Antigravity, Copilot, Aider, etc.) working in this repository MUST use **Moo Tasks** (`.moo/tasks.db` / MCP tools) to plan, claim, execute, and verify all tasks.

---

## 🎯 Mandatory 6-Step Workflow Protocol

### 1. Session Start & Context Pickup
- Always start by checking session continuity and settled architectural decisions:
  - Call `moo_session_resume()` to surface abandoned in-flight tasks, human inbox items, and the unblocked ready queue.
  - Call `moo_list_decisions(status: 'accepted')` so settled architectural choices stay settled.

### 2. Goal Anchoring (Prevent Scope Drift)
- Anchor the human user's overarching request with `moo_create_goal(title, verbatimPrompt)`.
- Always store the user's EXACT verbatim prompt to maintain fidelity and prevent drift.

### 3. Planning & Pre-Work Acceptance Criteria
- Break down the goal into small, atomic tasks before modifying code:
  - Call `moo_create_task` or `moo_create_tasks_batch`.
  - ALWAYS write clear, testable `acceptanceCriteria` in Markdown BEFORE touching code.
  - Declare `declaredFiles` and prerequisite `dependsOnTaskIds` (DAG cycle prevention is enforced).
  - Open tasks cap (max 10 open items per goal) is strictly enforced to prevent over-planning.

### 4. Exclusive Claim & Ownership
- Claim a task exclusively before starting implementation:
  - Call `moo_claim_task(taskId, agentId, sessionId, declaredFiles)`.
  - This acquires a lease and checks for file collisions with other concurrent agents.

### 5. Implementation & Discovered Work
- If working on long tasks, periodically call `moo_heartbeat_task(taskId, agentId)`.
- If an unexpected blocker or prerequisite is discovered, call `moo_capture_discovered_work` or `moo_link_dependencies`.
- If user input, approval, or credentials are required, call `moo_ask_human(taskId, agentId, question)` to unblock yourself safely.

### 6. Verified Completion (Mandatory Proof)
- When implementation is complete and tests pass, close the task:
  - Call `moo_complete_task(taskId, agentId, evidence: { commandsRun, outputSnippet, filesModified, testProof })`.
  - Tasks without verifiable proof cannot be marked done.

### 7. Architectural Decisions (ADR)
- Whenever choosing a library, database, pattern, or system design trade-off:
  - Call `moo_record_decision(title, context, choice, rationale, tags)` so subsequent agents never re-debate established decisions.
