// Offline integration regression. Fixtures and generated media stay in memory.
// Usage: node scripts/test-animation-viewer-browser.cjs
// ANIMATION_VIEWER_URL: local app origin (default http://127.0.0.1:8080)
// ANIMATION_VIEWER_EVIDENCE: absolute evidence directory outside this repository
// ANIMATION_VIEWER_CHECK=copy-name runs only the focused clipboard regression.
// ANIMATION_VIEWER_PLAYWRIGHT / ANIMATION_VIEWER_BROWSER / ANIMATION_VIEWER_FFMPEG are optional overrides.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const bundledModules = 'C:/Users/Luna_Kindred/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
function playwrightModule() {
  if (process.env.ANIMATION_VIEWER_PLAYWRIGHT) return process.env.ANIMATION_VIEWER_PLAYWRIGHT;
  try { return require.resolve('playwright'); }
  catch { return path.join(bundledModules, 'playwright'); }
}
const { chromium } = require(playwrightModule());
const base = process.env.ANIMATION_VIEWER_URL || 'http://127.0.0.1:8080';
const target = new URL('/AnimationViewer', base).href;
const output = path.resolve(process.env.ANIMATION_VIEWER_EVIDENCE
  || 'H:/Code/ugc-web/ugc-ai-search-file/verification/browser/animation-viewer-default-category-buttons');
const repo = path.resolve(__dirname, '..');
const relativeOutput = path.relative(repo, output);
assert.ok(relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput), 'Browser evidence must stay outside the repository');

const categories = [1, 2, 3, 4, 5].map(id => ({ id, nameI18nKey: `animationViewer.category.${id}` }));
const fixture = {
  category: categories,
  data: [
    { type: 'single', category: 1, nameI18nKey: 'animationViewer.skills.qaSlash', giVersion: '6.0',
      parts: [{ type: 'single', path: 'qa/slash.webm', duration: 2.5 }] },
    { type: 'combo', category: 2, nameI18nKey: 'animationViewer.skills.qaChannel', giVersion: '6.1', parts: [
      { type: 'single', nameI18nKey: 'animationViewer.parts.qaStart', path: 'qa/channel-start.webm', duration: 0.4 },
      { type: 'continuous', nameI18nKey: 'animationViewer.parts.qaLoop', path: 'qa/channel-loop.webm', duration: 4.2 },
      { type: 'single', nameI18nKey: 'animationViewer.parts.qaEnd', path: 'qa/channel-end.webm', duration: 0.6 },
    ] },
    { type: 'combo', category: 3, nameI18nKey: 'animationViewer.skills.qaMove', parts: [
      { type: 'single', nameI18nKey: 'animationViewer.parts.qaStart', path: 'qa/move-start.webm' },
      { type: 'continuous', nameI18nKey: 'animationViewer.parts.qaLoop', path: 'qa/move-loop.webm' },
      { type: 'single', nameI18nKey: 'animationViewer.parts.qaEnd', path: 'qa/move-end.webm' },
    ] },
    { type: 'single', category: 4, nameI18nKey: 'animationViewer.skills.qaAim', giVersion: '6.0', parts: [{ type: 'continuous', path: 'qa/aim.webm' }] },
    { type: 'combo', category: 5, nameI18nKey: 'animationViewer.skills.qaCombo', giVersion: '6.1', parts: [
      { type: 'single', nameI18nKey: 'animationViewer.parts.qaFirst', path: 'qa/combo-first.webm' },
      { type: 'single', nameI18nKey: 'animationViewer.parts.qaCharge', path: 'qa/combo-charge.webm' },
      { type: 'continuous', nameI18nKey: 'animationViewer.parts.qaLoop', path: 'qa/combo-loop.webm' },
      { type: 'single', nameI18nKey: 'animationViewer.parts.qaSecond', path: 'qa/combo-second.webm' },
      { type: 'single', nameI18nKey: 'animationViewer.parts.qaEnd', path: 'qa/combo-end.webm' },
    ] },
  ],
};
const dictionary = {
  'animationViewer.skills.qaSlash': '验证横斩',
  'animationViewer.skills.qaChannel': '验证持续引导',
  'animationViewer.skills.qaMove': '验证突进',
  'animationViewer.skills.qaAim': '验证瞄准',
  'animationViewer.skills.qaCombo': '验证剑术套组',
  'animationViewer.parts.qaFirst': '验证上挑',
  'animationViewer.parts.qaSecond': '验证下劈',
  'animationViewer.parts.qaCharge': '验证蓄力',
  'animationViewer.parts.qaStart': '前摇',
  'animationViewer.parts.qaLoop': '持续',
  'animationViewer.parts.qaEnd': '后摇',
  'animationViewer.category.qaEmpty': '仅配置分类的远程名称 CustomCategoryWithoutAnyAnimations_ContinuousPreviewCatalog',
};
const checks = [];
let activePage;

function tinyVideo() {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x100:rate=12',
    '-t', '2', '-an', '-c:v', 'libvpx', '-b:v', '60k', '-deadline', 'realtime', '-f', 'webm', 'pipe:1',
  ];
  const options = { windowsHide: true, maxBuffer: 5 * 1024 * 1024 };
  let result = spawnSync(process.env.ANIMATION_VIEWER_FFMPEG || 'ffmpeg', args, options);
  if (!process.env.ANIMATION_VIEWER_FFMPEG && result.error?.code === 'ENOENT') {
    result = spawnSync('H:/Custom Program Files/ffmpeg/bin/ffmpeg.exe', args, options);
  }
  assert.equal(result.status, 0, `Unable to generate in-memory video: ${result.error?.message || result.stderr?.toString()}`);
  assert.ok(result.stdout.length > 100, 'Video fixture contains encoded frames');
  return result.stdout;
}

function record(message) {
  checks.push(message);
  console.log(`PASS ${message}`);
}

async function createPage(browser, media, state, viewport = { width: 1600, height: 1100 }) {
  const context = await browser.newContext({ viewport });
  const errors = [];
  const requests = [];
  await context.addInitScript(() => localStorage.setItem('ugc-tools.locale', 'zh-CN'));
  if (state.mockClipboard) await context.addInitScript(() => {
    window.__animationQaClipboard = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async text => { window.__animationQaClipboard.push(text); } },
    });
  });
  if (state.trackVideos) await context.addInitScript(() => {
    window.__animationQaVideos = [];
    const createElement = Document.prototype.createElement;
    Document.prototype.createElement = function (...args) {
      const element = createElement.apply(this, args);
      if (String(args[0]).toLowerCase() === 'video') window.__animationQaVideos.push(element);
      return element;
    };
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const asset = url.pathname.split('/ugc-tool-data/')[1];
    if (asset) {
      requests.push(asset);
      if (asset === 'AnimationViewer/data.json') {
        state.indexRequests = (state.indexRequests || 0) + 1;
        if (state.mode === 'missing') return route.fulfill({ status: 404, body: '' });
        if (state.mode === 'serverError') return route.fulfill({ status: 500, body: 'offline fixture failure' });
        if (state.mode === 'invalidJson') return route.fulfill({ contentType: 'application/json', body: '{' });
        if (state.mode === 'invalidSchema') return route.fulfill({ json: { data: [{}], category: [] } });
        if (state.mode === 'legacyContinuous') return route.fulfill({ json: {
          category: categories, data: [{ ...fixture.data[1], type: 'continuous' }],
        } });
        if (state.mode === 'legacySkillDuration') return route.fulfill({ json: {
          category: categories, data: [{ ...fixture.data[0], duration: 2.5 }],
        } });
        if (state.mode === 'legacyPhase') return route.fulfill({ json: {
          category: categories, data: [{ ...fixture.data[0], parts: [{ ...fixture.data[0].parts[0], phase: 'single' }] }],
        } });
        if (state.mode === 'missingPartType') return route.fulfill({ json: {
          category: categories, data: [{ ...fixture.data[0], parts: [{ path: 'qa/slash.webm' }] }],
        } });
        if (state.mode === 'invalidPartType') return route.fulfill({ json: {
          category: categories, data: [{ ...fixture.data[0], parts: [{ ...fixture.data[0].parts[0], type: 'combo' }] }],
        } });
        return route.fulfill({ json: state.mode === 'empty' ? { data: [], category: [] } : state.data || fixture });
      }
      if (/^AnimationViewer\/i18n\/[^/]+\.json$/u.test(asset)) return route.fulfill({ json: { ...dictionary, ...state.dictionary } });
      if (/^AnimationViewer\/qa\/.*\.webm$/u.test(asset)) {
        if (state.broken && !state.recovered) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ contentType: 'video/webm', body: media });
      }
      return route.fulfill({ status: 404, body: '' });
    }
    // Local code and HMR load normally; no external data or model services are contacted.
    if (url.origin !== new URL(base).origin || url.pathname.startsWith('/api/')) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => {
    if (!error.message.includes('ResizeObserver')) errors.push(error.message);
  });
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  return { context, page, errors, requests };
}

