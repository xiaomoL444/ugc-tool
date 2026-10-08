/* Optional UI regression: node scripts/test-dsfg-module-history-browser.cjs [playwright path] [Chrome/Edge executable]
 * A fresh browser context isolates every created document from the user's workspace.
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
  const tab = name => page.locator('.studio-feature-tabs').getByRole('button', { name, exact: true });
  const undo = () => page.locator('.studio-session-history').getByRole('button', { name: '撤销', exact: true }).click();
  const redo = () => page.locator('.studio-session-history').getByRole('button', { name: '重做', exact: true }).click();
  const dialogueText = () => page.locator('.dialogue-editor:visible').getByLabel('台词', { exact: true }).first();
  const taskTitle = () => page.locator('.quest-editor:visible').getByLabel('子任务标题', { exact: true });
  const cameraDuration = () => page.locator('.camera-file-editor:visible').getByLabel('镜头时长（秒）', { exact: true });
  async function equal(read, expected, label) {
    const deadline = Date.now() + 5000;
    let actual;
    do { actual = await read(); if (actual === expected) return; await new Promise(resolve => setTimeout(resolve, 20)); } while (Date.now() < deadline);
    assert.equal(actual, expected, label);
  }
  const selected = async name => equal(() => tab(name).getAttribute('aria-pressed'), 'true', `${name} is selected`);
  async function open() {
    await page.goto(process.env.DSFG_TEST_URL || 'http://localhost:8080/');
    await page.locator('a[href="/DSFGStudio"]').first().click();
    await page.locator('.studio-sidebar-content input[aria-label="搜索文件"]').waitFor();
    await page.locator('.studio-feature-tabs').waitFor();
  }
  try {
    await open();
    await button('新建文件').click(); await page.getByLabel('新对话文件名', { exact: true }).fill('模块历史对话');
    await button('创建并打开').click();
    await page.locator('.dialogue-editor:visible .panel-add-button').filter({ hasText: '＋ 默认对话' }).click();
    const initialText = await dialogueText().inputValue();
    await dialogueText().fill('切换前的对话内容');
    await tab('任务').click(); await selected('任务');
    await tab('镜头').click(); await selected('镜头');
    await undo(); await selected('任务');
    await undo(); await selected('对话');
    await equal(() => dialogueText().inputValue(), '切换前的对话内容', 'Undoing switches preserves dialogue draft');
    await undo(); await equal(() => dialogueText().inputValue(), initialText, 'Undo continues into dialogue content before the switch');
    await redo(); await equal(() => dialogueText().inputValue(), '切换前的对话内容', 'Dialogue content redo');
    await redo(); await selected('任务'); await redo(); await selected('镜头');
    console.log('PASS Chronological module switches undo and redo around earlier dialogue edits');

    await tab('任务').click();
    const taskToolbar = page.locator('.quest-editor:visible .quest-toolbar');
    await taskToolbar.getByRole('button', { name: '＋ 章节', exact: true }).click();
    await taskToolbar.getByRole('button', { name: '＋ 主任务', exact: true }).click();
    await taskToolbar.getByRole('button', { name: '＋ 子任务', exact: true }).click();
    await taskTitle().fill('切换前的任务内容');
    await tab('镜头').click(); await button('新建文件').click();
    await page.getByLabel('镜头文件名', { exact: true }).fill('模块历史镜头'); await button('创建并打开').click();
    await cameraDuration().waitFor(); const initialDuration = await cameraDuration().inputValue();
    await cameraDuration().fill('5'); await cameraDuration().press('Tab');
    await tab('对话').click(); await equal(() => dialogueText().inputValue(), '切换前的对话内容', 'Ordinary return preserves the selected dialogue document');
    await undo(); await selected('镜头'); await equal(() => cameraDuration().inputValue(), '5', 'Undo switch preserves camera edit');
    await undo(); await equal(() => cameraDuration().inputValue(), initialDuration, 'Camera edit before switch remains undoable');
    await undo(); await selected('任务');
    await equal(() => taskTitle().inputValue(), '切换前的任务内容', 'Returning preserves task selection and draft');
    await undo(); await equal(() => taskTitle().inputValue(), '新子任务', 'Task edit before switch remains undoable');
    await redo(); await equal(() => taskTitle().inputValue(), '切换前的任务内容', 'Task edit redo');
    await redo(); await selected('镜头'); await redo(); await equal(() => cameraDuration().inputValue(), '5', 'Camera edit redo across modules');
    await redo(); await selected('对话');
    console.log('PASS Tasks and cameras retain selected documents and earlier history across ordinary switches');

    await tab('预设').click(); await button('实体').click(); await button('＋ 新建人物预设').click();
    await page.getByLabel('人物 1 代号', { exact: true }).fill('刷新人物');
    await page.getByLabel('人物 1 Talker', { exact: true }).fill('刷新说话人');
    await tab('对话').click();
    const presetButton = () => page.locator('.dialogue-editor:visible .panel-add-button').filter({ hasText: '＋ 刷新人物' });
    await equal(() => presetButton().count(), 1, 'Cached dialogue consumer refreshes a newly saved entity preset');
    await undo(); await selected('预设');
    await undo(); await equal(() => page.getByLabel('人物 1 Talker', { exact: true }).inputValue(), '', 'Preset edit remains undoable before switch');
    await redo(); await redo(); await selected('对话');
    await equal(() => presetButton().count(), 1, 'Preset redo refreshes the cached dialogue consumer');
    console.log('PASS Preset history and cached consumer freshness survive module switches');

    await button('节点编辑').click();
    const graphNodes = page.locator('.dialogue-editor .vue-flow__node');
    await page.locator('.dialogue-editor:visible .vue-flow__node-group').first().click();
    const graphNodeCount = await graphNodes.count();
    await tab('任务').click(); await selected('任务'); await tab('任务').focus();
    await page.keyboard.press('Delete');
    await equal(() => graphNodes.count(), graphNodeCount, 'Delete in another module never deletes hidden dialogue graph nodes');
    await page.keyboard.press('Control+z'); await selected('对话');
    await equal(() => graphNodes.count(), graphNodeCount, 'Ctrl+Z only undoes the module switch');
    await page.keyboard.press('Control+y'); await selected('任务');
    await equal(() => taskTitle().inputValue(), '切换前的任务内容', 'Hidden histories do not consume the active global shortcut');
    await undo(); await selected('对话');
    await button('文本编辑').click(); await dialogueText().fill('新的历史分支'); await dialogueText().press('Tab');
    assert.equal(await page.locator('.studio-session-history').getByRole('button', { name: '重做', exact: true }).isDisabled(), true, 'A new edit clears switch redo');
    console.log('PASS Hidden graph shortcuts are inactive; new edits discard the redo branch');

    await button('新建工作区').click();
    await page.getByLabel('工作区名称', { exact: true }).fill('历史隔离工作区'); await button('创建').click();
    await button('选择工作区').click(); await page.getByRole('menuitemradio', { name: '历史隔离工作区', exact: true }).click();
    await equal(() => button('选择工作区').textContent().then(text => text.includes('历史隔离工作区')), true, 'New workspace is selected');
    await equal(() => page.locator('.studio-session-history').getByRole('button', { name: '撤销', exact: true }).isDisabled(), true, 'Workspace switch clears the previous journal');
    assert.equal(await page.locator('.studio-editor-session').count(), 1, 'Old cached modules are removed');
    assert.equal(await page.locator('.quest-editor, .camera-file-editor').count(), 0);
    await button('选择工作区').click(); await page.getByRole('menuitemradio', { name: '默认工作区', exact: true }).click();
    await button('模块历史对话.json').click();
    await equal(() => dialogueText().inputValue(), '新的历史分支', 'Previous content was saved before the workspace switch');
    assert.equal(await page.locator('.studio-session-history').getByRole('button', { name: '撤销', exact: true }).isDisabled(), true, 'Opening the original document cannot replay another workspace session');
    console.log('PASS Workspace switching clears cached histories while saved documents survive returning');
    assert.deepEqual(errors, []);
    console.log('\n5 DSFG module history browser checks passed.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
