/* Optional UI regression: node scripts/test-dsfg-condition-editor-browser.cjs [playwright package path] [browser executable]
 * Defaults to Edge and fresh, isolated browser storage. Set DSFG_TEST_URL for the development server.
 * Screenshots and the result log stay outside this repository; DSFG_CONDITION_TEST_OUTPUT can override the destination.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || process.env.DSFG_PLAYWRIGHT_PATH || 'playwright');
const output = path.resolve(process.env.DSFG_CONDITION_TEST_OUTPUT
  || 'H:/Code/ugc-web/ugc-ai-search-file/verification/browser/dsfg-condition-editor');
const repository = path.resolve(__dirname, '..');
const relativeOutput = path.relative(repository, output);
assert.ok(relativeOutput.startsWith(`..${path.sep}`) || path.isAbsolute(relativeOutput),
  'Browser verification output must be outside the repository');
fs.mkdirSync(output, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.argv[3] ? { executablePath: process.argv[3] } : { channel: process.env.DSFG_BROWSER_CHANNEL || 'msedge' }) });
  const results = [];
  const errors = [];
  let currentPage;
  async function checkpoint(page, scenario, name) {
    await settle(page);
    await page.screenshot({ path: path.join(output, `${scenario}-${name}.png`), fullPage: true, animations: 'disabled' });
  }
  async function settle(page) {
    await page.evaluate(async () => {
      const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await nextFrame();
      for (let attempt = 0; attempt < 3; attempt++) {
        const animations = [...document.querySelectorAll('.condition-editor-modal, .studio-select-menu')]
          .flatMap(element => element.getAnimations({ subtree: true }))
          .filter(animation => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime));
        if (!animations.length) break;
        await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
        await nextFrame();
      }
    });
  }
  async function equal(read, expected, message) {
    const deadline = Date.now() + 5000;
    let actual;
    do {
      actual = await read();
      if (actual === expected) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    assert.equal(actual, expected, message);
  }
  async function unobscured(locator, description) {
    await locator.waitFor({ state: 'visible' });
    const state = await locator.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
        width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight,
        hit: !!hit && (element === hit || element.contains(hit)) };
    });
    assert.ok(state.width > 0 && state.height > 0 && state.top >= -1 && state.bottom <= state.viewportHeight + 1
      && state.left >= -1 && state.right <= state.viewportWidth + 1 && state.hit,
    `${description} is completely visible and receives pointer input: ${JSON.stringify(state)}`);
    return state;
  }

  async function scenario(name, viewport) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = currentPage = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => { if (!error.message.includes('ResizeObserver loop')) errors.push(`${name}: ${error.message}`); });
    page.on('dialog', dialog => dialog.accept());
    const button = label => page.getByRole('button', { name: label, exact: true });
    const editor = () => page.locator('.n-modal[role="dialog"]').filter({ hasText: '分支 1 · 条件编辑' });
    const field = label => editor().locator(`.studio-select-field[aria-label="${label}"]`).first();
    const menu = () => page.locator('.studio-select-menu:visible').last();
    const option = label => menu().locator('.n-base-select-option').filter({ hasText: label }).first();
    const sourceLabels = ['玩家自身变量', '当前角色变量', '关卡变量', '固定数字', '固定文本', '固定布尔值'];
    const comparisonLabels = ['等于 =', '不等于 ≠', '大于等于 ≥', '大于 >', '小于等于 ≤', '小于 <'];
    async function select(label, selected) {
      await field(label).click();
      await option(selected).click();
      await equal(() => menu().count(), 0, `${label} menu closes after selection`);
      await equal(() => field(label).textContent().then(text => text.includes(selected)), true, `${label} reflects selection`);
    }
    async function inspectMenu(label, expected, screenshotName) {
      await field(label).click();
      await menu().waitFor();
      await settle(page);
      await equal(() => menu().locator('.n-base-select-option').count(), expected.length, `${label} exposes every option`);
      const labels = await menu().locator('.n-base-select-option__content').allTextContents();
      assert.deepEqual(labels.map(text => text.trim()), expected, `${label} option labels and order`);
      for (let index = 0; index < expected.length; index++) {
        await unobscured(menu().locator('.n-base-select-option').nth(index), `${name}: ${label} option ${index + 1}`);
      }
      await checkpoint(page, name, screenshotName);
      await menu().locator('.n-base-select-option').last().click();
      await equal(() => menu().count(), 0, `${label} last option is clickable`);
      await equal(() => field(label).textContent().then(text => text.includes(expected.at(-1))), true,
        `${label} last option updates the editor`);
    }
    async function footerVisible(stage) {
      await settle(page);
      await unobscured(editor().getByRole('button', { name: '取消', exact: true }), `${name}: ${stage} cancel`);
      await unobscured(editor().getByRole('button', { name: '保存条件', exact: true }), `${name}: ${stage} save`);
    }
    try {
      await page.goto(process.env.DSFG_TEST_URL || 'http://127.0.0.1:8086/', { waitUntil: 'domcontentloaded' });
      await page.locator('a[href="/DSFGStudio"]').first().click();
      await page.locator('.studio-sidebar-content input[aria-label="搜索文件"]').waitFor();
      await button('新建文件').click();
      await page.getByLabel('新对话文件名', { exact: true }).fill(`条件编辑回归-${name}`);
      await button('创建并打开').click();
      await page.locator('.dialogue-editor:visible .panel-add-button').filter({ hasText: '添加条件分支' }).click();
      await button('编辑分支 1条件').click();
      await editor().waitFor();
      await settle(page);
      await footerVisible('initial draft');
      await checkpoint(page, name, 'initial');

      if (name === 'narrow') {
        // Three nested bracket groups must fit the content width even on a phone-sized viewport.
        for (let depth = 0; depth < 3; depth++) {
          await editor().locator('.condition-group').last().locator(':scope > footer')
            .getByRole('button', { name: '＋ 添加括号组', exact: true }).click();
        }
        const variables = editor().getByLabel('左值变量名', { exact: true });
        for (let index = 0; index < await variables.count(); index++) await variables.nth(index).fill(`窄屏变量${index}`);
        const scrollArea = editor().locator('.n-card-content, .n-card__content');
        const horizontal = await scrollArea.evaluate(element => ({ available: element.clientWidth, required: element.scrollWidth }));
        assert.ok(horizontal.required <= horizontal.available + 1,
          `Nested condition content has no horizontal overflow: ${JSON.stringify(horizontal)}`);
        for (let index = 0; index < await variables.count(); index++) {
          await variables.nth(index).scrollIntoViewIfNeeded();
          await settle(page);
          await unobscured(variables.nth(index), `narrow: nested variable input ${index + 1}`);
          const fit = await variables.nth(index).evaluate(input => {
            const body = input.closest('.n-card-content, .n-card__content').getBoundingClientRect();
            const rect = input.getBoundingClientRect();
            return { left: rect.left, right: rect.right, width: rect.width, bodyLeft: body.left, bodyRight: body.right };
          });
          assert.ok(fit.width >= 50 && fit.left >= fit.bodyLeft - 1 && fit.right <= fit.bodyRight + 1,
            `Nested input fits the body width: ${JSON.stringify(fit)}`);
          await footerVisible(`nested input ${index + 1}`);
        }
        await checkpoint(page, name, 'nested-groups');
        const lastComparison = editor().locator('.studio-select-field[aria-label="比较关系"]').last();
        await lastComparison.click();
        await settle(page);
        await equal(() => menu().locator('.n-base-select-option').count(), 6, 'Narrow comparison offers six choices');
        const lastOption = menu().locator('.n-base-select-option').last();
        await lastOption.scrollIntoViewIfNeeded();
        await settle(page);
        await unobscured(lastOption, 'narrow: scrolled last comparison option');
        await checkpoint(page, name, 'last-option');
        await lastOption.click();
        await equal(() => lastComparison.textContent().then(text => text.includes('小于 <')), true,
          'Narrow comparison last option is reachable and clickable');
        await footerVisible('nested group after selection');
        await editor().getByRole('button', { name: '保存条件', exact: true }).click();
        await editor().waitFor({ state: 'hidden' });
        await button('编辑分支 1条件').click();
        await editor().waitFor();
        await settle(page);
        await equal(() => editor().locator('.condition-group').count(), 4, 'Three nested groups survive save and reopen');
        await footerVisible('reopened narrow nested groups');
        await checkpoint(page, name, 'reopened');
        await editor().getByRole('button', { name: '取消', exact: true }).click();
        results.push({ scenario: name, viewport, passed: true });
        console.log('PASS narrow: three nested groups fit, inputs remain usable, last menu option is reachable, actions stay visible');
        return;
      }

      const operatorWidth = await field('条件组连接方式').evaluate(element => ({
        operator: element.getBoundingClientRect().width,
        group: element.closest('.condition-group').getBoundingClientRect().width,
      }));
      assert.ok(operatorWidth.operator < operatorWidth.group / 2,
        `Group operator stays compact instead of filling the row: ${JSON.stringify(operatorWidth)}`);

      await inspectMenu('左值来源', sourceLabels, 'source-menu');
      await select('左值来源', '玩家自身变量');
      await editor().getByLabel('左值变量名', { exact: true }).first().fill('背包.金币');
      await inspectMenu('右值来源', sourceLabels, 'right-source-menu');
      await select('右值来源', '固定数字');
      await editor().getByLabel('右值固定值', { exact: true }).first().fill('10');
      await inspectMenu('比较关系', comparisonLabels, 'comparison-menu');

      // NSelect keeps focus on the trigger while its modal-local menu handles keyboard navigation.
      const trigger = field('比较关系').locator('.n-base-selection-label');
      await trigger.focus();
      await page.keyboard.press('ArrowDown');
      await menu().waitFor();
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Enter');
      await equal(() => field('比较关系').textContent().then(text => text.includes('大于等于 ≥')), true,
        'Arrow keys and Enter select a comparison without losing modal focus');
      assert.equal(await editor().evaluate(element => element.contains(document.activeElement)), true,
        'Keyboard focus remains in the condition dialog');
      await page.keyboard.press('ArrowDown');
      await menu().waitFor();
      await page.keyboard.press('Escape');
      await equal(() => menu().count(), 0, 'Escape closes only the selection menu');
      assert.equal(await editor().isVisible(), true, 'Escape in an open menu keeps the condition dialog open');
      await page.keyboard.press('Tab');
      assert.equal(await editor().evaluate(element => element.contains(document.activeElement)), true,
        'Tab after selecting remains inside the condition dialog');
      await footerVisible('selected comparison');
      await editor().getByRole('button', { name: '保存条件', exact: true }).click();
      await editor().waitFor({ state: 'hidden' });
      const summary = page.locator('.condition-summary').filter({ has: button('编辑分支 1条件') }).locator('span');
      const saved = '{1:ps.背包.金币} >= 10';
      await equal(() => summary.textContent(), saved, 'Save commits the generated expression');

      await button('编辑分支 1条件').click();
      await editor().waitFor();
      await equal(() => editor().getByLabel('左值变量名', { exact: true }).first().inputValue(), '背包.金币',
        'Reopening parses the saved left variable');
      await equal(() => editor().getByLabel('右值固定值', { exact: true }).first().inputValue(), '10',
        'Reopening parses the saved fixed value');
      await equal(() => field('比较关系').textContent().then(text => text.includes('大于等于 ≥')), true,
        'Reopening parses the saved comparison');

      // Create enough conditions and one bracket group to exercise the dialog's inner scroll area.
      const rootGroup = editor().locator('.condition-group').first();
      const addCondition = () => rootGroup.locator(':scope > footer').getByRole('button', { name: '＋ 添加条件', exact: true });
      const addGroup = () => rootGroup.locator(':scope > footer').getByRole('button', { name: '＋ 添加括号组', exact: true });
      for (let index = 0; index < 5; index++) await addCondition().click();
      await addGroup().click();
      const nestedGroup = rootGroup.locator('.condition-group').first();
      await nestedGroup.locator(':scope > footer').getByRole('button', { name: '＋ 添加条件', exact: true }).click();
      const variables = editor().getByLabel('左值变量名', { exact: true });
      for (let index = 0; index < await variables.count(); index++) await variables.nth(index).fill(index ? `回归变量${index}` : '背包.金币');
      const scrollArea = editor().locator('.n-card-content, .n-card__content');
      const scrolling = await scrollArea.evaluate(element => ({ scroll: element.scrollHeight, visible: element.clientHeight,
        overflow: getComputedStyle(element).overflowY }));
      assert.ok(scrolling.scroll > scrolling.visible && /auto|scroll/.test(scrolling.overflow),
        `Multiple conditions scroll inside the card content: ${JSON.stringify(scrolling)}`);
      await scrollArea.evaluate(element => { element.scrollTop = 0; });
      await settle(page);
      const topFooter = await unobscured(editor().getByRole('button', { name: '保存条件', exact: true }), `${name}: save at scroll top`);
      await footerVisible('scroll top');
      await checkpoint(page, name, 'many-conditions-top');
      await scrollArea.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await settle(page);
      const bottomFooter = await unobscured(editor().getByRole('button', { name: '保存条件', exact: true }), `${name}: save at scroll bottom`);
      assert.ok(Math.abs(topFooter.top - bottomFooter.top) < 1, 'Save button stays fixed while condition content scrolls');
      await footerVisible('nested group at scroll bottom');
      await checkpoint(page, name, 'many-conditions-bottom');

      // Open the lowest comparison after scrolling: this reproduced the clipped menu in the report.
      const lastComparison = editor().locator('.studio-select-field[aria-label="比较关系"]').last();
      await lastComparison.click();
      await settle(page);
      await equal(() => menu().locator('.n-base-select-option').count(), 6, 'Lowest comparison menu has six options');
      for (let index = 0; index < 6; index++) await unobscured(menu().locator('.n-base-select-option').nth(index),
        `${name}: bottom comparison option ${index + 1}`);
      await checkpoint(page, name, 'bottom-comparison-menu');
      await menu().locator('.n-base-select-option').last().click();
      await equal(() => lastComparison.textContent().then(text => text.includes('小于 <')), true,
        'The lowest comparison menu last option remains clickable');
      await footerVisible('after bottom menu selection');
      await editor().getByRole('button', { name: '取消', exact: true }).click();
      await editor().waitFor({ state: 'hidden' });
      await equal(() => summary.textContent(), saved, 'Cancel leaves the committed expression unchanged');
      await button('编辑分支 1条件').click();
      await editor().waitFor();
      await equal(() => editor().locator('.condition-comparison').count(), 1, 'Cancelled nested and added draft rows do not persist');
      await equal(() => editor().getByLabel('左值变量名', { exact: true }).first().inputValue(), '背包.金币',
        'Reopening after cancel restores committed values');
      await checkpoint(page, name, 'reopened');
      await editor().getByRole('button', { name: '取消', exact: true }).click();
      results.push({ scenario: name, viewport, passed: true });
      console.log(`PASS ${name}: complete menus, mouse/keyboard selection, fixed actions, save/reopen and cancel`);
    } catch (error) {
      await checkpoint(page, name, 'failure').catch(() => undefined);
      throw error;
    } finally { await context.close(); currentPage = null; }
  }

  try {
    await scenario('normal', { width: 1440, height: 1000 });
    await scenario('short', { width: 1176, height: 620 });
    await scenario('narrow', { width: 375, height: 700 });
    assert.deepEqual(errors, [], 'No unexpected browser runtime errors');
    console.log('3 DSFG condition editor browser scenarios passed.');
  } catch (error) {
    if (currentPage && !currentPage.isClosed()) await checkpoint(currentPage, 'failure', 'current').catch(() => undefined);
    results.push({ passed: false, error: error.stack || String(error) });
    throw error;
  } finally {
    fs.writeFileSync(path.join(output, 'results.json'), `${JSON.stringify({ results, errors }, null, 2)}\n`);
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
