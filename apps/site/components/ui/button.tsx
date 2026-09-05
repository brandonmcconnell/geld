import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';

const buttonVariants = cva(
  'group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/85',
        // Faint fill plus a slightly stronger border in both schemes (the dark treatment, applied everywhere).
        outline: 'border-input bg-input/20 hover:bg-input/40 hover:text-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
        ghost: 'hover:bg-muted hover:text-foreground dark:hover:bg-muted/60',
        link: 'text-foreground underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-3.5',
        sm: 'h-8 px-3 text-[0.8rem] [&_svg:not([class*="size-"])]:size-3.5',
        lg: 'h-11 px-5 text-[0.95rem] [&_svg:not([class*="size-"])]:size-[18px]',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-11 [&_svg:not([class*="size-"])]:size-[18px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({ className, variant = 'default', size = 'default', ...props }: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
