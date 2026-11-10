'use client';

// Adapted from shadcn/ui's Base UI sidebar. See shadcn-LICENSE.md.
import * as React from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { PanelLeftClose, X } from '@/components/icons';
import { Button } from '@/components/button';

interface SidebarContextProps {
  readonly state: 'expanded' | 'collapsed';
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly openMobile: boolean;
  readonly setOpenMobile: (open: boolean) => void;
  readonly isMobile: boolean;
  readonly toggleSidebar: () => void;
  readonly width: number;
  readonly setWidth: (width: number) => void;
  readonly resizing: boolean;
  readonly setResizing: (resizing: boolean) => void;
}
const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) throw new Error('useSidebar must be used within SidebarProvider.');
  return context;
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  className,
  children,
  navigationKey = '',
  style,
  ...props
}: React.ComponentProps<'div'> & {
  readonly defaultOpen?: boolean;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly navigationKey?: string;
}) {
  const [isMobile, setIsMobile] = React.useState(false);
  const [mobile, setMobile] = React.useState({ key: navigationKey, open: false });
  const openMobile = mobile.key === navigationKey && mobile.open;
  const setOpenMobile = React.useCallback((open: boolean) => setMobile({ key: navigationKey, open }), [navigationKey]);
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const open = openProp ?? internalOpen;
  const [width, setWidth] = React.useState(256);
  const [resizing, setResizing] = React.useState(false);
  const setOpen = React.useCallback(
    (value: boolean) => {
      if (onOpenChange) onOpenChange(value);
      else setInternalOpen(value);
      if (!value)
        requestAnimationFrame(() =>
          document.querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')?.focus(),
        );
    },
    [onOpenChange],
  );
  React.useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const toggleSidebar = React.useCallback(() => {
    if (isMobile) setOpenMobile(!openMobile);
    else setOpen(!open);
  }, [isMobile, open, openMobile, setOpen, setOpenMobile]);
  React.useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.key === 'b' &&
        (event.metaKey || event.ctrlKey) &&
        !(event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable=true]'))
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [toggleSidebar]);
  const state = open ? 'expanded' : 'collapsed';
  const value = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      openMobile,
      setOpenMobile,
      isMobile,
      toggleSidebar,
      width,
      setWidth,
      resizing,
      setResizing,
    }),
    [state, open, setOpen, openMobile, setOpenMobile, isMobile, toggleSidebar, width, resizing],
  );
  const sizing: React.CSSProperties & { '--sidebar-width': string } = { ...style, '--sidebar-width': `${width}px` };
  return (
    <SidebarContext.Provider value={value}>
      <div
        data-slot="sidebar-wrapper"
        data-resizing={resizing}
        style={sizing}
        className={cn('group/sidebar-wrapper flex min-h-svh w-full', className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function Sidebar({ className, children, ...props }: React.ComponentProps<'div'>) {
  const { state, open, isMobile, openMobile, setOpenMobile } = useSidebar();
  if (isMobile)
    return (
      <Dialog.Root open={openMobile} onOpenChange={setOpenMobile}>
        <Dialog.Portal>
          <Dialog.Backdrop className="dialog-backdrop" />
          <Dialog.Popup className={cn('sidebar-sheet', className)} data-slot="sidebar" data-mobile="true" {...props}>
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Dialog.Close className="icon-button sidebar-mobile-close" aria-label="Close navigation">
              <X size={16} />
              <span className="touch-target" aria-hidden="true" />
            </Dialog.Close>
            <div className="cn-sidebar-inner flex size-full flex-col">{children}</div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    );
  return (
    <div
      className="group peer hidden text-sidebar-foreground lg:block"
      data-slot="sidebar"
      data-state={state}
      data-collapsible={state === 'collapsed' ? 'offcanvas' : ''}
      data-side="left"
    >
      <div
        data-slot="sidebar-gap"
        className="cn-sidebar-gap relative w-(--sidebar-width) bg-transparent group-data-[collapsible=offcanvas]:w-0"
      />
      <div
        data-slot="sidebar-container"
        inert={!open}
        aria-hidden={!open || undefined}
        className={cn(
          'fixed inset-y-0 left-0 z-20 hidden h-svh w-(--sidebar-width) border-r border-sidebar-border transition-transform duration-200 ease-linear group-data-[collapsible=offcanvas]:-translate-x-full lg:flex',
          className,
        )}
        {...props}
      >
        <div data-slot="sidebar-inner" className="cn-sidebar-inner flex size-full flex-col">
          {open ? children : null}
        </div>
        <SidebarResizeHandle />
      </div>
    </div>
  );
}

function SidebarResizeHandle() {
  const { width, setWidth, open, setOpen, setResizing } = useSidebar();
  const drag = React.useRef<{ id: number; x: number; width: number; next: number } | null>(null);
  const collapse = () => {
    setOpen(false);
  };
  return (
    <div
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={384}
      aria-valuenow={open ? width : 0}
      aria-valuetext={open ? `${width} pixels. Drag left to collapse.` : 'Collapsed'}
      tabIndex={open ? 0 : -1}
      className="sidebar-resize-handle"
      onDoubleClick={() => setWidth(256)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Home' || (event.key === 'ArrowLeft' && width <= 192)) collapse();
        else
          setWidth(
            event.key === 'End' ? 384 : Math.min(384, Math.max(192, width + (event.key === 'ArrowRight' ? 16 : -16))),
          );
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, width, next: width };
        setResizing(true);
      }}
      onPointerMove={(event) => {
        if (drag.current?.id !== event.pointerId) return;
        const next = Math.max(0, Math.min(384, drag.current.width + event.clientX - drag.current.x));
        drag.current.next = next;
        setWidth(next);
      }}
      onPointerUp={(event) => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        drag.current = null;
        setResizing(false);
        if (current.next < 160) {
          setWidth(current.width);
          collapse();
        } else setWidth(Math.max(192, current.next));
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        if (!drag.current) return;
        setWidth(drag.current.width);
        drag.current = null;
        setResizing(false);
      }}
    />
  );
}

