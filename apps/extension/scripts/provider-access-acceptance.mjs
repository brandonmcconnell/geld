import assert from 'node:assert/strict';

export function optionalProvidersForCases(cases) {
  const providers = new Set();
  for (const name of cases) {
    if (name.startsWith('gitlab-') || name === 'cross-provider-settings' || name === 'bitbucket-commit-counts') providers.add('gitlab');
    if (name.startsWith('bitbucket-')) providers.add('bitbucket');
  }
  return ['gitlab', 'bitbucket'].filter(provider => providers.has(provider));
}

/** Exercise the same user-gesture opt-in as a new install, without granting permissions through automation APIs. */
export async function enableOptionalProviders(page, providers, { poll }) {
  const originalUrl = page.url();
  assert.equal(new URL(originalUrl).protocol, 'chrome-extension:');
  const result = [];
  for (const provider of providers) {
    assert.ok(provider === 'gitlab' || provider === 'bitbucket');
    const label = provider === 'gitlab' ? 'GitLab' : 'Bitbucket';
    const selector = `#provider-access button[data-provider-enable="${provider}"]`;
    const read = () => {
      assert.equal(page.url(), originalUrl, 'Provider opt-in must stay on the installed options page');
      return page.$eval(selector, node => ({ text: node.textContent.trim(), disabled: node.disabled, busy: node.getAttribute('aria-busy') }));
    };
    await poll(read, value => value.text === `Enable ${label}` && !value.disabled && value.busy !== 'true', `Installed ${label} opt-in is ready`, 20_000);
    const handles = await page.$$(selector);
    assert.equal(handles.length, 1, 'One genuine provider opt-in control is required');
    const handle = handles[0];
    try {
      await page.bringToFront();
      await handle.evaluate(node => {
        node.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
        if (node.__geldAccessReceipt !== undefined) throw Error('Provider opt-in observation already exists');
        const receipt = { clicks: 0, trusted: false };
        const listener = event => { receipt.clicks++;receipt.trusted = event.isTrusted; };
        node.__geldAccessReceipt = { receipt, listener };
        node.addEventListener('click', listener);
      });
      const point = await handle.evaluate(node => {
        if (!node.isConnected || node.disabled) return null;
        const box = node.getBoundingClientRect();const x = box.left + box.width / 2, y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y);
        return box.width > 0 && box.height > 0 && x > 0 && y > 0 && x < innerWidth && y < innerHeight && hit !== null && node.contains(hit) ? { x, y } : null;
      });
      assert.ok(point, 'The original provider opt-in button must have a visible unobscured click point');
      await page.mouse.click(point.x, point.y);
      const click = await handle.evaluate(node => node.__geldAccessReceipt?.receipt);
      assert.deepEqual(click, { clicks: 1, trusted: true }, 'Optional permissions require one genuine pointer click');
      const enabled = await poll(read, value => value.disabled && value.text === `${label} enabled` && value.busy !== 'true', `Installed ${label} grant and worker registration acknowledgement`, 20_000);
      result.push({ provider, pointerClick: true, trusted: true, acknowledged: enabled.disabled && enabled.text === `${label} enabled` });
    } finally {
      await handle.evaluate(node => {
        const observation = node.__geldAccessReceipt;
        if (observation) node.removeEventListener('click', observation.listener);
        delete node.__geldAccessReceipt;
      }).catch(() => {});
      await Promise.all(handles.map(entry => entry.dispose()));
    }
  }
  return result;
}
