'use client';
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Popover } from '@base-ui/react/popover';
import { z } from 'zod';
import { Button } from '@/components/button';
import { Bell, ArrowUpRight, Users } from './icons';
import { useDashboard } from '@/lib/dashboard-context';
const schema = z.object({
  invites: z.array(z.object({ team_id: z.string(), name: z.string() })),
  notifications: z.array(
    z.object({
      id: z.string(),
      team_id: z.string().nullable(),
      kind: z.string(),
      created_at: z.string().nullish(),
    }),
  ),
});
type InboxData = z.infer<typeof schema>;
function useInbox() {
  const { session } = useDashboard();
  const owner = session.user?.id ?? (session.demo ? 'demo' : null);
  const [result, setResult] = useState<{ owner: string; data: InboxData | null; error: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState({ owner, pending: '', message: '' });
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!owner) return;
    const abort = new AbortController();
    fetch('/api/notifications', { signal: abort.signal })
      .then(async (response) => {
        const parsed = schema.safeParse(await response.json());
        if (!response.ok || !parsed.success) throw new Error('Inbox unavailable');
        if (!abort.signal.aborted) setResult({ owner, data: parsed.data, error: false });
      })
      .catch(() => {
        if (!abort.signal.aborted) setResult({ owner, data: null, error: true });
      });
    return () => abort.abort();
  }, [owner, revision]);
  useEffect(() => () => mutation.current?.abort(), [owner]);
  const data = result?.owner === owner ? result.data : null;
  const accept = async (teamId: string) => {
    if (!owner || (action.owner === owner && action.pending)) return;
    mutation.current?.abort();
    const abort = new AbortController();
    mutation.current = abort;
    setAction({ owner, pending: teamId, message: '' });
    try {
      const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept_invite' }),
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      setAction({
        owner,
        pending: '',
        message: response.ok ? 'Invitation accepted.' : 'This invitation could not be accepted.',
      });
      if (response.ok) setRevision((value) => value + 1);
    } catch {
      if (!abort.signal.aborted) setAction({ owner, pending: '', message: 'This invitation could not be accepted.' });
    }
  };
  return {
    data,
    count: (data?.invites.length ?? 0) + (data?.notifications.length ?? 0),
    error: result?.owner === owner && result.error,
    loading: !!owner && result?.owner !== owner,
    signedIn: !!owner,
    pending: action.owner === owner ? action.pending : '',
    message: action.owner === owner ? action.message : '',
    accept,
    refresh: () => setRevision((value) => value + 1),
  };
}
type InboxState = ReturnType<typeof useInbox>;
function InboxItems({ inbox, onNavigate }: { readonly inbox: InboxState; readonly onNavigate?: () => void }) {
  if (!inbox.signedIn)
    return (
      <p className="inbox-state">
        <Link href="/sign-in" onClick={() => onNavigate?.()}>
          Sign in to view your inbox
        </Link>
      </p>
    );
  if (inbox.loading)
    return (
      <p className="inbox-state" role="status">
        Loading inbox…
      </p>
    );
  if (inbox.error)
    return (
      <div className="inbox-state" role="status">
        <p>Inbox could not be loaded.</p>
        <Button size="sm" variant="outline" onClick={inbox.refresh}>
          Try again
        </Button>
      </div>
    );
  return (
    <>
      {!inbox.count && (
        <div className="inbox-state">
          <Bell size={24} />
          <h2>You’re up to date</h2>
          <p>New review requests and invitations will appear here.</p>
        </div>
      )}
      {!!inbox.data?.invites.length && (
        <section className="inbox-section">
          <h2>Invitations</h2>
          {inbox.data.invites.map((invite) => (
            <div className="inbox-item" key={invite.team_id}>
              <Users size={16} />
              <div>
                <p>{invite.name}</p>
                <span>Team invitation</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!!inbox.pending}
                onClick={() => void inbox.accept(invite.team_id)}
              >
                {inbox.pending === invite.team_id ? 'Accepting…' : 'Accept'}
              </Button>
            </div>
          ))}
        </section>
      )}
      {!!inbox.data?.notifications.length && (
        <section className="inbox-section">
          <h2>Updates</h2>
          {inbox.data.notifications.map((notification) => (
            <Link
              className="inbox-item"
              href={notification.team_id ? `/teams/${encodeURIComponent(notification.team_id)}` : '/teams'}
              key={notification.id}
              onClick={() => onNavigate?.()}
            >
              <Bell size={16} />
              <div>
                <p>
                  {notification.kind === 'review_requested'
                    ? 'Review requested'
                    : notification.kind === 'repository_connected'
                      ? 'Repository connected'
                      : notification.kind.replaceAll('_', ' ')}
                </p>
                {notification.created_at && (
                  <span>
                    {new Date(notification.created_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                )}
              </div>
              <ArrowUpRight size={14} />
            </Link>
          ))}
        </section>
      )}
      {inbox.message && (
        <p className="inbox-message" role="status">
          {inbox.message}
        </p>
      )}
    </>
  );
}
export function InboxPopover() {
  const inbox = useInbox();
  const [open, setOpen] = useState(false);
  const countId = useId();
  const close = () => {
    setOpen(false);
    window.dispatchEvent(new Event('geld:close-navigation'));
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="icon-button inbox-trigger"
        aria-label="Open inbox"
        aria-describedby={countId}
        title="Inbox"
        data-unread={inbox.count > 0}
      >
        <Bell size={16} />
        <span className="touch-target" aria-hidden="true" />
      </Popover.Trigger>
      <span id={countId} className="sr-only">
        {inbox.count ? `${inbox.count} unread items` : 'No unread items'}
      </span>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="popover-positioner">
          <Popover.Popup className="inbox-popover">
            <header>
              <Popover.Title>Inbox</Popover.Title>
              {inbox.count > 0 && <span>{inbox.count}</span>}
            </header>
            <div className="inbox-scroll">
              <InboxItems inbox={inbox} onNavigate={close} />
            </div>
            <Link href="/inbox" className="inbox-footer" onClick={close}>
              View all updates <ArrowUpRight size={14} />
            </Link>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function Inbox() {
  const inbox = useInbox();
  return (
    <div className="page inbox-page">
      <div className="page-heading">
        <h1>Inbox</h1>
      </div>
      <InboxItems inbox={inbox} />
    </div>
  );
}
