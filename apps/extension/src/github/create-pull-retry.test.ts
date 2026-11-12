// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://github.com/"}
import { afterEach, describe, expect, it, vi } from 'vitest';

const background = vi.hoisted(() => ({ signedIn: true }));
vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage: (message: { readonly type: string }) => Promise.resolve(message.type === 'geld:api-signed-in' ? background.signedIn : undefined) } },
}));

import { applyCreatePullRetry, attemptFromPage, createdPullUrl, findCreateFailure, findCreateForm, removeCreatePullRetry, sidebarChoices, waitBeforeResubmit } from './create-pull-retry';

/** GitHub's flash partial (the compare page's `js-flash-template`), with the message a failed create renders in it. */
const FLASH = (message: string): string => `
  <div id="js-flash-container" class="flash-container" data-turbo-replace>
    <div class="flash flash-full flash-error">
      <div>
        <button class="flash-close js-flash-close" type="button" aria-label="Dismiss this message"></button>
        <div aria-atomic="true" role="alert" class="js-flash-alert"><div>${message}</div></div>
      </div>
    </div>
  </div>`;

const FORM = (title: string, timestamp = '1'): string => `
  <form id="new_pull_request" action="/pingdotgg/t3code/pull/create?base=pingdotgg%3Amain&amp;head=theo%3Afix-nav" method="post">
    <input type="hidden" name="authenticity_token" value="tok">
    <input type="hidden" name="timestamp" value="${timestamp}">
    <input type="text" name="pull_request[title]" value="${title}">
    <textarea name="pull_request[body]">It broke.</textarea>
    <button type="submit" class="btn-primary btn">Create pull request</button>
  </form>`;

function page(html: string): void {
  document.body.innerHTML = html;
  history.replaceState(null, '', '/pingdotgg/t3code/pull/create?base=pingdotgg%3Amain&head=theo%3Afix-nav');
}

afterEach(() => {
  removeCreatePullRetry();
  document.body.innerHTML = '';
});

describe('findCreateFailure', () => {
  it("reads GitHub's flash after its prefix", () => {
    page(FLASH('Pull request creation failed. Validation failed: was submitted too quickly'));
    expect(findCreateFailure()?.message).toBe('Validation failed: was submitted too quickly');
  });

  it('leaves other errors alone', () => {
    page(FLASH('Something else went wrong.'));
    expect(findCreateFailure()).toBeNull();
  });
});

describe('attemptFromPage and sidebarChoices', () => {
  it('reads a draft from an input submitter, whose label is its value', () => {
    page(FORM('T').replace('<button type="submit" class="btn-primary btn">Create pull request</button>', '<input type="submit" class="btn-primary btn" value="Create draft pull request">'));
    const form = findCreateForm();
    if (form === null) throw new Error('no form');
    expect(attemptFromPage(form, new URL(location.href))?.draft).toBe(true);
  });

  it('names the sidebar choices the API cannot carry, and only those chosen', () => {
    page(FORM('T').replace('</form>', '<input type="hidden" name="reviewer_user_ids[]" value="12"><input type="hidden" name="issue[labels][]" value=""></form>'));
    const form = findCreateForm();
    if (form === null) throw new Error('no form');
    expect(sidebarChoices(form)).toEqual(['Reviewers']);
  });

  it('reads the pull request the form was sending', () => {
    page(FORM('Fix the nav'));
    const form = findCreateForm();
    expect(form).not.toBeNull();
    if (form === null) return;
    expect(attemptFromPage(form, new URL(location.href))).toEqual({
      owner: 'pingdotgg',
      repo: 't3code',
      base: 'main',
      head: 'theo:fix-nav',
      headRepo: null,
      title: 'Fix the nav',
      body: 'It broke.',
      draft: false,
    });
  });
});

describe('waitBeforeResubmit', () => {
  it("waits out GitHub's timing check from the form's own timestamp", () => {
    page(FORM('T', '1000'));
    const form = findCreateForm();
    if (form === null) throw new Error('no form');
    expect(waitBeforeResubmit(form, 1_000_000 + 2000)).toBe(3000);
    expect(waitBeforeResubmit(form, 1_000_000 + 9000)).toBe(0);
  });
});

describe('createdPullUrl', () => {
  it("finds the new pull request from the redirect, or the answer's canonical link where the redirect is lost", () => {
    expect(createdPullUrl('https://github.com/o/r/pull/12', '', 'https://github.com/o/r/pull/create')).toBe('https://github.com/o/r/pull/12');
    expect(createdPullUrl('', '<link rel="canonical" href="https://github.com/o/r/pull/13">', 'https://github.com/o/r/pull/create')).toBe('https://github.com/o/r/pull/13');
    expect(createdPullUrl('https://github.com/o/r/pull/create', '<link rel="canonical" href="https://github.com/o/r">', 'https://github.com/o/r/pull/create')).toBeNull();
  });
});

