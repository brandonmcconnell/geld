'use client';

import type { ToggleField } from '@geld/core';
import { useId } from 'react';

import { RichText } from '@/components/settings/rich-text';
import { Switch } from '@/components/ui/switch';

export function ToggleRow({
  field,
  checked,
  disabled,
  onChange,
}: {
  readonly field: ToggleField;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  const labelId = useId();
  const helpId = useId();
  return (
    <div className="flex items-start justify-between gap-6 py-4 not-last:border-b">
      <div className="min-w-0">
        <p id={labelId} className="text-sm font-medium">
          {field.label}
        </p>
        <p id={helpId} className="mt-1 text-sm text-muted-foreground">
          <RichText copy={field.description} />
        </p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-labelledby={labelId} aria-describedby={helpId} className="mt-0.5" />
    </div>
  );
}
