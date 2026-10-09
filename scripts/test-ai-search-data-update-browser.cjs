/* NODE_PATH=<bundled playwright modules> node scripts/test-ai-search-data-update-browser.cjs [base URL] */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const base = process.argv[2] || 'http://127.0.0.1:8080';
const noticeText = '提示词或数据库有更新，建议新开一个对话搜索';
const historyTitle = '更新前的旧对话';
const historyText = '这段旧对话应在数据库更新后继续保留。';
const catalogVersion = 'data-update-browser-catalog';
const asset = { resourceId: 'sound:88001', kind: 'sound', title: '测试雷声', description: '短促的低沉雷声', keywords: ['雷声'], duration: 1 };
const isIndex = request => new URL(request.url()).pathname.endsWith('/AISearch/index.json');
const notice = page => page.locator('[data-sonner-toast]').filter({ has: page.getByText(noticeText, { exact: true }) });

async function install(context, state, seedHistory = true) {
  await context.addInitScript(({ historyTitle, historyText, seedHistory }) => {
    localStorage.setItem('ugc-tools.locale', 'zh-CN');
    if (!seedHistory || sessionStorage.getItem('data-update-history-seeded')) return;
    sessionStorage.setItem('data-update-history-seeded', 'true');
    localStorage.setItem('ugc-tools.ai-search.history.v1', JSON.stringify([
      { id: 'data-update-history', title: historyTitle, updatedAt: 1, contextStart: 0, messages: seedHistory === 'empty' ? [] : [
        { id: 'data-update-old-message', role: 'assistant', content: historyText, cards: [], mode: 'basic', status: 'complete' },
      ] },
    ]));
  }, { historyTitle, historyText, seedHistory });
  await context.route('**/ugc-tool-data/**', route => {
    if (isIndex(route.request())) {
      state.indexRequests++;
      assert.equal(route.request().headers().authorization, undefined, 'OSS index receives no model credentials');
      assert.ok(new URL(route.request().url()).searchParams.has('_t'), 'Index checks bypass the previous cached URL');
      if (state.indexError === 'network') return route.abort('failed');
      if (state.indexError === '404') return route.fulfill({ status: 404, body: '' });
      if (state.indexError === 'json') return route.fulfill({ contentType: 'application/json', body: '{' });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: state.version }) });
    }
    // No OSS resource or prompt is needed for this server-backed basic-search test.
    return route.fulfill({ status: 404, body: '' });
  });
  await context.route('**/api/ai-search/**', route => {
    const endpoint = new URL(route.request().url()).pathname.split('/').at(-1);
    let body;
    if (endpoint === 'config') body = { configured: false, available: false, retrieval: { available: true } };
    else if (endpoint === 'catalog') body = { catalogVersion, counts: { total: 1 }, mode: 'keyword', coverage: { description: 1 } };
    else if (endpoint === 'search') {
      state.searchRequests++;
      body = { catalogVersion, counts: { total: 1 }, mode: 'keyword', total: 1, hasMore: false, items: [asset], coverage: { description: 1 } };
    } else if (endpoint === 'assets') body = { catalogVersion, items: [asset] };
    else {
      state.unexpectedModelRequests.push(route.request().url());
      return route.fulfill({ status: 503, body: '{"error":{"code":"TEST_MODEL_REQUEST_FORBIDDEN"}}', contentType: 'application/json' });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}

// Await the actual fetch completion before testing an absent toast, including aborted requests.
async function checkAfter(page, action) {
  let completed;
  let failed;
  let timer;
  const settled = new Promise((resolve, reject) => {
    const finish = request => { if (isIndex(request)) resolve(); };
    completed = finish;
    failed = finish;
    page.on('requestfinished', completed);
    page.on('requestfailed', failed);
    timer = setTimeout(() => reject(new Error('No OSS index check completed')), 10000);
  });
  try {
    await action();
    await settled;
    await page.waitForTimeout(100);
  } finally {
    clearTimeout(timer);
    page.off('requestfinished', completed);
    page.off('requestfailed', failed);
  }
}

const focusCheck = page => checkAfter(page, () => page.evaluate(() => window.dispatchEvent(new Event('focus'))));
async function waitReady(page) {
  await page.locator('.retrieval-status').waitFor();
  await page.waitForFunction(() => !document.querySelector('#asset-query')?.disabled);
  if (await page.locator('.model-trigger').getAttribute('data-search-mode') !== 'basic') {
    await page.locator('.model-trigger').click();
    await page.locator('.model-dialog [data-search-mode-option="basic"]').click();
    await page.locator('.model-dialog button.primary-button[type="submit"]').click();
    await page.locator('.model-dialog').waitFor({ state: 'hidden' });
  }
  assert.equal(await page.locator('.model-trigger').getAttribute('data-search-mode'), 'basic');
}
async function expectNotice(page) {
  await notice(page).waitFor();
  assert.equal(await notice(page).locator('[data-title]').innerText(), noticeText, 'The update notice matches the requested Chinese text');
  assert.equal(await notice(page).locator('[data-close-button]').count(), 1, 'The floating update notice is dismissible');
}
async function dismissNotice(page) {
  const geometry = await notice(page).evaluateAll(elements => elements.map(element => {
    const bounds = element.getBoundingClientRect();
    return { data: { ...element.dataset }, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, transform: getComputedStyle(element).transform, viewport: { width: innerWidth, height: innerHeight } };
  }));
  try { await notice(page).locator('[data-close-button]').click({ timeout: 10000 }); }
  catch (error) {
    console.error('Update toast diagnostics before closing:', geometry);
    throw error;
  }
  await notice(page).waitFor({ state: 'hidden' });
}
async function waitStoredVersion(page, version) {
  await page.waitForFunction(expected => Object.keys(localStorage).some(key =>
    key.startsWith('ugc-tools.ai-search.data-version.v1:') && localStorage.getItem(key) === expected), version);
}
async function waitArchive(page, expectedCount, expectedTexts = [historyText]) {
  await page.waitForFunction(async ({ count, texts }) => {
    try {
      const storage = document.querySelector('#app').__vue_app__._context.provides.storage;
      const read = async () => JSON.parse(await storage.provider.readFile('/AISearch/archive.json'));
      const archive = navigator.locks ? await navigator.locks.request('ugc-tools.browser-storage.write', read) : await read();
      return archive.conversations.length === count && texts.every(text => archive.conversations.some(item => item.messages.some(message => message.content === text)));
    } catch { return false; }
  }, { count: expectedCount, texts: expectedTexts });
}
async function submitSearch(page) {
  await checkAfter(page, async () => {
    await page.locator('#asset-query').fill('雷声');
    await page.getByRole('button', { name: '发送', exact: true }).click();
  });
  await page.getByRole('button', { name: '停止', exact: true }).waitFor({ state: 'hidden' });
}
async function assertHistory(page, expectedTexts) {
  assert.deepEqual(await page.locator('.chat-message .message-text').allTextContents(), expectedTexts, 'Update checks preserve all old conversation messages');
}

async function desktop(browser) {
  const state = { version: 'release-1', indexRequests: 0, searchRequests: 0, unexpectedModelRequests: [] };
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
  await install(context, state);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  try {
    await checkAfter(page, () => page.goto(`${base}/AISearch`));
    await waitReady(page);
    await waitStoredVersion(page, 'release-1');
    await expectNotice(page);
    await assertHistory(page, [historyText]);
    await dismissNotice(page);
    await waitArchive(page, 1);
    await checkAfter(page, () => page.reload());
    await waitReady(page);
    assert.equal(await notice(page).count(), 0, 'An old user dismisses the first migration notice once; the same version stays dismissed after refresh');
    await assertHistory(page, [historyText]);

    const checksBeforeSearch = state.indexRequests;
    await submitSearch(page);
    assert.ok(state.indexRequests > checksBeforeSearch, 'Submitting a basic search checks the public update marker');
    assert.equal(state.searchRequests, 1, 'The update check permits the ordinary basic search');
    assert.equal(await page.locator('.message-error').count(), 0);
    const preservedTexts = await page.locator('.chat-message .message-text').allTextContents();
    assert.ok(preservedTexts.includes(historyText));
    await waitArchive(page, 1);

    state.version = 'release-2';
    await focusCheck(page);
    await expectNotice(page);
    await assertHistory(page, preservedTexts);
    await dismissNotice(page);
    await focusCheck(page);
    assert.equal(await notice(page).count(), 0, 'The same version does not reappear after dismissal');

    state.version = 'release-3';
    await focusCheck(page);
    await expectNotice(page);
    await dismissNotice(page);
    await waitStoredVersion(page, 'release-3');
    state.version = 'release-4';
    await checkAfter(page, () => page.reload());
    await waitReady(page);
    await expectNotice(page);
    await waitStoredVersion(page, 'release-4');
    await assertHistory(page, preservedTexts);
    await dismissNotice(page);

    await page.getByRole('button', { name: '新对话', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.conversation-row').length === 2);
    assert.equal(await page.locator('.chat-message').count(), 0, 'New conversation starts empty');
    await waitArchive(page, 2);
    await page.locator('.conversation-select').filter({ hasText: historyTitle }).click();
    await page.locator('.message-text').filter({ hasText: historyText }).waitFor();
    await assertHistory(page, preservedTexts);

    for (const failure of ['404', 'json', 'network']) {
      state.indexError = failure;
      state.version = 'release-5';
      await focusCheck(page);
      assert.equal(await notice(page).count(), 0, `${failure}: failed checks do not show update notices`);
      await assertHistory(page, preservedTexts);
    }
    delete state.indexError;
    await focusCheck(page);
    await expectNotice(page);
    await dismissNotice(page);

    state.version = 'release-6';
    await checkAfter(page, () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))));
    await expectNotice(page);
    await dismissNotice(page);
    state.version = 'release-7';
    await checkAfter(page, () => page.clock.fastForward(60000));
    await expectNotice(page);

    // Use an in-app route change so the component unmount cleanup is exercised.
    await page.locator('#menuBtn').click();
    await page.locator('.sidebar-navigation a[href="/"]').click();
    await page.locator('.ai-search-workspace').waitFor({ state: 'hidden' });
    await notice(page).waitFor({ state: 'hidden' });
    const checksAfterLeaving = state.indexRequests;
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(61000);
    await page.waitForTimeout(150);
    assert.equal(state.indexRequests, checksAfterLeaving, 'Leaving AI Search stops focus, visibility and interval index checks');
    assert.deepEqual(state.unexpectedModelRequests, [], 'No chat or real model request is made');
    assert.deepEqual(errors, [], 'The browser has no uncaught page errors');
  } finally { await context.close(); }
}

async function migrationAfterFailedIndex(browser) {
  const state = { version: 'migration-retry-1', indexError: '404', indexRequests: 0, searchRequests: 0, unexpectedModelRequests: [] };
  const context = await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'block' });
  await install(context, state);
  const page = await context.newPage();
  try {
    await checkAfter(page, () => page.goto(`${base}/AISearch`));
    await waitReady(page);
    assert.equal(await notice(page).count(), 0, 'An old user gets no migration notice while the first index response fails');
    await assertHistory(page, [historyText]);
    for (const failure of ['json', 'network']) {
      state.indexError = failure;
      await focusCheck(page);
      assert.equal(await notice(page).count(), 0, `${failure}: a failed first marker does not prematurely consume the migration notice`);
    }
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('ugc-tools.ai-search.data-version.v1:'))), false, 'Failures do not establish a version baseline');
    delete state.indexError;
    await focusCheck(page);
    await expectNotice(page);
    await waitStoredVersion(page, state.version);
    await assertHistory(page, [historyText]);
    await dismissNotice(page);
    await waitArchive(page, 1);
    await checkAfter(page, () => page.reload());
    await waitReady(page);
    assert.equal(await notice(page).count(), 0, 'The migration notice remains dismissed after a failed-first-check recovery and refresh');
    await assertHistory(page, [historyText]);
    assert.deepEqual(state.unexpectedModelRequests, []);
  } finally { await context.close(); }
}

