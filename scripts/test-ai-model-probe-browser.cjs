/* Manual model probe UI regression. All providers, Worker and OSS are mocked. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8080';
const outputDirectory = path.resolve(__dirname, '../../ugc-ai-search-file/verification/browser');
const key = 'fixture-probe-key-only';
const original = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-luna', apiKey: key, rememberKey: true, protocol: 'auto' };

(async () => {
  await fs.mkdir(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.AI_SEARCH_BROWSER_CHANNEL || 'msedge', headless: true });
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1366, height: 1100 } });
  let calls = 0;
  let outcome = 'success';
  let workerPosts = 0;
  const errors = [];
  await context.addInitScript(config => {
    localStorage.setItem('ugc-tools.ai-search.model.v1', JSON.stringify(config));
    const realFetch = window.fetch.bind(window);
    window.__slowProbes = [];
    // This deliberately ignores AbortSignal completion so a stale successful
    // response can arrive after an edit or close. It never opens a connection.
    window.fetch = (url, input) => {
      if (String(url).startsWith('https://slow.fixture.invalid/')) {
        const item = { aborted: false };
        input.signal.addEventListener('abort', () => { item.aborted = true; });
        const pending = new Promise(resolve => { item.resolve = () => resolve(new Response(JSON.stringify({ model: 'stale-response-model', choices: [{ finish_reason: 'stop', message: { content: 'OK' } }] }), { headers: { 'Content-Type': 'application/json' } })); });
        window.__slowProbes.push(item);
        return pending;
      }
      return realFetch(url, input);
    };
  }, original);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/api/ai-search/')) {
      if (route.request().method() !== 'GET') workerPosts++;
      const endpoint = url.pathname.split('/').at(-1);
      if (endpoint === 'config') return route.fulfill({ json: { configured: false, available: false, agent: { available: true }, retrieval: { available: true, catalogVersion: 'probe-ui', counts: { total: 1 }, coverage: { description: 1 }, mode: 'keyword' } } });
      if (endpoint === 'catalog') return route.fulfill({ json: { catalogVersion: 'probe-ui', counts: { total: 1 }, coverage: { description: 1 }, mode: 'keyword' } });
      throw new Error('Probe must not call the Worker: ' + endpoint);
    }
    if (url.hostname === 'api.openai.com' || url.hostname === 'api.anthropic.com') {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': '*' } });
      calls++;
      const request = route.request().postDataJSON();
      assert.equal(route.request().method(), 'POST');
      assert.equal(request.stream, false);
      assert.equal(request.messages.length, 1, 'The probe sends no saved chat context');
      assert.equal(request.tools, undefined, 'Basic call verification does not claim tool compatibility');
      if (url.hostname === 'api.openai.com') {
        assert.equal(url.pathname, '/v1/chat/completions');
        assert.equal(request.max_completion_tokens, 128);
        assert.equal(request.reasoning_effort, 'none');
        assert.equal(route.request().headers().authorization, 'Bearer ' + key);
      } else {
        assert.equal(url.pathname, '/v1/messages');
        assert.equal(request.max_tokens, 128);
        assert.equal(route.request().headers()['x-api-key'], key);
        assert.equal(route.request().headers()['anthropic-dangerous-direct-browser-access'], 'true');
        assert.equal(route.request().headers().authorization, undefined);
      }
      if (outcome === 'malformed') return route.fulfill({ json: { choices: [] } });
      if (outcome === 'unauthorized') return route.fulfill({ status: 401, headers: { 'x-request-id': 'probe-auth-id', 'access-control-expose-headers': 'x-request-id' }, json: { error: { code: 'invalid_api_key', message: 'The provided key was rejected. ' + key } } });
      if (url.hostname === 'api.anthropic.com') return route.fulfill({ json: { type: 'message', role: 'assistant', model: 'claude-fixture-returned', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' } });
      return route.fulfill({ json: { model: 'gpt-6-luna-returned-id', choices: [{ finish_reason: 'stop', message: { content: 'OK' } }] } });
    }
    if (url.pathname.startsWith('/ugc-tool-data')) {
      assert.ok(!url.pathname.endsWith('/AISearch/SystemPrompt.md'), 'The probe does not load the search prompt');
      return route.fulfill({ status: 404, body: '{}' });
    }
    if (url.origin !== new URL(base).origin) return route.abort();
    return route.continue();
  });
  try {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/AISearch');
    await page.locator('#search-model-mode').click();
    const dialog = page.locator('#ai-model-dialog');
    await dialog.locator('[data-search-mode-option="custom"]').click();
    const url = dialog.locator('.config-field input').nth(0);
    const model = dialog.locator('.config-field input').nth(1);
    const apiKey = dialog.locator('.secret-field input');
    const protocol = dialog.locator('#ai-model-protocol');
    const probe = dialog.locator('.model-probe-button');
    const success = dialog.locator('.model-probe-success');
    const failure = dialog.locator('.model-probe-error');
    assert.equal(await protocol.inputValue(), 'auto');
    assert.equal(calls, 0, 'Opening and selecting a mode makes no model call');
    await probe.click();
    await success.waitFor({ timeout: 8000 });
    assert.ok((await success.innerText()).includes('gpt-6-luna') && (await success.innerText()).includes('gpt-6-luna-returned-id'));
    assert.ok((await success.innerText()).includes('Tool calls and asset search must be verified through an actual search'));
    assert.equal(calls, 1);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('ugc-tools.ai-search.model.v1'))), original, 'Testing does not save the draft');
    assert.equal(await page.locator('.chat-message').count(), 0, 'Probe results are not chat messages');
    await page.screenshot({ path: path.join(outputDirectory, 'ai-search-model-probe-openai.png'), fullPage: true });

    await model.fill('gpt-6-luna-edited');
    assert.equal(await success.count(), 0, 'Editing the model clears a previous test');
    await model.fill('gpt-6-luna');
    await probe.click(); await success.waitFor();
    await apiKey.fill(key + '-edited');
    assert.equal(await success.count(), 0, 'Editing the key clears a previous test');
    await apiKey.fill(key);
    await probe.click(); await success.waitFor();
    await protocol.selectOption('openai');
    assert.equal(await success.count(), 0, 'Changing protocol clears a previous test');
    const beforeNative = calls;
    await protocol.selectOption('anthropic');
    await url.fill('https://api.anthropic.com/v1');
    await model.fill('claude-fixture-requested');
    assert.equal(calls, beforeNative, 'Editing URL, model and protocol never auto-tests');
    await probe.click();
    await success.waitFor();
    assert.ok((await success.innerText()).includes('claude-fixture-requested') && (await success.innerText()).includes('claude-fixture-returned'));
    assert.ok((await success.innerText()).includes('Official Claude'));
    await page.screenshot({ path: path.join(outputDirectory, 'ai-search-model-probe-claude.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.evaluate(element => { element.scrollTop = 0; });
    const phoneBox = await dialog.boundingBox();
    assert.ok(phoneBox.x >= 0 && phoneBox.x + phoneBox.width <= 390 && phoneBox.height <= 820, 'Settings fit the phone viewport');
    assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth), false, 'The protocol form and model IDs cause no horizontal overflow');
    assert.ok(await dialog.evaluate(element => element.scrollHeight > element.clientHeight), 'The long settings form scrolls on phones');
    await page.screenshot({ path: path.join(outputDirectory, 'ai-search-model-probe-claude-mobile-form.png'), fullPage: true });
    const windowScroll = await page.evaluate(() => window.scrollY);
    await probe.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    assert.equal(await dialog.locator('.primary-button').evaluate(element => document.activeElement === element), true, 'Keyboard navigation reaches Save after Test without sending another request');
    assert.ok(await dialog.evaluate(element => element.scrollTop > 0), 'Keyboard navigation scrolls the long dialog to its controls');
    assert.equal(await page.evaluate(() => window.scrollY), windowScroll, 'The modal scrolls without shifting the underlying page');
    await success.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outputDirectory, 'ai-search-model-probe-claude-mobile-result.png'), fullPage: true });
    await page.setViewportSize({ width: 1366, height: 1100 });
    await dialog.locator('.primary-button').click();
    await dialog.waitFor({ state: 'hidden' });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ugc-tools.ai-search.model.v1')));
    assert.equal(saved.protocol, 'anthropic');
    assert.equal(saved.model, 'claude-fixture-requested');
    assert.equal(saved.returnedModel, undefined);
    await page.locator('#search-model-mode').click();
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await protocol.inputValue(), 'anthropic', 'Saved protocol restores when reopening');
    assert.equal(await success.count(), 0, 'Verification state is transient and resets on close');
    outcome = 'malformed';
    await probe.click(); await failure.waitFor();
    assert.equal(await success.count(), 0, 'Malformed HTTP 200 envelopes are not marked callable');
    assert.ok((await failure.innerText()).includes('HTTP 200'));
    outcome = 'unauthorized';
    await probe.click(); await failure.waitFor();
    await page.waitForFunction(() => document.querySelector('.model-probe-error')?.textContent.includes('HTTP 401'));
    assert.ok((await failure.innerText()).includes('invalid_api_key') && !(await failure.innerText()).includes(key));
    const details = failure.locator('[aria-label="View request diagnostics"]');
    await details.hover();
    const popup = dialog.locator('.response-details-popup');
    await popup.waitFor({ state: 'visible' });
    assert.ok((await popup.innerText()).includes('HTTP 401') && !(await popup.innerText()).includes(key));
    assert.equal(await popup.evaluate(element => element.closest('dialog')?.open), true, 'Diagnostic popup remains in the native modal top layer');
    const triggerBox = await details.boundingBox(), popupBox = await popup.boundingBox();
    assert.ok(popupBox.y + popupBox.height <= triggerBox.y || popupBox.y >= triggerBox.y + triggerBox.height, 'Diagnostic popup must not cover its trigger');
    await page.mouse.move(popupBox.x + 40, popupBox.y + 30);
    assert.deepEqual(await popup.boundingBox(), popupBox, 'Entering the diagnostic panel does not reposition it');
    await popup.locator('pre').focus();
    assert.deepEqual(await popup.boundingBox(), popupBox, 'Focusing diagnostic text does not reposition it');
    await details.focus(); await page.keyboard.press('Enter');
    assert.equal(await details.getAttribute('aria-expanded'), 'true', 'Keyboard opens and pins request diagnostics');
    await page.screenshot({ path: path.join(outputDirectory, 'ai-search-model-probe-error.png'), fullPage: true });
    await page.keyboard.press('Escape');
    if (!await dialog.isVisible()) { await page.locator('#search-model-mode').click(); await dialog.waitFor({ state: 'visible' }); }

    await protocol.selectOption('openai');
    await url.fill('https://slow.fixture.invalid/v1');
    await model.fill('before-edit');
    await probe.click();
    await page.waitForFunction(() => window.__slowProbes.length === 1);
    assert.ok(await dialog.locator('.model-probe-cancel').isVisible());
    await model.fill('after-edit');
    assert.equal(await dialog.locator('.model-probe-cancel').count(), 0);
    await page.evaluate(() => window.__slowProbes[0].resolve());
    await page.waitForTimeout(150);
    assert.equal(await success.count(), 0, 'Late successful response after an edit is ignored');
    assert.equal(await failure.count(), 0);
    assert.equal(await page.evaluate(() => window.__slowProbes[0].aborted), true, 'An edit aborts the in-flight test');
    await probe.click();
    await page.waitForFunction(() => window.__slowProbes.length === 2);
    await dialog.locator('.dialog-heading .icon-button').click();
    await page.evaluate(() => window.__slowProbes[1].resolve());
    await page.waitForTimeout(150);
    await page.locator('#search-model-mode').click();
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await success.count(), 0, 'A late response after closing does not restore verification state');
    assert.equal(await failure.count(), 0);
    assert.equal(await page.evaluate(() => window.__slowProbes[1].aborted), true);
    await dialog.locator('[data-search-mode-option="basic"]').click();
    assert.equal(await probe.count(), 0, 'Basic search has no model probe');
    await dialog.locator('[data-search-mode-option="free"]').click();
    assert.equal(await probe.count(), 0, 'Site AI has no user-model probe');
    assert.equal(workerPosts, 0);
    assert.equal(calls, 6, 'Only the six explicit provider test clicks make provider requests');
    assert.deepEqual(errors, []);
    console.log('PASS manual probe UI: OpenAI/Claude requested and returned IDs, only explicit calls, no auto-save/Worker/history, protocol save/restore, malformed/401 diagnostics, safe native-dialog hover/keyboard popup, phone fit/dialog scrolling, edit/close abort and stale result cleanup.');
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
