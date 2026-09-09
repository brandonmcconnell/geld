'use client';

import type { AnyCategoryId, CategoryId, CustomCategory, GeldSettings, ListSettingKey, SettingsSection } from '@geld/core';
import { categoryPatternLines } from '@geld/core';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { saveSetting } from '@/app/settings/actions';
import { GitHubIcon } from '@/components/icons';
import type { ReplaceResult } from '@/components/settings/field-actions';
import { ActionsRow } from '@/components/settings/field-actions';
import { CategoriesRows } from '@/components/settings/field-categories';
import { CustomCategoriesRows } from '@/components/settings/field-custom-categories';
import type { LinesSaveResult } from '@/components/settings/field-list';
import { ListEditor } from '@/components/settings/field-list';
import { ToggleRow } from '@/components/settings/field-toggle';
import { RichText } from '@/components/settings/rich-text';
import type { Status } from '@/components/settings/save-status';
import { NO_STATUS, SaveStatus } from '@/components/settings/save-status';
import { SettingsTester } from '@/components/settings/settings-tester';
import { Button, buttonVariants } from '@/components/ui/button';
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

type SubmitResult = { readonly ok: true; readonly settings: GeldSettings } | { readonly ok: false; readonly message: string };

/**
 * Renders `sectionsFor('site')` and saves each change through a server
 * action, which re-reads the gist and layers the change on top. The response
 * carries the fresh remote settings, which replace local state so this tab
 * converges with whatever the extension saved meanwhile.
 */
export function SettingsForm({ sections, initialSettings, initialGistId, updatedAt, login }: SettingsFormProps) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [gistId, setGistId] = useState(initialGistId);
  // The page has just read the gist, so say so; saves replace this with "Saved" etc.
  const [status, setStatus] = useState<Status>(initialGistId === null ? NO_STATUS : { message: 'Up to date', tone: 'success' });
  const [signedOut, setSignedOut] = useState(false);
  const [remoteInvalid, setRemoteInvalid] = useState(false);
  const [pending, setPending] = useState(0);
  const busy = pending > 0;

  const submit = useCallback(
    async (patch: SettingsPatch): Promise<SubmitResult> => {
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
          return { ok: true, settings: result.settings };
        }
        setSettings(previous);
        if (result.reason === 'signed-out') setSignedOut(true);
        if (result.reason === 'invalid-remote') setRemoteInvalid(true);
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

  const onCategory = (id: AnyCategoryId, value: boolean): void => {
    void submit({ kind: 'category', id, value });
  };
  const onGroup = (categoryId: CategoryId, groupId: string, value: boolean): void => {
    void submit({ kind: 'group', categoryId, groupId, value });
  };
  const onPatterns = async (categoryId: CategoryId, lines: readonly string[]): Promise<LinesSaveResult> => {
    const result = await submit({ kind: 'category-patterns', categoryId, lines });
    return result.ok ? { ok: true, lines: categoryPatternLines(result.settings, categoryId) } : result;
  };
  const onReplace = async (next: unknown): Promise<ReplaceResult> => {
    const result = await submit({ kind: 'replace', settings: next });
    return result.ok ? { ok: true } : result;
  };
  const onList = (key: ListSettingKey) => async (lines: readonly string[]): Promise<LinesSaveResult> => {
    const result = await submit({ kind: 'list', key, lines });
    return result.ok ? { ok: true, lines: result.settings[key] } : result;
  };
  const onCustomSave = (category: CustomCategory) => submit({ kind: 'custom-category', category });
  const onCustomRemove = (id: AnyCategoryId) => submit({ kind: 'remove-custom-category', id });

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

      {remoteInvalid ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border border-destructive/55 bg-muted/40 px-4 py-3 text-sm">
          <span>Your settings gist has errors, so nothing was saved. Reload to see what needs fixing.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => router.refresh()}>
            Reload
          </Button>
        </div>
      ) : null}

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
                        disabled={signedOut || remoteInvalid}
                        onChange={(value) => void submit({ kind: 'toggle', key: field.key, value })}
                      />
                    );
                  case 'categories':
                    return (
                      <CategoriesRows
                        key="categories"
                        field={field}
                        settings={settings}
                        disabled={signedOut || remoteInvalid}
                        onCategory={onCategory}
                        onGroup={onGroup}
                        onPatterns={onPatterns}
                      />
                    );
                  case 'custom-categories':
                    return (
                      <CustomCategoriesRows
                        key="custom-categories"
                        field={field}
                        settings={settings}
                        disabled={signedOut || remoteInvalid}
                        onCategory={onCategory}
                        onSave={onCustomSave}
                        onRemove={onCustomRemove}
                      />
                    );
                  case 'list':
                    return <ListEditor key={field.key} field={field} lines={settings[field.key]} disabled={signedOut || remoteInvalid || busy} onSave={onList(field.key)} />;
                  case 'actions':
                    return <ActionsRow key="actions" field={field} settings={settings} disabled={signedOut || remoteInvalid || busy} onReplace={onReplace} />;
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
