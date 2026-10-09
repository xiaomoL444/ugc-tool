/* Mock-only browser regression: no real AI, balance or asset-host calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8080';
const output = path.resolve(__dirname, '../../ugc-ai-search-file/verification/browser');

async function check(browser, mobile) {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  let modelCalls = 0;
  const errors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/api/ai-search/')) {
      const endpoint = url.pathname.split('/').at(-1);
      if (endpoint === 'config') return route.fulfill({ json: { configured: true, available: true, model: 'fixture-free', quota: { remaining: 10, limit: 10, resetAt: '2026-10-10T00:00:00+08:00' }, limits: { maxResults: 50, maxPreviousIds: 50, maxSearchLimit: 50, maxAssetIds: 10 }, retrieval: { available: true }, agent: { available: true } } });
      if (endpoint === 'catalog') return route.fulfill({ json: { catalogVersion: 'count-ui-fixture', counts: { sound: 0, effect: 0, bgm: 0, total: 0 }, coverage: { description: 0 }, mode: 'keyword', limits: { maxResults: 50, maxPreviousIds: 50, maxSearchLimit: 50, maxAssetIds: 10 } } });
      modelCalls++;
      return route.fulfill({ status: 500, json: { error: { code: 'UNEXPECTED_TEST_REQUEST' } } });
    }
    if (url.pathname.startsWith('/ugc-tool-data')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    if (url.origin !== new URL(base).origin) return route.abort();
    return route.continue();
  });
  try {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/AISearch');
    const select = page.locator('#search-result-limit');
    await select.waitFor();
    await page.waitForFunction(() => !document.querySelector('.result-limit-select .n-base-selection--disabled'));
    assert.match(await select.textContent(), /最多\s*10\s*项/);
    const menu = page.locator('.ai-result-limit-menu');
    async function open() { await select.click(); await menu.waitFor({ state: 'visible' }); }
    const input = page.locator('#search-result-limit-custom');
    const apply = page.locator('.result-limit-custom button[type="submit"]');
    await open();
    for (const count of [5, 10, 20, 50]) assert.equal(await menu.locator(`[data-result-limit-option="${count}"]`).count(), 1);
    await input.fill('25');
    await input.press('Enter');
    await menu.waitFor({ state: 'hidden' });
    assert.match(await select.textContent(), /最多\s*25\s*项/);
    await open();
    for (const invalid of ['0', '51', '2.5', 'ab', '']) {
      await input.fill(invalid);
      assert.equal(await apply.isDisabled(), true, `Invalid count ${invalid} cannot apply`);
    }
    await input.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    assert.match(await select.textContent(), /最多\s*25\s*项/);
    await open();
    await input.fill('40');
    await page.locator('.chat-panel-heading h2').click();
    await menu.waitFor({ state: 'hidden' });
    assert.match(await select.textContent(), /最多\s*25\s*项/, 'Closing without applying keeps the current value');
    await open();
    await input.fill('1');
    await apply.click();
    await menu.waitFor({ state: 'hidden' });
    assert.match(await select.textContent(), /最多\s*1\s*项/);
    await open();
    await menu.locator('[data-result-limit-option="50"]').click();
    await menu.waitFor({ state: 'hidden' });
    assert.match(await select.textContent(), /最多\s*50\s*项/);
    await open();
    await page.waitForFunction(() => {
      let node = document.querySelector('.ai-result-limit-menu');
      if (!node) return false;
      for (; node; node = node.parentElement) if (Number(getComputedStyle(node).opacity) < 0.99) return false;
      return true;
    });
    const box = await menu.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(box.x >= -1 && box.x + box.width <= viewport.width + 1, 'Dropdown fits the viewport');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The page does not gain horizontal overflow');
    await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, `result-limit-${mobile ? 'mobile' : 'desktop'}.png`) });
    assert.deepEqual(errors, []);
    assert.equal(modelCalls, 0);
    console.log(`PASS ${mobile ? 'mobile' : 'desktop'} result count: presets, custom Enter/apply, 1/50 bounds, invalid input, Escape, outside close, viewport and no model calls`);
  } finally { await context.close(); }
}
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try { await check(browser, false); await check(browser, true); }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
