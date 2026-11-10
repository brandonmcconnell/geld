import { PREVIEW_HOSTS, previewDocFromMarkdown, previewKey, sourceLink } from '@geld/review';
import type { Preview, ProviderReviewComment, ProviderReviewInput } from '@geld/review';

function safe(value: string | null, origin: string): boolean {
  if (value === null) return true;
  try { const url = new URL(value);return ['https:', 'http:'].includes(url.protocol) && url.username === '' && url.password === '' && url.origin !== origin; }
  catch { return false; }
}

export function providerPreviews(input: ProviderReviewInput, comments: readonly ProviderReviewComment[]): readonly Preview[] {
  const trusted = new Set((input.bots ?? []).map(bot => bot.authorId));
  const seen = new Set<string>();
  const sources = [...input.threads.flatMap(thread => thread.comments), ...comments].filter(comment => {
    if (seen.has(comment.anchor) || comment.author.automated !== true && !trusted.has(comment.author.id)
      || sourceLink({ anchor: comment.anchor, kind: 'comment', author: comment.author.login, url: comment.url }, input.subject) === null) return false;
    seen.add(comment.anchor);return true;
  }).sort((a, b) => Date.parse(a.updatedAt ?? a.createdAt) - Date.parse(b.updatedAt ?? b.createdAt));
  return sources.flatMap(comment => {
    const doc = previewDocFromMarkdown(comment.author.login, comment.anchor, comment.body, comment.updatedAt ?? comment.createdAt);
    for (const host of PREVIEW_HOSTS) {
      const bound = (input.bots ?? []).some(bot => bot.authorId === comment.author.id && bot.id === host.id);
      const previews = host.parse(doc).filter(preview => safe(preview.url, input.subject.origin) && safe(preview.inspectUrl, input.subject.origin)
        && (preview.url !== null || preview.inspectUrl !== null || preview.reason !== undefined || bound));
      if (previews.length > 0) return previews.map(preview => ({ ...preview, host: `native-account:${comment.author.id}:${host.id}` }));
    }
    return [];
  });
}

export function providerPreviewDestination(preview: Preview, all: readonly Preview[], latest: boolean): { readonly href: string; readonly label: string } | null {
  if (preview.url !== null) return { href: preview.url, label: 'Open preview' };
  if (latest) {
    const earlier = all.filter(candidate => {
      if (candidate === preview || candidate.status !== 'ready' || candidate.url === null || previewKey(candidate) !== previewKey(preview)) return false;
      const before = Date.parse(candidate.updatedAt ?? ''), after = Date.parse(preview.updatedAt ?? '');
      return Number.isFinite(before) && Number.isFinite(after) ? before <= after : all.indexOf(candidate) < all.indexOf(preview);
    }).sort((a, b) => {
      const left = Date.parse(a.updatedAt ?? ''), right = Date.parse(b.updatedAt ?? '');
      return Number.isFinite(left) && Number.isFinite(right) ? left - right : all.indexOf(a) - all.indexOf(b);
    }).at(-1);
    if (earlier?.url != null) return { href: earlier.url, label: 'Open last successful preview' };
  }
  return preview.inspectUrl === null ? null : { href: preview.inspectUrl, label: 'Deployment details' };
}
