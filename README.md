# 🐮 Moo Tasks

> **Agentic Task Orchestration & Management Engine** built for AI coding agents (**Claude Code**, **Antigravity**, **Codex**) and human-in-the-loop pair programming.

`moo-tasks` combines a high-performance **Model Context Protocol (MCP)** server, a local **SQLite** database, and an embedded real-time **Web UI** dashboard. It enforces strict domain constraints, prevents agent looping/thrashing, requires verifiable proof for task completion, and keeps settled architectural decisions firm.

---

## ✨ Key Capabilities & Feature Matrix

### 🎯 1. Goals & Scope Control
- **Verbatim Human Prompts**: Sits above tasks, preserving the exact original user request.
- **Goal Coverage & Loose Ends**: Live metrics on task completion percentage and lingering open tasks.
- **Scope Drift Detection**: Automatically identifies and flags orphan tasks with no linked goal.
- **Goal Caps**: Hard cap on maximum open tasks per goal (default: 10), preventing agents from over-planning instead of executing.
- **Cascade Operations**: Atomically drop, kill, or reopen all tasks under a goal with mandatory reasons.

### 📋 2. Task Lifecycle & DAG Dependencies
- **Subtask Nesting Constraint**: Exactly 1 level of subtasks under a parent task.
- **Finite State Machine**: `todo`, `doing`, `blocked-on-dependency`, `waiting-on-human`, `done`, `dropped`.
- **DAG Dependency Graph**: Cycle detection, blocking relationships, and automatic unblocking of downstream tasks when blockers finish.
- **Parent Closure Guard**: Prevents closing parent tasks while any subtask remains open.
- **Status Undo & History**: Roll back accidental state transitions using full transition audit history.
- **Bulk Actions & Manual Reordering**: Human-only manual priority reordering.

### 🛡️ 3. Completion, Verification & Proof of Work
- **Acceptance Criteria**: Mandatory criteria written *before* work starts.
- **Evidence Requirement**: Closing a task requires verifiable proof (commands run, stdout output, test proofs).
- **Two-Phase Verification**: Distinguishes `agent_completed` from `verified_done`.
- **Rejection with Reason**: Humans or peer agents can reject completed work with feedback; the task reverts to `todo` and increments the reopen counter.

### 🙋 4. Human Collaboration & Blocking
- **Waiting-on-Human Queue**: Agents pause blockers with attached questions (`clarification`, `approval`, `credential`, `decision`).
- **Reactive Resume**: Answering a question via Web UI or MCP automatically transitions the task back into the ready queue without agent restarts.
- **Dedicated Human Inbox**: Filterable queue of everything needing human attention.

### 🔍 5. Discovered Work
- **Mid-Task Work Capture**: Capture new work found mid-flight without relinquishing current task claim.
- **Must-Fix vs Deferred**: Mark as `must-fix-now` (inserted as blocker) or `deferred` (visible in backlog, excluded from active ready queue).

### 🤖 6. Ownership, Concurrency & Parallel Agents
- **Exclusive Task Claims**: Leases with automatic timeout (default 5 minutes) when agents go silent.
- **Heartbeat Mechanism**: Extend leases during long-running tasks.
- **Agent Concurrency Limits**: Cap simultaneous tasks held per agent (default: 1).
- **Agent Handoffs**: Transfer in-flight claims between agents with handoff notes.
- **File Touch Conflict Warnings**: Declared files are checked for overlaps against other active claims.

### 🔄 7. Stall & Loop Detection
- **Attempt Counter**: Incremented on each claim/attempt.
- **Auto-Escalation**: After $N$ attempts (default: 3), automatically pauses task to `waiting-on-human` instead of endless looping.
- **Time-in-State Tracking**: Audits time spent in `doing` and detects repeated reopens.

### 🏛️ 8. Settled Architectural Decisions (ADR)
- **Project-Level Record**: Preserves choices and rationales that outlive tasks.
- **Pre-Planning Consultation**: Agents read settled decisions before planning.
- **Supersede Support**: Cleanly update and link superseded decisions.

