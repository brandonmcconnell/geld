import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { normalizeReviewAccountId, repositoryKey, trustedSummaryPublisherIdsFor, withTrustedReviewAccount } from '@geld/core';
import type { GeldSettings } from '@geld/core';
import { buildProviderReviewItems, providerBotSupport, providerPublicationCandidate, providerReviewKey, readProviderPublication, sourceLink } from '@geld/review';
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import { loadCatalog, watchCatalog } from '../lib/catalog';
import { settingsItem } from '../lib/storage';
import { isClearDiffCacheMessage, isGetTabStateMessage, isPerfReportMessage, isRevealFileMessage, isToggleHiddenMessage } from '../lib/messages';
import type { TabState, TabStateMessage } from '../lib/messages';
import { mark, snapshot } from '../lib/perf';
import type { PerfSnapshot } from '../lib/perf';
import { PROVIDER_IDLE_STATE, ProviderController } from './controller';
import { isProviderReviewPage } from './types';
import type { ProviderAdapter, ProviderPage, ProviderReviewSnapshot } from './types';
import type { ProviderConversationServices } from './conversation';
import { providerReviewWithTrustedAccounts, reviewedItemFingerprint } from './conversation';
import { createProviderPublisherTrust } from './publisher-trust';
import { ProviderRepoConfigSource } from './repo-config';
import { readProviderReviewedItems, repoConfigChoicesItem, saveProviderReviewedItem } from '../lib/local-state';
import type { ProviderReviewedStorage } from '../lib/local-state';
import { whitespaceOptOutsItem } from '../lib/local-state';
import { persist } from '../lib/context';
import { mergeWhitespaceOptOuts, ProviderWhitespace } from './whitespace';

interface ProviderBotTrustEnvironment {
  readonly page: () => ProviderPage | null;
  readonly snapshot: () => ProviderReviewSnapshot | null;
  readonly retired: () => boolean;
  readonly updated: (settings: GeldSettings) => void;
  readonly settings?: Pick<typeof settingsItem, 'update'>;
}

interface ProviderReviewedEnvironment {
  readonly page: () => ProviderPage | null;
  readonly snapshot: () => ProviderReviewSnapshot | null;
  readonly retired: () => boolean;
  readonly storage?: ProviderReviewedStorage;
  readonly getSettings?: () => Promise<GeldSettings>;
}

export function createProviderReviewedServices(environment: ProviderReviewedEnvironment): Pick<ProviderConversationServices, 'readReviewed' | 'saveReviewed'> {
  const currentReview = (input: ProviderReviewInput): ProviderReviewSnapshot => {
    const page = environment.page();
    const snapshot = environment.snapshot();
    if (environment.retired() || page === null || !isProviderReviewPage(page) || snapshot === null
      || providerReviewKey(input.subject) !== providerReviewKey(snapshot.input.subject)
      || input.subject.headSha !== snapshot.input.subject.headSha
      || page.provider !== input.subject.provider || page.number !== input.subject.id
      || repositoryKey(page.repository) !== repositoryKey({ provider: input.subject.provider, origin: input.subject.origin, path: input.subject.repository })
      || (page.headSha !== null && page.headSha !== input.subject.headSha)) throw new Error('This review changed. Reload its conversation before marking an item reviewed.');
    return snapshot;
  };
  const latestReview = async (input: ProviderReviewInput): Promise<{ readonly input: ProviderReviewInput; readonly snapshot: ProviderReviewSnapshot; readonly signature: string }> => {
    currentReview(input);
    const settings = await (environment.getSettings?.() ?? settingsItem.getValue());
    const snapshot = currentReview(input);
    const native = snapshot.input;
    const signature = JSON.stringify([native.threads, snapshot.comments]);
    const inputWithBots = providerReviewWithTrustedAccounts(native, snapshot.comments, settings, snapshot.complete);
    const repository = { provider: native.subject.provider, origin: native.subject.origin, path: native.subject.repository };
    const publication = await readProviderPublication({
      input: inputWithBots,
      comments: snapshot.comments,
      sourceCoverage: snapshot.sourceCoverage,
      trustedPublisherIds: trustedSummaryPublisherIdsFor(settings.trustedSummaryPublishers, repository),
    });
    unchanged(input, snapshot, signature);
    return { input: publication.input, snapshot, signature };
  };
  const unchanged = (input: ProviderReviewInput, snapshot: ProviderReviewSnapshot, signature: string): void => {
    const current = currentReview(input);
    if (current !== snapshot || JSON.stringify([current.input.threads, current.comments]) !== signature) throw new Error('The conversation changed. Reload it before marking an item reviewed.');
  };
  return {
    readReviewed: async (input) => {
      const latest = await latestReview(input);
      const stored = await readProviderReviewedItems(providerReviewKey(input.subject), input.subject.headSha, environment.storage);
      const result: Record<string, string> = {};
      for (const item of buildProviderReviewItems(latest.input)) {
        const fingerprint = stored[item.id];
        if (fingerprint !== undefined && fingerprint === await reviewedItemFingerprint(latest.input, item, latest.snapshot.comments)) result[item.id] = fingerprint;
      }
      unchanged(input, latest.snapshot, latest.signature);
      return result;
    },
    saveReviewed: async (input, item, fingerprint, reviewed) => {
      const validate = async (): Promise<void> => {
        const latest = await latestReview(input);
        if (fingerprint !== await reviewedItemFingerprint(latest.input, item, latest.snapshot.comments)) throw new Error('The item changed. Reload it before marking it reviewed.');
        unchanged(input, latest.snapshot, latest.signature);
      };
      await validate();
      await saveProviderReviewedItem(providerReviewKey(input.subject), input.subject.headSha, item.id, fingerprint, reviewed, validate, environment.storage);
    },
  };
}

