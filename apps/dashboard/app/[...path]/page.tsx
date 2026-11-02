import { Suspense } from 'react';
import Link from 'next/link';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { organisationPath,parseDashboardRoute, repositoryPath } from '@geld/domain';
import { Repositories } from '@/components/repositories';
import { ReviewQueue } from '@/components/review-queue';
import { ReviewScreen } from '@/components/review-screen';
import { RepositorySettings } from '@/components/repository-settings';
export default function ProviderPage({ params }: { readonly params: Promise<{ path: string[] }> }) {
  return <Suspense fallback={<div className="page" role="status">Loading the provider view...</div>}><ProviderView params={params}/></Suspense>;
}
async function ProviderView({ params }: { readonly params: Promise<{ path: string[] }> }) {
  await connection();
  const route = parseDashboardRoute((await params).path);
  if (!route) notFound();
  if (route.kind === 'organisation') return route.settings ? <RepositorySettings owner={route.owner} provider={route.provider}/> : <Repositories owner={route.owner} provider={route.provider} host={route.host}/>;
  if (route.kind === 'repository') return route.settings ? <RepositorySettings owner={route.ref.owner} provider={route.ref.provider} repository={route.ref}/> : <><div className="page pb-0"><nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Review queue</Link><span>/</span><Link href={organisationPath(route.ref)}>{route.ref.owner}</Link><span>/</span><span>{route.ref.repo}</span><Link href={`${repositoryPath(route.ref)}/~settings`} className="ml-auto">Repository settings</Link></nav></div><ReviewQueue repository={route.ref}/></>;
  return <ReviewScreen key={JSON.stringify(route.ref)} reference={route.ref}/>;
}
