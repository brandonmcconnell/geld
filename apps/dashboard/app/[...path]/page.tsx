import { Suspense } from 'react';
import Link from 'next/link';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { parseDashboardRoute, repositoryPath } from '@geld/domain';
import { buttonVariants } from '@geld/ui';
import { Repositories } from '@/components/repositories';
import { ReviewQueue } from '@/components/review-queue';
import { providerClient } from '@/lib/providers';
import { RepositorySettings } from '@/components/repository-settings';
export default function ProviderPage({ params }: { readonly params: Promise<{ path: string[] }> }) {
  return <Suspense fallback={<div className="page" role="status">Loading the provider view...</div>}><ProviderView params={params}/></Suspense>;
}
async function ProviderView({ params }: { readonly params: Promise<{ path: string[] }> }) {
  await connection();
  const route = parseDashboardRoute((await params).path);
  if (!route) notFound();
  if (route.kind === 'organisation') return route.settings ? <RepositorySettings owner={route.owner} provider={route.provider}/> : <Repositories owner={route.owner} provider={route.provider}/>;
  if (route.kind === 'repository') return route.settings ? <RepositorySettings owner={route.ref.owner} provider={route.ref.provider} repository={route.ref}/> : <><div className="page pb-0"><nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Review queue</Link><span>/</span><Link href={`/${route.ref.provider}/${encodeURIComponent(route.ref.owner)}`}>{route.ref.owner}</Link><span>/</span><span>{route.ref.repo}</span><Link href={`${repositoryPath(route.ref)}/~settings`} className="ml-auto">Repository settings</Link></nav></div><ReviewQueue repository={route.ref}/></>;
  const result = await providerClient(route.ref.provider, route.ref.host).then((client) => client.pull(route.ref)).catch(() => null);
  if (!result) return <div className="page"><h1>This provider is not connected</h1><Link href="/connect">Manage connections</Link></div>;
    if (!result.ok) return <div className="page"><h1>This pull request could not be loaded</h1><p className="muted mt-3">{result.reason === 'not_found' ? 'The repository may be private or this pull request may no longer exist.' : 'Check your provider connection and repository installation.'}</p><Link href="/connect" className={buttonVariants({ variant: 'outline', className: 'mt-5' })}>Manage connections</Link></div>;
    const pull = result.value;
    return <div className="page"><nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Review queue</Link><span>/</span><Link href={repositoryPath(pull.ref)}>{pull.ref.owner}/{pull.ref.repo}</Link><span>/</span><span>#{pull.ref.number}</span></nav><h1>{pull.title}</h1><p className="muted mt-3">Opened by {pull.author} · {pull.draft ? 'Draft' : pull.state}</p><p className="mt-8 whitespace-pre-wrap text-sm">{pull.body}</p><a href={pull.url.startsWith('https://') ? pull.url : repositoryPath(pull.ref)} className={buttonVariants({ variant: 'outline', className: 'mt-8' })}>Open on the provider</a></div>;
}
