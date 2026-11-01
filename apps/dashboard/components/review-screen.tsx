'use client';
import { measure } from '@/lib/measurement';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Dialog } from '@base-ui/react/dialog';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  Flag,
  GitPullRequest,
  ListTree,
  MessageSquare,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from 'cn';
import { z } from 'zod';
import type { PullRef } from '@geld/domain';
import { organisationPath, pullPath, repositoryPath } from '@geld/domain';
import { reconcileProgress, reviewPlanSchema } from '@geld/review/plan';
import type { ReviewPlan, StepProgress } from '@geld/review/plan';
import { Button, buttonVariants } from '@geld/ui';
import { readEnterpriseInBrowser } from '@/lib/enterprise-reader';
import { reviewContextSchema, progressSchema } from '@/lib/review-contracts';
import type { ReviewData } from '@/lib/review-contracts';
import { useDashboard, EmptyState } from './app-shell';
import { DiffView } from './diff-view';
import type { LineSelection } from './diff-view';
import {ConsolidatedFindings} from './consolidated-findings';
import type {ConsolidatedResult} from './consolidated-findings';
import { ReviewThreads } from './review-threads';
import { TrackerLinks } from './tracker-links';
import { ProviderActions } from './provider-actions';
import { Assignments } from './assignments';
import { AssistantPanel } from './review-assistant';
const guideResponse = z.object({
  plan: reviewPlanSchema,
  sample: z.boolean().optional(),
});
const failureSchema = z.object({ error: z.string() });
const storedSchema = z.object({
  plan: reviewPlanSchema.nullable(),
  progress: progressSchema,
});

