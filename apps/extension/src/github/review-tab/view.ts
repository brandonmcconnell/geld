/**
 * The Review view: a stepper on the left, the current step on the right.
 * Pure rendering from a model into a root element; the handlers are the
 * caller's. GitHub's rendered diffs are *moved* into the step (`teleport.ts`),
 * never copied, so commenting, suggestions and Viewed keep working; rows of
 * hunks that belong to other steps fold with a note (`hunk-rows.ts`).
 */

import type { ChangeTotals, FileHunks, HiddenCategory } from '@geld/core';
import { formatCount, pluralize } from '@geld/core';
import type { ReviewPlan, ReviewProgress, ReviewStep, StepDisplayState } from '@geld/review';
import { finishBody, nextPendingStep, reviewComplete, STEP_KIND_LABELS, stepDisplayState, touchesSummary } from '@geld/review';
import type { StoredStory } from '../../lib/local-state';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import type { CategoryTotals, HiddenBreakdown, StatsBreakdown } from '../breakdown';
import { EMPTY_BREAKDOWN, hiddenLabel, hiddenNounPlural, statsBreakdown } from '../breakdown';
import type { DiffEntry, DiffView } from '../model';
import { inlineText } from '../review/inline-text';
import { teleportInto } from '../review/teleport';
import { attachBreakdownTooltip } from '../ui/tooltip';
import { ICON_ALERT, ICON_ARROW_LEFT, ICON_ARROW_RIGHT, ICON_CHECK_CIRCLE_FILL, ICON_CHEVRON_DOWN, ICON_CHEVRON_LEFT, ICON_CHEVRON_RIGHT, ICON_CIRCLE, ICON_DOT_CIRCLE, ICON_FLAG, ICON_INFO, ICON_KEBAB_HORIZONTAL, ICON_SPARKLE_FILL } from '../ui/icons';
import { foldOtherHunks } from './hunk-rows';

export const ROOT_CLASS = 'geld-review-tab';
const C = (suffix: string): string => `${ROOT_CLASS}__${suffix}`;
/** On a loaned file's own sticky header (GitHub's `.file-header`, the React view's equivalent), so the stylesheet can keep it under the sticky bar and square its corners. */
export const ATTR_FILE_HEADER = 'data-geld-file-header';

export type InputPhase = { readonly kind: 'loading'; readonly reason: string | null } | { readonly kind: 'failed'; readonly reason: string } | { readonly kind: 'ready' };

export interface ReviewTabModel {
  readonly plan: ReviewPlan | null;
  readonly progress: ReviewProgress | null;
  /** The step shown in the main column (null before a plan, or at the finish). */
  readonly current: ReviewStep | null;
  readonly input: InputPhase;
  /** The store has answered (a plan may still be null while the diff loads). */
  readonly loaded: boolean;
  readonly planning: boolean;
  readonly behind: { readonly newHunks: number; readonly goneHunks: number } | null;
  readonly error: string | null;
  /** The planning model when AI can be asked, else null. */
  readonly aiModel: string | null;
  readonly storiesInFlight: ReadonlySet<string>;
  readonly story: StoredStory | null;
  /** Show the finish (every step marked, or the reader asked for it). */
  readonly finish: boolean;
  /** GitHub's experimental virtualised files view, which the tab cannot borrow from yet. */
  readonly virtualized: boolean;
  readonly view: DiffView | null;
  /**
   * GitHub's rendered files by path: the view's entries plus the ones on
   * loan to the previous build, which the adapters no longer see at home.
   * Read from this, never from `view.entries` alone, or a loaned file reads
   * as missing on the next pass and the view flips between the two.
   */
  readonly entries: ReadonlyMap<string, DiffEntry>;
  readonly hunksByPath: ReadonlyMap<string, FileHunks>;
  /** Which Geld category hides a path, for the supporting sections and the step's counts. */
  readonly categoryOf: (path: string) => HiddenCategory | null;
  /** The categories in force on this repository, for the counts' label ("2 tests" vs "3 hidden files"). */
  readonly activeCategories: readonly HiddenCategory[];
  /** Supporting sections (by category id) the reader collapsed this visit; every section starts open. */
  readonly collapsedSections: ReadonlySet<string>;
  /** GitHub's own sticky bar from the files layout (the classic `.pr-toolbar`), to borrow across the top of the view. */
  readonly toolbar: HTMLElement | null;
  readonly flagOpen: boolean;
  readonly flagDraft: string;
  readonly helpOpen: boolean;
  readonly shownRuns: Set<string>;
}

