// Deterministic, offline UI regression. All generated evidence stays outside the repository.
// Usage: node scripts/test-sound-duration-filter-browser.cjs [base URL] [evidence directory]
// Set DURATION_PLAYWRIGHT to an installed playwright package path when it is not on NODE_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.DURATION_PLAYWRIGHT || 'playwright');
const { createFeatureSidecar } = require('./ai-search-feature-fixtures.cjs');

const base = process.argv[2] || 'http://127.0.0.1:8080';
const output = path.resolve(process.argv[3]
  || path.join(__dirname, '../../ugc-ai-search-file/verification/browser/sound-duration-filter'));
const fixtureValues = [
  ['101', '0', 1, '6.0', '零秒确认'],
  ['102', '0.5', 1, '6.1', '半秒提示'],
  ['103', '1', 2, '6.0', '短促木响'],
  ['104', '2', 2, '6.0', '木质机关开启'],
  ['105', '8', 3, '6.1', '长声机关回响'],
  ['106', '8.0001', 3, '6.0', '边界外回响'],
  ['107', '15', 4, '6.1', '战斗爆响'],
  ['108', '120', 5, '6.0', '长环境声'],
  ['109', undefined, 6, '6.1', '时长未知'],
  ['110', '', 6, '6.0', '时长空白'],
  ['111', 'NaN', 7, '6.1', '时长无效'],
  ['112', '-1', 7, '6.0', '时长负数'],
  ['113', '4', 4, '6.0', '中段机关转动'],
];
const sounds = fixtureValues.map(([id, duration, category, giVersion], order) => ({
  id, duration, category, giVersion, order, nameI18nKey: `soundEffectPlayer.data.${id}`,
}));
const categoryNames = ['环境', '生物敌人叫声', '角色动作', '战斗', '物件', '界面音效', '操控对象'];
const categories = categoryNames.map((name, index) => ({
  id: index + 1, nameI18nKey: `soundEffectPlayer.category.${index + 1}`,
}));
const features = createFeatureSidecar('SoundEffectPlayer', {
  105: { audio: { short: '清脆的齿轮声', keywords: ['齿轮转动'] } },
});
const dictionary = {
  ...Object.fromEntries(fixtureValues.map(([id, , , , name]) => [`soundEffectPlayer.data.${id}`, name])),
  ...Object.fromEntries(categoryNames.map((name, index) => [`soundEffectPlayer.category.${index + 1}`, name])),
  ...features.i18n['zh-cn'],
};

async function installOfflineFixtures(context, requests) {
  await context.addInitScript(() => localStorage.setItem('ugc-tools.locale', 'zh-CN'));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const asset = url.pathname.split('/ugc-tool-data/')[1];
    if (asset) {
      requests.push(asset);
      if (asset === 'SoundEffectPlayer/data.json') return route.fulfill({ json: { data: sounds, category: categories } });
      if (asset === 'SoundEffectPlayer/features.json') {
        const { i18n, ...metadata } = features;
        return route.fulfill({ json: { ...metadata, i18nSource: 'project-i18n-v1' } });
      }
      if (/^SoundEffectPlayer\/i18n\/[^/]+\.json$/u.test(asset)) return route.fulfill({ json: dictionary });
      return route.fulfill({ status: 404, body: '' });
    }
    // The app bundle, HMR and local styles load normally; data/model services are never contacted.
    if (url.origin !== new URL(base).origin || url.pathname.startsWith('/api/')) return route.abort();
    return route.continue();
  });
}

async function waitForCount(page, expected) {
  await page.waitForFunction(count => {
    const value = document.querySelector('.search-count')?.textContent?.match(/\d+/u)?.[0];
    return value !== undefined && Number(value) === count;
  }, expected);
  assert.equal(Number((await page.locator('.search-count').innerText()).match(/\d+/u)?.[0]), expected);
}

async function expectVisibleResults(page, ids) {
  const expected = [...ids].sort();
  await page.waitForFunction(wanted => {
    const actual = Array.from(document.querySelectorAll('.sound-card[data-sound-id]'), item => item.dataset.soundId).sort();
    return JSON.stringify(actual) === JSON.stringify(wanted);
  }, expected);
  assert.deepEqual((await page.locator('.sound-card').evaluateAll(cards => cards.map(card => card.dataset.soundId))).sort(), expected);
}

async function expectResults(page, ids) {
  await waitForCount(page, ids.length);
  await expectVisibleResults(page, ids);
}

