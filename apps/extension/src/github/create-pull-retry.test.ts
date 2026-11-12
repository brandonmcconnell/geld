// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://github.com/"}
import { afterEach, describe, expect, it } from 'vitest';
import { applyCreatePullRetry, attemptFromPage, createdPullUrl, findCreateFailure, findCreateForm, removeCreatePullRetry, waitBeforeResubmit } from './create-pull-retry';

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

describe('attemptFromPage', () => {
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
  it('offers the retry and the gh command under the flash', () => {
    page(FLASH('Pull request creation failed. Validation failed: was submitted too quickly') + FORM('Fix the nav'));
    applyCreatePullRetry();
    const root = document.querySelector('.flash-error .geld-pull-retry');
    const button = document.querySelector<HTMLElement>('.flash-error .geld-pull-retry__try');
    expect(button?.textContent?.trim()).toBe('Try with Geld');
    expect(button?.querySelector('[data-geld-brand]')).not.toBeNull();
    expect(button?.parentElement?.previousElementSibling?.classList.contains('js-flash-close')).toBe(true);
    button?.dispatchEvent(new MouseEvent('mouseenter'));
    const tip = document.querySelector('.geld-tooltip');
    expect(tip?.textContent).toBe('Geld can reattempt this failed operation, as the gh CLI would');
    expect(tip?.querySelector('code')?.textContent).toBe('gh');
    button?.dispatchEvent(new MouseEvent('mouseleave'));
    expect(root?.querySelector('.geld-pull-retry__command')?.textContent).toBe(
      "gh pr create --repo pingdotgg/t3code --base main --head theo:fix-nav --title 'Fix the nav' --body 'It broke.'",
    );
    applyCreatePullRetry();
    expect(document.querySelectorAll('.geld-pull-retry')).toHaveLength(1);
  });

  it('offers nothing for a failure a second send cannot change', () => {
    page(FLASH('Pull request creation failed. A pull request already exists for theo:fix-nav.') + FORM('Fix the nav'));
    applyCreatePullRetry();
    expect(document.querySelector('.geld-pull-retry')).toBeNull();
  });

  it('goes when the flash does', () => {
    page(FLASH('Pull request creation failed. Validation failed: was submitted too quickly') + FORM('Fix the nav'));
    applyCreatePullRetry();
    document.querySelector('#js-flash-container')?.remove();
    applyCreatePullRetry();
    expect(document.querySelector('.geld-pull-retry')).toBeNull();
  });
});
