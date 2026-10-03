/**
 * MCP server instructions: clients put these in the agent's context on connect, so the protocol
 * reaches agents in every project, not only those with a `moo init` AGENTS.md. They are loaded
 * into every session, so they stay short; AGENTS.md carries the full version.
 */
export const PROTOCOL_INSTRUCTIONS = `Moo Tasks tracks every code change in this project as a task.
- Session start: call moo_session_resume; resume interrupted work it lists with moo_claim_task.
- Reading, searching and read-only commands need no task.
- Before your first edit, hold a claimed task: moo_quick_start(title, acceptanceCriteria as a "- [ ]" checklist, declaredFiles) for new work, or moo_get_next_task(claim: true) for planned work. A small change already made: moo_log_work(title, evidence).
- Multi-step requests: moo_create_goal(title, verbatimPrompt, description), then moo_create_task(goalId, tasks: [...]).
- While working: moo_checkpoint at milestones and before stopping; moo_capture_discovered_work for other work found; moo_ask_human when blocked on the user; moo_record_decision for design choices.
- Finish: moo_complete_task(taskId, evidence: { testProof or outputSnippet, commandsRun }, criteria: one { met, note } per checklist item). Unmet items need a note; never mark them met.
- Parallel sub-agents each pass their own agentId.`;

export function inactiveInstructions(directory: string): string {
  return `Moo Tasks is inactive here: ${directory} is not a git repository or a directory registered with \`moo init\`, so no work is tracked and the Moo tools refuse with NO_WORKSPACE. Work normally; to track work in this directory the user runs \`moo init\` in the project root.`;
}