function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<typeof Button>) {
  const { isMobile, open, toggleSidebar } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      data-slot="sidebar-trigger"
      className={cn('sidebar-toggle', className)}
      aria-label={isMobile ? 'Open navigation' : open ? 'Collapse sidebar' : 'Expand sidebar'}
      aria-expanded={isMobile ? undefined : open}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) toggleSidebar();
      }}
      {...props}
    >
      <PanelLeftClose size={16} />
    </Button>
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn('cn-sidebar-header flex flex-col', className)}
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn('cn-sidebar-footer flex flex-col', className)}
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        'cn-sidebar-content flex min-h-0 flex-1 flex-col overflow-auto group-data-[collapsible=icon]:overflow-hidden',
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn('cn-sidebar-group relative flex w-full min-w-0 flex-col', className)}
      {...props}
    />
  );
}

function SidebarGroupLabel({
  className,
  render,
  ...props
}: useRender.ComponentProps<'div'> & React.ComponentProps<'div'>) {
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        className: cn('cn-sidebar-group-label flex shrink-0 items-center outline-hidden [&>svg]:shrink-0', className),
      },
      props,
    ),
    render,
    state: {
      slot: 'sidebar-group-label',
      sidebar: 'group-label',
    },
  });
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn('cn-sidebar-group-content w-full', className)}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      role="list"
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn('cn-sidebar-menu flex w-full min-w-0 flex-col', className)}
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn('group/menu-item relative', className)}
      {...props}
    />
  );
}

const sidebarMenuButtonVariants = cva(
  'cn-sidebar-menu-button peer/menu-button group/menu-button relative flex w-full items-center overflow-hidden outline-hidden disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate',
  {
    variants: {
      variant: {
        default: 'cn-sidebar-menu-button-variant-default',
        outline: 'cn-sidebar-menu-button-variant-outline',
      },
      size: {
        default: 'cn-sidebar-menu-button-size-default',
        sm: 'cn-sidebar-menu-button-size-sm',
        lg: 'cn-sidebar-menu-button-size-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function SidebarMenuButton({
  render,
  isActive = false,
  variant = 'default',
  size = 'default',
  className,
  ...props
}: useRender.ComponentProps<'button'> &
  React.ComponentProps<'button'> & {
    isActive?: boolean;
  } & VariantProps<typeof sidebarMenuButtonVariants>) {
  return useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(
      {
        type: render ? undefined : 'button',
        className: cn(sidebarMenuButtonVariants({ variant, size }), className),
      },
      props,
    ),
    render,
    state: {
      slot: 'sidebar-menu-button',
      sidebar: 'menu-button',
      size,
      active: isActive,
    },
  });
}

function SidebarMenuBadge({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        'cn-sidebar-menu-badge flex items-center justify-center tabular-nums select-none group-data-[collapsible=icon]:hidden',
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      role="list"
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn('cn-sidebar-menu-sub flex min-w-0 flex-col', className)}
      {...props}
    />
  );
}

function SidebarMenuSubItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn('group/menu-sub-item relative', className)}
      {...props}
    />
  );
}

function SidebarMenuSubButton({
  render,
  size = 'md',
  isActive = false,
  className,
  ...props
}: useRender.ComponentProps<'a'> &
  React.ComponentProps<'a'> & {
    size?: 'sm' | 'md';
    isActive?: boolean;
  }) {
  return useRender({
    defaultTagName: 'a',
    props: mergeProps<'a'>(
      {
        className: cn(
          'cn-sidebar-menu-sub-button flex min-w-0 -translate-x-px items-center overflow-hidden outline-hidden group-data-[collapsible=icon]:hidden disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:shrink-0',
          className,
        ),
      },
      props,
    ),
    render,
    state: {
      slot: 'sidebar-menu-sub-button',
      sidebar: 'menu-sub-button',
      size,
      active: isActive,
    },
  });
}

export {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  useSidebar,
};