export interface ReviewTabHandlers {
  readonly selectStep: (id: string) => void;
  readonly accept: (step: ReviewStep) => void;
  readonly flag: (step: ReviewStep, note: string) => void;
  readonly unmark: (step: ReviewStep) => void;
  readonly openFlag: (open: boolean) => void;
  readonly flagDraft: (text: string) => void;
  readonly toggleSection: (categoryId: string) => void;
  readonly planWithAi: (replan: boolean) => void;
  readonly regroup: () => void;
  readonly resetProgress: () => void;
  readonly openFinish: (open: boolean) => void;
  readonly submitReview: (event: 'approve' | 'comment' | 'reject') => void;
  readonly markAllViewed: () => void;
  readonly toggleHelp: () => void;
  readonly goToFiles: () => void;
  readonly wantFile: (path: string) => void;
  /** A file was moved into the step: remembered so the next pass still knows it. */
  readonly loaned: (path: string, entry: DiffEntry) => void;
}

const STATE_ICON: Readonly<Record<StepDisplayState, string>> = {
  pending: ICON_CIRCLE,
  accepted: ICON_CHECK_CIRCLE_FILL,
  flagged: ICON_FLAG,
  changed: ICON_DOT_CIRCLE,
};

const STATE_WORD: Readonly<Record<StepDisplayState, string>> = {
  pending: 'Not reviewed yet',
  accepted: 'Accepted',
  flagged: 'Flagged',
  changed: 'Changed since you accepted it',
};

function button(label: string, className: string, onClick: () => void, icon?: string): HTMLButtonElement {
  const node = createElement('button', { type: 'button', class: className }, icon === undefined ? [label] : [svgFromString(icon), label]);
  node.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });
  return node;
}

function doneCount(plan: ReviewPlan, progress: ReviewProgress | null): number {
  return plan.steps.filter((step) => {
    const state = stepDisplayState(step, progress);
    return state === 'accepted' || state === 'flagged';
  }).length;
}

/** "3/12": steps marked over steps total, for the tab's counter. */
export function counterFor(plan: ReviewPlan | null, progress: ReviewProgress | null): string | null {
  return plan === null || plan.steps.length === 0 ? null : `${doneCount(plan, progress)}/${plan.steps.length}`;
}

/* ------------------------------------------------------------------------- */
/* Build                                                                      */
/* ------------------------------------------------------------------------- */

export function renderReviewTab(model: ReviewTabModel, handlers: ReviewTabHandlers): HTMLElement {
  const root = createElement('div', { class: ROOT_CLASS, [OWN_UI_ATTRIBUTE]: '', role: 'region', 'aria-label': 'Review in steps' });
  if (model.toolbar !== null) {
    // GitHub's sticky bar (the pull request's title, "Changes from all commits", the file filter, Review changes)
    // across the top, as on Files changed: the same node, so every control in it is GitHub's. The sentinel above
    // it tells when it is stuck (`watchBar`), which GitHub's own layout did for it at home.
    const bar = createElement('div', { class: C('bar') });
    teleportInto(bar, [model.toolbar]);
    // The current step's line and title, shown once the step's own head has scrolled under the bar: in the bar's
    // own controls row, after "Changes from all commits" and the filters (the classic toolbar), else as a second
    // row under the bar. Inside GitHub's node, so it is marked as Geld's and taken out before the node goes home.
    const step = model.finish ? null : model.current;
    const index = step === null || model.plan === null ? -1 : model.plan.steps.findIndex((candidate) => candidate.id === step.id);
    if (step !== null && model.plan !== null && index >= 0) {
      const host = stripHostOf(model.toolbar);
      if (host !== null) {
        host.append(createElement('span', { class: C('bar-inline'), [OWN_UI_ATTRIBUTE]: '', 'aria-hidden': 'true' }, [stepEyebrow(model, model.plan, step, index, stepDisplayState(step, model.progress)), createElement('span', { class: C('bar-inline-title') }, inlineText(step.title))]));
      } else {
        // One grid child, so `grid-template-rows: 0fr` closes the whole strip (a second child would be an implicit row).
        const inner = createElement('div', { class: C('bar-step-inner') }, [stepEyebrow(model, model.plan, step, index, stepDisplayState(step, model.progress)), createElement('p', { class: C('bar-step-title') }, inlineText(step.title))]);
        bar.append(createElement('div', { class: C('bar-step'), 'aria-hidden': 'true' }, [inner]));
        root.setAttribute('data-strip-row', '');
      }
    }
    root.append(createElement('div', { class: C('bar-sentinel'), 'aria-hidden': 'true' }), bar);
  }
  root.append(renderStepper(model, handlers), renderMain(model, handlers));
  if (model.helpOpen) root.append(renderHelp(handlers));
  return root;
}

/**
 * The toolbar's controls row ("Changes from all commits", the file filter,
 * Conversations, the gear), found by the commit-range menu it holds: the
 * step's line sits after them while the bar is stuck. Null where the bar has
 * no such row (the React files view), and the strip is a row of its own.
 */
function stripHostOf(toolbar: HTMLElement): HTMLElement | null {
  const range = toolbar.querySelector<HTMLElement>('.diffbar-range-menu, [class*="range-menu"], details.diffbar-item');
  const row = range?.parentElement ?? null;
  return row !== null && row.children.length >= 2 ? row : null;
}

/* ---- stepper ---------------------------------------------------------------- */

