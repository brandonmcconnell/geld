import Link from 'next/link';
import { buttonVariants } from '@/components/button';
import { ArrowLeft, ArrowUpRight } from '@/components/icons';
export default function NotFound() {
  return (
    <section className="page error-page">
      <div className="error-content">
        <div className="error-route" aria-hidden="true">
          <span className="error-route-start" />
          <span className="error-route-line" />
          <span className="error-code">404</span>
          <span className="error-route-end" />
        </div>
        <h1>Page not found</h1>
        <p>Check the address, or head back to your review queue.</p>
        <div className="error-actions">
          <Link href="/" className={buttonVariants({ size: 'sm' })}>
            <ArrowLeft size={14} />
            Review queue
          </Link>
          <Link href="/repositories" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
            Repositories
            <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}
