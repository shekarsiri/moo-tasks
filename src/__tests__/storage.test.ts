import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { createServiceContainer } from '../services/index.js';
import { DatabaseManager } from '../infrastructure/db/database.js';
import { DatabaseMigrator } from '../infrastructure/db/migrations.js';
import { capFileList, MAX_EVIDENCE_FILES, noteGitContext, slimStoredEvidence, summaryLine } from '../domain/evidence.js';

const dirs: string[] = [];
const tempDir = (prefix: string) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  DatabaseManager.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Lean evidence shapes', () => {
  it('caps file lists, keeps the stat summary line and strips notes to branch and commit', () => {
    const many = Array.from({ length: 526 }, (_, i) => `f${i}.ts`);
    expect(capFileList(many)).toEqual({ files: many.slice(0, MAX_EVIDENCE_FILES), total: 526 });
    expect(capFileList(['a.ts'])).toEqual({ files: ['a.ts'] });
    expect(summaryLine(' a.ts | 2 +-\n b.ts | 1 +\n 2 files changed, 2 insertions(+), 1 deletion(-)\n')).toBe(
      '2 files changed, 2 insertions(+), 1 deletion(-)'
    );
    expect(noteGitContext({ branch: 'main', commitHash: 'abc', modifiedFiles: many, diffSummary: 'x' })).toEqual({ branch: 'main', commitHash: 'abc' });
    expect(noteGitContext({})).toBeUndefined();

    const old = { filesModified: many, gitContext: { branch: 'main', modifiedFiles: many, diffSummary: ' a | 1\n 1 file changed' } };
    const slim = slimStoredEvidence(old);
    expect(slim.filesModified).toHaveLength(MAX_EVIDENCE_FILES);
    expect(slim.filesModifiedTotal).toBe(526);
    expect(slim.gitContext).toEqual({ branch: 'main', diffSummary: '1 file changed' });
    const lean = { filesModified: ['a.ts'], gitContext: { branch: 'main' } };
    expect(slimStoredEvidence(lean)).toBe(lean);
  });

  it('never stores the whole dirty tree when completing a task in a messy checkout', () => {
    const repo = tempDir('moo-dirty-');
    const sh = (cmd: string) => execSync(cmd, { cwd: repo, stdio: 'ignore' });
    sh('git init -q && git config user.email t@t && git config user.name t');
    for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(repo, `old${i}.ts`), '1\n');
    fs.writeFileSync(path.join(repo, 'mine.ts'), '1\n');
    sh('git add . && git commit -qm init');
    for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(repo, `old${i}.ts`), '2\n'); // someone else's mess

    const c = createServiceContainer({ inMemory: true, projectPath: repo });
    const t = c.taskLifecycleService.createTask({ title: 'Mine', acceptanceCriteria: 'x', workspaceId: c.activeWorkspace.id }).task;
    c.claimService.claimTask(t.id, 'agent-A', 's1');
    fs.writeFileSync(path.join(repo, 'mine.ts'), '2\n');
    const done = c.verificationService.completeTask(t.id, 'agent-A', {});

    expect(done.evidence?.filesModified).toEqual(['mine.ts']);
    expect(done.evidence?.gitContext?.modifiedFiles).toBeUndefined();
    expect(done.evidence?.gitContext?.isDirty).toBe(true);
    for (const note of c.noteRepo.listByTaskId(t.id)) {
      expect(note.gitContext?.modifiedFiles).toBeUndefined();
      expect(note.gitContext?.diffSummary).toBeUndefined();
    }
  });
});

describe('Slimming migration', () => {
  it('backs the file up, slims old rows and compacts', () => {
    const dir = tempDir('moo-migrate-');
    const dbPath = path.join(dir, 'tasks.db');
    const c = createServiceContainer({ dbPath, projectPath: '/test/migrate' });
    const t = c.taskLifecycleService.createTask({ title: 'Old', acceptanceCriteria: 'x', workspaceId: c.activeWorkspace.id }).task;
    const fatFiles = Array.from({ length: 600 }, (_, i) => `src/generated/file-${i}.ts`);
    const fatGit = { branch: 'main', commitHash: 'abc123', modifiedFiles: fatFiles, diffSummary: fatFiles.map((f) => ` ${f} | 1 +`).join('\n') + '\n 600 files changed' };
    c.db.prepare(`UPDATE tasks SET evidence = ? WHERE id = ?`).run(JSON.stringify({ filesModified: fatFiles, gitContext: fatGit }), t.id);
    c.db
      .prepare(`INSERT INTO task_notes (id, task_id, author_type, author_id, note_type, content, git_context, created_at) VALUES (?, ?, 'agent', 'a', 'general', 'x', ?, ?)`)
      .run('note-fat', t.id, JSON.stringify(fatGit), new Date().toISOString());
    // Pretend this database predates the slimming step
    c.db.prepare(`DELETE FROM schema_version WHERE version >= 9`).run();

    DatabaseMigrator.runMigrations(c.db);

    const backups = fs.readdirSync(dir).filter((f) => f.startsWith('tasks.db.backup.') && f.endsWith('-pre-v9'));
    expect(backups).toHaveLength(1);
    const evidence = JSON.parse((c.db.prepare(`SELECT evidence FROM tasks WHERE id = ?`).get(t.id) as any).evidence);
    expect(evidence.filesModified).toHaveLength(MAX_EVIDENCE_FILES);
    expect(evidence.filesModifiedTotal).toBe(600);
    expect(evidence.gitContext).toEqual({ branch: 'main', commitHash: 'abc123', diffSummary: '600 files changed' });
    const note = JSON.parse((c.db.prepare(`SELECT git_context FROM task_notes WHERE id = 'note-fat'`).get() as any).git_context);
    expect(note).toEqual({ branch: 'main', commitHash: 'abc123' });
    expect((c.db.prepare(`SELECT 1 FROM schema_version WHERE version = 9`).get() as any)).toBeTruthy();
    // The backup still holds the original data
    const Database = (c.db as any).constructor;
    const copy = new Database(path.join(dir, backups[0]), { readonly: true });
    expect(JSON.parse(copy.prepare(`SELECT git_context FROM task_notes WHERE id = 'note-fat'`).get().git_context).modifiedFiles).toHaveLength(600);
    copy.close();
  });
});
