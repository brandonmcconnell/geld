import Link from 'next/link';
import { buttonVariants } from '@/components/button';
import { ArrowLeft, ArrowUpRight } from '@/components/icons';
export default function NotFound() {
  return (
    <div className="page error-page">
      <div className="error-code">404 · Page not found</div>
      <h1>This path ends here.</h1>
      <p>The page may have moved, or the repository link may be incomplete.</p>
      <div>
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
  );
}
