/**
 * What the chat assistant knows about the pull request it sits beside, read
 * from the page when each message is sent and never stored: the title and
 * description, the review threads the digest lists, and the changed files.
 */

export interface ChatFinding {
  readonly title: string;
  readonly path?: string;
  readonly line?: number;
  readonly open: boolean;
  readonly authors: readonly string[];
}

export interface ChatFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  /** The category Geld hides it under (tests, generated…), when it does. */
  readonly hidden?: string;
}

export interface PullChatContext {
  readonly url: string;
  readonly title: string;
  readonly author: string | null;
  readonly description: string;
  readonly findings: readonly ChatFinding[];
  readonly files: readonly ChatFile[];
}

const DESCRIPTION_CHARS = 6000;
const MAX_FINDINGS = 40;
const MAX_FILES = 200;

const cut = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** The assistant's instructions with the pull request laid out under them, within a fixed budget. */
export function assistantSystemPrompt(context: PullChatContext): string {
  const lines = [
    'You are the Geld review assistant, open beside a GitHub pull request the reader is reviewing.',
    'Answer what they ask about this pull request: what it changes, what could break, what the review threads want, how to word a comment.',
    'Be brief and specific. Use Markdown, with code, paths and identifiers in backticks.',
    'Say plainly when the answer is not in what you were given, rather than guessing at code you cannot see.',
    '',
    `Pull request: ${context.title}`,
    `URL: ${context.url}`,
  ];
  if (context.author !== null) lines.push(`Author: ${context.author}`);
  const description = context.description.trim();
  lines.push('', 'Description:', description === '' ? '(none)' : cut(description, DESCRIPTION_CHARS));
  if (context.findings.length > 0) {
    const open = context.findings.filter((finding) => finding.open);
    lines.push('', `Review threads (${open.length} open of ${context.findings.length}):`);
    for (const finding of [...open, ...context.findings.filter((finding) => !finding.open)].slice(0, MAX_FINDINGS)) {
      const where = finding.path === undefined ? '' : ` (${finding.path}${finding.line === undefined ? '' : `:${finding.line}`})`;
      const who = finding.authors.length === 0 ? '' : ` by ${finding.authors.join(', ')}`;
      lines.push(`- [${finding.open ? 'open' : 'resolved'}] ${cut(finding.title, 200)}${where}${who}`);
    }
    if (context.findings.length > MAX_FINDINGS) lines.push(`- …and ${context.findings.length - MAX_FINDINGS} more`);
  }
  if (context.files.length > 0) {
    lines.push('', `Changed files (${context.files.length}):`);
    for (const file of context.files.slice(0, MAX_FILES)) lines.push(`- ${file.path} +${file.additions} −${file.deletions}${file.hidden === undefined ? '' : ` (${file.hidden})`}`);
    if (context.files.length > MAX_FILES) lines.push(`- …and ${context.files.length - MAX_FILES} more`);
  }
  return lines.join('\n');
}
