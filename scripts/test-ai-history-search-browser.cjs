/* NODE_PATH=<bundled playwright modules> node scripts/test-ai-history-search-browser.cjs [base URL] */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8080';
const outputDirectory = path.resolve(__dirname, '../../ugc-ai-search-file/verification/browser');
const catalogue = { catalogVersion: 'history-browser-v1', counts: { total: 1 }, mode: 'keyword', coverage: { description: 1 } };
const message = (id, role, content, cards = []) => ({ id, role, content, cards, mode: 'basic', source: 'basic', status: 'complete' });
const tail = prefix => Array.from({ length: 12 }, (_, index) => message(`${prefix}-tail-${index}`, 'assistant', `后续上下文 ${index + 1}。${'完整历史仍保留，定位搜索结果后不应被自动滚动到底部覆盖。'.repeat(18)}`));
const card = { resourceId: 'sound:91001', id: '91001', kind: 'sound', title: 'Card-Title Chime', description: 'Card-Description 暴风雨中的清脆钟声', keywords: [], suggestedUses: [], duration: 1, href: '/SoundEffectPlayer?id=91001', matchType: 'feature' };
// Deliberately unsorted: the recent list must use updatedAt rather than storage order.
const history = [
  { id: 'history-alpha', title: 'Alpha only title', updatedAt: 1000, contextStart: 0, messages: [message('history-alpha-message', 'assistant', '初始会话仍保持挂载。')] },
  { id: 'history-body', title: '正文归档', updatedAt: 4000, contextStart: 0, messages: [message('history-body-target', 'user', '请定位 BRONZE-NEEDLE 附近的这条用户消息。'), ...tail('history-body')] },
  { id: 'history-recent', title: '最新空白对话', updatedAt: 5000, contextStart: 0, messages: [] },
  { id: 'history-alpha-new', title: 'aLPHa another title', updatedAt: 3000, contextStart: 0, messages: [message('history-alpha-new-message', 'assistant', '另一个标题匹配会话。')] },
  { id: 'history-card', title: '卡片资料', updatedAt: 2000, contextStart: 0, messages: [message('history-card-target', 'assistant', '资源索引', [card]), ...tail('history-card')] },
];
const recentIds = ['history-recent', 'history-body', 'history-alpha-new', 'history-card', 'history-alpha'];

async function install(context, state) {
  await context.addInitScript(seed => localStorage.setItem('ugc-tools.ai-search.history.v1', JSON.stringify(seed)), history);
  // All third-party data stays in this fixture; only local app assets can reach the server.
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin
    ? route.continue() : route.fulfill({ status: 404, body: '' }));
  await context.route('**/ugc-tool-data/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/AISearch/index.json') || pathname.includes('/audio/')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ json: pathname.endsWith('/SoundEffectPlayer/data.json') ? { data: [], category: [] } : {} });
  });
  await context.route('**/api/ai-search/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.split('/').at(-1);
    state.requests.push(endpoint);
    if (endpoint === 'config') return route.fulfill({ json: { configured: false, available: false, retrieval: { available: true, ...catalogue } } });
    if (endpoint === 'catalog') return route.fulfill({ json: catalogue });
    if (endpoint === 'search') {
      if (state.searchGate) await state.searchGate;
      return route.fulfill({ json: { ...catalogue, total: 0, hasMore: false, items: [] } }).catch(() => {});
    }
    state.modelRequests++;
    return route.fulfill({ status: 500, body: 'History search does not call a model.' });
  });
}

