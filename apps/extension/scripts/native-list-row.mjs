export function bitbucketListRowSnapshot() {
  const title = [...document.querySelectorAll('a[data-qa="pull-request-row-link"]')].find((node) => new URL(node.href).pathname === '/atlassian/bitbucket-upload-file/pull-requests/27' && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
  const row = title?.closest('tr[data-qa="pull-request-row"]');
  if (row == null) return null;
  const owned = (node) => node.closest('[data-geld-ui]') !== null;
  const popupFor = (node) => {
    const popup = node.closest('[role="tooltip"], [popover]');
    return popup !== null && popup !== row && row.contains(popup) && !owned(popup) ? popup : null;
  };
  const ids = [row, ...row.querySelectorAll('[id]')].filter((node) => node.id !== '' && !owned(node));
  const links = [...row.querySelectorAll('a[href]')].filter((node) => !owned(node));
  const popups = [...new Set([...ids, ...links].map(popupFor).filter((node) => node !== null))];
  const titleSpan = title.parentElement;
  const presentation = titleSpan?.parentElement?.getAttribute('role') === 'presentation' ? titleSpan.parentElement : null;
  const titleLine = presentation?.parentElement ?? titleSpan;
  const chip = titleLine?.querySelector('.geld-provider-list-counts');
  const sample = (node) => {
    if (node == null) return null;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const attributes = Object.fromEntries([...node.attributes].filter((attribute) => /^(?:id|role|data-testid|data-qa|aria-describedby|aria-controls|popovertarget|popover|style)$/.test(attribute.name)).map((attribute) => [attribute.name, attribute.value]));
    return { tag: node.tagName, attributes, bounds: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
      style: Object.fromEntries(['display', 'position', 'anchorName', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'gap', 'alignItems', 'flexDirection'].map((key) => [key, style[key]])) };
  };
  return {
    text: chip?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    title: chip?.getAttribute('title') ?? null,
    nativeIds: ids.filter((node) => popupFor(node) === null).map((node) => node.id),
    nativeLinks: links.filter((node) => popupFor(node) === null).map((node) => ({ href: node.getAttribute('href'), qa: node.getAttribute('data-qa') })),
    transientNativePopups: popups.map((popup) => ({
      id: popup.id, tag: popup.tagName, role: popup.getAttribute('role'), popover: popup.getAttribute('popover'),
      ids: ids.filter((node) => popupFor(node) === popup).map((node) => node.id),
      links: links.filter((node) => popupFor(node) === popup).map((node) => ({ href: node.getAttribute('href'), qa: node.getAttribute('data-qa') })),
    })),
    titlePresentation: { title: sample(title), span: sample(titleSpan), presentation: sample(presentation), line: sample(titleLine) },
    chipMount: chip == null ? null : { chip: sample(chip), parent: sample(chip.parentElement), insideTitleSpan: titleSpan?.contains(chip) ?? false, insideNativePresentation: presentation?.contains(chip) ?? false },
    rowHidden: row.hidden,
    display: getComputedStyle(row).display,
  };
}

export function countHoverVisibilityProbe() {
  const tip = document.querySelector('#geld-provider-count-tooltip[role="tooltip"]');
  if (tip === null || tip.hidden || getComputedStyle(tip).display === 'none') return null;
  const rectOf = (node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
  };
  const overlaps = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
  const overlays = [...document.querySelectorAll('[role="tooltip"], [popover]')].filter((node) => node !== tip && !tip.contains(node) && node.closest('[data-geld-ui]') === null).flatMap((node) => {
    const style = getComputedStyle(node);
    const bounds = rectOf(node);
    if (bounds.width <= 0 || bounds.height <= 0 || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return [];
    return [{ id: node.id, tag: node.tagName, role: node.getAttribute('role'), popover: node.getAttribute('popover'), pointerEvents: style.pointerEvents, zIndex: style.zIndex, text: node.textContent.trim().slice(0, 200), bounds }];
  });
  const rows = [...tip.querySelectorAll('.geld-provider-hover__row')].map((row) => {
    const cells = [...row.querySelectorAll('span')].map((cell) => {
      const bounds = rectOf(cell);
      const range = document.createRange();
      range.selectNodeContents(cell);
      const text = rectOf(range);
      const center = { x: (text.left + text.right) / 2, y: (text.top + text.bottom) / 2 };
      const hit = document.elementFromPoint(center.x, center.y);
      const hitOwned = hit !== null && tip.contains(hit);
      const intersecting = overlays.filter((overlay) => overlaps(overlay.bounds, text));
      const potentialOccluders = intersecting;
      return { text: cell.textContent, className: cell.className, bounds, textBounds: text, center,
        hit: hit === null ? null : { tag: hit.tagName, id: hit.id, role: hit.getAttribute('role'), testid: hit.getAttribute('data-testid'), ownedByTooltip: hitOwned },
        intersectingNativeOverlays: intersecting, potentialOccluders,
        unobscured: text.width > 0 && text.height > 0 && hitOwned && potentialOccluders.length === 0 };
    });
    return { label: row.querySelector('.geld-provider-hover__label')?.textContent, bounds: cells.length === 0 ? null : {
      left: Math.min(...cells.map((cell) => cell.bounds.left)), right: Math.max(...cells.map((cell) => cell.bounds.right)),
      top: Math.min(...cells.map((cell) => cell.bounds.top)), bottom: Math.max(...cells.map((cell) => cell.bounds.bottom)),
    }, cells };
  });
  return { bounds: rectOf(tip), rows, nativeOverlays: overlays, unobscured: rows.length > 0 && rows.every((row) => row.cells.length === 4 && row.cells.every((cell) => cell.unobscured)) };
}
