import { PageIntro } from '@/components/section';

/** Shown while the gist is being read; also gives the dynamic page its Suspense boundary. */
export default function SettingsLoading() {
  return (
    <>
      <PageIntro eyebrow="Settings" title="Your Geld settings." description="Loading your settings from GitHub…" />
      <div className="container-site pb-32" aria-busy="true">
        <div className="flex flex-col gap-6">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-40 animate-pulse border bg-muted/40 motion-reduce:animate-none" />
          ))}
        </div>
      </div>
    </>
  );
}
