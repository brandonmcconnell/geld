/** Dedicated read-only PR context policy. All other browser cases retain40. */
export function bitbucketPrContextPolicy(focus) {
  return focus === 'bitbucket-pr-whole-context' ? { conservativeObservedRequestBudget: 47, totalReadOnlyRequestBudget: 50, externalRequestReserve: 3,
    externalRequestReserveReason: 'Reserve for requests accounted outside the browser runner' } : {};
}

export function bitbucketPrContextInputBudget(active, { cachedOwnFold = false } = {}) {
  if (!Number.isSafeInteger(active) || active < 0) return { available: false, requiredFree: 3, cachedOwnFold: false };
  // Cached exemptions are supplied only after the qualified whole-source reader
  // confirms every line of this owned test fold is already mounted.
  return { available: active < 47 && (cachedOwnFold === true || active + 3 <= 47), requiredFree: cachedOwnFold === true ? 0 : 3, cachedOwnFold: cachedOwnFold === true };
}
