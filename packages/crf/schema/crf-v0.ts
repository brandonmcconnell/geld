/**
 * Common Review Format (CRF) v0
 *
 * One block per comment a review bot posts on a pull request, hidden in the comment's raw Markdown as
 *   <!-- crf:v0 {JSON} -->
 * with `<` and `>` inside the JSON written as \u003c and \u003e.
 *
 * Fields marked `?` are optional. Readers ignore fields they do not know.
 */

/** Every block. `kind` says what the comment is. */
export type CrfBlock = SummaryBlock | StatusBlock | RefusalBlock | FindingBlock | ReplyBlock;

interface BlockBase {
  schema: 'crf/v0';
  bot: Bot;
  links?: Links;
}

/** The run's report: verdict, score, findings. `result` is expected once `run.state` is "completed". */
export interface SummaryBlock extends BlockBase {
  kind: 'summary';
  run: Run;
  result?: Result;
}

/** A progress note: "Reviewing…", "Processing new changes". */
export interface StatusBlock extends BlockBase {
  kind: 'status';
  run: Run;
}

/** The bot declining to run: disabled, out of quota, no access. */
export interface RefusalBlock extends BlockBase {
  kind: 'refusal';
  run: Run;
  refusal: Refusal;
}

/** A review thread comment on a line of code. Same `Finding` as in the summary, linked by `finding.id`. */
export interface FindingBlock extends BlockBase {
  kind: 'finding';
  run: { id: string };
  finding: Finding;
}

/** Conversation. Makes no claim about the review. */
export interface ReplyBlock extends BlockBase {
  kind: 'reply';
  run?: { id: string };
}

export interface Bot {
  /** The product's name: "Greptile", "Bugbot". */
  name: string;
  /** The GitHub App's slug. */
  app?: string;
  version?: string;
}

export interface Run {
  /** Stable for the run, the same on every comment the run posts. */
  id: string;
  /** "superseded": a newer commit made this run's result stale. */
  state: 'queued' | 'running' | 'completed' | 'superseded' | 'refused' | 'failed' | 'cancelled';
  /** The commit that was reviewed, all 40 hex characters. */
  headSha: string;
  /** Goes up each time the comment is edited in place. */
  sequence?: number;
  track?: 'code' | 'security';
  baseSha?: string;
  /** "incremental": only what changed since the bot's last run. */
  scope?: 'full' | 'incremental';
  /** The commits an incremental run covered. */
  coverage?: { from?: string; to: string };
  /** For a review published across several comments. */
  part?: { index: number; total: number };
  /** ISO 8601 date-time. */
  startedAt?: string;
  completedAt?: string;
  trigger?: Trigger;
}

export interface Trigger {
  type: 'push' | 'comment' | 'check' | 'schedule' | 'manual' | 'api';
  /** The comment that asked for the run. */
  commentId?: number;
  /** The login that asked. */
  by?: string;
}

export interface Result {
  verdict: 'clean' | 'findings';
  /** "Confidence 4/5" is { value: 4, max: 5 }. */
  score?: { value: number; max: number };
  /** A merge-risk label, separate from the findings. */
  risk?: 'minimal' | 'low' | 'moderate' | 'high';
  /** Stays right when `findings` is cut short. */
  counts?: { critical?: number; high?: number; medium?: number; low?: number; info?: number };
  findings?: Finding[];
  /** `findings` lists only some of them. */
  truncated?: boolean;
  /** Findings from the previous run now fixed. */
  resolvedSinceLast?: number;
  /** Findings an earlier run should have raised. */
  previouslyMissed?: number;
  /** Whether the bot is holding the merge, and from which severity. */
  gate?: { blocking: boolean; threshold?: Severity };
  /** What the bot would submit as a GitHub review. */
  recommendation?: 'approve' | 'comment' | 'request_changes';
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  /** The same in the summary and on the thread comment. */
  id: string;
  /** One line, inline Markdown allowed. */
  title: string;
  /** The shared scale. The bot's own label goes in `vendorSeverity`. */
  severity: Severity;
  /** Stable across runs, so a repeat finding is recognised. */
  fingerprint?: string;
  /** The line or range the thread is anchored to. */
  location?: Location;
  /** Other places the finding involves. */
  related?: Location[];
  /** "bug", "security", "performance", "style", "test", "docs"… */
  category?: string;
  /** The bot's own label: "P1", "Major". */
  vendorSeverity?: string;
  /** 0 to 1. */
  confidence?: number;
  /** Compared with the bot's previous run. Resolving a thread is GitHub's, not the bot's. */
  state?: 'new' | 'persisting' | 'fixed' | 'withdrawn';
  /** Whether the finding came from the repository's own rules. */
  rule?: Rule;
  /** The thread comment's id. */
  commentId?: number;
  links?: { view?: UrlAction; fix?: Action };
}

export interface Location {
  path: string;
  /** No `line` means a file-level comment. */
  line?: number;
  startLine?: number;
  side?: 'LEFT' | 'RIGHT';
}

export interface Rule {
  source: 'repo' | 'bot';
  id?: string;
  path?: string;
}

export interface Refusal {
  code: 'disabled' | 'not_installed' | 'quota' | 'billing' | 'permissions' | 'too_large' | 'skipped_by_config' | 'other';
  /** The bot's own words. */
  message: string;
  /** Whether asking again could work without changing anything. */
  retryable?: boolean;
}

/** What a reader can do: open a URL, or post a comment. */
export type Action = UrlAction | CommentAction;

export interface UrlAction {
  type: 'url';
  url: string;
  label?: string;
}

export interface CommentAction {
  type: 'comment';
  body: string;
  label?: string;
}

export interface Links {
  /** The run on the bot's own site. */
  view?: UrlAction;
  /** A trigger comment, or a URL that reruns directly or leads to a button that does. */
  rerun?: Action;
  /** "Fix in Cursor", an autofix command. */
  fix?: Action;
  /** Where the bot's setup is fixed: what a refusal points to. */
  settings?: UrlAction;
}