async function firstRunWithoutMessages(browser) {
  for (const seedHistory of [false, 'empty']) {
    const state = { version: `new-user-${seedHistory}`, indexRequests: 0, searchRequests: 0, unexpectedModelRequests: [] };
    const context = await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'block' });
    await install(context, state, seedHistory);
    const page = await context.newPage();
    try {
      await checkAfter(page, () => page.goto(`${base}/AISearch`));
      await waitReady(page);
      await waitStoredVersion(page, state.version);
      assert.equal(await notice(page).count(), 0, `${seedHistory ? 'Only empty conversations' : 'No history'}: first successful index establishes a baseline without a migration notice`);
      assert.equal(await page.locator('.chat-message').count(), 0);
      await waitArchive(page, 1, []);
      await checkAfter(page, () => page.reload());
      await waitReady(page);
      assert.equal(await notice(page).count(), 0, 'An empty conversation still receives no notice after refresh');
      assert.deepEqual(state.unexpectedModelRequests, []);
    } finally { await context.close(); }
  }
}

async function newUserCreatesMessagesBeforeFirstValidIndex(browser) {
  const state = { version: 'fresh-session-1', indexError: 'json', indexRequests: 0, searchRequests: 0, unexpectedModelRequests: [] };
  const context = await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'block' });
  await install(context, state, false);
  const page = await context.newPage();
  try {
    await checkAfter(page, () => page.goto(`${base}/AISearch`));
    await waitReady(page);
    await submitSearch(page);
    assert.equal(state.searchRequests, 1, 'A failed update check does not block the new user searching');
    assert.equal(await page.locator('.message-error').count(), 0);
    const createdTexts = await page.locator('.chat-message .message-text').allTextContents();
    assert.ok(createdTexts.includes('雷声'));
    await waitArchive(page, 1, ['雷声']);
    delete state.indexError;
    await focusCheck(page);
    await waitStoredVersion(page, state.version);
    assert.equal(await notice(page).count(), 0, 'New messages created in this page do not make a first-time user eligible for the migration notice');
    await assertHistory(page, createdTexts);

    // Simulate an existing unified archive saved by the webpage before update detection was available.
    await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('ugc-tools.ai-search.data-version.v1:')).forEach(key => localStorage.removeItem(key)));
    await checkAfter(page, () => page.reload());
    await waitReady(page);
    await expectNotice(page);
    await waitStoredVersion(page, state.version);
    await assertHistory(page, createdTexts);
    await dismissNotice(page);
    await checkAfter(page, () => page.reload());
    await waitReady(page);
    assert.equal(await notice(page).count(), 0, 'Migration notices for restored unified archives also appear only once per version');
    await assertHistory(page, createdTexts);
    assert.deepEqual(state.unexpectedModelRequests, []);
  } finally { await context.close(); }
}

