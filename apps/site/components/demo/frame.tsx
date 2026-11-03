import { cn } from 'cn';

export function Frame({ children, className, ...props }: { readonly children: React.ReactNode; readonly className?: string; readonly 'aria-hidden'?: boolean }) {
  return (
    <div className={cn('overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs', className)} {...props}>
      {children}
    </div>
  );
}
