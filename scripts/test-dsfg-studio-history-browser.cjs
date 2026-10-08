/* Optional UI regression: node scripts/test-dsfg-studio-history-browser.cjs [playwright path] [Chrome/Edge executable]
 * Uses a fresh browser context and browser storage; all created workspaces are ephemeral.
 */
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => { if (!error.message.includes('ResizeObserver loop')) errors.push(error.message); });
  page.on('dialog', dialog => dialog.accept());
  const button = name => page.getByRole('button', { name, exact: true });
  const undo = () => button('撤销').click();
  const redo = () => button('重做').click();
  async function equal(read, expected, label) {
    const deadline = Date.now() + 5000;
    let actual;
    do { actual = await read(); if (actual === expected) return; await new Promise(resolve => setTimeout(resolve, 20)); } while (Date.now() < deadline);
    assert.equal(actual, expected, label);
  }
  async function open() {
    await page.goto(process.env.DSFG_TEST_URL || 'http://localhost:8080/');
    await page.locator('a[href="/DSFGStudio"]').first().click();
    await page.locator('.studio-sidebar-content input[aria-label="搜索文件"]').waitFor();
    await page.locator('.studio-feature-tabs').waitFor();
  }
  try {
    await open(); await button('预设').click(); await button('自定义配置').click();
    await button('＋ 新建配置类别').click();
    const tableName = page.getByLabel('配置类别名称', { exact: true });
    await tableName.fill('角色配置'); await undo(); await equal(() => tableName.inputValue(), '', 'Undo complete category-name edit');
    await redo(); await equal(() => tableName.inputValue(), '角色配置', 'Redo category name');
    await button('＋ 添加字段').click(); await page.getByLabel('字段名称', { exact: true }).fill('角色 GUID');
    await button('＋ 添加记录').click(); await page.getByLabel('记录名称', { exact: true }).fill('旅行者');
    const cell = page.getByLabel('角色 GUID', { exact: true }); await cell.fill('18446744073709551615');
    await button('删除字段').click(); await equal(() => cell.count(), 0, 'Field deletion');
    await undo(); await equal(() => cell.inputValue(), '18446744073709551615', 'Deleted field restores its record value');
    await button('删除类别').click(); await equal(() => tableName.count(), 0, 'Category deletion');
    await page.keyboard.press('Control+z'); await equal(() => tableName.inputValue(), '角色配置', 'Category shortcut undo');
    await page.keyboard.press('Control+y'); await equal(() => tableName.count(), 0, 'Category shortcut redo');
    await undo(); await equal(() => cell.inputValue(), '18446744073709551615', 'Restore category with original records');
    await button('实体').click(); await button('＋ 新建人物预设').click();
    const personName = page.getByLabel('人物 1 代号', { exact: true }); await personName.fill('测试人物');
    await undo(); await equal(() => personName.inputValue(), '', 'Person typing undo');
    await undo(); await equal(() => personName.count(), 0, 'Person creation undo'); await redo();
    await button('自定义配置').click(); await equal(() => cell.inputValue(), '18446744073709551615', 'Category history remains available');
    await button('对话类型').click(); await button('＋ 新建对话类型预设').click();
    const showTitle = page.getByLabel('对话类型 1 显示标题', { exact: true });
    await showTitle.check(); await undo(); await equal(() => showTitle.isChecked(), false, 'Checkbox undo');
    await redo(); await equal(() => showTitle.isChecked(), true, 'Checkbox redo');
    await page.keyboard.press('Control+z'); await equal(() => showTitle.isChecked(), false, 'Checkbox shortcut undo');
    console.log('PASS Preset UI: names, categories, fields/cells, people, category isolation and checkbox shortcuts');

    await button('任务').click();
    const taskToolbar = page.locator('.quest-toolbar');
    await taskToolbar.getByRole('button', { name: '＋ 章节', exact: true }).click();
    await taskToolbar.getByRole('button', { name: '＋ 主任务', exact: true }).click();
    await taskToolbar.getByRole('button', { name: '＋ 子任务', exact: true }).click();
    const titleInput = page.getByLabel('子任务标题', { exact: true });
    await titleInput.fill('撤回测试子任务'); await undo(); await equal(() => titleInput.inputValue(), '新子任务', 'Task title undo keeps selection');
    await redo(); await equal(() => titleInput.inputValue(), '撤回测试子任务', 'Task title redo');
    await button('删除子任务').click(); await undo();
    await equal(() => page.locator('.quest-counts').textContent().then(text => /子任务 1\//.test(text)), true, 'Deleted task restored');
    console.log('PASS Task UI: creation, edit, deletion and selected-task restoration');

    await button('镜头').click(); await button('新建文件').click(); await page.getByLabel('镜头文件名', { exact: true }).fill('撤回测试镜头');
    await button('创建并打开').click();
    const duration = page.getByLabel('镜头时长（秒）', { exact: true }); await duration.waitFor(); const initialDuration = await duration.inputValue();
    await duration.fill('5'); await duration.press('Tab'); await undo(); await equal(() => duration.inputValue(), initialDuration, 'Camera duration undo');
    await redo(); await equal(() => duration.inputValue(), '5', 'Camera duration redo');
    console.log('PASS Camera UI: duration undo and redo');

    await button('场景').click(); await button('＋ 新增世界').click();
    const worldName = page.getByLabel('世界名称', { exact: true }); await worldName.fill('测试世界');
    await undo(); await equal(() => worldName.inputValue(), '新世界', 'World name undo'); await redo();
    await button('删除当前项').click(); await undo();
    await equal(() => page.locator('.scene-browser').textContent().then(text => text.includes('测试世界')), true, 'Deleted world restored');
    console.log('PASS Scene UI: world edits and deletion');

    await button('对话').click(); await button('边走边说').click(); await button('新建文件').click();
    await page.getByLabel('边走边说文件名', { exact: true }).fill('撤回测试台词'); await button('创建并打开').click();
    await button('＋ 添加台词').click();
    const line = page.getByLabel('第 1 条内容', { exact: true }); await line.fill('测试台词'); await undo();
    assert.notEqual(await line.inputValue(), '测试台词'); await redo(); await equal(() => line.inputValue(), '测试台词', 'Walk-talk text redo');
    await page.getByRole('button', { name: '删除第 1 条台词', exact: true }).click(); await undo(); await equal(() => line.inputValue(), '测试台词', 'Deleted line restored');
    console.log('PASS Walk-talk UI: text and deletion undo');

    await page.getByLabel('工作区操作', { exact: true }).click(); await button('设置结构体 ID').click();
    const ids = page.locator('.workspace-ids input:not([type="file"])').first(); const firstId = await ids.inputValue();
    const idDialog = page.locator('.workspace-ids');
    await ids.fill('2000000000'); await idDialog.getByRole('button', { name: '撤销', exact: true }).click();
    await equal(() => ids.inputValue(), firstId, 'Workspace ID draft undo');
    await idDialog.getByRole('button', { name: '重做', exact: true }).click();
    await button('恢复默认 ID').click(); await idDialog.getByRole('button', { name: '撤销', exact: true }).click();
    await equal(() => ids.inputValue(), '2000000000', 'Restore defaults is reversible');
    await page.getByRole('button', { name: '关闭结构体 ID 设置', exact: true }).click();
    await equal(() => line.inputValue(), '测试台词', 'Background editor history is isolated from the modal');
    console.log('PASS Workspace ID settings undo; background editor remains unchanged');

    await button('预设').click(); await button('自定义配置').click(); await equal(() => cell.inputValue(), '18446744073709551615', 'Auto-save survives editor change');
    await open(); await button('预设').click(); await button('自定义配置').click();
    await equal(() => cell.inputValue(), '18446744073709551615', 'Restored data persists on reload');
    await undo();
    assert.equal(await page.locator('.studio-feature-tabs').getByRole('button', { name: '对话', exact: true }).getAttribute('aria-pressed'), 'true', 'The only reopened history entry is the new module switch');
    assert.equal(await button('撤销').isDisabled(), true, 'Reloading does not retain or manufacture content history');
    await redo();
    assert.deepEqual(errors, []);
    console.log('PASS Persisted undo results reopen without synthetic history or browser errors');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
