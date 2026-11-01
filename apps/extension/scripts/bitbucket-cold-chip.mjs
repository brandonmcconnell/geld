/** Read-only geometry evidence: never hover, focus, scroll or acquire counts. */
export function bitbucketColdChipVisibilityProbe() {
  const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  const bounds = (node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
  };
  const contains = (outer, inner) => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
  const rows = [];
  let skippedOffscreen = 0;
  let skippedHidden = 0;
  const chips = [...document.querySelectorAll('tr[data-qa="pull-request-row"] .geld-provider-list-counts[data-geld-ui]')];
  for (const chip of chips.slice(0, 128)) {
    if (chip.textContent.replace(/\s+/g, ' ').trim() !== 'Hover to count changes') continue;
    const rect = bounds(chip);
    if (rect.width <= 0 || rect.height <= 0) { skippedHidden += 1; continue; }
    if (rect.bottom <= 0 || rect.top >= viewport.bottom || rect.top < viewport.top || rect.bottom > viewport.bottom) { skippedOffscreen += 1; continue; }
    const line = chip.parentElement;
    const presentation = line?.querySelector(':scope > div[role="presentation"]');
    const title = presentation?.querySelector(':scope > span > a[data-qa="pull-request-row-link"]');
    if (title === null || title === undefined || line === null || presentation === null || presentation === undefined) {
      rows.push({ text: chip.textContent, fullTextVisible: false, unsupported: 'Missing verified native title mount' });
      continue;
    }
    const clip = { ...viewport };
    const clippers = [];
    const unsupported = [];
    let presented = true;
    for (let node = chip; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity !== '' && Number(style.opacity) === 0) presented = false;
      if (style.clipPath && style.clipPath !== 'none') unsupported.push('clip-path');
      if (style.maskImage && style.maskImage !== 'none') unsupported.push('mask-image');
      if (style.clip && style.clip !== 'auto') unsupported.push('legacy-clip');
      const clipsX = /^(auto|scroll|overlay|hidden|clip)$/.test(style.overflowX || style.overflow);
      const clipsY = /^(auto|scroll|overlay|hidden|clip)$/.test(style.overflowY || style.overflow);
      if (!clipsX && !clipsY) continue;
      const box = bounds(node);
      const content = { left: box.left + node.clientLeft, right: box.left + node.clientLeft + node.clientWidth, top: box.top + node.clientTop, bottom: box.top + node.clientTop + node.clientHeight };
      if (clipsX) { clip.left = Math.max(clip.left, content.left); clip.right = Math.min(clip.right, content.right); }
      if (clipsY) { clip.top = Math.max(clip.top, content.top); clip.bottom = Math.min(clip.bottom, content.bottom); }
      clippers.push({ tag: node.tagName, className: node.className, clipsX, clipsY, bounds: content });
    }
    const range = document.createRange();
    range.selectNodeContents(chip);
    const text = bounds(range);
    const points = [text.left + 1, (text.left + text.right) / 2, text.right - 1].map((x) => {
      const y = (text.top + text.bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, ownedByChip: hit !== null && (hit === chip || chip.contains(hit)) };
    });
    const nativeStyle = getComputedStyle(presentation);
    rows.push({ href: title.getAttribute('href'), title: title.textContent, text: chip.textContent, bounds: rect, textBounds: text, clip, clippers, unsupported, hitPoints: points,
      nativeTitle: { display: getComputedStyle(title).display, spanDisplay: getComputedStyle(title.parentElement).display, overflow: nativeStyle.overflow, textOverflow: nativeStyle.textOverflow, whiteSpace: nativeStyle.whiteSpace, clientWidth: presentation.clientWidth, scrollWidth: presentation.scrollWidth, anchorName: title.parentElement.style.anchorName, describedBy: title.parentElement.getAttribute('aria-describedby') },
      fullTextVisible: presented && unsupported.length === 0 && text.width > 0 && text.height > 0 && contains(rect, text) && contains(clip, text) && points.every((point) => point.ownedByChip) });
  }
  return { viewport, rows, skippedOffscreen, skippedHidden, truncated: chips.length > 128, allVisible: rows.length > 0 && rows.every((row) => row.fullTextVisible) };
}

/** Native analytics/metadata can arrive independently; count resources and extension frames cannot pass as incidental traffic. */
export function bitbucketCountIntentRequests(requests) {
  return requests.filter((request) => {
    if (request.extensionInitiator) return true;
    let url;
    try { url = new URL(request.url); } catch { return false; }
    if (url.origin !== 'https://api.bitbucket.org' && url.origin !== 'https://bitbucket.org') return false;
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return false; }
    const api = url.origin === 'https://bitbucket.org' ? '/!api/2.0/' : '/2.0/';
    if (!pathname.startsWith(api)) return false;
    const resource = /^repositories\/[^/]+\/[^/]+\/(.*)$/.exec(pathname.slice(api.length))?.[1] ?? '';
    return /^(?:pullrequests\/[1-9]\d*\/)?(?:diff|diffstat)(?:\/|$)/.test(resource)
      || /^src\/[^/]+\/(?:\.github(?:\/geld\.yml)?\/?|\.gitattributes)?$/.test(resource);
  });
}
