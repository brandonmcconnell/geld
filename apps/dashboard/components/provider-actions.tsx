'use client';
import { useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { z } from 'zod';
import { Button } from '@geld/ui';
import type { PullRef } from '@geld/domain';
import type { ReviewData } from '@/lib/review-contracts';
export function ProviderActions({
  reference,
  data,
  onChange,
}: {
  readonly reference: PullRef;
  readonly data: ReviewData;
  readonly onChange: () => void;
}) {
  const [action, setAction] = useState('close');
  const [method, setMethod] = useState('squash');
  const [changeDescription, setChangeDescription] = useState(false);
  const [changeArchive, setChangeArchive] = useState(false);
  const [description, setDescription] = useState('');
  const [archived, setArchived] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mutation = useRef({ content: '', key: '' });
  return (
    <Dialog.Root>
      <Dialog.Trigger className="text-xs underline">Provider actions</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup className="dialog-popup">
          <Dialog.Title>Provider actions</Dialog.Title>
          <Dialog.Description>
            Your own provider privileges and the repository App permissions both apply. Changes take effect on the
            provider.
          </Dialog.Description>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const change =
                action === 'merge'
                  ? { kind: action, method, headSha: data.pull.headSha }
                  : action === 'settings'
                    ? {
                        kind: action,
                        ...(changeDescription ? { description } : {}),
                        ...(changeArchive ? { archived } : {}),
                      }
                    : action === 'delete'
                      ? { kind: action, confirmation }
                      : { kind: action };
              const content = JSON.stringify(change);
              if (mutation.current.content !== content) mutation.current = { content, key: crypto.randomUUID() };
              try {
                const r = await fetch('/api/actions', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    ref: reference,
                    action: change,
                    key: mutation.current.key,
                  }),
                });
                const value: unknown = await r.json();
                const error = z.object({ error: z.string() }).safeParse(value);
                setMessage(
                  r.ok
                    ? 'The provider confirmed this action.'
                    : error.success
                      ? error.data.error
                      : 'The action could not be confirmed.',
                );
                if (r.ok) onChange();
              } catch {
                setMessage('The action could not connect. Check the provider before retrying.');
              }
              setBusy(false);
            }}
          >
            <label>
              Action
              <select className="field" value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="close">Close pull request</option>
                <option value="reopen">Reopen pull request</option>
                {data.pull.capabilities.includes('merge') && <option value="merge">Merge pull request</option>}
                {data.pull.capabilities.includes('settings') && (
                  <option value="settings">Repository description and archive state</option>
                )}
                {data.pull.capabilities.includes('delete') && (
                  <option value="delete">Delete repository permanently</option>
                )}
              </select>
            </label>
            {action === 'merge' && (
              <label>
                Merge method
                <select className="field" value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="squash">Squash</option>
                  <option value="merge">Merge commit</option>
                  <option value="rebase">Rebase</option>
                </select>
              </label>
            )}
            {action === 'settings' && (
              <>
                <label>
                  Change description{' '}
                  <input
                    type="checkbox"
                    checked={changeDescription}
                    onChange={(e) => setChangeDescription(e.target.checked)}
                  />
                </label>
                <label>
                  Description
                  <textarea
                    className="field"
                    disabled={!changeDescription}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <label>
                  Change archive state{' '}
                  <input type="checkbox" checked={changeArchive} onChange={(e) => setChangeArchive(e.target.checked)} />
                </label>
                <label>
                  Archived{' '}
                  <input
                    disabled={!changeArchive}
                    type="checkbox"
                    checked={archived}
                    onChange={(e) => setArchived(e.target.checked)}
                  />
                </label>
              </>
            )}
            {action === 'delete' && (
              <label>
                Type {reference.owner}/{reference.repo} to confirm permanent deletion
                <input
                  className="field"
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
            )}
            <div className="flex gap-2">
              <Dialog.Close className="text-xs underline">Cancel</Dialog.Close>
              <Button
                type="submit"
                disabled={busy || (action === 'delete' && confirmation !== `${reference.owner}/${reference.repo}`)}
              >
                Confirm on provider
              </Button>
            </div>
            <p role="status">{message}</p>
            <a className="underline" href={data.pull.url}>
              Open provider ↗
            </a>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
