import { createMatcher } from "@geld/core/matcher";
import type { GeldSettings } from "@geld/core/settings";
import {
  type PullSignals,
  pullSignalsFrom,
  type SignalFile,
} from "./pull-signals";

/** The split under the reader's settings, scoped to the repository for their per-repository patterns. */
export function readerPullSignals(
  files: readonly SignalFile[],
  settings: GeldSettings,
  repo: string,
  partial: boolean
): PullSignals {
  return pullSignalsFrom(files, createMatcher(settings, repo), partial);
}
