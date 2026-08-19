# Project Instructions for Claude Code

See [AGENTS.md](./AGENTS.md) for mandatory task orchestration rules with Moo Tasks.

# 🐮 AGENT GUIDELINES & PROTOCOL (Moo Tasks)

> ⚠️ **CRITICAL DIRECTIVE**: You are connected to the **Moo Tasks** MCP server (`.moo/tasks.db`).
> For **EVERY** user instruction, bug fix, or feature request, you **MUST** record and track your work in Moo Tasks with **FULL TECHNICAL DETAILS** **BEFORE** modifying code or running terminal commands. Never edit code without an active claimed task ID.

---

## ⚡ 1-Call Fast-Path for Rapid Coding (Recommended)

When the user asks you to implement a feature or fix an issue, use **`moo_quick_start`** to atomically create and claim the task in a single step with complete specifications:

```json
{
  "title": "Implement feature X",
  "description": "### Technical Overview\nDetailed design, architectural breakdown, and step-by-step implementation plan.\n\n### Implementation Plan\n1. Step 1...\n2. Step 2...",
  "acceptanceCriteria": "- [ ] Clear, testable markdown definition of done\n- [ ] Unit tests pass",
  "priority": "high",
  "declaredFiles": ["src/feature.ts"]
}
```

---

## 🎯 Full Mandatory 6-Step Workflow Protocol

### 1. Goal Anchoring (Prevent Scope Drift)
- Always anchor the human user's overarching request with `moo_create_goal(title, verbatimPrompt, description)`.
- Always include:
  - **verbatimPrompt**: Store the user's EXACT verbatim prompt to maintain fidelity.
  - **description**: Full rich Markdown PRD, architectural breakdown, component boundaries, and milestones.

### 2. Task Planning & Full Specifications
- Break down the goal into small, atomic tasks before touching code:
  - Call `moo_create_task` or `moo_create_tasks_batch`.
  - ALWAYS write a comprehensive **`description`** containing:
    1. **Technical Overview & Architecture**: Why and how this is built.
    2. **Step-by-Step Implementation Plan**: Numbered actionable steps.
    3. **Design Decisions / Code Snippets**: Key types, schemas, or endpoints.
  - ALWAYS write testable **`acceptanceCriteria`** in Markdown with checkboxes (`- [ ]`) BEFORE touching code.
  - Declare **`declaredFiles`** and prerequisite **`dependsOnTaskIds`** (DAG cycle prevention is enforced).
  - Open tasks cap (max 10 open items per goal) is strictly enforced to prevent over-planning.

### 3. Exclusive Claim & Ownership
- Claim a task exclusively before starting implementation:
  - Call `moo_claim_task(taskId, agentId, sessionId, declaredFiles)` or use `moo_quick_start`.
  - This acquires a lease and protects against file collisions with concurrent agents.

### 4. Mid-Task Progress Checkpoints
- During implementation loops or long refactors, log progress:
  - Call `moo_checkpoint(taskId, note: "Added fixtures, mock APIs ready", heartbeat: true)`.
  - This automatically renews your lease so other agents don't reclaim your task.

### 5. Verified Completion (Mandatory Proof)
- When implementation is complete and tests pass, close the task:
  - Call `moo_complete_task(taskId, agentId, evidence: { commandsRun, outputSnippet, filesModified, testProof })`.
  - Tasks without verifiable proof cannot be marked done.

### 6. Architectural Decisions (ADR)
- Whenever choosing a library, database, pattern, or system design trade-off:
  - Call `moo_record_decision(title, context, choice, rationale, tags)` so subsequent agents never re-debate established decisions.
