import fs from 'fs';
import path from 'path';
import picocolors from 'picocolors';
import { createServiceContainer } from '../../services/index.js';

export const AGENTS_MD_CONTENT = `# 🐮 AGENT GUIDELINES & PROTOCOL (Moo Tasks)

> ⚠️ **CRITICAL DIRECTIVE**: You are connected to the **Moo Tasks** MCP server (\`.moo/tasks.db\`).
> For **EVERY** user instruction, bug fix, or feature request, you **MUST** record and track your work in Moo Tasks **BEFORE** modifying code or running terminal commands. Never edit code without an active claimed task ID.

---

## ⚡ 1-Call Fast-Path for Rapid Coding (Recommended)

When the user asks you to implement a feature or fix an issue, use **\`moo_quick_start\`** to atomically create and claim the task in a single step:

\`\`\`json
{
  "title": "Implement feature X",
  "acceptanceCriteria": "Clear, testable markdown definition of done",
  "priority": "high",
  "declaredFiles": ["src/feature.ts"]
}
\`\`\`

---

## 🎯 Full Mandatory 6-Step Workflow Protocol

### 1. Goal Anchoring (Prevent Scope Drift)
- Always anchor the human user's overarching request with \`moo_create_goal(title, verbatimPrompt, description)\`.
- Store the user's EXACT verbatim prompt to maintain fidelity.

### 2. Task Planning & Acceptance Criteria
- Break down the goal into small, atomic tasks:
  - Call \`moo_create_task\` or \`moo_create_tasks_batch\`.
  - ALWAYS write testable \`acceptanceCriteria\` in Markdown BEFORE touching code.
  - Declare \`declaredFiles\` and prerequisite \`dependsOnTaskIds\` (DAG cycle prevention is enforced).
  - Open tasks cap (max 10 open items per goal) is strictly enforced to prevent over-planning.

### 3. Exclusive Claim & Ownership
- Claim a task exclusively before starting implementation:
  - Call \`moo_claim_task(taskId, agentId, sessionId, declaredFiles)\` or use \`moo_quick_start\`.
  - This acquires a lease and protects against file collisions with concurrent agents.

### 4. Mid-Task Progress Checkpoints
- During implementation loops or long refactors, log progress:
  - Call \`moo_checkpoint(taskId, note: "Added fixtures, mock APIs ready", heartbeat: true)\`.
  - This automatically renews your lease so other agents don't reclaim your task.

### 5. Verified Completion (Mandatory Proof)
- When implementation is complete and tests pass, close the task:
  - Call \`moo_complete_task(taskId, agentId, evidence: { commandsRun, outputSnippet, filesModified, testProof })\`.
  - Tasks without verifiable proof cannot be marked done.

### 6. Architectural Decisions (ADR)
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