### 🧭 9. Session Continuity & Housekeeping
- **Where Did I Leave Off**: Instant session resume overview of in-flight work, answered questions, and ready queue.
- **Markdown & JSON Export**: Full export of goals, tasks, notes, and decisions.
- **Archival**: Cleanly archive completed tasks out of active working views.

---

## 🚀 Quick Start

### 1. Initialize Workspace
Run in your project root:
```bash
npx moo-tasks init
```
This creates a local `.moo/tasks.db` SQLite database with WAL mode enabled.

### 2. Launch Local Web UI & API Server
```bash
npx moo-tasks start
```
Open **`http://127.0.0.1:4242`** to view the live Kanban board, human inbox, and activity feed.

---

## 🔌 Agent & Plugin Setup (Claude Code, Antigravity, Codex)

### Automatic Installation
Run the installer to configure your tools automatically:
```bash
npx moo-tasks install all
```

### Manual Configuration

#### 🤖 Claude Code
Add to `~/.claude.json` or project `.claude.json`:
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

#### 🪐 Antigravity / Gemini CLI
Add to `.gemini/settings.json`:
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

#### 🧩 Codex / Generic MCP Clients
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
| `moo_record_decision` | Record project-level architectural decision |
| `moo_list_decisions` | List settled decisions before planning |
| `moo_supersede_decision` | Supersede decision with new rationale |
| `moo_merge_tasks` | Merge duplicate tasks |
| `moo_session_resume` | "Where did I leave off?" session summary |
| `moo_export_project` | Export project to Markdown, JSON, or Plain Text |
| `moo_archive_completed` | Archive done/dropped tasks out of active list |

---

## 🏛️ Architecture & SOLID Principles

```
src/
├── domain/                    # Pure Enterprise Domain Rules & Invariants
│   ├── types.ts              # Domain interfaces & value types
│   ├── errors.ts             # Domain-specific typed error classes
│   ├── dependency.ts         # DAG cycle detector & unblocked evaluator
│   ├── conflict.ts           # File touch overlap conflict detector
│   └── similarity.ts         # Duplicate task fuzzy/token similarity detector
│
├── infrastructure/            # Persistence & External Integrations
│   ├── db/database.ts        # SQLite manager (WAL, foreign keys, busy timeout)
│   ├── db/migrations.ts      # Schema DDL and versioning
│   ├── git/git-context.ts    # Git branch, commit, dirty status extractor
│   └── repositories/         # Sqlite Repository Implementations
│
├── services/                  # Application Services (Use Cases - SRP)
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
├── mcp/                       # Model Context Protocol Layer
│   ├── server.ts              # MCP Server instance with 30+ tools
│   └── transport-stdio.ts     # Stdio transport runner for agent subprocesses
│
├── server/                    # Fastify HTTP & Real-time Web Server
│   └── app.ts                 # REST API + Server-Sent Events (SSE) + Static UI
│
├── ui/                        # Web Dashboard SPA
│   ├── index.html             # Responsive Kanban, Goals, Inbox & Decisions UI
│   ├── app.js                 # Reactive frontend with SSE listener
│   └── styles.css             # Tailwind dark-themed styling
│
└── cli/                       # CLI Commands
    ├── commands/start.ts      # moo-tasks start (Web UI + Server)
    ├── commands/mcp.ts        # moo-tasks mcp (Stdio MCP server)
    ├── commands/init.ts       # moo-tasks init
    ├── commands/install.ts    # moo-tasks install (Claude, Antigravity, Codex)
    └── index.ts               # Commander CLI entrypoint
```

---

## 🧪 Testing

Run the test suite with Vitest:
```bash
npm test
```
Covers domain invariants, goal caps, subtask depth limits, DAG cycle detection, exclusive leases, evidence requirements, MCP handlers, and REST API endpoints.

---

## 📄 License
MIT
