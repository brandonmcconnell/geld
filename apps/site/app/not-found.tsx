import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';

export default function NotFound() {
  return (
    <section aria-labelledby="not-found-heading" className="container-site flex flex-col items-start gap-6 py-32">
      <p className="font-mono text-xs text-muted-foreground">404</p>
      <h1 id="not-found-heading" className="text-3xl font-semibold tracking-tight">
        There is no page here.
      </h1>
      <p className="max-w-md text-muted-foreground">Nothing lives at this address. The link may be out of date, or the page may have moved.</p>
      <Link href="/" className={buttonVariants({ variant: 'outline' })}>
        Back to the start
      </Link>
    </section>
  );
}
