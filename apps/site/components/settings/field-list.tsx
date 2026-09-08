'use client';

import type { ListField, PatternEditorCopy } from '@geld/core';
import { parsePatternList } from '@geld/core';
import { useId, useState } from 'react';

import { RichText } from '@/components/settings/rich-text';
import type { Status } from '@/components/settings/save-status';
import { NO_STATUS, SaveStatus } from '@/components/settings/save-status';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ListValidation } from '@/lib/settings/patch';
import { validateList } from '@/lib/settings/patch';

export type LinesSaveResult = { readonly ok: true; readonly lines: readonly string[] } | { readonly ok: false; readonly message: string };

interface LinesEditorProps {
  /** Label, placeholder, syntax help and button copy (from the schema). */
  readonly copy: PatternEditorCopy;
  /** Saved lines (from the gist). */
  readonly lines: readonly string[];
  readonly disabled: boolean;
  /** Cleans and checks the draft before it is sent. */
  readonly validate: (rawLines: readonly string[]) => ListValidation;
  /** Resolves with the saved lines, or a message to show. */
  readonly onSave: (lines: readonly string[]) => Promise<LinesSaveResult>;
  /** Show the description under the label (list fields put it in the section intro instead). */
  readonly showDescription?: boolean;
  readonly size?: 'default' | 'sm';
}

/** A textarea of lines with syntax help and an explicit save button. */
export function LinesEditor({ copy, lines, disabled, validate, onSave, showDescription = false, size = 'default' }: LinesEditorProps) {
  const textareaId = useId();
  const helpId = useId();
  const saved = lines.join('\n');
  // Local draft, reset whenever the saved value changes underneath us (another save, fresh remote copy).
  const [draft, setDraft] = useState<{ base: string; text: string }>({ base: saved, text: saved });
  const text = draft.base === saved ? draft.text : saved;
  const dirty = parsePatternList(text).join('\n') !== saved;
  const [status, setStatus] = useState<Status>(NO_STATUS);
  const [saving, setSaving] = useState(false);

  const save = async (): Promise<void> => {
    const validated = validate(text.split(/\r?\n/));
    if (!validated.ok) {
      setStatus({ message: validated.message, tone: 'error' });
      return;
    }
    setSaving(true);
    setStatus({ message: 'Saving…', tone: 'pending' });
    const result = await onSave(validated.lines);
    setSaving(false);
    if (result.ok) {
      setDraft({ base: result.lines.join('\n'), text: result.lines.join('\n') });
      const count = result.lines.length;
      setStatus({ message: `Saved ${count} line${count === 1 ? '' : 's'}`, tone: 'success' });
    } else {
      setStatus({ message: result.message, tone: 'error' });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label htmlFor={textareaId} className="text-sm font-medium">
          {copy.label}
        </label>
        {showDescription ? <p className="mt-0.5 text-sm text-muted-foreground">{copy.description}</p> : null}
      </div>
      <Textarea
        id={textareaId}
        value={text}
        onChange={(event) => {
          setDraft({ base: saved, text: event.target.value });
          setStatus(NO_STATUS);
        }}
        placeholder={copy.placeholder}
        rows={copy.rows}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        disabled={disabled}
        aria-describedby={helpId}
        className="min-h-0 font-mono text-[0.8125rem] leading-6"
      />
      <ul id={helpId} className="flex flex-col gap-1 text-xs text-muted-foreground">
        {copy.syntax.map((line) => (
          <li key={line}>
            <RichText copy={line} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size={size} onClick={() => void save()} disabled={disabled || saving || !dirty}>
          {copy.saveLabel}
        </Button>
        <SaveStatus status={dirty && status.message === '' ? { message: 'Unsaved changes', tone: 'neutral' } : status} />
      </div>
    </div>
  );
}

interface ListEditorProps {
  readonly field: ListField;
  readonly lines: readonly string[];
  readonly disabled: boolean;
  readonly onSave: (lines: readonly string[]) => Promise<LinesSaveResult>;
}

/** A schema `list` field (repository rules, Enterprise hosts). */
export function ListEditor({ field, lines, disabled, onSave }: ListEditorProps) {
  return <LinesEditor copy={field} lines={lines} disabled={disabled} validate={(raw) => validateList(field.key, raw)} onSave={onSave} />;
}
