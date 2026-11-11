import { createMatcher } from "@geld/core/matcher";
import { DEFAULT_SETTINGS } from "@geld/core/settings";
import {
  type PullSignals,
  pullSignalsFrom,
  type SignalFile,
} from "./pull-signals";

/** The split under Geld's default categories, until the reader's settings are read here. */
export function defaultPullSignals(
  files: readonly SignalFile[],
  repo: string,
  partial: boolean
): PullSignals {
  return pullSignalsFrom(files, createMatcher(DEFAULT_SETTINGS, repo), partial);
}
