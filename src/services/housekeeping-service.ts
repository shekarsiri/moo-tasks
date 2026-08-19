import {
  IGoalRepository,
  ITaskRepository,
  IDecisionRepository,
  INoteRepository,
} from '../infrastructure/repositories/interfaces.js';

export class HousekeepingService {
  constructor(
    private goalRepo: IGoalRepository,
    private taskRepo: ITaskRepository,
    private decisionRepo: IDecisionRepository,
    private noteRepo: INoteRepository
  ) {}

  archiveCompleted(goalId?: string): number {
    const filter: any = { isArchived: false };
    if (goalId) filter.goalId = goalId;

    const tasks = this.taskRepo.list(filter);
    const completedTasks = tasks.filter((t) => t.status === 'done' || t.status === 'dropped');

    for (const task of completedTasks) {
      task.isArchived = true;
      task.updatedAt = new Date().toISOString();
      this.taskRepo.update(task);
    }

    return completedTasks.length;
  }

  exportProject(projectPath: string, format: 'markdown' | 'json' | 'text' = 'markdown'): string {
    const goals = this.goalRepo.list(projectPath);
    const tasks = this.taskRepo.list({ isArchived: false });
    const decisions = this.decisionRepo.list(projectPath);

    if (format === 'json') {
      return JSON.stringify(
        {
          projectPath,
          exportedAt: new Date().toISOString(),
          goals,
          tasks,
          decisions,
        },
        null,
        2
      );
    }

    if (format === 'markdown') {
      let md = `# Moo Tasks Project Export\n\n`;
      md += `*Exported on: ${new Date().toISOString()}*\n\n`;

      md += `## 🎯 Goals\n\n`;
      if (goals.length === 0) {
        md += `*No goals recorded.*\n\n`;
      } else {
        for (const g of goals) {
          md += `### ${g.title} (${g.status.toUpperCase()})\n`;
          md += `- **ID**: \`${g.id}\`\n`;
          md += `- **Verbatim Prompt**:\n> ${g.verbatimPrompt.split('\n').join('\n> ')}\n\n`;
        }
      }

      md += `## 📋 Tasks\n\n`;
      if (tasks.length === 0) {
        md += `*No tasks found.*\n\n`;
      } else {
        for (const t of tasks) {
          const check = t.status === 'done' ? '[x]' : '[ ]';
          md += `### ${check} ${t.title} (\`${t.id}\`) - [${t.status.toUpperCase()}]\n`;
          md += `- **Priority**: ${t.priority} | **Goal**: ${t.goalId || 'None (Orphan)'}\n`;
          md += `- **Acceptance Criteria**: ${t.acceptanceCriteria}\n`;
          if (t.claimedByAgent) md += `- **Claimed By**: ${t.claimedByAgent}\n`;
          if (t.evidence) {
            md += `- **Evidence Proof**:\n\`\`\`json\n${JSON.stringify(t.evidence, null, 2)}\n\`\`\`\n`;
          }
          if (t.droppedReason) md += `- **Dropped Reason**: ${t.droppedReason}\n`;
          if (t.humanQuestion) md += `- **Human Question**: ${t.humanQuestion} (Answer: ${t.humanAnswer || 'Pending'})\n`;
          md += `\n`;
        }
      }

      md += `## 🏛️ Settled Architectural Decisions\n\n`;
      if (decisions.length === 0) {
        md += `*No decisions recorded.*\n\n`;
      } else {
        for (const d of decisions) {
          md += `### ${d.title} [${d.status.toUpperCase()}]\n`;
          md += `- **Context**: ${d.context}\n`;
          md += `- **Choice**: ${d.choice}\n`;
          md += `- **Rationale**: ${d.rationale}\n`;
          md += `- **Tags**: ${d.tags.join(', ') || 'none'}\n\n`;
        }
      }

      return md;
    }

    // Plain text format
    let txt = `MOO TASKS EXPORT (${new Date().toISOString()})\n\n`;
    txt += `=== GOALS ===\n`;
    for (const g of goals) {
      txt += `[${g.status}] ${g.title} (${g.id})\nPrompt: ${g.verbatimPrompt}\n\n`;
    }

    txt += `=== TASKS ===\n`;
    for (const t of tasks) {
      txt += `[${t.status}] ${t.title} (${t.id}) Priority: ${t.priority} Goal: ${t.goalId || 'None'}\n`;
      txt += `  Criteria: ${t.acceptanceCriteria}\n`;
      if (t.evidence) txt += `  Evidence: ${JSON.stringify(t.evidence)}\n`;
    }

    txt += `\n=== DECISIONS ===\n`;
    for (const d of decisions) {
      txt += `[${d.status}] ${d.title}: ${d.choice}\nRationale: ${d.rationale}\n\n`;
    }

    return txt;
  }
}
