<!-- moo-tasks:start (managed by `moo init`; edits inside this block are overwritten) -->
# 🐮 Moo Tasks protocol

You are connected to the **Moo Tasks** MCP server. Every code change you make is tracked as a Moo task.

## Before editing code
- Reading, searching and read-only commands (git status, running tests, builds) never need a task.
- Before your **first edit**, hold a claimed task:
  - New work: `moo_quick_start(title, acceptanceCriteria, description, declaredFiles)` creates and claims it in one call. `goalId` is optional; without it the task goes under this workspace's "Ad-hoc work" goal.
  - Planned work: `moo_get_next_task(claim: true)`.
- A small change is already finished? `moo_log_work(title, evidence)` records it in one call.

## Larger requests (multi-step or multi-file)
1. `moo_create_goal(title, verbatimPrompt, description)`: the user's exact words plus a Markdown PRD.
2. `moo_create_task(goalId, tasks: [...])`: atomic tasks, each with a description (overview and numbered plan), `- [ ]` acceptance criteria, `declaredFiles` and `dependsOnTaskIds`. Titles are plain text; use `priority`, `type` and `tags` instead of prefixes like "C1:".
3. Work through them with `moo_get_next_task(claim: true)`.

## While working
- `moo_checkpoint(taskId, note)` at milestones and before you stop: what is done, what is next, open questions. The next session resumes from these notes.
- Found other work: `moo_capture_discovered_work(currentTaskId, title)`; add `alreadyFixed: true` for a fix you made along the way. Need the user: `moo_ask_human`. An attempt failed: `moo_log_attempt_failure`.
- Chose a library, pattern or trade-off: `moo_record_decision(title, context, choice, rationale)`.

## Finishing
- `moo_complete_task(taskId, evidence: { testProof or outputSnippet, commandsRun }, criteria: [{ met, note }])`: one answer per `- [ ]` acceptance item, in order. An unmet item is allowed with a note saying why; it is recorded as a deviation, so never mark it met.
- If the workspace has a verify command, Moo runs it before accepting. Fix failures; pass `verifyOverride` only when a failure is unrelated to your task.
- Files changed since the claim are captured from git automatically. Parallel sub-agents each pass their own `agentId`.
- After a goal's last task, confirm with the user and close it: `moo_update_goal(goalId, status: 'completed', summary)`.

At session start call `moo_session_resume`; resume any **interrupted work** it lists with `moo_claim_task`. The board runs at http://localhost:4242.
<!-- moo-tasks:end -->
