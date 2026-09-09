'use client';

import type { ChoiceField, GeldSettings } from '@geld/core';
import { useId } from 'react';

import { RichText } from '@/components/settings/rich-text';
import { Button } from '@/components/ui/button';

/** A setting with a few fixed values, shown as a segmented control (one pressed button). */
export function ChoiceRow<K extends ChoiceField['key']>({
  field,
  value,
  disabled,
  onChange,
}: {
  readonly field: ChoiceField<K>;
  readonly value: GeldSettings[K];
  readonly disabled: boolean;
  readonly onChange: (value: GeldSettings[K]) => void;
}) {
  const labelId = useId();
  const helpId = useId();
  const current = field.options.find((option) => option.value === value);
  return (
    <div className="flex flex-col gap-3 py-4 not-last:border-b sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p id={labelId} className="text-sm font-medium">
          {field.label}
        </p>
        <p id={helpId} className="mt-1 text-sm text-muted-foreground">
          <RichText copy={field.description} />
        </p>
        {current !== undefined ? <p className="mt-2 text-sm text-muted-foreground">{current.description}</p> : null}
      </div>
      <div role="radiogroup" aria-labelledby={labelId} aria-describedby={helpId} className="flex shrink-0 flex-wrap gap-1.5 sm:mt-0.5">
        {field.options.map((option) => {
          const selected = option.value === value;
          return (
            <Button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              size="sm"
              variant={selected ? 'default' : 'outline'}
              disabled={disabled}
              title={option.description}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
