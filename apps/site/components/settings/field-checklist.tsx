'use client';

import type { ChecklistField } from '@geld/core';
import { ChevronRightIcon } from 'lucide-react';
import { useId } from 'react';

import { RichText } from '@/components/settings/rich-text';
import { Checkbox } from '@/components/ui/checkbox';

/** A set of ids: one checkbox per option, in a disclosure that starts closed (each option is opt-in). */
export function ChecklistRow({
  field,
  values,
  disabled,
  onChange,
}: {
  readonly field: ChecklistField;
  readonly values: readonly string[];
  readonly disabled: boolean;
  /** One box at a time: the change is applied to the saved set, not to this page's copy of it. */
  readonly onChange: (value: string, checked: boolean) => void;
}) {
  const helpId = useId();
  const on = field.options.filter((option) => values.includes(option.value)).map((option) => option.label);
  return (
    <div className="py-4 not-last:border-b">
      <details className="group/checklist border">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open/checklist:rotate-90 motion-reduce:transition-none" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{field.label}</span>
            <span id={helpId} className="mt-1 block text-sm text-pretty text-muted-foreground">
              <RichText copy={field.description} />
            </span>
          </span>
          {on.length > 0 ? <span className="hidden text-xs text-muted-foreground sm:inline">{on.join(' · ')}</span> : null}
        </summary>
        <ul className="flex flex-col gap-2 border-t bg-muted/30 px-4 py-4" aria-describedby={helpId}>
          {field.options.map((option) => (
            <ChecklistOption key={option.value} label={option.label} description={option.description} checked={values.includes(option.value)} disabled={disabled} onChange={(checked) => onChange(option.value, checked)} />
          ))}
        </ul>
      </details>
    </div>
  );
}

function ChecklistOption({ label, description, checked, disabled, onChange }: { readonly label: string; readonly description: string; readonly checked: boolean; readonly disabled: boolean; readonly onChange: (checked: boolean) => void }) {
  const labelId = useId();
  return (
    <li className="flex items-start gap-3 px-2 py-1.5">
      <span className="mt-0.5 flex items-center">
        <Checkbox checked={checked} disabled={disabled} onCheckedChange={onChange} aria-labelledby={labelId} />
      </span>
      <span className="min-w-0 flex-1">
        <span id={labelId} className="block text-sm">
          {label}
        </span>
        <span className="block text-xs text-muted-foreground">
          <RichText copy={description} />
        </span>
      </span>
    </li>
  );
}
