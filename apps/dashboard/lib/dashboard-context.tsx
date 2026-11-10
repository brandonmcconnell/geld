'use client';
import { createContext, useContext } from 'react';
import type { WorkspaceCache } from './workspace-cache';
import type { QueueData, SessionData } from './contracts';
export interface DashboardContext {
  readonly queue: QueueData;
  readonly cache: WorkspaceCache | null;
  readonly repositories: QueueData['repositories'];
  readonly session: SessionData;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
  readonly teams: readonly { id: string; name: string }[];
  readonly activeTeam: string;
  readonly setActiveTeam: (id: string) => void;
  readonly loadMore: () => void;
  readonly assistantOpen: boolean;
  readonly setAssistantOpen: (open: boolean) => void;
}
export const DashboardContext = createContext<DashboardContext>({
  queue: { pulls: [], repositories: [] },
  cache: null,
  repositories: [],
  session: { user: null, configured: false, demo: false },
  loading: true,
  error: null,
  refresh: () => undefined,
  teams: [],
  activeTeam: '',
  setActiveTeam: () => undefined,
  loadMore: () => undefined,
  assistantOpen: false,
  setAssistantOpen: () => undefined,
});
export function useDashboard() {
  return useContext(DashboardContext);
}
