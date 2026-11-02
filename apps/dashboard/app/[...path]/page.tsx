import { Suspense } from 'react';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { parseDashboardRoute } from '@geld/domain';
import { Repositories } from '@/components/repositories';
import { ReviewQueue } from '@/components/review-queue';
import { ReviewScreen } from '@/components/review-screen';
import { RepositorySettings } from '@/components/repository-settings';
export default function ProviderPage({ params }: { readonly params: Promise<{ path: string[] }> }) {
  return (
    <Suspense
      fallback={
        <div className="page" role="status">
          Loading repository...
        </div>
      }
    >
      <ProviderView params={params} />
    </Suspense>
  );
}
async function ProviderView({ params }: { readonly params: Promise<{ path: string[] }> }) {
  await connection();
  const route = parseDashboardRoute((await params).path);
  if (!route) notFound();
  if (route.kind === 'organisation')
    return route.settings ? (
      <RepositorySettings owner={route.owner} provider={route.provider} />
    ) : (
      <Repositories owner={route.owner} provider={route.provider} host={route.host} />
    );
  if (route.kind === 'repository')
    return route.settings ? (
      <RepositorySettings owner={route.ref.owner} provider={route.ref.provider} repository={route.ref} />
    ) : (
      <ReviewQueue repository={route.ref} />
    );
  return <ReviewScreen key={JSON.stringify(route.ref)} reference={route.ref} />;
}
