export function configured(value: string | undefined): string | null {
  return value && value.trim() && !value.startsWith('<') ? value.trim() : null;
}
export function dashboardOrigin(): string {
  return (
    configured(process.env.BETTER_AUTH_URL) ??
    (process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : 'https://app.geld.sh')
  );
}
export function isPreview(): boolean {
  return process.env.VERCEL_ENV === 'preview';
}
export function demoEnabled(): boolean {
  return process.env.GELD_DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production' && !process.env.VERCEL_ENV;
}
