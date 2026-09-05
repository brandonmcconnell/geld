import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';

export default function NotFound() {
  return (
    <section aria-labelledby="not-found-heading" className="container-site flex flex-col items-start gap-6 py-32">
      <p className="font-mono text-xs text-muted-foreground">404</p>
      <h1 id="not-found-heading" className="text-3xl font-semibold tracking-tight">
        This page is hidden. Permanently.
      </h1>
      <p className="max-w-md text-muted-foreground">There is nothing at this address, and no toggle to bring it back.</p>
      <Link href="/" className={buttonVariants({ variant: 'outline' })}>
        Back to the start
      </Link>
    </section>
  );
}
