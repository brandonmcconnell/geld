import { useQuery } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import {
  readerMatcher,
  readerSettings,
  setReaderSettings,
  subscribeReaderSettings,
} from "./file-category";
import { getGeldSettings } from "./settings.functions";

const SETTINGS_STALE_MS = 5 * 60 * 1000;

/** Loads the reader's settings once per session and keeps the browser's matcher on them. */
export function useLoadReaderSettings(enabled: boolean) {
  const { data } = useQuery({
    queryKey: ["geld", "settings"],
    queryFn: () => getGeldSettings(),
    enabled,
    staleTime: SETTINGS_STALE_MS,
  });
  useEffect(() => {
    if (data) setReaderSettings(data.settings);
  }, [data]);
  return data;
}

/** Re-renders when the reader's settings arrive or change. */
export function useReaderSettings() {
  return useSyncExternalStore(
    subscribeReaderSettings,
    readerSettings,
    readerSettings
  );
}

/** The matcher for the reader's settings, a new one when they change. */
export function useReaderMatcher() {
  useReaderSettings();
  return readerMatcher();
}
