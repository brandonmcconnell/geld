import { cn } from 'cn';

import { ExternalLink } from '@/components/external-link';
import type { Customer } from '@/lib/customers';
import { CUSTOMERS } from '@/lib/customers';

/**
 * An endless, non-interactive reel of customer logos. The list is rendered
 * twice and the track slides by exactly one copy, so the loop has no seam.
 * With reduced motion it is one still, wrapping row instead.
 */
export function LogoReel({ className }: { readonly className?: string }) {
  return (
    <section aria-labelledby="customers-heading" className={cn('container-site', className)}>
      <h2 id="customers-heading" className="text-sm text-muted-foreground">
        Used by founders and engineers at
      </h2>
      <div className="logo-reel mt-6">
        <div className="flex w-max animate-logo-reel motion-reduce:w-full motion-reduce:animate-none">
          <LogoList />
          <LogoList copy />
        </div>
      </div>
    </section>
  );
}

function LogoList({ copy = false }: { readonly copy?: boolean }) {
  return (
    <ul
      className={cn('flex shrink-0 items-center', 'motion-reduce:w-full motion-reduce:shrink motion-reduce:flex-wrap motion-reduce:gap-y-6', copy && 'motion-reduce:hidden')}
      aria-hidden={copy || undefined}
      inert={copy || undefined}
    >
      {CUSTOMERS.map((customer) => (
        <li key={customer.name} className="flex h-10 shrink-0 items-center pr-12 sm:pr-16">
          <CustomerLink customer={customer} />
        </li>
      ))}
    </ul>
  );
}

function CustomerLink({ customer }: { readonly customer: Customer }) {
  const { logo } = customer;
  return (
    <ExternalLink href={customer.url} className="flex items-center gap-2 text-foreground/65 transition-colors hover:text-foreground">
      <span
        aria-hidden="true"
        className="logo-mask"
        style={{ height: logo.height, width: logo.height * logo.aspect, maskImage: `url(${logo.src})`, WebkitMaskImage: `url(${logo.src})` }}
      />
      <span className={customer.markOnly ? 'text-[1.375rem] leading-none font-semibold tracking-tight' : 'sr-only'}>{customer.name}</span>
    </ExternalLink>
  );
}
