import { Goal, Task, TaskPriority, TaskType } from "../domain/types.js";
import { TaskTitleSanitizer } from "../domain/title-sanitizer.js";
import { GoalService } from "./goal-service.js";
import { TaskLifecycleService } from "./task-lifecycle-service.js";

export interface ParsedTaskDraft {
  title: string;
  description?: string;
  type?: TaskType;
  tags?: string[];
  acceptanceCriteria: string;
  priority: TaskPriority;
  declaredFiles: string[];
  dependsOnIndex?: number[];
  phase?: string;
  isDone?: boolean;
}

export interface MarkdownImportOptions {
  goalId?: string;
  goalTitle?: string;
  projectPath?: string;
  authorId?: string;
  authorType?: "agent" | "human" | "system";
  sequentialPhases?: boolean;
}

export interface MarkdownImportResult {
  goal?: Goal;
  tasks: Task[];
  importedCount: number;
}

export class MarkdownImportService {
  constructor(
    private goalService: GoalService,
    private taskLifecycleService: TaskLifecycleService
  ) {}

  parseMarkdown(content: string): { goalTitle?: string; goalDescription?: string; tasks: ParsedTaskDraft[] } {
    const lines = content.split(/\r?\n/);
    let goalTitle: string | undefined;
    let goalDescriptionLines: string[] = [];
    let currentPhase: string | undefined;
    const taskDrafts: ParsedTaskDraft[] = [];
    let currentTask: ParsedTaskDraft | null = null;
    let currentCriteriaLines: string[] = [];
    let inHeaderSection = true;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Top level goal title (# Title)
      if (trimmed.startsWith("# ") && inHeaderSection && !goalTitle) {
        goalTitle = trimmed.replace(/^#\s+/, "").trim();
        continue;
      }

      // Section / Phase header (## Header)
      if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) {
        inHeaderSection = false;
        if (currentTask) {
          if (currentCriteriaLines.length > 0) {
            currentTask.acceptanceCriteria = currentCriteriaLines.join("\n");
          }
          taskDrafts.push(currentTask);
          currentTask = null;
          currentCriteriaLines = [];
        }
        currentPhase = trimmed.replace(/^#+\s+/, "").trim();
        continue;
      }

      // Checkbox task line: - [ ] Task title or - [x] Task title or 1. [ ] Task title
      const checkboxMatch = trimmed.match(/^[-*+]?\s*(?:\[([ xX])\]|\d+\.\s*\[([ xX])\])\s+(.+)$/);
      if (checkboxMatch) {
        inHeaderSection = false;
        if (currentTask) {
          if (currentCriteriaLines.length > 0) {
            currentTask.acceptanceCriteria = currentCriteriaLines.join("\n");
          }
          taskDrafts.push(currentTask);
          currentTask = null;
          currentCriteriaLines = [];
        }

        const isChecked = (checkboxMatch[1] || checkboxMatch[2] || "").toLowerCase() === "x";
        const rawTitle = checkboxMatch[3].trim();
        const parsed = TaskTitleSanitizer.parse(rawTitle);

        currentTask = {
          title: parsed.cleanTitle,
          type: parsed.type || "feature",
          tags: parsed.tags,
          acceptanceCriteria: "- [ ] " + parsed.cleanTitle,
          priority: parsed.priority || "medium",
          declaredFiles: parsed.declaredFiles,
          phase: currentPhase,
          isDone: isChecked,
        };
        continue;
      }

      // If we are under a current task, sub-bullets or details become acceptance criteria / description
      if (currentTask) {
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("1. ") || trimmed.startsWith("> ")) {
          currentCriteriaLines.push(trimmed);
        } else if (trimmed.length > 0) {
          currentTask.description = (currentTask.description ? currentTask.description + "\n" : "") + trimmed;
        }
      } else if (inHeaderSection && trimmed.length > 0) {
        goalDescriptionLines.push(line);
      }
    }

    if (currentTask) {
      if (currentCriteriaLines.length > 0) {
        currentTask.acceptanceCriteria = currentCriteriaLines.join("\n");
      }
      taskDrafts.push(currentTask);
    }

    return {
      goalTitle,
      goalDescription: goalDescriptionLines.length > 0 ? goalDescriptionLines.join("\n") : undefined,
      tasks: taskDrafts,
    };
  }

  importMarkdown(content: string, options: MarkdownImportOptions = {}): MarkdownImportResult {
    const parsed = this.parseMarkdown(content);
    const authorId = options.authorId || "importer";
    const authorType = options.authorType || "human";
    const projectPath = options.projectPath || process.cwd();

    let goal: Goal | undefined;

    // 1. Create or resolve Goal
    if (options.goalId) {
      goal = this.goalService.getGoal(options.goalId);
    } else if (options.goalTitle || parsed.goalTitle) {
      const title = options.goalTitle || parsed.goalTitle || "Imported Plan";
      goal = this.goalService.createGoal(
        title,
        title,
        projectPath,
        Math.max(10, parsed.tasks.length + 5),
        parsed.goalDescription || content
      );
    }

    // 2. Create tasks sequentially with optional phase-based dependency chaining
    const createdTasks: Task[] = [];
    const phaseLastTaskMap = new Map<string, string>();
    let lastPhaseName: string | undefined;

    for (let i = 0; i < parsed.tasks.length; i++) {
      const draft = parsed.tasks[i];
      const dependsOnTaskIds: string[] = [];

      // If sequentialPhases is enabled, tasks in a new phase depend on the last task of previous phase
      if (options.sequentialPhases && draft.phase && lastPhaseName && draft.phase !== lastPhaseName) {
        const prevPhaseLast = phaseLastTaskMap.get(lastPhaseName);
        if (prevPhaseLast) {
          dependsOnTaskIds.push(prevPhaseLast);
        }
      }

      const createRes = this.taskLifecycleService.createTask(
        {
          goalId: goal?.id,
          title: draft.title,
          description: draft.description,
          type: draft.type,
          tags: draft.tags,
          acceptanceCriteria: draft.acceptanceCriteria,
          priority: draft.priority,
          declaredFiles: draft.declaredFiles,
          dependsOnTaskIds: dependsOnTaskIds.length > 0 ? dependsOnTaskIds : undefined,
        },
        authorId,
        authorType
      );

      createdTasks.push(createRes.task);

      if (draft.phase) {
        phaseLastTaskMap.set(draft.phase, createRes.task.id);
        lastPhaseName = draft.phase;
      }
    }

    return {
      goal,
      tasks: createdTasks,
      importedCount: createdTasks.length,
    };
  }
}
