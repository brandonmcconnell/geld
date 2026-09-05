'use client';

import type { GeldSettings, HiddenCategory, ListSettingKey, SettingsSection, TestGroupsField, TestPatternGroupId } from '@geld/core';
import { useCallback, useState } from 'react';

import { saveSetting } from '@/app/settings/actions';
import { GitHubIcon } from '@/components/icons';
import { CategoriesRows } from '@/components/settings/field-categories';
import { ListEditor } from '@/components/settings/field-list';
import { ToggleRow } from '@/components/settings/field-toggle';
import { RichText } from '@/components/settings/rich-text';
import type { Status } from '@/components/settings/save-status';
import { NO_STATUS, SaveStatus } from '@/components/settings/save-status';
import { SettingsTester } from '@/components/settings/settings-tester';
import { buttonVariants } from '@/components/ui/button';
import type { SettingsPatch } from '@/lib/settings/patch';
import { applyPatch } from '@/lib/settings/patch';

interface SettingsFormProps {
  readonly sections: readonly SettingsSection[];
  readonly initialSettings: GeldSettings;
  /** `null` until the first save creates the gist. */
  readonly initialGistId: string | null;
  readonly updatedAt: string | null;
  readonly login: string;
}

type ListSaveResult = { readonly ok: true; readonly lines: readonly string[] } | { readonly ok: false; readonly message: string };

/**
 * Renders `sectionsFor('site')` and saves each change through a server
 * action, which re-reads the gist and layers the change on top. The response
 * carries the fresh remote settings, which replace local state so this tab
 * converges with whatever the extension saved meanwhile.
 */
export function SettingsForm({ sections, initialSettings, initialGistId, updatedAt, login }: SettingsFormProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [gistId, setGistId] = useState(initialGistId);
  const [status, setStatus] = useState<Status>(NO_STATUS);
  const [signedOut, setSignedOut] = useState(false);
  const [pending, setPending] = useState(0);
  const busy = pending > 0;

  const submit = useCallback(
    async (patch: SettingsPatch): Promise<ListSaveResult> => {
      const previous = settings;
      const optimistic = applyPatch(previous, patch);
      if (!optimistic.ok) return { ok: false, message: optimistic.message };
      setSettings(optimistic.settings);
      setPending((count) => count + 1);
      setStatus({ message: 'Saving…', tone: 'pending' });
      try {
        const result = await saveSetting(gistId, patch);
        if (result.ok) {
          setSettings(result.settings);
          setGistId(result.gistId);
          setStatus({ message: result.changed ? 'Saved' : 'Already up to date', tone: 'success' });
          if (patch.kind === 'list') return { ok: true, lines: result.settings[patch.key] };
          return { ok: true, lines: [] };
        }
        setSettings(previous);
        if (result.reason === 'signed-out') setSignedOut(true);
        setStatus({ message: result.message, tone: 'error' });
        return { ok: false, message: result.message };
      } catch {
        setSettings(previous);
        const message = 'Could not reach geld.sh. Check your connection and try again.';
        setStatus({ message, tone: 'error' });
        return { ok: false, message };
      } finally {
        setPending((count) => count - 1);
      }
    },
    [gistId, settings],
  );

  const onCategory = (category: HiddenCategory, value: boolean): void => {
    void submit({ kind: 'category', id: category.id, value });
  };
  const onTestGroup = (id: TestPatternGroupId, value: boolean): void => {
    void submit({ kind: 'test-group', id, value });
  };
  const onList = (key: ListSettingKey) => (lines: readonly string[]) => submit({ kind: 'list', key, lines });

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <p>
          {gistId === null ? (
            <>No settings gist yet; your first change creates one.</>
          ) : (
            <>
              Synced with your gist{updatedAt !== null ? <> · last updated {formatWhen(updatedAt)}</> : null}.
            </>
          )}
        </p>
        <SaveStatus status={status} />
      </div>

      {signedOut ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border bg-muted/40 px-4 py-3 text-sm">
          <span>You&apos;ve been signed out. Sign in again to keep editing.</span>
          <a href="/auth/start?next=/settings" className={buttonVariants({ size: 'sm' })}>
            <GitHubIcon />
            Sign in with GitHub
          </a>
        </div>
      ) : null}

      {sections.map((section) => {
        const testGroups = section.fields.find((field): field is TestGroupsField => field.kind === 'test-groups') ?? null;
        return (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-24 border p-5 sm:p-6">
            <h2 id={`${section.id}-heading`} className="text-lg font-semibold tracking-tight">
              {section.title}
            </h2>
            {section.intro !== '' ? (
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                <RichText copy={section.intro} />
              </p>
            ) : null}
            <div className="mt-4">
              {section.fields.map((field) => {
                switch (field.kind) {
                  case 'toggle':
                    return (
                      <ToggleRow
                        key={field.key}
                        field={field}
                        checked={settings[field.key]}
                        disabled={signedOut}
                        onChange={(value) => void submit({ kind: 'toggle', key: field.key, value })}
                      />
                    );
                  case 'categories':
                    return (
                      <CategoriesRows
                        key="categories"
                        field={field}
                        testGroups={testGroups}
                        settings={settings}
                        disabled={signedOut}
                        onCategory={onCategory}
                        onTestGroup={onTestGroup}
                      />
                    );
                  case 'test-groups':
                    // Rendered inside the Tests category above.
                    return null;
                  case 'list':
                    return <ListEditor key={field.key} field={field} lines={settings[field.key]} disabled={signedOut || busy} onSave={onList(field.key)} />;
                }
              })}
            </div>
          </section>
        );
      })}

      <section id="tester" aria-labelledby="tester-heading" className="scroll-mt-24 border p-5 sm:p-6">
        <h2 id="tester-heading" className="text-lg font-semibold tracking-tight">
          Try a path
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Uses the settings above, including unsaved toggles, exactly as the extension would for <span className="font-medium text-foreground">{login}</span>.
        </p>
        <div className="mt-4">
          <SettingsTester settings={settings} />
        </div>
      </section>
    </div>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
