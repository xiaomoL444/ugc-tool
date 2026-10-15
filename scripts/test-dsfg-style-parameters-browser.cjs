/* Optional UI regression:
 * node scripts/test-dsfg-style-parameters-browser.cjs [playwright package path] [Chrome/Edge executable]
 * Uses fresh, isolated browser storage. Set DSFG_TEST_URL for the development server.
 * Screenshots and logs are written outside this repository, under ugc-ai-search-file.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || process.env.DSFG_PLAYWRIGHT_PATH || 'playwright');
const artifactRoot = path.resolve(process.env.DSFG_STYLE_PARAMETER_OUTPUT || 'H:/Code/ugc-web/ugc-ai-search-file/verification');
const repository = path.resolve(__dirname, '..');
const relativeOutput = path.relative(repository, artifactRoot);
assert.ok(relativeOutput.startsWith(`..${path.sep}`) || path.isAbsolute(relativeOutput), 'Verification artifacts must stay outside this repository');
const screenshotDirectory = path.join(artifactRoot, 'browser');
const logDirectory = path.join(artifactRoot, 'logs');
const narrowWidth = Number(process.env.DSFG_STYLE_PARAMETER_NARROW_WIDTH) || 780;
fs.mkdirSync(screenshotDirectory, { recursive: true });
fs.mkdirSync(logDirectory, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.argv[3] ? { executablePath: process.argv[3] } : { channel: process.env.DSFG_BROWSER_CHANNEL || 'msedge' }) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [], results = [];
  let failure;
  page.on('pageerror', error => { if (!error.message.includes('ResizeObserver loop')) errors.push(error.message); });
  page.on('dialog', dialog => dialog.accept());
  const button = name => page.getByRole('button', { name, exact: true });
  const inspector = () => page.locator('[data-clip-editor].clip-editor-popover');
  const menu = () => page.locator('.studio-select-menu:visible').last();
  async function equal(read, expected, message) {
    const deadline = Date.now() + 6000;
    let actual;
    do {
      actual = await read();
      if (actual === expected) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    } while (Date.now() < deadline);
    assert.equal(actual, expected, message);
  }
  async function settle() {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function checkpoint(name) {
    await settle();
    const filename = path.join(screenshotDirectory, `dialogue-style-parameters-${name}.png`);
    await page.screenshot({ path: filename, fullPage: true, animations: 'disabled' });
    return filename;
  }
  async function select(label, optionText) {
    const field = page.locator(`[aria-label="${label}"]`).first();
    await field.click();
    await menu().waitFor();
    await menu().locator('.n-base-select-option').filter({ hasText: optionText }).first().click();
    await equal(() => menu().count(), 0, `${label} dropdown closes after selecting ${optionText}`);
  }
  async function noHorizontalOverflow(locator, description) {
    const dimensions = await locator.evaluate(element => ({ available: element.clientWidth, required: element.scrollWidth }));
    assert.ok(dimensions.available > 0 && dimensions.required <= dimensions.available + 1,
      `${description} fits the available width: ${JSON.stringify(dimensions)}`);
    return dimensions;
  }
  function pass(message) { results.push(message); console.log(`PASS ${message}`); }

  async function configure(category, prefix, manualName, defaultValue) {
    await button(category).click();
    const card = page.getByLabel(`系统${category}预设 1`, { exact: true });
    await card.locator('details.style-parameters > summary').click();
    await card.getByRole('button', { name: '＋ 添加参数', exact: true }).click();
    await page.getByLabel(`${prefix} 参数 1 名称`, { exact: true }).fill(manualName);
    await page.getByLabel(`${prefix} 参数 1 默认值`, { exact: true }).fill(defaultValue);
    await card.getByRole('button', { name: '＋ 添加参数', exact: true }).click();
    await page.getByLabel(`${prefix} 参数 2 名称`, { exact: true }).fill('获取方式');
    await page.getByLabel(`${prefix} 参数 2 默认值`, { exact: true }).fill('0');
    await select(`${prefix} 参数 2 值来源`, '实体获取方式 / 值');
    assert.equal(await card.locator('.parameter-type').count(), 2, `${category} exposes two fixed integer types`);
    assert.equal(await card.locator('.parameter-type').filter({ hasText: '整数（Int32）' }).count(), 2);
    await checkpoint(`preset-${category === '对话类型' ? 'dialogue' : 'select'}-wide`);
    await page.setViewportSize({ width: narrowWidth, height: 1000 });
    await page.getByLabel(`${prefix} 参数 2 默认值`, { exact: true }).scrollIntoViewIfNeeded();
    await settle();
    await noHorizontalOverflow(card, `${category} preset card at narrow viewport`);
    await noHorizontalOverflow(card.locator('.parameter-body'), `${category} expanded parameter settings at narrow viewport`);
    await checkpoint(`preset-${category === '对话类型' ? 'dialogue' : 'select'}-narrow`);
    await page.setViewportSize({ width: 1440, height: 1000 });
    pass(`${category}: add named integer parameters, default values and integer record sources; narrow settings fit`);
  }

  try {
    await page.goto(process.env.DSFG_TEST_URL || 'http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded' });
    await page.locator('a[href="/DSFGStudio"]').first().click();
    await page.locator('.studio-sidebar-content input[aria-label="搜索文件"]').waitFor();
    await button('预设').click();
    await configure('对话类型', '系统对话类型 1', '次数', '12');
    await configure('选项卡样式', '系统选项卡样式 1', '选项数量', '3');

    await page.locator('.studio-feature-tabs').getByRole('button', { name: '对话', exact: true }).click();
    await button('新建文件').click();
    await page.getByLabel('新对话文件名', { exact: true }).fill('预设整数参数浏览器回归');
    await button('创建并打开').click();
    await button('节点编辑').click();
    const pane = page.locator('.vue-flow__pane');
    await page.locator('.group-node-item').dragTo(pane, { targetPosition: { x: 250, y: 170 } });
    await page.locator('.vue-flow__node-group').last().click();
    await page.locator('.group-timeline-v3').waitFor();
    if (!await page.locator('.timeline-clip.dialogue-clip').count()) await button('＋ 添加 对话片段').click();
    await page.locator('.timeline-clip.dialogue-clip').first().click();
    const dialogueCount = page.getByLabel('对话参数 次数', { exact: true });
    await dialogueCount.waitFor();
    await equal(() => dialogueCount.inputValue(), '12', 'Dialogue applies the configured integer default');
    assert.ok((await inspector().textContent()).includes('获取方式'));
    assert.equal(await inspector().getByRole('button', { name: /添加入参|删除参数|上移参数|下移参数/ }).count(), 0);
    await dialogueCount.fill('-5');
    await select('对话参数 获取方式预设值', 'String');
    await equal(() => inspector().textContent().then(value => value.includes('当前值：1')), true, 'Referenced dialogue record copies its integer');
    await inspector().getByLabel('台词内容', { exact: true }).fill('参数来自对话类型预设');
    await checkpoint('dialogue-node-filled');
    await noHorizontalOverflow(inspector().locator('.style-parameters'), 'Dialogue node parameter fields fit inspector width');
    pass('Dialogue node shows named defaults, accepts a negative integer and copies a referenced integer without parameter-list editing controls');

    await page.getByRole('button', { name: '关闭 Clip 参数', exact: true }).click();
    await button('＋ 添加 选项卡片段').click();
    await page.locator('.timeline-clip.select-clip').click();
    const optionCount = page.getByLabel('选项卡参数 选项数量', { exact: true });
    await optionCount.waitFor();
    await equal(() => optionCount.inputValue(), '3', 'Option card applies its configured integer default');
    assert.equal(await inspector().getByRole('button', { name: /添加入参|删除参数|上移参数|下移参数/ }).count(), 0);
    await optionCount.fill('9');
    await select('选项卡参数 获取方式预设值', 'String');
    await equal(() => inspector().textContent().then(value => value.includes('当前值：1')), true, 'Referenced option record copies its integer');
    await checkpoint('select-node-filled');
    await page.setViewportSize({ width: narrowWidth, height: 1000 });
    await optionCount.scrollIntoViewIfNeeded();
    await settle();
    await noHorizontalOverflow(inspector().locator('.style-parameters'), 'Option node parameter fields fit narrow inspector width');
    await checkpoint('select-node-narrow');
    await page.setViewportSize({ width: 1440, height: 1000 });
    pass('Option node shows named defaults and reference-only record dropdowns; filled integer fields fit narrow inspector width');

    await button('预设').click();
    await button('对话类型').click();
    const dialogueCard = page.getByLabel('系统对话类型预设 1', { exact: true });
    if (await dialogueCard.locator('details').getAttribute('open') === null) await dialogueCard.locator('details > summary').click();
    await page.getByLabel('系统对话类型 1 参数 1 默认值', { exact: true }).fill('20');
    await page.locator('.studio-feature-tabs').getByRole('button', { name: '对话', exact: true }).click();
    await button('节点编辑').click();
    await page.locator('.vue-flow__node-group').last().click();
    await page.locator('.timeline-clip.dialogue-clip').first().click();
    await equal(() => dialogueCount.inputValue(), '-5', 'Changing preset defaults preserves an existing node snapshot');
    await inspector().getByRole('button', { name: '应用预设参数（恢复默认值）', exact: true }).click();
    await equal(() => dialogueCount.inputValue(), '20', 'Explicit reapplication resets to the changed default');
    await equal(() => inspector().textContent().then(value => value.includes('当前值：0')), true, 'Explicit reapplication resets referenced default');
    await checkpoint('dialogue-node-reapplied');
    pass('Saving changed preset defaults preserves existing node values until the explicit apply action resets them');
    assert.deepEqual(errors, [], 'No browser runtime errors');
  } catch (error) {
    failure = String(error.stack || error);
    try { await checkpoint('failure'); } catch {}
    throw error;
  } finally {
    fs.writeFileSync(path.join(logDirectory, 'dialogue-style-parameters-browser.json'), JSON.stringify({ url: process.env.DSFG_TEST_URL || 'http://127.0.0.1:8080/', passed: !failure, results, errors, ...(failure ? { failure } : {}) }, null, 2));
    await context.close();
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
