import type { ProviderDiffView, ProviderDiffSyntax } from '../providers/types';
import { applyBitbucketWorkflowSyntax, removeBitbucketWorkflowSyntax } from './workflow-syntax';
import { BitbucketNativeSyntaxPreference } from './native-syntax-preference';
import type { NativeSyntaxPreferenceEnvironment } from './native-syntax-preference';
import { bitbucketNativeRenderedOn } from './native-rendered-syntax';

export function createBitbucketDiffSyntax(environment: NativeSyntaxPreferenceEnvironment = {}): ProviderDiffSyntax {
  let preference: BitbucketNativeSyntaxPreference | null = null;
  let owner: Document | null = null;
  let current: ProviderDiffView | null = null;
  return {
    apply(view) {
      const doc = view.container.ownerDocument;
      if (preference === null || owner !== doc) {
        preference?.clear();owner = doc;
        preference = new BitbucketNativeSyntaxPreference(doc, (capability) => {
          if (current === null) removeBitbucketWorkflowSyntax();
          else applyBitbucketWorkflowSyntax(current.entries, capability);
        }, environment);
      }
      current = view;
      const capability = preference.read();
      if (capability === 'unknown' && preference.allowsInitialRenderedOn()) {
        const entries = view.entries.filter((entry) => bitbucketNativeRenderedOn(view, entry));
        applyBitbucketWorkflowSyntax(entries, entries.length > 0 ? 'enabled' : 'unknown');
      } else applyBitbucketWorkflowSyntax(view.entries, capability);
    },
    clear() { current = null;preference?.clear();preference = null;owner = null;removeBitbucketWorkflowSyntax(); },
  };
}
