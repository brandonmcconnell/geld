import { cn } from 'cn';

/** Consistent vertical rhythm and headings for page sections. */
export function Section({
  id,
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  readonly id?: string;
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: React.ReactNode;
  readonly children?: React.ReactNode;
  readonly className?: string;
}) {
  const headingId = id !== undefined ? `${id}-heading` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={cn('container-site py-16 sm:py-20', className)}>
      <div className="max-w-2xl">
        {eyebrow !== undefined ? <p className="mb-2 font-mono text-xs tracking-wide text-muted-foreground uppercase">{eyebrow}</p> : null}
        <h2 id={headingId} className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {title}
        </h2>
        {description !== undefined ? <div className="mt-3 text-base text-muted-foreground text-pretty">{description}</div> : null}
      </div>
      {children !== undefined ? <div className="mt-10">{children}</div> : null}
    </section>
  );
}

/** Page-level heading block for the secondary pages. */
export function PageIntro({ title, description, eyebrow }: { readonly title: string; readonly description?: React.ReactNode; readonly eyebrow?: string }) {
  return (
    <header className="container-site pt-16 pb-4 sm:pt-24">
      <div className="max-w-2xl">
        {eyebrow !== undefined ? <p className="mb-3 font-mono text-xs tracking-wide text-muted-foreground uppercase">{eyebrow}</p> : null}
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</h1>
        {description !== undefined ? <div className="mt-4 text-lg text-muted-foreground text-pretty">{description}</div> : null}
      </div>
    </header>
  );
}

/** Long-form text container with sensible defaults for links, lists and code. */
export function Prose({ children, className }: { readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <div
      className={cn(
        'max-w-2xl text-[0.95rem] leading-7 text-foreground/90',
        '[&_h2]:mt-12 [&_h2]:mb-3 [&_h2]:scroll-mt-20 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground',
        '[&_h3]:mt-8 [&_h3]:mb-2 [&_h3]:scroll-mt-20 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground',
        '[&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1.5',
        '[&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-3 [&_a:hover]:decoration-foreground',
        '[&_code]:code-chip [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-muted/50 [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-[0.8125rem] [&_pre]:leading-6 [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[length:inherit]',
        '[&_kbd]:rounded-md [&_kbd]:border [&_kbd]:border-b-2 [&_kbd]:bg-muted [&_kbd]:px-1.5 [&_kbd]:py-0.5 [&_kbd]:font-mono [&_kbd]:text-xs',
        '[&_strong]:font-semibold [&_strong]:text-foreground',
        className,
      )}
    >
      {children}
    </div>
  );
}
