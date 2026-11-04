export const PRIVACY_CONTACT = 'privacy@geld.sh';
export const PRIVACY_UPDATED = 'November 1, 2026';
export const PRIVACY_SECTIONS: readonly {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
}[] = [
  {
    id: 'controller',
    title: 'Who operates Geld',
    paragraphs: [
      'Geld is operated by Brandon McConnell. Contact privacy@geld.sh about personal data or your privacy rights. This policy covers the Geld dashboard, geld.sh, the browser extension and the Geld Action. The service is not intended for children under 16.',
    ],
  },
  {
    id: 'extension',
    title: 'Using the extension without an account',
    paragraphs: [
      'The extension can hide review noise without a Geld account. It reads the Git provider page you are viewing and fetches diffs, page data and repository configuration using the provider session you already have. Settings and parsed diff counts are stored on your device. Diff counts can include file paths. Your browser may sync extension settings through its own sync service.',
      'The extension downloads a signed pattern catalog from GitHub. Optional GitHub settings sync stores your settings in a secret gist on your own GitHub account. A secret gist is unlisted, not a substitute for encrypted storage. Feedback and diagnostic reports are shared only when you choose to submit them.',
    ],
  },
  {
    id: 'accounts',
    title: 'Accounts and connected identities',
    paragraphs: [
      'When you create a Geld account, we process your name, email, verification status, linked provider identities and session information to deliver the service under our contract with you. You can sign up with an email code or magic link and connect GitHub, GitLab or Bitbucket later. Optional passwords are hashed. OAuth credentials are encrypted at rest. Session cookies are HttpOnly and use secure transport in hosted environments.',
      'The GitHub identity App is separate from repository Apps. Repository access depends on the repositories selected for an installation and your own provider permissions. Optional GitHub OAuth access uses the repo scope, which grants read and write access to all repositories your account can reach. You choose whether to authorize that optional scope.',
    ],
  },
  {
    id: 'teams',
    title: 'Teams, repositories and security records',
    paragraphs: [
      'We store team membership, provider organisation and repository references, review assignments, access requests, grant history, billing references and configuration. These records support the account and team features you request. Provider permissions remain authoritative. Team administration does not grant provider access.',
      'We process minimal security and audit metadata under our legitimate interests in protecting accounts and tracing access changes. Audit records identify the action, actor reference, affected resource, outcome and request identifier. They do not contain raw PR content, credentials, IP addresses or user agents. Pending access requests expire after 14 days.',
    ],
  },
  {
    id: 'pr-content',
    title: 'Pull request content and AI',
    paragraphs: [
      'Interactive provider work uses the browser directly where practical. When server processing is needed, raw pull request bodies, diffs and conversation content are processed transiently and are not stored in Geld’s application database. Provider metadata can still identify a private repository. We limit access to that metadata according to your provider and team permissions.',
      'AI guides and assistant requests send the selected review context to the provider or gateway you choose. Geld-billed AI uses the configured hosted gateway and model providers. These services act as processors where applicable and have their own retention and processing terms. Your own key or gateway can be used instead. AI use is metered in Geld credits, and there is no free deterministic guide.',
      'Generated content is kept on your device or encrypted in the storage configured for your deployment, with a 30-day server retention. The local Claude companion uses your installed Claude Code and native sign-in. Geld receives no Claude login tokens. Signed relay traffic is transient. Self-hosted and customer-database deployments can use customer-managed services. A draft impact assessment covers hosted AI and automatic guide processing and requires the operator’s review before hosted launch. The legal role and lawful basis for repository content processing must be assessed for each deployment and customer relationship.',
    ],
  },
  {
    id: 'processors',
    title: 'Service providers and transfers',
    paragraphs: [
      'Hosted Geld uses Vercel for hosting, Neon for Postgres, Stripe for payments, a configured transactional email provider for account and billing messages, and PostHog for optional measurement and feature configuration. AI gateways, model providers and read-only tracker connections process data needed for the features you enable. Self-hosted deployments use the services selected by their operator.',
      'Data may be processed outside the country where you live, including outside the European Economic Area. Applicable processor agreements and transfer safeguards, such as standard contractual clauses, must be in place before the relevant hosted processing begins. We do not sell your personal data or share it for cross-context behavioral advertising.',
    ],
  },
  {
    id: 'consent',
    title: 'Optional measurement and your choices',
    paragraphs: [
      'Optional analytics loads only after you opt in to measurement. You can opt in to all optional categories, cancel, or manage categories individually. Optional categories start off. Global Privacy Control is treated as a refusal. You can change your choice using Privacy settings in the footer.',
      'Without measurement, Geld does not collect optional visits, feature usage, setup funnel events, navigation patterns or struggle signals. The product features and feature flags continue to work. When enabled, measurement uses normalized routes, excludes private repository identities, masks text and inputs by default and strips sensitive content before sending events. The extension requires a separate consent choice before its own optional measurement can run.',
    ],
  },
  {
    id: 'billing',
    title: 'Billing',
    paragraphs: [
      'We process the subscription tier, team seat count, pooled credit usage, spending cap and Stripe references to deliver and bill your plan under our contract. Stripe processes payment details. Geld does not store full card details. A billing safety net requires explicit opt-in, a card on file and a spending cap.',
    ],
  },
  {
    id: 'retention',
    title: 'Retention',
    paragraphs: [
      'Account records remain while the account is active. Sessions and verification records expire according to their purpose. Security audit metadata is retained for 365 days, webhook delivery identifiers for 90 days and completed job metadata for 30 days, unless a shorter period is appropriate or law requires otherwise. Billing records may be retained to meet legal accounting obligations.',
      'Removing a repository from an active team preserves its settings and grant history so they can be restored if it is added again. Account deletion and valid privacy erasure requests override this normal removal behavior. Encrypted credentials are removed on disconnect or erasure, without retaining your OAuth credentials for cleanup. If a provider or customer database is unavailable, minimal encrypted cleanup references are retained for up to seven days, then removed. Shared-team security history retains a pseudonymous actor reference for its security retention period.',
    ],
  },
  {
    id: 'rights',
    title: 'Your rights',
    paragraphs: [
      'You can request access, correction, deletion, restriction, portability or an objection to processing, and withdraw optional consent. Account settings offer JSON export, email changes, password setup, provider unlinking and account deletion. Contact privacy@geld.sh if a right cannot be completed in the product. We may verify your identity before acting.',
      'We respond within one month under GDPR, or 45 days where CCPA applies, with any permitted extension explained. You may complain to your local data protection authority. California residents may exercise applicable access, correction, deletion and opt-out rights without discrimination. We do not use solely automated decisions with legal or similarly significant effects.',
    ],
  },
  {
    id: 'security',
    title: 'Security and incidents',
    paragraphs: [
      'We use encrypted provider credentials, hashed passwords, protected sessions and scoped access controls. Secrets are kept in deployment secret stores. If an incident affects personal data, we assess the impact and notify affected people and regulators where required, including within 72 hours to the regulator when GDPR requires it.',
    ],
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    paragraphs: [
      'This policy was updated on November 1, 2026. Material changes are announced in the product or by account email before they take effect where appropriate. The public source history records policy changes.',
    ],
  },
];
