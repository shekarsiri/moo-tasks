/**
 * Acceptance criteria are a Markdown checklist (`- [ ] item`). Completing a task means answering
 * every item: met, or not met with a note. Unmet items are kept as deviations on the task.
 */
export interface CriterionResult {
  item: string;
  met: boolean;
  note?: string;
}

/** What an agent may send for one item; `item` is optional when answers are given in order. */
export interface CriterionInput {
  item?: string;
  met?: boolean;
  note?: string;
}

const CHECKLIST_LINE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.+?)\s*$/;

export function parseChecklist(acceptanceCriteria: string | undefined): string[] {
  if (!acceptanceCriteria) return [];
  return acceptanceCriteria
    .split('\n')
    .map((line) => line.match(CHECKLIST_LINE)?.[4])
    .filter((item): item is string => Boolean(item));
}

const normalize = (text: string) => text.toLowerCase().replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Matches answers to checklist items: by item text when given (prefix match either way, so agents
 * may abbreviate), otherwise by position. Returns the resolved results and the items left unanswered.
 */
export function resolveCriteria(
  items: string[],
  supplied: CriterionInput[] | undefined
): { results: CriterionResult[]; unanswered: string[]; unexplained: string[] } {
  const answers = Array.isArray(supplied) ? supplied.filter((a) => a && typeof a === 'object') : [];
  const used = new Set<number>();
  const results: CriterionResult[] = [];
  const unanswered: string[] = [];

  items.forEach((item, index) => {
    const key = normalize(item);
    let match = answers.findIndex((a, i) => {
      if (used.has(i) || !a.item) return false;
      const text = normalize(a.item);
      return text.length > 0 && (key.startsWith(text) || text.startsWith(key));
    });
    if (match === -1 && answers[index] && !answers[index].item && !used.has(index)) match = index;
    if (match === -1 || typeof answers[match].met !== 'boolean') {
      unanswered.push(item);
      return;
    }
    used.add(match);
    const answer = answers[match];
    results.push({ item, met: answer.met as boolean, note: answer.note?.trim() || undefined });
  });

  const unexplained = results.filter((r) => !r.met && !r.note).map((r) => r.item);
  return { results, unanswered, unexplained };
}

/** Ticks met items in the checklist text and leaves unmet ones open. */
export function tickChecklist(acceptanceCriteria: string, results: CriterionResult[]): string {
  const met = new Set(results.filter((r) => r.met).map((r) => r.item));
  return acceptanceCriteria
    .split('\n')
    .map((line) => {
      const m = line.match(CHECKLIST_LINE);
      if (!m) return line;
      return `${m[1]}${met.has(m[4]) ? 'x' : ' '}${m[3]}${m[4]}`;
    })
    .join('\n');
}

export function deviationsOf(results: CriterionResult[] | undefined): CriterionResult[] {
  return (results || []).filter((r) => !r.met);
}
