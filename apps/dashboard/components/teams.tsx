'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Users } from 'lucide-react';
import { z } from 'zod';
import { Button, buttonVariants } from '@geld/ui';
import { EmptyState } from './app-shell';
const teamsSchema = z.object({ teams: z.array(z.object({ id: z.string(), name: z.string(), role: z.string(), tier: z.string(), seats: z.number() })) });
export function Teams() {
  const [teams, setTeams] = useState<z.infer<typeof teamsSchema>['teams']>([]);
  const [name, setName] = useState(''); const [message, setMessage] = useState(''); const [busy,setBusy] = useState(false);
  const [revision,setRevision] = useState(0);
  useEffect(() => { const abort = new AbortController(); fetch('/api/teams', { signal: abort.signal }).then(async (response) => { const value: unknown = await response.json(); const parsed = teamsSchema.safeParse(value); if (parsed.success) setTeams(parsed.data.teams); }).catch(() => undefined); return () => abort.abort(); }, [revision]);
  return <div className="page"><div className="page-heading"><div><p className="eyebrow">WORK TOGETHER</p><h1>Teams</h1><p>One billable workspace for the people and repositories you review with.</p></div><Link href="/settings/billing" className={buttonVariants({ variant: 'outline', size: 'sm' })}>Plans and billing</Link></div>{teams.length ? <div className="team-grid">{teams.map((team) => <Link href={`/teams/${encodeURIComponent(team.id)}`} className="team-card" key={team.id}><Users size={21}/><h2>{team.name}</h2><p>{team.seats} member{team.seats === 1 ? '' : 's'} · {team.tier} plan</p><span>{team.role} ↗</span></Link>)}</div> : <EmptyState icon={Users} title="Your teams live here">Sign in to create a personal workspace and invite teammates.</EmptyState>}<section className="settings-card"><h2>Create a team</h2><p>A team can span GitHub, GitLab and Bitbucket. Team administration does not grant provider permissions.</p><form className="flex gap-3 max-w-lg" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { const response = await fetch('/api/teams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); const value: unknown = await response.json(); const error = z.object({ error: z.string() }).safeParse(value); if (response.ok) { setName(''); setRevision((value) => value + 1); setMessage('Team created.'); } else setMessage(error.success ? error.data.error : 'This team could not be created.'); } catch { setMessage('This team could not connect.'); } setBusy(false); }}><label className="sr-only" htmlFor="team-name">Team name</label><input id="team-name" className="field" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} placeholder="Team name"/><Button type="submit" disabled={busy}><Plus size={15}/>Create</Button></form></section>{message && <p role="status" className="status-message">{message}</p>}</div>;
}
