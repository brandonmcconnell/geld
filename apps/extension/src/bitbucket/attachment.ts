import { attachmentLinkFor } from '../providers/attachment-lightbox';
import type { ProviderReviewPage } from '../providers/types';

export function bitbucketAttachmentLink(image: HTMLImageElement, page: ProviderReviewPage): HTMLAnchorElement | null {
  return attachmentLinkFor(image, page, (url) => {
    const root = `/${page.repository.path.split('/').map(encodeURIComponent).join('/')}/`;
    return url.pathname.startsWith(root) && /^(?:raw\/|downloads\/|pull-requests\/[1-9]\d*\/attachments\/)/.test(url.pathname.slice(root.length))
      && /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(url.pathname);
  });
}
