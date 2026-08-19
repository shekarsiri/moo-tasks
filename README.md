# 🐮 Moo Tasks

<div align="center">

[![CI](https://github.com/your-username/moo-tasks/actions/workflows/ci.yml/badge.svg)](https://github.com/your-username/moo-tasks/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node: >=18.0.0](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![MCP Ready](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)

**Agentic Task Orchestration & Management Engine** built for AI coding agents (**Claude Code**, **Cursor**, **Windsurf**, **Antigravity**, **Copilot**) and human-in-the-loop pair programming.

[Quick Start](#-quick-start) • [Agent Setup](#-agent--mcp-setup) • [Agent Protocol](#-mandatory-agent-protocol) • [Architecture](#%EF%B8%8F-architecture) • [MCP Tools](#%EF%B8%8F-mcp-tool-reference)

</div>

---

## 🌟 Why Moo Tasks?

Standard AI coding agents often suffer from:
1. **Scope Drift**: Wandering away from original user intent into endless low-value refactorings.
2. **Over-Planning**: Generating 40 shallow tasks without executing any of them.
3. **Looping / Thrashing**: Attempting the same failed fix repeatedly without stopping.
4. **Unverifiable Work**: Claiming code is complete without running tests or producing evidence.
5. **Re-Debating Decisions**: Re-arguing settled architectural choices on every context reset.

**Moo Tasks** solves this by providing a local SQLite engine (WAL mode), a rich real-time Web UI, and a Model Context Protocol (MCP) server that enforces strict enterprise invariants at runtime.

---

## ✨ Key Capabilities & Feature Matrix

### 🎯 1. Goals & Scope Control
- **Verbatim Human Prompts**: Sits above tasks, preserving the exact original user request.
- **Goal Coverage & Loose Ends**: Live metrics on task completion percentage and lingering open tasks.
- **Scope Drift Detection**: Automatically identifies and flags orphan tasks with no linked goal.
- **Goal Open Caps**: Hard cap on maximum open tasks per goal (default: 10), preventing agents from over-planning.
- **Cascade Operations**: Atomically drop, kill, or reopen all tasks under a goal with mandatory reasons.

### 📋 2. Task Lifecycle & DAG Dependencies
- **Subtask Nesting Constraint**: Exactly 1 level of subtasks under a parent task.
- **Finite State Machine**: `todo`, `doing`, `blocked-on-dependency`, `waiting-on-human`, `done`, `dropped`.
- **DAG Dependency Graph**: Automatic cycle detection and automatic unblocking of downstream tasks.
- **Parent Closure Guard**: Prevents closing parent tasks while any subtask remains open.
- **Status Undo & History**: Roll back accidental state transitions using full transition audit history.

### 🛡️ 3. Completion, Verification & Proof of Work
- **Acceptance Criteria**: Mandatory criteria written in Markdown *before* work starts.
- **Evidence Requirement**: Closing a task requires verifiable proof (commands run, stdout output, test proofs).
- **Two-Phase Verification**: Distinguishes `agent_completed` from human `verified_done`.
- **Rejection with Reason**: Humans or peer agents can reject completed work with feedback; the task reverts to `todo` and increments the reopen counter.

### 🙋 4. Human Collaboration & Blocking
- **Waiting-on-Human Queue**: Agents pause blockers with attached questions (`clarification`, `approval`, `credential`, `decision`).
- **Reactive Resume**: Answering a question via Web UI or MCP automatically transitions the task back into the ready queue without agent restarts.
- **Dedicated Human Inbox**: Real-time queue of everything needing human attention.

### 🔍 5. Discovered Work
- **Mid-Task Work Capture**: Capture new work found mid-flight without relinquishing current task claim.
- **Must-Fix vs Deferred**: Mark as `must-fix-now` (inserted as blocker) or `deferred` (backlog pile).

### 🤖 6. Ownership, Concurrency & Leases
- **Exclusive Task Claims**: Leases with automatic timeout (default 5 minutes) when agents go silent.
- **Heartbeat Mechanism**: Extend leases during long-running tasks.
- **Agent Concurrency Limits**: Cap simultaneous tasks held per agent (default: 1).
- **File Touch Conflict Warnings**: Declared files are checked for overlaps against other active claims.

### 🔄 7. Stall & Thrash Detection
- **Attempt Counter**: Incremented on each claim/attempt.
- **Auto-Escalation**: After $N$ attempts (default: 3), automatically pauses task to `waiting-on-human` instead of endless looping.
- **Time-in-State Tracking**: Audits time spent in `doing` and detects repeated reopens.

### 🏛️ 8. Settled Architectural Decisions (ADR)
- **Project-Level Record**: Preserves choices and rationales that outlive tasks.
- **Pre-Planning Consultation**: Agents read settled decisions before planning.
- **Supersede Support**: Cleanly update and link superseded decisions with mandatory reasons.

---

## 🚀 Quick Start

### 1. Initialize Workspace & Agent Protocols
Run in your project root:
```bash
npx moo-tasks init
```
This:
- Initializes `.moo/tasks.db` SQLite database with WAL mode.
- Generates `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, and `.windsurfrules`.

### 2. Launch Local Web UI
```bash
npx moo-tasks start
```
Open **`http://127.0.0.1:4242`** in your browser.

To access the Web UI from another device or tablet on your local network (LAN):
```bash
npx moo-tasks start --lan
# Automatically logs: http://192.168.x.x:4242/
```

---

## 🔌 Agent & MCP Setup

### One-Command Multi-Agent Installer
```bash
# Configure all detected agent IDEs at once:
npx moo-tasks install all

# Or configure specific clients:
npx moo-tasks install claude       # Updates ~/.claude.json
npx moo-tasks install cursor       # Generates .cursor/mcp.json
npx moo-tasks install windsurf     # Updates ~/.codeium/windsurf/mcp_config.json
npx moo-tasks install antigravity  # Generates .gemini/settings.json
```

### Manual Configuration
```json
{
  "mcpServers": {
    "moo-tasks": {
      "command": "npx",
      "args": ["moo-tasks", "mcp"]
    }
  }
}
```

---

## 🤖 Mandatory Agent Protocol

All AI coding agents are instructed to follow this 6-step lifecycle:

```
1. SESSION RESUME  → Call moo_session_resume() & moo_list_decisions()
2. ANCHOR GOAL     → Call moo_create_goal(title, verbatimPrompt)
3. PLAN & CRITERIA → Call moo_create_task() with markdown criteria BEFORE code
4. EXCLUSIVE CLAIM → Call moo_claim_task(taskId, agentId, sessionId)
5. IMPLEMENTATION  → If blocked, call moo_ask_human() or link blockers
6. VERIFIED PROOF  → Call moo_complete_task() with test proof & output snippet
7. ADR RECORD      → Call moo_record_decision() for architectural choices
```

---

## 🛠️ MCP Tool Reference

| Tool Name | Purpose |
|---|---|
| `moo_create_goal` | Record human's verbatim prompt and set open task cap |
| `moo_list_goals` | List project goals and statuses |
| `moo_get_goal_status` | View goal coverage, open vs cap, and loose ends |
| `moo_kill_goal` | Drop goal and cascade drop all child tasks with reason |
| `moo_reopen_goal` | Reopen goal and its tasks |
| `moo_create_task` | Create task under goal with acceptance criteria & declared files |
| `moo_create_tasks_batch` | Batch create multiple tasks atomically |
| `moo_update_task` | Update title, criteria, priority, declared files, or goal |
| `moo_link_dependencies` | Link prerequisite blockers with cycle validation |
| `moo_unlink_dependencies` | Unlink prerequisite blocker |
| `moo_get_next_task` | Auto-surface next unblocked, highest-priority task |
| `moo_get_task` | Get full task details, subtasks, notes, dependencies |
| `moo_list_tasks` | Filter tasks by goal, status, priority, agent, deferred |
| `moo_claim_task` | Exclusively claim task (enforces lease & conflict checks) |
| `moo_heartbeat_task` | Extend active lease during long-running tasks |
| `moo_release_task` | Voluntarily release claim back to todo |
| `moo_handoff_task` | Handoff in-flight task to another agent with notes |
| `moo_complete_task` | Mark task done with mandatory commands/proof evidence |
| `moo_verify_task` | Verify task done (human or verification agent) |
| `moo_reject_task` | Reject completed task with mandatory reason |
| `moo_ask_human` | Escalate question to human and pause task |
| `moo_get_human_inbox` | List all tasks waiting on human guidance |
| `moo_answer_human` | Answer question and auto-resume task |
| `moo_capture_discovered_work` | Add discovered work (must-fix or deferred) |
| `moo_add_task_note` | Append timestamped, attributed context/attempt note |
| `moo_list_task_notes` | List context history and attempt logs |
| `moo_drop_task` | Drop task with mandatory reason |
| `moo_reopen_task` | Reopen task without losing audit history |
| `moo_undo_status_change` | Undo last status transition |
| `moo_bulk_drop_tasks` | Drop multiple tasks in single operation |
| `moo_bulk_reopen_tasks` | Reopen multiple tasks in single operation |
| `moo_record_decision` | Record project-level architectural decision |
| `moo_list_decisions` | List settled decisions before planning |
| `moo_supersede_decision` | Supersede decision with new rationale |
| `moo_merge_tasks` | Merge duplicate tasks |
| `moo_session_resume` | "Where did I leave off?" session summary |
| `moo_export_project` | Export project to Markdown, JSON, or Plain Text |
| `moo_archive_completed` | Archive done/dropped tasks out of active list |

---

## 🏛️ Architecture & Clean Code

```
src/
├── domain/                    # Pure Enterprise Domain Rules & Invariants
│   ├── types.ts              # Domain interfaces & value types
│   ├── errors.ts             # Domain-specific typed error classes
│   ├── dependency.ts         # DAG cycle detector & unblocked evaluator
│   ├── conflict.ts           # File touch overlap conflict detector
│   └── similarity.ts         # Duplicate task similarity detector
│
├── infrastructure/            # Persistence & External Integrations
│   ├── db/database.ts        # SQLite manager (WAL mode, busy timeout)
│   ├── db/migrations.ts      # Schema DDL and versioning
│   ├── git/git-context.ts    # Git branch, commit, dirty status extractor
│   └── repositories/         # SQLite Repository Implementations
│
├── services/                  # Application Services (Use Cases)
│   ├── goal-service.ts        # Goal lifecycle & cap enforcement
│   ├── task-lifecycle-service.ts # State machine, ready queue, undo
│   ├── claim-service.ts       # Exclusive claims, leases, dead-agent timeout
│   ├── verification-service.ts# Proof of work & two-phase verification
│   ├── human-collab-service.ts# Human Q&A queue & reactive resume
│   ├── discovered-work-service.ts # Mid-flight discovered work
│   ├── decision-service.ts    # ADR logs & supersede linking
│   ├── duplicate-merge-service.ts # Idempotency & task merging
│   ├── session-service.ts     # Where-did-I-leave-off session resume
│   ├── housekeeping-service.ts# Archiving & multi-format export
│   └── index.ts               # Dependency Injection Container
│
├── mcp/                       # Model Context Protocol Stdio Server
├── server/                    # Fastify HTTP + Server-Sent Events (SSE) Engine
├── cli/                       # CLI Commands (start, init, install, mcp)
└── ui/                        # Vanilla JS + Tailwind + Lucide Icons Web UI
```

---

## 🤝 Contributing

Contributions are welcome! Please check out [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, testing, and PR guidelines.

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE).
