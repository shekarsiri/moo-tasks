import fs from "fs";
import path from "path";
import picocolors from "picocolors";
import { createServiceContainer } from "../../services/index.js";

export async function importCommand(
  filePath: string,
  options: {
    goal?: string;
    title?: string;
    sequential?: boolean;
    projectPath?: string;
  }
) {
  if (!filePath) {
    console.error(picocolors.red("Error: File path is required. Example: moo-tasks import PLAN.md"));
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(picocolors.red("Error: File " + filePath + " not found."));
    process.exit(1);
  }

  const content = fs.readFileSync(resolvedPath, "utf-8");
  const root = options.projectPath ? options.projectPath : process.cwd();
  const container = createServiceContainer({ projectPath: root });

  const result = container.markdownImportService.importMarkdown(content, {
    goalId: options.goal,
    goalTitle: options.title,
    projectPath: root,
    sequentialPhases: Boolean(options.sequential),
    authorId: "cli-importer",
    authorType: "human",
  });

  console.log("\n" + picocolors.bold(picocolors.green("🐮 PLAN IMPORTED SUCCESSFULLY")));
  if (result.goal) {
    console.log("  " + picocolors.gray("Goal:") + "    " + picocolors.cyan(result.goal.id) + " — " + picocolors.white(result.goal.title));
  }
  console.log("  " + picocolors.gray("Tasks:") + "   " + picocolors.yellow(result.importedCount.toString()) + " tasks imported\n");

  result.tasks.forEach((t, idx) => {
    console.log("  " + (idx + 1) + ". [" + picocolors.cyan(t.id) + "] (" + picocolors.yellow(t.priority) + ") " + picocolors.white(t.title));
  });
  console.log();
}
