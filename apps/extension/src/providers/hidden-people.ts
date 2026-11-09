import { compileAuthorRules, normalizeAuthorRule } from '@geld/core';
import type { ProviderReviewAuthor, ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import type { ProviderReviewPanelEvent } from './review-panel';

export interface HiddenProviderPerson {
  readonly id: string;
  readonly login: string;
  readonly shown: boolean;
  readonly exactRules: readonly string[];
}

export interface ProviderPeopleProjection {
  readonly input: ProviderReviewInput;
  readonly comments: readonly ProviderReviewComment[];
  readonly events: readonly ProviderReviewPanelEvent[];
  readonly people: readonly HiddenProviderPerson[];
  readonly hiddenAnchors: ReadonlyMap<string, string>;
  readonly hiddenEvents: ReadonlyMap<string, string>;
}

export function projectProviderPeople(input: ProviderReviewInput, comments: readonly ProviderReviewComment[], events: readonly ProviderReviewPanelEvent[], rules: readonly string[], shown: ReadonlySet<string>): ProviderPeopleProjection {
  const matcher = compileAuthorRules(rules);
  const authors = new Map<string, ProviderReviewAuthor>();
  for (const author of [...input.threads.flatMap((thread) => thread.comments.map((comment) => comment.author)), ...comments.map((comment) => comment.author), ...(input.reviewers ?? []).map((reviewer) => reviewer.author), ...events.map((event) => event.author), ...(input.bots ?? []).flatMap((bot) => bot.login === undefined ? [] : [{ id: bot.authorId, login: bot.login }])]) {
    if (matcher.hides(author.login) || matcher.hides(`${input.subject.provider}:${author.login}`)) authors.set(author.id, author);
  }
  const people = [...authors.values()].map((author) => ({ id: author.id, login: author.login, shown: shown.has(author.id), exactRules: rules.filter((rule) => {
    const normalized = normalizeAuthorRule(rule)?.toLowerCase();
    return normalized === author.login.toLowerCase() || normalized === `${input.subject.provider}:${author.login}`.toLowerCase();
  }) }));
  const hidden = new Set(people.filter((person) => !person.shown).map((person) => person.id));
  const hiddenAnchors = new Map<string, string>();
  const threads = input.threads.flatMap((thread) => {
    const starter = thread.comments[0];
    const owner = starter !== undefined && hidden.has(starter.author.id) ? starter.author.id : null;
    const visible = thread.comments.filter((comment) => {
      const by = owner ?? (hidden.has(comment.author.id) ? comment.author.id : null);
      if (by === null) return true;
      hiddenAnchors.set(comment.anchor, by);
      return false;
    });
    return visible.length === 0 ? [] : [{ ...thread, comments: visible }];
  });
  const visibleComments = comments.filter((comment) => {
    if (hiddenAnchors.has(comment.anchor)) return false;
    if (!hidden.has(comment.author.id)) return true;
    hiddenAnchors.set(comment.anchor, comment.author.id);
    return false;
  });
  const hiddenEvents = new Map(events.filter((event) => hidden.has(event.author.id)).map((event) => [event.id, event.author.id]));
  return {
    input: { ...input, threads, ...(input.reviewers === undefined ? {} : { reviewers: input.reviewers.filter((reviewer) => !hidden.has(reviewer.author.id)) }), ...(input.bots === undefined ? {} : { bots: input.bots.filter((bot) => !hidden.has(bot.authorId)) }), ...(input.checks === undefined ? {} : { checks: input.checks.filter((check) => check.authorId === undefined || !hidden.has(check.authorId)) }) },
    comments: visibleComments,
    events: events.filter((event) => !hiddenEvents.has(event.id)),
    people, hiddenAnchors, hiddenEvents,
  };
}
