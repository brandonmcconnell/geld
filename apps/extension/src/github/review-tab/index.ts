/**
 * The Review tab on a pull request's files page (`#review`). GitHub's
 * files view stays mounted underneath - it is what the steps borrow their
 * diffs from and what the finish submits through - but out of sight: its
 * layout becomes a fixed, invisible band behind the page (`data-geld-review-
 * area`), so its lazy loaders still see a viewport while the Review view
 * stands in its place. Every pass re-reads the plan, the progress and the
 * page and rebuilds the view when something it shows has changed; GitHub's
 * loaned nodes go home before each rebuild (`restoreAll`) and on teardown.
 */

import type { GeldSettings, HiddenCategory } from '@geld/core';
import type { FileHunks } from '@geld/core';
import type { ReviewStep } from '@geld/review';
import { finishBody, nextPendingStep, reviewComplete, stepDisplayState } from '@geld/review';
import type { StoredStory } from '../../lib/local-state';
import { queryAll } from '../dom';
import type { DiffEntry, DiffView } from '../model';
import type { PageInfo } from '../page';
import { REVIEW_TAB_HASH } from '../page';
import { restoreAll, teleportedNodes } from '../review/teleport';
import { activateControl, findViewedControls } from '../whitespace-viewed';
import { clearFoldedHunks } from './hunk-rows';
import { diffHunksFor, dropOtherPages, planInputFor, pullPathOf } from './inputs';
import { closePlanner, dropPlan, markStep, openPlanner, planWithAi, plannerState, resetReview, reviewModelFor, setCurrentStep, storyFor, unmarkStep } from './planner';
import { reviewKey } from './store';
import { ensureReviewTabLink, filesTabLink, interceptFilesTab, removeReviewTabLink, reviewTabUrl } from './tab';
import type { InputPhase, ReviewTabHandlers, ReviewTabModel } from './view';
import { counterFor, renderReviewTab, ROOT_CLASS } from './view';

export const ATTR_REVIEW_AREA = 'data-geld-review-area';
const ATTR_PAGE = 'data-geld-review-tab';
const SEEK_VAR = '--geld-review-seek';
const SEEK_MAX_ATTEMPTS = 60;
const SEEK_PASS_MS = 300;

export interface ReviewTabContext {
  readonly settings: GeldSettings;
  readonly page: PageInfo;
  readonly url: URL;
  readonly view: DiffView | null;
  readonly headSha: string | null;
  readonly classify: (path: string) => HiddenCategory | null;
  readonly commitFiles: (sha: string) => readonly string[] | null;
  /** Ask for another pass soon. */
  readonly reapply: () => void;
}

interface Visit {
  readonly stateKey: string;
  readonly key: string;
  root: HTMLElement | null;
  area: HTMLElement | null;
  signature: string;
  readonly shownRuns: Set<string>;
  supportingOpen: boolean;
  flagOpen: boolean;
  flagDraft: string;
  finishOpen: boolean;
  helpOpen: boolean;
  /** The file being brought on screen in the hidden band, and how far the band has been moved. */
  seek: { path: string; offset: number; attempts: number } | null;
  seekTimer: ReturnType<typeof setTimeout> | null;
  wanted: Set<string>;
  /** Files moved into the view, by path: the adapters read GitHub's container and no longer see them there. */
  readonly loaned: Map<string, DiffEntry>;
  unbindKeys: (() => void) | null;
  unbindFilesTab: (() => void) | null;
  /** The step the reader opened last, so a rebuild for a story landing does not scroll. */
  scrollToStep: string | null;
  /** A handler changed what the view shows: the next pass rebuilds even with a field focused inside the view. */
  rebuildAsked: boolean;
  settings: GeldSettings;
}

let visit: Visit | null = null;
let lastContext: ReviewTabContext | null = null;

/** Steps marked over total for the tab's counter, from the planner (null before it has loaded). */
function tabCounter(): string | null {
  const state = plannerState(null);
  return counterFor(state.plan, state.progress);
}

