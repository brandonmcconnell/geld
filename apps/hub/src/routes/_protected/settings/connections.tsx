import { GitBranchIcon, GitHubLogo, GitLabLogo } from "@geld/hub-icons";
import { Button } from "@geld/hub-ui/components/button";
import { Spinner } from "@geld/hub-ui/components/spinner";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { connectProvider } from "#/lib/auth-actions";
import {
  CONNECT_IDENTITY,
  type ConnectableProvider,
  connectionStatus,
  PROVIDER_NAMES,
} from "#/lib/providers/connections";
import { getProviderConnections } from "#/lib/providers/connections.functions";

const RETURN_TO = "/settings/connections";

export const Route = createFileRoute("/_protected/settings/connections")({
  validateSearch: (search: Record<string, unknown>) => ({
    error: search.error === "connect" ? ("connect" as const) : undefined,
  }),
  loader: async () => ({ connections: await getProviderConnections() }),
  component: ConnectionsPage,
});

function ProviderMark({ provider }: { provider: ConnectableProvider }) {
  const className = "size-4 text-foreground";
  switch (provider) {
    case "github":
      return <GitHubLogo className={className} />;
    case "gitlab":
      return <GitLabLogo className={className} />;
    case "bitbucket":
      return <GitBranchIcon size={16} className="text-foreground" />;
  }
}

const TONE_DOT = {
  good: "bg-success",
  warn: "bg-warning",
  muted: "bg-muted-foreground/40",
} as const;

function ConnectionsPage() {
  const { connections } = Route.useLoaderData();
  const { error } = Route.useSearch();
  const [pending, setPending] = useState<ConnectableProvider | null>(null);
  const [failed, setFailed] = useState(error === "connect");

  const connect = (provider: ConnectableProvider) => {
    setPending(provider);
    setFailed(false);
    connectProvider(CONNECT_IDENTITY[provider], RETURN_TO)
      .then((result) => {
        if (result?.error) {
          setFailed(true);
          setPending(null);
        }
      })
      .catch(() => {
        setFailed(true);
        setPending(null);
      });
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">Connections</h2>
        <p className="text-sm text-muted-foreground">
          Where Geld reads your pull requests from. A connection belongs to your
          Geld account, so it is the same one everywhere you use Geld.
        </p>
      </div>
      <ul className="overflow-hidden rounded-xl border-[0.5px] border-border/70">
        {connections.map((connection) => {
          const status = connectionStatus(connection);
          const name = PROVIDER_NAMES[connection.provider];
          const reconnect = connection.reach?.status === "reconnect";
          const canConnect =
            connection.available && (!connection.connected || reconnect);
          return (
            <li
              key={connection.provider}
              className="flex items-center gap-3 px-4 py-3 not-first:border-t-[0.5px] not-first:border-border/70"
            >
              <ProviderMark provider={connection.provider} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{name}</p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[status.tone]}`}
                  />
                  <span className="truncate">{status.text}</span>
                </p>
              </div>
              {canConnect ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={pending !== null}
                  onClick={() => connect(connection.provider)}
                >
                  {pending === connection.provider ? (
                    <Spinner size={12} />
                  ) : null}
                  {reconnect ? "Reconnect" : "Connect"}
                  <span className="sr-only"> {name}</span>
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          That connection did not go through. Its account must have a verified
          email that matches this Geld account.
        </p>
      ) : null}
    </section>
  );
}