/** The picker identifies a source comment; only the fetched native account can establish trust. */
export function createProviderBotTrust(environment: ProviderBotTrustEnvironment): NonNullable<ProviderConversationServices['saveTrustedBot']> {
  return async (input: ProviderReviewInput, candidate: ProviderReviewComment, botId: string): Promise<void> => {
    const verifiedAccount = (): { readonly page: ProviderPage; readonly comment: ProviderReviewComment } => {
      const page = environment.page();
      const snapshot = environment.snapshot();
      if (environment.retired() || page === null || !isProviderReviewPage(page) || snapshot === null
        || providerReviewKey(input.subject) !== providerReviewKey(snapshot.input.subject)
        || input.subject.headSha !== snapshot.input.subject.headSha
        || page.provider !== input.subject.provider || page.number !== input.subject.id
        || repositoryKey(page.repository) !== repositoryKey({ provider: input.subject.provider, origin: input.subject.origin, path: input.subject.repository })
        || (page.headSha !== null && page.headSha !== input.subject.headSha)) throw new Error('This review changed. Reload its conversation before trusting an account.');
      if (providerBotSupport(page.provider, botId)?.support !== 'supported') throw new Error('This reviewer service is not supported on this provider.');
      const comment = [...snapshot.comments, ...snapshot.input.threads.flatMap((thread) => thread.comments)]
        .find((item) => item.id === candidate.id && item.anchor === candidate.anchor && item.url === candidate.url && item.author.id === candidate.author.id);
      if (comment === undefined || comment.author.automated !== true
        || normalizeReviewAccountId(page.provider, comment.author.id) === null
        || sourceLink({ anchor: comment.anchor, url: comment.url, kind: 'comment', author: comment.author.login }, input.subject) === null) throw new Error('Choose an observed native automated account with a durable id.');
      return { page, comment };
    };
    verifiedAccount();
    const settings = await (environment.settings ?? settingsItem).update((current) => {
      // Storage writes queue behind other edits. Recheck navigation at the actual write.
      const { page, comment } = verifiedAccount();
      return { trustedReviewAccounts: withTrustedReviewAccount(current.trustedReviewAccounts, page.repository, botId, comment.author.id) };
    });
    if (!environment.retired()) environment.updated(settings);
  };
}

