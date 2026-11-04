import { z } from 'zod';
export const measurementTarget = z.enum([
  'primary-nav',
  'queue-filter',
  'queue-row',
  'guide',
  'review-step',
  'review-submit',
  'assistant',
  'provider-connect',
  'billing-plan',
  'team-access',
  'privacy-settings',
]);
export const featureName = z.enum([
  'guide',
  'assistant',
  'review',
  'connections',
  'billing',
  'team-access',
  'trackers',
  'models',
  'enterprise',
  'consolidation',
]);
export function normalisedRoute(pathname: string): string {
  const path = pathname.split('?')[0] ?? '/';
  if (
    new Set([
      '/:page',
      '/:provider/:owner/:repo/pull/:number',
      '/:provider/:resource/~settings',
      '/:provider/:resource',
      '/teams/:team/settings',
      '/teams/:team',
    ]).has(path)
  )
    return path;
  if (/^\/(github|gitlab|bitbucket)\//.test(path) || path.startsWith('/ghe/'))
    return /\/pull\/\d+(?:\/|$)/.test(path)
      ? '/:provider/:owner/:repo/pull/:number'
      : path.endsWith('/~settings')
        ? '/:provider/:resource/~settings'
        : '/:provider/:resource';
  if (/^\/teams\/[^/]+/.test(path)) return path.endsWith('/settings') ? '/teams/:team/settings' : '/teams/:team';
  const known = new Set([
    '/',
    '/connect',
    '/sign-in',
    '/inbox',
    '/repositories',
    '/teams',
    '/projects',
    '/roadmap',
    '/privacy',
    '/settings',
    '/settings/account',
    '/settings/account/reset-password',
    '/settings/review',
    '/settings/providers',
    '/settings/models',
    '/settings/billing',
    '/settings/security',
    '/settings/enterprise',
  ]);
  return known.has(path) ? path : '/:page';
}
const properties = z
  .object({
    route: z.string().transform(normalisedRoute).optional(),
    from: z.string().transform(normalisedRoute).optional(),
    target: measurementTarget.optional(),
    feature: featureName.optional(),
    provider: z.enum(['github', 'gitlab', 'bitbucket', 'geld', 'gateway', 'openai', 'claude']).optional(),
    stage: z.enum(['started', 'connected', 'completed', 'failed', 'abandoned']).optional(),
    signal: z.enum(['repeated-click', 'error', 'slow-response']).optional(),
    cell: z.number().int().min(0).max(15).optional(),
    count: z.number().int().min(0).max(10000).optional(),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info', 'unknown']).optional(),
    agent: z
      .enum([
        'bugbot',
        'greptile',
        'devin',
        'codex',
        'copilot',
        'coderabbit',
        'gemini',
        'capy',
        'replicas',
        'claude',
        'cubic',
        'sourcery',
        'qodo',
        'amazon-q',
        'ellipsis',
        'macroscope',
        'korbit',
        'entelligence',
        'unknown',
      ])
      .optional(),
  })
  .strict();
export const measurementEvent = z.enum([
  'route_visit',
  'navigation',
  'selector_click',
  'provider_setup',
  'feature_usage',
  'billing_conversion',
  'struggle',
  'flow',
  'agent_structure',
  'agent_format',
]);
export interface Measurement {
  readonly event: z.infer<typeof measurementEvent>;
  readonly properties: z.input<typeof properties>;
}
export function sanitiseMeasurement(event: unknown, raw: unknown): Measurement | null {
  const name = measurementEvent.safeParse(event);
  if (!name.success || typeof raw !== 'object' || raw === null) return null;
  const safe: Record<string, unknown> = {};
  for (const key of Object.keys(properties.shape)) if (key in raw) safe[key] = Reflect.get(raw, key);
  const result = properties.safeParse(safe);
  return result.success ? { event: name.data, properties: result.data } : null;
}
