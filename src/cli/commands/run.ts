import picocolors from "picocolors";
import { createServiceContainer } from "../../services/index.js";

export async function runCommand(
  prompt: string,
  options: {
    title?: string;
    priority?: string;
    agent?: string;
    files?: string;
    projectPath?: string;
  }
) {
  if (!prompt || !prompt.trim()) {
    console.error(picocolors.red("Error: Prompt string is required. Example: moo-tasks run \"Build auth API\""));
    process.exit(1);
  }

  const root = options.projectPath ? options.projectPath : process.cwd();
  const container = createServiceContainer({ projectPath: root });
  const agentId = options.agent || "cli-agent";
  const title = options.title || (prompt.length > 50 ? prompt.slice(0, 47) + "..." : prompt);
  const declaredFiles = options.files ? options.files.split(",").map((f) => f.trim()) : [];

  // 1. Create overarching Goal
  const goal = container.goalService.createGoal(
    title,
    prompt,
    root,
    10
  );

  // 2. Atomically create & claim initial task
  const created = container.taskLifecycleService.createTask(
    {
      goalId: goal.id,
      title: title,
      priority: (options.priority as any) || "high",
      acceptanceCriteria: "Execute prompt: " + prompt,
      declaredFiles,
    },
    agentId,
    "agent"
  );

  const claim = container.claimService.claimTask(created.task.id, agentId, "cli-sess-" + Date.now(), {
    declaredFiles,
  });

  // 3. Generate compact context
  const context = container.sessionService.getCompactContext(root, agentId);

  console.log("\n" + picocolors.bold(picocolors.green("🐮 MOO TASKS PRE-EXECUTION READY")));
  console.log("  " + picocolors.gray("Goal:") + "    " + picocolors.cyan(goal.id) + " — " + picocolors.white(goal.title));
  console.log("  " + picocolors.gray("Task:") + "    " + picocolors.cyan(claim.task.id) + " (" + picocolors.yellow(claim.task.priority) + ")");
  console.log("  " + picocolors.gray("Claimed:") + " " + picocolors.magenta(agentId));
  console.log("\n" + picocolors.gray("--- Compact Context Injected ---") + "\n");
  console.log(context);
}
