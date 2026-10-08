/* Optional UI regression: node scripts/test-dsfg-clip-inspector-browser.cjs [playwright path] [browser executable]
 * Uses fresh browser storage so the user's workspaces are untouched.
 */
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => { if (!error.message.includes('ResizeObserver loop')) errors.push(error.message); });
  const button = name => page.getByRole('button', { name, exact: true });
  try {
    await page.goto(process.env.DSFG_TEST_URL || 'http://localhost:8080/');
    await page.locator('a[href="/DSFGStudio"]').first().click();
    await page.locator('.studio-sidebar-content input[aria-label="搜索文件"]').waitFor();
    await button('新建文件').click();
    await page.getByLabel('新对话文件名', { exact: true }).fill('Clip 拖选回归');
    await button('创建并打开').click();
    await button('节点编辑').click();
    const pane = page.locator('.vue-flow__pane');
    await page.locator('.group-node-item').dragTo(pane, { targetPosition: { x: 250, y: 170 } });
    await page.locator('.vue-flow__node-group').last().click();
    await page.locator('.group-timeline-v3').waitFor();
    if (!await page.locator('.timeline-clip.dialogue-clip').count()) await button('＋ 添加 对话片段').click();
    const clip = page.locator('.timeline-clip.dialogue-clip');
    await clip.click();
    const inspector = page.locator('[data-clip-editor].clip-editor-popover');
    const text = inspector.getByLabel('台词内容', { exact: true });
    const content = '拖选这段文字到面板外松开，Clip 参数仍然保持打开。';
    await text.fill(content);
    await page.evaluate(() => {
      window.clipGestureEvents = [];
      for (const type of ['pointerdown', 'pointerup', 'click']) window.addEventListener(type, event => {
        window.clipGestureEvents.push({ type, detail: event.detail,
          inside: event.composedPath().some(target => target.matches?.('[data-clip-editor]')) });
      }, true);
    });
    const outside = await pane.evaluate(element => {
      const rect = element.getBoundingClientRect();
      for (const y of [rect.top + 24, rect.bottom - 24]) for (const x of [rect.left + 24, rect.right - 24]) {
        if (document.elementFromPoint(x, y)?.classList.contains('vue-flow__pane')) return { x, y };
      }
      throw new Error('No visible blank graph point');
    });
    const bounds = await text.boundingBox();
    await page.mouse.move(bounds.x + 120, bounds.y + 18);
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.mouse.move(outside.x, outside.y, { steps: 15 });
    await page.mouse.up();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const gesture = await page.evaluate(() => window.clipGestureEvents);
    assert.ok(gesture.some(event => event.type === 'pointerdown' && event.inside));
    assert.ok(gesture.some(event => event.type === 'pointerup' && !event.inside));
    assert.ok(gesture.some(event => event.type === 'click' && !event.inside && event.detail > 0), 'The drag emits the outside click that previously dismissed the inspector');
    assert.equal(await inspector.count(), 1, 'An outside text-selection release keeps the inspector open');
    assert.ok(await text.evaluate(element => element.selectionStart !== element.selectionEnd), 'The gesture selected text');
    assert.equal(await text.inputValue(), content);
    console.log('PASS Native text drag-selection ends outside without dismissing the Clip inspector');
    await page.mouse.click(outside.x, outside.y);
    await inspector.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.group-timeline-v3').count(), 1, 'The next outside click closes only the inspector');
    await clip.click();
    assert.equal(await text.inputValue(), content, 'Reopening preserves the edited text');
    assert.deepEqual(errors, []);
    console.log('PASS A subsequent outside click closes the inspector, retains the Timeline, and preserves text on reopen');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
