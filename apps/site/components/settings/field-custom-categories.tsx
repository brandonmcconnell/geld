'use client';

import type { AnyCategoryId, CategoryIconName, CustomCategoriesField, CustomCategory, GeldSettings } from '@geld/core';
import { CATEGORY_ICON_NAMES, categoryIconLabel, customCategoryId, isCategoryEnabled, parsePatternList } from '@geld/core';
import { cn } from 'cn';
import { ChevronRightIcon, PlusIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { CategoryIcon } from '@/components/category-icon';
import { RichText } from '@/components/settings/rich-text';
import type { Status } from '@/components/settings/save-status';
import { NO_STATUS, SaveStatus } from '@/components/settings/save-status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { MAX_CATEGORY_TITLE, validateCustomCategory } from '@/lib/settings/patch';

export type CustomSaveResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

interface CustomCategoriesProps {
  readonly field: CustomCategoriesField;
  readonly settings: GeldSettings;
  readonly disabled: boolean;
  readonly onCategory: (id: AnyCategoryId, value: boolean) => void;
  readonly onSave: (category: CustomCategory) => Promise<CustomSaveResult>;
  readonly onRemove: (id: AnyCategoryId) => Promise<CustomSaveResult>;
}

/** The user's own categories, each with a switch and an editor, plus an "Add category" draft. */
export function CustomCategoriesRows({ field, settings, disabled, onCategory, onSave, onRemove }: CustomCategoriesProps) {
  const [drafting, setDrafting] = useState(false);
  const categories = settings.customCategories;
  return (
    <div className="flex flex-col gap-4">
      {categories.length === 0 && !drafting ? <p className="text-sm text-muted-foreground">{field.emptyLabel}</p> : null}
      {categories.length > 0 || drafting ? (
        <ul className="divide-y border">
          {categories.map((category) => (
            <CustomCategoryRow
              key={category.id}
              field={field}
              category={category}
              enabled={isCategoryEnabled(settings, category.id)}
              taken={new Set(categories.map((existing) => existing.id))}
              disabled={disabled}
              onCategory={onCategory}
              onSave={onSave}
              onRemove={onRemove}
            />
          ))}
          {drafting ? (
            <CustomCategoryRow
              key="draft"
              field={field}
              category={null}
              enabled
              taken={new Set(categories.map((existing) => existing.id))}
              disabled={disabled}
              onCategory={onCategory}
              onSave={async (category) => {
                const result = await onSave(category);
                if (result.ok) setDrafting(false);
                return result;
              }}
              onRemove={async () => {
                setDrafting(false);
                return { ok: true };
              }}
            />
          ) : null}
        </ul>
      ) : null}
      <div>
        <Button type="button" variant="outline" size="sm" disabled={disabled || drafting} onClick={() => setDrafting(true)}>
          <PlusIcon />
          {field.addLabel}
        </Button>
      </div>
    </div>
  );
}

interface RowProps {
  readonly field: CustomCategoriesField;
  /** `null` for a draft that has not been saved yet. */
  readonly category: CustomCategory | null;
  readonly enabled: boolean;
  readonly taken: ReadonlySet<string>;
  readonly disabled: boolean;
  readonly onCategory: (id: AnyCategoryId, value: boolean) => void;
  readonly onSave: (category: CustomCategory) => Promise<CustomSaveResult>;
  readonly onRemove: (id: AnyCategoryId) => Promise<CustomSaveResult>;
}

function CustomCategoryRow({ field, category, enabled, taken, disabled, onCategory, onSave, onRemove }: RowProps) {
  const labelId = useId();
  const helpId = useId();
  const nameId = useId();
  const nounId = useId();
  const pluralId = useId();
  const patternsId = useId();
  const helpListId = useId();
  const [open, setOpen] = useState(category === null);
  const [title, setTitle] = useState(category?.title ?? '');
  const [icon, setIcon] = useState<CategoryIconName>(category?.icon ?? 'tag');
  const [noun, setNoun] = useState(category?.noun ?? '');
  const [nounPlural, setNounPlural] = useState(category?.nounPlural ?? '');
  const [patterns, setPatterns] = useState((category?.patterns ?? []).join('\n'));
  const [status, setStatus] = useState<Status>(NO_STATUS);
  const [busy, setBusy] = useState(false);

  const dirty =
    category === null ||
    title.trim() !== category.title ||
    icon !== category.icon ||
    noun.trim() !== (category.noun ?? '') ||
    nounPlural.trim() !== (category.nounPlural ?? '') ||
    parsePatternList(patterns).join('\n') !== category.patterns.join('\n');

  const save = async (): Promise<void> => {
    const id = category?.id ?? customCategoryId(title, taken);
    const validated = validateCustomCategory({ id, title, icon, patterns: patterns.split(/\r?\n/), noun, nounPlural });
    if (!validated.ok) {
      setStatus({ message: validated.message, tone: 'error' });
      return;
    }
    setBusy(true);
    setStatus({ message: 'Saving…', tone: 'pending' });
    const result = await onSave(validated.category);
    setBusy(false);
    if (result.ok) {
      setPatterns(validated.category.patterns.join('\n'));
      setTitle(validated.category.title);
      setNoun(validated.category.noun ?? '');
      setNounPlural(validated.category.nounPlural ?? '');
      setStatus({ message: 'Saved', tone: 'success' });
    } else {
      setStatus({ message: result.message, tone: 'error' });
    }
  };

  const remove = async (): Promise<void> => {
    if (category !== null && !window.confirm(field.deleteConfirm)) return;
    setBusy(true);
    const result = await onRemove(category?.id ?? 'custom:draft');
    setBusy(false);
    if (!result.ok) setStatus({ message: result.message, tone: 'error' });
  };

  const displayTitle = title.trim() === '' ? 'New category' : title.trim();
  const summaryHelp = category === null ? 'Not saved yet.' : `${category.patterns.length} pattern${category.patterns.length === 1 ? '' : 's'}`;

  return (
    <li>
      <details className="group/category" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/category:rotate-90 motion-reduce:transition-none" />
          <CategoryIcon name={icon} className="text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span id={labelId} className="block text-sm font-medium">
              {displayTitle}
            </span>
            <span id={helpId} className="block text-sm text-muted-foreground">
              {summaryHelp}
            </span>
          </span>
          {category !== null ? (
            <span onClick={(event) => event.preventDefault()} className="flex items-center">
              <Switch checked={enabled} disabled={disabled} onCheckedChange={(value) => onCategory(category.id, value)} aria-labelledby={labelId} aria-describedby={helpId} />
            </span>
          ) : null}
        </summary>
        <div className="flex flex-col gap-5 border-t bg-muted/30 px-4 py-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-sm font-medium">
              {field.titleLabel}
            </label>
            <Input
              id={nameId}
              value={title}
              maxLength={MAX_CATEGORY_TITLE}
              placeholder={field.titlePlaceholder}
              disabled={disabled}
              onChange={(event) => {
                setTitle(event.target.value);
                setStatus(NO_STATUS);
              }}
              className="max-w-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">{field.iconLabel}</p>
            <IconPicker value={icon} disabled={disabled} label={field.iconLabel} onChange={(next) => setIcon(next)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">{field.nounLabel}</p>
            <p className="text-sm text-muted-foreground">
              <RichText copy={field.nounDescription} />
            </p>
            <div className="flex flex-wrap gap-2">
              <Input id={nounId} value={noun} placeholder="token" aria-label="Count label, singular" disabled={disabled} onChange={(event) => setNoun(event.target.value)} className="w-40" />
              <Input id={pluralId} value={nounPlural} placeholder="tokens" aria-label="Count label, plural" disabled={disabled} onChange={(event) => setNounPlural(event.target.value)} className="w-40" />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <label htmlFor={patternsId} className="text-sm font-medium">
                {field.patterns.label}
              </label>
              <p className="mt-0.5 text-sm text-muted-foreground">{field.patterns.description}</p>
            </div>
            <Textarea
              id={patternsId}
              value={patterns}
              onChange={(event) => {
                setPatterns(event.target.value);
                setStatus(NO_STATUS);
              }}
              placeholder={field.patterns.placeholder}
              rows={field.patterns.rows}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              disabled={disabled}
              aria-describedby={helpListId}
              className="min-h-0 font-mono text-[0.8125rem] leading-6"
            />
            <ul id={helpListId} className="flex flex-col gap-1 text-xs text-muted-foreground">
              {field.patterns.syntax.map((line) => (
                <li key={line}>
                  <RichText copy={line} />
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" onClick={() => void save()} disabled={disabled || busy || !dirty}>
              {field.patterns.saveLabel}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void remove()} disabled={disabled || busy}>
              {category === null ? 'Discard' : field.deleteLabel}
            </Button>
            <SaveStatus status={dirty && status.message === '' && category !== null ? { message: 'Unsaved changes', tone: 'neutral' } : status} />
          </div>
        </div>
      </details>
    </li>
  );
}

function IconPicker({ value, disabled, label, onChange }: { readonly value: CategoryIconName; readonly disabled: boolean; readonly label: string; readonly onChange: (icon: CategoryIconName) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {CATEGORY_ICON_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={name === value}
          aria-label={categoryIconLabel(name)}
          title={categoryIconLabel(name)}
          disabled={disabled}
          onClick={() => onChange(name)}
          className={cn(
            'inline-flex size-8 items-center justify-center border border-transparent text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
            name === value && 'border-foreground text-foreground',
          )}
        >
          <CategoryIcon name={name} />
        </button>
      ))}
    </div>
  );
}