async function assertCount(page, selector, wanted) {
  await page.waitForFunction(({ selector, wanted }) => document.querySelectorAll(selector).length === wanted, { selector, wanted });
  assert.equal(await page.locator(selector).count(), wanted);
}

async function assertStats(page, _skills, parts) {
  await page.locator('.search-count').getByText(`共 ${parts} 段`, { exact: true }).waitFor();
  assert.equal(await page.locator('.library-stats').count(), 0, 'Totals appear in the search row without an extra statistics row');
}

async function scrollList(page, position) {
  await page.locator('.animation-virtual-list').evaluate((list, position) => {
    list.scrollTop = position === 'end' ? list.scrollHeight : position;
  }, position);
  await page.waitForTimeout(100);
}

// A virtual row may not exist in the DOM yet. Scroll the actual virtual-list
// viewport to find its stable catalog key before interacting with the locator.
async function visitSkill(page, key) {
  const skill = page.locator(`[data-animation-skill="${key}"]`);
  await page.locator('.animation-virtual-list').waitFor();
  await scrollList(page, 0);
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await skill.count()) {
      await skill.evaluate(element => {
        const list = document.querySelector('.animation-virtual-list');
        list.scrollTop += element.getBoundingClientRect().top - list.getBoundingClientRect().top - 12;
      });
      await page.waitForTimeout(100);
      if (await skill.count()) return skill;
    }
    const advanced = await page.locator('.animation-virtual-list').evaluate(list => {
      const previous = list.scrollTop;
      list.scrollTop += Math.max(100, list.clientHeight * 0.75);
      return list.scrollTop > previous;
    });
    await page.waitForTimeout(60);
    if (!advanced) break;
  }
  throw new Error(`Virtual skill ${key} was not reachable through the list scroller`);
}

async function assertVideoOptions(page) {
  const options = await page.locator('[data-animation-part] video').evaluateAll(videos => videos.map(video => ({
    muted: video.muted, loop: video.loop, inline: video.playsInline, controls: video.controls,
  })));
  assert.ok(options.length > 0);
  for (const option of options) assert.deepEqual(option, { muted: true, loop: true, inline: true, controls: false });
  assert.equal(await page.getByRole('button', { name: /^(?:播放|暂停|开始播放|暂停播放|Play|Pause)$/iu }).count(), 0);
}

async function assertPlaying(video) {
  await video.scrollIntoViewIfNeeded();
  await video.page().waitForFunction(element => element && element.readyState >= 2
    && !element.paused && element.currentTime > 0.08, await video.elementHandle());
}

async function verifyEmptyStates(browser, media) {
  for (const mode of ['missing', 'empty']) {
    const { context, page, errors } = await createPage(browser, media, { mode });
    try {
      await page.locator('.library-content[aria-busy="false"]').waitFor();
      await assertStats(page, 0, 0);
      await assertCount(page, '[data-animation-part]', 0);
      await assertCount(page, '[data-animation-skill]', 0);
      await assertCount(page, '.category-toggle, .version-filter, .empty-art', 0);
      assert.equal(await page.locator('video').count(), 0, 'No fabricated animation previews are created');
      assert.equal((await page.locator('.library-content').textContent()).trim(), '',
        'Missing and empty catalogs leave the content area blank');
      assert.equal(await page.getByRole('button', { name: '全部展开', exact: true }).isDisabled(), true);
      assert.deepEqual(errors, []);
      if (mode === 'empty') {
        await page.screenshot({ path: path.join(output, 'empty-desktop.png') });
        await page.setViewportSize({ width: 320, height: 760 });
        assert.equal((await page.locator('.library-content').textContent()).trim(), '');
        const dimensions = await page.evaluate(() => ({
          viewport: window.innerWidth, page: document.documentElement.scrollWidth,
        }));
        assert.ok(dimensions.page <= dimensions.viewport + 1, `320px page overflow: ${JSON.stringify(dimensions)}`);
        await page.screenshot({ path: path.join(output, 'empty-mobile-320.png'), fullPage: true });
      }
      record(`${mode === 'missing' ? '404 index' : 'Empty data and category arrays'}: blank content without default categories, version filter, illustrations or mock previews; total zero and expand-all disabled`);
    } finally { await context.close(); }
  }
}

async function verifyErrors(browser, media) {
  for (const mode of ['invalidSchema', 'invalidJson', 'legacyContinuous', 'legacySkillDuration', 'legacyPhase', 'missingPartType', 'invalidPartType', 'serverError']) {
    const state = { mode };
    const { context, page, errors } = await createPage(browser, media, state);
    try {
      await page.getByText(mode === 'serverError' ? '动画数据加载失败，请重试。' : '动画配置格式有误，请检查数据文件。', { exact: true }).waitFor();
      await assertCount(page, '[data-animation-part]', 0);
      state.mode = 'fixture';
      await page.getByRole('button', { name: '重试', exact: true }).click();
      await assertStats(page, 5, 13);
      await visitSkill(page, 0);
      assert.ok(state.indexRequests >= 2, 'Retry downloads the index again');
      assert.deepEqual(errors, []);
      record(`${mode}: distinct error state and successful retry`);
    } finally { await context.close(); }
  }
}

async function verifyCategoryOnly(browser, media) {
  const data = { data: [], category: [{ id: 42, nameI18nKey: 'animationViewer.category.qaEmpty' }] };
  const { context, page, errors, requests } = await createPage(browser, media, { mode: 'fixture', data });
  try {
    await page.locator('.library-content[aria-busy="false"]').waitFor();
    await assertStats(page, 0, 0);
    assert.ok(requests.includes('AnimationViewer/i18n/zh-cn.json'), 'Category-only catalogs still download resource translations');
    await assertCount(page, '.category-toggle, .version-filter, .empty-art', 0);
    await assertCount(page, '[data-animation-part]', 0);
    assert.equal((await page.locator('.library-content').textContent()).trim(), '');
    assert.equal(await page.getByText(dictionary['animationViewer.category.qaEmpty'], { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '全部展开', exact: true }).isDisabled(), true);
    await page.setViewportSize({ width: 320, height: 760 });
    const width = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
    assert.ok(width.page <= width.viewport + 1, `Category-only mobile overflow: ${JSON.stringify(width)}`);
    await page.screenshot({ path: path.join(output, 'category-only-mobile-320.png'), fullPage: true });
    assert.deepEqual(errors, []);
    record('Category definitions without animation data produce no category buttons, version filter or content at desktop and 320px');
  } finally { await context.close(); }
}

