import fs from 'fs';
import path from 'path';
import picocolors from 'picocolors';
import { createServiceContainer } from '../../services/index.js';
import { DatabaseManager } from '../../infrastructure/db/database.js';

export const MOO_BLOCK_START = '<!-- moo-tasks:start (managed by `moo init`; edits inside this block are overwritten) -->';
export const MOO_BLOCK_END = '<!-- moo-tasks:end -->';

export const AGENTS_MD_CONTENT = `# 🐮 Moo Tasks protocol

You are connected to the **Moo Tasks** MCP server. Every code change you make is tracked as a Moo task.

## Before editing code
- Reading, searching and read-only commands (git status, running tests, builds) never need a task.
- Before your **first edit**, hold a claimed task:
  - New work: \`moo_quick_start(title, acceptanceCriteria, description, declaredFiles)\` creates and claims it in one call. \`goalId\` is optional; without it the task goes under this workspace's "Ad-hoc work" goal.
  - Planned work: \`moo_get_next_task(claim: true)\`.
- A small change is already finished? \`moo_log_work(title, evidence)\` records it in one call.

## Larger requests (multi-step or multi-file)
1. \`moo_create_goal(title, verbatimPrompt, description)\`: the user's exact words plus a Markdown PRD.
2. \`moo_create_task(goalId, tasks: [...])\`: atomic tasks, each with a description (overview and numbered plan), \`- [ ]\` acceptance criteria, \`declaredFiles\` and \`dependsOnTaskIds\`. Titles are plain text; use \`priority\`, \`type\` and \`tags\` instead of prefixes like "C1:".
3. Work through them with \`moo_get_next_task(claim: true)\`.

## While working
- Long task: \`moo_checkpoint(taskId, note)\` logs progress and renews your 30-minute lease.
- Found other work: \`moo_capture_discovered_work\`. Need the user: \`moo_ask_human\`. An attempt failed: \`moo_log_attempt_failure\`.
- Chose a library, pattern or trade-off: \`moo_record_decision(title, context, choice, rationale)\`.

## Finishing
- \`moo_complete_task(taskId, evidence: { testProof or outputSnippet, commandsRun })\`. Files changed since the claim are captured from git automatically.
- Parallel sub-agents each pass their own \`agentId\`.

At session start call \`moo_session_resume\`. The board runs at http://localhost:4242.
`;

const CLAUDE_MD_BLOCK = `Moo Tasks orchestration rules live in AGENTS.md:

@AGENTS.md
`;

const CURSOR_MDC = `---
description: Moo Tasks task-tracking protocol
alwaysApply: true
---
`;

// Heading used by rule files written before managed blocks existed.
const LEGACY_HEADING = '# 🐮 AGENT GUIDELINES & PROTOCOL (Moo Tasks)';
const LEGACY_TAIL = 'never re-debate established decisions.';

function wrapBlock(body: string): string {
  return `${MOO_BLOCK_START}\n${body.trim()}\n${MOO_BLOCK_END}\n`;
}

/**
 * Inserts or refreshes the managed Moo block in a file, leaving everything outside it intact.
 * Returns what happened so init can report it.
 */
export function upsertManagedBlock(
  filePath: string,
  body: string,
  header = ''
): 'created' | 'updated' | 'unchanged' | 'appended' {
  const block = wrapBlock(body);
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, header + block);
    return 'created';
  }

  const current = fs.readFileSync(filePath, 'utf-8');
  const startIdx = current.indexOf(MOO_BLOCK_START.split(' (')[0]);
  const endIdx = current.indexOf(MOO_BLOCK_END);
  let next: string;
  let result: 'updated' | 'appended';

  if (startIdx !== -1 && endIdx > startIdx) {
    next = current.slice(0, startIdx) + block + current.slice(endIdx + MOO_BLOCK_END.length).replace(/^\n/, '');
    result = 'updated';
  } else if (current.includes(LEGACY_HEADING)) {
    // Replace the unmarked protocol an older `moo init` wrote, keeping any surrounding text.
    const legacyStart = current.indexOf(LEGACY_HEADING);
    const tailIdx = current.lastIndexOf(LEGACY_TAIL);
    const legacyEnd = tailIdx > legacyStart ? current.indexOf('\n', tailIdx) : -1;
    const after = legacyEnd === -1 ? '' : current.slice(legacyEnd + 1);
    next = current.slice(0, legacyStart) + block + after;
    result = 'updated';
  } else {
    next = current.replace(/\s*$/, '\n\n') + block;
    result = 'appended';
  }

  if (next === current) return 'unchanged';
  fs.writeFileSync(filePath, next);
  return result;
}

