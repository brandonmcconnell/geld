/**
 * The Review view: a stepper on the left, the current step on the right.
 * Pure rendering from a model into a root element; the handlers are the
 * caller's. GitHub's rendered diffs are *moved* into the step (`teleport.ts`),
 * never copied, so commenting, suggestions and Viewed keep working; rows of
 * hunks that belong to other steps fold with a note (`hunk-rows.ts`).
 */

import type { FileHunks } from '@geld/core';
import { pluralize } from '@geld/core';
import type { ReviewPlan, ReviewProgress, ReviewStep, StepDisplayState } from '@geld/review';
import { finishBody, nextPendingStep, reviewComplete, STEP_KIND_LABELS, stepDisplayState, touchesSummary } from '@geld/review';
import type { StoredStory } from '../../lib/local-state';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import type { DiffEntry, DiffView } from '../model';
import { inlineText } from '../review/inline-text';
import { teleportInto } from '../review/teleport';
import { ICON_ALERT, ICON_ARROW_LEFT, ICON_ARROW_RIGHT, ICON_CHECK_CIRCLE_FILL, ICON_CHEVRON_DOWN, ICON_CIRCLE, ICON_DOT_CIRCLE, ICON_FLAG, ICON_KEBAB_HORIZONTAL, ICON_SPARKLE_FILL } from '../ui/icons';
import { foldOtherHunks } from './hunk-rows';

export const ROOT_CLASS = 'geld-review-tab';
const C = (suffix: string): string => `${ROOT_CLASS}__${suffix}`;

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
  readonly supportingOpen: boolean;
  readonly flagOpen: boolean;
  readonly flagDraft: string;
  readonly helpOpen: boolean;
  readonly shownRuns: Set<string>;
  /** The finish's review form, when GitHub's could be found and borrowed (legacy), to mount in the finish. */
  readonly reviewForm: HTMLElement | null;
}

export interface ReviewTabHandlers {
  readonly selectStep: (id: string) => void;
  readonly accept: (step: ReviewStep) => void;
  readonly flag: (step: ReviewStep, note: string) => void;
  readonly unmark: (step: ReviewStep) => void;
  readonly openFlag: (open: boolean) => void;
  readonly flagDraft: (text: string) => void;
  readonly toggleSupporting: () => void;
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
  root.append(renderStepper(model, handlers), renderMain(model, handlers));
  if (model.helpOpen) root.append(renderHelp(handlers));
  return root;
}

/* ---- stepper ---------------------------------------------------------------- */