async function verifyCategoryColors(browser, media) {
  const state = { mode: 'fixture' };
  const { context, page, errors } = await createPage(browser, media, state);
  const palette = [
    { hex: '#5378c8', rgb: 'rgb(83, 120, 200)' },
    { hex: '#4c9a72', rgb: 'rgb(76, 154, 114)' },
    { hex: '#a66bb5', rgb: 'rgb(166, 107, 181)' },
    { hex: '#c46a62', rgb: 'rgb(196, 106, 98)' },
    { hex: '#a77c3d', rgb: 'rgb(167, 124, 61)' },
  ];
  const buttonColors = () => page.locator('.category-toggle').evaluateAll(buttons => buttons.map(button => ({
    id: Number(button.getAttribute('aria-controls').replace('animation-category-', '')),
    expanded: button.getAttribute('aria-expanded') === 'true',
    categoryColor: getComputedStyle(button).getPropertyValue('--category-color').trim(),
    border: getComputedStyle(button).borderLeftColor,
    background: getComputedStyle(button).backgroundColor,
    color: getComputedStyle(button).color,
    arrowColor: getComputedStyle(button.querySelector('.category-arrow')).color,
  })));
  const assertButtonColors = async () => {
    await page.mouse.move(0, 0);
    const colors = await buttonColors();
    assert.equal(colors.length, palette.length);
    for (const color of colors) {
      assert.equal(color.categoryColor, '', `Category ${color.id} has no per-category button color`);
      assert.equal(color.border, `rgba(106, 90, 205, ${color.expanded ? '0.55' : '0.2'})`,
        `Category ${color.id} uses the BGM default border for its expansion state`);
      assert.equal(color.background, `rgba(106, 90, 205, ${color.expanded ? '0.14' : '0.04'})`,
        `Category ${color.id} uses the BGM default background for its expansion state`);
      assert.equal(color.arrowColor, color.color, `Category ${color.id} arrow inherits the button text color`);
      assert.ok(!palette.some(entry => entry.rgb === color.arrowColor), 'Arrows do not use category frame colors');
    }
  };
  const assertFrameColors = async keys => {
    for (const key of keys) {
      const expected = palette[key];
      const skill = await visitSkill(page, key);
      const colors = await skill.locator('xpath=ancestor::fieldset').evaluate(frame => ({
        border: getComputedStyle(frame).borderLeftColor,
        legend: getComputedStyle(frame.querySelector('legend')).color,
        variable: getComputedStyle(frame).getPropertyValue('--category-color').trim(),
      }));
      assert.deepEqual(colors, { border: expected.rgb, legend: expected.rgb, variable: expected.hex },
        `Category ${key + 1} frame and legend share its fixed color`);
    }
  };
  try {
    await assertStats(page, 5, 13);
    await assertButtonColors();
    await assertFrameColors([0, 1, 2, 3, 4]);
    await page.getByRole('searchbox').fill('验证持续引导');
    await assertStats(page, 1, 3);
    await assertButtonColors();
    await assertFrameColors([1]);
    await page.locator('select.version-filter').selectOption('6.1');
    await assertStats(page, 1, 3);
    await assertButtonColors();
    await assertFrameColors([1]);
    const toggle = page.locator('.category-toggle[aria-controls="animation-category-2"]');
    await toggle.click();
    await assertCount(page, '[data-animation-category="2"]', 0);
    await assertButtonColors();
    await toggle.click();
    await visitSkill(page, 1);
    await assertButtonColors();
    await assertFrameColors([1]);
    state.data = { ...fixture, category: [...categories].reverse() };
    await page.reload({ waitUntil: 'domcontentloaded' });
    await assertStats(page, 5, 13);
    await assertButtonColors();
    assert.deepEqual((await buttonColors()).map(category => category.id), [5, 4, 3, 2, 1]);
    await assertFrameColors([4, 3, 2, 1, 0]);
    await page.screenshot({ path: path.join(output, 'default-buttons-colored-frames.png') });
    assert.deepEqual(errors, []);
    record('All category buttons use BGM default expanded/collapsed colors and inherited arrow colors; list frame/legend colors remain fixed by ID through search, version filtering, collapse, reload and category reordering');
  } finally { await context.close(); }
}

async function verifyBgmToolbar(browser, media) {
  const { context, page, errors } = await createPage(browser, media, { mode: 'fixture' });
  try {
    await assertStats(page, 5, 13);
    const version = page.locator('select.version-filter');
    await version.waitFor({ state: 'visible' });
    assert.deepEqual(await version.locator('option').allTextContents(), ['全部版本', '6.1', '6.0'],
      'Versions come from skill metadata and sort newest first without inventing a version for older entries');
    assert.equal(await page.locator('.speed-control, select.playback-speed, #animation-speed').count(), 0,
      'The animation page contains no playback-speed controls');
    assert.equal(await page.locator('.duration-filter').count(), 0, 'No duration filter is added');
    const layout = await page.evaluate(() => {
      const rect = selector => {
        const bounds = document.querySelector(selector).getBoundingClientRect();
        return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right };
      };
      return {
        search: rect('#animation-search'), count: rect('.search-count'), all: rect('.toggle-all'),
        categories: rect('.category-controls'), version: rect('.version-filter'),
        labels: [...document.querySelectorAll('.category-toggle')].map(button => ({
          titleRight: button.querySelector('.category-title').getBoundingClientRect().right,
          countLeft: button.querySelector('.category-count').getBoundingClientRect().left,
          count: button.querySelector('.category-count').textContent.trim(),
        })),
      };
    });
    assert.ok(layout.count.top < layout.search.bottom && layout.count.bottom > layout.search.top,
      'The total stays in the search row');
    assert.ok(layout.all.left > layout.count.right, 'Expand/collapse sits after the total');
    assert.ok(layout.categories.top >= layout.search.bottom, 'Categories occupy the second row');
    assert.ok(layout.version.top < layout.categories.bottom && layout.version.bottom > layout.categories.top,
      'The version selector shares the category row');
    assert.deepEqual(layout.labels.map(label => label.count), ['1', '3', '3', '1', '5']);
    for (const label of layout.labels) assert.ok(label.countLeft - label.titleRight >= 0
      && label.countLeft - label.titleRight <= 12, 'Category counts remain adjacent to the category name');

    const channelToggle = page.locator('.category-toggle[aria-controls="animation-category-2"]');
    await channelToggle.click();
    await page.getByRole('button', { name: '全部展开', exact: true }).waitFor();
    await assertStats(page, 5, 13);
    await page.getByRole('button', { name: '全部展开', exact: true }).click();
    assert.equal(await channelToggle.getAttribute('aria-expanded'), 'true');
    await page.getByRole('button', { name: '全部收起', exact: true }).waitFor();
    await assertStats(page, 5, 13);
    record('BGM-style search/total/expand row and category/version row; numeric category counts sit next to names; partial collapse can expand all without changing totals');
    await page.screenshot({ path: path.join(output, 'bgm-toolbar-desktop.png') });

    await version.selectOption('6.1');
    await assertStats(page, 2, 8);
    assert.deepEqual(await page.locator('.category-count').allTextContents().then(values => values.map(value => value.trim())),
      ['0', '3', '0', '0', '5']);
    for (const key of [1, 4]) {
      const skill = await visitSkill(page, key);
      assert.equal(await skill.locator('[data-animation-part]').count(), fixture.data[key].parts.length,
        'A version filter preserves every part of the matching skill');
    }
    await page.getByRole('searchbox').fill('验证下劈');
    await assertStats(page, 1, 5);
    await assertCount(page, '[data-animation-skill]', 1);
    await assertCount(page, '[data-animation-part]', 5);
    await version.selectOption('6.0');
    await assertStats(page, 0, 0);
    await page.getByText('未找到匹配的动画', { exact: true }).waitFor();
    await page.getByRole('searchbox').fill('');
    await assertStats(page, 2, 2);
    await version.selectOption('');
    await assertStats(page, 5, 13);
    await visitSkill(page, 2);
    assert.equal(await page.locator('[data-animation-skill="2"] [data-animation-part]').count(), 3,
      'All versions includes skills whose metadata has no version');
    record('Skill version and part-name search filters combine correctly, retain complete combos, update totals/categories, and keep unspecified versions in the full catalog');

    await page.setViewportSize({ width: 320, height: 760 });
    for (const selector of ['#animation-search', '.search-count', '.toggle-all', '.version-filter']) {
      const control = page.locator(selector);
      assert.equal(await control.isVisible(), true, `Mobile toolbar control ${selector} is visible`);
      const bounds = await control.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 321,
        `Mobile toolbar control ${selector} fits within the viewport: ${JSON.stringify(bounds)}`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: path.join(output, 'bgm-toolbar-mobile-320.png'), fullPage: true });
    assert.deepEqual(errors, []);
    record('At 320px the search, total, expand-all and version controls remain visible without horizontal overflow');
  } finally { await context.close(); }
}

