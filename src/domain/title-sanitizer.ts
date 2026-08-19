import { TaskPriority, TaskType } from './types.js';

export interface SanitizedTitleResult {
  cleanTitle: string;
  type?: TaskType;
  priority?: TaskPriority;
  tags: string[];
  declaredFiles: string[];
}

export class TaskTitleSanitizer {
  /**
   * Cleans a task title by removing requirement codes, sequence prefixes,
   * bracket categories, and inline metadata, extracting them into structured attributes.
   */
  static parse(
    rawTitle: string,
    defaults?: {
      type?: TaskType;
      priority?: TaskPriority;
      tags?: string[];
      declaredFiles?: string[];
    }
  ): SanitizedTitleResult {
    let title = rawTitle.trim();
    let detectedType: TaskType | undefined = defaults?.type;
    let detectedPriority: TaskPriority | undefined = defaults?.priority;
    const detectedTags: string[] = defaults?.tags ? [...defaults.tags] : [];
    const detectedFiles: string[] = defaults?.declaredFiles ? [...defaults.declaredFiles] : [];

    // 1. Extract explicit type if in brackets/parentheses e.g. (type: bug) or [type: feature]
    const typeMatch = title.match(/[\(\[]\s*type:\s*(feature|bug|refactor|test|docs|chore|spike|security)\s*[\)\]]/i);
    if (typeMatch) {
      if (!detectedType) {
        detectedType = typeMatch[1].toLowerCase() as TaskType;
      }
      title = title.replace(typeMatch[0], '').trim();
    }

    // 2. Extract priority e.g. (priority: high) or [priority: critical]
    const priorityMatch = title.match(/[\(\[]\s*priority:\s*(critical|high|medium|low)\s*[\)\]]/i);
    if (priorityMatch) {
      if (!detectedPriority) {
        detectedPriority = priorityMatch[1].toLowerCase() as TaskPriority;
      }
      title = title.replace(priorityMatch[0], '').trim();
    }

    // 3. Extract tags e.g. (tags: auth, backend) or [tags: api]
    const tagsMatch = title.match(/[\(\[]\s*tags?:\s*([^\)\]]+)\s*[\)\]]/i);
    if (tagsMatch) {
      const parsedTags = tagsMatch[1].split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      for (const tag of parsedTags) {
        if (!detectedTags.includes(tag)) {
          detectedTags.push(tag);
        }
      }
      title = title.replace(tagsMatch[0], '').trim();
    }

    // 4. Extract declared files e.g. (files: src/a.ts, src/b.ts)
    const filesMatch = title.match(/[\(\[]\s*files?:\s*([^\)\]]+)\s*[\)\]]/i);
    if (filesMatch) {
      const fileList = filesMatch[1].split(',').map((f) => f.trim().replace(/`/g, '')).filter(Boolean);
      for (const f of fileList) {
        if (!detectedFiles.includes(f)) {
          detectedFiles.push(f);
        }
      }
      title = title.replace(filesMatch[0], '').trim();
    }

    // 5. Extract inline code backticks as files if matching file patterns (e.g. `src/file.ts`)
    const codeFiles = title.match(/`([^`]+\.[a-zA-Z0-9]+)`/g);
    if (codeFiles) {
      for (const cf of codeFiles) {
        const cleanFile = cf.replace(/`/g, '');
        if (!detectedFiles.includes(cleanFile)) {
          detectedFiles.push(cleanFile);
        }
      }
    }

    // Repeatedly strip leading prefixes until stable (handles combinations like "H2 - fix(auth): ...")
    let changed = true;
    while (changed) {
      const before = title;

      // Strip requirement-code prefixes (e.g. "C1:", "H2:", "M3 —", "R1-1:", "UX-2:", "FE-01:", "BE-4:")
      title = title.replace(/^[A-Z]{1,5}-?\d+(?:[.-]\d+)?[\s:—–-]+\s*/i, '').trim();

      // Strip sequence numbers (e.g. "1.", "2)", "(3)", "1 —", "2:")
      title = title.replace(/^\(?\d+[\.\):—–-]\s*/, '').trim();

      // Infer type / priority / tags from bracket prefixes like [BUG], [FEAT], [CRITICAL]
      const bracketPrefix = title.match(/^\[([a-zA-Z0-9_\-\s]+)\]\s*/);
      if (bracketPrefix) {
        const tagContent = bracketPrefix[1].toLowerCase().trim();
        const validTypes: TaskType[] = ['feature', 'bug', 'refactor', 'test', 'docs', 'chore', 'spike', 'security'];
        const validPriorities: TaskPriority[] = ['low', 'medium', 'high', 'critical'];

        if (tagContent === 'feat' && !detectedType) detectedType = 'feature';
        else if (validTypes.includes(tagContent as TaskType) && !detectedType) detectedType = tagContent as TaskType;
        else if (validPriorities.includes(tagContent as TaskPriority) && !detectedPriority) detectedPriority = tagContent as TaskPriority;
        else if (!detectedTags.includes(tagContent) && tagContent.length > 1) detectedTags.push(tagContent);

        title = title.slice(bracketPrefix[0].length).trim();
      }

      // Detect conventional commit prefix (e.g. "feat:", "fix(auth):", "refactor:", "test:")
      const conventionalMatch = title.match(/^(feat|feature|fix|bug|refactor|test|docs|chore|spike|sec|security)(?:\(([^)]+)\))?:\s*/i);
      if (conventionalMatch) {
        const kind = conventionalMatch[1].toLowerCase();
        const scope = conventionalMatch[2]?.toLowerCase();
        if (!detectedType) {
          if (kind === 'feat' || kind === 'feature') detectedType = 'feature';
          else if (kind === 'fix' || kind === 'bug') detectedType = 'bug';
          else if (kind === 'refactor') detectedType = 'refactor';
          else if (kind === 'test') detectedType = 'test';
          else if (kind === 'docs') detectedType = 'docs';
          else if (kind === 'chore') detectedType = 'chore';
          else if (kind === 'spike') detectedType = 'spike';
          else if (kind === 'sec' || kind === 'security') detectedType = 'security';
        }
        if (scope && !detectedTags.includes(scope)) {
          detectedTags.push(scope);
        }
        title = title.slice(conventionalMatch[0].length).trim();
      }

      // Strip dangling punctuation prefixes (e.g. "- ", ": ", "— ")
      title = title.replace(/^[\s:—–-]+/, '').trim();

      changed = before !== title;
    }

    // Ensure first character is uppercase if it was lowercased by prefix removal
    if (title.length > 0) {
      title = title.charAt(0).toUpperCase() + title.slice(1);
    }

    return {
      cleanTitle: title || rawTitle.trim(),
      type: detectedType,
      priority: detectedPriority,
      tags: detectedTags,
      declaredFiles: detectedFiles,
    };
  }

  /**
   * Helper that returns just the clean title string.
   */
  static clean(rawTitle: string): string {
    return this.parse(rawTitle).cleanTitle;
  }
}