export function ReviewScreen({ reference }: { readonly reference: PullRef }) {
  const { session, loading, activeTeam } = useDashboard();
  const owner = session.user?.id ?? (session.demo ? 'demo' : null);
  if (loading && !owner) return <div className="page" role="status">Loading your review workspace...</div>;
  return <ReviewWorkspace key={`${owner ?? 'anonymous'}:${activeTeam}:${pullPath(reference)}`} reference={reference} owner={owner} />;
}
function ReviewWorkspace({ reference, owner }: { readonly reference: PullRef; readonly owner: string | null }) {
  const { session, teams, activeTeam, setActiveTeam } = useDashboard();
  const teamId = activeTeam;
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [plan, setPlan] = useState<ReviewPlan | null>(null);
  const [progress, setProgress] = useState<Readonly<Record<string, StepProgress>>>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [mode, setMode] = useState('guide');
  const [consolidated,setConsolidated]=useState<ConsolidatedResult|null>(null);
  const [planning, setPlanning] = useState(false);
  const [notice, setNotice] = useState('');
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagNote, setFlagNote] = useState('');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [event, setEvent] = useState('comment');
  const [body, setBody] = useState('');
  const [draftHead, setDraftHead] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [line, setLine] = useState<LineSelection | null>(null);
  const [assistantOpen, setAssistantOpen] = useState<boolean | null>(null);
  const wide = useSyncExternalStore(subscribeWide,wideSnapshot,()=>false);
  const showAssistant = assistantOpen ?? wide;
  const mutationKey = useRef({content:'',key:''});
  const key = owner ? `geld.review.v2:${encodeURIComponent(owner)}:${pullPath(reference)}${teamId ? `:team:${encodeURIComponent(teamId)}` : ''}` : null;
  const loadedKey = useRef('');
  const current = plan?.steps[stepIndex];
  const completed =
    plan?.steps.filter((step) => progress[step.id]?.state === 'accepted' || progress[step.id]?.state === 'flagged')
      .length ?? 0;
  const finished = !!plan?.steps.length && completed === plan.steps.length;
  const stale = !!data && !!plan && data.pull.headSha !== plan.headSha;
  const params = new URLSearchParams({
    provider: reference.provider,
    host: reference.host,
    owner: reference.owner,
    repo: reference.repo,
    number: String(reference.number),
  }).toString();
  useEffect(() => {
    const abort = new AbortController();
    const read=async()=>{const direct=await readEnterpriseInBrowser(reference,abort.signal);return direct?Response.json(direct):fetch(`/api/pull?${params}`,{signal:abort.signal});};
    read().then(async (response) => {
      const value: unknown = await response.json();
      if (abort.signal.aborted) return;
      const parsed = reviewContextSchema.safeParse(value);
      if (!response.ok || !parsed.success) { const failure = failureSchema.safeParse(value); setError(failure.success ? failure.data.error : 'The pull request could not be loaded.'); setLoading(false); return; }
      setData(parsed.data); setError(''); setLoading(false);
      if (key && loadedKey.current !== key) {
        try { const raw = localStorage.getItem(key); const stored = raw ? storedSchema.safeParse(JSON.parse(raw)) : null; if (stored?.success) { setPlan(stored.data.plan); setProgress(stored.data.progress); } else { setPlan(null); setProgress({}); } } catch { setPlan(null); setProgress({}); }
        setStepIndex(0); loadedKey.current = key;
      }
    }).catch(() => { if (!abort.signal.aborted) { setError('The provider could not be reached. Try again.'); setLoading(false); } });
    return () => abort.abort();
  }, [params, key, revision,reference]);
  useEffect(() => {
    if (!teamId || !data || (plan && plan.headSha === data.pull.headSha)) return;
    const abort = new AbortController();
    const headSha = data.pull.headSha;
    fetch(`/api/guides?${params}&teamId=${encodeURIComponent(teamId)}`, { signal: abort.signal }).then(async response => {
      const value: unknown = await response.json();
      const saved = z.object({ plan: reviewPlanSchema.nullable() }).safeParse(value);
      if (abort.signal.aborted || !response.ok || !saved.success || !saved.data.plan || saved.data.plan.headSha !== headSha) return;
      const next = saved.data.plan;
      setPlan(next); setProgress(previous => reconcileProgress(next,previous)); setStepIndex(0);
    }).catch(() => undefined);
    return () => abort.abort();
  }, [teamId,params,data,plan]);

  function persist(nextPlan: ReviewPlan | null, nextProgress: Readonly<Record<string, StepProgress>>) {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify({ plan: nextPlan, progress: nextProgress })); } catch { setNotice('Progress could not be saved on this device.'); }
  }
  function mark(state: 'accepted' | 'flagged', note = '') {
    if (!current || stale || error) return;
    const next = { ...progress, [current.id]: { state, fingerprint: current.fingerprint, note, at: new Date().toISOString() } };
    setProgress(next); persist(plan, next); setFlagOpen(false); setFlagNote('');
    if (plan) setStepIndex((value) => Math.min(value + 1, plan.steps.length - 1));
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input,textarea,select,[contenteditable=true]')) return;
      if (e.key === '[') setStepIndex((value) => Math.max(0, value - 1));
      if (e.key === ']' && plan) setStepIndex((value) => Math.min(value + 1, plan.steps.length - 1));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [plan]);
  async function generate() {
    if (!data || error) return;
    measure('feature_usage',{feature:'guide',stage:'started'});setPlanning(true); setNotice('');
    try {
      const response = await fetch('/api/guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref: reference,
          headSha: data.pull.headSha,
          ...(plan ? { previousHeadSha: plan.headSha } : {}),
          ...(teamId ? { teamId } : {}),
          key: crypto.randomUUID(),
          sample: session.demo,
        }),
      });
      const value: unknown = await response.json();
      const parsed = guideResponse.safeParse(value);
      if (!response.ok || !parsed.success) {
        const error = failureSchema.safeParse(value);
        setNotice(error.success ? error.data.error : 'The guide could not be created.');
      } else {
        const nextProgress = reconcileProgress(parsed.data.plan, progress);
        setPlan(parsed.data.plan);
        setProgress(nextProgress);
        setStepIndex(0);
        persist(parsed.data.plan, nextProgress);
      }
    } catch {
      setNotice('The guide could not connect. Try again.');
    }
    setPlanning(false);
  }
  function openReview() {
    if (!data || error || (mode === 'guide' && stale)) return;
    const reviewedPlan = mode === 'guide' ? plan : null;
    const notes = reviewedPlan?.steps.filter((step) => progress[step.id]?.state === 'flagged').map((step) => `- ${step.title}: ${progress[step.id]?.note ?? ''}`).join('\n') ?? '';
    setDraftHead(reviewedPlan?.headSha ?? data.pull.headSha); setEvent('comment'); setBody(notes); setLine(null); setSubmitOpen(true);
  }
  async function post() {
    if (!data || !draftHead || draftHead !== data.pull.headSha || error) { setNotice('The pull request changed or could not be verified. Review the current changes and open a new draft.'); return; }
    const content=JSON.stringify({reference,event,body,line,head:draftHead}); if(mutationKey.current.content!==content) mutationKey.current={content,key:crypto.randomUUID()};
    setPosting(true); setNotice('');
    try {
      const response = await fetch('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: reference, key: mutationKey.current.key, kind: line ? 'line_comment' : 'review', event, body, headSha: draftHead, ...(line ?? {}) }) });
      const value: unknown = await response.json();
      if (response.ok) { mutationKey.current={content:'',key:''}; setNotice(line ? 'Comment posted on the provider.' : 'Review submitted on the provider.'); setSubmitOpen(false); setBody(''); setRevision((value) => value + 1); }
      else { const error = failureSchema.safeParse(value); setNotice(error.success ? error.data.error : 'The provider could not confirm this review.'); }
    } catch { setNotice('The review could not connect. Check the provider before trying again.'); }
    setPosting(false);
  }
  if (loading) return <div className="page" role="status">Loading the pull request and its changes...</div>;
  if (!data) return <div className="page"><EmptyState icon={GitPullRequest} title="This pull request could not be loaded" action={<Link href="/connect" className={buttonVariants({ variant: 'outline' })}>Manage connections</Link>}>{error || 'Check the repository installation and your provider access.'}</EmptyState></div>;
  return <div className="review-page"><header className="review-header"><nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Review queue</Link><span>/</span><Link href={organisationPath(reference)}>{reference.owner}</Link><span>/</span><Link href={repositoryPath(reference)}>{reference.repo}</Link><span>/</span><span>#{reference.number}</span></nav><div className="review-title-row"><div><h1>{data.pull.title}</h1><p className="muted mt-2"><span className={data.pull.draft ? 'draft-badge' : 'open-badge'}>{data.pull.draft ? 'Draft' : data.pull.state}</span> {data.pull.author} <span className="muted-slash">·</span> {data.files.length} files changed <span className="muted-slash">·</span> <span className="font-mono">+{data.files.filter((file) => !file.hidden).reduce((sum, file) => sum + file.additions, 0)} −{data.files.filter((file) => !file.hidden).reduce((sum, file) => sum + file.deletions, 0)}</span> excluding hidden files</p></div><a href={data.pull.url.startsWith('https://') ? data.pull.url : '#'} className="icon-button" aria-label="Open on provider" target="_blank" rel="noreferrer"><ArrowUpRight size={18}/></a></div><div className="review-tabs"><div><button className={mode === 'guide' ? 'selected' : ''} onClick={() => setMode('guide')}><Sparkles size={14}/>Guided review{plan && <span>{completed}/{plan.steps.length}</span>}</button><button className={mode === 'files' ? 'selected' : ''} onClick={() => setMode('files')}><ListTree size={14}/>All changes</button><button className={mode === 'conversation' ? 'selected' : ''} onClick={() => setMode('conversation')}><MessageSquare size={14}/>Conversation</button></div><div><Button variant="ghost" size="icon-sm" aria-label="Reload pull request" onClick={() => setRevision((value) => value + 1)}><RefreshCw size={14}/></Button><Button variant="outline" size="sm" onClick={() => setAssistantOpen((value) => !(value ?? wide))}><Sparkles size={13}/>Assistant</Button><Button size="sm" onClick={openReview} disabled={!session.user || session.demo || !!error || (mode === 'guide' && stale)}>Submit review <ChevronDown size={13}/></Button></div></div></header>
    {error && <p className="review-banner" role="alert">Refresh failed. {error} The displayed changes may be out of date.</p>}{session.demo && <p className="review-banner">Local demonstration. The sample guide previews AI output. Provider writes and live AI calls are disabled.</p>}{data.settingsWarning && <p className="review-banner">{data.settingsWarning}</p>}{stale && <div className="review-banner">This pull request has new changes. Replan before continuing this guide. <button onClick={generate} disabled={planning}>Replan</button></div>}{data.threadsUnavailable && <p className="review-banner">Review threads could not be loaded. Open the provider for the complete discussion.</p>}{notice && <div className="review-banner" role="status">{notice}</div>}
    <TrackerLinks reference={reference}/><Assignments reference={reference}/>{session.user&&!session.demo&&<div className="review-banner"><ProviderActions reference={reference} data={data} onChange={()=>setRevision(v=>v+1)}/></div>}<div className={cn('review-layout', showAssistant && 'with-assistant')}>
      {mode === 'guide' && plan && <aside className="step-sidebar"><div className="step-sidebar-heading"><span>REVIEW PLAN</span><small>{completed} of {plan.steps.length} complete</small></div><div className="step-progress-track"><span style={{ width: `${plan.steps.length ? completed / plan.steps.length * 100 : 0}%` }}/></div><ol>{plan.steps.map((step, index) => <li key={step.id}><button className={cn('step-link', stepIndex === index && 'active')} onClick={() => setStepIndex(index)} aria-current={stepIndex === index ? 'step' : undefined}><span className={cn('step-number', progress[step.id]?.state)}>{progress[step.id]?.state === 'accepted' ? <Check size={12}/> : progress[step.id]?.state === 'flagged' ? <Flag size={12}/> : index + 1}</span><span><strong>{step.title}</strong><small>{step.touches.length} review items{step.supporting.length ? ` · ${step.supporting.length} supporting` : ''}{progress[step.id]?.state === 'changed' ? ' · Changed' : ''}</small></span></button></li>)}</ol><div className="step-sidebar-footer"><Button variant="ghost" size="sm" onClick={generate} disabled={planning}>{planning ? 'Planning...' : 'Replan with AI'}</Button><small>{plan.model}</small>{plan.excerpted && <small>This plan used excerpts from large changes.</small>}<small><kbd>[</kbd> <kbd>]</kbd> Switch steps</small></div></aside>}
      <div className="review-main">{mode === 'conversation' ? <><ConsolidatedFindings data={data} reference={reference} teamId={teamId} rewritten={consolidated} onRewrite={result=>{setConsolidated(result);setData(previous=>previous&&previous.pull.headSha===result.head?{...previous,...result.discussion}:previous);}} onChange={()=>setRevision(value=>value+1)}/><div className="review-description"><h2>About this change</h2><p>{data.pull.body || 'No description provided.'}</p></div>{data.commentsUnavailable && <p className="inline-note">Some conversation content could not be loaded. Open the provider for the complete discussion.</p>}{data.comments.map((comment) => <article className="review-comment" key={comment.id}><strong>{comment.author}</strong><p>{comment.body}</p></article>)}</> : mode === 'files' ? <><div className="review-section-heading"><h2>Essential changes</h2><span>{data.files.filter((file) => !file.hidden).length} files</span></div><DiffView files={data.files.filter((file) => !file.hidden)} onComment={(selection) => { setDraftHead(data.pull.headSha); setLine(selection); setBody(''); setSubmitOpen(true); }}/><ReviewThreads threads={data.threads} reference={reference} headSha={data.pull.headSha} onChange={() => setRevision((value) => value + 1)}/><details className="supporting-section"><summary>Supporting and hidden changes <span>{data.files.filter((file) => file.hidden).length} files</span></summary><DiffView files={data.files.filter((file) => file.hidden)} supporting/></details></> : !plan ? <div className="guide-intro"><span className="guide-intro-icon"><Sparkles size={28}/></span><p className="eyebrow">FOLLOW THE CHANGE</p><h2>Start with the story.</h2><p>Turn the diff into a walkthrough. Each step connects related changes across files, explains their purpose and keeps supporting changes close.</p><div className="guide-intro-facts"><span><ListTree size={14}/>{data.files.filter((file) => !file.hidden).length} essential files</span><span><CheckCheck size={14}/>{data.files.filter((file) => file.hidden).length} supporting files</span></div>{!session.demo && <label className="guide-team-field">Team<select className="field" value={teamId} onChange={event=>setActiveTeam(event.target.value)}><option value="">Choose a team</option>{teams.map(team=><option value={team.id} key={team.id}>{team.name}</option>)}</select></label>}<Button data-measure="guide" onClick={generate} disabled={planning || !session.user}><Sparkles size={15}/>{planning ? 'Planning the review...' : session.demo ? 'Preview a sample AI guide' : 'Plan this review with AI'}</Button><p className="guide-cost-note">{session.demo ? 'Sample output only. No AI request or charge.' : 'Uses 1 credit, or 3 for more than 1,500 changed lines. Requires a paid plan and an AI provider.'}</p><Link href="/settings/providers" className="guide-settings-link">Configure AI providers <ArrowUpRight size={12}/></Link></div> : stale ? <div className="guide-intro"><h2>Update this guide before reviewing its changes.</h2><p>The saved story belongs to a previous version. Replan or open All changes to inspect the current diff.</p></div> : current && <><div className="step-story"><div className="step-story-eyebrow"><span>STEP {stepIndex + 1} OF {plan.steps.length}</span><span>{current.kind}</span></div><h2>{current.title}</h2><p>{current.story ?? 'These remaining changes need your attention. Read their hunks before completing the review.'}</p>{current.why && <p className="step-why">{current.why}</p>}{current.watch.length > 0 && <div className="step-watch"><Flag size={13}/><ul>{current.watch.map((watch) => <li key={watch}>{watch}</li>)}</ul></div>}</div><DiffView files={data.files} refs={current.touches} onComment={(selection) => { setDraftHead(data.pull.headSha); setLine(selection); setBody(''); setSubmitOpen(true); }}/><ReviewThreads threads={data.threads.filter((thread) => current.touches.some((ref) => ref.path === thread.path))} reference={reference} headSha={data.pull.headSha} onChange={() => setRevision((value) => value + 1)}/>{current.supporting.length > 0 && <details className="supporting-section"><summary>Supporting changes <span>{current.supporting.length} review items</span></summary><DiffView files={data.files} refs={current.supporting} supporting/></details>}<div className="step-actions"><Button variant="ghost" size="sm" onClick={() => setStepIndex((value) => Math.max(0, value - 1))} disabled={stepIndex === 0}><ArrowLeft size={14}/>Previous</Button><div><Button variant="outline" size="sm" onClick={() => { setFlagNote(progress[current.id]?.note ?? ''); setFlagOpen(true); }} disabled={stale}><Flag size={14}/>Flag with a note</Button><Button size="sm" data-measure="review-step" onClick={() => mark('accepted')} disabled={stale}><Check size={14}/>Accept and next <ArrowRight size={14}/></Button></div></div>{finished && <div className="review-finish"><CheckCheck size={25}/><div><h3>You have reached the end.</h3><p>{plan.steps.filter((step) => progress[step.id]?.state === 'accepted').length} accepted · {plan.steps.filter((step) => progress[step.id]?.state === 'flagged').length} flagged</p></div><Button onClick={openReview} disabled={!session.user || session.demo || !!error || stale}>Finish your review</Button></div>}</>}
      </div>{showAssistant && <AssistantPanel reference={reference} data={data} plan={plan} currentStep={current ?? null} teamId={teamId} onClose={() => setAssistantOpen(false)}/>}
    </div>
    <Dialog.Root open={flagOpen} onOpenChange={setFlagOpen}><Dialog.Portal><Dialog.Backdrop className="dialog-backdrop"/><Dialog.Popup className="privacy-dialog"><Dialog.Title className="text-lg font-medium">Flag this step</Dialog.Title><Dialog.Description className="muted mt-2">Keep a note for your final review. Nothing is posted yet.</Dialog.Description><form className="form-stack mt-5" onSubmit={(e) => { e.preventDefault(); mark('flagged', flagNote); }}><label>What needs another look?<textarea className="field" value={flagNote} onChange={(e) => setFlagNote(e.target.value)} required/></label><Button data-measure="review-submit" type="submit">Flag and continue</Button></form></Dialog.Popup></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={submitOpen} onOpenChange={setSubmitOpen}><Dialog.Portal><Dialog.Backdrop className="dialog-backdrop"/><Dialog.Popup className="privacy-dialog"><div className="flex justify-between"><Dialog.Title className="text-lg font-medium">{line ? 'Comment on this change' : 'Submit your review'}</Dialog.Title><Dialog.Close className="icon-button" aria-label="Close review composer"><X size={17}/></Dialog.Close></div><Dialog.Description className="muted mt-2">{line ? `${line.path} · line ${line.line}` : 'This posts to the provider as you. Review your words before sending.'}</Dialog.Description><form className="form-stack mt-5" onSubmit={(e) => { e.preventDefault(); void post(); }}>{!line && <label>Review decision<select className="field" value={event} onChange={(e) => setEvent(e.target.value)}><option value="comment">Comment</option><option value="approve">Approve</option><option value="request_changes">Request changes</option></select></label>}<label>{line ? 'Comment' : 'Review summary'}<textarea className="field" value={body} onChange={(e) => setBody(e.target.value)} required={!!line || event !== 'approve'}/></label><Button data-measure="review-submit" type="submit" disabled={posting || !session.user || session.demo || !!error || draftHead !== data.pull.headSha}>{posting ? 'Posting...' : line ? 'Post comment' : event === 'approve' ? 'Approve pull request' : event === 'request_changes' ? 'Request changes' : 'Submit comment review'}</Button>{draftHead !== data.pull.headSha && <p role="alert">This draft belongs to an older version. Review the current changes and open a new draft.</p>}{session.demo && <p className="muted">Provider writes are disabled in the local demonstration.</p>}{notice && <p className="muted" role="status">{notice}</p>}</form></Dialog.Popup></Dialog.Portal></Dialog.Root>
  </div>;
}

function subscribeWide(callback: () => void) {
  const media = window.matchMedia('(min-width: 1440px)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}
function wideSnapshot() {
  return window.matchMedia('(min-width: 1440px)').matches;
}