async function verifyLibrary(browser, media) {
  const { context, page, errors, requests } = await createPage(browser, media, { mode: 'fixture' });
  try {
    await assertStats(page, 5, 13);
    for (const [index, expected] of fixture.data.entries()) {
      const skill = await visitSkill(page, index);
      assert.equal(await skill.getAttribute('data-animation-type'), expected.type);
      assert.equal(await skill.locator('[data-animation-part]').count(), expected.parts.length);
      assert.equal(await skill.locator('xpath=ancestor::fieldset').getAttribute('data-animation-category'), String(expected.category));
    }
    const channelSkill = await visitSkill(page, 1);
    const channel = channelSkill.locator('xpath=ancestor::fieldset');
    await channelSkill.getByRole('heading', { name: '验证持续引导', exact: true }).waitFor();
    assert.equal(await channel.evaluate(element => element.tagName), 'FIELDSET');
    assert.deepEqual(await channel.locator('[data-animation-part-type]').evaluateAll(parts => parts.map(part => part.dataset.animationPartType)), ['single', 'continuous', 'single']);
    assert.equal(await channel.locator('[data-animation-skill][data-animation-type="combo"]').count(), 1,
      'All three stages belong to the same combo skill');
    assert.deepEqual(await channel.locator('.part-name').allTextContents(), ['前摇', '持续', '后摇'],
      'Three separately named parts are grouped under the same skill');
    for (const name of ['前摇', '持续', '后摇']) assert.equal(await channel.locator('.part-name').getByText(name, { exact: true }).isVisible(), true);
    const mixedCombo = await visitSkill(page, 4);
    assert.deepEqual(await mixedCombo.locator('[data-animation-part-type]').evaluateAll(parts => parts.map(part => part.dataset.animationPartType)),
      ['single', 'single', 'continuous', 'single', 'single'], 'Mixed individual part types retain their configured order');
    assert.deepEqual(await mixedCombo.locator('.part-name').allTextContents(), ['验证上挑', '验证蓄力', '持续', '验证下劈', '后摇'],
      'Every combo part uses its configured name');
    assert.equal(await page.locator('[data-animation-phase]').count(), 0, 'Legacy phase metadata is no longer rendered');
    await visitSkill(page, 1);
    const boundary = await channel.evaluate(element => ({
      color: getComputedStyle(element).borderLeftColor,
      width: Number.parseFloat(getComputedStyle(element).borderLeftWidth),
    }));
    assert.ok(boundary.width > 0 && boundary.color !== 'rgba(0, 0, 0, 0)', 'Category has a visible boundary');
    assert.equal(await page.locator('[data-animation-skill][data-animation-id], [data-animation-skill][data-skill-id]').count(), 0);
    await assertVideoOptions(page);
    await assertPlaying(channel.locator('video').first());
    const singleSkill = await visitSkill(page, 0);
    await singleSkill.getByText('2.5 秒', { exact: true }).waitFor();
    assert.equal(await singleSkill.locator('[data-part-duration]').getAttribute('data-part-duration'), '2.5');
    const singleVideo = singleSkill.locator('video');
    await assertPlaying(singleVideo);
    assert.ok(Math.abs(await singleVideo.evaluate(video => video.duration) - 2) < 0.2, 'Test video is approximately 2 seconds long');
    assert.equal((await singleSkill.locator('.part-meta').textContent()).trim(), '2.5 秒',
      'A 2-second video shows its separately configured 2.5-second actual part duration');
    await visitSkill(page, 1);
    assert.equal(await channel.locator('.skill-heading [data-part-duration]').count(), 0, 'The parent skill has no duration');
    for (const [index, duration] of [[0, '0.4'], [1, '4.2'], [2, '0.6']]) {
      const card = channel.locator('[data-animation-part]').nth(index);
      assert.equal(await card.locator('[data-part-duration]').getAttribute('data-part-duration'), duration);
      await card.getByText(`${duration} 秒`, { exact: true }).waitFor();
    }
    const continuousCard = channel.locator('[data-animation-part-type="continuous"]');
    await continuousCard.getByText('循环 ↻', { exact: true }).waitFor();
    await continuousCard.getByText('4.2 秒', { exact: true }).waitFor();
    const aimSkill = await visitSkill(page, 3);
    const unknownContinuous = aimSkill.locator('[data-animation-part]');
    assert.equal(await unknownContinuous.getAttribute('data-animation-part-type'), 'continuous',
      'A single-structure skill may contain a continuous part');
    await unknownContinuous.getByText('循环 ↻', { exact: true }).waitFor();
    await assertPlaying(unknownContinuous.locator('video'));
    assert.equal(await unknownContinuous.locator('[data-part-duration]').count(), 0);
    for (const index of [2, 3, 4]) {
      const skill = await visitSkill(page, index);
      assert.equal(await skill.locator('[data-part-duration]').count(), 0, 'Missing actual part durations are not inferred after media loads');
      assert.equal(await skill.locator('.part-meta').filter({ hasText: /\d+(?:\.\d+)?\s*秒/u }).count(), 0,
        'Unknown durations show no video-duration fallback');
    }
    await visitSkill(page, 0);
    const namePlacement = await page.locator('[data-animation-part="0:0"]').evaluate(part => {
      const name = part.querySelector('.part-name');
      const preview = part.querySelector('.preview-open');
      return { count: part.querySelectorAll('.part-name').length,
        nameTop: name?.getBoundingClientRect().top,
        previewBottom: preview?.getBoundingClientRect().bottom };
    });
    assert.equal(namePlacement.count, 1, 'Each animation has one visible name');
    assert.ok(namePlacement.nameTop >= namePlacement.previewBottom - 1, 'The animation name sits below its preview');
    record('Five framed categories; independent skill/part types; explicitly named stages share one combo; every part automatically plays and loops');
    record('Actual durations belong to each part and remain independent from video duration; continuous markers coexist with known or unknown actual duration');

    const toggle = page.locator('.category-toggle[aria-controls="animation-category-2"]');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await toggle.click();
    await assertCount(page, '[data-animation-category="2"]', 0);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await visitSkill(page, 0);
    assert.ok(await page.locator('[data-animation-category="1"]').count() > 0);
    await toggle.click();
    await visitSkill(page, 1);
    assert.ok(await page.locator('[data-animation-category="2"]').count() > 0);
    await page.getByRole('button', { name: '全部收起', exact: true }).click();
    await assertCount(page, '[data-animation-category]', 0);
    assert.equal(await page.locator('.category-toggle').count(), 5);
    await page.getByRole('button', { name: '全部展开', exact: true }).click();
    await assertStats(page, 5, 13);
    for (let index = 0; index < fixture.data.length; index++) await visitSkill(page, index);
    record('Independent and all-category collapse removes the entire category frame and restores it');

    const search = page.getByRole('searchbox');
    await search.fill('验证持续引导');
    await assertCount(page, '[data-animation-skill]', 1);
    await assertCount(page, '[data-animation-part]', 3);
    await search.fill('验证下劈');
    await page.locator('[data-animation-type="combo"]').waitFor();
    assert.equal(await page.locator('[data-animation-type="single"]').count(), 0);
    await assertCount(page, '[data-animation-skill]', 1);
    await assertCount(page, '[data-animation-part]', 5);
    await search.fill('不存在的验证动作');
    await page.getByText('未找到匹配的动画', { exact: true }).waitFor();
    await search.fill('');
    await assertStats(page, 5, 13);
    record('Search matches skill names and individual part names, with a no-result state');

    await visitSkill(page, 0);
    await page.locator('[data-animation-category="1"] .preview-open').first().click();
    const dialog = page.locator('dialog.animation-preview-dialog');
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await dialog.evaluate(element => element.open), true);
    const expandedVideo = dialog.locator('video');
    await assertPlaying(expandedVideo);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-animation-part] video')].every(video => video.paused));
    assert.equal(await page.locator('.speed-control, select.playback-speed, #animation-speed').count(), 0,
      'Cards and the enlarged preview contain no playback-speed controls');
    assert.equal(await expandedVideo.evaluate(video => video.muted && video.autoplay && video.loop && !video.controls && video.playbackRate === 1), true,
      'The enlarged preview automatically loops at its native rate');
    await page.screenshot({ path: path.join(output, 'preview-dialog.png') });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await assertPlaying(page.locator('[data-animation-category="1"] video').first());
    assert.equal(await page.locator('[data-animation-part] video').evaluateAll(videos => videos.every(video => video.playbackRate === 1)), true,
      'Cards resume at their native rate after closing the enlarged preview');
    assert.equal((await singleSkill.locator('.part-meta').textContent()).trim(), '2.5 秒');
    await visitSkill(page, 1);
    assert.equal(await continuousCard.getByText('4.2 秒', { exact: true }).count(), 1,
      'Opening and closing the preview preserves configured actual part durations');
    record('Cards and the enlarged preview automatically play at their native rate without speed controls; closing the dialog resumes cards and preserves actual part durations');

    await visitSkill(page, 1);
    await page.screenshot({ path: path.join(output, 'grouped-library.png') });
    await page.setViewportSize({ width: 320, height: 760 });
    await visitSkill(page, 1);
    const mobile = await page.evaluate(() => ({
      viewport: innerWidth,
      page: document.documentElement.scrollWidth,
      containers: [...document.querySelectorAll('.animation-browser, .library-content, .animation-virtual-list')]
        .map(element => ({ width: element.clientWidth, content: element.scrollWidth })),
    }));
    assert.ok(mobile.page <= mobile.viewport + 1, `Filled 320px page overflow: ${JSON.stringify(mobile)}`);
    for (const box of mobile.containers) assert.ok(box.content <= box.width + 1, `Filled mobile library overflow: ${JSON.stringify(mobile)}`);
    for (const [index, name] of ['前摇', '持续', '后摇'].entries()) {
      const part = page.locator(`[data-animation-part="1:${index}"]`);
      assert.equal(await part.isVisible(), true, `Mobile ${name} remains independently rendered`);
      await part.scrollIntoViewIfNeeded();
      const bounds = await part.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 321, `Mobile ${name} stays within the viewport`);
    }
    await page.screenshot({ path: path.join(output, 'filled-mobile-320.png'), fullPage: true });
    record('Populated 320px layout has no horizontal overflow and keeps all three combo stages accessible');
    assert.ok(requests.includes('AnimationViewer/i18n/zh-cn.json'), 'Resource names load from the selected language dictionary');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function verifyCopyName(browser, media) {
  const data = { category: categories.slice(0, 2), data: fixture.data.slice(0, 2) };
  const { context, page, errors } = await createPage(browser, media, { mode: 'fixture', data, mockClipboard: true });
  try {
    await assertStats(page, 2, 4);
    const dialog = page.locator('dialog.animation-preview-dialog');
    let copied = 0;
    async function copyName(button, expected, key) {
      assert.equal((await button.textContent()).trim(), expected, 'Copy uses the name shown in the selected language');
      assert.equal(await button.getAttribute('title'), `复制动画名称：${expected}`);
      assert.equal(await button.getAttribute('aria-label'), `复制动画名称：${expected}`);
      if (key) {
        await button.focus();
        await page.keyboard.press(key);
      } else await button.click();
      copied++;
      await page.waitForFunction(count => window.__animationQaClipboard.length === count, copied);
      assert.equal(await page.evaluate(() => window.__animationQaClipboard.at(-1)), expected,
        'Clipboard receives the exact displayed name without an i18n key or duration');
      await page.getByText(`${expected} 复制成功`, { exact: true }).last().waitFor({ state: 'visible' });
    }

    const single = page.locator('[data-animation-skill="0"]');
    const singleVideo = single.locator('video');
    await assertPlaying(singleVideo);
    await copyName(single.locator('.part-name.copy-name'), '验证横斩');
    assert.equal(await dialog.evaluate(element => element.open), false, 'Clicking a card name does not open the preview');
    assert.equal(await singleVideo.evaluate(video => video.paused), false, 'Copying a card name keeps playback running');

    const combo = page.locator('[data-animation-skill="1"]');
    const comboVideo = combo.locator('[data-animation-part="1:1"] video');
    await assertPlaying(comboVideo);
    await copyName(combo.locator('[data-animation-part="1:1"] .part-name.copy-name'), '持续');
    await copyName(combo.locator('.skill-heading .copy-name'), '验证持续引导', 'Enter');
    await copyName(combo.locator('[data-animation-part="1:0"] .part-name.copy-name'), '前摇', 'Space');
    assert.equal(await dialog.evaluate(element => element.open), false, 'Part and group name buttons remain separate from preview buttons');
    assert.equal(await comboVideo.evaluate(video => video.paused), false, 'Mouse and keyboard copying keep the combo playing');

    await combo.locator('[data-animation-part="1:1"] .preview-open').click();
    await dialog.waitFor({ state: 'visible' });
    await assertPlaying(dialog.locator('video'));
    await copyName(dialog.locator('.preview-heading .copy-name'), '验证持续引导 · 持续');
    assert.equal(await dialog.evaluate(element => element.open), true, 'Copying the enlarged name leaves its dialog open');
    assert.equal(await dialog.locator('video').evaluate(video => video.paused), false, 'Copying the enlarged name leaves playback running');
    assert.equal(await page.locator('[data-animation-part] video').evaluateAll(videos => videos.every(video => video.paused)), true,
      'Copying inside the modal preserves background video suspension');
    await page.screenshot({ path: path.join(output, 'copy-name-modal.png') });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await assertPlaying(comboVideo);
    assert.deepEqual(await page.evaluate(() => window.__animationQaClipboard), [
      '验证横斩', '持续', '验证持续引导', '前摇', '验证持续引导 · 持续',
    ]);
    assert.deepEqual(errors, []);
    record('Name buttons copy exact localized single, combo part, group, and enlarged names with shared success toasts; mouse, Enter, and Space preserve preview and playback state');
  } finally { await context.close(); }
}

