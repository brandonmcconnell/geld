import type { GeldSettings } from '@geld/core';
import type { GeldPrMeta, RawComment, ReviewItem } from '@geld/review';
import { isOpenStatus } from '@geld/review';
import type { FixRun, FixScope, SuggestionSource } from './ai';
import { aiStateFor, chatFixesOffered, commentReportsOutsideThreads, fixFromComments, threadKeyOf, triageSuggestions } from './ai';
import type { ChatFix, ChatFixState, CommentFix, CommentFixScope } from './chat-fix';

/** A fix asked for from a chat: how it went, and the choice a comment's was asked with. */
export interface AskedChatFix {
  readonly state: ChatFixState;
  readonly scope: CommentFixScope | null;
  readonly error?: string;
  readonly needsKey?: boolean;
}

/** The parts of a triage visit a chat's Fix reads and writes. */
export interface ChatFixVisit {
  collapsed: boolean;
  readonly busy: Map<string, 'fix' | 'writing'>;
  /** Fixes asked for from a chat, by the thread's key or the comment's anchor. */
  readonly chatFixes: Map<string, AskedChatFix>;
}

/** What a host lends the chats' Fix: the review as the triage reads it, its visit, and where a fix's lines come from. */
export interface ChatFixHost {
  readonly meta: GeldPrMeta;
  readonly comments: readonly RawComment[];
  readonly settings: GeldSettings;
  /** The visit's triage (a getter: a host may start a fresh one, and an answer belongs to the one it began in). */
  visit(): ChatFixVisit;
  readonly reapply: () => void;
  /** Where a finding's lines come from, or null where the host cannot read them (no fix is offered then). */
  readonly source: () => SuggestionSource | null;
  readonly openAiSettings: () => void;
}

/** A thread a comment came with, by its first comment's anchor and a line to name it by. */
export interface ChatFixThreadLink {
  readonly anchor: string;
  readonly preview: string;
}

/**
 * Fixes asked for from a chat, the same on every host: a thread's Fix asks the triage for a fix for that thread, a
 * comment's for what it reports outside its threads, its threads, or both, written without a whole triage
 * (`fixFromComments`) and shown in the triage at the top of the digest.
 */
export function chatFixes(host: ChatFixHost): {
  readonly threadFix: (anchor: string) => ChatFix | null;
  readonly commentFix: (anchor: string, author: string, links: readonly ChatFixThreadLink[]) => CommentFix | null;
} {
  const { meta, comments, settings } = host;
  const offered = (): boolean => chatFixesOffered(aiStateFor(meta, comments, settings), settings) && host.source() !== null;
  /** The saved fixes an ask would write afresh: those holding any of its threads, a shared one's partners included. */
  const fixesFor = (threads: readonly string[]): readonly string[] => {
    const asked = new Set(threads);
    return triageSuggestions(meta, settings).flatMap(({ entry }) => (entry.threads.some((thread) => asked.has(thread)) ? [entry.key] : []));
  };
  const askFix = (key: string, scope: CommentFixScope | null, ask: FixScope): void => {
    const triage = host.visit();
    const source = host.source();
    if (source === null) return;
    // A fix being applied, or written afresh by another ask, and this ask would each record over the other: one at a time.
    const rewriting = fixesFor(ask.threads);
    if (rewriting.some((entry) => triage.busy.has(entry))) return;
    for (const entry of rewriting) triage.busy.set(entry, 'writing');
    triage.collapsed = false;
    triage.chatFixes.set(key, { state: 'running', scope });
    host.reapply();
    // However the request ends, its fixes are free to apply again: a mark left by a request that threw held Apply for good.
    const settle = (run: FixRun): void => {
      for (const entry of rewriting) if (triage.busy.get(entry) === 'writing') triage.busy.delete(entry);
      triage.chatFixes.set(key, { state: !run.changed ? 'idle' : run.failed ? 'failed' : 'done', scope, ...(run.reason === undefined ? {} : { error: run.reason }), ...(run.needsKey === true ? { needsKey: true } : {}) });
      host.reapply();
    };
    void fixFromComments(meta, comments, settings, host.reapply, source, ask).then(settle, () => settle({ changed: true, failed: true, reason: 'The request did not finish.' }));
  };
  /** The open finding a thread (or a thread a comment came with) is, by any of its comments' anchors. */
  const fixableItemAt = (anchor: string): ReviewItem | null => {
    const item = meta.items.find((candidate) => candidate.sources.some((source) => source.anchor === anchor));
    return item === undefined || !isOpenStatus(item.status) || item.path === undefined || threadKeyOf(item) === '' ? null : item;
  };
  // An ask that found no key is forgotten once one is saved: its control is Fix again, not Add API key.
  const askedFix = (key: string): AskedChatFix | undefined => {
    const asked = host.visit().chatFixes.get(key);
    return asked?.needsKey === true && aiStateFor(meta, comments, settings).kind !== 'needs-key' ? undefined : asked;
  };
  return {
    threadFix: (anchor) => {
      if (!offered()) return null;
      const item = fixableItemAt(anchor);
      if (item === null) return null;
      const key = threadKeyOf(item);
      const asked = askedFix(key);
      const applying = fixesFor([key]).some((entry) => host.visit().busy.get(entry) === 'fix');
      return { state: asked?.state ?? 'idle', applying, ...(asked?.error === undefined ? {} : { error: asked.error }), ...(asked?.needsKey === true ? { needsKey: true } : {}), onFix: () => askFix(key, null, { threads: [key], comment: null }), onAddKey: host.openAiSettings };
    },
    commentFix: (anchor, author, links) => {
      if (!offered()) return null;
      const text = comments.find((comment) => comment.anchor === anchor)?.body.trim() ?? '';
      if (text === '') return null;
      const items = links.flatMap((link) => {
        const item = fixableItemAt(link.anchor);
        return item === null ? [] : [item];
      });
      const keys = [...new Set(items.map(threadKeyOf))];
      const titles = links.map((link) => meta.items.find((candidate) => candidate.sources.some((source) => source.anchor === link.anchor))?.title ?? link.preview).filter((title) => title !== '');
      const asked = askedFix(anchor);
      // Offered only for what Geld knows is there: findings the comment reports outside its threads, or open threads.
      const comment = commentReportsOutsideThreads(meta, anchor);
      if (!comment && keys.length === 0 && asked?.state !== 'running') return null;
      return {
        threads: keys.length,
        comment,
        applying: fixesFor(keys).some((entry) => host.visit().busy.get(entry) === 'fix'),
        state: asked?.state ?? 'idle',
        scope: asked?.scope ?? null,
        ...(asked?.error === undefined ? {} : { error: asked.error }),
        ...(asked?.needsKey === true ? { needsKey: true } : {}),
        onAddKey: host.openAiSettings,
        onFix: (scope) => askFix(anchor, scope, { threads: scope === 'comment' ? [] : keys, comment: scope === 'threads' ? null : { anchor, author, text, threads: titles } }),
      };
    },
  };
}
