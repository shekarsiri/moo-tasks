import picocolors from "picocolors";
import { createServiceContainer } from "../../services/index.js";

export async function searchCommand(
  query: string,
  options: {
    type?: "all" | "tasks" | "decisions";
    limit?: string;
    json?: boolean;
    projectPath?: string;
  }
) {
  if (!query || !query.trim()) {
    console.error(picocolors.red('Error: Search query is required. Example: moo-tasks search "authentication"'));
    process.exit(1);
  }

  const root = options.projectPath ? options.projectPath : process.cwd();
  const container = createServiceContainer({ projectPath: root });
  const results = container.searchService.search(query, {
    type: options.type || "all",
    limit: options.limit ? parseInt(options.limit, 10) : 20,
  });

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log("\n" + picocolors.bold(picocolors.green("🐮 MOO TASKS FTS5 SEARCH RESULTS")));
  console.log("  " + picocolors.gray("Query:") + "  \"" + picocolors.white(results.query) + "\"");
  console.log("  " + picocolors.gray("Matches:") + " " + picocolors.yellow(results.total.toString()) + " items found\n");

  if (results.results.length === 0) {
    console.log(picocolors.gray("  No matching tasks or decisions found."));
    console.log();
    return;
  }

  results.results.forEach((item, idx) => {
    if (item.type === "task") {
      const statusColor = item.status === "done" ? picocolors.green : item.status === "doing" ? picocolors.cyan : picocolors.yellow;
      console.log(
        "  " + (idx + 1) + ". [TASK] " +
        picocolors.cyan(item.id) + " " +
        statusColor("[" + item.status + "]") + " " +
        picocolors.bold(item.title)
      );
      if (item.snippet) {
        console.log("     " + picocolors.gray(item.snippet.slice(0, 100)));
      }
    } else {
      console.log(
        "  " + (idx + 1) + ". [ADR]  " +
        picocolors.magenta(item.id) + " " +
        picocolors.bold(item.title) + " " +
        picocolors.gray("{" + (item.tags || []).join(", ") + "}")
      );
      if (item.snippet) {
        console.log("     " + picocolors.gray(item.snippet.slice(0, 100)));
      }
    }
  });
  console.log();
}
