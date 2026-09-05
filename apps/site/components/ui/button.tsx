import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';

const buttonStyles = cva(
  'group/button geld-corners inline-flex shrink-0 items-center justify-center gap-2 border text-sm font-medium whitespace-nowrap outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/85',
        // Faint fill plus a slightly stronger border in both schemes (the dark treatment, applied everywhere).
        outline: 'border-input bg-input/20 hover:bg-input/40 hover:text-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-accent',
        ghost: 'border-transparent hover:bg-muted hover:text-foreground dark:hover:bg-muted/60',
        link: 'border-transparent text-foreground underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-3.5',
        sm: 'h-8 px-3 text-[0.8rem] geld-cut-[7px] [&_svg:not([class*="size-"])]:size-3.5',
        lg: 'h-11 px-5 text-[0.95rem] geld-cut-[10px] [&_svg:not([class*="size-"])]:size-[18px]',
        icon: 'size-9',
        'icon-sm': 'size-8 geld-cut-[7px]',
        'icon-lg': 'size-11 geld-cut-[10px] [&_svg:not([class*="size-"])]:size-[18px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

/**
 * Class list for a button. Always merged with `cn` so a variant's border or
 * colour wins over the base (cva alone concatenates, and stylesheet order then
 * decides — which is how outline buttons once lost their border).
 */
function buttonVariants(props: VariantProps<typeof buttonStyles> & { readonly className?: string | undefined } = {}): string {
  return cn(buttonStyles(props));
}

function Button({ className, variant = 'default', size = 'default', ...props }: ButtonPrimitive.Props & VariantProps<typeof buttonStyles>) {
  // Base UI accepts a className callback keyed on button state; resolve it before merging.
  const resolved = typeof className === 'function' ? (state: ButtonPrimitive.State) => buttonVariants({ variant, size, className: className(state) }) : buttonVariants({ variant, size, className });
  return <ButtonPrimitive data-slot="button" className={resolved} {...props} />;
}

export { Button, buttonVariants };
