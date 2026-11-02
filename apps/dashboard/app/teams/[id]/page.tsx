import { Suspense } from 'react';
import { connection } from 'next/server';
import { TeamDetail } from '@/components/team-detail';
export default function TeamPage({ params }: { readonly params: Promise<{ id: string }> }) { return <Suspense fallback={<div className="page">Loading team...</div>}><Team params={params}/></Suspense>; }
async function Team({params}:{readonly params:Promise<{id:string}>}) { await connection();return <TeamDetail id={(await params).id}/>; }