/* ------------------------------------------------------------------------- */
/* The tab link, on every pull request page                                   */
/* ------------------------------------------------------------------------- */

/** Switch between Files changed and Review in place: the path is the same, only the fragment changes. */
function switchView(toReview: boolean, reapply: () => void): void {
  const files = filesTabLink();
  const url = files === null ? new URL(location.href) : reviewTabUrl(files.href);
  url.hash = toReview ? REVIEW_TAB_HASH : '';
  const target = `${url.pathname}${url.search}${url.hash}`;
  if (target !== `${location.pathname}${location.search}${location.hash}`) history.pushState(history.state, '', target);
  reapply();
}

/** Keep the Review tab in the pull request's tab bar (every PR page), current when the Review view is up. */
export function applyReviewTabLink(page: PageInfo, settings: GeldSettings, reapply: () => void): void {
  if (!settings.reviewTab || !page.kind.startsWith('pull')) {
    removeReviewTabLink();
    return;
  }
  const onFilesPage = page.kind === 'pull-files' || page.kind === 'pull-review';
  ensureReviewTabLink({ active: page.kind === 'pull-review', counter: page.kind === 'pull-review' ? tabCounter() : null, onSwitch: onFilesPage ? (toReview) => switchView(toReview, reapply) : null });
}

/* ------------------------------------------------------------------------- */
/* The view                                                                   */
/* ------------------------------------------------------------------------- */

/** Where GitHub's files layout starts: the highest ancestor of the diff container that does not hold the tab bar. */
function filesAreaOf(view: DiffView): HTMLElement | null {
  const nav = filesTabLink();
  if (nav === null) return null;
  let node: HTMLElement = view.container;
  while (node.parentElement !== null && node.parentElement !== document.body && !node.parentElement.contains(nav) && node.parentElement.querySelector(`.${ROOT_CLASS}`) === null) node = node.parentElement;
  return node === view.container && node.parentElement?.contains(nav) !== true ? null : node;
}