async function setup(browser, mobile) {
  const state = { requests: [], modelRequests: 0 };
  const context = await browser.newContext({ locale: 'zh-CN', viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, serviceWorkers: 'block', ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  await install(context, state);
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/AISearch`);
  await page.waitForFunction(() => document.querySelectorAll('.conversation-row').length === 5 && !document.querySelector('.history-search-button')?.disabled && !!document.querySelector('.retrieval-status'));
  return { context, page, state, errors };
}

const results = page => page.locator('.history-search-dialog .history-search-result');
const resultIds = page => results(page).evaluateAll(elements => elements.map(element => element.dataset.conversationId));
const highlightedId = page => page.locator('.history-search-result.is-highlighted').getAttribute('data-conversation-id');

async function open(page, mobile = false) {
  if (mobile && !await page.locator('.search-sidebar').evaluate(element => element.classList.contains('is-open'))) await page.locator('.history-toggle').click();
  await page.locator('.history-search-button').click();
  const dialog = page.locator('.history-search-dialog');
  await dialog.waitFor();
  assert.equal(await dialog.evaluate(element => element instanceof HTMLDialogElement && element.open && element.matches(':modal')), true, 'History search uses the native modal dialog');
  assert.equal(await page.locator('.history-search-button').getAttribute('aria-controls'), await dialog.getAttribute('id'), 'The history button identifies the native dialog it opens');
  assert.equal(await page.locator('.history-search-input').evaluate(element => document.activeElement === element), true, 'Opening history search focuses its search input');
  assert.equal(await page.locator('.history-search-button').getAttribute('aria-expanded'), 'true');
  return dialog;
}

async function query(page, text, ids) {
  await page.locator('.history-search-input').fill(text);
  await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('.history-search-result')].map(element => element.dataset.conversationId)) === JSON.stringify(expected), ids);
  assert.deepEqual(await resultIds(page), ids);
}

async function assertClosed(page, restore = false) {
  await page.locator('.history-search-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.history-search-button').getAttribute('aria-expanded'), 'false');
  if (restore) await page.waitForFunction(() => document.activeElement === document.querySelector('.history-search-button'));
}

async function assertSelectedMessage(page, conversationId, messageId) {
  await page.waitForFunction(expected => {
    const target = document.querySelector(`.chat-message[data-message-id="${expected.messageId}"]`);
    const viewport = document.querySelector('.message-viewport');
    if (!target || !viewport) return false;
    const bounds = target.getBoundingClientRect(); const visible = viewport.getBoundingClientRect();
    return bounds.top >= visible.top - 1 && bounds.top < visible.bottom && document.activeElement === target;
  }, { messageId });
  const title = history.find(item => item.id === conversationId).title;
  assert.equal((await page.locator('.conversation-row.active .conversation-select').innerText()).trim(), title);
  assert.ok(await page.locator('.message-viewport').evaluate(element => element.scrollTop < element.scrollHeight - element.clientHeight - 100), 'A matched early message stays visible instead of jumping to the conversation end');
}

async function testDesktop(browser) {
  const { context, page, state, errors } = await setup(browser, false);
  const workspace = await page.locator('.ai-search-workspace').elementHandle();
  const originalURL = page.url();
  try {
    const entrance = await page.locator('.history-search-button').boundingBox();
    const newConversation = await page.locator('.new-conversation').boundingBox();
    assert.ok(entrance.x + entrance.width <= newConversation.x + 1 && entrance.y < newConversation.y + newConversation.height, 'Search history appears to the left of New Conversation on the same row');
    const initialRequests = state.requests.length;
    const dialog = await open(page);
    assert.deepEqual(await resultIds(page), recentIds, 'Empty search shows conversations from newest to oldest');
    assert.equal(await workspace.evaluate(element => element.isConnected && element === document.querySelector('.ai-search-workspace')), true, 'Opening the search overlay leaves the main workspace mounted');
    assert.equal(page.url(), originalURL, 'The overlay does not change route');
    await page.screenshot({ path: path.join(outputDirectory, 'ai-history-search-recent-desktop.png'), fullPage: true });
    await query(page, 'ALPHA', ['history-alpha-new', 'history-alpha']);
    assert.ok(await results(page).evaluateAll(elements => elements.every(element => !element.dataset.messageId)), 'Title-only matches do not invent a message target');
    await query(page, 'alpha', ['history-alpha-new', 'history-alpha']);
    const input = page.locator('.history-search-input');
    const initialHighlight = await highlightedId(page);
    await input.evaluate(element => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '中' }));
      for (const key of ['ArrowDown', 'Enter']) element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }));
      for (const key of ['ArrowDown', 'Enter']) element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, isComposing: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true }));
    });
    assert.equal(await dialog.evaluate(element => element.open), true, 'IME keys do not select a conversation');
    assert.equal(await highlightedId(page), initialHighlight, 'IME arrow keys do not move result navigation');
    await input.press('ArrowDown');
    assert.equal(await highlightedId(page), 'history-alpha');
    await input.press('ArrowUp');
    assert.equal(await highlightedId(page), 'history-alpha-new');
    await input.press('Enter');
    await assertClosed(page);
    assert.equal((await page.locator('.conversation-row.active .conversation-select').innerText()).trim(), 'aLPHa another title', 'Enter opens the highlighted title match');
    await open(page);
    await query(page, '', recentIds);
    await query(page, 'no-such-history-needle', []);
    await page.locator('.history-search-empty').waitFor();
    await input.press('Enter');
    assert.equal(await dialog.evaluate(element => element.open), true, 'Enter with no results does not close the dialog');
    await query(page, '', recentIds);
    await query(page, 'bronze-needle', ['history-body']);
    assert.equal(await results(page).first().getAttribute('data-message-id'), 'history-body-target', 'A body match identifies the matching message');
    await results(page).first().click();
    await assertClosed(page);
    await assertSelectedMessage(page, 'history-body', 'history-body-target');
    console.log('PASS history search: recent ordering, title/body matching, case folding, clear/no-result, keyboard and IME, conversation switch and early-message positioning');
    await open(page);
    await query(page, 'card-title', ['history-card']);
    assert.equal(await results(page).first().getAttribute('data-message-id'), 'history-card-target');
    await query(page, 'CARD-DESCRIPTION', ['history-card']);
    await page.screenshot({ path: path.join(outputDirectory, 'ai-history-search-card-desktop.png'), fullPage: true });
    await results(page).first().click();
    await assertClosed(page);
    await assertSelectedMessage(page, 'history-card', 'history-card-target');
    await page.screenshot({ path: path.join(outputDirectory, 'ai-history-search-position-desktop.png'), fullPage: true });
    await open(page);
    await page.keyboard.press('Escape');
    await assertClosed(page, true);
    await open(page);
    await input.click();
    assert.equal(await dialog.evaluate(element => element.open), true, 'Clicks inside the dialog keep it open');
    await page.mouse.click(5, 5);
    await assertClosed(page, true);
    await open(page);
    await page.locator('.history-search-close').click();
    await assertClosed(page, true);
    assert.equal(page.url(), originalURL);
    assert.equal(await workspace.evaluate(element => element.isConnected), true);
    assert.equal(state.requests.length, initialRequests, 'Searching and opening archived conversations makes no retrieval or model requests');
    assert.equal(state.modelRequests, 0);
    await page.locator('.site-ai-notice-actions').getByRole('button', { name: '基础搜索', exact: true }).click();
    let releaseSearch;
    state.searchGate = new Promise(resolve => { releaseSearch = resolve; });
    try {
      const busyRequest = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/api/ai-search/search'));
      await page.locator('#asset-query').fill('busy history fixture');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await page.locator('.stop-button').waitFor();
      await busyRequest;
      assert.equal(await page.locator('.history-search-button').isDisabled(), true, 'Searching history is disabled while a request is busy');
      await page.locator('.history-search-button').evaluate(element => element.click());
      assert.equal(await dialog.evaluate(element => element.open), false, 'A disabled native history button cannot open the dialog');
      await page.locator('.stop-button').click();
      releaseSearch();
      await page.waitForFunction(() => !document.querySelector('.history-search-button')?.disabled);
    } finally { releaseSearch(); }
    assert.equal(state.modelRequests, 0);
    assert.deepEqual(errors, []);
    console.log('PASS history search: card text, Escape/backdrop/close with focus restoration, mounted workspace and busy disablement');
  } finally { await context.close(); }
}

async function testMobile(browser) {
  const { context, page, state, errors } = await setup(browser, true);
  try {
    const dialog = await open(page, true);
    assert.deepEqual(await resultIds(page), recentIds);
    const geometry = await dialog.evaluate(element => { const bounds = element.getBoundingClientRect(); return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height, innerWidth, innerHeight, documentWidth: document.documentElement.scrollWidth, panelOverflow: element.scrollWidth > element.clientWidth + 1 }; });
    assert.ok(geometry.left >= 0 && geometry.right <= geometry.innerWidth + 1 && geometry.top >= 0 && geometry.bottom <= geometry.innerHeight + 1, `The mobile dialog fits its viewport: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.documentWidth <= geometry.innerWidth + 1 && !geometry.panelOverflow, 'The mobile search overlay has no horizontal overflow');
    await page.screenshot({ path: path.join(outputDirectory, 'ai-history-search-mobile.png'), fullPage: true });
    await query(page, 'BRONZE-NEEDLE', ['history-body']);
    await results(page).first().tap();
    await assertClosed(page);
    await assertSelectedMessage(page, 'history-body', 'history-body-target');
    assert.equal(await page.locator('.search-sidebar').evaluate(element => element.classList.contains('is-open')), false, 'Choosing a mobile result closes the history drawer and reveals its message');
    await page.screenshot({ path: path.join(outputDirectory, 'ai-history-search-position-mobile.png'), fullPage: true });
    assert.ok(state.requests.every(endpoint => endpoint === 'config' || endpoint === 'catalog'), 'Mobile history navigation uses no search or model request');
    assert.equal(state.modelRequests, 0);
    assert.deepEqual(errors, []);
    console.log('PASS history search: 390px native overlay layout, touch selection and matched-message positioning', JSON.stringify(geometry));
  } finally { await context.close(); }
}

(async () => {
  await fs.mkdir(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.AI_SEARCH_BROWSER_CHANNEL || 'msedge', headless: true });
  try { await testDesktop(browser); await testMobile(browser); }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
