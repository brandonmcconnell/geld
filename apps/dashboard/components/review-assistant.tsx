'use client';
import {measure} from '@/lib/measurement';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUp, Copy, Sparkles, Square, X } from 'lucide-react';
import { z } from 'zod';
import type { PullRef } from '@geld/domain';
import type { ReviewPlan, ReviewStep } from '@geld/review/plan';
import type { ReviewData } from '@/lib/review-contracts';
import { Button } from '@geld/ui';
import { useDashboard } from './app-shell';
interface Turn { readonly role: 'user' | 'assistant'; readonly content: string }
export function AssistantPanel({ reference, data, plan, currentStep, teamId, onClose }: { readonly reference: PullRef; readonly data: ReviewData; readonly plan: ReviewPlan | null; readonly currentStep: ReviewStep | null; readonly teamId: string; readonly onClose: () => void }) {
  const { session } = useDashboard();
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [model, setModel] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function send(question: string) {
    measure('feature_usage',{feature:'assistant',stage:'started'});
    if (!question.trim() || busy) return;
    const selected = window.getSelection()?.toString().slice(0,8000) ?? '';
    const history = turns.slice(-8);
    const next: readonly Turn[] = [...turns, { role: 'user', content: question }, { role: 'assistant', content: '' }];
    setTurns(next); setMessage(''); setBusy(true); setError('');
    abort.current = new AbortController();
    try {
      const response = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.current.signal, body: JSON.stringify({ ref: reference, teamId: teamId || undefined, plan, stepId: currentStep?.id ?? null, message: question, selection: selected, history, key: crypto.randomUUID() }) });
      if (!response.ok || !response.body) { const value: unknown = await response.json(); const parsed = z.object({ error: z.string() }).safeParse(value); setError(parsed.success ? parsed.data.error : 'The assistant could not respond.'); setTurns(next.slice(0,-1)); return; }
      setModel(response.headers.get('X-Geld-Model') ?? '');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let content = '';
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; content += decoder.decode(chunk.value, { stream: true }); const text = content; setTurns((current) => [...current.slice(0,-1), { role: 'assistant', content: text }]); } } finally { reader.releaseLock(); }
    } catch { if (!abort.current?.signal.aborted) setError('The response was interrupted. Try again.'); }
    finally { setBusy(false); }
  }
  return <aside className="review-assistant" aria-label="Review assistant"><header><span><Sparkles size={15}/>Review assistant</span><button className="icon-button" onClick={onClose} aria-label="Close assistant"><X size={16}/></button></header><div className="assistant-context"><span className="live-dot"/><span>{currentStep ? currentStep.title : data.pull.title}</span></div><div className="assistant-conversation">{turns.length === 0 && <div className="assistant-intro"><Sparkles size={23}/><h3>A second perspective.</h3><p>Ask about this step, check a risk or draft a comment. The assistant knows the plan and the changes you are reading.</p><div>{['Explain this step','What could break?','Where is this tested?','Draft a review comment'].map((question) => <button key={question} onClick={() => send(question)} disabled={busy || !session.user}>{question}<ArrowUp size={11} className="rotate-45"/></button>)}</div></div>}{turns.map((turn, index) => <article className={`assistant-turn ${turn.role}`} key={index}><span>{turn.role === 'user' ? 'You' : 'Assistant'}</span><p>{turn.content || (busy ? 'Thinking...' : '')}</p>{turn.role === 'assistant' && turn.content && <div className="assistant-turn-meta"><small>{model}</small><button className="icon-button" aria-label="Copy assistant response" onClick={() => navigator.clipboard.writeText(turn.content)}><Copy size={12}/></button></div>}</article>)}{error && <p className="status-message" role="status">{error}</p>}</div><form data-measure="assistant" className="assistant-composer" onSubmit={(e) => { e.preventDefault(); void send(message); }}><label className="sr-only" htmlFor="assistant-message">Ask about this review</label><textarea id="assistant-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ask about this change..." rows={3}/><div><span>1 credit per completed response</span>{busy ? <Button variant="ghost" size="icon-sm" aria-label="Stop response" type="button" onClick={() => abort.current?.abort()}><Square size={13}/></Button> : <Button size="icon-sm" type="submit" disabled={!message.trim() || !session.user} aria-label="Send to assistant"><ArrowUp size={15}/></Button>}</div></form><p className="assistant-footnote">AI can miss things. You make the review decision. <Link href="/settings/providers">Provider settings</Link></p></aside>;
}
