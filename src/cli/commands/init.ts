import fs from 'fs';
import path from 'path';
import picocolors from 'picocolors';
import { createServiceContainer } from '../../services/index.js';
import { DatabaseManager } from '../../infrastructure/db/database.js';

export const AGENTS_MD_CONTENT = `# 🐮 AGENT GUIDELINES & PROTOCOL (Moo Tasks)

> ⚠️ **CRITICAL DIRECTIVE**: You are connected to the **Moo Tasks** MCP server.
> For **EVERY** user instruction, bug fix, or feature request, you **MUST** record and track your work in Moo Tasks with **FULL TECHNICAL DETAILS** **BEFORE** modifying code or running terminal commands. Never edit code without an active claimed task ID.

---

## ⚡ 1-Call Fast-Path for Rapid Coding (Recommended)

When the user asks you to implement a feature or fix an issue, use **\`moo_quick_start\`** to atomically create and claim the task in a single step with complete specifications:

\`\`\`json
{
  "title": "Implement feature X",
  "type": "feature",
  "tags": ["backend", "api"],
  "description": "### Technical Overview\\nDetailed design, architectural breakdown, and step-by-step implementation plan.\\n\\n### Implementation Plan\\n1. Step 1...\\n2. Step 2...",
  "acceptanceCriteria": "- [ ] Clear, testable markdown definition of done\\n- [ ] Unit tests pass",
  "priority": "high",
  "declaredFiles": ["src/feature.ts"]
}
\`\`\`

---

## 🎯 Full Mandatory 6-Step Workflow Protocol

### 1. Goal Anchoring (Prevent Scope Drift)
- Always anchor the human user's overarching request with \`moo_create_goal(title, verbatimPrompt, description)\`.
- Always include:
  - **verbatimPrompt**: Store the user's EXACT verbatim prompt to maintain fidelity.
  - **description**: Full rich Markdown PRD, architectural breakdown, component boundaries, and milestones.

### 2. Task Planning & Full Specifications
- Break down the goal into small, atomic tasks before touching code:
  - Call \`moo_create_task\` or \`moo_create_tasks_batch\`.
  - **Task titles must be clean, descriptive text** — do NOT embed priority codes, category prefixes, or sequence numbers in titles (e.g. avoid \`"C1: …"\`, \`"H2: …"\`, \`"UX-3: …"\`, \`"M1 — …"\`). Use the \`priority\`, \`type\`, and \`tags\` fields for classification.
  - ALWAYS write a comprehensive **\`description\`** containing:
    1. **Technical Overview & Architecture**: Why and how this is built.
    2. **Step-by-Step Implementation Plan**: Numbered actionable steps.
    3. **Design Decisions / Code Snippets**: Key types, schemas, or endpoints.
  - ALWAYS write testable **\`acceptanceCriteria\`** in Markdown with checkboxes (\`- [ ]\`) BEFORE touching code.
  - Declare **\`declaredFiles\`** and prerequisite **\`dependsOnTaskIds\`** (DAG cycle prevention is enforced).
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

export async function initCommand(options: { projectPath?: string; rules?: boolean; force?: boolean }) {
  const root = options.projectPath ? path.resolve(options.projectPath) : process.cwd();
  const overwrite = Boolean(options.force || options.rules);

  // Initialize service container and register global workspace
  const container = createServiceContainer({ projectPath: root });
  const ws = container.activeWorkspace;
  const globalDbPath = DatabaseManager.resolveGlobalDbPath();

  // 1. Generate AGENTS.md
  const agentsMdPath = path.join(root, 'AGENTS.md');
  if (!fs.existsSync(agentsMdPath) || overwrite) {
    fs.writeFileSync(agentsMdPath, AGENTS_MD_CONTENT);
    console.log(`${picocolors.green('✔')} ${overwrite ? 'Updated' : 'Created'} agent instructions: ${picocolors.cyan(agentsMdPath)}`);
  }

  // 2. Generate CLAUDE.md for Claude Code
  const claudeMdPath = path.join(root, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath) || overwrite) {
    fs.writeFileSync(claudeMdPath, `# Project Instructions for Claude Code\n\nSee [AGENTS.md](./AGENTS.md) for mandatory task orchestration rules with Moo Tasks.\n\n${AGENTS_MD_CONTENT}`);
    console.log(`${picocolors.green('✔')} ${overwrite ? 'Updated' : 'Created'} Claude Code instructions: ${picocolors.cyan(claudeMdPath)}`);
  }

  // 3. Generate .cursorrules for Cursor
  const cursorRulesPath = path.join(root, '.cursorrules');
  if (!fs.existsSync(cursorRulesPath) || overwrite) {
    fs.writeFileSync(cursorRulesPath, AGENTS_MD_CONTENT);
    console.log(`${picocolors.green('✔')} ${overwrite ? 'Updated' : 'Created'} Cursor instructions: ${picocolors.cyan(cursorRulesPath)}`);
  }

  // 4. Generate .windsurfrules for Windsurf
  const windsurfRulesPath = path.join(root, '.windsurfrules');
  if (!fs.existsSync(windsurfRulesPath) || overwrite) {
    fs.writeFileSync(windsurfRulesPath, AGENTS_MD_CONTENT);
    console.log(`${picocolors.green('✔')} ${overwrite ? 'Updated' : 'Created'} Windsurf instructions: ${picocolors.cyan(windsurfRulesPath)}`);
  }

  console.log(`\n${picocolors.bold(picocolors.green('✔ Initialized Moo Tasks workspace!'))}`);
  console.log(`  ${picocolors.gray('Workspace:')}      ${picocolors.bold(picocolors.cyan(ws.name))} (${picocolors.dim(ws.id)})`);
  console.log(`  ${picocolors.gray('Root Path:')}      ${picocolors.cyan(ws.rootPath)}`);
  console.log(`  ${picocolors.gray('Global Database:')} ${picocolors.yellow(globalDbPath)}`);
  console.log(`  ${picocolors.gray('Agent Rules:')}    ${picocolors.cyan('AGENTS.md, CLAUDE.md, .cursorrules, .windsurfrules')}`);
  console.log(`  ${picocolors.gray('Web UI:')}         ${picocolors.yellow('npx moo-tasks start')}`);
  console.log(`  ${picocolors.gray('MCP Mode:')}       ${picocolors.yellow('npx moo-tasks mcp')}\n`);
}