export function applyReviewTab(context: ReviewTabContext): void {
  lastContext = context;
  const { page, settings } = context;
  if (page.kind !== 'pull-review' || !settings.reviewTab) {
    teardownReviewTab();
    return;
  }
  const key = reviewKey(page.stateKey);
  if (visit === null || visit.stateKey !== page.stateKey) {
    teardownReviewTab();
    visit = { stateKey: page.stateKey, key, root: null, area: null, signature: '', shownRuns: new Set(), supportingOpen: false, flagOpen: false, flagDraft: '', finishOpen: false, helpOpen: false, seek: null, seekTimer: null, wanted: new Set(), loaned: new Map(), unbindKeys: null, unbindFilesTab: null, scrollToStep: null, rebuildAsked: false, settings };
    openPlanner(key, () => context.reapply());
    if (page.diffUrl !== null) dropOtherPages(page.diffUrl);
  }
  const current = visit;
  current.settings = settings;
  if (!document.documentElement.hasAttribute(ATTR_PAGE)) document.documentElement.setAttribute(ATTR_PAGE, '');
  current.unbindFilesTab ??= interceptFilesTab((toReview) => switchView(toReview, context.reapply));
  current.unbindKeys ??= bindKeys();

  const headSha = context.headSha;
  const pullPath = pullPathOf(context.url);
  let inputPhase: InputPhase = { kind: 'loading', reason: null };
  let hunksByPath = new Map<string, FileHunks>();
  let state = plannerState(null);
  if (page.diffUrl !== null && headSha !== null && pullPath !== null) {
    const input = planInputFor({ diffUrl: page.diffUrl, headSha, pullPath, classify: context.classify, commitFiles: context.commitFiles, onChange: context.reapply });
    if (input.status === 'failed') inputPhase = { kind: 'failed', reason: input.reason };
    else if (input.status === 'ready') {
      inputPhase = { kind: 'ready' };
      // Commit file lists still arriving: the rules producer plans once they have (a plan from the store shows meanwhile).
      state = plannerState(input.commitsPending && plannerState(null).plan === null ? null : input.input);
      hunksByPath = new Map(diffHunksFor(page.diffUrl, headSha, context.reapply).files.map((file) => [file.path, file] as const));
    }
  }

  const view = context.view;
  const entries = entriesOf(current, view);
  // The files layout, out of sight and out of the way (but laid out, for its lazy loaders).
  if (view !== null) {
    const area = filesAreaOf(view);
    if (area !== null && current.area !== area) {
      current.area?.removeAttribute(ATTR_REVIEW_AREA);
      current.area = area;
    }
    if (current.area !== null && !current.area.hasAttribute(ATTR_REVIEW_AREA)) current.area.setAttribute(ATTR_REVIEW_AREA, '');
  }

  const plan = state.plan;
  const progress = state.progress;
  const finishable = plan !== null && reviewComplete(plan, progress);
  const finish = plan !== null && (current.finishOpen || (finishable && progress?.current === null));
  const currentStep = plan === null ? null : (plan.steps.find((step) => step.id === progress?.current) ?? nextPendingStep(plan, progress) ?? plan.steps[0] ?? null);
  const aiModel = reviewModelFor(settings);
  let story: StoredStory | null = null;
  // Stories are written for a plan the reader asked the model for; the rules' free grouping shows its own words,
  // and the footer offers the model. Nothing is spent that nobody asked for.
  if (currentStep !== null && aiModel !== null && !finish && plan?.producer === 'ai') {
    const index = plan?.steps.findIndex((step) => step.id === currentStep.id) ?? -1;
    story = storyFor(settings, currentStep, plan?.steps[index + 1] ?? null);
  }

  const model: ReviewTabModel = {
    plan,
    progress,
    current: currentStep,
    input: inputPhase,
    loaded: state.loaded,
    planning: state.planning,
    behind: state.behind,
    error: state.error,
    aiModel,
    storiesInFlight: state.storiesInFlight,
    story,
    finish,
    virtualized: view?.virtualized === true,
    view,
    entries,
    hunksByPath,
    supportingOpen: current.supportingOpen,
    flagOpen: current.flagOpen,
    flagDraft: current.flagDraft,
    helpOpen: current.helpOpen,
    shownRuns: current.shownRuns,
    reviewForm: finish ? legacyReviewForm(current.area) : null,
  };
  current.wanted.clear();
  const handlers = makeHandlers(context, current);
  mount(current, model, handlers, view);
  seekWanted(current, view, context.reapply);
}

/** GitHub's files by path: what the adapters see at home plus what is on loan to the current build. */
function entriesOf(current: Visit, view: DiffView | null): Map<string, DiffEntry> {
  const entries = new Map<string, DiffEntry>();
  for (const [path, entry] of current.loaned) {
    if (entry.root.isConnected && current.root?.contains(entry.root) === true) entries.set(path, entry);
    else current.loaned.delete(path);
  }
  for (const entry of view?.entries ?? []) entries.set(entry.path, entry);
  return entries;
}

/** What the view shows, as a string: a rebuild happens only when it changes. */
function signatureOf(model: ReviewTabModel): string {
  const steps = model.plan === null ? '' : model.plan.steps.map((step) => `${step.id}:${stepDisplayState(step, model.progress)}`).join(',');
  const entries = [...model.entries.keys()].sort().join('|');
  const story = model.story === null ? '' : `${model.story.at}:${model.story.story.length}`;
  return [
    model.plan?.id ?? '',
    model.plan?.madeAt ?? '',
    steps,
    model.current?.id ?? '',
    model.input.kind,
    model.input.kind === 'loading' ? (model.input.reason ?? '') : '',
    model.loaded ? 1 : 0,
    model.planning ? 1 : 0,
    model.behind === null ? '' : `${model.behind.newHunks}/${model.behind.goneHunks}`,
    model.error ?? '',
    model.aiModel ?? '',
    [...model.storiesInFlight].join(','),
    story,
    model.finish ? 1 : 0,
    model.virtualized ? 1 : 0,
    entries,
    model.hunksByPath.size,
    model.supportingOpen ? 1 : 0,
    model.flagOpen ? 1 : 0,
    model.helpOpen ? 1 : 0,
    model.reviewForm === null ? 0 : 1,
  ].join('\u0000');
}

