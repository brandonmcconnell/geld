# Self-hosted Geld and Enterprise instances

Geld runs on the customer's own Postgres, email and AI services. Build `deploy/Dockerfile` with target `dashboard`. The runtime uses a non-root user and supports a read-only root filesystem. `deploy/compose.yaml` provides Postgres, the dashboard and an optional private worker. Secrets come from environment variables. The image build context excludes `.git`, private notes and active environment files. No deployment or production migration is automatic.

1. Copy `deploy/.env.example` to an untracked environment file and generate independent authentication, encryption, database, relay-database and worker secrets.
2. Build the dashboard image with Docker Compose. Configure the OAuth apps and email variables from the dashboard service inventory. Put an HTTPS reverse proxy in front of the loopback-bound dashboard port.
3. For a new empty database, explicitly run the `setup` profile's `migrate` service. The migration command is transactional and serializes concurrent attempts. Review it with the owner before pointing it at existing customer data.
4. Start the dashboard. Enable the `worker` profile to process the authenticated outbox endpoint. The worker stays inside the private service network.
5. For customer-owned generated content, apply `apps/dashboard/lib/content-store.customer.sql` to a separate customer database and set `CUSTOMER_CONTENT_DATABASE_URL`. This switches only generated-plan storage through `GeneratedContentStore`. Identity and billing records remain in the primary database.

Use your own services and configure variables through the deployment's secret manager. No hosted database, paid integration or email account is provisioned by these files. Existing Geld licensing stays AGPL-3.0-only and the image includes the existing root license.

## Enterprise reachability

Enterprise URLs remain `/ghe/{host}/{owner}/{repo}/pull/{number}`. Ordinary github.com Enterprise Cloud organisations keep `/github/...`. Data-residency Enterprise Cloud hosts use `api.{subdomain}.ghe.com`; Enterprise Server REST uses `/api/v3/` and GraphQL uses `/api/graphql`. Credential selection includes the exact host, represented as `github@{host}` at the identity boundary. Repository Apps are created on the instance through its native manifest confirmation and verified installation flow.

An Enterprise-contract admin registers the host in Settings. App installations and user tokens are separate for each host. When public HTTPS is reachable, the server can call it directly. Socket lookup checks every resolved address and rejects private, loopback, link-local, reserved and transition ranges. The check runs in the actual connection lookup to prevent DNS rebinding. A managed proxy forces relay use rather than bypassing proxy policy or weakening address checks.

For interactive review reads, the browser first tries the instance with a read-only installation token scoped to one repository. The user's own provider access is checked before issuance. This token exists only in the reader's request closure and is never stored locally. CORS or network failures fall back to the registered relay. Interactive writes keep the actor's own token source and provider privileges. Browser and server paths share the same normalizers, matcher and stale-head checks.

## Outbound customer connector

Build the Dockerfile's `relay` target. The broker is a long-running single-replica Node service behind HTTPS. Configure `RELAY_CHANNELS` from the one-time connector configuration and `RELAY_BROKER_URL` on the dashboard. Do not expose the broker over public HTTP. The local Compose example permits HTTP only between private services and authenticates every message with its channel secret.

Apply migrations before enabling the `relay` profile. Its `relay-database-setup` service runs the idempotent `deploy/relay-role.sh` before the broker starts, including for existing database volumes. That setup service alone receives the administrative database credential. The broker uses the separate `RELAY_DATABASE_PASSWORD` for `geld_relay`, which has read-only transactions and SELECT access only to the relay channel columns it needs. It cannot read account or billing tables or update channels. Re-run the setup service after rotating the relay password. External-database operators should provision an equivalent restricted role rather than give the broker their application credential.

The customer runs `deploy/connector.compose.yaml` beside the private instance. It polls outward over HTTPS. No inbound connection or firewall opening to the customer's network is required. The connector pins one hostname and only forwards its REST API, GraphQL and OAuth exchange paths. Redirects remain manual. HMAC signatures bind method, path, body, timestamp and nonce. Responses are bound to the requesting nonce. Replay windows are limited and channel work is bounded. Dynamic channel discovery admits at most two concurrent database lookups and a bounded request rate, including unknown IDs. Database lookup and connection deadlines prevent stalled requests from accumulating. Signed connector status checks propagate a disconnected caller into cancellation of local work, while older brokers retain the local generation deadline. Raw bodies exist only in memory for an active request and are dropped on completion, disconnect or timeout. The broker must have one replica or channel-sticky routing. A restart fails transient requests safely and the caller can retry.

The instance itself pushes signed native GitHub webhooks outward to the manifest URL. Host-specific App secrets authenticate events before structural IDs enter the outbox. No raw webhook payload is stored. Background guide reads use short-lived installation tokens restricted to one repository. Access jobs recheck the initiating user's provider rights and record confirmed outcomes in the grant and security ledgers.

Minimum App permissions are the selected permission fingerprint. Review reads need Contents and Pull requests read. Comments and reviews need Pull requests and Issues write. Merge needs Contents write. Access management needs Administration write and organisation Members write. Customer TLS roots can be mounted using `NODE_EXTRA_CA_CERTS`; TLS verification must stay enabled.

Enterprise credit pools and overage rates are negotiated. An operator sets the included pool, rate and `contract_verified` only after the owner approves the contract. Without those values, Enterprise AI returns the quote/configuration path rather than guessing billing terms. No live annual contract or charge is created by this implementation.

## Verification

The dashboard container was built locally with the managed proxy CA mounted only during dependency installation. It ran with a read-only root filesystem and answered `/api/health` and `/sign-in`. Relay tests exercise signed round trips, replay rejection, instance pinning, transient cleanup and address-range rejection. Provider fixtures cover both Enterprise Server and data-residency Cloud API URLs. There was no real Enterprise instance, customer database, native App confirmation or provider login available for live validation.

The explicit container migration helper also ran successfully twice against a new disposable Postgres 17 database, applying all dashboard migrations on the first run and making no schema changes on the second. This did not touch customer data. Compose configuration validation passed with generated test-only secrets.

Static `RELAY_CHANNELS` and database-backed channels can coexist. Static IDs take precedence when an ID appears in both sources, so reserve those IDs for the static connector and use distinct IDs for paired connections. Idle channel queues and replay guards expire only after the full two-minute replay window, and active requests or polls keep their state.
