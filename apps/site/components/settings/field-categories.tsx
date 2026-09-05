'use client';

import type { CategoriesField, GeldSettings, HiddenCategory, PatternGroup, TestGroupsField, TestPatternGroupId } from '@geld/core';
import { CATEGORIES, isCategoryEnabled, isTestGroupEnabled, isTestPatternGroupId } from '@geld/core';
import { ChevronRightIcon } from 'lucide-react';
import { useId } from 'react';

import { RichText } from '@/components/settings/rich-text';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';

interface CategoriesProps {
  readonly field: CategoriesField;
  /** The "Kinds of tests" field, rendered inside the Tests category. */
  readonly testGroups: TestGroupsField | null;
  readonly settings: GeldSettings;
  readonly disabled: boolean;
  readonly onCategory: (category: HiddenCategory, value: boolean) => void;
  readonly onTestGroup: (id: TestPatternGroupId, value: boolean) => void;
}

/** One switch per category; each expands to the pattern groups it uses. */
export function CategoriesRows({ field, testGroups, settings, disabled, onCategory, onTestGroup }: CategoriesProps) {
  return (
    <div>
      <p className="text-sm font-medium">{field.label}</p>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        <RichText copy={field.description} />
      </p>
      <ul className="divide-y rounded-lg border">
        {CATEGORIES.map((category) => (
          <CategoryRow
            key={category.id}
            category={category}
            enabled={isCategoryEnabled(settings, category.id)}
            disabled={disabled}
            onChange={(value) => onCategory(category, value)}
            testGroups={category.id === 'tests' ? testGroups : null}
            settings={settings}
            onTestGroup={onTestGroup}
          />
        ))}
      </ul>
    </div>
  );
}

function CategoryRow({
  category,
  enabled,
  disabled,
  onChange,
  testGroups,
  settings,
  onTestGroup,
}: {
  readonly category: HiddenCategory;
  readonly enabled: boolean;
  readonly disabled: boolean;
  readonly onChange: (value: boolean) => void;
  readonly testGroups: TestGroupsField | null;
  readonly settings: GeldSettings;
  readonly onTestGroup: (id: TestPatternGroupId, value: boolean) => void;
}) {
  const labelId = useId();
  const helpId = useId();
  return (
    <li>
      <details className="group/category">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/category:rotate-90 motion-reduce:transition-none" />
          <span className="min-w-0 flex-1">
            <span id={labelId} className="block text-sm font-medium">
              {category.title}
            </span>
            <span id={helpId} className="block text-sm text-muted-foreground">
              {category.description}
            </span>
          </span>
          {/* Sits in the summary but must not toggle the disclosure. */}
          <span onClick={(event) => event.preventDefault()} className="flex items-center">
            <Switch checked={enabled} disabled={disabled} onCheckedChange={onChange} aria-labelledby={labelId} aria-describedby={helpId} />
          </span>
        </summary>
        <div className="border-t bg-muted/30 px-4 py-3">
          {testGroups !== null ? (
            <p className="mb-3 text-sm">
              <span className="font-medium">{testGroups.label}</span>{' '}
              <span className="text-muted-foreground">
                <RichText copy={testGroups.description} />
              </span>
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {category.groups.map((group) => (
              <GroupRow
                key={group.id}
                group={group}
                checkbox={
                  testGroups !== null && isTestPatternGroupId(group.id)
                    ? { id: group.id, checked: isTestGroupEnabled(settings, group.id), disabled, onChange: onTestGroup }
                    : null
                }
              />
            ))}
          </ul>
        </div>
      </details>
    </li>
  );
}

function GroupRow({
  group,
  checkbox,
}: {
  readonly group: PatternGroup;
  readonly checkbox: {
    readonly id: TestPatternGroupId;
    readonly checked: boolean;
    readonly disabled: boolean;
    readonly onChange: (id: TestPatternGroupId, value: boolean) => void;
  } | null;
}) {
  const labelId = useId();
  return (
    <li>
      <details className="group/patterns rounded-md">
        <summary className="flex cursor-pointer list-none items-start gap-3 rounded-md px-2 py-1.5 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
          {checkbox !== null ? (
            <span onClick={(event) => event.preventDefault()} className="mt-0.5 flex items-center">
              <Checkbox checked={checkbox.checked} disabled={checkbox.disabled} onCheckedChange={(value) => checkbox.onChange(checkbox.id, value)} aria-labelledby={labelId} />
            </span>
          ) : null}
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