function mount(current: Visit, model: ReviewTabModel, handlers: ReviewTabHandlers, view: DiffView | null): void {
  const signature = signatureOf(model);
  const root = current.root;
  if (root !== null && root.isConnected && signature === current.signature) {
    current.rebuildAsked = false;
    return;
  }
  // Typing in a GitHub form inside a loaned diff (a comment), or in the flag note: a rebuild for something that
  // landed meanwhile (a story, a file) would move the field mid-typing. A click on the view's own controls still
  // rebuilds at once (`rebuildAsked`), since the reader asked for what the rebuild shows.
  const active = document.activeElement;
  const typing = active !== null && root?.contains(active) === true && (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement || (active instanceof HTMLElement && active.isContentEditable));
  if (typing && !current.rebuildAsked) return;
  current.rebuildAsked = false;
  if (typing && active instanceof HTMLElement) active.blur();
  for (const node of teleportedNodes()) clearFoldedHunks(node);
  restoreAll();
  const next = renderReviewTab(model, handlers);
  const anchor = current.area ?? view?.container ?? null;
  // One mutation when the root already stands where it belongs; otherwise it moves to just before the files area.
  if (root !== null && root.isConnected && (anchor === null || root.nextElementSibling === anchor)) root.replaceWith(next);
  else if (anchor !== null) {
    anchor.insertAdjacentElement('beforebegin', next);
    root?.remove();
  } else {
    // No files view yet (it is still streaming in): stand where it will be, under the tab bar.
    const nav = filesTabLink()?.closest('nav') ?? null;
    const header = nav?.closest<HTMLElement>('[class*="header"], .gh-header, [data-component="PageHeader"]') ?? nav;
    if (header === null) return;
    header.insertAdjacentElement('afterend', next);
  }
  current.root = next;
  current.signature = signature;
  if (current.scrollToStep !== null && current.scrollToStep === model.current?.id) {
    current.scrollToStep = null;
    const top = next.getBoundingClientRect().top;
    if (top < 0 || top > 120) next.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
}

function makeHandlers(context: ReviewTabContext, current: Visit): ReviewTabHandlers {
  // Every handler but the typing ones asks for a rebuild the focus hold must not stop.
  const reapply = (): void => {
    current.rebuildAsked = true;
    context.reapply();
  };
  const open = (id: string): void => {
    current.flagOpen = false;
    current.flagDraft = '';
    current.supportingOpen = false;
    current.finishOpen = false;
    current.scrollToStep = id;
    setCurrentStep(id);
    reapply();
  };
  const moveOn = (from: ReviewStep): void => {
    const state = plannerState(null);
    if (state.plan === null) return;
    const next = nextPendingStep(state.plan, state.progress, from.id);
    if (next === null) {
      current.finishOpen = true;
      current.flagOpen = false;
      current.flagDraft = '';
      setCurrentStep(null);
      reapply();
    } else open(next.id);
  };
  return {
    selectStep: open,
    accept: (step) => {
      markStep(step, 'accepted');
      markViewedIfWhole(current, context, step);
      moveOn(step);
    },
    flag: (step, note) => {
      markStep(step, 'flagged', note);
      current.flagOpen = false;
      current.flagDraft = '';
      moveOn(step);
    },
    unmark: (step) => {
      unmarkStep(step);
      current.finishOpen = false;
      context.reapply();
    },
    openFlag: (openIt) => {
      current.flagOpen = openIt;
      context.reapply();
    },
    flagDraft: (text) => {
      current.flagDraft = text;
    },
    toggleSupporting: () => {
      current.supportingOpen = !current.supportingOpen;
      context.reapply();
    },
    planWithAi: (replan) => void planWithAi(context.settings, replan),
    regroup: () => {
      void dropPlan().then(() => context.reapply());
    },
    resetProgress: () => {
      void resetReview().then(() => context.reapply());
    },
    openFinish: (openIt) => {
      current.finishOpen = openIt;
      if (openIt) setCurrentStep(null);
      else {
        const state = plannerState(null);
        const next = state.plan === null ? null : (nextPendingStep(state.plan, state.progress) ?? state.plan.steps[0] ?? null);
        if (next !== null) setCurrentStep(next.id);
      }
      context.reapply();
    },
    submitReview: (event) => {
      const state = plannerState(null);
      if (state.plan === null) return;
      void openGitHubReview(current, event, finishBody(state.plan, state.progress));
    },
    markAllViewed: () => {
      for (const entry of entriesOf(current, context.view).values()) for (const control of findViewedControls(entry.root).unviewed) activateControl(control);
      context.reapply();
    },
    toggleHelp: () => {
      current.helpOpen = !current.helpOpen;
      context.reapply();
    },
    goToFiles: () => switchView(false, context.reapply),
    wantFile: (path) => current.wanted.add(path),
    loaned: (path, entry) => current.loaned.set(path, entry),
  };
}

/** Accepting a step marks each of its files viewed once every hunk of that file sits in an accepted step. */
function markViewedIfWhole(current: Visit, context: ReviewTabContext, step: ReviewStep): void {
  const state = plannerState(null);
  if (state.plan === null) return;
  const entries = entriesOf(current, context.view);
  const progress = state.progress;
  const accepted = new Set(state.plan.steps.filter((candidate) => candidate.id === step.id || progress?.steps[candidate.id]?.state === 'accepted').map((candidate) => candidate.id));
  for (const path of new Set([...step.touches, ...step.supporting].map((ref) => ref.path))) {
    const owners = state.plan.steps.filter((candidate) => [...candidate.touches, ...candidate.supporting].some((ref) => ref.path === path));
    if (!owners.every((owner) => accepted.has(owner.id))) continue;
    const entry = entries.get(path);
    if (entry === undefined) continue;
    for (const control of findViewedControls(entry.root).unviewed) activateControl(control);
  }
}

/* ------------------------------------------------------------------------- */
/* Bringing files on screen in the hidden band                                */
/* ------------------------------------------------------------------------- */

/**
 * A file the step needs that GitHub has not rendered: both experiences
 * render diffs as they come into view, so the hidden band is moved up
 * (`--geld-review-seek`) a viewport at a time until the file mounts, then
 * put back. The band is fixed and invisible, so the reader sees nothing of
 * it; a timer asks for the next pass, since nothing else would.
 */
function seekWanted(current: Visit, view: DiffView | null, reapply: () => void): void {
  const area = current.area;
  const known = entriesOf(current, view);
  const wanted = [...current.wanted].find((path) => !known.has(path)) ?? null;
  if (area === null || view === null || wanted === null) {
    if (current.seek !== null) {
      current.seek = null;
      area?.style.removeProperty(SEEK_VAR);
    }
    return;
  }
  let seek = current.seek;
  if (seek === null || seek.path !== wanted) {
    seek = { path: wanted, offset: 0, attempts: 0 };
    current.seek = seek;
    // A known tree position gives a first guess: the file's share of the tree as a share of the band.
    const index = view.treeFiles.findIndex((file) => file.path === wanted);
    if (index > 0 && view.treeFiles.length > 1) seek.offset = Math.max(0, Math.round((area.scrollHeight * index) / view.treeFiles.length) - window.innerHeight / 2);
  } else {
    seek.attempts += 1;
    seek.offset += Math.round(window.innerHeight * 0.8);
    if (seek.offset > area.scrollHeight) seek.offset = 0;
  }
  if (seek.attempts > SEEK_MAX_ATTEMPTS) {
    area.style.removeProperty(SEEK_VAR);
    return;
  }
  area.style.setProperty(SEEK_VAR, `${-seek.offset}px`);
  if (current.seekTimer !== null) clearTimeout(current.seekTimer);
  current.seekTimer = setTimeout(() => {
    current.seekTimer = null;
    reapply();
  }, SEEK_PASS_MS);
}

/* ------------------------------------------------------------------------- */
/* The finish: GitHub's own review form                                       */
/* ------------------------------------------------------------------------- */

/** The classic files page's "Review changes" container, to borrow into the finish; the React page renders its form in a portal instead. */
function legacyReviewForm(area: HTMLElement | null): HTMLElement | null {
  const container = (area ?? document).querySelector<HTMLElement>('.js-reviews-container');
  return container;
}

function setFieldValue(field: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  // React keeps its own notion of the value; the prototype setter plus an input event is how a user's typing reaches it.
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter !== undefined) setter.call(field, value);
  else field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

const EVENT_WORDS: Readonly<Record<'approve' | 'comment' | 'reject', RegExp>> = { approve: /^approve/i, comment: /^comment/i, reject: /^request changes/i };

async function openGitHubReview(current: Visit, event: 'approve' | 'comment' | 'reject', body: string): Promise<void> {
  const root = current.root;
  // Classic: the borrowed container holds a <details> with the form; open it and fill it.
  const legacy = root?.querySelector<HTMLElement>('.js-reviews-container') ?? null;
  if (legacy !== null) {
    const details = legacy.querySelector<HTMLDetailsElement>('details');
    if (details !== null) details.open = true;
    const textarea = legacy.querySelector<HTMLTextAreaElement>('textarea');
    const radio = legacy.querySelector<HTMLInputElement>(`input[type="radio"][value="${event}"]`);
    if (textarea !== null && radio !== null) {
      if (textarea.value.trim() === '') setFieldValue(textarea, body);
      radio.click();
      textarea.focus({ preventScroll: true });
      return;
    }
  }
  // React: press GitHub's "Review changes" button (it renders its form in a portal) and fill what appears.
  const area = current.area ?? document.body;
  const trigger = [...area.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => /^review changes$/i.test(candidate.textContent?.trim() ?? ''));
  if (trigger !== undefined) {
    const before = new Set(queryAll<HTMLTextAreaElement>('textarea'));
    activateControl(trigger);
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const textarea = queryAll<HTMLTextAreaElement>('textarea').find((candidate) => !before.has(candidate) && candidate.closest(`.${ROOT_CLASS}`) === null);
      if (textarea === undefined) continue;
      if (textarea.value.trim() === '') setFieldValue(textarea, body);
      const dialog = textarea.closest<HTMLElement>('[role="dialog"], form, [class*="Overlay"]') ?? textarea.parentElement;
      const radio = [...(dialog?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [])].find((candidate) => EVENT_WORDS[event].test(labelOf(candidate)) || candidate.value === event);
      if (radio !== undefined && !radio.checked) radio.click();
      textarea.focus({ preventScroll: true });
      return;
    }
  }
  // Markup drift: the body goes to the clipboard and the reader is pointed at GitHub's control.
  try {
    await navigator.clipboard.writeText(body);
  } catch {
    // The clipboard may be refused; the toast still says where to go.
  }
  toast(current, 'GitHub’s Review changes form could not be opened here. The review body is on your clipboard; open Files changed and paste it into Review changes.');
}

