export const OPTIONAL_PROVIDER_ORIGINS = {
  gitlab: ['https://gitlab.com/*'],
  bitbucket: ['https://bitbucket.org/*', 'https://api.bitbucket.org/*'],
};

export type OptionalProvider = keyof typeof OPTIONAL_PROVIDER_ORIGINS;

export function withoutRequiredProviderOrigins<T extends string>(origins: readonly T[]): T[] {
  const optional = new Set(Object.values(OPTIONAL_PROVIDER_ORIGINS).flat());
  return origins.filter((origin) => !optional.has(origin));
}
