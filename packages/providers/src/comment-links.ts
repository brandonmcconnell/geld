import type { PullRef } from '@geld/domain';
export function gitlabNoteUrl(ref:PullRef,id:string|number):string {
  const owner=ref.owner.split('/').map(encodeURIComponent).join('/');
  return `https://${ref.host}/${owner}/${encodeURIComponent(ref.repo)}/-/merge_requests/${ref.number}#note_${encodeURIComponent(String(id))}`;
}