async function verifyMediaRecovery(browser, media) {
  const state = { mode: 'fixture', broken: true, data: { category: [categories[0]], data: [fixture.data[0]] } };
  const { context, page, errors } = await createPage(browser, media, state);
  try {
    await page.getByText('动画预览加载失败', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^(?:播放|暂停|Play|Pause)$/iu }).count(), 0);
    const retry = page.getByRole('button', { name: '重新加载预览', exact: true });
    await retry.waitFor();
    state.recovered = true;
    await retry.click();
    await assertPlaying(page.locator('[data-animation-part] video'));
    await page.getByText('动画预览加载失败', { exact: true }).waitFor({ state: 'hidden' });
    await assertVideoOptions(page);
    assert.deepEqual(errors, []);
    record('Unavailable media shows a reload action and resumes automatic playback after recovery');
  } finally { await context.close(); }
}

async function verifyScrollVisiblePlayback(browser, media) {
  const data = {
    category: [categories[0]],
    data: Array.from({ length: 48 }, (_, index) => ({
      type: 'single', category: 1, nameI18nKey: 'animationViewer.skills.qaSlash', order: index,
      parts: [{ type: 'single', path: `qa/scroll-${index}.webm` }],
    })),
  };
  const { context, page, errors, requests } = await createPage(browser, media, { mode: 'fixture', data }, { width: 1280, height: 900 });
  try {
    await assertStats(page, data.data.length, data.data.length);
    await visitSkill(page, 0);
    await assertPlaying(page.locator('[data-animation-part]').first().locator('video'));
    // Pick a real card just below the scrolling container, independent of column count.
    const preloadedIndex = await page.waitForFunction(() => {
      const library = document.querySelector('.animation-virtual-list');
      if (!library) return false;
      const viewport = library.getBoundingClientRect();
      const cards = [...document.querySelectorAll('[data-animation-part]')];
      const card = cards.find(card => {
        const host = card.querySelector('.animation-media');
        const bounds = host?.getBoundingClientRect();
        const video = host?.querySelector('video');
        return bounds && bounds.top >= viewport.bottom + 2 && bounds.top < viewport.bottom + 240
          && video && video.preload === 'auto' && video.paused && video.readyState >= 2;
      });
      return card ? { key: card.dataset.animationPart } : false;
    });
    const { key } = await preloadedIndex.jsonValue();
    await preloadedIndex.dispose();
    const firstVideo = await page.locator('[data-animation-part]').first().locator('video').elementHandle();
    assert.ok(firstVideo, 'First visible video is mounted');
    await page.waitForFunction(video => video && !video.paused && video.currentTime > 0.3, firstVideo);
    const initialSource = await firstVideo.evaluate(video => video.currentSrc);
    const firstAsset = 'AnimationViewer/qa/scroll-0.webm';
    const initialRequests = requests.filter(asset => asset === firstAsset).length;
    assert.ok(initialRequests > 0, 'Initial first-card media request is intercepted');
    const preloadedCard = page.locator(`[data-animation-part="${key}"]`);
    const preloadedVideo = await preloadedCard.locator('video').elementHandle();
    assert.ok(preloadedVideo, 'Upcoming card has a prepared video before becoming visible');
    assert.equal(await preloadedVideo.evaluate(video => video.paused), true, 'Preloading does not start offscreen playback');

    // Move the upcoming card to the top of the actual library scroller, leaving
    // the first card outside the 240px preload region without loading 48 videos.
    await preloadedCard.evaluate(card => {
      const library = document.querySelector('.animation-virtual-list');
      library.scrollTop += card.getBoundingClientRect().top - library.getBoundingClientRect().top - 16;
    });
    await page.waitForFunction(video => video && !video.paused && video.currentTime > 0.08, preloadedVideo);
    await page.waitForFunction(video => video && video.paused, firstVideo);
    assert.equal(await preloadedCard.locator('video').evaluate((video, original) => video === original, preloadedVideo), true,
      'An upcoming card starts the already prepared video when it becomes visible');
    const pausedTime = await firstVideo.evaluate(video => video.currentTime);
    // The former implementation destroyed a video 1500ms after leaving view.
    // Stay out longer than that exact regression threshold, then check reuse.
    await page.waitForTimeout(1750);
    assert.equal(await firstVideo.evaluate(video => video.paused), true,
      'Offscreen media remains paused in its mounted host or bounded reuse pool');
    assert.ok(Math.abs(await firstVideo.evaluate(video => video.currentTime) - pausedTime) < 0.005,
      'The paused offscreen video does not keep advancing');
    await firstVideo.evaluate(video => {
      video.addEventListener('play', () => { video.dataset.qaResumeTime = String(video.currentTime); }, { once: true });
    });
    await scrollList(page, 0);
    await page.waitForFunction(video => video && !video.paused && video.currentTime > 0.08, firstVideo);
    assert.equal(await page.locator('[data-animation-part]').first().locator('video').evaluate((video, original) => video === original, firstVideo), true,
      'Returning to a recently viewed card reuses its video DOM node');
    assert.equal(await firstVideo.evaluate(video => video.currentSrc), initialSource,
      'Returning to a recently viewed card preserves its media source');
    await page.waitForFunction(video => video.dataset.qaResumeTime !== undefined, firstVideo);
    assert.ok(Math.abs(await firstVideo.evaluate(video => Number(video.dataset.qaResumeTime)) - pausedTime) < 0.08,
      'Returning to view resumes from the paused position instead of restarting');
    assert.equal(requests.filter(asset => asset === firstAsset).length, initialRequests,
      'Returning to a recently viewed card does not request the media again');
    await scrollList(page, 'end');
    const lastCard = page.locator(`[data-animation-part="${data.data.length - 1}:0"]`);
    await lastCard.waitFor();
    await lastCard.scrollIntoViewIfNeeded();
    await assertPlaying(lastCard.locator('video'));
    const mounted = await page.locator('[data-animation-part] video').count();
    assert.ok(mounted < data.data.length, `Scrolling does not mount the entire library (${mounted}/${data.data.length})`);
    await page.waitForFunction(video => video && video.paused, firstVideo);
    assert.equal(await firstVideo.evaluate(video => video.paused), true,
      'The first video remains paused after scrolling to the end of the library');
    assert.equal(await page.locator('[data-animation-skill="0"]').count(), 0,
      'The initial card is unmounted when outside the virtual-list window');
    assert.equal(await firstVideo.evaluate(video => video.isConnected), false,
      'Unmounted media is detached into the reuse pool instead of retaining all card DOM');
    await lastCard.locator('.preview-open').click();
    const dialog = page.locator('dialog.animation-preview-dialog');
    await dialog.waitFor({ state: 'visible' });
    await assertPlaying(dialog.locator('video'));
    await page.waitForFunction(() => [...document.querySelectorAll('[data-animation-part] video')].every(video => video.paused));
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await assertPlaying(lastCard.locator('video'));
    assert.equal(await firstVideo.evaluate(video => video.paused), true,
      'Closing the enlarged preview leaves the offscreen first card paused');
    assert.equal(await preloadedVideo.evaluate(video => video.paused), true,
      'Closing the enlarged preview leaves previously viewed offscreen cards paused');
    record('Virtual scroll preloads without playing; offscreen cards pause, cached videos resume with the same node/source/time without another request, and only visible cards resume after modal close');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, 'scroll-visible-playback.png') });
  } finally { await context.close(); }
}