function renderStepper(model: ReviewTabModel, handlers: ReviewTabHandlers): HTMLElement {
  const aside = createElement('aside', { class: C('steps'), 'aria-label': 'Steps' });
  const head = createElement('header', { class: C('steps-head') });
  const title = createElement('span', { class: C('brand') }, ['Review']);
  head.append(title);
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
  if (model.plan.producer === 'rules') {
    if (model.aiModel !== null) {
      foot.append(notice(['Grouped by commit, shared symbols and file. ', button('Plan with AI', C('link-button'), () => handlers.planWithAi(false), ICON_SPARKLE_FILL)]));
    } else {
      foot.append(notice(['Grouped by commit, shared symbols and file. With an AI model set up in Geld’s options, Geld plans the review and explains each step.']));
    }
  } else {
    foot.append(notice([svgFromString(ICON_SPARKLE_FILL), ` Planned by ${model.plan.model ?? 'the model'}`]));
    if (model.plan.fromHeaders) foot.append(notice(['Planned from hunk headers only: this pull request is too large to send in full.']));
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

  /* Head: position, kind, title, story. */
  const head = createElement('header', { class: C('step-head') });
  const eyebrow = createElement('p', { class: C('eyebrow') }, [`Step ${index + 1} of ${plan.steps.length}`, createElement('span', { class: C('kind') }, [STEP_KIND_LABELS[step.kind]])]);
  if (state !== 'pending') eyebrow.append(createElement('span', { class: C('state-word'), 'data-state': state }, [svgFromString(STATE_ICON[state]), STATE_WORD[state]]));
  const title = createElement('h2', { class: C('step-title'), id: 'geld-review-step-title' }, inlineText(step.title));
  head.append(eyebrow, title);
  head.append(renderStory(model, step));
  const touches = touchesSummary(step);
  if (touches.length > 0) {
    const line = createElement('p', { class: C('touches') }, ['Touches: ']);
    touches.forEach((entry, position) => {
      if (position > 0) line.append(', ');
      const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
      const link = createElement('a', { href: `#geld-review-file-${position}`, class: C('touch'), title: entry.path }, [createElement('code', {}, [name]), ` (${entry.hunks})`]);
      link.addEventListener('click', (event) => {
        event.preventDefault();
        article.querySelector<HTMLElement>(`[data-geld-review-file="${CSS.escape(entry.path)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      line.append(link);
    });
    if (step.supporting.length > 0) {
      const supporting = new Set(step.supporting.map((ref) => ref.path)).size;
      line.append(`. Supporting: ${pluralize(supporting, 'file', 'files')} below.`);
    }
    head.append(line);
  } else if (step.supporting.length > 0) {
    head.append(createElement('p', { class: C('touches') }, [`${pluralize(new Set(step.supporting.map((ref) => ref.path)).size, 'supporting file', 'supporting files')} and nothing else.`]));
  }
  if (step.dependsOn.length > 0) {
    const names = step.dependsOn.map((id) => plan.steps.findIndex((candidate) => candidate.id === id)).filter((position) => position >= 0).map((position) => `step ${position + 1}`);
    if (names.length > 0) head.append(createElement('p', { class: C('depends') }, [`Reads after ${names.join(' and ')}.`]));
  }
  article.append(head);

  /* Files: GitHub's diffs on loan. */
  const files = createElement('div', { class: C('files') });
  const paths = [...new Set(step.touches.map((ref) => ref.path))];
  for (const path of paths) files.append(renderFile(model, plan, step, path, 'touches', handlers));
  article.append(files);
  if (step.supporting.length > 0) {
    const supportingPaths = [...new Set(step.supporting.map((ref) => ref.path))];
    const details = createElement('details', { class: C('supporting') });
    if (model.supportingOpen) details.setAttribute('open', '');
    const summary = createElement('summary', { class: C('supporting-summary') }, [svgFromString(ICON_CHEVRON_DOWN), `${pluralize(supportingPaths.length, 'supporting change', 'supporting changes')}: `, createElement('span', { class: C('supporting-names') }, [supportingPaths.map((path) => path.slice(path.lastIndexOf('/') + 1)).join(', ')])]);
    summary.addEventListener('click', (event) => {
      event.preventDefault();
      handlers.toggleSupporting();
    });
    details.append(summary);
    if (model.supportingOpen) {
      const list = createElement('div', { class: C('files') });
      for (const path of supportingPaths) list.append(renderFile(model, plan, step, path, 'supporting', handlers));
      details.append(list);
    }
    article.append(details);
  }

  /* Actions. */
  const actions = createElement('footer', { class: C('actions') });
  const previous = index > 0 ? plan.steps[index - 1] : undefined;
  const next = plan.steps[index + 1];
  const nav = createElement('div', { class: C('actions-nav') });
  if (previous !== undefined) nav.append(button(`Step ${index}`, 'btn btn-sm', () => handlers.selectStep(previous.id), ICON_ARROW_LEFT));
  if (next !== undefined) nav.append(button(`Step ${index + 2}`, 'btn btn-sm', () => handlers.selectStep(next.id), ICON_ARROW_RIGHT));
  actions.append(nav);
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
  article.append(actions);
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
    article.append(form);
    requestAnimationFrame(() => area.focus({ preventScroll: true }));
  }
  return article;
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
  model.view?.expandEntry(entry);
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
  const formSlot = createElement('div', { class: C('form-slot') });
  if (model.reviewForm !== null) teleportInto(formSlot, [model.reviewForm]);
  article.append(formSlot);
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