/**
 * A small info mark whose words show beside it while the pointer rests on
 * it (or it has focus) and go the moment it leaves: a stylesheet tooltip
 * (`::after` reads `data-tip`), nothing the pointer can wander onto.
 */
function infoMark(words: string): HTMLElement {
  return createElement('span', { class: C('info'), tabindex: '0', role: 'img', 'aria-label': words, 'data-tip': words }, [svgFromString(ICON_INFO)]);
}

/** What the stepper's info mark says about how the steps came to be. */
function howPlanned(model: ReviewTabModel): string {
  if (model.plan?.producer === 'ai') return `Steps planned by ${model.plan.model ?? 'the AI model'}: grouped by purpose, ordered so each step reads with what came before it.${model.plan.fromHeaders ? ' Planned from hunk headers only: this pull request is too large to send in full.' : ''}`;
  return model.aiModel === null
    ? 'Steps grouped by commit, shared symbols and file names. With an AI model set up in Geld’s options, Geld plans the steps by purpose and explains each one.'
    : 'Steps grouped by commit, shared symbols and file names. Plan with AI (below the steps) asks the model to group them by purpose and explain each one.';
}

function renderStepper(model: ReviewTabModel, handlers: ReviewTabHandlers): HTMLElement {
  const aside = createElement('aside', { class: C('steps'), 'aria-label': 'Steps' });
  const head = createElement('header', { class: C('steps-head') });
  const title = createElement('span', { class: C('brand') }, ['Review']);
  head.append(title, infoMark(howPlanned(model)));
  if (model.plan !== null && model.plan.steps.length > 0) {
    const done = doneCount(model.plan, model.progress);
    const meter = createElement('span', { class: C('meter'), role: 'img', 'aria-label': `${done} of ${model.plan.steps.length} steps reviewed` }, [createElement('span', { class: C('meter-fill'), style: `width:${Math.round((done / model.plan.steps.length) * 100)}%` })]);
    head.append(meter, createElement('span', { class: C('count') }, [`${done}/${model.plan.steps.length}`]));
  }
  head.append(renderMenu(model, handlers));
  aside.append(head);

  if (model.plan !== null) {
    const list = createElement('ol', { class: C('list') });
    model.plan.steps.forEach((step, index) => {
      const state = stepDisplayState(step, model.progress);
      const isCurrent = model.current?.id === step.id && !model.finish;
      const item = createElement('li', { class: C('item'), 'data-state': state });
      if (isCurrent) item.setAttribute('aria-current', 'step');
      const glyph = createElement('span', { class: C('item-glyph'), 'data-state': state, title: STATE_WORD[state] }, [svgFromString(STATE_ICON[state])]);
      const number = createElement('span', { class: C('item-number') }, [String(index + 1)]);
      const label = createElement('span', { class: C('item-title') }, inlineText(step.title));
      const files = new Set(step.touches.map((ref) => ref.path)).size;
      const metaParts: string[] = [STEP_KIND_LABELS[step.kind]];
      if (files > 0) metaParts.push(pluralize(files, 'file', 'files'));
      if (step.findings.length > 0) metaParts.push(pluralize(step.findings.length, 'finding', 'findings'));
      const meta = createElement('span', { class: C('item-meta') }, [metaParts.join(' · ')]);
      const control = createElement('button', { type: 'button', class: C('item-button'), 'aria-label': `Step ${index + 1}: ${step.title}, ${STATE_WORD[state]}` }, [glyph, number, createElement('span', { class: C('item-words') }, [label, meta])]);
      control.addEventListener('click', () => handlers.selectStep(step.id));
      item.append(control);
      list.append(item);
    });
    aside.append(list);
    if (reviewComplete(model.plan, model.progress) || model.finish) {
      const finish = button(model.finish ? 'Back to the steps' : 'Finish the review', `${C('finish-link')}`, () => handlers.openFinish(!model.finish), model.finish ? ICON_ARROW_LEFT : ICON_ARROW_RIGHT);
      finish.setAttribute('aria-pressed', String(model.finish));
      aside.append(finish);
    }
  }
  aside.append(renderStepperFoot(model, handlers));
  return aside;
}

function renderMenu(model: ReviewTabModel, handlers: ReviewTabHandlers): HTMLElement {
  const details = createElement('details', { class: `details-reset details-overlay ${C('menu')}` });
  const summary = createElement('summary', { class: C('menu-summary'), 'aria-label': 'Review options', title: 'Review options' }, [svgFromString(ICON_KEBAB_HORIZONTAL)]);
  const list = createElement('div', { class: C('menu-list'), role: 'menu' });
  const item = (label: string, onClick: () => void, disabled = false): void => {
    const node = createElement('button', { type: 'button', class: C('menu-item'), role: 'menuitem' }, [label]);
    node.disabled = disabled;
    node.addEventListener('click', () => {
      details.removeAttribute('open');
      onClick();
    });
    list.append(node);
  };
  item('Plan again from scratch', () => handlers.planWithAi(false), model.aiModel === null || model.planning);
  item('Regroup by commit and file', () => handlers.regroup(), model.plan?.producer === 'rules' && model.behind === null);
  item('Reset progress', () => handlers.resetProgress(), model.progress === null || Object.keys(model.progress.steps).length === 0);
  item('Keyboard shortcuts', () => handlers.toggleHelp());
  item('Open Files changed', () => handlers.goToFiles());
  details.append(summary, list);
  return details;
}

