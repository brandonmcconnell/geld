'use client';

import type { ActionsField, GeldSettings, MaintenanceAction } from '@geld/core';
import { actionsFor, DEFAULT_SETTINGS, serializeSettingsPayload } from '@geld/core';
import { useRef, useState } from 'react';

import type { Status } from '@/components/settings/save-status';
import { NO_STATUS, SaveStatus } from '@/components/settings/save-status';
import { Button } from '@/components/ui/button';

export type ReplaceResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

interface ActionsRowProps {
  readonly field: ActionsField;
  readonly settings: GeldSettings;
  readonly disabled: boolean;
  /** Replace every setting (import, reset); the server validates and writes the gist. */
  readonly onReplace: (settings: unknown) => Promise<ReplaceResult>;
}

/**
 * Backup & maintenance on the site. Export is client-side (the same document
 * the gist holds); import and reset replace the whole gist through the server
 * action. "Clear cached diffs" is extension-only and filtered out by the schema.
 */
export function ActionsRow({ field, settings, disabled, onReplace }: ActionsRowProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>(NO_STATUS);
  const [busy, setBusy] = useState(false);

  const replace = async (next: unknown, done: string): Promise<void> => {
    setBusy(true);
    setStatus({ message: 'Saving…', tone: 'pending' });
    const result = await onReplace(next);
    setBusy(false);
    setStatus(result.ok ? { message: done, tone: 'success' } : { message: result.message, tone: 'error' });
  };

  const run = (action: MaintenanceAction): void => {
    if (action.confirm !== undefined && !window.confirm(action.confirm)) return;
    switch (action.id) {
      case 'export': {
        const blob = new Blob([serializeSettingsPayload(settings)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'geld-settings.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        setStatus({ message: 'Exported geld-settings.json', tone: 'success' });
        return;
      }
      case 'import':
        fileInput.current?.click();
        return;
      case 'reset':
        void replace(DEFAULT_SETTINGS, 'Restored default settings');
        return;
      case 'clear-cache':
        return;
    }
  };

  const onFile = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch (error) {
      setStatus({ message: `That file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, tone: 'error' });
      return;
    }
    await replace(parsed, 'Settings imported');
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {actionsFor(field, 'site').map((action) => (
          <Button
            key={action.id}
            type="button"
            variant="outline"
            title={action.description}
            disabled={disabled || busy}
            className={action.danger === true ? 'text-destructive hover:text-destructive' : undefined}
            onClick={() => run(action)}
          >
            {action.label}
          </Button>
        ))}
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            void onFile(file);
          }}
        />
      </div>
      <SaveStatus status={status} />
    </div>
  );
}