describe('applyCreatePullRetry', () => {
  const COMMAND = "gh pr create --repo pingdotgg/t3code --base main --head theo:fix-nav --title 'Fix the nav' --body 'It broke.'";
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('offers Try again and Trigger via API beside the close button, each with help in its tooltip, and the gh command under the message, signed in', async () => {
    background.signedIn = true;
    page(FLASH('Pull request creation failed. Validation failed: was submitted too quickly') + FORM('Fix the nav'));
    applyCreatePullRetry();
    await settle();
    const root = document.querySelector('.flash-error .geld-pull-retry');
    const buttons = [...document.querySelectorAll<HTMLElement>('.flash-error .geld-pull-retry__try')];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Try again', 'Trigger via API']);
    expect(buttons.every((button) => button.querySelector('[data-geld-brand]') !== null)).toBe(true);
    expect(document.querySelector('.geld-pull-retry__side')?.previousElementSibling?.classList.contains('js-flash-close')).toBe(true);
    buttons[0]?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.geld-tooltip')?.textContent).toBe("Sends GitHub's form again through your GitHub session, once its timing check allows it.");
    buttons[0]?.dispatchEvent(new MouseEvent('mouseleave'));
    buttons[1]?.dispatchEvent(new MouseEvent('mouseenter'));
    const tip = document.querySelector('.geld-tooltip');
    expect(tip?.textContent).toBe("Opens the pull request through GitHub's API with your Geld sign-in, as the gh CLI does. No form check applies.");
    expect(tip?.querySelector('code')?.textContent).toBe('gh');
    buttons[1]?.dispatchEvent(new MouseEvent('mouseleave'));
    expect(root?.querySelector('pre.geld-pull-retry__command')?.textContent).toBe(COMMAND);
    applyCreatePullRetry();
    expect(document.querySelectorAll('.geld-pull-retry')).toHaveLength(1);
    expect(document.querySelectorAll('.geld-pull-retry__side')).toHaveLength(1);
  });

  it('offers only Try again to a reader not signed in to Geld, who cannot use the API', async () => {
    background.signedIn = false;
    page(FLASH('Pull request creation failed. Validation failed: was submitted too quickly') + FORM('Fix the nav'));
    applyCreatePullRetry();
    await settle();
    expect([...document.querySelectorAll('.geld-pull-retry__try')].map((button) => button.textContent?.trim())).toEqual(['Try again']);
    expect(document.querySelector('.geld-pull-retry__try [data-geld-brand]')).not.toBeNull();
    expect(document.querySelector('.geld-pull-retry__command')?.textContent).toBe(COMMAND);
    applyCreatePullRetry();
    expect(document.querySelectorAll('.geld-pull-retry')).toHaveLength(1);
  });

  it('adds Trigger via API when the reader comes back signed in to Geld, without a reload', async () => {
    background.signedIn = false;
    page(FLASH('Pull request creation failed. Validation failed: was submitted too quickly') + FORM('Fix the nav'));
    applyCreatePullRetry();
    await settle();
    const labels = (): (string | undefined)[] => [...document.querySelectorAll('.geld-pull-retry__try')].map((button) => button.textContent?.trim());
    expect(labels()).toEqual(['Try again']);
    background.signedIn = true;
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(labels()).toEqual(['Try again', 'Trigger via API']);
    expect(document.querySelectorAll('.geld-pull-retry__side')).toHaveLength(1);
    applyCreatePullRetry();
    expect(labels()).toEqual(['Try again', 'Trigger via API']);
  });

  it('puts the buttons at the flash\'s foot, under the command, on a phone', async () => {
    const wide = window.matchMedia;
    window.matchMedia = (query: string): MediaQueryList => {
      const list = wide.call(window, query);
      return Object.defineProperty(list, 'matches', { value: true });
    };
    try {
      background.signedIn = false;
      page(FLASH('Pull request creation failed. Validation failed: was submitted too quickly') + FORM('Fix the nav'));
      applyCreatePullRetry();
      await settle();
      expect(document.querySelector('.geld-pull-retry')?.nextElementSibling?.classList.contains('geld-pull-retry__side')).toBe(true);
    } finally {
      window.matchMedia = wide;
    }
  });

  it('keeps its controls on a flash with no alert element, whose text the controls now lead', async () => {
    background.signedIn = true;
    page(
      FLASH('Pull request creation failed. Validation failed: was submitted too quickly').replace('<div aria-atomic="true" role="alert" class="js-flash-alert">', '<div>') +
        FORM('Fix the nav'),
    );
    applyCreatePullRetry();
    await settle();
    const side = document.querySelector('.geld-pull-retry__side');
    expect(side).not.toBeNull();
    applyCreatePullRetry();
    expect(document.querySelector('.geld-pull-retry__side')).toBe(side);
  });

  it('offers nothing for a failure a second send cannot change', () => {
    page(FLASH('Pull request creation failed. A pull request already exists for theo:fix-nav.') + FORM('Fix the nav'));
    applyCreatePullRetry();
    expect(document.querySelector('.geld-pull-retry')).toBeNull();
  });

  it('goes when the flash does', async () => {
    background.signedIn = true;
    page(FLASH('Pull request creation failed. Validation failed: was submitted too quickly') + FORM('Fix the nav'));
    applyCreatePullRetry();
    await settle();
    document.querySelector('#js-flash-container')?.remove();
    applyCreatePullRetry();
    expect(document.querySelector('.geld-pull-retry')).toBeNull();
    expect(document.querySelector('.geld-pull-retry__try')).toBeNull();
  });
});
