'use client';

import type { ListField } from '@geld/core';
import { parsePatternList } from '@geld/core';
import { useId, useState } from 'react';

import { RichText } from '@/components/settings/rich-text';
import type { Status } from '@/components/settings/save-status';
import { NO_STATUS, SaveStatus } from '@/components/settings/save-status';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { validateList } from '@/lib/settings/patch';

interface ListEditorProps {
  readonly field: ListField;
  /** Saved lines (from the gist). */
  readonly lines: readonly string[];
  readonly disabled: boolean;
  /** Resolves with the saved lines, or a message to show. */
  readonly onSave: (lines: readonly string[]) => Promise<{ readonly ok: true; readonly lines: readonly string[] } | { readonly ok: false; readonly message: string }>;
}

export function ListEditor({ field, lines, disabled, onSave }: ListEditorProps) {
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
    const validated = validateList(field.key, text.split(/\r?\n/));
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
      <label htmlFor={textareaId} className="text-sm font-medium">
        {field.label}
      </label>
      <Textarea
        id={textareaId}
        value={text}
        onChange={(event) => {
          setDraft({ base: saved, text: event.target.value });
          setStatus(NO_STATUS);
        }}
        placeholder={field.placeholder}
        rows={field.rows}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        disabled={disabled}
        aria-describedby={helpId}
        className="min-h-0 font-mono text-[0.8125rem] leading-6"
      />
      <ul id={helpId} className="flex flex-col gap-1 text-xs text-muted-foreground">
        {field.syntax.map((line) => (
          <li key={line}>
            <RichText copy={line} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void save()} disabled={disabled || saving || !dirty}>
          {field.saveLabel}
        </Button>
        <SaveStatus status={dirty && status.message === '' ? { message: 'Unsaved changes', tone: 'neutral' } : status} />
      </div>
    </div>
  );
}
