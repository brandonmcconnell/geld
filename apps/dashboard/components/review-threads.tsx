'use client';
import { useRef, useState } from 'react';
import { Check, MessageSquare, Send } from 'lucide-react';
import { z } from 'zod';
import type { ProviderThread, PullRef } from '@geld/domain';
import { Button } from '@geld/ui';
import { useDashboard } from './app-shell';
export function ReviewThreads({ threads, reference, headSha, onChange }: { readonly threads: readonly ProviderThread[]; readonly reference: PullRef; readonly headSha: string; readonly onChange: () => void }) {
  return <div className="review-threads">{threads.map((thread) => <Thread key={thread.id} thread={thread} reference={reference} headSha={headSha} onChange={onChange}/>)}</div>;
}
function Thread({ thread, reference, headSha, onChange }: { readonly thread: ProviderThread; readonly reference: PullRef; readonly headSha: string; readonly onChange: () => void }) {
  const { session } = useDashboard();
  const mutationKey=useRef({content:'',key:''});
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function write(kind: 'reply' | 'resolve') {
    const content=JSON.stringify({reference,headSha,kind,threadId:thread.id,reply,resolved:!thread.resolved});if(mutationKey.current.content!==content)mutationKey.current={content,key:crypto.randomUUID()};
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: reference, key:mutationKey.current.key, headSha, kind, threadId: thread.id, body: kind === 'reply' ? reply : '', resolved: !thread.resolved }) });
      const value: unknown = await response.json();
      if (response.ok) { mutationKey.current={content:'',key:''}; setReply(''); onChange(); }
      else { const parsed = z.object({ error: z.string() }).safeParse(value); setMessage(parsed.success ? parsed.data.error : 'The thread could not be updated.'); }
    } catch { setMessage('The provider could not confirm this update. Check before trying again.'); }
    setBusy(false);
  }
  return <details className="review-thread" open={!thread.resolved}><summary><span className="flex items-center gap-2">{thread.resolved ? <Check size={14}/> : <MessageSquare size={14}/>}<strong>{thread.path ?? 'Discussion'}{thread.line ? `:${thread.line}` : ''}</strong></span><span>{thread.resolved ? 'Resolved' : 'Open'}{thread.outdated ? ' · Outdated' : ''} · {thread.comments.length} comments</span></summary><div>{thread.comments.map((comment) => <article key={comment.id}><strong>{comment.author}</strong><p>{comment.body}</p></article>)}<form onSubmit={(event) => { event.preventDefault(); void write('reply'); }}><label className="sr-only" htmlFor={`reply-${thread.id}`}>Reply to this thread</label><textarea id={`reply-${thread.id}`} className="field" value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply to this thread..." rows={2}/><div><Button variant="outline" size="sm" type="button" onClick={() => write('resolve')} disabled={busy || !session.user || session.demo}>{thread.resolved ? 'Reopen thread' : 'Resolve thread'}</Button><Button size="sm" type="submit" disabled={busy || !reply.trim() || !session.user || session.demo}><Send size={12}/>Reply</Button></div></form>{message && <p className="status-message" role="status">{message}</p>}</div></details>;
}
