export function commentBodyPresentationProbe(provider, anchor) {
  const maxNodes = 120;
  const maxSamples = 24;
  const maxText = 20_000;
  const typography = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'color'];
  const decoration = ['backgroundColor', 'borderRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', ...['Top', 'Right', 'Bottom', 'Left'].flatMap((side) => [`border${side}Width`, `border${side}Style`, `border${side}Color`])];
  const categories = ['root', 'heading', 'paragraph', 'link', 'inline code', 'block code', 'preformatted', 'list', 'list item', 'table', 'table section', 'table row', 'table cell', 'table header label'];
  const selector = 'h1,h2,h3,h4,h5,h6,p,a,code,pre,ul,ol,li,table,thead,tbody,tfoot,tr,th,td,thead > tr > th[scope="col"][aria-sort][class~="gl-group/markdown-table-header"] > div > button[type="button"][id^="markdown-table-"][id$="-sort"] > span:not([aria-hidden]),span[data-geld-native-table-header-label]';
  const uncovered = [];
  const samples = [];
  const contentMismatches = [];
  const result = { provider, anchor, samples, uncovered, contentMismatches, nativeRootPresent: false, ownedRootPresent: false, rootAligned: false, nativeNodes: 0, ownedNodes: 0, truncated: false };
  const unavailable = (reason) => { uncovered.push(`comment body: ${reason}`);return result; };
  if (!(provider === 'gitlab' ? /^note_[1-9]\d*$/.test(anchor) : provider === 'bitbucket' && /^comment-[1-9]\d*$/.test(anchor))) return unavailable('unsupported source identity');
  const originals = [...document.querySelectorAll(`[id="${anchor}"]`)].filter((node) => node.closest('[data-geld-ui]') === null);
  const sources = [...document.querySelectorAll('article.geld-provider-review__source[data-geld-source]')].filter((node) => node.getAttribute('data-geld-source') === anchor);
  if (originals.length !== 1 || sources.length !== 1) return unavailable('native identity or owned source article is absent or ambiguous');
  const original = originals[0];
  const source = sources[0];
  if (!original.matches(provider === 'gitlab' ? '[data-testid="noteable-note-container"]' : '[data-testid="comment"]')) return unavailable('native source container identity differs');
  const byline = source.querySelector(':scope > .geld-provider-review__byline');
  const permalink = [...byline?.querySelectorAll('a[href]') ?? []].find((node) => node.textContent.trim() === 'View original');
  try {
    const url = new URL(permalink?.href ?? '');
    const current = new URL(document.URL);
    const review = provider === 'gitlab' ? /^(\/.+\/-\/merge_requests\/[1-9]\d*)(?:\/|$)/.exec(current.pathname)?.[1] : /^(\/[^/]+\/[^/]+\/pull-requests\/[1-9]\d*)(?:\/|$)/.exec(current.pathname)?.[1];
    if (url.origin !== current.origin || url.username !== '' || url.password !== '' || decodeURIComponent(url.hash.slice(1)) !== anchor || review === undefined || !(url.pathname === review || url.pathname.startsWith(`${review}/`))) return unavailable('owned original permalink does not establish this native review source');
  } catch { return unavailable('owned original permalink is unavailable'); }
  const nativeSelector = provider === 'gitlab' ? '.note-body .note-text' : '[data-testid="comment-content"] .ak-renderer-document';
  const ownedSelector = provider === 'gitlab' ? ':scope > .geld-provider-review__body > .note-text' : ':scope > .geld-provider-review__body > .ak-renderer-document';
  const nativeRoots = [...original.querySelectorAll(nativeSelector)];
  const ownedRoots = [...source.querySelectorAll(ownedSelector)];
  if (nativeRoots.length !== 1) return unavailable('native body root is absent or ambiguous');
  const nativeRoot = nativeRoots[0];
  const ownedRoot = ownedRoots.length === 1 ? ownedRoots[0] : null;
  const visible = (node) => {
    if (node === null || node.closest('[hidden],[inert]') !== null) return false;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && !['hidden', 'collapse'].includes(style.visibility);
  };
  result.nativeRootPresent = visible(nativeRoot);
  result.ownedRootPresent = visible(ownedRoot);
  if (!result.nativeRootPresent) return unavailable('native body is not visibly presented at this viewport');
  if (ownedRoot === null) return unavailable('owned native body clone is absent or ambiguous');
  const nativeNodes = [nativeRoot, ...nativeRoot.querySelectorAll(selector)];
  const ownedNodes = [ownedRoot, ...ownedRoot.querySelectorAll(selector)];
  result.nativeNodes = nativeNodes.length;
  result.ownedNodes = ownedNodes.length;
  result.truncated = nativeNodes.length > maxNodes || ownedNodes.length > maxNodes;
  const kinds = new Map();
  const kind = (node, index) => index === 0 ? 'root' : /^H[1-6]$/.test(node.tagName) ? 'heading' : ({ P: 'paragraph', A: 'link', CODE: node.closest('pre') === null ? 'inline code' : 'block code', PRE: 'preformatted', UL: 'list', OL: 'list', LI: 'list item', TABLE: 'table', THEAD: 'table section', TBODY: 'table section', TFOOT: 'table section', TR: 'table row', TH: 'table cell', TD: 'table cell', SPAN: 'table header label' })[node.tagName];
  const sample = (node) => {
    if (node === null) return null;
    const style = getComputedStyle(node);
    return { tag: node.tagName, text: node.textContent.trim().slice(0, 240), textLength: node.textContent.length, presented: visible(node), style: Object.fromEntries([...typography, ...decoration].map((key) => [key, style[key]])) };
  };
  for (let index = 0; index < Math.min(nativeNodes.length, maxNodes); index += 1) {
    const native = nativeNodes[index];
    const owned = ownedNodes[index] ?? null;
    const category = kind(native, index);
    kinds.set(category, (kinds.get(category) ?? 0) + 1);
    const label = `comment body ${category} at source order ${index}`;
    if (native.namespaceURI !== 'http://www.w3.org/1999/xhtml' || owned !== null && owned.namespaceURI !== 'http://www.w3.org/1999/xhtml') { uncovered.push(`${label}: non-HTML source excluded`);continue; }
    if (native.closest('[contenteditable]') !== null) { uncovered.push(`${label}: native editing content excluded`);continue; }
    if (native.textContent.length > maxText) { uncovered.push(`${label}: text exceeds bounded sample size`);continue; }
    if (!native.textContent.trim()) { uncovered.push(`${label}: native element has no visible text`);continue; }
    if (!visible(native)) { uncovered.push(`${label}: native element is not visibly presented`);continue; }
    if (owned === null || native.tagName !== owned.tagName || native.textContent !== owned.textContent || native.tagName === 'A' && native.href !== owned.href) {
      const content = (node) => node === null ? null : { tag: node.tagName, text: node.textContent.trim().slice(0, 240), textLength: node.textContent.length, ...(node.tagName === 'A' ? { href: node.href } : {}) };
      contentMismatches.push({ label: `${label}: exact tag, text, link or source order does not match`, native: content(native), owned: content(owned) });continue;
    }
    if (index === 0) result.rootAligned = true;
    if (samples.length >= maxSamples || samples.filter((item) => item.category === category).length >= 3) { uncovered.push(`${label}: bounded sample limit reached`);continue; }
    samples.push({ label, category, sourceOrder: index, alignment: 'exact tag and full text in matching native source order', native: sample(native), owned: sample(owned), decoration: ['inline code', 'block code', 'preformatted', 'table', 'table section', 'table row', 'table cell'].includes(category) });
  }
  for (const category of categories) if (!kinds.has(category)) uncovered.push(`comment body ${category}: ${result.truncated ? 'not observed in bounded native scan' : 'absent from this native fixture'}`);
  if (result.truncated) uncovered.push(`comment body: source scan limited to ${maxNodes} nodes`);
  return result;
}

