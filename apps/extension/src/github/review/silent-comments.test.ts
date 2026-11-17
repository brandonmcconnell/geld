import { describe, expect, it } from 'vitest';
import { requestSeat, silentCommentAnchors } from './silent-comments';

const comment = (anchor: string, over: { bot?: boolean; trigger?: boolean; statusLine?: boolean } = {}) => ({ anchor, bot: false, trigger: false, statusLine: false, ...over });

describe('silentCommentAnchors', () => {
  it('folds a person\'s request even while a running bot\'s chip opens it', () => {
    const silent = silentCommentAnchors([comment('issuecomment-1', { trigger: true })], new Set(['issuecomment-1']));
    expect([...silent]).toEqual(['issuecomment-1']);
  });

  it('keeps a status line a chip opens, and folds the rest', () => {
    const silent = silentCommentAnchors([comment('issuecomment-2', { bot: true, statusLine: true }), comment('issuecomment-3', { bot: true, statusLine: true })], new Set(['issuecomment-2']));
    expect([...silent]).toEqual(['issuecomment-3']);
  });

  it('leaves a bot\'s request and a person\'s other comments in view', () => {
    expect([...silentCommentAnchors([comment('issuecomment-4', { bot: true, trigger: true }), comment('issuecomment-5')], new Set())]).toEqual([]);
  });
});

describe('requestSeat', () => {
  const bots = [{ id: 'greptile', sourceId: 'issuecomment-1' }, { id: 'bugbot' }];

  it('leads a chip opening a request to the bot\'s line and its summary', () => {
    expect(requestSeat('issuecomment-1', bots, new Map([['greptile', 'issuecomment-9']]))).toEqual({ bot: 'greptile', sub: 'issuecomment-9' });
  });

  it('opens the row alone for a bot with no summary yet', () => {
    expect(requestSeat('issuecomment-1', bots, new Map([['greptile', null]]))).toEqual({ bot: 'greptile', sub: null });
  });

  it('has no seat for a comment no chip opens', () => {
    expect(requestSeat('issuecomment-7', bots, new Map())).toBeNull();
  });
});
