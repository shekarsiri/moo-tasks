import fs from 'fs';
import path from 'path';
import picocolors from 'picocolors';
import { createServiceContainer } from '../../services/index.js';

export const AGENTS_MD_CONTENT = `# Agent Guidelines & Workflow Protocol (Moo Tasks)

All autonomous coding agents (Claude Code, Cursor, Windsurf, Antigravity, Copilot, Aider, etc.) working in this repository MUST use **Moo Tasks** (\`.moo/tasks.db\` / MCP tools) to plan, claim, execute, and verify all tasks.

---

## 🎯 Mandatory 6-Step Workflow Protocol

### 1. Session Start & Context Pickup
- Always start by checking session continuity and settled architectural decisions:
  - Call \`moo_session_resume()\` to surface abandoned in-flight tasks, human inbox items, and the unblocked ready queue.
  - Call \`moo_list_decisions(status: 'accepted')\` so settled architectural choices stay settled.

### 2. Goal Anchoring (Prevent Scope Drift)
- Anchor the human user's overarching request with \`moo_create_goal(title, verbatimPrompt)\`.
- Always store the user's EXACT verbatim prompt to maintain fidelity and prevent drift.

### 3. Planning & Pre-Work Acceptance Criteria
- Break down the goal into small, atomic tasks before modifying code:
  - Call \`moo_create_task\` or \`moo_create_tasks_batch\`.
  - ALWAYS write clear, testable \`acceptanceCriteria\` in Markdown BEFORE touching code.
  - Declare \`declaredFiles\` and prerequisite \`dependsOnTaskIds\` (DAG cycle prevention is enforced).
  - Open tasks cap (max 10 open items per goal) is strictly enforced to prevent over-planning.

### 4. Exclusive Claim & Ownership
- Claim a task exclusively before starting implementation:
  - Call \`moo_claim_task(taskId, agentId, sessionId, declaredFiles)\`.
  - This acquires a lease and checks for file collisions with other concurrent agents.

### 5. Implementation & Discovered Work
- If working on long tasks, periodically call \`moo_heartbeat_task(taskId, agentId)\`.
- If an unexpected blocker or prerequisite is discovered, call \`moo_capture_discovered_work\` or \`moo_link_dependencies\`.
- If user input, approval, or credentials are required, call \`moo_ask_human(taskId, agentId, question)\` to unblock yourself safely.

### 6. Verified Completion (Mandatory Proof)
- When implementation is complete and tests pass, close the task:
  - Call \`moo_complete_task(taskId, agentId, evidence: { commandsRun, outputSnippet, filesModified, testProof })\`.
  - Tasks without verifiable proof cannot be marked done.

### 7. Architectural Decisions (ADR)
- Whenever choosing a library, database, pattern, or system design trade-off:
  - Call \`moo_record_decision(title, context, choice, rationale, tags)\` so subsequent agents never re-debate established decisions.
`;

export async function initCommand(options: { projectPath?: string; rules?: boolean }) {
  const root = options.projectPath ? path.resolve(options.projectPath) : process.cwd();
  const mooDir = path.join(root, '.moo');

  if (!fs.existsSync(mooDir)) {
    fs.mkdirSync(mooDir, { recursive: true });
  }

  // Initialize service container and database
  createServiceContainer({ projectPath: root });

  // 1. Add .moo/tasks.db to .gitignore if not present
  const gitignorePath = path.join(root, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    if (!gitignoreContent.includes('.moo/tasks.db')) {
      fs.appendFileSync(gitignorePath, '\n# Moo Tasks Database\n.moo/tasks.db\n.moo/tasks.db-wal\n.moo/tasks.db-shm\n');
    }
  }

  // 2. Generate AGENTS.md
  const agentsMdPath = path.join(root, 'AGENTS.md');
  if (!fs.existsSync(agentsMdPath)) {
    fs.writeFileSync(agentsMdPath, AGENTS_MD_CONTENT);
    console.log(`${picocolors.green('✔')} Created agent instructions: ${picocolors.cyan(agentsMdPath)}`);
  }

  // 3. Generate CLAUDE.md for Claude Code
  const claudeMdPath = path.join(root, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    fs.writeFileSync(claudeMdPath, `# Project Instructions for Claude Code\n\nSee [AGENTS.md](./AGENTS.md) for mandatory task orchestration rules with Moo Tasks.\n\n${AGENTS_MD_CONTENT}`);
    console.log(`${picocolors.green('✔')} Created Claude Code instructions: ${picocolors.cyan(claudeMdPath)}`);
  }

  // 4. Generate .cursorrules for Cursor
  const cursorRulesPath = path.join(root, '.cursorrules');
  if (!fs.existsSync(cursorRulesPath)) {
    fs.writeFileSync(cursorRulesPath, AGENTS_MD_CONTENT);
    console.log(`${picocolors.green('✔')} Created Cursor instructions: ${picocolors.cyan(cursorRulesPath)}`);
  }

  // 5. Generate .windsurfrules for Windsurf
  const windsurfRulesPath = path.join(root, '.windsurfrules');
  if (!fs.existsSync(windsurfRulesPath)) {
    fs.writeFileSync(windsurfRulesPath, AGENTS_MD_CONTENT);
    console.log(`${picocolors.green('✔')} Created Windsurf instructions: ${picocolors.cyan(windsurfRulesPath)}`);
  }

  console.log(`\n${picocolors.bold(picocolors.green('✔ Initialized Moo Tasks workspace!'))}`);
  console.log(`  ${picocolors.gray('Database:')}    ${picocolors.cyan(path.join(mooDir, 'tasks.db'))}`);
  console.log(`  ${picocolors.gray('Agent Rules:')} ${picocolors.cyan('AGENTS.md, CLAUDE.md, .cursorrules, .windsurfrules')}`);
  console.log(`  ${picocolors.gray('Web UI:')}      ${picocolors.yellow('npx moo-tasks start')}`);
  console.log(`  ${picocolors.gray('MCP Mode:')}    ${picocolors.yellow('npx moo-tasks mcp')}\n`);
}
