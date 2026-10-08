/* NODE_PATH=<bundled playwright modules> node scripts/test-ai-search-browser.cjs [base URL] */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.argv.slice(2).find(argument => !argument.startsWith('--')) || 'http://127.0.0.1:8080';
const modelSelectOnly = process.argv.includes('--model-select-only');
const providerBalanceOnly = process.argv.includes('--provider-balance-only');
const effectAudioOnly = process.argv.includes('--effect-audio-only');
const layoutOnly = process.argv.includes('--layout-only');
const composerOnly = process.argv.includes('--composer-only');
const featureSyncOnly = process.argv.includes('--feature-sync-only');
const outputDirectory = path.join(__dirname, '../tools/ai-search-service/.wrangler');
const { featuresFromLegacy } = require('./ai-search-feature-fixtures.cjs');
const promptFixture = '# Browser external prompt fixture\nCURRENT query selects the asset. Return at most RESULT\\_LIMIT resources.\n';
const fixture = {
  SoundEffectPlayer: { data: [{ id: '10001', nameI18nKey: 'soundEffectPlayer.data.10001', duration: '4', descriptionI18nKey: 'soundEffectPlayer.description.10001' }, { id: '10002', nameI18nKey: 'soundEffectPlayer.data.10002', duration: '1', descriptionI18nKey: 'soundEffectPlayer.description.10002' }], category: [] },
  EffectPlayer: { effectData: { 64: { id: '64', nameI18nKey: 'effectPlayer.data.64', duration: 2, hasAudio: true, audioPath: '64.m4a', audioDescriptionI18nKey: 'effectPlayer.audio.64', visualDescriptionI18nKey: 'effectPlayer.visual.64' }, 4: { id: '4', nameI18nKey: 'effectPlayer.data.4', duration: 2, hasAudio: false } }, TagData: {} },
  BgmPlayer: { data: [{ id: 1, song_id: 7654321, time: 180000, minute: 3, second: 0, nameI18nKey: 'bgmPlayer.data.1', albumI18nKey: 'bgmPlayer.album.1' }], category: [] },
};
const translations = {
  'soundEffectPlayer.data.10001': '环境_雷声_低沉', 'soundEffectPlayer.data.10002': '环境_雷声_短',
  'soundEffectPlayer.description.10001': '持续四秒的雷声轰鸣', 'soundEffectPlayer.description.10002': '一秒的短促雷声',
  'effectPlayer.data.64': '法阵', 'effectPlayer.data.4': '黄色光晕', 'effectPlayer.audio.64': '短促雷声', 'effectPlayer.visual.64': '蓝色光环',
  'bgmPlayer.data.1': '森林探索', 'bgmPlayer.album.1': '夜晚',
};
fixture.SoundEffectPlayer.data.push(
  { id: '40106', nameI18nKey: 'soundEffectPlayer.data.40106', duration: 1 },
  { id: '40107', nameI18nKey: 'soundEffectPlayer.data.40107', duration: 2 },
);
Object.assign(translations, { 'soundEffectPlayer.data.40106': '战斗_受击_拳击_01', 'soundEffectPlayer.data.40107': '角色_受到攻击' });
for (let index = 0; index < 16; index++) {
  const id = String(10001001 + index);
  fixture.EffectPlayer.effectData[id] = { id, nameI18nKey: `effectPlayer.data.${id}`, hasAudio: false };
  translations[`effectPlayer.data.${id}`] = '受击视觉反馈';
}
for (let index = 0; index < 25; index++) {
  const id = String(90001 + index);
  const title = `数量测试_${String(index + 1).padStart(2, '0')}`;
  fixture.SoundEffectPlayer.data.push({ id, nameI18nKey: `soundEffectPlayer.data.${id}`, duration: 1 });
  translations[`soundEffectPlayer.data.${id}`] = title;
}
const quantityAssets = fixture.SoundEffectPlayer.data.filter(item => Number(item.id) >= 90001).map(item => ({ resourceId: `sound:${item.id}`, kind: 'sound', title: translations[item.nameI18nKey], description: '数量测试音效', keywords: ['数量测试'], duration: 1 }));
const fixtureCount = fixture.SoundEffectPlayer.data.length + Object.keys(fixture.EffectPlayer.effectData).length + fixture.BgmPlayer.data.length;
const serverVersion = 'browser-authoritative-v1';
const serverAssets = [
  { resourceId: 'sound:88001', kind: 'sound', title: '服务端长雷声', description: '权威详情：持续四秒的低沉雷声', keywords: ['雷声'], duration: 4, href: 'javascript:alert(1)' },
  { resourceId: 'sound:88002', kind: 'sound', title: '服务端短雷声', description: '权威详情：一秒的雷声', keywords: ['雷声'], duration: 1 },
  { resourceId: 'effect:777', kind: 'effect', title: '服务端法阵', description: '蓝色视觉光环', visualDescription: '蓝色视觉光环', keywords: ['蓝色'], hasAudio: true, duration: 2, audioDescription: '权威音轨详情：短促低沉雷声', audioKeywords: ['雷声', '低沉'], audioSuggestedUses: ['危险提示'] },
];
const explosionAsset = { resourceId: 'effect:778', kind: 'effect', title: '爆炸特效', description: '向外扩散的爆炸光效', keywords: ['爆炸'], hasAudio: false, duration: 2 };
const moreExplosionAsset = { ...explosionAsset, resourceId: 'effect:779', title: '红色爆炸特效' };
const battleMusicAsset = { resourceId: 'bgm:10044', kind: 'bgm', title: '战斗的秘仪', description: '', keywords: [], duration: 180 };
const effectAudioAsset = { resourceId: 'effect:780', kind: 'effect', title: '蓝色护盾', description: '蓝色护盾向外展开', visualDescription: '蓝色护盾向外展开', keywords: ['蓝色'], hasAudio: true, duration: 2, audioDescription: '猛烈爆炸轰鸣', audioKeywords: ['爆炸', '轰鸣'] };
const visualExplosionWindAsset = { ...effectAudioAsset, resourceId: 'effect:781', title: '爆炸闪光', description: '爆炸闪光', visualDescription: '爆炸闪光', keywords: ['爆炸'], audioDescription: '轻微风声', audioKeywords: ['风声'] };
async function install(context, state) {
  context.on('request', request => { if (request.url().includes('/api/ai-search/') || request.url().startsWith('https://model.invalid/')) state.aiHttpRequests = (state.aiHttpRequests || 0) + 1; });
  await context.route('**/ugc-tool-data/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/AISearch/SystemPrompt.md')) {
      state.promptRequests = (state.promptRequests || 0) + 1;
      assert.equal(route.request().headers().authorization, undefined, 'OSS receives no model key');
      return route.fulfill({ contentType: 'text/markdown; charset=utf-8', body: promptFixture });
    }
    const project = Object.keys(fixture).find(key => path.includes(`/${key}/`));
    if (!project) return route.fulfill({ status: 404, body: '{}' });
    const featureSource = project === 'BgmPlayer' ? undefined : { project, kind: project === 'SoundEffectPlayer' ? 'sound' : 'effect', namespace: project === 'SoundEffectPlayer' ? 'soundEffectPlayer' : 'effectPlayer', data: fixture[project], dictionaries: { 'zh-CN': translations } };
    const sidecar = featureSource ? featuresFromLegacy(featureSource) : undefined;
    if (state.localMissingAudio && project === 'EffectPlayer') {
      for (const entry of Object.values(sidecar.resources)) if (entry.searchMetadata.audio) entry.searchMetadata.audio = { status: 'not_generated' };
      for (const locale of Object.values(sidecar.i18n)) for (const key of Object.keys(locale)) if (key.includes('.audio.')) delete locale[key];
    }
    if (path.endsWith('/features.json') && project !== 'BgmPlayer') {
      if (state.localFeaturesMissing) return route.fulfill({ status: 404, body: '' });
      const { i18n, ...metadata } = sidecar;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...metadata, i18nSource: 'project-i18n-v1' }) });
    }
    if (!path.endsWith('/data.json') && !path.includes('/i18n/')) return route.fulfill({ status: 404, body: '' });
    let data = fixture[project];
    if (state.localMissingAudio && project === 'EffectPlayer') data = { ...data, effectData: Object.fromEntries(Object.entries(data.effectData).map(([id, item]) => [id, { id: item.id, nameI18nKey: item.nameI18nKey, hasAudio: item.hasAudio, audioPath: item.audioPath, visualDescriptionI18nKey: item.visualDescriptionI18nKey }])) };
    const locale = path.match(/\/i18n\/([^/]+)\.json$/u)?.[1];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(path.endsWith('/data.json') ? data : { ...translations, ...sidecar?.i18n[locale] }) });
  });
  await context.route('**/api/ai-search/config', async route => {
    state.configRequests = (state.configRequests || 0) + 1;
    const body = JSON.stringify(state.config);
    if (state.pendingConfigResponse) await state.pendingConfigResponse;
    return route.fulfill({ contentType: 'application/json', body });
  });
  await context.route('**/api/ai-search/catalog', route => {
    state.catalogRequests = (state.catalogRequests || 0) + 1;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ catalogVersion: state.catalogVersion || serverVersion, ...(state.featureSync ? { featureSync: state.featureSync } : {}), counts: { total: 3000 }, mode: 'hybrid', coverage: { description: 1 } }) });
  });
  await context.route('**/api/ai-search/search', async route => {
    const payload = route.request().postDataJSON(); (state.searchRequests ||= []).push(payload);
    (state.events ||= []).push('search');
    if (state.searchFails) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"SEARCH_UNAVAILABLE"}}' });
    if (state.effectAudioScenario) {
      if (state.oldMatchOnWorker && payload.matchOn) return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":{"code":"INVALID_SEARCH"}}' });
      const audioEffects = payload.scope === 'effect' && payload.matchOn === 'audio';
      const items = audioEffects ? state.effectAudioDescriptionsMissing ? [] : [{ ...effectAudioAsset, description: effectAudioAsset.audioDescription, audioMatch: true, keywords: effectAudioAsset.audioKeywords }] : payload.scope === 'effect' ? [visualExplosionWindAsset] : [serverAssets[0]];
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ catalogVersion: state.catalogVersion || serverVersion, ...(state.featureSync ? { featureSync: state.featureSync } : {}), mode: 'keyword', total: items.length, hasMore: false, items, ...(audioEffects && state.effectAudioDescriptionsMissing ? { retrievalNotice: { code: 'EFFECT_AUDIO_DESCRIPTION_MISSING' } } : {}) }) });
    }
    if (state.quantityScenario && (payload.query.includes('数量测试') || payload.previousQuery?.includes('数量测试'))) {
      const excluded = new Set(payload.excludeIds || []);
      const available = quantityAssets.filter(item => !excluded.has(item.resourceId));
      const offset = payload.cursor ? Number(payload.cursor.replace('quantity-', '')) : 0;
      const items = available.slice(offset, offset + payload.limit);
      const hasMore = offset + items.length < available.length;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ catalogVersion: state.catalogVersion || serverVersion, ...(state.featureSync ? { featureSync: state.featureSync } : {}), mode: 'keyword', total: available.length, hasMore, ...(hasMore ? { nextCursor: `quantity-${offset + items.length}` } : {}), items, coverage: { description: 1 } }) });
    }
    if (state.intentScenario) {
      const music = payload.scope === 'bgm';
      const excluded = new Set(payload.excludeIds || []);
      const items = (music ? payload.query === '战斗' ? [battleMusicAsset] : [] : [explosionAsset, moreExplosionAsset]).filter(item => !excluded.has(item.resourceId));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ catalogVersion: state.catalogVersion || serverVersion, ...(state.featureSync ? { featureSync: state.featureSync } : {}), mode: 'keyword', total: items.length, hasMore: false, items, coverage: { description: 1 }, ...(music ? { retrievalNotice: { code: 'MUSIC_DESCRIPTION_MISSING' } } : {}) }) });
    }
    const ordered = payload.previousIds?.length ? [...serverAssets].sort((a, b) => a.duration - b.duration) : serverAssets;
    const items = ordered.map(item => ({ ...item, description: item.kind === 'effect' ? item.audioDescription : '摘要：雷声', keywords: item.kind === 'effect' ? item.audioKeywords : item.keywords, audioMatch: item.kind === 'effect' }));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ catalogVersion: state.catalogVersion || serverVersion, ...(state.featureSync ? { featureSync: state.featureSync } : {}), mode: 'keyword', total: items.length, hasMore: false, items, coverage: { description: 1 } }) });
  });
  await context.route('**/api/ai-search/assets', async route => {
    const payload = route.request().postDataJSON(); (state.assetRequests ||= []).push(payload);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ catalogVersion: state.catalogVersion || serverVersion, ...(state.featureSync ? { featureSync: state.featureSync } : {}), items: [...serverAssets, explosionAsset, moreExplosionAsset, battleMusicAsset, effectAudioAsset, visualExplosionWindAsset, ...quantityAssets].filter(item => payload.ids.includes(item.resourceId)) }) });
  });
  await context.route('**/api/ai-search/chat', async route => {
    const payload = route.request().postDataJSON(); state.freeRequests.push(payload);
    if (state.pendingFreeResponse) await state.pendingFreeResponse;
    if (state.chatErrorCode) return route.fulfill({ status: state.chatErrorStatus || 503, contentType: 'application/json', body: JSON.stringify({ error: { code: state.chatErrorCode, ...(state.chatErrorReason !== undefined ? { reason: state.chatErrorReason } : {}), ...state.privateErrorFields } }) });
    if (state.exhausted) return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'FREE_QUOTA_EXHAUSTED' } }) });
    if (payload.workflow === 'agent') {
      if (state.effectAudioScenario) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ answer: '特效音轨中的爆炸轰鸣匹配。', matches: [{ resourceId: effectAudioAsset.resourceId, reason: '音轨描述为爆炸轰鸣', matchType: 'feature' }], resources: [{ ...effectAudioAsset, audioMatch: true }], catalogVersion: state.catalogVersion || serverVersion, ...(state.featureSync ? { featureSync: state.featureSync } : {}), mode: 'keyword', model: 'fixture-free' }) });
      if (state.quantityScenario && payload.query.includes('数量测试')) {
        const resources = quantityAssets.slice(0, payload.resultLimit);
        const matches = resources.map(item => ({ resourceId: item.resourceId, reason: '数量测试词条匹配', matchType: 'feature' }));
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ answer: '工具检索已完成。', matches, resources, catalogVersion: state.catalogVersion || serverVersion, ...(state.featureSync ? { featureSync: state.featureSync } : {}), mode: 'keyword', model: 'fixture-free', quota: { remaining: 4, limit: 5, resetAt: '2026-10-09T00:00:00+08:00' } }) });
      }
      const candidate = payload.query.includes('爆炸') ? explosionAsset : serverAssets[0];
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ answer: '工具检索已完成。', matches: [{ resourceId: candidate.resourceId, reason: '真实资产依据', matchType: 'feature' }], resources: [candidate], catalogVersion: state.catalogVersion || serverVersion, ...(state.featureSync ? { featureSync: state.featureSync } : {}), mode: 'keyword', model: 'fixture-free', quota: { remaining: 4, limit: 5, resetAt: '2026-10-09T00:00:00+08:00' } }) });
    }
    const server = Array.isArray(payload.candidateIds);
    const candidate = server ? serverAssets.find(item => item.resourceId === 'effect:777') : state.freeRequests.length === 1 ? payload.candidates.find(item => item.resourceId === 'effect:64') : payload.candidates[0];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ answer: '找到匹配资源。', matches: candidate ? [{ resourceId: candidate.resourceId, reason: '雷声特征', matchType: 'feature' }] : [], model: 'fixture-free', quota: { remaining: Math.max(0, 5 - state.freeRequests.length), limit: 5, resetAt: '2026-10-09T00:00:00+08:00' }, ...(server ? { catalogVersion: state.catalogVersion || serverVersion, ...(state.featureSync ? { featureSync: state.featureSync } : {}), resources: candidate ? [candidate] : [] } : {}) }) });
  });
  await context.route('https://model.invalid/**', async route => {
    state.customRequests.push({ payload: route.request().postDataJSON(), authorization: route.request().headers().authorization });
    (state.events ||= []).push('model');
    if (state.delay) await new Promise(resolve => setTimeout(resolve, 1500));
    const modelRequest = state.customRequests.at(-1).payload;
    const system = modelRequest.messages[0].content;
    assert.ok(system.includes('Browser external prompt fixture'), 'Custom model system messages use the OSS file');
    assert.ok(!/RESULT(?:\\_)?LIMIT/u.test(system), 'Result-limit placeholders are expanded before model calls');
    if (modelRequest.tools) {
      const tasks = modelRequest.messages.filter(message => message.role === 'user').flatMap(message => {
        try { const value = JSON.parse(message.content); return value.query ? [value] : []; } catch { return []; }
      });
      const task = tasks.at(-1);
      const toolResults = modelRequest.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
      const latest = toolResults.at(-1);
      if (state.effectAudioScenario) {
        if (!latest) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: `browser_audio_${state.customRequests.length}`, type: 'function', function: { name: 'search_assets', arguments: JSON.stringify({ query: '爆炸', scope: 'effect', matchOn: 'audio', searchType: 'feature', filters: { hasAudio: true } }) } }] } }] }) });
        if (latest.items.length && toolResults.length === 1) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: `browser_audio_detail_${state.customRequests.length}`, type: 'function', function: { name: 'get_assets', arguments: JSON.stringify({ ids: [effectAudioAsset.resourceId] }) } }] } }] }) });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answer: latest.items.length ? '找到带爆炸音轨的特效。' : '特效音轨尚无特征描述，无法确认爆炸音效。', matches: latest.items.length ? [{ resourceId: effectAudioAsset.resourceId, reason: '音轨描述为爆炸轰鸣', matchType: 'feature' }] : [] }) } }] }) });
      }
      if (state.quantityScenario && task.query.includes('数量测试')) {
        if (!latest) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: `browser_quantity_${state.customRequests.length}`, type: 'function', function: { name: 'search_assets', arguments: JSON.stringify({ query: task.query, scope: 'sound', limit: task.resultLimit }) } }] } }] }) });
        const matches = latest.items.slice(0, task.resultLimit).map(item => ({ resourceId: item.resourceId, reason: '数量测试词条匹配', matchType: 'feature' }));
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answer: '已通过工具找到资源。', matches }) } }] }) });
      }
      if (!latest || latest.items?.length === 0 && toolResults.length === 1 && /音乐/u.test(task.query)) {
        const music = /音乐/u.test(task.query);
        const more = /再来点/u.test(task.query);
        const query = latest ? /激昂/u.test(task.query) ? '战斗' : '轻松' : more ? '爆炸' : task.query;
        const scope = task.scope !== 'all' ? task.scope : music ? 'bgm' : /特效|再来点/u.test(task.query) ? 'effect' : 'sound';
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: `browser_call_${state.customRequests.length}`, type: 'function', function: { name: 'search_assets', arguments: JSON.stringify({ query, scope, ...(more ? { excludePrevious: true } : {}) }) } }] } }] }) });
      }
      const candidate = latest.items?.[0];
      const answer = { answer: candidate ? candidate.kind === 'bgm' ? '按战斗标题推荐，请试听；现有资料不能确认节奏和情绪。' : '已通过工具找到资源。' : '音乐尚未提供情绪和节奏描述，换词搜索后也没有可靠结果。', matches: candidate ? [{ resourceId: candidate.resourceId, reason: candidate.kind === 'bgm' ? '仅根据战斗标题推荐' : '工具返回的真实资料', matchType: candidate.kind === 'bgm' ? 'suggestion' : 'feature' }] : [] };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }] }) });
    }
    const payload = JSON.parse(state.customRequests.at(-1).payload.messages.at(-1).content);
    const candidate = payload.candidates[0];
    const answer = { answer: '<img src=x onerror=alert(1)>', matches: state.invented ? [{ resourceId: 'sound:99999999', reason: 'invented', matchType: 'feature' }] : candidate ? [{ resourceId: candidate.resourceId, reason: 'matching evidence', matchType: 'feature' }] : [] };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: state.truncated ? 'length' : 'stop', message: { content: JSON.stringify(answer) } }] }) }).catch(() => {});
  });
}
async function send(page, text) {
  await page.locator('#asset-query').fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '停止', exact: true }).waitFor({ state: 'hidden' });
}
async function getSearchMode(page) {
  return page.locator('.model-trigger').getAttribute('data-search-mode');
}
async function chooseSearchMode(page, value) {
  if (await getSearchMode(page) === value) return;
  await page.locator('.model-trigger').click();
  const dialog = page.locator('.model-dialog');
  await dialog.locator(`.model-mode-options [data-search-mode-option="${value}"]`).click();
  await dialog.locator('button.primary-button[type="submit"]').click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(expected => document.querySelector('.model-trigger')?.dataset.searchMode === expected, value);
}
async function getResultLimit(page) {
  const value = await page.locator('#search-result-limit').innerText();
  return value.match(/\d+/u)?.[0];
}
async function chooseResultLimit(page, value) {
  await page.locator('#search-result-limit').click();
  await page.locator('[data-result-limit-option="' + value + '"]').click();
}
async function testComposer(browser, mobile = false) {
  const rawFreeName = `deepseek-${'extended-model-name-'.repeat(6)}`;
  const freeName = rawFreeName.slice(0, 100);
  const customName = `personal-${'extended-model-name-'.repeat(4)}`;
  const quota = { remaining: 5, limit: 5, resetAt: '2026-10-09T00:00:00+08:00' };
  const state = { config: { configured: true, available: true, model: rawFreeName, quota, limits: { maxResults: 20, maxPreviousIds: 20 } }, freeRequests: [], customRequests: [] };
  const context = await browser.newContext({ locale: 'zh-CN', viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  await install(context, state);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const input = page.locator('#asset-query');
  const trigger = page.locator('.model-trigger');
  const dialog = page.locator('.model-dialog');
  async function assertRow(label, longModel = false) {
    const bounds = await page.evaluate(() => {
      const rect = selector => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
      };
      const label = document.querySelector('.model-trigger-label');
      return { composer: rect('.composer-box'), input: rect('#asset-query'), model: rect('.model-trigger'), send: rect('.send-button'), labelOverflow: getComputedStyle(label).textOverflow, labelScroll: label.scrollWidth, labelWidth: label.clientWidth, viewportWidth: innerWidth, pageWidth: document.documentElement.scrollWidth };
    });
    assert.ok(bounds.input.right <= bounds.model.x + 1 && bounds.model.right <= bounds.send.x + 1, `${label}: input, model and send appear in order on one row`);
    assert.ok(bounds.input.y < bounds.send.bottom && bounds.input.bottom > bounds.send.y && bounds.model.y < bounds.send.bottom && bounds.model.bottom > bounds.send.y, `${label}: controls share the input row`);
    assert.ok(bounds.composer.right <= bounds.viewportWidth + 1 && bounds.pageWidth <= bounds.viewportWidth + 1, `${label}: long names do not overflow the screen`);
    assert.ok(bounds.send.right <= bounds.composer.right + 1 && bounds.input.width >= 50, `${label}: the composer retains usable input and send space (${bounds.input.width}px input)`);
    assert.ok(Math.abs(bounds.send.width - bounds.send.height) < 1, `${label}: sending uses a square circular control`);
    if (longModel) {
      assert.equal(bounds.labelOverflow, 'ellipsis', 'Long personal model names use an ellipsis');
      assert.ok(bounds.labelScroll > bounds.labelWidth, 'The fixture exercises an actually clipped long personal model label');
    } else {
      assert.ok(bounds.labelScroll <= bounds.labelWidth + 1, 'The generic free label remains completely readable');
    }
  }
  async function assertFreeLabel(remaining) {
    await page.waitForFunction(expected => {
      const trigger = document.querySelector('.model-trigger');
      const label = trigger?.querySelector('.model-trigger-label')?.textContent;
      const quota = trigger?.querySelector('.model-trigger-quota')?.textContent.replace(/\s/gu, '');
      return label === '站点 AI' && (expected === null ? quota === undefined : quota === `·剩余${expected}次`);
    }, remaining ?? null);
    assert.equal(await trigger.locator('.model-trigger-label').innerText(), '站点 AI', 'Free mode uses the generic service label');
    const visible = (await trigger.innerText()).replace(/\s/gu, '');
    if (remaining === undefined) assert.ok(!/剩余\d+次/u.test(visible), 'Unknown quota does not invent a remaining count');
    else assert.ok(visible.includes(`站点AI·剩余${remaining}次`), `The button directly displays the true remaining quota (${remaining})`);
    assert.ok(!(await trigger.getAttribute('title')).includes(freeName), 'The button title does not expose the upstream free model ID');
    const metrics = await trigger.evaluate(element => {
      const labels = [...element.querySelectorAll('span')].filter(span => /剩余/u.test(span.textContent));
      const box = element.getBoundingClientRect();
      return labels.map(span => ({ scroll: span.scrollWidth, width: span.clientWidth, right: span.getBoundingClientRect().right, buttonRight: box.right }));
    });
    assert.ok(metrics.every(metric => metric.scroll <= metric.width + 1 && metric.right <= metric.buttonRight + 1), 'The remaining-count text stays readable inside the button');
  }
  async function focusRestored() {
    await page.waitForFunction(() => document.activeElement?.classList.contains('model-trigger'));
  }
  async function openMode(value) {
    await trigger.click();
    await dialog.locator(`[data-search-mode-option="${value}"]`).click();
    assert.equal(await dialog.locator(`[data-search-mode-option="${value}"]`).getAttribute('aria-pressed'), 'true');
  }
  try {
    await page.goto(`${base}/AISearch`);
    await page.locator('.retrieval-status').waitFor();
    assert.equal(await getSearchMode(page), 'free');
    assert.equal(await trigger.getAttribute('aria-haspopup'), 'dialog');
    await assertFreeLabel(5);
    assert.ok(!(await page.locator('body').innerText()).includes(freeName), 'The raw free model ID is not shown on the page');
    assert.equal(await page.locator('.composer-bottom,.keyboard-hint,.clear-context,.settings-button,.search-mode-select').count(), 0, 'The simplified input has no Enter hint, context reset, old settings button or dropdown');
    await assertRow(mobile ? 'Mobile free input' : 'Desktop free input');
    if (mobile) {
      await page.setViewportSize({ width: 360, height: 844 });
      await assertRow('Narrow mobile free input');
      await assertFreeLabel(5);
      await page.setViewportSize({ width: 390, height: 844 });
    } else {
      await page.locator('.ai-search-workspace').evaluate(element => { element.style.width = '594px'; });
      await page.waitForFunction(() => Math.abs(document.querySelector('.search-main').getBoundingClientRect().width - 360) < 1);
      await assertRow('Desktop minimum-width free input');
      await assertFreeLabel(5);
      await page.locator('.ai-search-workspace').evaluate(element => { element.style.width = ''; });
    }
    await page.screenshot({ path: path.join(outputDirectory, `ai-search-composer-${mobile ? 'mobile' : 'desktop'}.png`), fullPage: true });
    const initialRequests = state.aiHttpRequests;
    await trigger.click();
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(await dialog.locator('.model-mode-options button').count(), 3);
    assert.ok(!(await dialog.innerText()).includes(freeName), 'The free settings panel does not expose the raw model ID');
    assert.ok((await dialog.innerText()).includes('站点 AI'));
    assert.equal(await dialog.getByLabel(/^API Key/).count(), 0, 'The free service has no user API key field');
    if (!mobile) await page.screenshot({ path: path.join(outputDirectory, 'ai-search-composer-free-dialog.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await focusRestored();
    await openMode('custom');
    assert.equal(await getSearchMode(page), 'free', 'Selecting a draft mode does not apply it');
    await dialog.getByLabel('模型名称', { exact: true }).fill('discarded-model');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await focusRestored();
    assert.equal(await getSearchMode(page), 'free', 'Cancel preserves the actual model mode');
    await openMode('basic');
    assert.equal(await getSearchMode(page), 'free');
    assert.equal(await dialog.locator('.basic-model-panel').count(), 1);
    assert.equal(await dialog.getByLabel(/^API Key/).count(), 0);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await focusRestored();
    assert.equal(await getSearchMode(page), 'free', 'Escape also discards draft changes');
    await chooseSearchMode(page, 'basic');
    await focusRestored();
    await waitArchive(page, 'basic');
    await page.reload();
    await page.locator('.retrieval-status').waitFor();
    assert.equal(await getSearchMode(page), 'basic', 'Confirmed mode restores from the browser archive');
    await openMode('custom');
    assert.notEqual(await dialog.getByLabel('模型名称', { exact: true }).inputValue(), 'discarded-model', 'Cancelled config edits are not retained');
    await dialog.getByLabel(/^API 基础地址/).fill('https://model.invalid/v1');
    await dialog.getByLabel('模型名称', { exact: true }).fill(customName);
    await dialog.getByLabel(/^API Key/).fill('composer-test-placeholder');
    await dialog.locator('button.primary-button[type="submit"]').click();
    await dialog.waitFor({ state: 'hidden' });
    await focusRestored();
    assert.equal(await getSearchMode(page), 'custom');
    assert.equal(await trigger.locator('.model-trigger-label').innerText(), customName);
    await assertRow(mobile ? 'Mobile personal input' : 'Desktop personal input', true);
    if (!mobile) {
      // A host panel can become narrower than the browser viewport itself.
      await page.locator('.ai-search-workspace').evaluate(element => { element.style.width = '594px'; });
      await page.waitForFunction(() => Math.abs(document.querySelector('.search-main').getBoundingClientRect().width - 360) < 1);
      await assertRow('Desktop chat at minimum width', true);
      await page.screenshot({ path: path.join(outputDirectory, 'ai-search-composer-narrow.png'), fullPage: true });
      await page.locator('.ai-search-workspace').evaluate(element => { element.style.width = ''; });
    }
    assert.equal(state.freeRequests.length, 0);
    assert.equal(state.customRequests.length, 0);
    assert.ok(state.aiHttpRequests - initialRequests <= 1, 'Mode/config interactions invoke no search or model API; reload only rechecks config');
    await chooseSearchMode(page, 'free');
    await input.fill('第一行');
    await input.press('Shift+Enter');
    await page.keyboard.type('第二行');
    assert.equal(await input.inputValue(), '第一行\n第二行', 'Shift+Enter inserts a newline');
    assert.equal(await page.locator('.chat-message').count(), 0);
    await input.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
    assert.equal(state.freeRequests.length, 0, 'An IME composing Enter does not submit');
    assert.equal(await input.inputValue(), '第一行\n第二行');
    await input.fill('雷声');
    await input.press('Enter');
    await page.getByRole('button', { name: '停止', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(state.freeRequests.length, 1, 'Plain Enter submits once');
    assert.equal(await input.inputValue(), '');
    await assertFreeLabel(4);
    assert.ok(!(await trigger.innerText()).includes('fixture-free'), 'Free chat responses never replace the generic label with an upstream ID');
    assert.ok((await trigger.getAttribute('title')).includes('4'), 'The existing free quota is available in the model button title');
    state.config = { ...state.config, model: 'fixture-free', quota: { ...quota, remaining: 4 } };
    await waitArchive(page, 'free', undefined, false, { cardCount: 1 });
    await page.reload();
    await page.locator('.retrieval-status').waitFor();
    assert.equal(await getSearchMode(page), 'free');
    await assertFreeLabel(4);
    assert.equal((await readAllResults(page.locator('.chat-message').last())).length, 1, 'Free conversation cards still restore');
    assert.ok((await trigger.getAttribute('title')).includes('4'), 'Refresh fetches the current free quota');
    await trigger.click();
    assert.ok((await dialog.locator('.free-panel-footer').innerText()).includes('4'), 'Free quota is also available in model settings');
    const healthyConfig = state.config;
    state.config = { available: true, model: 'invalid-config-model' };
    await dialog.getByRole('button', { name: '刷新状态', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.free-status-pill')?.classList.contains('available'));
    await assertFreeLabel(undefined);
    state.config = healthyConfig;
    await dialog.getByRole('button', { name: '刷新状态', exact: true }).click();
    await dialog.getByText('可用', { exact: true }).waitFor();
    await assertFreeLabel(4);
    assert.ok(!(await dialog.innerText()).includes('fixture-free'), 'A successful refresh keeps free settings generic');
    state.config = { ...healthyConfig, quota: { ...quota, remaining: 2 } };
    await dialog.getByRole('button', { name: '刷新状态', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.model-trigger')?.textContent.includes('2'));
    await assertFreeLabel(2);
    state.config = { ...healthyConfig, quota: { ...quota, remaining: 0 } };
    await dialog.getByRole('button', { name: '刷新状态', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.model-trigger')?.textContent.includes('0'));
    await assertFreeLabel(0);
    await input.fill('雷声');
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true, 'An actual zero quota is displayed and blocks free submission');
    state.config = { ...healthyConfig, quota: undefined };
    await dialog.getByRole('button', { name: '刷新状态', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.model-trigger-quota') && document.querySelector('.free-status-pill')?.classList.contains('available'));
    await assertFreeLabel(undefined);
    state.config = healthyConfig;
    await dialog.getByRole('button', { name: '刷新状态', exact: true }).click();
    await dialog.getByText('可用', { exact: true }).waitFor();
    await assertFreeLabel(4);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await chooseSearchMode(page, 'custom');
    await waitArchive(page, 'custom');
    await page.reload();
    await page.locator('.retrieval-status').waitFor();
    assert.equal(await getSearchMode(page), 'custom');
    assert.equal(await trigger.locator('.model-trigger-label').innerText(), customName, 'The saved personal model is used after reload');
    await assertRow(mobile ? 'Restored mobile input' : 'Restored desktop input', true);
    assert.equal(state.customRequests.length, 0, 'Configuration checks do not invoke the personal model');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}
async function testProviderBalance(browser) {
  const text = JSON.parse(await fs.readFile(path.join(__dirname, '../src/i18n/locales/aiSearch/zh-cn.json'), 'utf8'));
  const lowHint = threshold => `站点 AI 余额低于 ${threshold} 元，已暂停服务。请稍后重试，或使用自己的模型 / 基础搜索。`;
  const unavailableHint = '暂时无法核实站点 AI 的余额，服务已暂停。请稍后重试，或使用自己的模型 / 基础搜索。';
  const hiddenFreeModel = 'deepseek-server-model-not-for-display';
  const healthyConfig = { configured: true, available: true, model: hiddenFreeModel, retrieval: { available: true }, agent: { available: true }, limits: { maxResults: 20, maxPreviousIds: 20, minBalanceCny: 20 } };
  const privateBalanceProbe = 17.123456789;
  const privateKeyProbe = 'private-server-key-must-never-be-displayed';
  const privateProviderMessage = 'private-provider-message-must-never-be-displayed';
  const privateErrorFields = { apiKey: privateKeyProbe, total_balance: privateBalanceProbe, message: privateProviderMessage };
  const state = { config: { ...healthyConfig, available: false, limits: { ...healthyConfig.limits, minBalanceCny: 25.5 }, error: { code: 'PROVIDER_BALANCE_LOW', ...privateErrorFields }, privateBalanceProbe }, privateErrorFields, freeRequests: [], customRequests: [] };
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1366, height: 900 } });
  await install(context, state);
  const page = await context.newPage();
  const errors = [];
  let releaseChat;
  let releaseConfig;
  page.on('pageerror', error => errors.push(error.message));
  async function refreshStatus(expectedHint) {
    await page.getByRole('button', { name: /^模型设置(?: ·|$)/u }).click();
    const dialog = page.locator('.model-dialog');
    await dialog.locator('[data-search-mode-option="free"]').click();
    await dialog.getByRole('button', { name: '刷新状态', exact: true }).click();
    if (expectedHint) await dialog.getByText(expectedHint, { exact: true }).waitFor();
    else await dialog.getByText('可用', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
  }
  async function assertFreeBlocked(hint, calls) {
    await chooseSearchMode(page, 'free');
    assert.equal(await page.locator('.model-trigger-label').innerText(), '站点 AI', 'A balance failure preserves the generic free service label');
    assert.ok(!(await page.locator('.model-trigger').getAttribute('title')).includes(hiddenFreeModel));
    await page.locator('.composer-area .inline-notice').filter({ hasText: hint }).waitFor();
    await page.locator('#asset-query').fill('雷声');
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true, 'A provider balance failure disables free submission');
    await page.locator('#asset-query').press('Enter');
    assert.equal(state.freeRequests.length, calls, 'Blocked free searches do not call chat');
  }
  try {
    await page.goto(`${base}/AISearch`);
    await page.locator('.retrieval-status').waitFor();
    await assertFreeBlocked(lowHint(25.5), 0);
    assert.equal(await page.locator('.model-trigger-quota').count(), 0, 'Unknown daily quota is not rendered as an invented count');
    await page.getByRole('button', { name: /^模型设置(?: ·|$)/u }).click();
    await page.locator('.model-dialog').getByText(lowHint(25.5), { exact: true }).waitFor();
    assert.ok(!(await page.locator('.model-dialog').innerText()).includes(hiddenFreeModel), 'Free settings do not reveal the actual provider model ID while unavailable');
    await page.keyboard.press('Escape');
    state.config = { ...healthyConfig, available: false, limits: { maxResults: 20, maxPreviousIds: 20 }, error: { code: 'PROVIDER_BALANCE_LOW' }, privateBalanceProbe };
    await refreshStatus(lowHint(20));
    await assertFreeBlocked(lowHint(20), 0);
    state.config.error.code = 'PROVIDER_BALANCE_UNAVAILABLE';
    await refreshStatus(unavailableHint);
    await assertFreeBlocked(unavailableHint, 0);
    assert.equal(await page.getByText('模型服务连接失败，请检查地址、网络及服务商的跨域支持', { exact: true }).count(), 0, 'Balance verification errors are not rendered as a generic network error');
    const reasons = ['MISSING_KEY', 'AUTH', 'FORBIDDEN', 'RATE_LIMIT', 'UPSTREAM_ERROR', 'TIMEOUT', 'NETWORK', 'INVALID_RESPONSE', 'CNY_MISSING', 'ACCOUNT_UNAVAILABLE', 'ABORTED'];
    const reasonHint = reason => text[`aiSearch.errors.providerBalanceReason.${reason}`].replace('{threshold}', '20');
    for (const reason of reasons) {
      state.config = { ...healthyConfig, available: false, error: { code: 'PROVIDER_BALANCE_UNAVAILABLE', reason, ...privateErrorFields } };
      await refreshStatus(reasonHint(reason));
      await assertFreeBlocked(reasonHint(reason), 0);
    }
    for (const reason of [privateProviderMessage, { apiKey: privateKeyProbe }, ['AUTH']]) {
      state.config = { ...healthyConfig, available: false, error: { code: 'PROVIDER_BALANCE_UNAVAILABLE', reason, ...privateErrorFields } };
      await refreshStatus(unavailableHint);
      await assertFreeBlocked(unavailableHint, 0);
    }
    assert.ok(!(await page.locator('body').innerText()).includes(privateKeyProbe), 'A config error cannot display private server credentials');
    assert.ok(!(await page.locator('body').innerText()).includes(privateProviderMessage), 'A config error cannot display arbitrary provider messages');
    await chooseSearchMode(page, 'basic');
    await send(page, '雷声');
    assert.ok((await readAllResults(page.locator('.chat-message').last())).length > 0, 'Basic search remains usable while the site provider balance is unavailable');
    await page.getByRole('button', { name: /^模型设置(?: ·|$)/u }).click();
    const dialog = page.locator('.model-dialog');
    await dialog.locator('[data-search-mode-option="custom"]').click();
    await dialog.getByLabel(/^API 基础地址/).fill('https://model.invalid/v1');
    await dialog.getByLabel('模型名称', { exact: true }).fill('fixture-custom');
    await dialog.getByLabel(/^API Key/).fill('balance-test-placeholder');
    await dialog.locator('button.primary-button[type="submit"]').click();
    await send(page, '雷声');
    assert.ok(await page.locator('.chat-message').last().locator('.resource-card').count(), 'A personal model remains usable while site free AI is paused');
    assert.equal(state.customRequests.length, 2);
    assert.equal(state.freeRequests.length, 0);
    state.config = { ...healthyConfig };
    await refreshStatus();
    await chooseSearchMode(page, 'free');
    for (const [code, hint] of [['PROVIDER_BALANCE_LOW', lowHint(20)], ['PROVIDER_BALANCE_UNAVAILABLE', unavailableHint]]) {
      state.chatErrorCode = code;
      const configCalls = state.configRequests;
      const freeCalls = state.freeRequests.length;
      if (code === 'PROVIDER_BALANCE_LOW') {
        state.pendingFreeResponse = new Promise(resolve => { releaseChat = resolve; });
        await page.getByRole('button', { name: /^模型设置(?: ·|$)/u }).click();
        state.pendingConfigResponse = new Promise(resolve => { releaseConfig = resolve; });
        const oldStatusResponse = page.waitForResponse(response => response.url().endsWith('/api/ai-search/config'));
        await page.locator('.model-dialog').getByRole('button', { name: '刷新状态', exact: true }).click();
        assert.equal(await page.locator('.model-dialog').getByRole('button', { name: '刷新状态', exact: true }).isDisabled(), true);
        await page.keyboard.press('Escape');
        const sending = send(page, '雷声');
        await page.getByRole('button', { name: '停止', exact: true }).waitFor();
        assert.equal(await page.locator('.model-trigger').isDisabled(), true, 'The model settings button cannot change modes while a search is in progress');
        releaseChat(); state.pendingFreeResponse = undefined;
        await sending;
        releaseConfig(); state.pendingConfigResponse = undefined;
        await (await oldStatusResponse).finished();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      } else await send(page, '雷声');
      assert.equal(state.freeRequests.length, freeCalls + 1);
      assert.equal(await page.locator('.chat-message').last().locator('.message-text').innerText(), hint, 'A real-time balance rejection explains why free AI is paused');
      assert.equal(await page.locator('.chat-message').last().locator('.resource-card').count(), 0);
      await assertFreeBlocked(hint, freeCalls + 1);
      assert.equal(state.configRequests, configCalls + (code === 'PROVIDER_BALANCE_LOW' ? 1 : 0), 'A chat balance failure does not automatically refresh, and an earlier healthy response cannot re-enable free AI');
      await page.getByRole('button', { name: /^模型设置(?: ·|$)/u }).click();
      await page.locator('.model-dialog').getByText(hint, { exact: true }).waitFor();
      await page.keyboard.press('Escape');
      state.chatErrorCode = undefined;
      await refreshStatus();
      assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isEnabled(), true, 'Refreshing a healthy configuration restores free search without reloading');
      await send(page, '雷声');
      assert.equal(state.freeRequests.length, freeCalls + 2);
      assert.equal(await page.locator('.chat-message').last().locator('.resource-card').count(), 1);
    }
    for (const agentAvailable of [true, false]) {
      state.config = { ...healthyConfig, agent: { available: agentAvailable } };
      await refreshStatus();
      for (const reason of ['AUTH', 'TIMEOUT', privateProviderMessage, undefined]) {
        const hint = reason === 'AUTH' || reason === 'TIMEOUT' ? reasonHint(reason) : unavailableHint;
        state.chatErrorCode = 'PROVIDER_BALANCE_UNAVAILABLE';
        state.chatErrorReason = reason;
        const configCalls = state.configRequests, freeCalls = state.freeRequests.length;
        await send(page, '雷声');
        assert.equal(state.freeRequests.length, freeCalls + 1, 'A rejected balance check never retries a paid chat automatically');
        assert.equal(state.freeRequests.at(-1).workflow === 'agent', agentAvailable, 'Both agent and legacy free chat preserve safe balance reasons');
        assert.equal(await page.locator('.chat-message').last().locator('.message-text').innerText(), hint);
        await assertFreeBlocked(hint, freeCalls + 1);
        assert.equal(state.configRequests, configCalls, 'A balance diagnosis does not add status polling');
        state.chatErrorCode = undefined; state.chatErrorReason = undefined;
        await refreshStatus();
      }
    }
    assert.ok(!(await page.locator('body').innerText()).includes(privateKeyProbe), 'A chat error cannot display private server credentials');
    assert.ok(!(await page.locator('body').innerText()).includes(privateProviderMessage), 'An unknown reason or provider message is never shown');
    state.config = { ...healthyConfig, quota: { remaining: 0, limit: 10, resetAt: '2026-10-09T00:00:00+08:00' } };
    await refreshStatus();
    assert.equal((await page.locator('.model-trigger-quota').innerText()).replace(/\s/gu, ''), '·剩余0次', 'A verified zero daily quota remains visibly zero');
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
    state.config = { ...healthyConfig, quota: { remaining: 3, limit: 10, resetAt: '2026-10-09T00:00:00+08:00' } };
    await refreshStatus();
    assert.equal((await page.locator('.model-trigger-quota').innerText()).replace(/\s/gu, ''), '·剩余3次', 'Manual refresh updates the visible count');
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isEnabled(), true);
    state.config = { ...healthyConfig };
    await refreshStatus();
    assert.equal(await page.locator('.model-trigger-quota').count(), 0, 'A refreshed unknown quota clears the previously known count');
    assert.ok(!(await page.locator('body').innerText()).includes(hiddenFreeModel), 'The provider model ID never enters displayed free settings or messages');
    await waitArchive(page, 'free');
    const saved = await page.evaluate(async () => {
      const storage = document.querySelector('#app').__vue_app__._context.provides.storage;
      const read = () => storage.provider.readFile('/AISearch/archive.json');
      return navigator.locks ? navigator.locks.request('ugc-tools.browser-storage.write', read) : read();
    });
    assert.ok(!saved.includes('balance-test-placeholder'), 'Provider/personal credentials never enter the chat archive');
    assert.ok(!saved.includes(privateKeyProbe) && !saved.includes(privateProviderMessage), 'Unknown reason values and raw provider errors never enter the chat archive');
    assert.ok(!saved.includes('privateBalanceProbe') && !saved.includes(String(privateBalanceProbe)), 'An unexpected private balance field is never archived');
    assert.deepEqual(Object.keys(JSON.parse(saved)).sort(), ['activeConversationId', 'conversations', 'resultLimit', 'selectedMode', 'version'], 'Free balance settings remain in memory and do not add archive fields');
    assert.deepEqual(errors, []);
  } finally { releaseChat?.(); releaseConfig?.(); await context.close(); }
}
async function testEffectAudio(browser) {
  const text = JSON.parse(await fs.readFile(path.join(__dirname, '../src/i18n/locales/aiSearch/zh-cn.json'), 'utf8'));
  const state = { effectAudioScenario: true, config: { configured: true, available: true, retrieval: { available: true }, agent: { available: true }, limits: { maxResults: 20, maxPreviousIds: 20 } }, freeRequests: [], customRequests: [] };
  const context = await browser.newContext({ locale: 'zh-CN' });
  await install(context, state);
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const queries = ['帮我找一些爆炸的特效的音效', '帮我找一些有爆炸的音效的特效'];
  async function assertEffectCard() {
    const reply = page.locator('.chat-message').last();
    assert.equal(await reply.locator('.resource-effect').count(), 1, 'An audio-matched effect is rendered as an effect asset');
    assert.equal(await reply.locator('.resource-sound').count(), 0, 'Standalone sounds do not replace the requested effect owner');
    assert.equal(await reply.locator('.asset-link').getAttribute('href'), '/EffectPlayer?id=780');
    assert.ok((await reply.innerText()).includes('猛烈爆炸轰鸣'));
  }
  try {
    await page.goto(`${base}/AISearch`);
    await page.locator('.retrieval-status').waitFor();
    await chooseSearchMode(page, 'basic');
    await page.getByRole('button', { name: '音效', exact: true }).click();
    await page.locator('.audio-toggle input').uncheck();
    await send(page, '雷声');
    await page.getByRole('button', { name: '全部资产', exact: true }).click();
    for (const query of queries) {
      await send(page, query);
      const request = state.searchRequests.at(-1);
      assert.equal(request.scope, 'effect'); assert.equal(request.matchOn, 'audio');
      assert.equal(request.includeEffectAudio, false); assert.deepEqual(request.filters, { hasAudio: true }); assert.equal(request.searchType, 'feature');
      await assertEffectCard();
    }
    assert.equal(state.freeRequests.length + state.customRequests.length, 0, 'Basic effect-audio search needs no AI model call');
    await page.getByRole('button', { name: /^模型设置(?: ·|$)/u }).click();
    const dialog = page.locator('.model-dialog');
    await dialog.locator('[data-search-mode-option="custom"]').click();
    await dialog.getByLabel(/^API 基础地址/).fill('https://model.invalid/v1');
    await dialog.getByLabel('模型名称', { exact: true }).fill('fixture-custom');
    await dialog.getByLabel(/^API Key/).fill('effect-audio-test-placeholder');
    await dialog.locator('button.primary-button[type="submit"]').click();
    for (const query of queries) {
      const before = state.customRequests.length;
      await send(page, query);
      assert.equal(state.customRequests.length, before + 3, 'The model searches and inspects details before selecting the effect');
      const firstTask = JSON.parse(state.customRequests[before].payload.messages.at(-1).content);
      assert.equal(firstTask.query, query); assert.equal(firstTask.scope, 'all'); assert.equal(firstTask.matchOn, 'any');
      const detail = JSON.parse(state.customRequests.at(-1).payload.messages.filter(message => message.role === 'tool').at(-1).content).items[0];
      assert.equal(detail.visualDescription, '蓝色护盾向外展开'); assert.equal(detail.audioDescription, '猛烈爆炸轰鸣'); assert.deepEqual(detail.audioKeywords, ['爆炸', '轰鸣']);
      await assertEffectCard();
    }
    await page.getByRole('button', { name: '特效', exact: true }).click();
    await chooseSearchMode(page, 'free');
    const clientSearches = state.searchRequests.length;
    for (const query of queries) {
      await send(page, query);
      assert.equal(state.freeRequests.at(-1).scope, 'effect'); assert.equal(state.freeRequests.at(-1).includeEffectAudio, false);
      await assertEffectCard();
    }
    assert.equal(state.searchRequests.length, clientSearches, 'Free agent keeps the whole tool loop on the Worker');
    await chooseSearchMode(page, 'basic');
    state.effectAudioDescriptionsMissing = true;
    await send(page, queries[1]);
    assert.equal(await page.locator('.chat-message').last().locator('.message-text').innerText(), text['aiSearch.effectAudioDescriptionsMissing']);
    assert.equal(await page.locator('.chat-message').last().locator('.resource-card').count(), 0, 'Missing audio descriptions do not return visual or standalone sound substitutes');
    state.oldMatchOnWorker = true;
    await send(page, queries[0]);
    assert.equal(await page.locator('.chat-message').last().locator('.message-text').innerText(), text['aiSearch.errors.matchOnUnsupported']);
    assert.equal(await page.locator('.chat-message').last().locator('.resource-card').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  const localState = { localMissingAudio: true, config: { configured: false, available: false }, freeRequests: [], customRequests: [] };
  const localContext = await browser.newContext({ locale: 'zh-CN' });
  await install(localContext, localState);
  const localPage = await localContext.newPage();
  localPage.on('pageerror', error => errors.push(error.message));
  try {
    await localPage.goto(`${base}/AISearch`); await localPage.locator('.retrieval-status').waitFor();
    for (const query of queries) {
      await send(localPage, query);
      assert.equal(await localPage.locator('.chat-message').last().locator('.message-text').innerText(), text['aiSearch.effectAudioDescriptionsMissing']);
      assert.equal(await localPage.locator('.chat-message').last().locator('.resource-card').count(), 0);
    }
    assert.equal(localState.freeRequests.length + localState.customRequests.length, 0);
    assert.equal(localState.searchRequests?.length || 0, 0, 'Missing local audio descriptions need no server or AI calls');
    assert.deepEqual(errors, []);
  } finally { await localContext.close(); }
}
async function readAllResults(reply, options = {}) {
  const previous = reply.locator('.results-previous');
  const next = reply.locator('.results-next');
  if (await reply.locator('.result-pagination').count()) {
    assert.deepEqual(await reply.locator('.result-pagination').evaluate(element => { const styles = getComputedStyle(element); return [styles.paddingTop, styles.paddingRight, styles.paddingBottom, styles.paddingLeft]; }), ['0px', '0px', '0px', '0px'], 'Global nav padding does not add empty space around result pagination');
  }
  while (await previous.count() && await previous.isEnabled()) await previous.click();
  const results = [];
  let pages = 0;
  for (;;) {
    const cards = reply.locator('.resource-card');
    const visible = await cards.evaluateAll(elements => elements.map(card => ({ position: Number(card.dataset.resultPosition), href: card.querySelector('.asset-link').getAttribute('href'), kind: ['sound', 'effect', 'bgm'].find(kind => card.classList.contains(`resource-${kind}`)), top: card.getBoundingClientRect().top })));
    assert.ok(visible.length >= 1 && visible.length <= 6, 'Each reply shows at most six cards per page');
    if (options.perPage !== undefined) assert.equal(visible.length, options.perPage, 'Mobile shows one result card per page');
    assert.ok(visible.every(card => Math.abs(card.top - visible[0].top) < 1), 'Each result page contains only one row of cards');
    results.push(...visible);
    pages++;
    assert.ok(pages <= 20, 'Pagination terminates within the bounded result count');
    if (!await next.count() || await next.isDisabled()) break;
    await next.click();
  }
  assert.deepEqual(results.map(item => item.position), results.map((_, index) => index + 1), 'Pagination visits every result once and preserves global order');
  while (await previous.count() && await previous.isEnabled()) await previous.click();
  return results;
}
async function showResultPosition(reply, position) {
  const previous = reply.locator('.results-previous');
  while (await previous.count() && await previous.isEnabled()) await previous.click();
  const card = reply.locator(`.resource-card[data-result-position="${position}"]`);
  for (let page = 0; !await card.count() && page < 20; page++) {
    const next = reply.locator('.results-next');
    assert.ok(await next.count() && await next.isEnabled(), `Result ${position} must have a reachable page`);
    await next.click();
  }
  await card.waitFor();
  return card;
}
async function waitArchive(page, selectedMode, activeConversationId, emptyActive = false, quantity = {}) {
  await page.waitForFunction(async expected => {
    try {
      const storage = document.querySelector('#app').__vue_app__._context.provides.storage;
      // ZenFS reads update access-time metadata. Use the provider write lock so
      // this polling probe cannot race a writer and restore an older file size.
      const read = async () => JSON.parse(await storage.provider.readFile('/AISearch/archive.json'));
      const saved = navigator.locks ? await navigator.locks.request('ugc-tools.browser-storage.write', read) : await read();
      const active = saved.conversations.find(item => item.id === saved.activeConversationId);
      return saved.version === 1 && saved.selectedMode === expected.selectedMode &&
        (!expected.activeConversationId || saved.activeConversationId === expected.activeConversationId) &&
        (!expected.emptyActive || active?.messages.length === 0) &&
        (expected.resultLimit === undefined || saved.resultLimit === expected.resultLimit) &&
        (expected.cardCount === undefined || active?.messages.at(-1)?.cards.length === expected.cardCount);
    } catch { return false; }
  }, { selectedMode, activeConversationId, emptyActive, ...quantity });
}
async function testLayout(browser, mobile = false) {
  const state = { config: { configured: false, available: false }, freeRequests: [], customRequests: [] };
  const context = await browser.newContext({ locale: 'zh-CN', viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  await install(context, state);
  await context.addInitScript(() => {
    if (sessionStorage.getItem('layout-history-seeded')) return;
    sessionStorage.setItem('layout-history-seeded', 'true');
    localStorage.setItem('ugc-tools.ai-search.history.v1', JSON.stringify([
      { id: 'layout-first', title: '布局历史一', contextStart: 0, messages: [{ id: 'layout-first-message', role: 'assistant', content: '第一段独立聊天记录', cards: [], mode: 'basic', status: 'complete' }] },
      { id: 'layout-second', title: '布局历史二', contextStart: 0, messages: [{ id: 'layout-second-message', role: 'assistant', content: '第二段独立聊天记录', cards: [], mode: 'basic', status: 'complete' }] },
    ]));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const sidebar = page.locator('#ai-search-history-panel');
  const main = page.locator('.search-main');
  const separator = page.locator('.history-resizer');
  async function geometry() {
    return page.evaluate(() => {
      const rect = selector => {
        const bounds = document.querySelector(selector).getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, right: bounds.right, bottom: bounds.bottom };
      };
      return { workspace: rect('.ai-search-workspace'), sidebar: rect('#ai-search-history-panel'), main: rect('.search-main'), documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, viewportHeight: innerHeight };
    });
  }
  async function assertNoOverflow(label) {
    const bounds = await geometry();
    assert.ok(bounds.documentWidth <= bounds.viewportWidth + 1, `${label}: the page has no horizontal overflow`);
    assert.ok(bounds.workspace.x >= -1 && bounds.workspace.right <= bounds.viewportWidth + 1, `${label}: the workspace stays inside the viewport`);
    assert.ok(bounds.main.x >= bounds.workspace.x - 1 && bounds.main.right <= bounds.workspace.right + 1, `${label}: the chat panel stays inside its workspace`);
    const composer = await page.locator('.composer-box').boundingBox();
    assert.ok(composer.x >= bounds.main.x - 1 && composer.x + composer.width <= bounds.main.right + 1, `${label}: the composer fits the chat panel`);
  }
  async function waitWidth(expected) {
    await page.waitForFunction(width => {
      const sidebar = document.querySelector('#ai-search-history-panel');
      const separator = document.querySelector('.history-resizer');
      return Math.abs(sidebar.getBoundingClientRect().width - width) < 1 && Math.abs(Number(separator.getAttribute('aria-valuenow')) - width) < 1;
    }, expected);
  }
  async function dragBy(delta) {
    const bounds = await separator.boundingBox();
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + Math.min(100, bounds.height / 2);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(Math.max(0, Math.min(1365, x + delta)), y, { steps: 12 });
    await page.mouse.up();
  }
  async function assertHistory(id, text) {
    await page.waitForFunction(expected => document.querySelector('.conversation-row.active .conversation-select')?.textContent.includes(expected), id);
    assert.equal(await page.locator('.chat-message').last().locator('.message-text').innerText(), text, 'History selection restores the corresponding chat');
  }
  try {
    await page.goto(`${base}/AISearch`);
    await page.locator('.retrieval-status').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.conversation-row').length === 2);
    assert.equal(await getSearchMode(page), 'basic');
    assert.equal(await main.locator(':scope > .chat-panel-heading').count(), 1, 'The chat panel has its own heading');
    assert.equal(await main.locator(':scope > .chat-panel-body .message-viewport').count(), 1, 'Messages belong to the independent chat body');
    assert.equal(await page.locator('.composer-area .desktop-history-toggle,.composer-area .history-toggle').count(), 0, 'History controls belong to the panel heading');
    const startupRequests = state.aiHttpRequests;
    if (!mobile) {
      await separator.waitFor();
      assert.equal(await separator.getAttribute('role'), 'separator');
      assert.equal(await separator.getAttribute('aria-orientation'), 'vertical');
      assert.equal(await separator.getAttribute('aria-controls'), 'ai-search-history-panel');
      assert.equal(await separator.getAttribute('tabindex'), '0');
      await waitWidth(280);
      const initial = await geometry();
      const initialSeparator = await separator.boundingBox();
      assert.ok(Math.abs(initialSeparator.width - 14) < 1, 'The separator has a usable fourteen-pixel hit area');
      assert.ok(initial.sidebar.right <= initialSeparator.x + 1 && initialSeparator.x + initialSeparator.width <= initial.main.x + 1, 'History, divider and chat form separate adjacent panels');
      assert.ok(initial.main.width >= 360, 'The desktop chat retains a usable minimum width');
      await dragBy(80);
      await waitWidth(360);
      const dragged = await geometry();
      assert.ok(Math.abs(initial.main.width - dragged.main.width - 80) < 1, 'Dragging transfers width from chat to history');
      await dragBy(-1000);
      const minimum = Number(await separator.getAttribute('aria-valuemin'));
      await waitWidth(minimum);
      assert.equal(minimum, 220);
      await dragBy(1000);
      const maximum = Number(await separator.getAttribute('aria-valuemax'));
      await waitWidth(maximum);
      assert.ok(maximum <= 420 && (await geometry()).main.width >= 360, 'Dragging clamps before the history or chat becomes unusable');
      await separator.focus();
      await page.keyboard.press('Home');
      await waitWidth(minimum);
      await page.keyboard.press('ArrowLeft');
      await waitWidth(minimum);
      await page.keyboard.press('ArrowRight');
      await waitWidth(minimum + 8);
      await page.keyboard.press('Shift+ArrowRight');
      await waitWidth(minimum + 40);
      await page.keyboard.press('ArrowLeft');
      await waitWidth(minimum + 32);
      await page.keyboard.press('End');
      await waitWidth(maximum);
      await page.keyboard.press('Shift+ArrowRight');
      await waitWidth(maximum);
      await separator.dblclick();
      await waitWidth(280);
      await separator.focus();
      await page.keyboard.press('End');
      await waitWidth(maximum);
      const beforeCollapse = await geometry();
      const historyToggle = page.locator('.chat-panel-heading .desktop-history-toggle');
      await historyToggle.click();
      await separator.waitFor({ state: 'hidden' });
      assert.equal(await historyToggle.getAttribute('aria-expanded'), 'false');
      const collapsed = await geometry();
      assert.ok(collapsed.main.width > beforeCollapse.main.width + maximum, 'Collapsing gives the whole history/divider width to the chat');
      await historyToggle.click();
      await separator.waitFor();
      await waitWidth(maximum);
      assert.equal(await historyToggle.getAttribute('aria-expanded'), 'true');
      await page.getByRole('button', { name: '布局历史二', exact: true }).click();
      await assertHistory('布局历史二', '第二段独立聊天记录');
      await waitWidth(maximum);
      await page.getByRole('button', { name: '布局历史一', exact: true }).click();
      await assertHistory('布局历史一', '第一段独立聊天记录');
      await waitWidth(maximum);
      await page.setViewportSize({ width: 870, height: 900 });
      await separator.waitFor();
      await page.waitForFunction(() => {
        const bounds = document.querySelector('#ai-search-history-panel').getBoundingClientRect();
        const separator = document.querySelector('.history-resizer');
        return bounds.width <= Number(separator.getAttribute('aria-valuemax')) + 1;
      });
      await assertNoOverflow('Narrow desktop');
      assert.ok((await geometry()).main.width >= 360, 'Narrow desktop keeps room for composing and reading');
      await page.setViewportSize({ width: 820, height: 900 });
      await separator.waitFor({ state: 'hidden' });
      await page.locator('.chat-panel-heading .history-toggle').waitFor();
      await assertNoOverflow('Tablet drawer layout');
      await page.setViewportSize({ width: 1366, height: 900 });
      await separator.waitFor();
      await waitWidth(maximum);
      await assertNoOverflow('Restored desktop');
      await separator.dblclick();
      await waitWidth(280);
    } else {
      await separator.waitFor({ state: 'hidden' });
      assert.equal(await page.locator('.desktop-history-toggle:visible').count(), 0);
      await assertNoOverflow('Mobile chat');
      const toggle = page.locator('.chat-panel-heading .history-toggle');
      await toggle.tap();
      await page.locator('#ai-search-history-panel.is-open').waitFor();
      await page.waitForFunction(() => {
        const drawer = document.getElementById('ai-search-history-panel');
        return Math.abs(new DOMMatrixReadOnly(getComputedStyle(drawer).transform).m41) < 1 && !drawer.getAnimations().some(animation => animation.playState === 'running' || animation.playState === 'pending');
      });
      const drawer = await sidebar.boundingBox();
      assert.ok(drawer.x >= 0 && drawer.x + drawer.width <= 391, 'The mobile history drawer fits on screen');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await page.screenshot({ path: path.join(outputDirectory, 'ai-search-layout-mobile-history.png'), fullPage: true });
      await page.getByRole('button', { name: '布局历史二', exact: true }).tap();
      await page.locator('#ai-search-history-panel.is-open').waitFor({ state: 'hidden' });
      await page.locator('.history-backdrop').waitFor({ state: 'hidden' });
      await assertHistory('布局历史二', '第二段独立聊天记录');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Selecting mobile history returns to the chat');
      await toggle.tap();
      await sidebar.locator('.mobile-close').tap();
      await page.locator('.history-backdrop').waitFor({ state: 'hidden' });
      await toggle.tap();
      const backdrop = await page.locator('.history-backdrop').boundingBox();
      await page.locator('.history-backdrop').tap({ position: { x: backdrop.width - 5, y: backdrop.height / 2 } });
      await page.locator('.history-backdrop').waitFor({ state: 'hidden' });
      await toggle.tap();
    }
    assert.equal(state.aiHttpRequests, startupRequests, 'Dragging, keys, collapse, viewport resize and history selection make no AI/search requests');
    await page.getByRole('button', { name: '新对话', exact: true }).click();
    assert.equal(await page.locator('.chat-message').count(), 0, 'New conversation still starts an empty chat');
    if (mobile) await page.locator('.history-backdrop').waitFor({ state: 'hidden' });
    await send(page, '雷声');
    const cards = await readAllResults(page.locator('.chat-message').last());
    assert.ok(cards.length > 0, 'The resized chat still searches and renders resource cards');
    await assertNoOverflow(mobile ? 'Mobile search results' : 'Desktop search results');
    if (mobile) await page.waitForFunction(() => !document.getElementById('ai-search-history-panel').getAnimations().some(animation => animation.playState === 'running' || animation.playState === 'pending'));
    await page.screenshot({ path: path.join(outputDirectory, `ai-search-layout-${mobile ? 'mobile' : 'desktop'}.png`), fullPage: true });
    await waitArchive(page, 'basic', undefined, false, { cardCount: cards.length });
    await page.reload();
    await page.locator('.retrieval-status').waitFor();
    assert.equal((await readAllResults(page.locator('.chat-message').last())).length, cards.length, 'Layout changes do not truncate restored conversation results');
    assert.equal(state.freeRequests.length, 0, 'Layout checks never invoke the free model');
    assert.equal(state.customRequests.length, 0, 'Layout checks never invoke a custom model');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}
async function testFeatureSync(browser) {
  const hashA = 'a'.repeat(64), hashB = 'b'.repeat(64);
  const state = { config: { configured: true, available: true, model: 'fixture-free', retrieval: { available: true }, agent: { available: true }, quota: { remaining: 5, limit: 5, resetAt: 'fixture' } }, featureSync: { status: 'ready', hashes: { sound: hashA, effect: hashA }, lastGoodAt: 1700000000000 }, freeRequests: [], customRequests: [] };
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1366, height: 900 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  await install(context, state);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${base}/AISearch`);
    await page.locator('.retrieval-status').waitFor();
    await chooseSearchMode(page, 'free');
    await send(page, '雷声音效');
    const retainedHistory = () => page.locator('.chat-message.message-assistant').first().evaluate(node => ({ answer: node.querySelector('.message-text')?.textContent, title: node.querySelector('h3')?.textContent, description: node.querySelector('.resource-details-summary')?.textContent }));
    const first = await retainedHistory();
    assert.equal(await page.locator('.feature-update-notice').count(), 0);
    state.catalogVersion = 'browser-authoritative-v2';
    state.featureSync.hashes.sound = hashB;
    await send(page, '短雷声音效');
    await page.locator('.feature-update-notice').waitFor();
    assert.ok((await page.locator('.feature-update-notice').innerText()).includes('聊天记录已保留'));
    assert.deepEqual(await retainedHistory(), first);
    state.featureSync.status = 'stale'; state.featureSync.errorCode = 'ASSET_FEATURES_HTTP';
    await send(page, '低沉雷声音效');
    await page.locator('.feature-stale-notice').waitFor();
    assert.ok((await page.locator('.feature-stale-notice').innerText()).includes('上次有效版本'));
    await page.screenshot({ path: path.join(outputDirectory, 'ai-search-feature-stale-desktop.png'), fullPage: true });
    state.chatErrorCode = 'CATALOG_VERSION_MISMATCH'; state.chatErrorStatus = 409;
    const beforeCatalog = state.catalogRequests;
    await send(page, '重新匹配雷声音效');
    await page.locator('.feature-retry-notice').waitFor();
    assert.equal(state.freeRequests.length, 4, 'A version conflict does not automatically repeat a paid model request');
    assert.ok(state.catalogRequests > beforeCatalog);
    assert.equal(await page.locator('.chat-message.message-error').count(), 1);
    state.chatErrorCode = ''; state.featureSync.status = 'ready';
    await page.locator('.feature-retry-notice button').click();
    await page.getByRole('button', { name: '停止', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(state.freeRequests.length, 5);
    assert.equal(await page.locator('.chat-message.message-error').count(), 1, 'Retry preserves the failed round');
    assert.equal(await page.locator('.chat-message').count(), 10);
    assert.deepEqual(await retainedHistory(), first);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => !document.getElementById('ai-search-history-panel').getAnimations().some(animation => animation.playState === 'running' || animation.playState === 'pending'));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'New update notices fit mobile width');
    await page.screenshot({ path: path.join(outputDirectory, 'ai-search-feature-update-mobile.png'), fullPage: true });
    await page.reload();
    await page.locator('.retrieval-status').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.chat-message').length === 10);
    assert.equal(await page.locator('.chat-message.message-error').count(), 1);
    assert.deepEqual(await retainedHistory(), first);
    assert.equal(state.freeRequests.length, 5, 'Restoring history never calls a model');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  const missingState = { config: { configured: false, available: false }, localFeaturesMissing: true, freeRequests: [], customRequests: [] };
  const missingContext = await browser.newContext({ locale: 'zh-CN' });
  await missingContext.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  await install(missingContext, missingState);
  const missingPage = await missingContext.newPage();
  try {
    await missingPage.goto(`${base}/AISearch`);
    await missingPage.locator('.feature-missing-notice').waitFor();
    await send(missingPage, '雷声音效');
    assert.ok(await missingPage.locator('.resource-card').count() > 0, 'Missing sidecars retain resource name search');
    assert.equal(missingState.freeRequests.length, 0);
    assert.equal(missingState.customRequests.length, 0);
  } finally { await missingContext.close(); }
}

(async () => {
  await fs.mkdir(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  if (featureSyncOnly) {
    try { await testFeatureSync(browser); console.log('PASS browser feature sync: updated/stale/missing notices, preserved historical cards, manual-only conflict retry, archive restoration and mobile width; all AI/OSS routes mocked'); } finally { await browser.close(); }
    return;
  }
  if (layoutOnly) {
    try {
      await testLayout(browser);
      await testLayout(browser, true);
      console.log('PASS AISearch split layout: independent desktop history/chat panels, real pointer resizing, min/max bounds, keyboard and reset, preserved collapsed/narrowed width, mobile history drawer, history/new conversation and archive restore, no extra AI calls.');
    } finally { await browser.close(); }
    return;
  }
  if (effectAudioOnly) {
    try {
      await testEffectAudio(browser);
      console.log('PASS AISearch effect audio: both relationship orders preserve effect cards, basic/free/custom, independent visual/audio details, disabled sound expansion, model-first tools, missing audio evidence and explicit old-Worker error.');
    } finally { await browser.close(); }
    return;
  }
  if (providerBalanceOnly) {
    try {
      await testProviderBalance(browser);
      console.log('PASS AISearch provider balance: config low/unverifiable disables free chat, configured/default threshold, real-time chat rejection, manual status refresh restores service, basic/custom remain available, no credentials/private balance in archive.');
    } finally { await browser.close(); }
    return;
  }
  if (composerOnly || modelSelectOnly) {
    try {
      await testComposer(browser);
      await testComposer(browser, true);
      console.log('PASS AISearch composer: one row desktop/narrow/mobile input, generic free model and visible live quota including zero/unknown, hidden free provider ID, actual personal model with ellipsis, confirmed/cancelled mode and settings, focus restoration, Enter/ShiftEnter/IME, browser archive restoration, no unintended model calls.');
    } finally { await browser.close(); }
    return;
  }
  const errors = [];
  const state = { config: { configured: false, available: false }, freeRequests: [], customRequests: [], exhausted: false, invented: false, delay: false };
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1366, height: 900 } });
  await install(context, state);
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${base}/AISearch`);
    await page.waitForFunction(count => document.querySelector('.catalog-count')?.textContent?.trim() === String(count), fixtureCount);
    assert.equal(await getSearchMode(page), 'basic');
    assert.equal(await getResultLimit(page), '10', 'Default result limit is ten');
    await page.locator('#search-result-limit').click();
    assert.deepEqual(await page.locator('[data-result-limit-option]').evaluateAll(options => options.map(option => option.dataset.resultLimitOption)), ['5', '10', '20', '50']);
    await page.keyboard.press('Escape');
    await send(page, '数量测试');
    assert.equal((await readAllResults(page.locator('.chat-message').last())).length, 10);
    await chooseResultLimit(page, '20');
    await send(page, '数量测试');
    assert.ok(await page.locator('.chat-message').last().locator('.resource-card').count() >= 3, 'Compact cards show at least three results beside the independent history panel at 1366px');
    assert.equal((await readAllResults(page.locator('.chat-message').last())).length, 20);
    const beforeQuantityPaging = state.aiHttpRequests;
    const firstTwentyResults = await readAllResults(page.locator('.chat-message').last());
    const firstTwentyIds = firstTwentyResults.map(item => new URL(item.href, base).searchParams.get('id'));
    assert.equal(state.aiHttpRequests, beforeQuantityPaging, 'Paging through twenty results makes no additional search or model API requests');
    assert.equal(new Set(firstTwentyIds).size, 20, 'Expanded results remain unique');
    await page.locator('.chat-message').last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outputDirectory, 'ai-search-20-results-desktop.png'), fullPage: true });
    await waitArchive(page, 'basic', undefined, false, { resultLimit: 20, cardCount: 20 });
    await page.reload();
    await page.locator('.retrieval-status').waitFor();
    assert.equal(await getResultLimit(page), '20', 'Archive restores selected twenty-result limit');
    assert.equal((await readAllResults(page.locator('.chat-message').last())).length, 20, 'Archive restores all twenty cards');
    await send(page, '再来点');
    const remainingIds = (await readAllResults(page.locator('.chat-message').last())).map(item => new URL(item.href, base).searchParams.get('id'));
    assert.equal(remainingIds.length, 5, 'Only five unseen matching assets remain; results are not padded');
    assert.ok(remainingIds.every(id => !firstTwentyIds.includes(id)), 'More excludes all twenty prior results, including results beyond the former five-card limit');
    await chooseResultLimit(page, '5');
    await send(page, '数量测试');
    assert.equal((await readAllResults(page.locator('.chat-message').last())).length, 5);
    await waitArchive(page, 'basic', undefined, false, { resultLimit: 5, cardCount: 5 });
    await page.reload();
    await page.locator('.retrieval-status').waitFor();
    assert.equal(await getResultLimit(page), '5', 'Archive restores selected five-result limit');
    assert.equal((await readAllResults(page.locator('.chat-message').last())).length, 5);
    await chooseResultLimit(page, '10');
    await page.getByRole('button', { name: '新对话', exact: true }).click();
    await send(page, '帮我找受击声');
    assert.equal((await readAllResults(page.locator('.chat-message').last())).length, 2);
    assert.equal(await page.locator('.chat-message').last().locator('.resource-effect').count(), 0, 'Visual hit effects must not displace sound results');
    await page.getByRole('button', { name: '音效', exact: true }).click();
    await send(page, '雷声');
    assert.equal((await readAllResults(page.locator('.chat-message').last())).length, 3);
    assert.ok((await readAllResults(page.locator('.chat-message').last())).some(item => item.href === '/EffectPlayer?id=64'));
    await page.locator('.chat-message').last().locator('.sound-mini-preview').first().waitFor();
    assert.ok(await page.locator('.chat-message').last().locator('.sound-mini-play').count(), 'Sound cards include compact user-controlled previews');
    await waitArchive(page, 'basic');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.catalog-count') === null && document.querySelector('.resource-card'));
    assert.equal((await readAllResults(page.locator('.chat-message').last())).length, 3);
    assert.equal(await getSearchMode(page), 'basic', 'Archive restores mode and history without standalone localStorage history');
    await page.getByRole('button', { name: '新对话', exact: true }).click();
    state.config = { configured: true, available: true, model: 'fixture-free', quota: { remaining: 5, limit: 5, resetAt: '2026-10-09T00:00:00+08:00' } };
    await page.getByRole('button', { name: /^模型设置(?: ·|$)/u }).click();
    await page.locator('.model-dialog [data-search-mode-option="free"]').click();
    await page.getByRole('button', { name: '刷新状态', exact: true }).click();
    await page.getByText('可用', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await chooseSearchMode(page, 'free');
    await send(page, '雷声');
    assert.equal(state.freeRequests.length, 1);
    assert.ok(state.freeRequests[0].candidates.some(item => item.resourceId === 'effect:64'));
    await send(page, '更短一点');
    assert.equal(state.freeRequests.length, 2);
    assert.ok(state.freeRequests[1].messages.some(message => message.content.includes('Previous results') && message.content.includes('effect:64')));
    const oldCount = await page.locator('.chat-message').count();
    assert.equal(await page.locator('.composer-area .clear-context,.composer-area .keyboard-hint').count(), 0, 'The compact composer omits reset and Enter hint controls');
    await send(page, '更短一点');
    assert.ok(state.freeRequests[2].messages.length > 0, 'Continued messages preserve earlier chat context');
    assert.ok(await page.locator('.chat-message').count() > oldCount, 'The compact composer preserves display history');
    state.exhausted = true;
    state.config.available = false; state.config.quota.remaining = 0; state.config.error = { code: 'FREE_QUOTA_EXHAUSTED' };
    await send(page, '雷声');
    await page.getByText('站点 AI 今日额度已用完，可以改用基础搜索或自己的模型', { exact: true }).first().waitFor();
    assert.equal(await page.locator('.chat-message').last().locator('.resource-card').count(), 0);
    assert.equal(state.promptRequests || 0, 0, 'Basic and free browser searches never download the system prompt');
    await page.getByRole('button', { name: /^模型设置(?: ·|$)/u }).click();
    const dialog = page.locator('.model-dialog');
    await dialog.locator('[data-search-mode-option="custom"]').click();
    await dialog.getByLabel(/^API 基础地址/).fill('https://model.invalid/v1');
    await dialog.getByLabel('模型名称', { exact: true }).fill('fixture-custom');
    await dialog.getByLabel(/^API Key/).fill('test-only-placeholder');
    await dialog.locator('button.primary-button[type="submit"]').click();
    await send(page, '雷声');
    assert.equal(state.customRequests.length, 1);
    assert.equal(state.promptRequests, 1, 'The legacy personal model reads its external prompt');
    assert.equal(state.customRequests[0].authorization, 'Bearer test-only-placeholder');
    assert.ok(!JSON.stringify(state.customRequests[0].payload).includes('test-only-placeholder'));
    assert.equal(await page.locator('.message-text img').count(), 0, 'Model HTML is rendered as text');
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('test-only-placeholder')), false, 'Default key is not persisted in localStorage');
    await waitArchive(page, 'custom');
    await page.reload();
    await page.locator('.retrieval-status').waitFor();
    assert.equal(await getSearchMode(page), 'custom');
    assert.ok((await page.locator('.model-trigger').innerText()).includes('fixture-custom'), 'Selected mode and configured model name are restored');
    await page.getByRole('button', { name: '全部资产', exact: true }).click();
    for (const query of ['帮我找受击声', '有没有受击的音效', '更短一点']) {
      await send(page, query);
      const payload = JSON.parse(state.customRequests.at(-1).payload.messages.at(-1).content);
      assert.equal(payload.scope, 'sound', 'Model and retrieval must share the resolved scope');
      assert.ok(payload.candidates.length > 0 && payload.candidates.every(item => item.kind === 'sound'));
      assert.equal(await page.locator('.chat-message').last().locator('.resource-sound').count(), 1);
    }
    state.truncated = true;
    await send(page, '受击声');
    assert.ok((await page.locator('.chat-message').last().innerText()).includes('模型回答被截断'));
    assert.equal(await page.locator('.chat-message').last().locator('.resource-card').count(), 0);
    state.truncated = false;
    state.invented = true;
    await send(page, '雷声');
    assert.equal(await page.locator('.chat-message').last().locator('.resource-card').count(), 0, 'Invented IDs cannot become cards');
    assert.ok((await page.locator('.chat-message').last().innerText()).includes('本次候选之外或重复的资源 ID'));
    state.invented = false; state.delay = true;
    await page.locator('#asset-query').fill('雷声');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    assert.equal(await page.locator('#search-result-limit .n-base-selection').evaluate(element => element.classList.contains('n-base-selection--disabled')), true, 'Result limit is fixed while the current search is running');
    await page.getByRole('button', { name: '停止', exact: true }).click();
    assert.ok((await page.locator('.chat-message').last().innerText()).includes('已停止生成'));
    await page.waitForTimeout(1700);
    assert.equal(await page.locator('.chat-message').last().locator('.resource-card').count(), 0);
    assert.deepEqual(errors, []);
    const serverState = { config: { configured: false, available: false, retrieval: { available: true } }, freeRequests: [], customRequests: [] };
    const serverContext = await browser.newContext({ locale: 'zh-CN' });
    await install(serverContext, serverState);
    const serverPage = await serverContext.newPage(); serverPage.on('pageerror', error => errors.push(error.message));
    let legacyCatalogueDownloads = 0;
    serverPage.on('request', request => { if (request.url().includes('/ugc-tool-data/') && (request.url().includes('/i18n/') || request.url().includes('/SoundEffectPlayer/data.json'))) legacyCatalogueDownloads++; });
    await serverPage.goto(`${base}/AISearch`);
    await serverPage.waitForFunction(() => document.querySelector('.catalog-count')?.textContent?.trim() === '3,000');
    assert.equal(legacyCatalogueDownloads, 0, 'Configured retrieval does not download legacy search catalogues; previews may fetch effect/BGM media metadata');
    assert.ok((await serverPage.locator('.retrieval-status').innerText()).includes('语义'));
    await send(serverPage, '帮我找雷声');
    assert.equal(serverState.searchRequests[0].scope, 'sound');
    assert.equal(serverState.searchRequests[0].limit, 20);
    assert.equal((await readAllResults(serverPage.locator('.chat-message').last())).length, 3);
    await showResultPosition(serverPage.locator('.chat-message').last(), 3);
    assert.ok((await serverPage.locator('.chat-message').last().innerText()).includes('权威音轨详情'));
    assert.ok(!(await serverPage.locator('.chat-message').last().innerText()).includes('蓝色视觉光环'));
    assert.equal(await serverPage.locator('a.asset-link[href="/EffectPlayer?id=777"]').count(), 1);
    assert.ok((await serverPage.locator('.retrieval-status').innerText()).includes('关键词'));
    assert.ok(!(await serverPage.locator('.retrieval-status').innerText()).includes('语义'), 'Status reports actual keyword fallback mode');
    serverState.config.configured = true; serverState.config.available = true;
    await serverPage.getByRole('button', { name: /^模型设置(?: ·|$)/u }).click();
    await serverPage.locator('.model-dialog [data-search-mode-option="free"]').click();
    await serverPage.getByRole('button', { name: '刷新状态', exact: true }).click();
    await serverPage.getByText('可用', { exact: true }).waitFor();
    await serverPage.keyboard.press('Escape');
    await chooseSearchMode(serverPage, 'free');
    await send(serverPage, '更短一点');
    assert.deepEqual(serverState.searchRequests.at(-1).previousIds, ['sound:88001', 'sound:88002', 'effect:777']);
    assert.equal(serverState.searchRequests.at(-1).previousQuery, '帮我找雷声');
    assert.equal(serverState.freeRequests.length, 1);
    assert.equal(serverState.freeRequests[0].resultLimit, 5, 'Free service without updated capabilities retains its supported five-result limit');
    assert.ok(Array.isArray(serverState.freeRequests[0].candidateIds));
    assert.deepEqual(serverState.freeRequests[0].audioCandidateIds, ['effect:777']);
    assert.equal(serverState.freeRequests[0].catalogVersion, serverVersion);
    assert.ok(!('candidates' in serverState.freeRequests[0]), 'New free chat does not send client descriptions');
    assert.equal(serverState.assetRequests.length, 1, 'Free authoritative resources need no duplicate detail fetch');
    assert.equal(serverState.promptRequests || 0, 0, 'Server retrieval and free filtering leave prompt loading inside the Worker');
    assert.ok((await serverPage.locator('.chat-message').last().innerText()).includes('权威音轨详情'));
    await send(serverPage, '更短');
    assert.equal(serverState.searchRequests.at(-1).previousQuery, '帮我找雷声', 'A second refinement must not replace the original search topic');
    await send(serverPage, '雷声音效和蓝色特效');
    assert.equal(serverState.freeRequests.at(-1).scope, 'all');
    assert.deepEqual(serverState.freeRequests.at(-1).audioCandidateIds, ['effect:777'], 'Mixed searches preserve the selected audio facet');
    assert.ok(!(await serverPage.locator('.chat-message').last().innerText()).includes('蓝色视觉光环'));
    await serverPage.getByRole('button', { name: /^模型设置(?: ·|$)/u }).click();
    const serverDialog = serverPage.locator('.model-dialog');
    await serverDialog.locator('[data-search-mode-option="custom"]').click();
    await serverDialog.getByLabel(/^API 基础地址/).fill('https://model.invalid/v1');
    await serverDialog.getByLabel('模型名称', { exact: true }).fill('fixture-custom');
    await serverDialog.getByLabel(/^API Key/).fill('test-only-placeholder');
    await serverDialog.locator('button.primary-button[type="submit"]').click();
    serverState.events = [];
    await send(serverPage, '雷声');
    assert.equal(serverState.customRequests.length, 2);
    assert.equal(serverState.promptRequests, 1, 'A custom agent downloads one prompt for the complete tool turn');
    assert.deepEqual(serverState.events, ['model', 'search', 'model'], 'Model interprets the request before retrieval');
    const initialTask = JSON.parse(serverState.customRequests[0].payload.messages.at(-1).content);
    assert.equal(initialTask.query, '雷声');
    assert.ok(!('candidates' in initialTask), 'No keyword shortlist gates the initial model request');
    assert.ok(serverState.customRequests[0].payload.tools.some(tool => tool.function.name === 'search_assets'));
    const searched = JSON.parse(serverState.customRequests[1].payload.messages.find(message => message.role === 'tool').content);
    assert.ok(searched.items.some(item => item.resourceId === 'sound:88001'));
    assert.ok(searched.items.filter(item => item.kind === 'effect').every(item => !item.description.includes('蓝色')));
    assert.equal(serverState.assetRequests.length, 2);
    assert.ok((await serverPage.locator('.chat-message').last().innerText()).includes('权威详情'));
    serverState.intentScenario = true;
    const callsBeforeMusic = serverState.customRequests.length;
    await send(serverPage, '打架用的激昂的音乐');
    assert.equal(serverState.customRequests.length, callsBeforeMusic + 3, 'Model can revise a query after empty results');
    assert.deepEqual(serverState.searchRequests.slice(-2).map(request => [request.query, request.scope]), [['打架用的激昂的音乐', 'bgm'], ['战斗', 'bgm']]);
    assert.equal(await serverPage.locator('.chat-message').last().locator('.resource-bgm').count(), 1);
    assert.ok((await serverPage.locator('.chat-message').last().innerText()).includes('不能确认节奏和情绪'));
    await send(serverPage, '悠闲的音乐');
    assert.equal(serverState.customRequests.length, callsBeforeMusic + 6);
    const musicLatest = serverPage.locator('.chat-message').last();
    assert.ok((await musicLatest.innerText()).includes('尚未提供情绪和节奏描述'));
    assert.ok((await musicLatest.locator('.message-mode').innerText()).includes('我的模型'));
    assert.equal(await musicLatest.locator('.resource-card').count(), 0);
    const callsBeforeExplosion = serverState.customRequests.length;
    await send(serverPage, '爆炸特效');
    const switched = serverState.customRequests[callsBeforeExplosion].payload;
    assert.equal(serverState.customRequests.length, callsBeforeExplosion + 2);
    assert.equal(JSON.parse(switched.messages.at(-1).content).query, '爆炸特效');
    assert.equal(serverState.searchRequests.at(-1).scope, 'effect');
    assert.equal(await serverPage.locator('.chat-message').last().locator('.resource-effect').count(), 1);
    assert.equal(await serverPage.locator('.chat-message').last().locator('h3').innerText(), '爆炸特效');
    await send(serverPage, '再来点');
    assert.deepEqual(serverState.searchRequests.at(-1).excludeIds, ['effect:778']);
    assert.equal(serverState.searchRequests.at(-1).query, '爆炸');
    assert.equal(await serverPage.locator('.chat-message').last().locator('h3').innerText(), '红色爆炸特效');
    assert.equal(await serverPage.locator('.chat-message').last().locator('a.asset-link[href="/EffectPlayer?id=779"]').count(), 1);
    serverState.intentScenario = false;
    serverState.searchFails = true;
    const callsBeforeFailure = serverState.customRequests.length;
    await send(serverPage, '雷声');
    assert.equal(serverState.customRequests.length, callsBeforeFailure + 1, 'Initial model asks for search; failed search stops before another paid model call');
    assert.equal(await serverPage.locator('.chat-message').last().locator('.resource-card').count(), 0);
    assert.ok((await serverPage.locator('.chat-message').last().innerText()).includes('资产检索服务'));
    assert.equal(legacyCatalogueDownloads, 0, 'Server failures never silently switch to stale local retrieval');
    serverState.searchFails = false;
    serverState.config.agent = { available: true, maxModelRounds: 3, maxToolCalls: 4 };
    await serverPage.getByRole('button', { name: /^模型设置(?: ·|$)/u }).click();
    await serverPage.locator('.model-dialog [data-search-mode-option="free"]').click();
    await serverPage.getByRole('button', { name: '刷新状态', exact: true }).click();
    await serverPage.getByText('可用', { exact: true }).waitFor();
    await serverPage.keyboard.press('Escape');
    await chooseSearchMode(serverPage, 'free');
    const searchesBeforeFreeAgent = serverState.searchRequests.length;
    await send(serverPage, '爆炸特效');
    const freeAgent = serverState.freeRequests.at(-1);
    assert.equal(freeAgent.workflow, 'agent');
    assert.ok(!('candidateIds' in freeAgent) && !('candidates' in freeAgent));
    assert.equal(serverState.searchRequests.length, searchesBeforeFreeAgent, 'Free agent delegates the whole tool loop to Worker');
    assert.equal(await serverPage.locator('.chat-message').last().locator('.resource-effect').count(), 1);
    await serverPage.reload();
    await serverPage.waitForFunction(() => document.querySelector('.retrieval-status')?.textContent?.includes('语义'));
    await chooseSearchMode(serverPage, 'free');
    const freeCallsBeforeReloadSearch = serverState.freeRequests.length;
    await send(serverPage, '爆炸特效');
    assert.equal(serverState.freeRequests.length, freeCallsBeforeReloadSearch + 1);
    assert.ok((await serverPage.locator('.retrieval-status').innerText()).includes('关键词'));
    assert.ok(!(await serverPage.locator('.retrieval-status').innerText()).includes('语义'), 'Agent status follows actual keyword fallback rather than configured hybrid mode');
    serverState.quantityScenario = true;
    serverState.config.limits = { maxResults: 20, maxPreviousIds: 20 };
    await serverPage.getByRole('button', { name: /^模型设置(?: ·|$)/u }).click();
    await serverPage.locator('.model-dialog [data-search-mode-option="free"]').click();
    await serverPage.getByRole('button', { name: '刷新状态', exact: true }).click();
    await serverPage.getByText('可用', { exact: true }).waitFor();
    await serverPage.keyboard.press('Escape');
    await chooseSearchMode(serverPage, 'basic');
    await serverPage.getByRole('button', { name: '新对话', exact: true }).click();
    await chooseResultLimit(serverPage, '10');
    await send(serverPage, '数量测试');
    assert.equal((await readAllResults(serverPage.locator('.chat-message').last())).length, 10, 'Server basic search displays ten candidates');
    await chooseSearchMode(serverPage, 'free');
    await send(serverPage, '数量测试');
    assert.equal(serverState.freeRequests.at(-1).resultLimit, 10);
    assert.equal((await readAllResults(serverPage.locator('.chat-message').last())).length, 10, 'Free agent renders all ten returned matches');
    await chooseResultLimit(serverPage, '20');
    await send(serverPage, '数量测试');
    assert.equal(serverState.freeRequests.at(-1).resultLimit, 20);
    assert.equal(serverState.freeRequests.at(-1).previousIds.length, 10);
    assert.equal((await readAllResults(serverPage.locator('.chat-message').last())).length, 20, 'Free agent renders all twenty returned matches');
    await waitArchive(serverPage, 'free', undefined, false, { resultLimit: 20, cardCount: 20 });
    await serverPage.reload();
    await serverPage.locator('.retrieval-status').waitFor();
    assert.equal(await getSearchMode(serverPage), 'free');
    assert.equal(await getResultLimit(serverPage), '20');
    assert.equal((await readAllResults(serverPage.locator('.chat-message').last())).length, 20, 'Free agent cards survive archive reload without truncation');
    await send(serverPage, '数量测试');
    assert.equal(serverState.freeRequests.at(-1).previousIds.length, 20, 'Free agent retains all twenty prior IDs in the next turn');
    await chooseSearchMode(serverPage, 'custom');
    await send(serverPage, '数量测试');
    const customQuantityResults = await readAllResults(serverPage.locator('.chat-message').last());
    assert.equal(customQuantityResults.length, 20, 'Custom model tool loop renders all twenty matches');
    assert.deepEqual(customQuantityResults.map(item => item.href), quantityAssets.slice(0, 20).map(item => `/SoundEffectPlayer?id=${item.resourceId.split(':')[1]}`), 'Desktop pagination preserves every asset ID in the model result order');
    const quantityTask = JSON.parse(serverState.customRequests.at(-2).payload.messages.at(-1).content);
    assert.equal(quantityTask.resultLimit, 20, 'Custom model receives selected twenty-result limit');
    await serverPage.setViewportSize({ width: 390, height: 844 });
    await serverPage.waitForFunction(() => [...document.querySelectorAll('.chat-message')].at(-1)?.querySelectorAll('.resource-card').length === 1);
    const beforeMobilePaging = serverState.aiHttpRequests;
    const mobileQuantityResults = await readAllResults(serverPage.locator('.chat-message').last(), { perPage: 1 });
    assert.deepEqual(mobileQuantityResults.map(item => item.href), customQuantityResults.map(item => item.href), 'Mobile pages retain the full desktop result order');
    assert.equal(serverState.aiHttpRequests, beforeMobilePaging, 'Mobile paging adds no search or model requests');
    assert.ok(await serverPage.locator('.resource-results').last().evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Mobile result paging stays within the available width');
    await serverPage.locator('.chat-message').last().scrollIntoViewIfNeeded();
    await serverPage.screenshot({ path: path.join(outputDirectory, 'ai-search-20-results-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await serverContext.close();
    const migrationState = { config: { configured: true, available: true }, freeRequests: [], customRequests: [] };
    const migrationContext = await browser.newContext({ locale: 'zh-CN' });
    await install(migrationContext, migrationState);
    await migrationContext.addInitScript(() => {
      if (sessionStorage.getItem('legacy-seeded')) return;
      sessionStorage.setItem('legacy-seeded', 'true');
      localStorage.setItem('ugc-tools.ai-search.history.v1', JSON.stringify([
        { id: 'legacy-first', title: '第一个旧会话', contextStart: 0, messages: [{ id: 'old-first', role: 'assistant', content: '第一条旧记录', cards: [], mode: 'basic', status: 'complete' }] },
        { id: 'legacy-second', title: '第二个旧会话', contextStart: 0, messages: [{ id: 'old-second', role: 'assistant', content: '第二条旧记录', cards: [], mode: 'basic', status: 'complete' }] },
      ]));
    });
    const migrationPage = await migrationContext.newPage();
    migrationPage.on('pageerror', error => errors.push(error.message));
    await migrationPage.goto(`${base}/AISearch`);
    await migrationPage.locator('.retrieval-status').waitFor();
    await migrationPage.waitForFunction(() => localStorage.getItem('ugc-tools.ai-search.history.v1') === null);
    assert.equal(await migrationPage.locator('.conversation-row').count(), 2, 'Old history migrates into the unified archive');
    await migrationPage.getByRole('button', { name: '第二个旧会话', exact: true }).click();
    await waitArchive(migrationPage, 'basic', 'legacy-second');
    await migrationPage.reload();
    await migrationPage.locator('.retrieval-status').waitFor();
    assert.equal(await migrationPage.locator('.chat-message').last().locator('.message-text').innerText(), '第二条旧记录');
    assert.equal(await getSearchMode(migrationPage), 'basic', 'Free service availability must not override saved basic mode');
    await migrationPage.getByRole('button', { name: '新对话', exact: true }).click();
    await waitArchive(migrationPage, 'basic', undefined, true);
    await migrationPage.reload();
    await migrationPage.locator('.retrieval-status').waitFor();
    assert.equal(await migrationPage.locator('.chat-message').count(), 0);
    assert.equal(await getSearchMode(migrationPage), 'basic', 'Even an empty conversation preserves the chosen basic mode when free service is available');
    await migrationPage.getByRole('button', { name: '第二个旧会话', exact: true }).click();
    await chooseSearchMode(migrationPage, 'free');
    await waitArchive(migrationPage, 'free', 'legacy-second');
    await migrationPage.reload();
    await migrationPage.locator('.retrieval-status').waitFor();
    assert.equal(await getSearchMode(migrationPage), 'free');
    assert.equal(await migrationPage.locator('.conversation-row.active .conversation-select').innerText(), '第二个旧会话');
    assert.deepEqual(errors, []);
    await migrationContext.close();
    await testEffectAudio(browser);
    await testProviderBalance(browser);
    console.log(JSON.stringify({ singleRowPagination: true, mobileOneCardPerPage: true, pagingMakesNoAiRequests: true, resultOrderPreserved: true, resultLimits10_20_5: true, quantityArchiveRestored: true, moreExcludesAll20: true, oldFreeLimitCompatible: true, freeAgent10And20: true, customAgent20: true, hitSoundIntent: true, basicAudioAndEffects: true, historyReload: true, freeModel: true, contextPreservedWithoutReset: true, quotaError: true, customModel: true, defaultKeyTemporary: true, invalidIdRejected: true, htmlAsText: true, stopLateResponse: true, modelBeforeSearch: true, modelRewritesEmptySearch: true, moreExcludesPrevious: true, freeAgent: true, authoritativeDetails: true, noLegacyDownload: true, retrievalFailureVisible: true, runtimeErrors: errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
