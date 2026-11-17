'use client';
import { useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { z } from 'zod';
import { Button } from '@/components/button';
import { MoreHorizontal, X } from './icons';
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
      <Dialog.Trigger className="icon-button" aria-label="Pull request actions">
        <MoreHorizontal size={17} />
        <span className="touch-target" aria-hidden="true" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup className="dialog-popup">
          <div className="dialog-heading">
            <Dialog.Title>Pull request actions</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close actions">
              <X size={17} />
              <span className="touch-target" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <Dialog.Description>
            Changes apply to the connected Git host using your repository permissions.
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
                    ? 'The Git host confirmed this action.'
                    : error.success
                      ? error.data.error
                      : 'The action could not be confirmed.',
                );
                if (r.ok) onChange();
              } catch {
                setMessage('The action could not connect. Check the Git host before retrying.');
              }
              setBusy(false);
            }}
          >
            <label>
              Action
              <select name="action" className="field" value={action} onChange={(e) => setAction(e.target.value)}>
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
                <select name="method" className="field" value={method} onChange={(e) => setMethod(e.target.value)}>
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
                    name="changeDescription"
                    type="checkbox"
                    checked={changeDescription}
                    onChange={(e) => setChangeDescription(e.target.checked)}
                  />
                </label>
                <label>
                  Description
                  <textarea
                    name="description"
                    className="field"
                    disabled={!changeDescription}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <label>
                  Change archive state{' '}
                  <input
                    name="changeArchive"
                    type="checkbox"
                    checked={changeArchive}
                    onChange={(e) => setChangeArchive(e.target.checked)}
                  />
                </label>
                <label>
                  Archived{' '}
                  <input
                    name="archived"
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
                  name="confirmation"
                  className="field"
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
            )}
            <div className="dialog-actions">
              <Dialog.Close render={<Button variant="outline" size="sm" />}>Cancel</Dialog.Close>
              <Button
                type="submit"
                disabled={busy || (action === 'delete' && confirmation !== `${reference.owner}/${reference.repo}`)}
              >
                Confirm action
              </Button>
            </div>
            <p role="status">{message}</p>
            <a className="underline" href={data.pull.url}>
              Open Git host ↗
            </a>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