function notice(text: readonly (string | Node)[], tone: 'muted' | 'warn' | 'bad' = 'muted'): HTMLElement {
  return createElement('p', { class: C('notice'), 'data-tone': tone }, [...text]);
}

function renderStepperFoot(model: ReviewTabModel, handlers: ReviewTabHandlers): HTMLElement {
  const foot = createElement('footer', { class: C('steps-foot') });
  if (model.planning) {
    foot.append(notice([createElement('span', { 'data-pending': '' }, [`Planning with ${model.aiModel ?? 'the model'}…`])]));
    return foot;
  }
  if (model.error !== null) {
    foot.append(notice([model.error, ' ', button('Try again', C('link-button'), () => handlers.planWithAi(model.behind !== null))], 'bad'));
  }
  if (model.plan === null) return foot;
  if (model.behind !== null) {
    const words = model.behind.newHunks === 0 ? 'The diff changed since this plan.' : `${pluralize(model.behind.newHunks, 'new hunk', 'new hunks')} since this plan, listed under Everything else.`;
    foot.append(notice([words, ' ', model.aiModel === null ? button('Regroup', C('link-button'), () => handlers.regroup()) : button('Replan', C('link-button'), () => handlers.planWithAi(true), ICON_SPARKLE_FILL)], 'warn'));
  }
  // How the steps came to be is the info mark's; the footer keeps only what the reader can act on.
  if (model.plan.producer === 'rules' && model.aiModel !== null) {
    foot.append(notice([button('Plan with AI', C('link-button'), () => handlers.planWithAi(false), ICON_SPARKLE_FILL), ' to group the steps by purpose and explain each one.']));
  }
  return foot;
}

/* ---- main ------------------------------------------------------------------ */

function renderMain(model: ReviewTabModel, handlers: ReviewTabHandlers): HTMLElement {
  const main = createElement('section', { class: C('main') });
  if (model.virtualized) {
    main.append(renderEmpty('GitHub’s experimental large pull request view is on', 'The Review tab borrows GitHub’s rendered diffs, and that view only mounts the files on screen. Turn off the experimental mode in Files changed to review in steps.', handlers));
    return main;
  }
  if (model.input.kind === 'failed') {
    main.append(renderEmpty('The diff could not be read', `GitHub answered “${model.input.reason}”. Reload the page to try again, or review in Files changed.`, handlers));
    return main;
  }
  if (model.plan === null) {
    const waiting = model.input.kind === 'loading' ? (model.input.reason === 'queued' || model.input.reason === 'busy' ? 'Waiting for GitHub’s diff…' : 'Reading the diff…') : 'Planning…';
    main.append(renderEmpty(waiting, 'The steps appear here once the diff has been read.', handlers, true));
    return main;
  }
  if (model.plan.steps.length === 0) {
    main.append(renderEmpty('Nothing to review', 'This pull request changes no files.', handlers));
    return main;
  }
  if (model.finish) {
    main.append(renderFinish(model, handlers));
    return main;
  }
  const step = model.current ?? model.plan.steps[0];
  if (step === undefined) return main;
  main.append(renderStep(model, step, handlers));
  return main;
}

function renderEmpty(title: string, words: string, handlers: ReviewTabHandlers, pending = false): HTMLElement {
  const box = createElement('div', { class: C('empty') });
  box.append(createElement('h2', { class: C('empty-title'), ...(pending ? { 'data-pending': '' } : {}) }, [title]), createElement('p', { class: C('empty-words') }, [words]));
  box.append(button('Open Files changed', 'btn btn-sm', () => handlers.goToFiles()));
  return box;
}

