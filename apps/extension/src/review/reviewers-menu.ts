import { createElement, svgFromString } from '../github/dom';
import { ICON_CHECK_CIRCLE_FILL, ICON_CHEVRON_RIGHT, ICON_COMMENT, ICON_DOT_FILL, ICON_KEBAB_HORIZONTAL, ICON_X_CIRCLE_FILL } from '../github/ui/icons';
import { installMenuDismissal } from './triage-card';
import './digest-kit.css';
import './request-menu.css';

/**
 * The Reviews row's "Request a review" for people, the same on every host: everyone with a standing listed first with
 * a checkbox and their standing, then "Other reviewers" behind a search box over the host's list of who may be asked,
 * Request and Cancel. The host says who stands where, who may be asked and how a request is posted (`ReviewersMenuHost`).
 */

const PANEL_CLASS = 'geld-review';
const ATTR_FOCUS = 'data-geld-focus';

/** Someone with a standing, as the menu lists them first. */
export interface ReviewersMenuPerson {
  readonly login: string;
  readonly avatar: string;
  /** Their standing's glyphs, words ("approved · awaiting") and colour. */
  readonly glyphs: readonly string[];
  readonly words: string;
  readonly health: string | null;
  /** They gave a verdict: ticking them asks them to review again. */
  readonly reviewed: boolean;
  /** False where the host cannot ask them again (Bitbucket has no re-request): listed, not ticked. */
  readonly askable?: boolean;
}

/** Someone the host offers as a reviewer, with the id its request wants. */
export interface ReviewersMenuCandidate {
  readonly id: string | number;
  readonly login: string;
  readonly name: string;
  readonly avatar: string;
  /** The host's suggestion (GitHub's, from who recently reviewed or edited these files). */
  readonly suggested: boolean;
  readonly team: boolean;
}

export interface ReviewersMenuHost {
  /** The host's name in what the menu says ("GitHub did not list anyone"). */
  readonly hostName: string;
  readonly standing: readonly ReviewersMenuPerson[];
  /** Who may be asked; null when the list could not be read, so opening the section again asks again. */
  readonly loadCandidates: () => Promise<readonly ReviewersMenuCandidate[] | null>;
  /** Post the request for these people and teams, keeping everyone already requested: whether the host took it. */
  readonly request: (users: readonly (string | number)[], teams: readonly (string | number)[]) => Promise<boolean>;
  readonly onClosed: () => void;
  /** The classes the host's own buttons wear. */
  readonly button: string;
  readonly primary: string;
}

const icon = (markup: string): SVGElement => svgFromString(markup);

export type ReviewerVerdict = 'approved' | 'changes_requested' | 'commented';

const VERDICT_GLYPH: Readonly<Record<ReviewerVerdict, string>> = { approved: ICON_CHECK_CIRCLE_FILL, changes_requested: ICON_X_CIRCLE_FILL, commented: ICON_COMMENT };
const VERDICT_WORD: Readonly<Record<ReviewerVerdict, string>> = { approved: 'approved', changes_requested: 'requested changes', commented: 'commented' };

/** How a person's standing reads in the menu: glyph(s) and a word, "approved · awaiting" when both hold. */
export function personStanding(verdict: ReviewerVerdict | null, awaiting: boolean): Pick<ReviewersMenuPerson, 'glyphs' | 'words' | 'health'> {
  const glyphs: string[] = [];
  const parts: string[] = [];
  if (verdict !== null) {
    glyphs.push(VERDICT_GLYPH[verdict]);
    parts.push(VERDICT_WORD[verdict]);
  }
  if (awaiting) {
    glyphs.push(ICON_DOT_FILL);
    parts.push('awaiting');
  }
  const health = verdict === 'approved' ? 'good' : verdict === 'changes_requested' ? 'bad' : awaiting ? 'pending' : null;
  return { glyphs, words: parts.join(' · '), health };
}