export async function startProvider(ctx: ContentScriptContext, adapter: ProviderAdapter): Promise<void> {
  if (window.top !== window) return;
  let retired = false;
  let controller: ProviderController | null = null;
  let unwatchSettings: (() => void) | null = null;
  let unwatchCatalog: (() => void) | null = null;
  let unwatchChoices: (() => void) | null = null;
  let observedReview: ProviderReviewSnapshot | null = null;
  let reviewGeneration = 0;
  const fetchReview = adapter.fetchReview?.bind(adapter);
  const sourceAdapter: ProviderAdapter = fetchReview === undefined ? adapter : { ...adapter, fetchReview: async (page, signal, doc) => {
    const generation = ++reviewGeneration;
    observedReview = null;
    const review = await fetchReview(page, signal, doc);
    if (!retired && !signal.aborted && generation === reviewGeneration) observedReview = review;
    return review;
  } };
  const quiet = (run: () => void): void => { try { run(); } catch { /* The extension context can disappear before its listeners. */ } };
  const publish = (state: TabState): void => {
    quiet(() => { void browser.runtime.sendMessage({ type: 'geld:tab-state', state } satisfies TabStateMessage).catch(() => undefined); });
  };
  const retire = (): void => {
    if (retired) return;
    retired = true;
    reviewGeneration += 1;
    observedReview = null;
    mark('retired:takeover');
    if (unwatchSettings !== null) quiet(unwatchSettings);
    if (unwatchCatalog !== null) quiet(unwatchCatalog);
    if (unwatchChoices !== null) quiet(unwatchChoices);
    controller?.stop();
    publish(PROVIDER_IDLE_STATE);
  };
  document.dispatchEvent(new Event('geld:takeover'));
  document.addEventListener('geld:takeover', retire, { once: true });
  ctx.onInvalidated(retire);
  mark('script-start');
  browser.runtime.onMessage.addListener((message: unknown, _sender: unknown, respond: (state: TabState | PerfSnapshot | boolean) => void): boolean | undefined => {
    if (isPerfReportMessage(message)) {
      if (retired) { setTimeout(() => quiet(() => respond(snapshot())), 100); return true; }
      respond(snapshot());
      return undefined;
    }
    if (isClearDiffCacheMessage(message)) {
      // Retired copies must not win the response race against their replacement.
      if (retired) return undefined;
      if (controller === null) { respond(false); return undefined; }
      void controller.clearDiffCache().then(() => quiet(() => respond(true)), () => quiet(() => respond(false)));
      return true;
    }
    if (!(isGetTabStateMessage(message) || isToggleHiddenMessage(message) || isRevealFileMessage(message))) return undefined;
    if (retired) {
      setTimeout(() => quiet(() => respond(PROVIDER_IDLE_STATE)), 100);
      return true;
    }
    if (isToggleHiddenMessage(message)) controller?.toggleHidden();
    if (isRevealFileMessage(message)) controller?.revealPath(message.path);
    respond(controller?.getTabState() ?? PROVIDER_IDLE_STATE);
    return undefined;
  });
  const [settings, catalog, choices, optOuts] = await Promise.all([settingsItem.getValue(), loadCatalog(), repoConfigChoicesItem.getValue(), whitespaceOptOutsItem.getValue()]);
  if (retired) return;
  mark('settings');
  mark('catalog');
  let whitespaceSnapshot = optOuts ?? {};
  let whitespaceWrites: Promise<unknown> = Promise.resolve();
  const whitespace = new ProviderWhitespace(settings, whitespaceSnapshot, (value) => {
    const base = whitespaceSnapshot;
    const edited = { ...value };
    whitespaceSnapshot = edited;
    const write = async (): Promise<void> => {
      const latest = await whitespaceOptOutsItem.getValue();
      await whitespaceOptOutsItem.setValue(mergeWhitespaceOptOuts(base, edited, latest ?? {}));
    };
    whitespaceWrites = whitespaceWrites.then(write, write);
    persist(whitespaceWrites);
  });
  const redirect = whitespace.navigation(new URL(window.location.href));
  if (redirect !== null) { mark('redirect-early'); window.location.replace(redirect); return; }
  let badge = settings.showBadge;
  const configs = adapter.fetchConfig === undefined ? null : new ProviderRepoConfigSource(adapter.fetchConfig, () => controller?.requestRefresh(), catalog);
  const saveTrustedBot = createProviderBotTrust({
    page: () => sourceAdapter.describe(new URL(window.location.href), document),
    snapshot: () => observedReview,
    retired: () => retired,
    updated: (value) => { badge = value.showBadge; whitespace.update(value); controller?.updateSettings(value); },
  });
  const saveTrustedPublisher = createProviderPublisherTrust({
    page: () => sourceAdapter.describe(new URL(window.location.href), document),
    snapshot: () => observedReview,
    retired: () => retired,
    updated: (value) => { badge = value.showBadge; whitespace.update(value); controller?.updateSettings(value); },
    settings: settingsItem,
    eligible: (input, comment) => providerPublicationCandidate(input, comment) !== null,
  });
  const reviewed = createProviderReviewedServices({
    page: () => sourceAdapter.describe(new URL(window.location.href), document),
    snapshot: () => observedReview,
    retired: () => retired,
  });
  controller = new ProviderController(sourceAdapter, settings, (state) => publish(badge ? state : { ...state, hiddenCount: 0 }), catalog, configs, choices, { saveTrustedBot, saveTrustedPublisher, ...reviewed });
  const started = controller;
  unwatchSettings = settingsItem.watch((value) => {
    badge = value.showBadge;
    whitespace.update(value);
    const destination = whitespace.navigation(new URL(window.location.href));
    if (destination !== null) window.location.replace(destination);
    else started.updateSettings(value);
  });
  unwatchCatalog = watchCatalog((value) => started.updateCatalog(value));
  unwatchChoices = repoConfigChoicesItem.watch((value) => started.updateRepoChoices(value ?? {}));
  ctx.addEventListener(window, 'wxt:locationchange', () => {
    if (retired) return;
    const destination = whitespace.navigation(new URL(window.location.href));
    if (destination !== null) window.location.replace(destination);
    else started.requestRefresh();
  });
  const prepareLink = (event: Event): void => {
    if (retired || !(event.target instanceof Element)) return;
    const anchor = event.target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    let url: URL;
    try { url = new URL(anchor.href); } catch { return; }
    const href = whitespace.link(url);
    if (href !== anchor.href) anchor.href = href;
  };
  ctx.addEventListener(document, 'pointerover', prepareLink);
  ctx.addEventListener(document, 'focusin', prepareLink);
  ctx.addEventListener(document, 'click', prepareLink, { capture: true });
  ctx.addEventListener(window, 'popstate', () => started.requestRefresh());
  ctx.addEventListener(document, 'turbo:load', () => started.requestRefresh());
  mark('controller-start');
  started.start();
}
