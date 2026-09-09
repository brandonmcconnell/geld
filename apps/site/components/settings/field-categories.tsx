'use client';

import type { AnyCategoryId, BuiltInCategory, CategoriesField, CategoryId, GeldSettings, PatternGroup } from '@geld/core';
import { CATEGORIES, categoryPatternLines, describeAdvancedSettings, hasAdvancedSettings, isCategoryEnabled, isGroupEnabled } from '@geld/core';
import { ChevronRightIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { CategoryIcon } from '@/components/category-icon';
import type { LinesSaveResult } from '@/components/settings/field-list';
import { LinesEditor } from '@/components/settings/field-list';
import { RichText } from '@/components/settings/rich-text';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { validatePatternLines } from '@/lib/settings/patch';

interface CategoriesProps {
  readonly field: CategoriesField;
  readonly settings: GeldSettings;
  readonly disabled: boolean;
  readonly onCategory: (id: AnyCategoryId, value: boolean) => void;
  readonly onGroup: (categoryId: CategoryId, groupId: string, value: boolean) => void;
  readonly onPatterns: (categoryId: CategoryId, lines: readonly string[]) => Promise<LinesSaveResult>;
}

/**
 * One row per built-in category with its switch. Each opens to an "Advanced"
 * area: the built-in pattern groups (each can be unticked) and the user's own
 * patterns for the category. The area starts open only when something in it
 * is in use, so the page stays short by default.
 */
export function CategoriesRows({ field, settings, disabled, onCategory, onGroup, onPatterns }: CategoriesProps) {
  return (
    <div>
      <p className="text-sm font-medium">{field.label}</p>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        <RichText copy={field.description} />
      </p>
      <ul className="divide-y border">
        {CATEGORIES.map((category) => (
          <CategoryRow key={category.id} category={category} field={field} settings={settings} disabled={disabled} onCategory={onCategory} onGroup={onGroup} onPatterns={onPatterns} />
        ))}
      </ul>
    </div>
  );
}

function CategoryRow({
  category,
  field,
  settings,
  disabled,
  onCategory,
  onGroup,
  onPatterns,
}: {
  readonly category: BuiltInCategory;
} & Omit<CategoriesProps, 'field'> & { readonly field: CategoriesField }) {
  const helpId = useId();
  // Decided once per page load: open when a group is off or extra patterns exist.
  const [open, setOpen] = useState(() => hasAdvancedSettings(settings, category.id));
  const enabled = isCategoryEnabled(settings, category.id);
  const customised = describeAdvancedSettings(settings, category.id);
  return (
    <li>
      <details className="group/category" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/category:rotate-90 motion-reduce:transition-none" />
          <CategoryIcon name={category.icon} className="text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{category.title}</span>
            <span id={helpId} className="block text-sm text-muted-foreground">
              {category.description}
            </span>
          </span>
          {customised !== null ? <span className="hidden text-xs text-muted-foreground sm:inline">{customised}</span> : null}
          {/* Sits in the summary but must not toggle the disclosure. */}
          <span onClick={(event) => event.preventDefault()} className="flex items-center">
            <Switch checked={enabled} disabled={disabled} onCheckedChange={(value) => onCategory(category.id, value)} aria-label={`Hide ${category.title.toLowerCase()}`} aria-describedby={helpId} />
          </span>
        </summary>
        <div className="flex flex-col gap-5 border-t bg-muted/30 px-4 py-4">
          <p className="text-sm text-muted-foreground">{field.advanced.description}</p>
          <div>
            <p className="mb-2 text-sm">
              <span className="font-medium">{field.advanced.groupsLabel}</span> <span className="text-muted-foreground">{field.advanced.groupsDescription}</span>
            </p>
            <ul className="flex flex-col gap-2">
              {category.groups.map((group) => (
                <GroupRow key={group.id} group={group} checked={isGroupEnabled(settings, category.id, group.id)} disabled={disabled} onChange={(value) => onGroup(category.id, group.id, value)} />
              ))}
            </ul>
          </div>
          <LinesEditor
            copy={field.extraPatterns}
            lines={categoryPatternLines(settings, category.id)}
            disabled={disabled}
            validate={validatePatternLines}
            onSave={(lines) => onPatterns(category.id, lines)}
            showDescription
            size="sm"
          />
        </div>
      </details>
    </li>
  );
}

function GroupRow({ group, checked, disabled, onChange }: { readonly group: PatternGroup; readonly checked: boolean; readonly disabled: boolean; readonly onChange: (value: boolean) => void }) {
  const labelId = useId();
  if (group.patterns.length === 0) {
    // Change-kind groups are decided from the diff: nothing to expand.
    return (
      <li>
        <div className="flex items-start gap-3 px-2 py-1.5">
          <span className="mt-0.5 flex items-center">
            <Checkbox checked={checked} disabled={disabled} onCheckedChange={onChange} aria-labelledby={labelId} />
          </span>
          <span className="min-w-0 flex-1">
            <span id={labelId} className="block text-sm">
              {group.label}
            </span>
            <span className="block text-xs text-muted-foreground">{group.description}</span>
          </span>
        </div>
      </li>
    );
  }
  return (
    <li>
      <details className="group/patterns">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-2 py-1.5 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
          <span onClick={(event) => event.preventDefault()} className="mt-0.5 flex items-center">
            <Checkbox checked={checked} disabled={disabled} onCheckedChange={onChange} aria-labelledby={labelId} />
          </span>
          <span className="min-w-0 flex-1">
            <span id={labelId} className="block text-sm">
              {group.label}
            </span>
            <span className="block text-xs text-muted-foreground">{group.description}</span>
          </span>
          <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
            {group.patterns.length}
            <ChevronRightIcon aria-hidden="true" className="size-3.5 transition-transform group-open/patterns:rotate-90 motion-reduce:transition-none" />
          </span>
        </summary>
        <ul className="flex flex-wrap gap-1.5 px-2 pt-1 pb-3" aria-label={`${group.label} patterns`}>
          {group.patterns.map((pattern) => (
            <li key={pattern}>
              <code className="code-chip inline-block max-w-full break-all whitespace-normal">{pattern}</code>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}
