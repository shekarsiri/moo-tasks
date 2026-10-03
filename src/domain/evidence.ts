import { GitContext, TaskEvidence } from './types.js';

/**
 * Evidence and notes are kept for every task forever, so they store what describes the task's own
 * work, never a snapshot of the whole working tree (which once made git snapshots 18 MB of a 42 MB
 * database). Pure helpers shared by completion, claims and the slimming migration.
 */

/** Files listed per task; the total is kept when more were changed. */
export const MAX_EVIDENCE_FILES = 200;
/** Files named inline in a completion note before "+N more". */
export const MAX_NOTE_FILES = 20;

export function capFileList(files: string[] | undefined): { files?: string[]; total?: number } {
  if (!files || files.length === 0) return {};
  return files.length > MAX_EVIDENCE_FILES ? { files: files.slice(0, MAX_EVIDENCE_FILES), total: files.length } : { files };
}

export function summarizeFiles(files: string[], max: number = MAX_NOTE_FILES): string {
  return files.length > max ? `${files.slice(0, max).join(', ')} (+${files.length - max} more)` : files.join(', ');
}

/** The summary line of a `git diff --stat` block ("3 files changed, ..."); shortstat input is returned as is. */
export function summaryLine(diffSummary: string | undefined): string | undefined {
  if (!diffSummary) return undefined;
  const lines = diffSummary.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : undefined;
}

/** What a note keeps of git: where the work stood, not what was dirty. */
export function noteGitContext(ctx: GitContext | undefined): GitContext | undefined {
  if (!ctx || (!ctx.branch && !ctx.commitHash)) return undefined;
  return { branch: ctx.branch, commitHash: ctx.commitHash };
}

/** Git context for completion evidence: HEAD, subject, dirty flag and the task's own diff summary. */
export function evidenceGitContext(ctx: GitContext, ownDiffSummary?: string): GitContext {
  return {
    branch: ctx.branch,
    commitHash: ctx.commitHash,
    commitSubject: ctx.commitSubject,
    isDirty: ctx.isDirty,
    diffSummary: summaryLine(ownDiffSummary),
  };
}

/** Rewrites evidence stored by older versions into the lean shape; returns the input when unchanged. */
export function slimStoredEvidence(evidence: TaskEvidence): TaskEvidence {
  let next = evidence;
  const git = evidence.gitContext;
  if (git && (git.modifiedFiles || (git.diffSummary && git.diffSummary.includes('\n')))) {
    const { modifiedFiles: _files, ...rest } = git;
    next = { ...next, gitContext: { ...rest, diffSummary: summaryLine(rest.diffSummary) } };
  }
  if (evidence.filesModified && evidence.filesModified.length > MAX_EVIDENCE_FILES) {
    const capped = capFileList(evidence.filesModified);
    next = { ...next, filesModified: capped.files, filesModifiedTotal: capped.total };
  }
  return next;
}