export async function initCommand(options: { projectPath?: string; rules?: boolean; force?: boolean }) {
  const root = options.projectPath ? path.resolve(options.projectPath) : process.cwd();

  // Initialize service container and register global workspace
  const container = createServiceContainer({ projectPath: root });
  const ws = container.activeWorkspace;
  const globalDbPath = DatabaseManager.resolveGlobalDbPath();

  const report = (label: string, filePath: string, result: string) => {
    if (result === 'unchanged') return;
    console.log(`${picocolors.green('✔')} ${result[0].toUpperCase()}${result.slice(1)} ${label}: ${picocolors.cyan(filePath)}`);
  };

  // AGENTS.md carries the protocol; every other agent file points at it or mirrors it.
  const agentsMdPath = path.join(root, 'AGENTS.md');
  report('agent instructions', agentsMdPath, upsertManagedBlock(agentsMdPath, AGENTS_MD_CONTENT));

  const claudeMdPath = path.join(root, 'CLAUDE.md');
  report(
    'Claude Code instructions',
    claudeMdPath,
    upsertManagedBlock(claudeMdPath, CLAUDE_MD_BLOCK, '# Project Instructions for Claude Code\n\n')
  );

  const cursorRulePath = path.join(root, '.cursor', 'rules', 'moo-tasks.mdc');
  report('Cursor rule', cursorRulePath, upsertManagedBlock(cursorRulePath, AGENTS_MD_CONTENT, CURSOR_MDC));

  const windsurfRulePath = path.join(root, '.windsurf', 'rules', 'moo-tasks.md');
  report('Windsurf rule', windsurfRulePath, upsertManagedBlock(windsurfRulePath, AGENTS_MD_CONTENT));

  // Deprecated single-file rule formats: refresh them only if a project still has them.
  for (const legacyFile of ['.cursorrules', '.windsurfrules']) {
    const legacyPath = path.join(root, legacyFile);
    if (fs.existsSync(legacyPath)) {
      report('legacy rules', legacyPath, upsertManagedBlock(legacyPath, AGENTS_MD_CONTENT));
    }
  }

  console.log(`\n${picocolors.bold(picocolors.green('✔ Initialized Moo Tasks workspace!'))}`);
  console.log(`  ${picocolors.gray('Workspace:')}      ${picocolors.bold(picocolors.cyan(ws.name))} (${picocolors.dim(ws.id)})`);
  console.log(`  ${picocolors.gray('Root Path:')}      ${picocolors.cyan(ws.rootPath)}`);
  console.log(`  ${picocolors.gray('Global Database:')} ${picocolors.yellow(globalDbPath)}`);
  console.log(`  ${picocolors.gray('Agent Rules:')}    ${picocolors.cyan('AGENTS.md, CLAUDE.md, .cursor/rules, .windsurf/rules')}`);
  console.log(`  ${picocolors.gray('Web UI:')}         ${picocolors.yellow('moo start')} ${picocolors.dim('(or npx moo-tasks start)')}`);
  console.log(`  ${picocolors.gray('MCP Mode:')}       ${picocolors.yellow('moo mcp')} ${picocolors.dim('(or npx moo-tasks mcp)')}\n`);
}