async function expectLibraryState(page, total, visibleIds, expandedNames) {
  await waitForCount(page, total);
  await expectVisibleResults(page, visibleIds);
  assert.deepEqual(await page.locator('.category-header.expanded .category-title').allTextContents(), expandedNames);
}

async function expandVisibleCategories(page) {
  if (await page.locator('.category-header:not(.expanded)').count()) await page.locator('.expand-all-button').click();
}

async function openPanel(page, keyboard = false) {
  const trigger = page.locator('.duration-filter-trigger');
  if (keyboard) {
    await trigger.focus();
    await trigger.press('Enter');
  } else await trigger.click();
  const panel = page.locator('.duration-filter-panel');
  await panel.waitFor({ state: 'visible' });
  // Wait for the popover's real entrance transition before measuring or capturing it.
  await panel.evaluate(async element => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const animations = [];
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      animations.push(...node.getAnimations().filter(animation => animation.effect.getComputedTiming().iterations !== Infinity));
    }
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
  });
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  return panel;
}

async function draft(panel, min, max) {
  await panel.locator('[data-duration-min]').fill(min === null ? '' : String(min));
  await panel.locator('[data-duration-max]').fill(max === null ? '' : String(max));
}

async function readDraft(panel) {
  const min = await panel.locator('[data-duration-min]').inputValue();
  const max = await panel.locator('[data-duration-max]').inputValue();
  return { min: min === '' ? null : Number(min), max: max === '' ? null : Number(max) };
}

function resultsForRange({ min, max }) {
  if (min === null && max === null) return sounds.map(row => row.id);
  return sounds.filter(row => row.duration !== undefined && row.duration.trim() !== ''
    && Number.isFinite(Number(row.duration)) && Number(row.duration) >= 0
    && (min === null || Number(row.duration) >= min)
    && (max === null || Number(row.duration) <= max)).map(row => row.id);
}

async function applyRange(page, min, max, revealResults = false) {
  const panel = await openPanel(page);
  await draft(panel, min, max);
  await panel.locator('.duration-filter-apply').click();
  await panel.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.duration-filter-trigger').getAttribute('aria-expanded'), 'false');
  if (revealResults) {
    await waitForCount(page, resultsForRange({ min, max }).length);
    await expandVisibleCategories(page);
  }
}

async function resetRange(page, revealResults = false) {
  const panel = await openPanel(page);
  await panel.locator('.duration-filter-reset').click();
  if (await panel.isVisible()) {
    await panel.locator('.duration-filter-apply').click();
    await panel.waitFor({ state: 'hidden' });
  }
  await waitForCount(page, sounds.length);
  assert.match(await page.locator('.duration-filter-trigger').innerText(), /不限/u);
  if (revealResults) await expandVisibleCategories(page);
}

