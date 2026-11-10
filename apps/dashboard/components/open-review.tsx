'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@base-ui/react/dialog';
import { Plus, X } from './icons';
import { pullPath, pullRefSchema } from '@geld/domain';
import { Button } from './button';
import { useDashboard } from '@/lib/dashboard-context';

export function OpenReview() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { queue } = useDashboard();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="workspace-action" aria-label="Open a pull request by URL">
        <Plus size={16} />
        <span className="workspace-action-label">Open by URL</span>
        <span className="touch-target" aria-hidden="true" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup className="dialog-popup">
          <div className="dialog-heading">
            <Dialog.Title>Open a pull request</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close">
              <X size={17} />
              <span className="touch-target" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <Dialog.Description>Paste a GitHub, GitLab or Bitbucket pull request URL.</Dialog.Description>
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              try {
                const parsed = new URL(url);
                if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port)
                  throw new Error();
                const parts = parsed.pathname.split('/').filter(Boolean);
                const host = parsed.hostname;
                const provider = host === 'gitlab.com' ? 'gitlab' : host === 'bitbucket.org' ? 'bitbucket' : 'github';
                if (
                  ![
                    'github.com',
                    'gitlab.com',
                    'bitbucket.org',
                    ...queue.repositories.map((repo) => repo.ref.host),
                  ].includes(host)
                )
                  throw new Error();
                const marker = provider === 'gitlab' ? parts.indexOf('-') : 2;
                if (
                  parts[marker] !==
                    (provider === 'gitlab' ? '-' : provider === 'bitbucket' ? 'pull-requests' : 'pull') ||
                  (provider === 'gitlab' && parts[marker + 1] !== 'merge_requests')
                )
                  throw new Error();
                const number = Number(parts[marker + (provider === 'gitlab' ? 2 : 1)]);
                const ref = pullRefSchema.safeParse({
                  provider,
                  host,
                  owner: parts.slice(0, marker - 1).join('/'),
                  repo: parts[marker - 1],
                  number,
                });
                if (!ref.success) throw new Error();
                setOpen(false);
                router.push(pullPath(ref.data));
              } catch {
                setError('Enter a pull request URL from a connected Git host.');
              }
            }}
          >
            <label>
              Pull request URL
              <input
                name="pullUrl"
                className="field"
                type="url"
                required
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://github.com/owner/repo/pull/123"
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <Dialog.Close render={<Button variant="outline" size="sm" />}>Cancel</Dialog.Close>
              <Button type="submit">Open review</Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