async function mobile(browser) {
  const state = { version: 'mobile-1', indexRequests: 0, searchRequests: 0, unexpectedModelRequests: [] };
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await install(context, state, false);
  const page = await context.newPage();
  try {
    await checkAfter(page, () => page.goto(`${base}/AISearch`));
    await waitReady(page);
    assert.equal(await notice(page).count(), 0);
    state.version = 'mobile-2';
    await focusCheck(page);
    await expectNotice(page);
    const bounds = await notice(page).boundingBox();
    const pageWidth = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= pageWidth.viewport + 1, 'The floating notice fits the mobile viewport');
    assert.ok(pageWidth.width <= pageWidth.viewport + 1, 'The notice creates no mobile horizontal overflow');
    await dismissNotice(page);
    assert.deepEqual(state.unexpectedModelRequests, []);
  } finally { await context.close(); }
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    await desktop(browser);
    await migrationAfterFailedIndex(browser);
    await firstRunWithoutMessages(browser);
    await newUserCreatesMessagesBeforeFirstValidIndex(browser);
    await mobile(browser);
    console.log('PASS AI Search data update: one-time migration notice for legacy/unified history, first-index failure retry, no migration notice for new/empty users or messages created this visit, exact dismissible Chinese toast, version deduplication, preserved history/new conversation, refresh persistence, failure retry, focus/visibility/60-second checks, mobile width and route cleanup; all AI/OSS requests mocked.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
