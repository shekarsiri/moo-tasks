import { spawn } from 'child_process';
import { VerificationRun } from '../domain/types.js';

export const DEFAULT_VERIFY_TIMEOUT_SECONDS = 600;
const TAIL_LINES = 40;
const TAIL_CHARS = 4000;

/** Last lines of combined output: failures print at the end, and the head is mostly noise. */
export function outputTail(output: string, lines = TAIL_LINES, chars = TAIL_CHARS): string {
  // eslint-disable-next-line no-control-regex
  const clean = output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trimEnd();
  const tail = clean.split('\n').slice(-lines).join('\n');
  return tail.length > chars ? tail.slice(-chars) : tail;
}

/**
 * Runs the workspace verify command through the shell in the repository root. The command comes
 * from the workspace settings a human configured, never from an agent's tool arguments.
 */
export function runVerifyCommand(
  command: string,
  cwd: string,
  timeoutSeconds: number = DEFAULT_VERIFY_TIMEOUT_SECONDS
): Promise<VerificationRun> {
  const started = Date.now();
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    const child = spawn(command, {
      cwd,
      shell: true,
      // Own process group, so a timeout also stops the test runner's workers.
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: process.env.CI || '1', FORCE_COLOR: '0' },
    });
    const collect = (chunk: Buffer) => {
      output += chunk.toString('utf-8');
      // Only the tail is kept, so bound memory on very chatty commands.
      if (output.length > TAIL_CHARS * 8) output = output.slice(-TAIL_CHARS * 4);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // Already gone
      }
    }, timeoutSeconds * 1000);

    const finish = (exitCode: number | null, extra = '') => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode: timedOut ? null : exitCode,
        passed: !timedOut && exitCode === 0,
        durationMs: Date.now() - started,
        outputTail: outputTail(output + extra + (timedOut ? `\n[moo] timed out after ${timeoutSeconds}s` : '')),
        ranAt: new Date(started).toISOString(),
        timedOut: timedOut || undefined,
      });
    };
    child.on('error', (err) => finish(null, `\n[moo] could not start: ${err.message}`));
    child.on('close', (code) => finish(code));
  });
}
