/* NODE_PATH=<bundled playwright modules> node scripts/test-ai-pagination-stability-browser.cjs [base URL]
 * Uses archived fixtures and local preview heights; every model/search request is intercepted.
 * An already-running development server is required. This script never starts one.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.argv.slice(2).find(argument => !argument.startsWith('--')) || 'http://127.0.0.1:8080';
const baseOrigin = new URL(base).origin;
const cardCount = 12;
const cards = Array.from({ length: cardCount }, (_, index) => {
  const kind = ['sound', 'effect', 'bgm'][index % 3];
  const id = String(71001 + index);
  return {
    resourceId: kind + ':' + id, kind, id,
    title: index % 2 ? '用于分页稳定性验证的长标题和不同高度资源卡片_' + id : '短标题_' + id,
    description: '离线历史资源，测试真实分页和聊天滚动。',
    keywords: [], suggestedUses: [], duration: 4,
    audioMatch: index % 4 === 1, matchType: index % 3 === 1 ? 'suggestion' : 'feature',
    href: '/ignored-history-url',
  };
});
const history = [{
  id: 'pagination-stability', title: '分页稳定性验证', updatedAt: 2, contextStart: 0,
  messages: [
    { id: 'stability-intro', role: 'user', status: 'complete', content: ('前面的历史聊天。\n').repeat(22) },
    { id: 'stability-old', role: 'assistant', status: 'complete', mode: 'basic', source: 'basic', content: '较早回复中的资源结果。', cards },
    { id: 'stability-following', role: 'user', status: 'complete', content: ('后面的聊天内容应保留。\n').repeat(12) },
    { id: 'stability-last', role: 'assistant', status: 'complete', mode: 'basic', source: 'basic', content: '最后回复中的资源结果。', cards },
  ],
}];

async function install(context, state) {
  await context.addInitScript(seed => {
    localStorage.setItem('ugc-tools.ai-search.history.v1', JSON.stringify(seed));
  }, history);
  // One catch-all interceptor prevents accidental requests to a model or an external asset.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/api/ai-search/')) {
      state.apiRequests++;
      const endpoint = url.pathname.split('/').at(-1);
      if (endpoint === 'config') return route.fulfill({ json: { configured: false, available: false, retrieval: { available: true } } });
      if (endpoint === 'catalog') return route.fulfill({ json: { catalogVersion: 'pagination-stability-v1', counts: { total: cardCount }, mode: 'keyword', coverage: { description: 1 } } });
      if (endpoint === 'assets') return route.fulfill({ json: { catalogVersion: 'pagination-stability-v1', items: cards } });
      state.modelOrSearchRequests++;
      return route.fulfill({ status: 500, body: 'Pagination must not request a search or model.' });
    }
    if (url.pathname.includes('/ugc-tool-data/')) {
      if (url.pathname.endsWith('/EffectPlayer/data.json')) return route.fulfill({ json: { effectData: {}, TagData: {} } });
      if (url.pathname.endsWith('/BgmPlayer/data.json')) return route.fulfill({ json: { musicData: [], category: [] } });
      if (url.pathname.includes('/i18n/')) return route.fulfill({ json: {} });
      return route.fulfill({ status: 404, body: 'Offline fixture: preview media is represented by controlled heights.' });
    }
    if (url.origin === baseOrigin) return route.continue();
    return route.fulfill({ status: 404, body: 'External requests are disabled by the pagination fixture.' });
  });
}

function reply(page, id) {
  return page.locator('#resource-results-' + id).locator('..');
}
async function settle(page) {
  await page.evaluate(() => new Promise(resolve => {
    let frames = 0;
    const tick = () => ++frames === 8 ? resolve() : requestAnimationFrame(tick);
    requestAnimationFrame(tick);
  }));
}
async function geometry(results) {
  return results.evaluate(element => {
    const viewport = element.closest('.message-viewport');
    const viewportTop = viewport.getBoundingClientRect().top;
    const toolbar = element.querySelector('.results-toolbar');
    const grid = element.querySelector('.result-grid');
    const next = element.querySelector('.results-next');
    const previous = element.querySelector('.results-previous');
    return {
      toolbarY: toolbar.getBoundingClientRect().top - viewportTop,
      nextY: next.getBoundingClientRect().top - viewportTop,
      previousY: previous.getBoundingClientRect().top - viewportTop,
      gridHeight: grid.getBoundingClientRect().height,
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
      positions: [...grid.querySelectorAll('.resource-card')].map(card => Number(card.dataset.resultPosition)),
    };
  });
}
function assertAnchor(before, after, label) {
  for (const key of ['toolbarY', 'nextY', 'previousY']) {
    assert.ok(Math.abs(after[key] - before[key]) <= 2,
      label + ': ' + key + ' stays within 2px; before=' + before[key] + ', after=' + after[key]);
  }
}
async function clickPage(page, results, direction, expectedPositions, label) {
  const button = results.locator(direction === 1 ? '.results-next' : '.results-previous');
  await button.scrollIntoViewIfNeeded();
  await settle(page);
  const before = await geometry(results);
  await button.click();
  await page.waitForFunction(({ id, positions }) => {
    const grid = document.getElementById(id);
    return JSON.stringify([...grid.querySelectorAll('.resource-card')].map(card => Number(card.dataset.resultPosition))) === JSON.stringify(positions);
  }, { id: await results.locator('.result-grid').getAttribute('id'), positions: expectedPositions });
  await settle(page);
  const after = await geometry(results);
  assert.deepEqual(after.positions, expectedPositions, label + ': result order is preserved');
  assertAnchor(before, after, label);
  return after;
}
function positionsFor(pageIndex, pageSize) {
  return Array.from({ length: Math.min(pageSize, cardCount - pageIndex * pageSize) }, (_, offset) => pageIndex * pageSize + offset + 1);
}
async function delayedGrowth(page, results, label) {
  await results.locator('.results-previous').scrollIntoViewIfNeeded();
  await settle(page);
  const before = await geometry(results);
  const gridId = await results.locator('.result-grid').getAttribute('id');
  await page.evaluate(id => {
    // A later media measurement must be observed after the pagination nextTick has finished.
    setTimeout(() => {
      for (const preview of document.getElementById(id).querySelectorAll('.resource-mini-preview')) {
        preview.style.setProperty('--stability-preview-height', '360px');
      }
    }, 80);
  }, gridId);
  await page.waitForFunction(id => {
    const grid = document.getElementById(id);
    return [...grid.querySelectorAll('.resource-mini-preview')].every(preview => preview.getBoundingClientRect().height >= 359);
  }, gridId);
  await settle(page);
  const after = await geometry(results);
  assert.ok(after.gridHeight >= before.gridHeight + 100, label + ': delayed preview growth changes the real grid height');
  assertAnchor(before, after, label + ': delayed preview growth');
  return after;
}

async function testViewport(browser, mobile) {
  const label = mobile ? 'mobile' : 'desktop';
  const dimensions = mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 };
  const context = await browser.newContext({ locale: 'zh-CN', viewport: dimensions, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const state = { apiRequests: 0, modelOrSearchRequests: 0 };
  const errors = [];
  try {
    await install(context, state);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/AISearch');
    const latest = reply(page, 'stability-last');
    const older = reply(page, 'stability-old');
    await latest.locator('.resource-card').first().waitFor();
    await page.locator('.retrieval-status').waitFor();
    await page.waitForFunction(() => ![...document.querySelectorAll('.inline-notice')].some(element => element.textContent.includes('读取')));
    await settle(page);
    const pageSize = await latest.locator('.resource-card').count();
    assert.ok(pageSize >= 1 && pageSize <= 6);
    if (mobile) assert.equal(pageSize, 1, 'Mobile shows one card per page');
    const pageCount = Math.ceil(cardCount / pageSize);
    assert.ok(pageCount > 1);

    // The fixture uses real card titles/badges and a deterministic preview area.
    // Height changes remain real layout changes and exercise the component ResizeObserver.
    let fixtureCss = '.resource-mini-preview { box-sizing: border-box; height: var(--stability-preview-height, 60px) !important; min-height: var(--stability-preview-height, 60px) !important; overflow: hidden; }';
    for (let position = pageSize + 1; position <= Math.min(pageSize * 2, cardCount); position++) {
      fixtureCss += '.resource-card[data-result-position="' + position + '"] .resource-mini-preview { --stability-preview-height: 220px; }';
    }
    await page.addStyleTag({ content: fixtureCss });
    // The short viewport also exercises scrollTop clamping at the last reply.
    await page.locator('.message-viewport').evaluate(viewport => { viewport.style.flex = '0 0 360px'; });
    await settle(page);
    const startupRequests = state.apiRequests;
    await page.locator('.message-viewport').evaluate(viewport => { viewport.scrollTop = viewport.scrollHeight; });
    await settle(page);
    const initial = await geometry(latest);
    assert.ok(initial.scrollTop >= initial.scrollHeight - initial.clientHeight - 2, label + ': last reply begins at the scroll boundary');

    const tall = await clickPage(page, latest, 1, positionsFor(1, pageSize), label + ': last reply short to tall');
    assert.ok(tall.gridHeight > initial.gridHeight + 100, label + ': second page is taller');
    const short = await clickPage(page, latest, -1, positionsFor(0, pageSize), label + ': last reply tall to short');
    assert.ok(short.gridHeight >= tall.gridHeight - 2, label + ': shorter page retains the largest measured row');
    await clickPage(page, latest, 1, positionsFor(1, pageSize), label + ': last reply next again');
    const grown = await delayedGrowth(page, latest, label + ': last reply');
    const afterGrowth = await clickPage(page, latest, -1, positionsFor(0, pageSize), label + ': last reply delayed tall to short');
    assert.ok(afterGrowth.gridHeight >= grown.gridHeight - 2, label + ': asynchronous preview height is retained');

    const seen = [...positionsFor(0, pageSize)];
    for (let pageIndex = 1; pageIndex < pageCount; pageIndex++) {
      const stateAfterClick = await clickPage(page, latest, 1, positionsFor(pageIndex, pageSize), label + ': ordered page ' + (pageIndex + 1));
      seen.push(...stateAfterClick.positions);
    }
    assert.deepEqual(seen, Array.from({ length: cardCount }, (_, index) => index + 1), label + ': every result is visited once in order');
    assert.equal(await latest.locator('.results-next').isDisabled(), true, label + ': last page disables next');
    for (let pageIndex = pageCount - 2; pageIndex >= 0; pageIndex--) {
      await clickPage(page, latest, -1, positionsFor(pageIndex, pageSize), label + ': ordered previous page ' + (pageIndex + 1));
    }
    assert.equal(await latest.locator('.results-previous').isDisabled(), true, label + ': first page disables previous');

    await clickPage(page, older, 1, positionsFor(1, pageSize), label + ': older reply short to tall');
    const olderGrown = await delayedGrowth(page, older, label + ': older reply');
    const following = page.locator('.message-user').nth(1);
    const followingBefore = await following.evaluate(element => element.getBoundingClientRect().top);
    const olderShort = await clickPage(page, older, -1, positionsFor(0, pageSize), label + ': older reply tall to short');
    assert.ok(olderShort.gridHeight >= olderGrown.gridHeight - 2, label + ': older reply retains delayed media height');
    const followingAfter = await following.evaluate(element => element.getBoundingClientRect().top);
    assert.ok(Math.abs(followingAfter - followingBefore) <= 2, label + ': paging shorter old results keeps later messages in place');
    assert.equal(await page.locator('.chat-message').count(), history[0].messages.length, label + ': all chat messages remain mounted');
    assert.match(await following.innerText(), /后面的聊天内容应保留/u);
    assert.deepEqual((await geometry(latest)).positions, positionsFor(0, pageSize), label + ': paging an old reply preserves the latest reply page');

    // A changed width must recalculate the height floor even when pageSize stays the same.
    await page.addStyleTag({ content: '.resource-mini-preview { --stability-preview-height: 32px !important; }' });
    await settle(page);
    const beforeResize = await geometry(latest);
    assert.ok(beforeResize.gridHeight >= grown.gridHeight - 2, label + ': same-width shorter previews preserve the row floor');
    await page.setViewportSize({ width: dimensions.width + 40, height: dimensions.height });
    await settle(page);
    await page.waitForFunction(id => document.getElementById(id).getBoundingClientRect().height < 350, 'resource-results-stability-last');
    const afterResize = await geometry(latest);
    assert.ok(afterResize.gridHeight < beforeResize.gridHeight - 100, label + ': a new width measures the current row again');

    assert.equal(state.apiRequests, startupRequests, label + ': paging and resizing make no additional AI/search API requests');
    assert.equal(state.modelOrSearchRequests, 0, label + ': no model or search request is made');
    assert.deepEqual(errors, [], label + ': no browser runtime errors');
  } finally { await context.close(); }
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    await testViewport(browser, false);
    await testViewport(browser, true);
    console.log('PASS AISearch pagination stability: desktop/mobile, last/older replies, taller/shorter pages, delayed preview growth, stable toolbar/button positions, retained later chat content, width reset, complete ordered results, and no search/model calls.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