async function verifyCollapseCachedPlayback(browser, media) {
  const data = { category: categories.slice(0, 2), data: fixture.data.slice(0, 2) };
  const { context, page, errors, requests } = await createPage(browser, media, { mode: 'fixture', data });
  const samples = [];
  try {
    await assertStats(page, 2, 4);
    const card = page.locator('[data-animation-part="0:0"]');
    await assertPlaying(card.locator('video'));
    await page.waitForFunction(() => [...document.querySelectorAll('[data-animation-part] video')]
      .length === 4 && [...document.querySelectorAll('[data-animation-part] video')]
      .every(video => video.readyState >= 2));
    const original = await card.locator('video').elementHandle();
    assert.ok(original, 'The first card has a ready video before collapsing');
    await page.waitForFunction(video => video.currentTime >= 0.3, original);
    const initialSource = await original.evaluate(video => video.currentSrc);
    const initialRequests = requests.filter(asset => asset.endsWith('.webm')).length;
    assert.equal(initialRequests, 4, 'All four fixture videos are already loaded');
    await page.evaluate(video => {
      const probe = { phase: '', frames: [], events: [], stopped: false };
      window.__animationCollapseProbe = probe;
      for (const event of ['loadstart', 'emptied', 'loadedmetadata']) {
        video.addEventListener(event, () => probe.events.push({ phase: probe.phase, event }));
      }
      function frame() {
        if (probe.stopped) return;
        const host = document.querySelector('[data-animation-part="0:0"] .animation-media');
        const bounds = host?.getBoundingClientRect();
        const library = document.querySelector('.animation-virtual-list')?.getBoundingClientRect();
        if (host && library && bounds.bottom > library.top && bounds.top < library.bottom) {
          probe.frames.push({ phase: probe.phase, mounted: Boolean(host.querySelector('video')),
            loading: [...host.querySelectorAll('.media-status')].some(status => status.textContent.includes('加载')) });
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }, original);

    const category = page.locator('.category-toggle[aria-controls="animation-category-1"]');
    for (const kind of ['category', 'all']) {
      await page.evaluate(kind => { window.__animationCollapseProbe.phase = `${kind}-collapse`; }, kind);
      if (kind === 'category') await category.click();
      else await page.getByRole('button', { name: '全部收起', exact: true }).click();
      await card.waitFor({ state: 'detached' });
      assert.equal(await original.evaluate(video => video.isConnected), false,
        `${kind} collapse detaches the video into the reuse pool`);
      assert.equal(await original.evaluate(video => video.paused), true,
        `${kind} collapse pauses the retained video`);
      const pausedTime = await original.evaluate(video => video.currentTime);
      await original.evaluate(video => {
        delete video.dataset.qaCollapseResumeTime;
        video.addEventListener('play', () => { video.dataset.qaCollapseResumeTime = String(video.currentTime); }, { once: true });
      });
      await page.waitForTimeout(80);
      await page.evaluate(kind => { window.__animationCollapseProbe.phase = `${kind}-expand`; }, kind);
      if (kind === 'category') await category.click();
      else await page.getByRole('button', { name: '全部展开', exact: true }).click();
      await assertPlaying(card.locator('video'));
      await page.waitForFunction(video => video.dataset.qaCollapseResumeTime !== undefined, original);
      await page.waitForFunction(kind => window.__animationCollapseProbe.frames
        .filter(frame => frame.phase === `${kind}-expand`).length >= 3, kind);
      assert.equal(await card.locator('video').evaluate((video, original) => video === original, original), true,
        `${kind} expansion reuses the previously ready video node`);
      assert.equal(await original.evaluate(video => video.currentSrc), initialSource,
        `${kind} expansion preserves the media source`);
      assert.ok(Math.abs(await original.evaluate(video => Number(video.dataset.qaCollapseResumeTime)) - pausedTime) < 0.08,
        `${kind} expansion resumes at the saved position`);
      assert.equal(requests.filter(asset => asset.endsWith('.webm')).length, initialRequests,
        `${kind} expansion does not request any previously loaded fixture media again`);
      const frames = await page.evaluate(kind => window.__animationCollapseProbe.frames
        .filter(frame => frame.phase === `${kind}-expand`), kind);
      samples.push({ kind, pausedTime, resumeTime: await original.evaluate(video => Number(video.dataset.qaCollapseResumeTime)), frames });
      // Vue can create and remove the initial loading VNode during one mount.
      // Only a requestAnimationFrame sample represents a paint opportunity.
      assert.ok(frames.every(frame => frame.mounted && !frame.loading),
        `${kind} expansion displays the cached video without a painted loading placeholder: ${JSON.stringify(frames)}`);
    }
    const reloadEvents = await page.evaluate(() => {
      window.__animationCollapseProbe.stopped = true;
      return window.__animationCollapseProbe.events;
    });
    assert.deepEqual(reloadEvents, [], 'Cached category expansion never restarts media loading');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'collapse-cached-playback.json'), JSON.stringify(samples, null, 2));
    record('Category and all-category expansion reuse ready videos and saved playback positions without new requests or a painted loading placeholder');
  } finally { await context.close(); }
}

