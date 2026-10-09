/* Mock-only response diagnostics UI regression; no provider calls. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const outputDirectory = path.resolve(__dirname, '../../ugc-ai-search-file/verification/browser');
const base = process.argv[2] || 'http://127.0.0.1:8080';
const rawResponse = '模型实际返回的回答，未采用所需的 JSON 格式。\n<img data-raw-payload src=x onerror="window.rawResponseExecuted=true">\n' + Array.from({ length: 45 }, (_, index) => `原始回复第 ${index + 1} 行：这是可以滚动查看的模型正文，不会执行其中的 HTML。`).join('\n');

async function check(browser, mobile) {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  let chatCalls = 0;
  const errors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/api/ai-search/')) {
      const endpoint = url.pathname.split('/').at(-1);
      if (endpoint === 'config') return route.fulfill({ json: { configured: true, available: true, model: 'fixture-site', quota: { remaining: 9, limit: 10, resetAt: '2026-10-10T00:00:00+08:00' }, limits: { maxResults: 50 }, retrieval: { available: true }, agent: { available: true } } });
      if (endpoint === 'catalog') return route.fulfill({ json: { catalogVersion: 'raw-ui-fixture', counts: { sound: 1, effect: 0, bgm: 0, total: 1 }, coverage: { description: 0 }, mode: 'keyword' } });
      if (endpoint === 'chat') {
        chatCalls++;
        return route.fulfill({ status: 502, json: { error: { code: 'UPSTREAM_RESPONSE_INVALID', rawResponse } } });
      }
      return route.fulfill({ status: 500, json: { error: { code: 'UNEXPECTED_TEST_REQUEST' } } });
    }
    if (url.pathname.startsWith('/ugc-tool-data')) return route.fulfill({ status: 404, body: '{}' });
    if (url.origin !== new URL(base).origin) return route.abort();
    return route.continue();
  });
  try {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/AISearch');
    const input = page.locator('#asset-query');
    await input.fill('帮我找一些爆炸音效');
    await page.locator('.send-button').click();
    const icon = page.locator('.message-error .response-details-trigger[aria-label="查看模型原始回复"]');
    await icon.waitFor({ timeout: 8000 });
    const requestIcon = page.locator('.message-error .response-details-trigger[aria-label="查看请求诊断"]');
    await requestIcon.waitFor();
    if (mobile) await requestIcon.tap(); else await requestIcon.hover();
    const requestPopup = page.locator('.response-details-popup');
    await requestPopup.waitFor({ state: 'visible' });
    assert.ok((await requestPopup.locator('pre').innerText()).includes('HTTP 502'), 'A site HTTP failure preserves transport diagnostics alongside the model text');
    assert.ok((await requestPopup.locator('pre').innerText()).includes('请求站点 AI'));
    await page.keyboard.press('Escape');
    await requestPopup.waitFor({ state: 'hidden' });
    const popup = page.locator('.response-details-popup');
    if (mobile) await icon.tap(); else await icon.hover();
    await popup.waitFor({ state: 'visible' });
    assert.equal(await popup.locator('pre').textContent(), rawResponse);
    assert.equal(await popup.locator('img').count(), 0);
    assert.equal(await page.evaluate(() => window.rawResponseExecuted), undefined);
    const box = await popup.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= (mobile ? 390 : 1366), 'Popup fits viewport');
    assert.equal(await popup.locator('pre').evaluate(element => element.scrollHeight > element.clientHeight), true);
    await popup.locator('pre').evaluate(element => { element.scrollTop = 180; });
    assert.equal(await popup.isVisible(), true, 'Scrolling the raw response keeps it visible');
    if (mobile) {
      await page.locator('#ai-chat-title').tap();
    } else {
      await popup.hover();
      await page.mouse.move(5, 5);
    }
    await popup.waitFor({ state: 'hidden' });
    await icon.focus();
    if (mobile) await icon.press('Enter');
    await popup.waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await popup.waitFor({ state: 'hidden' });
    if (!mobile) {
      await icon.hover();
      await popup.waitFor({ state: 'visible' });
      const text = popup.locator('pre');
      await text.evaluate(element => { element.scrollTop = 0; });
      const textBox = await text.boundingBox();
      await page.mouse.move(textBox.x + 14, textBox.y + 14);
      await page.mouse.down();
      await page.mouse.move(textBox.x + 180, textBox.y + 14, { steps: 8 });
      await page.mouse.move(5, textBox.y + 76, { steps: 10 });
      await page.waitForTimeout(180);
      assert.equal(await popup.isVisible(), true, 'Dragging text outside keeps the popup open');
      await page.mouse.up();
      await page.waitForTimeout(180);
      assert.ok(await page.evaluate(() => window.getSelection()?.toString().length > 0), 'Actual text selection was created');
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForTimeout(180);
      assert.equal(await popup.isVisible(), true, 'Releasing outside preserves selected text and popup even after blur');
      await page.locator('#ai-chat-title').click();
      await popup.waitFor({ state: 'hidden' });
    }
    if (!mobile) {
      await page.locator('#search-model-mode').click();
      const dialog = page.locator('#ai-model-dialog');
      await dialog.waitFor({ state: 'visible' });
      await dialog.locator('[data-search-mode-option="custom"]').click();
      const field = dialog.locator('.config-field input').first();
      await field.fill('https://example.invalid/v1');
      const fieldBox = await field.boundingBox();
      await page.mouse.move(fieldBox.x + 20, fieldBox.y + fieldBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(fieldBox.x + 140, fieldBox.y + fieldBox.height / 2, { steps: 6 });
      await page.mouse.move(5, 5, { steps: 10 });
      await page.mouse.up();
      assert.equal(await dialog.isVisible(), true, 'Text drag from model input to backdrop does not close dialog');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await page.locator('#search-model-mode').click();
      await dialog.waitFor({ state: 'visible' });
      await page.mouse.click(5, 5);
      await dialog.waitFor({ state: 'hidden' });
    }
    await page.reload();
    await icon.waitFor({ timeout: 8000 });
    if (mobile) await icon.tap(); else await icon.hover();
    await popup.waitFor({ state: 'visible' });
    assert.equal(await popup.locator('pre').textContent(), rawResponse, 'Archive restores failed model text');
    assert.equal(chatCalls, 1, 'Opening diagnostics and reloading do not call chat again');
    assert.deepEqual(errors, []);
    console.log((mobile ? 'Mobile' : 'Desktop') + ' raw response hover/tap, scrolling, keyboard, inert HTML and archive passed.');
  } catch (error) { console.error('UI state:', errors, await context.pages()[0].evaluate(() => ({ thread: document.querySelector('.message-thread')?.innerText, notices: [...document.querySelectorAll('.inline-notice')].map(node => node.textContent), model: document.querySelector('#search-model-mode')?.textContent }))); throw error; } finally { await context.close(); }
}

async function checkCustomDiagnostics(browser) {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1366, height: 900 } });
  const apiKey = 'fixture-ui-key-only';
  await context.addInitScript(key => localStorage.setItem('ugc-tools.ai-search.model.v1', JSON.stringify({ baseUrl: 'https://api.openai.com', model: 'gpt-4.1-nano', apiKey: key, rememberKey: true })), apiKey);
  let modelCalls = 0;
  const errors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/api/ai-search/')) {
      const endpoint = url.pathname.split('/').at(-1);
      if (endpoint === 'config') return route.fulfill({ json: { configured: false, available: false, agent: { available: true }, retrieval: { available: true } } });
      if (endpoint === 'catalog') return route.fulfill({ json: { catalogVersion: 'request-ui-fixture', counts: { total: 1 }, coverage: { description: 1 }, mode: 'keyword' } });
      throw new Error('No site chat or retrieval call expected before the model failure: ' + endpoint);
    }
    if (url.hostname === 'api.openai.com') {
      assert.equal(url.pathname, '/v1/chat/completions');
      modelCalls++;
      if (modelCalls === 1) return route.fulfill({ status: 403, headers: { 'x-request-id': 'fixture-permission-request', 'access-control-expose-headers': 'x-request-id' }, json: { error: { code: 'permission_denied', message: 'Account cannot access this model. ' + apiKey + ' <img data-diagnostic-payload src=x onerror="window.diagnosticExecuted=true">', param: 'model' } } });
      if (modelCalls === 2) return route.fulfill({ status: 429, json: { error: { code: 'rate_limit_exceeded', message: 'Please reduce request frequency.' } } });
      if (modelCalls === 3) return route.abort('failed');
      throw new Error('Diagnostics must never automatically retry a paid request.');
    }
    if (url.pathname.startsWith('/ugc-tool-data')) {
      if (url.pathname.endsWith('/AISearch/SystemPrompt.md')) return route.fulfill({ contentType: 'text/markdown', body: '# Test prompt\nSearch the supplied tools, then return JSON for RESULT_LIMIT assets.' });
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
    await dialog.locator('.primary-button').click();
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#search-model-mode')?.getAttribute('data-search-mode') === 'custom');
    const expectations = ['HTTP 403', 'HTTP 429', 'cannot determine the exact network cause'];
    for (let index = 0; index < expectations.length; index++) {
      await page.locator('#asset-query').fill('Find a rumble, attempt ' + (index + 1));
      await page.locator('.send-button').click();
      const errorReply = page.locator('.message-error').nth(index);
      await errorReply.waitFor({ timeout: 8000 });
      const main = await errorReply.locator('.message-text>span').first().innerText();
      assert.ok(main.includes(expectations[index]), 'Main error includes its known HTTP status or honest no-response explanation: ' + main);
      assert.ok(main.includes('Calling your model'), 'The failing phase is visible in the main error');
      assert.ok(!main.includes(apiKey), 'Known model credentials are redacted');
      if (index === 0) assert.ok(main.includes('permission_denied') && main.includes('Account cannot access this model.'), 'Provider reason appears in the main error');
      if (index === 1) assert.ok(!main.includes('Your daily Site AI allowance is used up'), 'BYOK rate limits are separate from site allowance');
      assert.equal(await errorReply.locator('[aria-label="View the raw model response"]').count(), 0, 'HTTP/network envelopes do not become model text');
      const icon = errorReply.locator('[aria-label="View request diagnostics"]');
      await icon.hover();
      const popup = page.locator('.response-details-popup');
      await popup.waitFor({ state: 'visible' });
      const detail = await popup.locator('pre').innerText();
      assert.ok(detail.includes('Calling your model') && detail.includes('Model request round: 1'));
      assert.ok(detail.includes('https://api.openai.com/v1/chat/completions'));
      assert.ok(!detail.includes(apiKey));
      if (index === 0) {
        assert.ok(detail.includes('Request ID: fixture-permission-request') && detail.includes('Related parameter: model'), detail);
        assert.equal(await popup.locator('img').count(), 0);
        assert.equal(await page.evaluate(() => window.diagnosticExecuted), undefined);
        await page.screenshot({ path: path.join(outputDirectory, 'ai-search-request-diagnostics-en.png'), fullPage: true });
      }
      if (index === 2) assert.ok(detail.includes('Browser error: TypeError') && detail.includes('Possible causes include CORS'), 'Transport failures remain uncertain rather than asserting CORS');
      await page.locator('#ai-chat-title').click();
      await popup.waitFor({ state: 'hidden' });
    }
    await page.reload();
    const restored = page.locator('.message-error').first().locator('[aria-label="View request diagnostics"]');
    await restored.waitFor({ timeout: 8000 });
    await restored.hover();
    const restoredText = await page.locator('.response-details-popup pre').innerText();
    assert.ok(restoredText.includes('HTTP 403') && restoredText.includes('fixture-permission-request') && !restoredText.includes(apiKey), 'Archives restore only sanitized request diagnostics');
    assert.equal(modelCalls, 3, 'Opening and reopening diagnostics makes no paid retry');
    assert.deepEqual(errors, []);
    console.log('English BYOK 403/429/network errors: known causes and phases, safe diagnostic text, request IDs, archive and no paid retry passed.');
  } finally { await context.close(); }
}


async function checkResponsesConfig(browser) {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1366, height: 900 } });
  const apiKey = 'fixture-responses-key-only';
  await context.addInitScript(key => localStorage.setItem('ugc-tools.ai-search.model.v1', JSON.stringify({ baseUrl: 'https://api.openai.com/v1/responses', model: 'gpt-6-luna', apiKey: key, rememberKey: true })), apiKey);
  let modelCalls = 0;
  const errors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/api/ai-search/')) {
      const endpoint = url.pathname.split('/').at(-1);
      if (endpoint === 'config') return route.fulfill({ json: { configured: false, available: false, agent: { available: true }, retrieval: { available: true } } });
      if (endpoint === 'catalog') return route.fulfill({ json: { catalogVersion: 'responses-ui-fixture', counts: { total: 1 }, coverage: { description: 1 }, mode: 'keyword' } });
      throw new Error('A clarification must not call asset tools or site chat: ' + endpoint);
    }
    if (url.hostname === 'api.openai.com') {
      modelCalls++;
      assert.equal(route.request().method(), 'POST');
      assert.equal(url.pathname, '/v1/chat/completions', 'The known official Responses URL is normalized to this page’s Chat Completions API');
      const request = route.request().postDataJSON();
      assert.equal(request.model, 'gpt-6-luna', 'The configured model stays unchanged');
      assert.equal(request.reasoning_effort, 'none', 'The official GPT-6 tool flow uses non-reasoning mode');
      assert.equal(route.request().headers().authorization, 'Bearer ' + apiKey, 'The configured key is sent only to its provider');
      return route.fulfill({ json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answer: 'What feeling should the sound convey?', matches: [], clarification: true }) } }] } });
    }
    if (url.pathname.startsWith('/ugc-tool-data')) {
      if (url.pathname.endsWith('/AISearch/SystemPrompt.md')) return route.fulfill({ contentType: 'text/markdown', body: '# Test prompt\nAsk a clarification when the request is ambiguous. Return JSON for RESULT_LIMIT assets.' });
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
    assert.equal(await dialog.locator('.config-field input').nth(0).inputValue(), 'https://api.openai.com/v1/responses');
    assert.ok((await dialog.locator('.config-field small').first().innerText()).includes('Chat Completions'));
    await dialog.locator('.primary-button').click();
    await dialog.waitFor({ state: 'hidden' });
    await page.locator('#asset-query').fill('Find me a sound.');
    await page.locator('.send-button').click();
    const reply = page.locator('.message-assistant .message-text>span').first();
    await page.waitForFunction(() => document.querySelector('.message-assistant .message-text>span')?.textContent === 'What feeling should the sound convey?');
    assert.equal(await reply.innerText(), 'What feeling should the sound convey?');
    assert.equal(await page.locator('.message-error,.resource-card').count(), 0, 'Valid clarification completes without fabricated assets or errors');
    assert.equal(modelCalls, 1, 'Normalization does not make an extra paid retry');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ugc-tools.ai-search.model.v1')));
    assert.equal(saved.model, 'gpt-6-luna');
    assert.equal(saved.apiKey, apiKey);
    assert.deepEqual(errors, []);
    console.log('Official Responses configuration normalizes to Chat Completions with unchanged GPT-6 model/key, reasoning_effort none, one mock request, and valid clarification.');
  } finally { await context.close(); }
}


async function checkPromptDiagnostics(browser) {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1366, height: 1000 } });
  const apiKey = 'fixture-prompt-key-only';
  await context.addInitScript(key => localStorage.setItem('ugc-tools.ai-search.model.v1', JSON.stringify({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-luna', apiKey: key, rememberKey: true })), apiKey);
  let promptCalls = 0, modelCalls = 0, oversized = true;
  const errors = [];
  const promptWithBytes = size => {
    const prefix = '# Public prompt\n';
    let source = prefix + '雷'.repeat(Math.floor((size - Buffer.byteLength(prefix)) / 3));
    source += 'x'.repeat(size - Buffer.byteLength(source));
    assert.equal(Buffer.byteLength(source), size); return source;
  };
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/api/ai-search/')) {
      const endpoint = url.pathname.split('/').at(-1);
      if (endpoint === 'config') return route.fulfill({ json: { configured: false, available: false, agent: { available: true }, retrieval: { available: true } } });
      if (endpoint === 'catalog') return route.fulfill({ json: { catalogVersion: 'prompt-size-fixture', counts: { total: 1 }, coverage: { description: 1 }, mode: 'keyword' } });
      throw new Error('The prompt test must not call site chat or asset tools: ' + endpoint);
    }
    if (url.hostname === 'api.openai.com') {
      modelCalls++;
      assert.equal(route.request().method(), 'POST');
      assert.equal(url.pathname, '/v1/chat/completions');
      assert.equal(route.request().headers().authorization, 'Bearer ' + apiKey);
      const payload = route.request().postDataJSON();
      assert.ok(payload.messages.some(message => message.role === 'system' && message.content.includes(promptWithBytes(16783))), 'The accepted complete public prompt reaches the model');
      return route.fulfill({ json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answer: 'The prompt loaded. What kind of sound do you need?', matches: [], clarification: true }) } }] } });
    }
    if (url.pathname.startsWith('/ugc-tool-data')) {
      if (url.pathname.endsWith('/AISearch/SystemPrompt.md')) {
        promptCalls++;
        assert.equal(route.request().headers().authorization, undefined, 'No model key is sent to the public prompt URL');
        return route.fulfill({ headers: { 'content-type': oversized ? 'text/markdown' : '' }, body: promptWithBytes(oversized ? 32769 : 16783) });
      }
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
    await dialog.locator('.primary-button').click();
    await dialog.waitFor({ state: 'hidden' });
    await page.locator('#asset-query').fill('Find a sound with this prompt.');
    await page.locator('.send-button').click();
    const errorReply = page.locator('.message-error').last();
    await errorReply.waitFor({ timeout: 8000 });
    const main = await errorReply.locator('.message-text>span').first().innerText();
    assert.ok(main.includes('The prompt file exceeds the read limit.') && main.includes('HTTP 200') && main.includes('32769') && main.includes('32768'), main);
    assert.equal(modelCalls, 0, 'An oversized prompt is rejected before any model call');
    await errorReply.locator('[aria-label="View request diagnostics"]').hover();
    const popup = page.locator('.response-details-popup');
    await popup.waitFor({ state: 'visible' });
    const detail = await popup.locator('pre').innerText();
    assert.ok(detail.includes('PROMPT_TOO_LARGE') && detail.includes('Response size (bytes): 32769') && detail.includes('Read limit (bytes): 32768') && detail.includes('Response content type: text/markdown'), detail);
    assert.ok(detail.includes('before calling the model') && !detail.includes('Check API compatibility'));
    assert.ok(!detail.includes(apiKey));
    await page.screenshot({ path: path.join(outputDirectory, 'ai-search-prompt-limit-en.png'), fullPage: true });
    await page.locator('#ai-chat-title').click(); await popup.waitFor({ state: 'hidden' });
    oversized = false;
    await page.locator('#asset-query').fill('Try the corrected public prompt.');
    await page.locator('.send-button').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.message-assistant .message-text>span')].at(-1)?.textContent === 'The prompt loaded. What kind of sound do you need?');
    assert.equal(modelCalls, 1, 'A valid 16783-byte UTF-8 prompt below the 32768-byte limit makes one explicit model call');
    assert.equal(promptCalls, 2, 'A failed prompt is not cached as a valid source');
    assert.equal(await page.locator('.message-error').count(), 1);
    assert.deepEqual(errors, []);
    console.log('Public prompt diagnostics: HTTP200 oversized 32769/32768 exact reason, no model call on failure, valid 16783-byte UTF-8 with no content type, prompt-specific hints, and one explicit mock model call passed.');
  } finally { await context.close(); }
}

(async () => {
  await fs.mkdir(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.AI_SEARCH_BROWSER_CHANNEL || 'msedge', headless: true });
  try { await check(browser, false); await check(browser, true); await checkCustomDiagnostics(browser); await checkResponsesConfig(browser); await checkPromptDiagnostics(browser); } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
