# Model A billing

Each member is a seat, including admins and members without a provider connection. Each team has its own subscription and pooled credits. Team creation limits use the highest plan among teams the actor administers. A new team starts Free and needs its own upgrade. This keeps membership and invoices unambiguous.

Only Stripe test keys are accepted. Configure the three monthly USD recurring prices to the published seat prices. Checkout validates the amount, currency, interval, active state and test mode before creating a session. Billing portal changes are reflected by signed webhook events. A plan is never upgraded from a browser return URL.

The database subscription is locked for credit reservations and webhook reconciliation. Seats come from current team membership, not an untrusted Stripe quantity. Period changes reset the pool once. Event IDs deduplicate deliveries and event timestamps reject older updates. Each update fetches the current Stripe subscription. A failed request refunds only its original billing period. A successful overage creates one durable outbox item with a Stripe idempotency key.

Every paid tier has an admin cap, defaulting to zero. Included credits require no overage permission. Extra credits require an active subscription, a card and room under the cap. Checkout and cap changes create append-only audit records. Enterprise contracts need an operator-configured negotiated pool before usage is enabled.

Without credentials, checkout returns an explicit configuration failure. The UI remains usable for reviewing plan limits and changing a stored cap. Database tests use disposable PGlite databases, not customer data. No live charges, Stripe provisioning or production migrations are part of this stack.

Account cleanup freezes billing and locks the team, subscription and checkout rows in the same order as checkout creation. It saves encrypted cleanup references independently of the erased team before taking the deletion cascade. Uncertain checkout creation is reconciled by its original key; completed subscriptions are canceled, and open sessions are expired. Financial cleanup keeps retrying until confirmed, then clears its encrypted payload.
