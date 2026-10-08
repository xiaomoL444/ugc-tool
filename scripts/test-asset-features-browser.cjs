// Mocked asset files only; blocks all remote requests and never calls a model.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { createFeatureSidecar } = require('./ai-search-feature-fixtures.cjs');
const base = process.argv[2] || 'http://127.0.0.1:8090';
const output = path.join(__dirname, '../exports/asset-features-preview');
const soundRows = Array.from({ length: 100 }, (_, i) => ({ id: String(i + 1), nameI18nKey: `soundEffectPlayer.data.${i + 1}`, duration: '1', category: 1, order: i }));
const effectRows = Object.fromEntries(Array.from({ length: 100 }, (_, i) => {
  const id = String(i + 1);
  return [id, { id, nameI18nKey: `effectPlayer.data.${id}`, duration: 1, isLoop: false, tagList: [], icon: '', hasAudio: i < 3, audioPath: i === 2 ? '' : i < 3 ? `${id}.wav` : '' }];
}));
const features = {
  SoundEffectPlayer: createFeatureSidecar('SoundEffectPlayer', {
    1: { audio: { short: { 'zh-cn': '短促的木质敲击', 'en-us': 'A brief wooden knock' }, description: '空心敲击后迅速衰减', keywords: ['空心木响'], uses: ['机关触发'], possibleSources: ['猜测钟塔'], uncertainDetails: ['未知齿轮'] } },
    2: { audio: { status: 'not_generated' } },
    999: { audio: { short: '不应显示的孤立资产' } },
  }),
  EffectPlayer: createFeatureSidecar('EffectPlayer', {
    1: { standVisual: { short: '蓝色环形光向外扩散', description: '光环缓慢扩大后淡出', keywords: ['水纹脉冲'] }, tailVisual: { short: '金色线条拖尾', keywords: ['金线轨迹'] }, audio: { short: '低沉金属震响', keywords: ['钟声共鸣'], uses: ['魔法启动'] } },
    3: { standVisual: { short: '细小白色光点' }, audio: { short: '缺少音源的描述', keywords: ['无源轰鸣'] } },
    4: { standVisual: { short: '绿色闪光' }, audio: { short: '没有声音的描述', keywords: ['虚构音轨'] } },
  }),
};
const silentAudio = (() => {
  const wav = Buffer.alloc(44 + 16000);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(16000, 40);
  return wav;
})();
async function install(context, state) {
  await context.addInitScript(() => localStorage.setItem('ugc-tools.locale', 'zh-CN'));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const asset = url.pathname.split('/ugc-tool-data/')[1];
    if (asset) {
      if (asset === 'SoundEffectPlayer/data.json') return route.fulfill({ json: { data: soundRows, category: [{ id: 1, nameI18nKey: 'soundEffectPlayer.category.1' }] } });
      if (asset === 'EffectPlayer/data.json') return route.fulfill({ json: { effectData: effectRows, TagData: {}, category: {} } });
      const featureProject = Object.keys(features).find(project => asset === `${project}/features.json`);
      if (featureProject) {
        state.featureRequests.push(asset);
        if (state.missing) return route.fulfill({ status: 404, body: '' });
        const { i18n, ...metadata } = features[featureProject];
        return route.fulfill({ json: { ...metadata, i18nSource: 'project-i18n-v1' } });
      }
      if (asset.includes('/i18n/')) {
        const project = asset.split('/')[0], namespace = project === 'EffectPlayer' ? 'effectPlayer' : 'soundEffectPlayer';
        const locale = asset.match(/\/i18n\/([^/]+)\.json$/u)?.[1];
        return route.fulfill({ json: { ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`${namespace}.data.${i + 1}`, `测试资产 ${i + 1}`])), ...(project === 'SoundEffectPlayer' ? { 'soundEffectPlayer.category.1': '测试类别' } : {}), ...features[project]?.i18n[locale] } });
      }
      if (/\.(?:wav|mp3|m4a|opus)$/u.test(asset)) return route.fulfill({ contentType: 'audio/wav', body: silentAudio });
      return route.fulfill({ status: 404, body: '' });
    }
    if (url.origin !== new URL(base).origin || url.pathname.startsWith('/api/')) return route.abort();
    return route.continue();
  });
}
async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const errors = [];
  try {
    await fs.mkdir(output, { recursive: true });
    const state = { featureRequests: [] }, context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await install(context, state);
    const page = await context.newPage();
    page.on('pageerror', e => { if (!e.message.includes('ResizeObserver')) errors.push(e.message); });
    await page.goto(`${base}/SoundEffectPlayer?id=1`);
    await page.locator('.sound-feature-details .asset-feature-panel').waitFor();
    assert.match(await page.locator('.sound-feature-details').innerText(), /空心敲击后迅速衰减/u);
    const soundSearch = page.locator('.search-bar input');
    await soundSearch.fill('空心木响');
    await page.locator('.sound-card[data-sound-id="1"]').waitFor();
    assert.equal(await page.locator('.sound-card').count(), 1);
    await soundSearch.fill('wooden knock');
    assert.equal(await page.locator('.sound-card').count(), 1, 'Other-language descriptions are searchable');
    await soundSearch.fill('猜测钟塔');
    await page.locator('.empty-result').waitFor();
    await soundSearch.fill('空心木响');
    const trigger = page.locator('.sound-card .asset-feature-summary');
    await trigger.hover();
    const tooltip = page.getByRole('tooltip');
    await tooltip.waitFor();
    assert.equal(await tooltip.evaluate(e => getComputedStyle(e).pointerEvents), 'none');
    await page.locator('.player audio').evaluate(audio => audio.play());
    await page.waitForFunction(() => document.querySelector('.player audio').currentTime > 0.2);
    assert.equal(await page.getByRole('tooltip').count(), 1, 'Playback updates do not dismiss the description');
    await page.locator('.player audio').evaluate(audio => audio.pause());
    await page.mouse.move(10, 10);
    await tooltip.waitFor({ state: 'detached' });
    await page.screenshot({ path: path.join(output, 'sound-descriptions.png') });
    await page.goto(`${base}/EffectPlayer?id=1`);
    await page.locator('.effect-feature-details .asset-feature-panel').waitFor();
    await page.locator('.modal-title').getByText('测试资产 1', { exact: true }).waitFor();
    const panel = await page.locator('.effect-feature-details').innerText();
    for (const text of ['光环缓慢扩大', '金色线条', '低沉金属', '魔法启动']) assert.ok(panel.includes(text));
    assert.equal(await page.locator('.effect-feature-details [data-feature-part]').count(), 3);
    await page.locator('.close-button').click();
    const effectSearch = page.locator('#effect-search');
    for (const term of ['水纹脉冲', '金线轨迹', '钟声共鸣']) {
      await effectSearch.fill(term);
      await page.locator('[data-effect-id="1"]').waitFor();
      assert.equal(await page.locator('[data-effect-card]').count(), 1);
    }
    for (const term of ['无源轰鸣', '虚构音轨']) {
      await effectSearch.fill(term);
      await page.locator('[data-effect-card]').waitFor({ state: 'detached' });
    }
    await effectSearch.fill('水纹脉冲');
    await page.screenshot({ path: path.join(output, 'effect-descriptions.png') });
    assert.deepEqual([...new Set(state.featureRequests)].sort(), ['EffectPlayer/features.json', 'SoundEffectPlayer/features.json']);
    assert.deepEqual(errors, []);
    await context.close();
    const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await install(touchContext, { featureRequests: [] });
    const touchPage = await touchContext.newPage();
    await touchPage.goto(`${base}/EffectPlayer`);
    const touchSummary = touchPage.locator('[data-effect-id="1"] .asset-feature-summary');
    await touchSummary.waitFor();
    await touchSummary.tap();
    await touchPage.getByRole('tooltip').waitFor();
    assert.equal(await touchPage.locator('.modal').count(), 0, 'Touching details does not open the asset modal');
    await touchPage.locator('.search-label').tap();
    await touchPage.getByRole('tooltip').waitFor({ state: 'detached' });
    assert.equal(await touchPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await touchPage.screenshot({ path: path.join(output, 'mobile-descriptions.png') });
    await touchContext.close();
    const missingContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await install(missingContext, { featureRequests: [], missing: true });
    const missingPage = await missingContext.newPage();
    await missingPage.goto(`${base}/EffectPlayer?id=1`);
    await missingPage.locator('.feature-status').waitFor();
    assert.match(await missingPage.locator('.feature-status').innerText(), /暂不可用/u);
    assert.ok(await missingPage.locator('.modal-title').innerText());
    await missingContext.close();
    console.log('PASS asset descriptions: project features + i18n paths, ordinary five-language search, separated visual/tail/audio, truthful audio gate, playback-stable hover dismissal, touch, missing-file fallback');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