async function verifyLargeVirtualLibrary(browser, media) {
  const names = {};
  const data = { category: categories, data: [] };
  for (let index = 0; index < 240; index++) {
    const nameI18nKey = `animationViewer.skills.qaLarge${index}`;
    names[nameI18nKey] = `大目录动作 ${index}`;
    data.data.push({ type: 'single', category: Math.floor(index / 80) + 1, nameI18nKey,
      parts: [{ type: 'single', path: `qa/large-${index}.webm`, duration: 0.75 }] });
  }
  for (let index = 240; index < 244; index++) {
    const nameI18nKey = `animationViewer.skills.qaLarge${index}`;
    names[nameI18nKey] = `大目录组合 ${index}`;
    data.data.push({ ...fixture.data[1], category: index < 242 ? 4 : 5, nameI18nKey,
      parts: fixture.data[1].parts.map((part, partIndex) => ({ ...part, path: `qa/large-${index}-${partIndex}.webm` })) });
  }
  const partCount = data.data.reduce((count, skill) => count + skill.parts.length, 0);
  const { context, page, errors } = await createPage(browser, media,
    { mode: 'fixture', data, dictionary: names, trackVideos: true }, { width: 1280, height: 900 });
  const samples = [];
  async function sample(label) {
    const snapshot = await page.evaluate(label => ({
      label,
      skills: document.querySelectorAll('[data-animation-skill]').length,
      parts: document.querySelectorAll('[data-animation-part]').length,
      rows: document.querySelectorAll('[data-animation-row]').length,
      mountedVideos: document.querySelectorAll('[data-animation-part] video').length,
      sources: window.__animationQaVideos.filter(video => video.getAttribute('src')).length,
      scrollTop: document.querySelector('.animation-virtual-list')?.scrollTop,
      scrollHeight: document.querySelector('.animation-virtual-list')?.scrollHeight,
    }), label);
    samples.push(snapshot);
    assert.ok(snapshot.skills > 0 && snapshot.skills < 80,
      `Virtual-list DOM stays well below the 244-skill catalog: ${JSON.stringify(snapshot)}`);
    assert.ok(snapshot.parts < 90, `Only nearby part cards are mounted: ${JSON.stringify(snapshot)}`);
    assert.ok(snapshot.rows > 0 && snapshot.rows < 30, `Only nearby rows are mounted: ${JSON.stringify(snapshot)}`);
    assert.ok(snapshot.sources <= snapshot.mountedVideos + 64,
      `Retained video sources fit the mounted window plus the bounded 64-video pool: ${JSON.stringify(snapshot)}`);
    await assertStats(page, data.data.length, partCount);
    return snapshot;
  }
  try {
    await assertStats(page, 244, partCount);
    await visitSkill(page, 0);
    await assertPlaying(page.locator('[data-animation-part="0:0"] video'));
    await sample('initial');
    const firstRow = page.locator('[data-animation-category="1"].group-first');
    assert.equal(await firstRow.locator('legend').count(), 1, 'Category label appears only on its first virtual row');
    for (let step = 0; step < 160; step++) {
      const moved = await page.locator('.animation-virtual-list').evaluate(list => {
        const old = list.scrollTop;
        list.scrollTop += list.clientHeight * 0.9;
        return list.scrollTop > old;
      });
      await page.waitForTimeout(80);
      if (step % 5 === 0 || !moved) await sample(`down-${step}`);
      if (!moved) break;
    }
    await scrollList(page, 'end');
    const lastSkill = page.locator('[data-animation-skill="243"]');
    await lastSkill.waitFor();
    await sample('end');
    assert.equal(await page.locator('[data-animation-skill="0"]').count(), 0);
    assert.equal(await lastSkill.locator('[data-animation-part]').count(), 3, 'The final combo retains all stages in one mounted skill');
    assert.equal(await page.locator('[data-animation-category="5"].group-last').count(), 1,
      'The last category row retains its closing frame');
    await page.screenshot({ path: path.join(output, 'large-library-end.png') });
    record('244-skill catalog mounts only nearby rows/cards while scrolling end to end; statistics retain full totals and video cache remains bounded');

    // Search while at the bottom must reveal a matching terminal catalog item
    // immediately instead of leaving the shorter virtual list scrolled past it.
    await page.getByRole('searchbox').fill(names['animationViewer.skills.qaLarge243']);
    await assertStats(page, 1, 3);
    await assertCount(page, '[data-animation-skill]', 1);
    await page.waitForFunction(() => document.querySelector('.animation-virtual-list')?.scrollTop === 0);
    assert.equal(await page.locator('[data-animation-skill="243"] [data-animation-part]').count(), 3);
    await page.getByRole('searchbox').fill('');
    await assertStats(page, 244, partCount);
    await page.waitForFunction(() => document.querySelector('.animation-virtual-list')?.scrollTop === 0);
    await visitSkill(page, 0);
    await sample('after-search');

    const toggle = page.locator('.category-toggle[aria-controls="animation-category-1"]');
    await toggle.click();
    await assertCount(page, '[data-animation-category="1"]', 0);
    await visitSkill(page, 80);
    assert.equal(await page.locator('[data-animation-category="1"]').count(), 0, 'A collapsed category has no partial virtual frame');
    await toggle.click();
    await visitSkill(page, 0);
    await page.getByRole('button', { name: '全部收起', exact: true }).click();
    await assertCount(page, '[data-animation-category]', 0);
    await assertCount(page, '[data-animation-part]', 0);
    assert.equal(await page.locator('.category-toggle').count(), 5);
    await assertStats(page, 244, partCount);
    await page.getByRole('button', { name: '全部展开', exact: true }).click();
    await visitSkill(page, 0);
    await sample('after-expand');
    record('Searching the terminal skill resets virtual scroll to the top; category and all-category collapse remove entire frames without changing full catalog statistics');

    await page.setViewportSize({ width: 320, height: 760 });
    await visitSkill(page, 240);
    const combo = page.locator('[data-animation-skill="240"]');
    assert.equal(await combo.locator('[data-animation-part]').count(), 3);
    for (let index = 0; index < 3; index++) {
      const part = page.locator(`[data-animation-part="240:${index}"]`);
      await part.scrollIntoViewIfNeeded();
      const bounds = await part.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 321, `Resized combo part ${index} stays within mobile width`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await sample('mobile-combo');
    await page.screenshot({ path: path.join(output, 'large-library-mobile-320.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await visitSkill(page, 240);
    await assertPlaying(page.locator('[data-animation-part="240:0"] video'));
    await page.locator('[data-animation-part="240:0"] .preview-open').click();
    const dialog = page.locator('dialog.animation-preview-dialog');
    await dialog.waitFor({ state: 'visible' });
    await assertPlaying(dialog.locator('video'));
    await page.waitForFunction(() => [...document.querySelectorAll('[data-animation-part] video')].every(video => video.paused));
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await assertPlaying(page.locator('[data-animation-part="240:0"] video'));
    await page.waitForFunction(() => {
      const bounds = document.querySelector('.animation-virtual-list').getBoundingClientRect();
      const videos = [...document.querySelectorAll('[data-animation-part] video')];
      return videos.every(video => {
        const host = video.closest('.animation-media').getBoundingClientRect();
        return video.paused || (host.bottom > bounds.top && host.top < bounds.bottom);
      });
    });
    await sample('desktop-restored');
    record('320px and 1280px resizing rebuilds virtual rows without splitting combo stages or overflowing; modal pauses every mounted card and closes to visible-only playback');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'virtual-list-measurements.json'), JSON.stringify(samples, null, 2));
  } finally { await context.close(); }
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const media = tinyVideo();
  const browser = await chromium.launch({ headless: true, channel: process.env.ANIMATION_VIEWER_BROWSER || 'msedge' });
  try {
    if (process.env.ANIMATION_VIEWER_CHECK === 'copy-name') {
      await verifyCopyName(browser, media);
    } else {
      await verifyEmptyStates(browser, media);
      await verifyCategoryOnly(browser, media);
      await verifyErrors(browser, media);
      await verifyCategoryColors(browser, media);
      await verifyBgmToolbar(browser, media);
      await verifyLibrary(browser, media);
      await verifyCopyName(browser, media);
      await verifyMediaRecovery(browser, media);
      await verifyScrollVisiblePlayback(browser, media);
      await verifyCollapseCachedPlayback(browser, media);
      await verifyLargeVirtualLibrary(browser, media);
    }
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks }, null, 2));
  } catch (error) {
    if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: false, checks, error: error.stack || String(error) }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