function labelOf(input: HTMLInputElement): string {
  const wrapping = input.closest('label');
  if (wrapping !== null) return wrapping.textContent?.trim() ?? '';
  const by = input.getAttribute('aria-labelledby');
  if (by !== null) return (document.getElementById(by)?.textContent ?? '').trim();
  const forLabel = input.id === '' ? null : document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
  return (forLabel?.textContent ?? input.getAttribute('aria-label') ?? '').trim();
}

function toast(current: Visit, words: string): void {
  const root = current.root;
  if (root === null) return;
  root.querySelector(`.${ROOT_CLASS}__toast`)?.remove();
  const node = document.createElement('p');
  node.className = `${ROOT_CLASS}__toast`;
  node.setAttribute('role', 'status');
  node.textContent = words;
  root.append(node);
  setTimeout(() => node.remove(), 8000);
}

/* ------------------------------------------------------------------------- */
/* Keyboard                                                                   */
/* ------------------------------------------------------------------------- */

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable;
}

function bindKeys(): () => void {
  const handler = (event: KeyboardEvent): void => {
    const current = visit;
    const context = lastContext;
    if (current === null || context === null || current.root === null || typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    const state = plannerState(null);
    const plan = state.plan;
    if (plan === null) return;
    const handlers = makeHandlers(context, current);
    const currentId = state.progress?.current ?? nextPendingStep(plan, state.progress)?.id ?? plan.steps[0]?.id ?? null;
    const index = plan.steps.findIndex((step) => step.id === currentId);
    const step = plan.steps[index];
    switch (event.key) {
      case ']': {
        const next = plan.steps[index + 1];
        if (next !== undefined) handlers.selectStep(next.id);
        break;
      }
      case '[': {
        const previous = plan.steps[index - 1];
        if (previous !== undefined) handlers.selectStep(previous.id);
        break;
      }
      case 'j':
      case 'k': {
        const files = [...current.root.querySelectorAll<HTMLElement>(`.${ROOT_CLASS}__file`)];
        if (files.length === 0) return;
        const top = files.findIndex((file) => file.getBoundingClientRect().top > 80);
        const target = event.key === 'j' ? files[top === -1 ? files.length - 1 : top] : files[Math.max(0, (top === -1 ? files.length : top) - 2)];
        target?.scrollIntoView({ block: 'start', behavior: 'instant' });
        break;
      }
      case 'a':
        if (step !== undefined && !current.finishOpen) handlers.accept(step);
        break;
      case 'f':
        if (step !== undefined && !current.finishOpen) handlers.openFlag(true);
        break;
      case '?':
        handlers.toggleHelp();
        break;
      default:
        return;
    }
    event.preventDefault();
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}

/* ------------------------------------------------------------------------- */
/* Teardown                                                                   */
/* ------------------------------------------------------------------------- */

export function teardownReviewTab(): void {
  const current = visit;
  if (current === null) {
    document.documentElement.removeAttribute(ATTR_PAGE);
    for (const element of queryAll(`[${ATTR_REVIEW_AREA}]`)) {
      element.removeAttribute(ATTR_REVIEW_AREA);
      element.style.removeProperty(SEEK_VAR);
    }
    return;
  }
  visit = null;
  for (const node of teleportedNodes()) clearFoldedHunks(node);
  restoreAll();
  current.root?.remove();
  current.area?.removeAttribute(ATTR_REVIEW_AREA);
  current.area?.style.removeProperty(SEEK_VAR);
  for (const element of queryAll(`[${ATTR_REVIEW_AREA}]`)) element.removeAttribute(ATTR_REVIEW_AREA);
  if (current.seekTimer !== null) clearTimeout(current.seekTimer);
  current.unbindKeys?.();
  current.unbindFilesTab?.();
  document.documentElement.removeAttribute(ATTR_PAGE);
  closePlanner();
}

/** Everything, the tab link included (a settings change, the controller stopping). */
export function removeReviewTab(): void {
  teardownReviewTab();
  removeReviewTabLink();
}
