// @vitest-environment happy-dom
import { authorOf } from './crawler';
import { loginOfLink, showLogins } from './login';
import { restoreAll, teleportInto } from './teleport';

const link = (html: string): Element => {
  const box = document.createElement('div');
  box.innerHTML = html;
  const found = box.firstElementChild;
  if (found === null) throw new Error('fixture');
  return found;
};

describe('loginOfLink', () => {
  it('reads the login from the profile, the hovercard or the parenthesis, never the full name', () => {
    expect(loginOfLink(link('<a class="author" href="/connor4312">Connor Peet (connor4312)</a>'))).toBe('connor4312');
    expect(loginOfLink(link('<a href="https://github.com/aeschli">Martin Aeschlimann</a>'))).toBe('aeschli');
    expect(loginOfLink(link('<span data-hovercard-url="/users/sandy081/hovercard">Sandeep Somavarapu (sandy081)</span>'))).toBe('sandy081');
    expect(loginOfLink(link('<span>Sandeep Somavarapu (sandy081)</span>'))).toBe('sandy081');
    expect(loginOfLink(link('<a href="/orgs/acme/teams/core">acme/core</a>'))).toBe('acme/core');
    // An App by its path, whatever name it shows, as a comment's author has it, so its name gets Geld's App card.
    expect(loginOfLink(link('<a class="author" href="/apps/dependabot">dependabot</a>'))).toBe('dependabot[bot]');
    expect(loginOfLink(link('<a href="/apps/copilot-pull-request-reviewer">Copilot</a>'))).toBe('copilot-pull-request-reviewer[bot]');
  });

  it('gives a comment its author’s login, as the sidebar names them, so one reviewer is one person', () => {
    const comment = link('<div><a class="author" href="/connor4312" data-hovercard-type="user">Connor Peet (connor4312)</a></div>');
    expect(authorOf(comment)).toEqual({ login: 'connor4312', bot: false });
    const app = link('<div><a class="author" href="/apps/copilot-pull-request-reviewer">Copilot</a></div>');
    expect(authorOf(app)).toEqual({ login: 'copilot-pull-request-reviewer[bot]', bot: true });
    // An absolute link to the App is the App too.
    expect(authorOf(link('<div><a class="author" href="https://github.com/apps/greptile-apps">greptile-apps</a></div>'))).toEqual({ login: 'greptile-apps[bot]', bot: true });
  });
});

describe('showLogins', () => {
  it('shows GitHub’s names on loan as logins, keeping the hovercard, and puts them back when they go home', () => {
    document.body.innerHTML = `
      <div class="TimelineItem" id="event-1"><a class="author Link--primary" href="/sandy081" data-hovercard-type="user" data-hovercard-url="/users/sandy081/hovercard">Sandeep Somavarapu (sandy081)</a> merged into main</div>
      <div class="geld-review"><div class="slot"></div></div>`;
    const row = document.querySelector<HTMLElement>('#event-1');
    const slot = document.querySelector<HTMLElement>('.slot');
    if (row === null || slot === null) throw new Error('fixture');
    teleportInto(slot, [row]);
    showLogins(slot);
    const name = row.querySelector('a.author');
    expect(name?.textContent).toBe('sandy081');
    expect(name?.getAttribute('data-hovercard-url')).toBe('/users/sandy081/hovercard');
    // A second pass changes nothing.
    showLogins(slot);
    expect(name?.textContent).toBe('sandy081');
    restoreAll();
    expect(name?.textContent).toBe('Sandeep Somavarapu (sandy081)');
    expect(row.parentElement).toBe(document.body);
  });
});
