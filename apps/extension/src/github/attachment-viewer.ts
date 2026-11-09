import { createAttachmentViewer as sharedViewer } from '../ui/attachment-viewer';

export function createAttachmentViewer(source: HTMLImageElement): ReturnType<typeof sharedViewer> {
  return sharedViewer(source, { prefix: 'geld-lightbox', buttonClass: 'btn btn-sm BtnGroup-item', groupClass: 'BtnGroup' });
}
