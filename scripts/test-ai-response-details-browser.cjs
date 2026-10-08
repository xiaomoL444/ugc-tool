/* Mock-only response diagnostics UI regression; no provider calls. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
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
    const icon = page.locator('.message-error .response-details-trigger');
    await icon.waitFor({ timeout: 8000 });
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
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try { await check(browser, false); await check(browser, true); } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });