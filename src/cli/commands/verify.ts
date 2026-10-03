import picocolors from 'picocolors';
import { WorkspaceService } from '../../services/workspace-service.js';
import { openCliWorkspace } from '../workspace.js';
import { DEFAULT_VERIFY_TIMEOUT_SECONDS, runVerifyCommand } from '../../services/verify-runner.js';

/** Sets (or clears) the command Moo runs before accepting a task as done. Humans only: not exposed over MCP. */
export async function setVerifyCommand(
  command: string | undefined,
  options: { timeout?: string; clear?: boolean; projectPath?: string }
) {
  const { container, workspace: ws } = openCliWorkspace(options.projectPath);
  if (!options.clear && !command) {
    console.log(
      ws.verifyCommand
        ? `Verify command for ${picocolors.cyan(ws.name)}: ${picocolors.yellow(ws.verifyCommand)} (timeout ${ws.verifyTimeoutSeconds || DEFAULT_VERIFY_TIMEOUT_SECONDS}s)`
        : `No verify command set for ${picocolors.cyan(ws.name)}. Example: ${picocolors.yellow('moo verify:set "npm test"')}`
    );
    return;
  }
  // The verify command is the check agents must pass, so an agent must not be able to weaken it:
  // changing or clearing one needs a person at a terminal (or the board). Setting the first is fine.
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (ws.verifyCommand && !interactive) {
    console.error(
      `${picocolors.red('✖')} Changing or clearing the verify command needs an interactive terminal or the board's Workspace Settings: it is the check agents must pass.`
    );
    process.exit(1);
  }
  const timeout = options.timeout ? parseInt(options.timeout, 10) : undefined;
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
    console.error(picocolors.red('--timeout must be a positive number of seconds'));
    process.exit(1);
  }
  const updated = container.workspaceService.updateWorkspace(ws.id, {
    verifyCommand: options.clear ? '' : command,
    verifyTimeoutSeconds: options.clear ? 0 : timeout,
  });
  console.log(
    updated.verifyCommand
      ? `${picocolors.green('✔')} Tasks in ${picocolors.cyan(ws.name)} now complete only after ${picocolors.yellow(updated.verifyCommand)} passes.`
      : `${picocolors.green('✔')} Verify command cleared for ${picocolors.cyan(ws.name)}.`
  );
}

/** Runs the workspace verify command now, the same way task completion does. */
export async function runVerify(options: { projectPath?: string; json?: boolean }) {
  const { container, workspace: ws } = openCliWorkspace(options.projectPath);
  if (!ws.verifyCommand) {
    console.log(`No verify command set. Set one with ${picocolors.yellow('moo verify:set "npm test"')}.`);
    process.exit(1);
  }
  const run = await runVerifyCommand(ws.verifyCommand, WorkspaceService.checkoutPathFor(container.location, ws), ws.verifyTimeoutSeconds);
  if (options.json) {
    console.log(JSON.stringify(run, null, 2));
  } else {
    console.log(run.outputTail);
    const status = run.passed ? picocolors.green('passed') : picocolors.red(run.timedOut ? 'timed out' : `failed (exit ${run.exitCode})`);
    console.log(`\n${picocolors.bold(ws.verifyCommand)} ${status} in ${(run.durationMs / 1000).toFixed(1)}s`);
  }
  process.exit(run.passed ? 0 : 1);
}
