// Mocked asset files only; blocks all remote requests and never calls a model.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { createFeatureSidecar } = require('./ai-search-feature-fixtures.cjs');
const base = process.argv[2] || 'http://127.0.0.1:8090';
const output = path.resolve(process.argv[3] || path.join(__dirname, '../../ugc-ai-search-file/verification/browser/asset-features-i18n'));
const soundRows = Array.from({ length: 100 }, (_, i) => ({ id: String(i + 1), nameI18nKey: `soundEffectPlayer.data.${i + 1}`, duration: '1', category: 1, order: i }));
const effectRows = Object.fromEntries(Array.from({ length: 100 }, (_, i) => {
  const id = String(i + 1);
  return [id, { id, nameI18nKey: `effectPlayer.data.${id}`, duration: 1, isLoop: false, tagList: [], icon: '', hasAudio: i < 3, audioPath: i === 2 ? '' : i < 3 ? `${id}.wav` : '' }];
}));
const features = {
  SoundEffectPlayer: createFeatureSidecar('SoundEffectPlayer', {
    1: { audio: { short: { 'zh-cn': '短促的木质敲击', 'en-us': 'A brief wooden knock' }, description: { 'zh-cn': '空心敲击后迅速衰减', 'en-us': 'A hollow knock fades quickly' }, keywords: ['空心木响'], uses: ['机关触发'], possibleSources: ['猜测钟塔'], uncertainDetails: ['未知齿轮'] } },
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
    if (route.request().isNavigationRequest()) state.navigationRequests?.push(url.pathname + url.search);
    const asset = url.pathname.split('/ugc-tool-data/')[1];
    if (asset) {
      if (asset.endsWith('/data.json')) state.dataRequests?.push(asset);
      if (/\.(?:wav|mp3|m4a|opus|mp4|webm)$/u.test(asset)) state.mediaRequests?.push(asset);
      if (asset === 'SoundEffectPlayer/data.json') return route.fulfill({ json: { data: soundRows, category: [{ id: 1, nameI18nKey: 'soundEffectPlayer.category.1' }] } });
      if (asset === 'EffectPlayer/data.json') return route.fulfill({ json: { effectData: effectRows, TagData: {}, category: {} } });
      const featureProject = Object.keys(features).find(project => asset === `${project}/features.json`);
      if (featureProject) {
        state.featureRequests.push(asset);
        state.featureRequestStarted?.();
        if (state.featureResponseGate) await state.featureResponseGate;
        if (state.missing) return route.fulfill({ status: 404, body: '' });
        const { i18n, ...metadata } = features[featureProject];
        return route.fulfill({ json: { ...metadata, i18nSource: 'project-i18n-v1' } });
      }
      if (asset.includes('/i18n/')) {
        state.i18nRequests?.push(asset);
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
  const consoleErrors = [];
  const state = { featureRequests: [], i18nRequests: [] };
  let currentPage;
  try {
    await fs.mkdir(output, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await install(context, state);
    const page = await context.newPage();
    currentPage = page;
    page.on('pageerror', e => { if (!e.message.includes('ResizeObserver')) errors.push(e.message); });
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.goto(`${base}/SoundEffectPlayer?id=1`);
    await page.locator('.sound-feature-details .asset-feature-panel').waitFor();
    assert.match(await page.locator('.sound-feature-details').innerText(), /空心敲击后迅速衰减/u);
    const soundSearch = page.locator('.search-bar input');
    await soundSearch.fill('空心木响');
    await page.locator('.sound-card[data-sound-id="1"]').waitFor();
    assert.equal(await page.locator('.sound-card').count(), 1);
    assert.deepEqual(state.i18nRequests, ['SoundEffectPlayer/i18n/zh-cn.json'], 'Names and descriptions share one selected-language download');
    await soundSearch.fill('wooden knock');
    await page.locator('.empty-result').waitFor();
    await soundSearch.fill('');
    await page.locator('.language-trigger').click();
    await page.getByRole('menuitemradio', { name: 'English', exact: true }).click();
    await page.locator('.sound-feature-details').getByText('A hollow knock fades quickly', { exact: true }).waitFor();
    await soundSearch.fill('wooden knock');
    await page.locator('.sound-card[data-sound-id="1"]').waitFor();
    assert.equal(await page.locator('.sound-card').count(), 1, 'Switching language loads its descriptions and updates search');
    assert.deepEqual(state.i18nRequests, ['SoundEffectPlayer/i18n/zh-cn.json', 'SoundEffectPlayer/i18n/en-us.json']);
    await page.locator('.language-trigger').click();
    await page.getByRole('menuitemradio', { name: '简体中文', exact: true }).click();
    await page.locator('.sound-feature-details').getByText('空心敲击后迅速衰减', { exact: true }).waitFor();
    assert.equal(state.i18nRequests.length, 2, 'Returning to a loaded language reuses its dictionary');
    assert.deepEqual(state.featureRequests, ['SoundEffectPlayer/features.json'], 'Changing languages reuses the shared feature metadata');
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
    assert.deepEqual(state.i18nRequests.filter(asset => asset.startsWith('EffectPlayer/')),
      ['EffectPlayer/i18n/zh-cn.json'], 'Effect names and descriptions share one selected-language download');
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
    currentPage = touchPage;
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
    for (const scenario of [
      { project: 'EffectPlayer', details: '.effect-feature-details', description: '光环缓慢扩大后淡出', prefix: 'effect' },
      { project: 'SoundEffectPlayer', details: '.sound-feature-details', description: '空心敲击后迅速衰减', prefix: 'sound' },
    ]) {
      const missingContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const missingState = { featureRequests: [], dataRequests: [], mediaRequests: [], navigationRequests: [], missing: true };
      await install(missingContext, missingState);
      const missingPage = await missingContext.newPage();
      currentPage = missingPage;
      missingPage.on('pageerror', e => { if (!e.message.includes('ResizeObserver')) errors.push(e.message); });
      await missingPage.goto(`${base}/${scenario.project}?id=1`);
      const details = missingPage.locator(scenario.details);
      await details.getByText(/描述文件暂不可用/u).waitFor();
      const retry = details.getByRole('button', { name: '重试加载描述', exact: true });
      await retry.waitFor();
      await missingPage.waitForLoadState('networkidle');
      assert.deepEqual(missingState.featureRequests, [`${scenario.project}/features.json`]);
      assert.deepEqual(missingState.dataRequests, [`${scenario.project}/data.json`]);
      assert.ok(missingState.mediaRequests.length > 0, 'The selected asset media loaded before retry');
      const previousDataRequests = [...missingState.dataRequests];
      const previousMediaRequests = [...missingState.mediaRequests];
      const previousNavigations = [...missingState.navigationRequests];
      const mediaElements = await missingPage.locator('audio, video').elementHandles();
      assert.ok(mediaElements.length > 0, 'The page has media elements to preserve');
      await missingPage.screenshot({ path: path.join(output, `${scenario.prefix}-missing-descriptions.png`) });

      missingState.missing = false;
      let releaseFeatureResponse;
      const featureRequestStarted = new Promise(resolve => { missingState.featureRequestStarted = resolve; });
      missingState.featureResponseGate = new Promise(resolve => { releaseFeatureResponse = resolve; });
      try {
        await retry.click();
        await featureRequestStarted;
        await details.getByText('正在读取资产描述…', { exact: true }).waitFor();
        assert.ok(await retry.count() === 0 || await retry.isDisabled(), 'Retry is hidden or disabled while loading');
        assert.deepEqual(missingState.featureRequests, [`${scenario.project}/features.json`, `${scenario.project}/features.json`], 'One click starts exactly one new description request');
      } finally {
        releaseFeatureResponse();
      }
      await details.getByText(scenario.description, { exact: true }).waitFor();
      assert.equal(await retry.count(), 0, 'A successful retry removes the retry button');
      await missingPage.waitForLoadState('networkidle');
      assert.deepEqual(missingState.navigationRequests, previousNavigations, 'Retry does not reload or navigate the page');
      assert.deepEqual(missingState.dataRequests, previousDataRequests, 'Retry does not download the asset list again');
      assert.deepEqual(missingState.mediaRequests, previousMediaRequests, 'Retry does not download media again');
      for (const media of mediaElements) assert.equal(await media.evaluate(element => element.isConnected), true, 'Retry preserves the media elements');
      await missingPage.screenshot({ path: path.join(output, `${scenario.prefix}-retried-descriptions.png`) });
      await missingContext.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS asset descriptions: current-language requests, live language switching and search, separated visual/tail/audio, truthful audio gate, playback-stable hover dismissal, touch, missing-file fallback and successful retry without page, data or media reload');
  } catch (error) {
    console.error(JSON.stringify({ errors, consoleErrors, requests: state }, null, 2));
    if (currentPage && !currentPage.isClosed()) {
      await currentPage.screenshot({ path: path.join(output, 'failure.png') });
      console.error((await currentPage.locator('body').innerText()).slice(0, 2000));
    }
    throw error;
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
