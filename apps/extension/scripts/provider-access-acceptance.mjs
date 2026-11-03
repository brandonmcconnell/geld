import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

export function optionalProvidersForCases(cases) {
  const providers = new Set();
  for (const name of cases) {
    if (name.startsWith('gitlab-') || name === 'cross-provider-settings' || name === 'bitbucket-commit-counts') providers.add('gitlab');
    if (name.startsWith('bitbucket-')) providers.add('bitbucket');
  }
  return ['gitlab', 'bitbucket'].filter(provider => providers.has(provider));
}

/** Exercise the same user-gesture opt-in as a new install, without granting permissions through automation APIs. */
export async function enableOptionalProviders(page, providers, { poll, readState, confirmPermission, progress = [] }) {
  const originalUrl = page.url();
  assert.equal(new URL(originalUrl).protocol, 'chrome-extension:');
  const result = progress;
  for (const provider of providers) {
    assert.ok(provider === 'gitlab' || provider === 'bitbucket');
    const label = provider === 'gitlab' ? 'GitLab' : 'Bitbucket';
    const record = { provider };
    result.push(record);
    let beforeOrigins;
    if (readState) {
      try { const before = await readState();beforeOrigins = [...before.permissions.origins];record.before = accessState(before, provider); }
      catch (error) { record.pendingPhase = 'state_unavailable';throw error; }
    }
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
      record.pointerClick = true;record.trusted = true;
      if (confirmPermission) record.confirmation = await confirmPermission(provider);
      const enabled = await poll(read, value => value.disabled && value.text === `${label} enabled` && value.busy !== 'true', `Installed ${label} grant and worker registration acknowledgement`, 20_000);
      record.acknowledged = enabled.disabled && enabled.text === `${label} enabled`;
      if (readState) {
        const after = await readState();
        record.after = accessState(after, provider);
        const wanted = provider === 'gitlab' ? ['https://gitlab.com/*'] : ['https://bitbucket.org/*', 'https://api.bitbucket.org/*'];
        record.grantScopeValid = isDeepStrictEqual([...new Set(after.permissions.origins)].sort(), [...new Set([...beforeOrigins, ...wanted])].sort());
        assert.ok(record.grantScopeValid, 'Provider permission grant changed unexpected origin scope');
      }
    } catch (error) {
      if (readState) {
        try { record.after = accessState(await readState(), provider);record.pendingPhase = record.grantScopeValid === false ? 'unexpected_permission_scope' : record.after.granted ? 'worker_registration' : 'permission_request'; }
        catch { record.pendingPhase = 'state_unavailable'; }
      }
      throw error;
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


function accessState(snapshot, provider) {
  const origins = provider === 'gitlab' ? ['https://gitlab.com/*'] : ['https://bitbucket.org/*', 'https://api.bitbucket.org/*'];
  const ids = provider === 'gitlab' ? ['geld-gitlab'] : ['geld-bitbucket', 'geld-bitbucket-main'];
  return { granted: origins.every(origin => snapshot.permissions.origins.includes(origin)),
    origins: origins.filter(origin => snapshot.permissions.origins.includes(origin)),
    scripts: ids.map(id => {
      const matches = snapshot.scripts.filter(script => script.id === id);
      const script = matches[0];
      const main = id === 'geld-bitbucket-main';
      const file = main ? 'bitbucket-whitespace' : provider;
      return { id, count: Math.min(matches.length, 100), documentStart: script?.runAt === 'document_start',
        expectedWorld: (script?.world ?? 'ISOLATED') === (main ? 'MAIN' : 'ISOLATED'),
        expectedFile: isDeepStrictEqual(script?.js, [`content-scripts/${file}.js`]),
        expectedHosts: isDeepStrictEqual(script?.matches, [origins[0]]) };
    }) };
}

/** Browser-owned state read from the already verified extension page, independent of worker DevTools lifetime. */
export async function readOptionsProviderAccess(page, extensionId) {
  assert.match(extensionId, /^[a-p]{32}$/);
  const optionsUrl = page.url();
  const url = new URL(optionsUrl);
  assert.ok(url.protocol === 'chrome-extension:' && url.hostname === extensionId, 'Provider access requires the installed extension page');
  let timer;
  try {
    return await Promise.race([
      page.evaluate(async (expectedId, expectedUrl) => {
        const sameContext = () => chrome.runtime.id === expectedId && location.href === expectedUrl;
        if (!sameContext()) throw new Error('PROVIDER_ACCESS_CONTEXT_CHANGED');
        const [permissions, scripts] = await Promise.all([chrome.permissions.getAll(), chrome.scripting.getRegisteredContentScripts()]);
        if (!sameContext()) throw new Error('PROVIDER_ACCESS_CONTEXT_CHANGED');
        return { permissions, scripts };
      }, extensionId, optionsUrl),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PROVIDER_ACCESS_STATE_TIMEOUT')), 3000); }),
    ]);
  } finally { clearTimeout(timer); }
}

export function assertOptionalProviderRegistrations(snapshot) {
  const origins = ['https://gitlab.com/*', 'https://bitbucket.org/*', 'https://api.bitbucket.org/*'];
  for (const origin of origins) assert.ok(snapshot.permissions.origins.includes(origin), 'Chrome must record each granted provider origin');
  const expected = [
    { id: 'geld-gitlab', host: 'https://gitlab.com/*', file: 'gitlab', main: false },
    { id: 'geld-bitbucket', host: 'https://bitbucket.org/*', file: 'bitbucket', main: false },
    { id: 'geld-bitbucket-main', host: 'https://bitbucket.org/*', file: 'bitbucket-whitespace', main: true },
  ];
  for (const entry of expected) {
    const matches = snapshot.scripts.filter(script => script.id === entry.id);
    assert.equal(matches.length, 1, 'Each provider needs exactly one worker-registered script');
    const script = matches[0];
    assert.ok(isDeepStrictEqual(script.matches, [entry.host]), 'Registered script must match only its provider');
    assert.ok(isDeepStrictEqual(script.js, [`content-scripts/${entry.file}.js`]), 'Registered script must use its bundled entrypoint');
    assert.equal(script.runAt, 'document_start');
    assert.equal(script.persistAcrossSessions, true);
    assert.equal(script.world ?? 'ISOLATED', entry.main ? 'MAIN' : 'ISOLATED');
    if (!entry.main) assert.ok(isDeepStrictEqual(script.css, [`content-scripts/${entry.file}.css`]), 'Registered script must use its provider styles');
  }
  return { origins, scripts: expected.map(entry => ({ id: entry.id, world: entry.main ? 'MAIN' : 'ISOLATED', runAt: 'document_start' })) };
}

/** Only the original options controls can grant; browser-global registrations are observed read-only afterward. */
export async function verifyOptionalProviderRegistration(page, { extensionId, poll, confirmPermission, progress = {} }) {
  progress.clicks = [];
  const clicks = await enableOptionalProviders(page, ['gitlab', 'bitbucket'], { poll, confirmPermission, readState: () => readOptionsProviderAccess(page, extensionId), progress: progress.clicks });
  const snapshot = await readOptionsProviderAccess(page, extensionId);
  const registration = assertOptionalProviderRegistrations(snapshot);
  return { status: 'passed', clicks, ...registration, scope: 'Installed options and browser-owned registrations only. No public provider page is opened. External DNS is blocked for this focus.' };
}