export function compareCommentBodyPresentation(value) {
  const covered = [];
  const mismatches = [...value.contentMismatches ?? []];
  const typography = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'color'];
  const equal = (label, owned, native) => { if (owned !== native) mismatches.push({ label, native, owned }); };
  if (value.nativeRootPresent && !value.ownedRootPresent) mismatches.push({ label: 'comment body root', native: 'presented', owned: 'absent or not presented' });
  for (const pair of value.samples) {
    if (!pair.native.presented) continue;
    if (pair.owned === null || !pair.owned.presented) { mismatches.push({ label: pair.label, native: 'presented', owned: 'absent or not presented' });continue; }
    covered.push(pair.label);
    for (const key of typography) equal(`${pair.label}.${key}`, pair.owned.style[key], pair.native.style[key]);
    if (!pair.decoration) continue;
    for (const key of ['backgroundColor', 'borderRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) equal(`${pair.label}.${key}`, pair.owned.style[key], pair.native.style[key]);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      for (const property of ['Width', 'Style']) equal(`${pair.label}.border${side}${property}`, pair.owned.style[`border${side}${property}`], pair.native.style[`border${side}${property}`]);
      if (pair.native.style[`border${side}Width`] !== '0px' && pair.native.style[`border${side}Style`] !== 'none') equal(`${pair.label}.border${side}Color`, pair.owned.style[`border${side}Color`], pair.native.style[`border${side}Color`]);
    }
  }
  return { covered, uncovered: value.uncovered, mismatches };
}
