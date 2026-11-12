'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from 'cn';

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-6', className)} {...props} />;
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return <TabsPrimitive.List data-slot="tabs-list" className={cn('flex flex-wrap gap-2', className)} {...props} />;
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        'geld-corners geld-cut-[7px] border bg-background/60 px-3 py-1.5 text-sm whitespace-nowrap text-foreground/80 outline-none',
        'hover:border-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
        'data-active:border-foreground data-active:bg-foreground data-active:text-background',
        className,
      )}
      {...props}
    />
  );
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel data-slot="tabs-panel" className={cn('outline-none', className)} {...props} />;
}

export { Tabs, TabsList, TabsTab, TabsPanel };
