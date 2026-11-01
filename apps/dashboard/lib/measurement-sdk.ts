'use client';
import type { PostHog } from 'posthog-js';
declare global {
  interface Window {
    posthog?: PostHog;
  }
}
export async function loadMeasurementSdk(signal: AbortSignal): Promise<PostHog | null> {
  if (signal.aborted) return null;
  if (window.posthog) return window.posthog;
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = '/api/measurement/sdk';
    script.async = true;
    const done = (value: PostHog | null) => {
      signal.removeEventListener('abort', cancel);
      script.onload = null;
      script.onerror = null;
      resolve(value);
    };
    const cancel = () => {
      script.remove();
      done(null);
    };
    signal.addEventListener('abort', cancel, { once: true });
    script.onload = () => done(signal.aborted ? null : (window.posthog ?? null));
    script.onerror = () => {
      script.remove();
      done(null);
    };
    document.head.append(script);
  });
}
