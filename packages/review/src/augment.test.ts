import { describe, expect, it } from 'vitest';
import { botByLogin, botByTrigger, findingSeverity, isReviewShaped, isTriggerComment, parseBotBody } from './bots';

// Shapes as Augment Code posts them (Nov 2026): a summary comment, a review body and one thread per finding.
const SUMMARY =
  '🤖 Augment PR Summary\n\n**Summary:** This PR fixes 2 bugs in the retry loop and adds a timeout.\n\n**Changes:**\n- Retries stop after the configured attempts\n- Requests time out after 30 seconds\n\n<sub>🤖 Was this summary useful? React with 👍 or 👎</sub>';
const REVIEW = 'Review completed. 2 suggestions posted.\n\n<sub>Fix All in Augment</sub>\n\nComment `augment review` to trigger a new review at any time.';
const CLEAN_REVIEW = 'Review completed. No suggestions at this time.\n\nComment `augment review` to trigger a new review at any time.';
const FINDING = '**Severity: medium**\n\nThe retry counter is never reset, so a second request starts with the first one\'s attempts spent.\n\n<sub>Fix This in Augment</sub>';

describe('Augment Code', () => {
  it('is known by its login and trigger', () => {
    expect(botByLogin('augmentcode[bot]')?.id).toBe('augment');
    expect(botByTrigger('augment review')?.id).toBe('augment');
    expect(isTriggerComment('augment review')).toBe(true);
  });

  it('counts the suggestions its review posted', () => {
    const parsed = parseBotBody(REVIEW, 'augment', 'pullrequestreview-1');
    expect(parsed.count).toBe(2);
    expect(parsed.clean).toBe(false);
  });

  it('reads a review with no suggestions as clean', () => {
    const parsed = parseBotBody(CLEAN_REVIEW, 'augment', 'pullrequestreview-2');
    expect(parsed.count).toBe(0);
    expect(parsed.clean).toBe(true);
  });

  it('does not take its PR summary for a review', () => {
    expect(isReviewShaped(parseBotBody(SUMMARY, 'augment', 'issuecomment-1'))).toBe(false);
  });

  it('grades a finding by its severity line', () => {
    expect(findingSeverity(FINDING)).toBe('medium');
  });
});
