'use client';

import { useSyncExternalStore } from 'react';

import { HEADER_SLOT_ID } from '@/components/header-slot';

const noop = (): void => undefined;
const subscribe = (): (() => void) => noop;

/**
 * The header's secondary-bar row, once mounted (`null` on the server and
 * before hydration). Bars portal into it so that the header's single
 * background and backdrop blur cover both rows with no seam.
 */
export function useHeaderSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => document.getElementById(HEADER_SLOT_ID), () => null);
}