/** `mount`: a host's own menu (its summary already in it) to fill, else GitHub's ⋯ details. */
export function reviewersMenu(host: ReviewersMenuHost, mount?: HTMLDetailsElement): HTMLDetailsElement {
  installMenuDismissal();
  const details = mount ?? createElement('details', { class: `${PANEL_CLASS}__menu ${PANEL_CLASS}__request ${PANEL_CLASS}__people` });
  const summary = createElement('summary', { class: `${PANEL_CLASS}__icon`, 'aria-label': 'Request a review', title: 'Request a review', role: 'button', [ATTR_FOCUS]: 'reviewers' }, [icon(ICON_KEBAB_HORIZONTAL)]);
  summary.addEventListener('click', (event) => event.stopPropagation());
  details.addEventListener('toggle', () => {
    if (!details.open) host.onClosed();
  });
  const list = createElement('div', { class: `${PANEL_CLASS}__menu-list ${PANEL_CLASS}__request-list` });
  list.append(createElement('div', { class: `${PANEL_CLASS}__menu-title` }, ['Request a review']));

  /** Ticked reviewers by kind and login (`u:` a person, `t:` a team — a team's slug may read like a login); candidates carry the ids the request wants. */
  const ticked = new Map<string, HTMLInputElement>();
  const keyOf = (login: string, team: boolean): string => `${team ? 't' : 'u'}:${login.toLowerCase()}`;
  const picked = (): string[] => [...ticked.entries()].filter(([, input]) => input.checked).map(([key]) => key);
  const request = createElement('button', { type: 'button', class: `${host.primary} ${PANEL_CLASS}__request-run` }, ['Request']);
  const problem = createElement('span', { class: `${PANEL_CLASS}__menu-hint ${PANEL_CLASS}__request-problem`, role: 'alert' });
  let busy = false;
  const syncRequest = (): void => {
    if (busy) return;
    const count = picked().length;
    request.textContent = count === 0 ? 'Request' : count === 1 ? 'Request review' : `Request ${count} reviews`;
    request.toggleAttribute('disabled', count === 0);
  };
  const personLine = (login: string, team: boolean, avatarSrc: string, name: string, person: ReviewersMenuPerson | null, title: string): HTMLElement => {
    const key = keyOf(login, team);
    const fixed = person !== null && person.askable === false;
    const input = ticked.get(key) ?? createElement('input', { type: 'checkbox', class: `${PANEL_CLASS}__request-check`, 'aria-label': team ? `${login} (team)` : login, ...(fixed ? { disabled: '', checked: '' } : {}) });
    if (!fixed) ticked.set(key, input);
    input.addEventListener('change', syncRequest);
    const picture = avatarSrc !== '' ? createElement('img', { class: `${PANEL_CLASS}__bot-icon ${PANEL_CLASS}__people-avatar`, src: avatarSrc, alt: '', width: '16', height: '16' }) : createElement('span', { class: `${PANEL_CLASS}__bot-icon ${PANEL_CLASS}__bot-icon--blank`, 'aria-hidden': 'true' });
    const children: Node[] = [input, picture, createElement('span', { class: `${PANEL_CLASS}__menu-text` }, [login, ...(name === '' || name === login ? [] : [createElement('span', { class: `${PANEL_CLASS}__people-name` }, [name])])])];
    if (person !== null && person.glyphs.length > 0) {
      children.push(
        createElement('span', { class: `${PANEL_CLASS}__request-state ${PANEL_CLASS}__people-state`, ...(person.health === null ? {} : { 'data-health': person.health }), title: person.words }, [
          ...person.glyphs.map((glyph) => createElement('span', { class: `${PANEL_CLASS}__people-glyph`, 'aria-hidden': 'true' }, [icon(glyph)])),
          createElement('span', { class: `${PANEL_CLASS}__people-words` }, [person.words]),
        ]),
      );
    }
    const label = createElement('label', { class: `${PANEL_CLASS}__request-item ${PANEL_CLASS}__people-item`, title, 'data-login': login }, children);
    label.addEventListener('click', (event) => event.stopPropagation());
    return label;
  };

  const standing = host.standing;
  for (const person of standing) list.append(personLine(person.login, false, person.avatar, '', person, person.askable === false ? `${person.login} is a reviewer already · ${person.words}` : person.reviewed ? `Asks ${person.login} to review again · ${person.words}` : `${person.login} · ${person.words}`));
  if (standing.length === 0) list.append(createElement('div', { class: `${PANEL_CLASS}__menu-hint ${PANEL_CLASS}__people-hint` }, ['Nobody has been asked yet.']));

  // Other reviewers: the search box and the list, filled from the host's candidates when first opened.
  const more = createElement('details', { class: `${PANEL_CLASS}__request-more ${PANEL_CLASS}__people-more` });
  const moreSummary = createElement('summary', { class: `${PANEL_CLASS}__request-more-summary` }, [icon(ICON_CHEVRON_RIGHT), 'Other reviewers']);
  moreSummary.addEventListener('click', (event) => event.stopPropagation());
  const listboxId = `geld-people-${Math.random().toString(36).slice(2, 8)}`;
  const search = createElement('input', { type: 'text', class: `${PANEL_CLASS}__people-search`, placeholder: 'Type or choose a user', 'aria-label': 'Type or choose a user', autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': listboxId, 'aria-autocomplete': 'list' });
  const options = createElement('div', { class: `${PANEL_CLASS}__people-options`, id: listboxId, role: 'listbox', 'aria-label': 'Other reviewers' });
  const hint = createElement('div', { class: `${PANEL_CLASS}__menu-hint ${PANEL_CLASS}__people-hint`, 'aria-live': 'polite' });
  more.append(moreSummary, createElement('div', { class: `${PANEL_CLASS}__people-filter` }, [search]), hint, options);
  list.append(more);

  let candidates: readonly ReviewersMenuCandidate[] | null = null;
  let loading = false;
  /** The host's id for each ticked key, once its candidates have been read. */
  const ids = new Map<string, string | number>();
  const rows: HTMLElement[] = [];
  let active = -1;
  const visibleRows = (): HTMLElement[] => rows.filter((row) => !row.hidden);
  const setActive = (index: number): void => {
    const shown = visibleRows();
    active = shown.length === 0 ? -1 : Math.max(0, Math.min(index, shown.length - 1));
    for (const [position, row] of shown.entries()) {
      row.toggleAttribute('data-active', position === active);
      row.setAttribute('aria-selected', String(position === active));
    }
    const current = shown[active];
    if (current !== undefined) {
      search.setAttribute('aria-activedescendant', current.id);
      current.scrollIntoView?.({ block: 'nearest' });
    } else search.removeAttribute('aria-activedescendant');
  };
  const filter = (): void => {
    const needle = search.value.trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const haystack = row.getAttribute('data-search') ?? '';
      row.hidden = needle !== '' && !haystack.includes(needle);
      if (!row.hidden) shown += 1;
    }
    if (candidates !== null) hint.textContent = shown === 0 ? 'Nothing to show' : '';
    setActive(needle === '' ? -1 : 0);
  };
  const fill = (found: readonly ReviewersMenuCandidate[]): void => {
    const standingKeys = new Set(standing.map((entry) => keyOf(entry.login, false)));
    for (const candidate of found) {
      const key = keyOf(candidate.login, candidate.team);
      ids.set(key, candidate.id);
      // Already listed above with their standing; the request still needs their id, which is now known.
      if (standingKeys.has(key)) continue;
      const row = personLine(candidate.login, candidate.team, candidate.avatar, candidate.name, null, candidate.team ? `${candidate.login} · team` : candidate.suggested ? `${candidate.login} · suggested` : candidate.login);
      row.id = `${listboxId}-${rows.length}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.setAttribute('data-search', `${candidate.login} ${candidate.name}`.toLowerCase());
      if (candidate.suggested) row.setAttribute('data-suggested', '');
      rows.push(row);
      options.append(row);
    }
    hint.textContent = rows.length === 0 ? 'Nobody else to ask.' : '';
    filter();
  };
  const load = (): void => {
    if (candidates !== null || loading) return;
    loading = true;
    hint.textContent = 'Loading…';
    void host.loadCandidates().then((found) => {
      loading = false;
      // A failed lookup is not an empty one: `candidates` stays null so opening the section again asks again.
      candidates = found;
      if (found === null) {
        hint.textContent = `${host.hostName} did not list anyone. Close and reopen to try again.`;
        return;
      }
      fill(found);
    });
  };
  more.addEventListener('toggle', () => {
    if (!more.open) return;
    load();
    window.requestAnimationFrame(() => search.focus({ preventScroll: true }));
  });
  search.addEventListener('input', filter);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const input = visibleRows()[active]?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (input !== undefined && input !== null) {
        input.checked = !input.checked;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else if (event.key === 'Escape') {
      if (search.value !== '') {
        event.preventDefault();
        event.stopPropagation();
        search.value = '';
        filter();
      }
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : rows.length);
    }
  });
  // Clicks in the box stay in the box: the row toggle above must not see them.
  search.addEventListener('click', (event) => event.stopPropagation());

  list.append(createElement('div', { class: `${PANEL_CLASS}__request-sep`, role: 'separator' }));
  const cancel = createElement('button', { type: 'button', class: `${host.button} ${PANEL_CLASS}__request-cancel` }, ['Cancel']);
  // Request keeps the menu open until the host has answered: a refusal is said here, with the ticks kept for another
  // try, and Cancel (or the menu closing any other way) while the ids are still loading means nothing is posted.
  let attempt = 0;
  request.addEventListener('click', (event) => {
    event.stopPropagation();
    const chosen = picked();
    if (chosen.length === 0 || busy) return;
    attempt += 1;
    const mine = attempt;
    const still = (): boolean => details.open && details.isConnected && attempt === mine;
    busy = true;
    problem.textContent = '';
    request.toggleAttribute('disabled', true);
    request.textContent = 'Requesting…';
    const settle = (message: string | null): void => {
      busy = false;
      if (message === null) {
        details.removeAttribute('open');
        return;
      }
      problem.textContent = message;
      syncRequest();
    };
    void (async () => {
      // Someone listed by their standing alone has no id yet: the host's list supplies it.
      if (!chosen.every((key) => ids.has(key))) {
        const found = await host.loadCandidates();
        if (!still()) return;
        for (const candidate of found ?? []) ids.set(keyOf(candidate.login, candidate.team), candidate.id);
      }
      const users: (string | number)[] = [];
      const teams: (string | number)[] = [];
      for (const key of chosen) {
        const id = ids.get(key);
        if (id !== undefined) (key.startsWith('t:') ? teams : users).push(id);
      }
      if (users.length + teams.length === 0) {
        settle(`${host.hostName} does not list them among the reviewers that can be asked here.`);
        return;
      }
      const posted = await host.request(users, teams).catch(() => false);
      if (!still()) return;
      settle(posted ? null : `${host.hostName} did not take the request. Try again.`);
    })();
  });
  cancel.addEventListener('click', (event) => {
    event.stopPropagation();
    details.removeAttribute('open');
  });
  // Closing the menu by any means ends a request still waiting on ids; a menu rebuilt by the panel is a new one.
  details.addEventListener('toggle', () => {
    if (!details.open) {
      attempt += 1;
      busy = false;
      problem.textContent = '';
      syncRequest();
    }
  });
  list.append(createElement('div', { class: `${PANEL_CLASS}__request-footer` }, [request, cancel, problem]));
  syncRequest();
  details.append(...(mount === undefined ? [summary] : []), list);
  return details;
}