async function assertInvalidDraft(page, min, max, retainedIds) {
  const panel = await openPanel(page);
  await draft(panel, min, max);
  const apply = panel.locator('.duration-filter-apply');
  if (await apply.isEnabled()) await apply.click();
  assert.equal(await panel.isVisible(), true, 'Invalid bounds must remain editable instead of becoming the applied range');
  await expectResults(page, retainedIds);
  // Returning to valid bounds proves the panel can recover after validation.
  await draft(panel, 90, 150);
  await apply.click();
  await panel.waitFor({ state: 'hidden' });
  await expectResults(page, ['108']);
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.DURATION_BROWSER_CHANNEL || 'msedge' });
  const errors = [];
  const requests = [];
  const checks = [];
  let currentPage;
  try {
    const context = await browser.newContext({ viewport: { width: 2560, height: 1380 } });
    await installOfflineFixtures(context, requests);
    const page = await context.newPage();
    currentPage = page;
    page.on('pageerror', error => { if (!error.message.includes('ResizeObserver')) errors.push(error.message); });
    await page.goto(`${base}/SoundEffectPlayer`);
    await waitForCount(page, sounds.length);
    await page.locator('.category-title').filter({ hasText: '操控对象' }).waitFor();
    const trigger = page.locator('.duration-filter-trigger');
    assert.match(await trigger.innerText(), /不限/u);
    assert.equal(await page.locator('.duration-filter-panel').isVisible(), false);
    const [categoryBox, triggerBox, versionBox, controlsBox] = await Promise.all([
      page.locator('.category-controls').boundingBox(), trigger.boundingBox(),
      page.locator('.version-filter').boundingBox(), page.locator('.library-controls').boundingBox(),
    ]);
    for (const box of [categoryBox, triggerBox, versionBox, controlsBox]) assert.ok(box);
    assert.ok(categoryBox.x + categoryBox.width <= triggerBox.x + 1, 'Duration belongs after the category buttons');
    assert.ok(triggerBox.x + triggerBox.width <= versionBox.x + 1, 'Duration belongs before the version menu');
    assert.ok(Math.abs(triggerBox.y - versionBox.y) <= 4 && Math.abs(categoryBox.y - triggerBox.y) <= 4,
      'Desktop category, duration and version controls stay on the same line');
    assert.ok(controlsBox.height <= 44, `The compact control row must not grow vertically (${controlsBox.height}px)`);
    checks.push('Compact desktop placement between all seven categories and versions');

    await page.locator('.collapsed-hint').waitFor();
    assert.equal(await page.locator('.sound-card').count(), 0, 'Initial library preserves the existing collapsed categories');
    const firstPanel = await openPanel(page, true);
    await draft(firstPanel, 2, 8);
    await waitForCount(page, sounds.length);
    assert.equal(await page.locator('.sound-card').count(), 0, 'Unapplied draft changes leave the library untouched');
    await page.screenshot({ path: path.join(output, 'desktop-duration-open.png') });
    await firstPanel.locator('.duration-filter-apply').click();
    await firstPanel.waitFor({ state: 'hidden' });
    await expectLibraryState(page, 3, [], []);
    assert.match(await trigger.innerText(), /2\s*[–—-]\s*8/u);
    assert.deepEqual(await page.locator('.category-header').evaluateAll(buttons => buttons.map(button => [
      button.querySelector('.category-title').textContent.trim(), button.querySelector('.category-count').textContent.trim(),
    ])), [['生物敌人叫声', '1'], ['角色动作', '1'], ['战斗', '1']]);
    await page.screenshot({ path: path.join(output, 'desktop-duration-applied.png') });
    checks.push('Staged changes, inclusive 2–8 second boundaries, synchronized totals and category counts');

    await page.locator('.category-header').filter({ has: page.locator('.category-title', { hasText: '生物敌人叫声' }) }).click();
    await expectLibraryState(page, 3, ['104'], ['生物敌人叫声']);
    await applyRange(page, 1, 8);
    await expectLibraryState(page, 4, ['103', '104'], ['生物敌人叫声']);
    const partialPanel = await openPanel(page);
    const partialUpper = partialPanel.getByRole('slider').nth(1);
    const partialBox = await partialUpper.boundingBox();
    assert.ok(partialBox);
    await page.mouse.move(partialBox.x + partialBox.width / 2, partialBox.y + partialBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(partialBox.x + partialBox.width / 2 + 50, partialBox.y + partialBox.height / 2, { steps: 8 });
    await page.waitForFunction(() => document.querySelector('[data-duration-max]')?.value !== '8');
    const partialIds = resultsForRange(await readDraft(partialPanel));
    assert.ok(partialIds.length > 4, 'The partial-expansion drag adds matches from closed categories');
    await expectLibraryState(page, 4, ['103', '104'], ['生物敌人叫声']);
    await page.mouse.up();
    await expectLibraryState(page, partialIds.length, ['103', '104'], ['生物敌人叫声']);
    assert.equal(await partialPanel.isVisible(), true);
    await page.screenshot({ path: path.join(output, 'desktop-duration-partial-expanded.png') });
    await partialPanel.locator('[data-duration-min]').press('Escape');
    await partialPanel.waitFor({ state: 'hidden' });
    await applyRange(page, 30, null);
    await expectLibraryState(page, 1, [], []);
    await applyRange(page, 1, 8);
    await expectLibraryState(page, 4, ['103', '104'], ['生物敌人叫声']);
    await applyRange(page, 200, 300);
    await expectLibraryState(page, 0, [], []);
    await page.locator('.empty-result').waitFor();
    await applyRange(page, 1, 8);
    await expectLibraryState(page, 4, ['103', '104'], ['生物敌人叫声']);
    await resetRange(page);
    await expectLibraryState(page, sounds.length, ['103', '104'], ['生物敌人叫声']);
    checks.push('Duration apply, drag, hidden groups, zero-result recovery and reset preserve the exact category expansion choices');

    // The remaining data/filter checks explicitly reveal results when they need all matching cards.
    await expandVisibleCategories(page);
    await applyRange(page, 2, 8);
    await expectResults(page, ['104', '105', '113']);
    const search = page.locator('.search-bar input[type="search"]');
    await search.fill('机关');
    await expectResults(page, ['104', '105', '113']);
    await search.fill('齿轮转动');
    await expectResults(page, ['105']);
    await search.fill('104');
    await expectResults(page, ['104']);
    await page.locator('.version-filter').selectOption('6.1');
    await expectResults(page, []);
    await page.locator('.empty-result').waitFor();
    assert.equal(await trigger.isEnabled(), true, 'No results must retain the duration control for recovery');
    await search.fill('');
    await expectResults(page, ['105']);
    await page.locator('.version-filter').selectOption('6.0');
    await expectResults(page, ['104', '113']);
    await page.locator('.version-filter').selectOption('');
    checks.push('Duration combines with names, IDs, translated descriptions and versions; empty results remain recoverable');

    await applyRange(page, 30, null, true);
    await expectResults(page, ['108']);
    await applyRange(page, null, 1, true);
    await expectResults(page, ['101', '102', '103']);
    await applyRange(page, 0, 0, true);
    await expectResults(page, ['101']);
    await applyRange(page, 90, 150, true);
    await expectResults(page, ['108']);
    await assertInvalidDraft(page, 8, 2, ['108']);
    await assertInvalidDraft(page, -1, 8, ['108']);
    checks.push('One-sided bounds, valid zero duration, ranges over 30 seconds and invalid-range recovery');

    let panel = await openPanel(page);
    await draft(panel, 2, 8);
    await page.locator('.search-label').click();
    await panel.waitFor({ state: 'hidden' });
    await expectResults(page, ['108']);
    panel = await openPanel(page, true);
    assert.equal(await panel.locator('[data-duration-min]').inputValue(), '90');
    assert.equal(await panel.locator('[data-duration-max]').inputValue(), '150');
    await draft(panel, 0, 1);
    await panel.locator('[data-duration-min]').press('Escape');
    await panel.waitFor({ state: 'hidden' });
    await expectResults(page, ['108']);
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true, 'Escape restores trigger focus');
    await resetRange(page, true);
    await expectResults(page, sounds.map(row => row.id));
    checks.push('Outside click and Escape discard drafts, keyboard focus returns, reset restores unknown-duration assets');

    panel = await openPanel(page);
    assert.match(await panel.locator('.duration-longest').innerText(), /120/u,
      'The loaded metadata maximum explains the slider extent');
    assert.match(await panel.locator('.duration-tick-value').innerText(), /^10\s*秒$/u,
      'The middle marker identifies a useful fixed 10-second duration');
    const sliders = panel.getByRole('slider');
    assert.equal(await sliders.count(), 2, 'The popover provides two keyboard-operable range handles');
    const [leftBox, rightBox] = await Promise.all([sliders.nth(0).boundingBox(), sliders.nth(1).boundingBox()]);
    assert.ok(leftBox && rightBox);
    const railStart = leftBox.x + leftBox.width / 2;
    const railEnd = rightBox.x + rightBox.width / 2;
    const railY = rightBox.y + rightBox.height / 2;
    let appliedIds = sounds.map(row => row.id);
    let committedDragRange;
    for (const fraction of [0.65, 0.4]) {
      const handleBox = await panel.getByRole('slider').nth(1).boundingBox();
      const before = await panel.locator('[data-duration-max]').inputValue();
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(railStart + (railEnd - railStart) * fraction, railY, { steps: 8 });
      await page.waitForFunction(previous => document.querySelector('[data-duration-max]')?.value !== previous, before);
      const draggedRange = await readDraft(panel);
      const expected = resultsForRange(draggedRange);
      assert.notDeepEqual(expected, appliedIds, 'The drag crosses a meaningful fixture boundary');
      await expectResults(page, appliedIds);
      await page.mouse.up();
      await expectResults(page, expected);
      assert.equal(await panel.isVisible(), true, 'Releasing the slider applies its range and keeps the popover open');
      appliedIds = expected;
      committedDragRange = draggedRange;
    }
    await page.screenshot({ path: path.join(output, 'desktop-duration-drag-applied.png') });
    await draft(panel, 90, 150);
    await expectResults(page, appliedIds);
    await panel.locator('[data-duration-min]').press('Escape');
    await panel.waitFor({ state: 'hidden' });
    await expectResults(page, appliedIds);
    panel = await openPanel(page);
    assert.deepEqual(await readDraft(panel), committedDragRange,
      'Cancel discards later typed edits while preserving the last automatically committed drag');
    await panel.locator('[data-duration-min]').press('Escape');
    await panel.waitFor({ state: 'hidden' });
    checks.push('Two real slider drags keep results unchanged until release, automatically apply, and leave the popover open');

    await resetRange(page);
    panel = await openPanel(page);
    const allIds = sounds.map(row => row.id);
    const keyboardSliders = panel.getByRole('slider');
    assert.equal(await keyboardSliders.count(), 2);
    const upper = keyboardSliders.nth(1);
    const metadataMaximum = Math.max(...sounds.map(row => Number(row.duration)).filter(value => Number.isFinite(value) && value >= 0));
    await upper.focus();
    await page.keyboard.down('ArrowLeft');
    await page.waitForFunction(() => document.querySelector('[data-duration-max]')?.value !== '');
    const updatedUpper = Number(await panel.locator('[data-duration-max]').inputValue());
    assert.ok(Number.isFinite(updatedUpper) && updatedUpper >= 0 && updatedUpper < metadataMaximum,
      'Arrow keys on the upper slider reduce the editable maximum duration');
    await expectResults(page, allIds);
    const sliderExpected = resultsForRange(await readDraft(panel));
    await page.keyboard.up('ArrowLeft');
    await expectResults(page, sliderExpected);
    assert.equal(await panel.isVisible(), true, 'Keyboard release applies while preserving the open popover');
    await panel.locator('[data-duration-min]').press('Escape');
    await panel.waitFor({ state: 'hidden' });
    await expectResults(page, sliderExpected);
    checks.push('Keyboard keydown edits the draft, keyup applies, and Escape retains the committed filter');

    panel = await openPanel(page);
    // An arrow step from just below the upper bound attempts to cross it.
    await draft(panel, 7.999, 8);
    const lower = panel.getByRole('slider').nth(0);
    await lower.focus();
    await lower.press('ArrowRight');
    await page.waitForFunction(() => Number(document.querySelector('[data-duration-min]')?.value) === 8);
    assert.equal(Number(await panel.locator('[data-duration-max]').inputValue()), 8);
    assert.equal(await panel.getByRole('alert').count(), 0, 'Crossing slider handles must not create an invalid range');
    assert.equal(await panel.locator('.duration-filter-apply').isEnabled(), true);
    await expectResults(page, ['105']);
    await lower.press('ArrowLeft');
    await page.waitForFunction(() => Number(document.querySelector('[data-duration-min]')?.value) < 8);
    assert.equal(await panel.getByRole('alert').count(), 0, 'A clamped slider remains operable');
    const clampedExpected = resultsForRange(await readDraft(panel));
    await expectResults(page, clampedExpected);
    await panel.locator('[data-duration-min]').press('Escape');
    await panel.waitFor({ state: 'hidden' });
    await expectResults(page, clampedExpected);
    checks.push('Crossing handles clamp to a valid interval, commit on release and remain keyboard-operable');

    await page.setViewportSize({ width: 390, height: 844 });
    await trigger.scrollIntoViewIfNeeded();
    panel = await openPanel(page);
    const mobileBox = await panel.boundingBox();
    assert.ok(mobileBox && mobileBox.x >= -1 && mobileBox.y >= -1
      && mobileBox.x + mobileBox.width <= 391 && mobileBox.y + mobileBox.height <= 845,
    `The entire popover fits in a narrow viewport: ${JSON.stringify(mobileBox)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false,
      'Duration controls do not introduce horizontal page scrolling');
    await page.screenshot({ path: path.join(output, 'mobile-duration-open.png') });
    await panel.locator('[data-duration-min]').press('Escape');
    checks.push('Narrow viewport has a fully visible popover and no horizontal document overflow');

    assert.deepEqual(errors, [], 'No uncaught browser errors');
    await fs.writeFile(path.join(output, 'result.json'), `${JSON.stringify({ passed: true, checks, requests, errors }, null, 2)}\n`);
    console.log(`PASS sound duration filter (${checks.length} checks). Evidence: ${output}`);
    await context.close();
  } catch (error) {
    await fs.writeFile(path.join(output, 'result.json'), `${JSON.stringify({ passed: false, checks, requests, errors, failure: error.stack || String(error) }, null, 2)}\n`);
    if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
