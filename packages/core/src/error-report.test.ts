import { describe, expect, it } from 'vitest';
import { errorReportFrom, isOwnError, mergeErrorReports, parseErrorPayload, scrubErrorText, scrubStack } from './error-report';

const ORIGIN = 'chrome-extension://abcdefghijklmnop/';

describe('scrubErrorText', () => {
  it('removes URLs, emails, mentions and anything path-shaped', () => {
    expect(scrubErrorText('Failed to fetch https://github.com/acme/secret/pull/12.diff for jane@acme.com')).toBe('Failed to fetch <url> for <email>');
    expect(scrubErrorText('No thread for acme/secret-repo in src/billing/invoice.ts')).toBe('No thread for <path> in <path>');
    expect(scrubErrorText('Reply from @octocat failed')).toBe('Reply from @<user> failed');
  });

  it('drops quoted page text but keeps short identifiers', () => {
    expect(scrubErrorText('Unexpected token \'<\', "<!DOCTYPE html> <html lang" is not valid JSON')).toBe('Unexpected token \'<\', "<text>" is not valid JSON');
    expect(scrubErrorText('Unknown category: "tests"')).toBe('Unknown category: "tests"');
  });

  it('caps the length', () => {
    expect(scrubErrorText('x'.repeat(1000))).toHaveLength(600);
  });
});

describe('scrubStack', () => {
  it('keeps only frames in the extension, without its origin', () => {
    const stack = [
      'TypeError: Cannot read properties of null',
      `    at xY (${ORIGIN}content-scripts/github.js:1:2345)`,
      '    at https://github.com/assets/app.js:9:10',
      `    at ${ORIGIN}background.js:4:5`,
      `    at async Zq (${ORIGIN}content-scripts/github.js:2:10)`,
    ].join('\n');
    expect(scrubStack(stack, ORIGIN)).toEqual(['xY content-scripts/github.js:1:2345', 'background.js:4:5', 'Zq content-scripts/github.js:2:10']);
  });

  it('reads Firefox and Safari frames', () => {
    const origin = 'moz-extension://1234-uuid/';
    expect(scrubStack(`run@${origin}content-scripts/github.js:3:4\n@https://github.com/x.js:1:1`, origin)).toEqual(['run content-scripts/github.js:3:4']);
  });
});

describe('isOwnError', () => {
  it('tells Geld’s errors from the page’s', () => {
    const own = new Error('x');
    own.stack = `Error: x\n    at a (${ORIGIN}content-scripts/github.js:1:1)`;
    const page = new Error('y');
    page.stack = 'Error: y\n    at b (https://github.com/assets/app.js:1:1)';
    expect(isOwnError(own, ORIGIN)).toBe(true);
    expect(isOwnError(page, ORIGIN)).toBe(false);
    expect(isOwnError('a string', ORIGIN, `${ORIGIN}popup.html`)).toBe(true);
    expect(isOwnError(own, '')).toBe(false);
  });
});

describe('mergeErrorReports', () => {
  it('counts repeats as one entry', () => {
    const report = errorReportFrom({ where: 'content:pass', kind: 'error', error: new TypeError('boom'), origin: ORIGIN, at: 10 });
    const later = { ...report, firstAt: 20, lastAt: 20 };
    expect(mergeErrorReports([report], [later])).toEqual([{ ...report, count: 2, firstAt: 10, lastAt: 20 }]);
    expect(report.message).toBe('TypeError: boom');
  });
});

describe('parseErrorPayload', () => {
  const report = { where: 'background', kind: 'rejection', message: 'Failed https://x.example/a', stack: ['a background.js:1:2', 'https://evil.example/x:1:1'], count: 3, firstAt: 1, lastAt: 2 };

  it('accepts a well-formed payload and scrubs it again', () => {
    expect(parseErrorPayload({ v: 1, version: '0.1.2.40', browser: 'chrome', errors: [report] })).toEqual({
      v: 1,
      version: '0.1.2.40',
      browser: 'chrome',
      errors: [{ ...report, message: 'Failed <url>', stack: ['a background.js:1:2'] }],
    });
  });

  it('rejects anything else', () => {
    expect(parseErrorPayload(null)).toBeNull();
    expect(parseErrorPayload({ v: 2, version: '1', browser: 'chrome', errors: [report] })).toBeNull();
    expect(parseErrorPayload({ v: 1, version: '1', browser: 'netscape', errors: [report] })).toBeNull();
    expect(parseErrorPayload({ v: 1, version: '1', browser: 'chrome', errors: [] })).toBeNull();
    expect(parseErrorPayload({ v: 1, version: '1', browser: 'chrome', errors: [{ ...report, where: 'Not Valid' }] })).toBeNull();
  });
});
