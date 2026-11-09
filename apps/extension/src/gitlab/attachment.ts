import { attachmentLinkFor } from '../providers/attachment-lightbox';
import type { ProviderReviewPage } from '../providers/types';

export function gitLabAttachmentLink(image: HTMLImageElement, page: ProviderReviewPage): HTMLAnchorElement | null {
  return attachmentLinkFor(image, page, (url) => /\/(?:uploads\/[a-f0-9]{32,64}\/|raw\/)/i.test(url.pathname)
    && /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(url.pathname));
}
