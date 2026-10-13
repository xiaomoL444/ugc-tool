// All asset requests are mocked. No remote data or model calls are used.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8090';
const output = path.resolve(process.argv[3] || path.join(__dirname, '../../ugc-ai-search-file/verification/browser/lazy-i18n'));
const definitions = [
  { project: 'SoundEffectPlayer', namespace: 'soundEffectPlayer', index: {
    data: [{ id: '1', nameI18nKey: 'soundEffectPlayer.data.1', duration: '1', category: 1, order: 1 }],
    category: [{ id: 1, nameI18nKey: 'soundEffectPlayer.category.1' }],
  } },
  { project: 'EffectPlayer', namespace: 'effectPlayer', index: {
    effectData: { 1: { id: '1', nameI18nKey: 'effectPlayer.data.1', duration: 1, isLoop: false, tagList: [], icon: '', hasAudio: false } },
    TagData: {}, category: {},
  } },
  { project: 'BgmPlayer', namespace: 'bgmPlayer', index: {
    musicData: [{ id: 1, song_id: 1, album_id: 1, time: 71, minute: 1, second: 11, category: 1, order: 1 }],
    categoryData: { 1: 'fixture' },
  } },
  // Image category subscriptions remain active while the editor is open.
  { project: 'ClientUIAnimationEditor', namespace: 'clientUIAnimationEditor' },
  { project: 'UIVfxEditor', namespace: 'clientUIAnimationEditor', translationProject: 'ClientUIAnimationEditor' },
];
async function selectLanguage(page, label) {
  await page.locator('.language-trigger').click();
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
}
async function verify(browser, definition) {
  const translationProject = definition.translationProject ?? definition.project;
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const requests = [], errors = [];
  await context.addInitScript(() => localStorage.setItem('ugc-tools.locale', 'zh-CN'));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const asset = url.pathname.split('/ugc-tool-data/')[1];
    if (asset) {
      if (asset === 'Public/CustomUIImage/data.json') return route.fulfill({ json: {
        imageData: { 3: { id: 3, img: '', border: '' } }, category: { 3: { id: 3, images: [3] } },
      } });
      if (asset === `${definition.project}/data.json`) return route.fulfill({ json: definition.index });
      const language = asset.match(/^([^/]+)\/i18n\/([^/]+)\.json$/u);
      if (language) {
        requests.push(asset);
        const [_, project, locale] = language;
        assert.equal(project, translationProject, 'Only the active page loads resource translations');
        const namespace = definition.namespace;
        return route.fulfill({ json: {
          [`${namespace}.data.1`]: `${locale} asset`, [`${namespace}.category.1`]: `${locale} category`,
          ...(project === 'ClientUIAnimationEditor' ? { 'clientUIAnimationEditor.category.3': `${locale} icons` } : {}),
          ...(project === 'BgmPlayer' ? { 'bgmPlayer.album.1': `${locale} album` } : {}),
        } });
      }
      return route.fulfill({ status: 404, body: '' });
    }
    if (url.origin !== new URL(base).origin || url.pathname.startsWith('/api/')) return route.abort();
    return route.continue();
  });
  try {
    const page = await context.newPage();
    page.on('pageerror', error => { if (!error.message.includes('ResizeObserver')) errors.push(error.message); });
    const initialTranslation = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/${translationProject}/i18n/zh-cn.json`));
    await page.goto(`${base}/${definition.project}`);
    await initialTranslation;
    await page.waitForLoadState('networkidle');
    assert.deepEqual(requests, [`${translationProject}/i18n/zh-cn.json`], `${definition.project}: one current-language file on first load`);
    if (['SoundEffectPlayer', 'BgmPlayer'].includes(definition.project)) {
      await page.locator('.search-bar .expand-all-button').click();
    }
    if (definition.project === 'UIVfxEditor') {
      await page.getByRole('button', { name: '选择粒子图片', exact: true }).click();
      await page.locator('.image-library nav').getByText('zh-cn icons', { exact: true }).waitFor();
      assert.equal(requests.length, 1, 'Opening a second image consumer reuses the editor dictionary');
    }
    await selectLanguage(page, 'English');
    await page.waitForFunction(() => document.documentElement.lang === 'en-US');
    await page.waitForLoadState('networkidle');
    const expected = [`${translationProject}/i18n/zh-cn.json`];
    expected.push(`${translationProject}/i18n/en-us.json`);
    assert.deepEqual(requests, expected, `${definition.project}: switching only loads required catalogs`);
    if (definition.index) await page.getByText('en-us asset', { exact: true }).first().waitFor();
    if (definition.project === 'UIVfxEditor') await page.locator('.image-library nav').getByText('en-us icons', { exact: true }).waitFor();
    await selectLanguage(page, '简体中文');
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    await page.waitForLoadState('networkidle');
    assert.equal(requests.length, expected.length, `${definition.project}: returning to a loaded language uses its cached snapshot`);
    if (definition.index) await page.getByText('zh-cn asset', { exact: true }).first().waitFor();
    if (definition.project === 'UIVfxEditor') await page.locator('.image-library nav').getByText('zh-cn icons', { exact: true }).waitFor();
    assert.deepEqual(errors, [], `${definition.project}: no runtime errors`);
    await page.screenshot({ path: path.join(output, `${definition.project}.png`) });
    console.log(`PASS ${definition.project}: current-language request, switch, cached return, reactive display`);
  } finally { await context.close(); }
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try { for (const definition of definitions) await verify(browser, definition); }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