function renderStep(model: ReviewTabModel, step: ReviewStep, handlers: ReviewTabHandlers): HTMLElement {
  const plan = model.plan;
  if (plan === null) return createElement('div');
  const index = plan.steps.findIndex((candidate) => candidate.id === step.id);
  const state = stepDisplayState(step, model.progress);
  const article = createElement('article', { class: C('step'), 'data-state': state, 'aria-labelledby': 'geld-review-step-title' });

  /* Head: position, kind, title, story, the step's own counts at the right. */
  const head = createElement('header', { class: C('step-head') });
  const eyebrow = stepEyebrow(model, plan, step, index, state);
  const title = createElement('h2', { class: C('step-title'), id: 'geld-review-step-title' }, inlineText(step.title));
  head.append(eyebrow, title, renderStory(model, step));
  const touches = touchesSummary(step);
  if (touches.length > 0) {
    const line = createElement('p', { class: C('touches') }, ['Touches: ']);
    touches.forEach((entry, position) => {
      if (position > 0) line.append(', ');
      const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
      const link = createElement('a', { href: `#review-file-${position}`, class: C('touch'), title: entry.path }, [createElement('code', {}, [name]), ` (${entry.hunks})`]);
      link.addEventListener('click', (event) => {
        event.preventDefault();
        article.querySelector<HTMLElement>(`[data-geld-review-file="${CSS.escape(entry.path)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      line.append(link);
    });
    head.append(line);
  }
  if (step.dependsOn.length > 0) {
    const names = step.dependsOn.map((id) => plan.steps.findIndex((candidate) => candidate.id === id)).filter((position) => position >= 0).map((position) => `step ${position + 1}`);
    if (names.length > 0) head.append(createElement('p', { class: C('depends') }, [`Reads after ${names.join(' and ')}.`]));
  }
  article.append(head);

  /* Files: GitHub's diffs on loan, the step's own first, then one section per category of supporting change. */
  const files = createElement('div', { class: C('files') });
  const paths = [...new Set(step.touches.map((ref) => ref.path))];
  for (const path of paths) files.append(renderFile(model, plan, step, path, 'touches', handlers));
  article.append(files);
  for (const section of supportingSections(model, step)) {
    const collapsed = model.collapsedSections.has(section.id);
    const box = createElement('section', { class: C('supporting'), 'data-category': section.id, 'aria-label': section.heading });
    if (collapsed) box.setAttribute('data-collapsed', '');
    const toggle = createElement('button', { type: 'button', class: C('supporting-summary'), 'aria-expanded': String(!collapsed) }, [svgFromString(ICON_CHEVRON_DOWN), section.heading]);
    toggle.addEventListener('click', () => handlers.toggleSection(section.id));
    box.append(toggle);
    if (!collapsed) {
      const list = createElement('div', { class: C('files') });
      for (const path of section.paths) list.append(renderFile(model, plan, step, path, 'supporting', handlers));
      box.append(list);
    }
    article.append(box);
  }

  /* The foot sticks to the viewport's bottom while the step scrolls: where in the steps (previous · number · next), then flag and accept. */
  const foot = createElement('footer', { class: C('foot') });
  const actions = createElement('div', { class: C('actions') });
  actions.append(renderPager(plan, index, handlers));
  const decide = createElement('div', { class: C('actions-decide') });
  if (state === 'accepted' || state === 'flagged') {
    decide.append(button(state === 'accepted' ? 'Undo accept' : 'Unflag', 'btn btn-sm', () => handlers.unmark(step)));
  } else {
    decide.append(button(model.flagOpen ? 'Cancel' : 'Flag with a note', 'btn btn-sm', () => handlers.openFlag(!model.flagOpen), model.flagOpen ? undefined : ICON_FLAG));
  }
  const after = nextPendingStep(plan, model.progress, step.id);
  const acceptLabel = state === 'accepted' ? (after === null ? 'Finish' : 'Next') : after === null || after.id === step.id ? 'Accept and finish' : 'Accept and next';
  const accept = button(acceptLabel, 'btn btn-sm btn-primary', () => {
    if (state === 'accepted') {
      if (after === null) handlers.openFinish(true);
      else handlers.selectStep(after.id);
    } else handlers.accept(step);
  }, ICON_ARROW_RIGHT);
  decide.append(accept);
  actions.append(decide);
  foot.append(actions);
  if (model.flagOpen && state !== 'accepted' && state !== 'flagged') {
    const form = createElement('div', { class: C('flag') });
    const area = createElement('textarea', { class: `form-control ${C('flag-note')}`, rows: '3', placeholder: 'What should the author look at? (kept here until you finish; offered into the review body then)', 'aria-label': 'Flag note' });
    area.value = model.flagDraft;
    area.addEventListener('input', () => handlers.flagDraft(area.value));
    area.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        handlers.flag(step, area.value);
      }
    });
    form.append(area, createElement('div', { class: C('flag-actions') }, [button('Flag and next', 'btn btn-sm btn-danger', () => handlers.flag(step, area.value), ICON_FLAG)]));
    foot.append(form);
    requestAnimationFrame(() => area.focus({ preventScroll: true }));
  }
  article.append(foot);
  return article;
}

/** Added and removed lines over a set of hunk refs (a whole-file ref counts nothing: a binary, a rename). */
function linesOf(model: ReviewTabModel, refs: readonly { readonly path: string; readonly hunk: number }[]): ChangeTotals {
  let additions = 0;
  let deletions = 0;
  for (const ref of refs) {
    const hunk = model.hunksByPath.get(ref.path)?.hunks[ref.hunk];
    if (hunk === undefined) continue;
    additions += hunk.added.length;
    deletions += hunk.removed.length;
  }
  return { files: new Set(refs.map((ref) => ref.path)).size, additions, deletions };
}

/**
 * The step's numbers as the page header shows the pull request's: the
 * step's own `+A −D`, and when it carries supporting changes a label
 * ("2 tests", "3 hidden files") that opens the same breakdown box the header
 * does, one row per category. The supporting hunks are counted per hunk, so
 * a test file split across steps counts only the hunks that are here.
 */
function stepStats(model: ReviewTabModel, step: ReviewStep): { readonly own: ChangeTotals; readonly breakdown: StatsBreakdown; readonly hidden: HiddenBreakdown } {
  const own = linesOf(model, step.touches);
  const byCategory = new Map<string, { readonly category: HiddenCategory; readonly refs: typeof step.supporting }>();
  for (const ref of step.supporting) {
    const category = model.categoryOf(ref.path);
    if (category === null) continue;
    const entry = byCategory.get(category.id) ?? { category, refs: [] };
    byCategory.set(category.id, { category, refs: [...entry.refs, ref] });
  }
  const categories: CategoryTotals[] = [...byCategory.values()].map(({ category, refs }) => ({ category, totals: linesOf(model, refs), paths: [...new Set(refs.map((ref) => ref.path))] }));
  const supporting = linesOf(model, step.supporting);
  const hidden: HiddenBreakdown = step.supporting.length === 0 ? EMPTY_BREAKDOWN : { ...EMPTY_BREAKDOWN, totals: supporting, categories };
  const all: ChangeTotals = { files: own.files + supporting.files, additions: own.additions + supporting.additions, deletions: own.deletions + supporting.deletions };
  return { own, hidden, breakdown: statsBreakdown(all, hidden, hiddenNounPlural(model.activeCategories, hidden), model.activeCategories) };
}

/** "+385 −14" and, with supporting changes, the "2 tests" label that opens the breakdown on hover. */
function countsInline(model: ReviewTabModel, step: ReviewStep): readonly Node[] {
  const { own, hidden, breakdown } = stepStats(model, step);
  const nodes: Node[] = [];
  if (hidden.totals.files > 0) {
    const label = createElement('span', { class: C('counts-label') }, [hiddenLabel(hidden, model.activeCategories)]);
    attachBreakdownTooltip(label, label, () => breakdown);
    nodes.push(label);
  }
  nodes.push(createElement('span', { class: C('counts-add') }, [`+${formatCount(own.additions)}`]), createElement('span', { class: C('counts-del') }, [`\u2212${formatCount(own.deletions)}`]));
  return [createElement('span', { class: C('counts'), role: 'group', 'aria-label': `${own.additions} additions and ${own.deletions} deletions in this step${hidden.totals.files > 0 ? `, ${hidden.totals.files} supporting ${hidden.totals.files === 1 ? 'file' : 'files'}` : ''}` }, nodes)];
}

/** "Step 1 of 10 · Other · +385 −14 · 2 tests", the step's state when it has one; the same line heads the step and the sticky strip. */
function stepEyebrow(model: ReviewTabModel, plan: ReviewPlan, step: ReviewStep, index: number, state: StepDisplayState): HTMLElement {
  const eyebrow = createElement('p', { class: C('eyebrow') }, [createElement('span', {}, [`Step ${index + 1} of ${plan.steps.length}`]), createElement('span', { class: C('kind') }, [STEP_KIND_LABELS[step.kind]]), ...countsInline(model, step)]);
  if (state !== 'pending') eyebrow.append(createElement('span', { class: C('state-word'), 'data-state': state }, [svgFromString(STATE_ICON[state]), STATE_WORD[state]]));
  return eyebrow;
}

interface SupportingSection {
  readonly id: string;
  readonly heading: string;
  readonly paths: readonly string[];
}

/**
 * The step's supporting changes by the Geld category that hides them, each a
 * section of its own ("2 test files", "1 generated file"), open by default:
 * nothing is hidden from the reader, it is only told apart from the step's
 * own work and can be folded.
 */
function supportingSections(model: ReviewTabModel, step: ReviewStep): readonly SupportingSection[] {
  const byCategory = new Map<string, { readonly title: string; readonly paths: string[] }>();
  for (const path of new Set(step.supporting.map((ref) => ref.path))) {
    const category = model.categoryOf(path);
    const id = category?.id ?? 'other';
    const entry = byCategory.get(id) ?? { title: category?.title ?? 'Supporting', paths: [] };
    entry.paths.push(path);
    byCategory.set(id, entry);
  }
  return [...byCategory].map(([id, entry]) => {
    const noun = SECTION_NOUNS[id] ?? [`${entry.title.toLowerCase()} file`, `${entry.title.toLowerCase()} files`];
    return { id, heading: pluralize(entry.paths.length, noun[0], noun[1]), paths: entry.paths };
  });
}

/** How a section counts its files, by category id; the category's title otherwise. */
const SECTION_NOUNS: Readonly<Record<string, readonly [string, string]>> = {
  tests: ['test file', 'test files'],
  generated: ['generated file', 'generated files'],
  vendored: ['vendored file', 'vendored files'],
  docs: ['documentation file', 'documentation files'],
  tooling: ['tooling file', 'tooling files'],
  agents: ['agent config file', 'agent config files'],
  stories: ['story or fixture file', 'story and fixture files'],
  trivial: ['trivial change', 'trivial changes'],
  other: ['supporting file', 'supporting files'],
};

/**
 * Previous · the step's number over the total · next, the same width on
 * every step so nothing shifts: the arrows stay and disable at the ends, and
 * the number is a field a power user can type into (Enter or blur goes
 * there, Escape puts the number back).
 */
function renderPager(plan: ReviewPlan, index: number, handlers: ReviewTabHandlers): HTMLElement {
  const pager = createElement('nav', { class: C('pager'), 'aria-label': 'Steps' });
  const previous = plan.steps[index - 1];
  const next = plan.steps[index + 1];
  const arrow = (icon: string, label: string, target: ReviewStep | undefined): HTMLButtonElement => {
    const node = createElement('button', { type: 'button', class: `btn btn-sm ${C('pager-arrow')}`, 'aria-label': label }, [svgFromString(icon)]);
    if (target === undefined) node.disabled = true;
    else node.addEventListener('click', () => handlers.selectStep(target.id));
    return node;
  };
  const field = createElement('input', { type: 'text', inputmode: 'numeric', class: C('pager-field'), 'aria-label': `Step number, ${index + 1} of ${plan.steps.length}`, autocomplete: 'off', spellcheck: 'false' });
  field.value = String(index + 1);
  field.style.width = `${Math.max(1, String(plan.steps.length).length)}ch`;
  const go = (): void => {
    const wanted = Number.parseInt(field.value, 10);
    const target = Number.isInteger(wanted) ? plan.steps[Math.min(plan.steps.length, Math.max(1, wanted)) - 1] : undefined;
    if (target === undefined || target.id === plan.steps[index]?.id) field.value = String(index + 1);
    else handlers.selectStep(target.id);
  };
  field.addEventListener('focus', () => field.select());
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      go();
      field.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      field.value = String(index + 1);
      field.blur();
    }
    event.stopPropagation();
  });
  field.addEventListener('blur', go);
  const total = createElement('span', { class: C('pager-total') }, [`/ ${plan.steps.length}`]);
  pager.append(arrow(ICON_CHEVRON_LEFT, 'Previous step', previous), createElement('span', { class: C('pager-number') }, [field, total]), arrow(ICON_CHEVRON_RIGHT, 'Next step', next));
  return pager;
}

/**
 * The file's own sticky header (GitHub's `.file-header`, or whatever the React
 * view makes sticky near the top of the entry), marked so the stylesheet can
 * keep it under the sticky bar and square its corners while stuck. A few
 * computed-style reads per loaned file, once the build is in the document
 * (a detached node has no computed position).
 */
export function markStickyHeaders(root: HTMLElement): void {
  const queue: Array<{ readonly node: HTMLElement; readonly depth: number }> = [{ node: root, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (current.node !== root && getComputedStyle(current.node).position === 'sticky') {
      current.node.setAttribute(ATTR_FILE_HEADER, '');
      continue;
    }
    if (current.depth >= 4) continue;
    for (const child of current.node.children) if (child instanceof HTMLElement && !(child instanceof HTMLTableElement)) queue.push({ node: child, depth: current.depth + 1 });
  }
}

function renderStory(model: ReviewTabModel, step: ReviewStep): HTMLElement {
  const box = createElement('div', { class: C('story') });
  const story = model.story;
  if (story !== null) {
    box.append(createElement('p', { class: C('story-text') }, inlineText(story.story)));
    if (story.why !== null) box.append(createElement('p', { class: C('story-why') }, inlineText(story.why)));
    const watch = story.watch.length > 0 ? story.watch : step.watch;
    if (watch.length > 0) box.append(renderWatch(watch));
    box.append(createElement('p', { class: C('story-by') }, [svgFromString(ICON_SPARKLE_FILL), ` ${story.model}`]));
    return box;
  }
  if (model.storiesInFlight.has(step.id)) {
    box.append(createElement('p', { class: C('story-text'), 'data-pending': '' }, [step.gist ?? 'Writing what this step does…']));
    return box;
  }
  if (step.gist !== null) box.append(createElement('p', { class: C('story-text') }, inlineText(step.gist)));
  if (step.watch.length > 0) box.append(renderWatch(step.watch));
  return box;
}

function renderWatch(items: readonly string[]): HTMLElement {
  const list = createElement('ul', { class: C('watch') });
  for (const item of items) list.append(createElement('li', {}, [svgFromString(ICON_ALERT), createElement('span', {}, inlineText(item))]));
  return createElement('div', { class: C('watch-box') }, [createElement('p', { class: C('watch-label') }, ['Worth checking']), list]);
}

function renderFile(model: ReviewTabModel, plan: ReviewPlan, step: ReviewStep, path: string, role: 'touches' | 'supporting', handlers: ReviewTabHandlers): HTMLElement {
  const slot = createElement('div', { class: C('file'), 'data-geld-review-file': path, 'data-role': role });
  const entry = model.entries.get(path);
  if (entry === undefined) {
    handlers.wantFile(path);
    const name = path.slice(path.lastIndexOf('/') + 1);
    const placeholder = createElement('div', { class: C('file-pending') }, [createElement('span', { 'data-pending': '' }, [`Loading ${name}…`]), createElement('span', { class: C('file-path') }, [path])]);
    slot.append(placeholder);
    return slot;
  }
  mountEntry(slot, entry, model, plan, step, path, role);
  handlers.loaned(path, entry);
  return slot;
}

/** Move GitHub's rendered diff into the slot and fold the hunks other steps own. */
function mountEntry(slot: HTMLElement, entry: DiffEntry, model: ReviewTabModel, plan: ReviewPlan, step: ReviewStep, path: string, role: 'touches' | 'supporting'): void {
  teleportInto(slot, [entry.root]);
  const file = model.hunksByPath.get(path);
  if (file === undefined || entry.anchor === null || file.hunks.length === 0) return;
  const refs = role === 'touches' ? step.touches : step.supporting;
  const keep = new Set(refs.filter((ref) => ref.path === path).map((ref) => ref.hunk));
  if (keep.size >= file.hunks.length) return;
  foldOtherHunks(entry.root, {
    anchor: entry.anchor,
    hunks: file.hunks,
    keep,
    stepOf: (hunk) => {
      const index = plan.steps.findIndex((candidate) => [...candidate.touches, ...candidate.supporting].some((ref) => ref.path === path && ref.hunk === hunk));
      const owner = plan.steps[index];
      return owner === undefined ? null : { index, title: owner.title };
    },
    shownRuns: model.shownRuns,
  });
}

/* ---- finish ---------------------------------------------------------------- */

function renderFinish(model: ReviewTabModel, handlers: ReviewTabHandlers): HTMLElement {
  const plan = model.plan;
  if (plan === null) return createElement('div');
  const article = createElement('article', { class: C('finish') });
  const flagged = plan.steps.filter((step) => model.progress?.steps[step.id]?.state === 'flagged');
  const accepted = plan.steps.filter((step) => stepDisplayState(step, model.progress) === 'accepted').length;
  const left = plan.steps.length - accepted - flagged.length;
  article.append(createElement('p', { class: C('eyebrow') }, ['Finish']), createElement('h2', { class: C('step-title') }, [left === 0 ? 'Every step reviewed' : `${pluralize(left, 'step', 'steps')} still to review`]));
  const summary = createElement('p', { class: C('finish-summary') }, [`${pluralize(accepted, 'step', 'steps')} accepted, ${flagged.length} flagged.`]);
  article.append(summary);
  if (flagged.length > 0) {
    const list = createElement('ul', { class: C('flagged') });
    for (const step of flagged) {
      const note = model.progress?.steps[step.id]?.note ?? '';
      const item = createElement('li', {}, [svgFromString(ICON_FLAG), createElement('strong', {}, inlineText(step.title))]);
      if (note !== '') item.append(createElement('span', { class: C('flagged-note') }, [note]));
      const open = button('Open', C('link-button'), () => handlers.selectStep(step.id));
      item.append(open);
      list.append(item);
    }
    article.append(list);
  }
  const body = createElement('details', { class: C('body-preview') });
  body.append(createElement('summary', {}, ['The review body Geld prefills']), createElement('pre', { class: C('body-text') }, [finishBody(plan, model.progress)]));
  article.append(body);
  const actions = createElement('div', { class: C('finish-actions') });
  actions.append(button('Mark all files as viewed', 'btn btn-sm', () => handlers.markAllViewed()));
  actions.append(button('Approve', 'btn btn-sm btn-primary', () => handlers.submitReview('approve')));
  actions.append(button('Comment', 'btn btn-sm', () => handlers.submitReview('comment')));
  actions.append(button('Request changes', 'btn btn-sm btn-danger', () => handlers.submitReview('reject')));
  article.append(actions);
  article.append(createElement('p', { class: C('finish-note') }, ['Each opens GitHub’s own Review changes form with the body filled in. Nothing is posted until you submit it there.']));
  return article;
}

/* ---- help ------------------------------------------------------------------ */

function renderHelp(handlers: ReviewTabHandlers): HTMLElement {
  const box = createElement('div', { class: C('help'), role: 'dialog', 'aria-label': 'Keyboard shortcuts' });
  const rows: ReadonlyArray<readonly [string, string]> = [
    [']', 'Next step'],
    ['[', 'Previous step'],
    ['j', 'Next file in the step'],
    ['k', 'Previous file in the step'],
    ['a', 'Accept and next'],
    ['f', 'Flag with a note'],
    ['?', 'This list'],
  ];
  const list = createElement('dl', { class: C('help-list') });
  for (const [key, words] of rows) list.append(createElement('dt', {}, [createElement('kbd', {}, [key])]), createElement('dd', {}, [words]));
  box.append(createElement('h3', {}, ['Keyboard shortcuts']), list, button('Close', 'btn btn-sm', () => handlers.toggleHelp()));
  return box;
}