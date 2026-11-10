import type { Provider } from '@geld/domain';
const names = { github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket' };
export function ProviderSourceLink({
  provider,
  href,
}: {
  readonly provider: Provider;
  readonly href: string;
}) {
  return (
    <a
      href={href.startsWith('https://') ? href : '#'}
      className="provider-source-link"
      aria-label={`Open original pull request on ${names[provider]}`}
      title={`Open on ${names[provider]}`}
      target="_blank"
      rel="noreferrer"
    >
      <span className={`provider-source-mark provider-source-${provider}`} aria-hidden="true" />
      <span className="touch-target" aria-hidden="true" />
    </a>
  );
}
