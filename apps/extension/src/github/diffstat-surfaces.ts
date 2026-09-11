import type { Catalog, DiffstatSurfaceSpec, PathMatcher, RepoRule } from '@geld/core';
import { decideRepo } from '@geld/core';
import { breakdownFromFiles } from './breakdown';
import type { DiffSource } from './diff-source';
import { applyHeaderStats, statGroupFrom } from './header-stats';
import { ATTR_SURFACE } from './list-surfaces';

/**
 * Diffstats GitHub shows for *another* commit or pull request than the page's
 * own — the commit hovercard today. Which elements those are comes from the
 * catalog (`@geld/core/list-surfaces.ts`, `diffstatSurfaces`), so a markup
 * change is a catalog publish; this file only resolves a spec: find the
 * subject, request its `.diff` (cached per commit) and rewrite the `+N −M`
 * with the same code the page header uses, label and tooltip included.
 */

const ATTR_SUBJECT = 'data-geld-diffstat';

const COMMIT_PATH = /\/([^/\s]+)\/([^/\s]+)\/commit\/([0-9a-f]{7,40})(?:[/?#]|$)/i;
const PULL_PATH = /\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#]|$)/;

interface Subject {
  readonly repo: string;
  readonly diffUrl: string;
  /** Commit SHA when the subject is a commit (pins the cache); PRs are keyed by URL. */
  readonly sha: string | null;
}

function subjectFrom(value: string | null): Subject | null {
  if (value === null) return null;
  const commit = COMMIT_PATH.exec(value);
  if (commit?.[1] !== undefined && commit[2] !== undefined && commit[3] !== undefined) {
    return { repo: `${commit[1]}/${commit[2]}`, diffUrl: `${window.location.origin}/${commit[1]}/${commit[2]}/commit/${commit[3]}.diff`, sha: commit[3].toLowerCase() };
  }
  const pull = PULL_PATH.exec(value);
  if (pull?.[1] !== undefined && pull[2] !== undefined && pull[3] !== undefined) {
    return { repo: `${pull[1]}/${pull[2]}`, diffUrl: `${window.location.origin}/${pull[1]}/${pull[2]}/pull/${pull[3]}.diff`, sha: null };
  }
  return null;
}

function subjectOf(root: HTMLElement, spec: DiffstatSurfaceSpec): Subject | null {
  if ('attribute' in spec.subject) return subjectFrom(root.getAttribute(spec.subject.attribute));
  const link = root.querySelector<HTMLAnchorElement>(spec.subject.selector);
  return subjectFrom(link?.getAttribute('href') ?? null);
}

function selectorsValid(spec: DiffstatSurfaceSpec): boolean {
  const selectors = [spec.root, spec.host, spec.additions, spec.deletions, spec.srOnly ?? ':root', 'selector' in spec.subject ? spec.subject.selector : ':root'];
  for (const selector of selectors) {
    try {
      document.createDocumentFragment().querySelector(selector);
    } catch {
      console.warn(`Geld: diffstat surface "${spec.id}" has an invalid selector and is skipped: ${selector}`);
      return false;
    }
  }
  return true;
}

const validated = new WeakMap<Catalog, readonly DiffstatSurfaceSpec[]>();
function specsOf(catalog: Catalog): readonly DiffstatSurfaceSpec[] {
  let specs = validated.get(catalog);
  if (specs === undefined) {
    specs = catalog.diffstatSurfaces.filter(selectorsValid);
    validated.set(catalog, specs);
  }
  return specs;
}

export interface DiffstatSurfaceOptions {
  readonly catalog: Catalog;
  readonly matcherFor: (repo: string) => PathMatcher;
  readonly repoRules: readonly RepoRule[];
  readonly diffSource: DiffSource;
  readonly hideCommentLines: boolean;
}

/** Rewrite every catalog-described diffstat on the page whose diff is available; request the rest. */
export function applyDiffstatSurfaces(options: DiffstatSurfaceOptions): void {
  for (const spec of specsOf(options.catalog)) {
    for (const root of document.querySelectorAll<HTMLElement>(spec.root)) {
      const host = root.querySelector<HTMLElement>(spec.host);
      if (host === null) continue;
      const subject = subjectOf(root, spec);
      if (subject === null || !decideRepo(options.repoRules, subject.repo).allowed) continue;
      const state = options.diffSource.request(subject.diffUrl, subject.sha);
      if (state.status !== 'ready') continue;
      const matcher = options.matcherFor(subject.repo);
      const { hidden } = breakdownFromFiles(state.files, matcher, options.hideCommentLines);
      // Idempotent per host: the same subject with the same numbers is left alone; a re-rendered hovercard is a new host.
      const signature = `${subject.diffUrl}|${hidden.totals.files}|${hidden.totals.additions}|${hidden.totals.deletions}|${hidden.filtered.files}`;
      if (host.getAttribute(ATTR_SUBJECT) === signature) continue;
      host.setAttribute(ATTR_SUBJECT, signature);
      host.setAttribute(ATTR_SURFACE, spec.id);
      const group = statGroupFrom(
        host,
        host.querySelector<HTMLElement>(spec.additions),
        host.querySelector<HTMLElement>(spec.deletions),
        spec.srOnly === undefined ? null : host.querySelector<HTMLElement>(spec.srOnly),
      );
      applyHeaderStats(group, hidden, matcher.activeCategories);
    }
  }
}
