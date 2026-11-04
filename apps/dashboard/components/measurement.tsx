'use client';
import { loadMeasurementSdk } from '@/lib/measurement-sdk';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { z } from 'zod';
import { normalisedRoute, measurementTarget, sanitiseMeasurement } from '@geld/domain';
import type { Measurement as SafeMeasurement } from '@geld/domain';
const configSchema = z.object({ config: z.object({ key: z.string().max(500), host: z.url() }).nullable() });
const detail = z.object({ event: z.unknown(), properties: z.unknown() });
export function Measurement({ enabled }: { readonly enabled: boolean }) {
  const route = normalisedRoute(usePathname());
  const currentRoute = useRef(route);
  const visit = useRef<((route: string) => void) | null>(null);
  useEffect(() => {
    currentRoute.current = route;
    visit.current?.(route);
  }, [route]);
  useEffect(() => {
    if (!enabled) return;
    const early: SafeMeasurement[] = [];
    let receiver: ((event: Event) => void) | null = null;
    const listener = (event: Event) => {
      if (receiver) {
        receiver(event);
        return;
      }
      if (!(event instanceof CustomEvent) || early.length >= 100) return;
      const parsed = detail.safeParse(event.detail);
      const safe = parsed.success ? sanitiseMeasurement(parsed.data.event, parsed.data.properties) : null;
      if (safe) early.push(safe);
    };
    window.addEventListener('geld:measurement', listener);
    const abort = new AbortController();
    let stopped = false;
    let detach: () => void = () => undefined;
    void fetch('/api/measurement/config', { signal: abort.signal })
      .then(async (response) => {
        const parsed = configSchema.safeParse(await response.json());
        if (!response.ok || !parsed.success || !parsed.data.config || stopped) return null;
        const posthog = await loadMeasurementSdk(abort.signal);
        return posthog ? { posthog, ...parsed.data.config } : null;
      })
      .then((result) => {
        if (stopped || !result) return;
        const { posthog, key, host } = result;
        const anonymousId = crypto.randomUUID();
        posthog.init(key, {
          api_host: host,
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: false,
          disable_session_recording: true,
          disable_surveys: true,
          person_profiles: 'never',
          ip: false,
          advanced_disable_feature_flags: true,
          mask_all_text: true,
          mask_all_element_attributes: true,
          persistence: 'memory',
          before_send: (event) => {
            if (!event) return null;
            const safe = sanitiseMeasurement(event.event, event.properties);
            return safe
              ? {
                  ...event,
                  event: safe.event,
                  properties: {
                    ...safe.properties,
                    token: key,
                    distinct_id: anonymousId,
                    $process_person_profile: false,
                  },
                }
              : null;
          },
        });
        posthog.opt_in_capturing({ captureEventName: false });
        const flows = new Map<string, SafeMeasurement['properties']>();
        let previous: string | null = null;
        let lastTarget = '';
        let lastAt = 0;
        let repeated = 0;
        const abandon = () => {
          for (const value of flows.values())
            posthog.capture('flow', {
              ...value,
              stage: 'abandoned',
              route: currentRoute.current,
            });
          flows.clear();
        };
        visit.current = (route) => {
          if (previous === route) return;
          abandon();
          posthog.capture('route_visit', { route });
          if (previous) posthog.capture('navigation', { from: previous, route });
          previous = route;
        };
        visit.current(currentRoute.current);
        const click = (event: MouseEvent) => {
          if (!(event.target instanceof Element)) return;
          const element = event.target.closest('[data-measure]');
          if (!(element instanceof HTMLElement)) return;
          const target = measurementTarget.safeParse(element.dataset.measure);
          if (!target.success) return;
          const rect = element.getBoundingClientRect();
          const x = Math.max(0, Math.min(3, Math.floor(((event.clientX - rect.left) / Math.max(rect.width, 1)) * 4)));
          const y = Math.max(0, Math.min(3, Math.floor(((event.clientY - rect.top) / Math.max(rect.height, 1)) * 4)));
          posthog.capture('selector_click', {
            route: currentRoute.current,
            target: target.data,
            cell: y * 4 + x,
          });
          const now = Date.now();
          repeated = lastTarget === target.data && now - lastAt < 1200 ? repeated + 1 : 1;
          lastTarget = target.data;
          lastAt = now;
          if (repeated === 3)
            posthog.capture('struggle', {
              route: currentRoute.current,
              target: target.data,
              signal: 'repeated-click',
            });
        };
        const custom = (event: Event) => {
          if (!(event instanceof CustomEvent)) return;
          const parsed = detail.safeParse(event.detail);
          if (!parsed.success) return;
          const safe = sanitiseMeasurement(parsed.data.event, parsed.data.properties);
          if (!safe) return;
          if (safe.event === 'flow' && safe.properties.feature) {
            if (safe.properties.stage === 'started') flows.set(safe.properties.feature, safe.properties);
            else flows.delete(safe.properties.feature);
          }
          posthog.capture(safe.event, {
            ...safe.properties,
            route: currentRoute.current,
          });
        };
        document.addEventListener('click', click);
        receiver = custom;
        for (const value of early) custom(new CustomEvent('geld:measurement', { detail: value }));
        early.length = 0;
        window.addEventListener('pagehide', abandon);
        detach = () => {
          visit.current = null;
          document.removeEventListener('click', click);
          receiver = null;
          window.removeEventListener('pagehide', abandon);
          posthog.opt_out_capturing();
          posthog.reset();
        };
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
      abort.abort();
      window.removeEventListener('geld:measurement', listener);
      early.length = 0;
      detach();
    };
  }, [enabled]);
  return null;
}
