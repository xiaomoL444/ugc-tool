/* Synthetic fetches and an in-memory Vue renderer only. Never calls a model or service. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createRenderer, nextTick } = require('vue');
const { createI18n } = require('vue-i18n');
const { createFeatureSidecar } = require('./ai-search-feature-fixtures.cjs');
const { loadResourceCatalog, buildSearchResources, retrieveResources } = require('../src/views/AISearch/resourceCatalog.ts');
const { parseFeatureSync, parseServerCatalog, featureHashesChanged, requestServerAssets } = require('../src/views/AISearch/aiSearchService.ts');
const { useAISearch } = require('../src/views/AISearch/useAISearch.ts');
const { buildAssetFeatureCollection, assetFeaturePath, assetFeatureUrl } = require('../src/utils/assetFeatures.ts');
const hashA = 'a'.repeat(64), hashB = 'b'.repeat(64);
const ready = { status: 'ready', hashes: { sound: hashA, effect: hashA, bgm: hashA }, checkedAt: 1700000000000, lastGoodAt: 1700000000000, updatedAt: 1700000000000 };
assert.deepEqual(parseFeatureSync(ready), ready);
assert.equal(parseFeatureSync(undefined), undefined, 'Legacy service responses remain readable');
assert.equal(featureHashesChanged({}, ready.hashes), false, 'First load is not an update');
assert.equal(featureHashesChanged(ready.hashes, { ...ready.hashes, sound: hashB }), true);
assert.equal(featureHashesChanged(ready.hashes, { ...ready.hashes, bgm: hashB }), true, 'BGM-only updates are visible');
assert.equal(featureHashesChanged({ sound: hashA, effect: hashA }, ready.hashes), true, 'First BGM feature publication after an existing catalogue is an update');
assert.equal(featureHashesChanged(ready.hashes, ready.hashes), false);
assert.deepEqual(parseFeatureSync({ ...ready, hashes: { sound: hashA, effect: hashA } }).hashes, { sound: hashA, effect: hashA }, 'Older two-source deployments remain supported');
assert.equal(featureHashesChanged(ready.hashes, {}), false);
for (const value of [null, [], { ...ready, status: 'unknown' }, { ...ready, hashes: { sound: 'x'.repeat(65) } }, { ...ready, hashes: { bgm: 'not-a-hash' } }, { ...ready, hashes: { sound: hashA, secret: hashA } }, { ...ready, hashes: [] }, { ...ready, checkedAt: Infinity }, { ...ready, lastGoodAt: -1 }, { ...ready, updatedAt: Number.MAX_SAFE_INTEGER }, { ...ready, errorCode: 'x'.repeat(81) }]) {
  assert.throws(() => parseFeatureSync(value), error => error.code === 'RETRIEVAL_RESPONSE');
}
assert.deepEqual(parseServerCatalog({ catalogVersion: 'v1', mode: 'keyword', total: 3, featureSync: ready }).featureSync, ready);
const catalog = {
  SoundEffectPlayer: { data: [{ id: '1', nameI18nKey: 'soundEffectPlayer.data.1', duration: '2', description: 'legacy description must be ignored' }], category: [] },
  EffectPlayer: { effectData: { 2: { id: '2', nameI18nKey: 'effectPlayer.data.2', hasAudio: true, audioPath: '2.m4a', duration: 3, visualDescription: 'legacy visual must be ignored' } } },
  BgmPlayer: { data: [{ id: '3', nameI18nKey: 'bgmPlayer.data.3', minute: 1, second: 50, description: 'legacy music must be ignored', suggestedUses: 'unsupported legacy suggestion' }] },
};
const names = { 'soundEffectPlayer.data.1': 'fixture sound', 'effectPlayer.data.2': 'fixture effect', 'bgmPlayer.data.3': 'fixture music' };
const musicShort = { 'zh-cn': '轻柔拨弦与舒缓旋律', 'zh-tw': '輕柔撥弦與舒緩旋律', 'en-us': 'gentle plucked strings and relaxed melody', 'ja-jp': '柔らかな撥弦と穏やかな旋律', 'ru-ru': 'мягкие щипковые струны и спокойная мелодия' };
const musicUse = { 'zh-cn': '月夜休憩场景建议', 'zh-tw': '月夜休憩場景建議', 'en-us': 'moonlit rest scene suggestion', 'ja-jp': '月夜の休息場面への提案', 'ru-ru': 'рекомендация для сцены отдыха при луне' };
const sidecars = {
  SoundEffectPlayer: createFeatureSidecar('SoundEffectPlayer', { 1: { audio: { short: '低频短促闷响', description: '一次闷响迅速衰减', keywords: ['闷响'], uses: ['探险提示'], possibleSources: ['火山猜测'], uncertainDetails: ['未经确认的齿轮'] } } }),
  EffectPlayer: createFeatureSidecar('EffectPlayer', { 2: { standVisual: { short: '蓝色水纹扩散', keywords: ['蓝色', '水纹'] }, tailVisual: { short: '金色线段拖尾', keywords: ['金色'] }, audio: { short: '木质敲击声', keywords: ['木质'], uses: ['探险提示'] } } }),
  BgmPlayer: createFeatureSidecar('BgmPlayer', { 3: { audio: { short: musicShort, keywords: ['拨弦'], uses: [musicUse], possibleSources: ['unconfirmed instrument'] } } }),
};
async function fallbackSnapshot(options = {}) {
  const requests = [];
  const snapshot = await loadResourceCatalog(async url => {
    const path = new URL(url).pathname; requests.push(path);
    const project = Object.keys(catalog).find(project => path.includes(`/${project}/`));
    if (path.endsWith('/features.json')) {
      if (options.missing) return new Response('', { status: 404 });
      if (options.tooLarge && project === 'SoundEffectPlayer') return { ok: true, text: async () => 'x'.repeat(40000001) };
      const sidecar = structuredClone(sidecars[project]);
      if (options.invalid) sidecar.i18n['ru-ru'] = {};
      if (options.external) { sidecar.i18nSource = 'project-i18n-v1'; delete sidecar.i18n; }
      return Response.json(sidecar);
    }
    if (path.endsWith('/data.json')) return Response.json(catalog[project]);
    const locale = path.match(/\/i18n\/(.*)\.json$/)?.[1];
    if (options.external) {
      if (options.missingLocale && project === (options.changedProject || 'SoundEffectPlayer') && locale === 'ru-ru') return new Response('', { status: 404 });
      const featureValues = structuredClone(sidecars[project].i18n[locale]);
      if (options.changedLocale && project === (options.changedProject || 'SoundEffectPlayer') && locale === 'zh-cn') {
        const key = project === 'BgmPlayer' ? 'bgmPlayer.search.3.audio.short' : 'soundEffectPlayer.search.1.audio.short';
        featureValues[key] = '新描述五语字典更新';
      }
      return Response.json({ ...names, ...featureValues });
    }
    return Response.json(names);
  }, 'https://fixture.invalid');
  return { snapshot, requests };
}
async function waitUntil(condition) {
  for (let round = 0; round < 100; round++) { await nextTick(); if (condition()) return; await new Promise(resolve => setImmediate(resolve)); }
  throw new Error('State did not settle');
}
const renderer = createRenderer({
  createElement: type => ({ type, children: [] }), createText: text => ({ text }), createComment: text => ({ text }),
  setText: (node, text) => { node.text = text; }, setElementText: (node, text) => { node.text = text; },
  insert: (node, parent) => { parent.children.push(node); }, remove: () => {}, patchProp: () => {},
  parentNode: () => null, nextSibling: () => null,
});
(async () => {
  const { snapshot, requests } = await fallbackSnapshot();
  assert.deepEqual(snapshot.featureFailures, []);
  assert.ok(requests.includes('/SoundEffectPlayer/features.json'));
  assert.ok(requests.includes('/EffectPlayer/features.json'));
  assert.ok(requests.includes('/BgmPlayer/features.json'));
  assert.equal(snapshot.featureHashes.bgm.length, 64);
  assert.equal(snapshot.featureHashes.sound.length, 64);
  const resources = buildSearchResources(snapshot, 'zh-CN');
  const sound = resources.find(item => item.kind === 'sound'), effect = resources.find(item => item.kind === 'effect');
  assert.equal(sound.description, '低频短促闷响\n一次闷响迅速衰减');
  assert.deepEqual(sound.keywords, ['闷响']);
  assert.deepEqual(sound.suggestedUses, ['探险提示']);
  assert.equal(effect.description, '蓝色水纹扩散\n金色线段拖尾');
  assert.equal(effect.audioDescription, '木质敲击声');
  const music = resources.find(item => item.kind === 'bgm');
  assert.equal(music.description, musicShort['zh-cn']);
  assert.equal(music.href, '/BgmPlayer?id=3');
  assert.equal(music.duration, 110);
  assert.equal(music.hasAudio, true);
  assert.deepEqual(music.suggestedUses, [musicUse['zh-cn']]);
  assert.ok(music.audioText.includes(musicShort['zh-cn']), 'BGM audio search uses the ordinary primary audio description');
  assert.ok(!music.featureText.includes('legacy') && !music.featureText.includes(musicUse['zh-cn']) && !music.featureText.includes('unconfirmed'), 'Uses and unconfirmed sources never become observed music features');
  assert.equal(retrieveResources(resources, { query: '拨弦', scope: 'bgm', searchType: 'feature', includeEffectAudio: false })[0].resourceId, 'bgm:3');
  assert.equal(retrieveResources(resources, { query: '舒缓 BGM', scope: 'all', includeEffectAudio: true })[0].resourceId, 'bgm:3', 'Music intent in all assets can retrieve BGM features');
  assert.equal(retrieveResources(resources, { query: '拨弦', scope: 'bgm', matchOn: 'audio', includeEffectAudio: false })[0].resourceId, 'bgm:3');
  assert.equal(retrieveResources(resources, { query: '月夜休憩', scope: 'bgm', searchType: 'suggestion', includeEffectAudio: false })[0].matchType, 'suggestion');
  assert.equal(retrieveResources(resources, { query: '拨弦', scope: 'sound', includeEffectAudio: true }).length, 0, 'Music cannot escape an explicitly selected sound scope');
  assert.equal(assetFeaturePath('BgmPlayer'), 'BgmPlayer/features.json');
  assert.equal(assetFeatureUrl('BgmPlayer', 'https://fixture.invalid/ugc-tool-data/'), 'https://fixture.invalid/ugc-tool-data/BgmPlayer/features.json');
  const musicCollection = buildAssetFeatureCollection('BgmPlayer', sidecars.BgmPlayer, [{ id: 3 }]);
  assert.deepEqual(musicCollection.get(3, 'zh-CN').map(part => part.part), ['audio'], 'BGM descriptors do not require an effect audioPath');
  for (const [locale, short] of Object.entries(musicShort)) {
    const displayLocale = { 'zh-cn': 'zh-CN', 'zh-tw': 'zh-TW', 'en-us': 'en-US', 'ja-jp': 'ja-JP', 'ru-ru': 'ru-RU' }[locale];
    const localizedMusic = buildSearchResources(snapshot, displayLocale).find(item => item.kind === 'bgm');
    assert.equal(localizedMusic.description, short);
    assert.deepEqual(localizedMusic.suggestedUses, [musicUse[locale]]);
    assert.ok(musicCollection.searchText.get('3').includes(short));
    assert.ok(musicCollection.suggestionSearchText.get('3').includes(musicUse[locale]));
  }
  assert.ok(!effect.featureText.includes('木质'), 'Audio evidence stays outside visual feature text');
  assert.ok(!effect.audioText.includes('水纹'), 'Visual evidence stays outside audio text');
  assert.ok(!sound.featureText.includes('legacy'));
  for (const unobserved of ['火山猜测', '未经确认的齿轮', '探险提示']) assert.ok(!sound.featureText.includes(unobserved));
  assert.equal(retrieveResources(resources, { query: '探险提示', scope: 'sound', searchType: 'suggestion', includeEffectAudio: false })[0].matchType, 'suggestion');
  assert.equal(retrieveResources(resources, { query: '木质', scope: 'effect', matchOn: 'visual', includeEffectAudio: false }).length, 0);
  assert.equal(retrieveResources(resources, { query: '木质', scope: 'effect', matchOn: 'audio', includeEffectAudio: false })[0].resourceId, 'effect:2');
  const sourceBefore = JSON.stringify(catalog);
  buildSearchResources(snapshot, 'ja-JP');
  assert.equal(JSON.stringify(catalog), sourceBefore, 'Base resource data remains unchanged');
  const external = await fallbackSnapshot({ external: true });
  assert.deepEqual(external.snapshot.featureFailures, [], 'External dictionaries hydrate all three player feature sets');
  assert.deepEqual(buildSearchResources(external.snapshot, 'zh-CN'), resources,
    'AI receives exactly the same descriptions when their text moves into project i18n');
  assert.deepEqual(external.snapshot.featureHashes, snapshot.featureHashes);
  const localeChanged = await fallbackSnapshot({ external: true, changedLocale: true });
  assert.notEqual(localeChanged.snapshot.featureHashes.sound, external.snapshot.featureHashes.sound,
    'Changing a dictionary description updates the feature hash even without editing features.json');
  assert.ok(buildSearchResources(localeChanged.snapshot, 'zh-CN').find(item => item.kind === 'sound').description.includes('新描述五语字典更新'));
  const bgmLocaleChanged = await fallbackSnapshot({ external: true, changedLocale: true, changedProject: 'BgmPlayer' });
  assert.notEqual(bgmLocaleChanged.snapshot.featureHashes.bgm, external.snapshot.featureHashes.bgm, 'BGM dictionary-only changes update the feature hash');
  assert.equal(bgmLocaleChanged.snapshot.featureHashes.sound, external.snapshot.featureHashes.sound);
  assert.ok(buildSearchResources(bgmLocaleChanged.snapshot, 'zh-CN').find(item => item.kind === 'bgm').description.includes('新描述五语字典更新'));
  const bgmLocaleMissing = await fallbackSnapshot({ external: true, missingLocale: true, changedProject: 'BgmPlayer' });
  assert.ok(bgmLocaleMissing.snapshot.featureFailures.includes('BgmPlayer'));
  const fallbackMusic = buildSearchResources(bgmLocaleMissing.snapshot, 'zh-CN').find(item => item.kind === 'bgm');
  assert.equal(fallbackMusic.title, 'fixture music');
  assert.equal(fallbackMusic.description, '', 'Failed BGM features preserve identity without unverified flat descriptions');
  assert.deepEqual(fallbackMusic.suggestedUses, []);
  const missingLocale = await fallbackSnapshot({ external: true, missingLocale: true });
  assert.ok(missingLocale.snapshot.featureFailures.includes('SoundEffectPlayer'));
  assert.equal(missingLocale.snapshot.sources.length, 3);
  const missingLocaleResources = buildSearchResources(missingLocale.snapshot, 'zh-CN');
  assert.equal(missingLocaleResources.find(item => item.kind === 'sound').description, '', 'Incomplete external feature locales preserve the base name/media list');
  assert.ok(missingLocaleResources.find(item => item.kind === 'effect').description.includes('蓝色'));
  for (const options of [{ missing: true }, { invalid: true }, { tooLarge: true }]) {
    const { snapshot: missing } = await fallbackSnapshot(options);
    assert.equal(missing.sources.length, 3, 'Missing or invalid sidecar preserves the base list');
    assert.equal(missing.failures.length, 0);
    assert.ok(missing.featureFailures.includes('SoundEffectPlayer'));
    const fallback = buildSearchResources(missing, 'zh-CN');
    assert.equal(fallback.find(item => item.kind === 'sound').description, '');
    assert.equal(retrieveResources(fallback, { query: 'fixture sound', scope: 'sound', includeEffectAudio: false })[0].id, '1');
  }
  const invalidMeta = { ...ready, hashes: { sound: 'not a hash' } };
  await assert.rejects(() => requestServerAssets('/api/ai-search', ['sound:1'], 'zh-CN', 'v1', new AbortController().signal, new Set(), async () => Response.json({ catalogVersion: 'v1', items: [{ resourceId: 'sound:1', title: 'sound' }], featureSync: invalidMeta })), error => error.code === 'ASSET_DETAILS');
  const musicDetails = await requestServerAssets('/api/ai-search', ['bgm:3'], 'zh-CN', 'v1', new AbortController().signal, new Set(), async () => Response.json({ catalogVersion: 'v1', items: [{ resourceId: 'bgm:3', kind: 'bgm', title: 'fixture music', description: musicShort['zh-cn'], suggestedUses: [musicUse['zh-cn']], hasAudio: true, duration: 110 }], featureSync: ready }));
  assert.equal(musicDetails[0].description, musicShort['zh-cn'], 'Model-selected BGM cards retain trusted service descriptions');
  assert.deepEqual(musicDetails[0].suggestedUses, [musicUse['zh-cn']]);
  const originalFetch = global.fetch;
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  global.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  let current = ready, version = 'v1', failChat = false, chatRequests = 0, catalogRequests = 0;
  const asset = { resourceId: 'sound:1', kind: 'sound', title: 'retained sound', description: 'retained observed description', keywords: ['rumble'], duration: 2 };
  global.fetch = async (url, input) => {
    const endpoint = String(url).split('?')[0].split('/').pop();
    if (endpoint === 'config') return Response.json({ configured: true, available: true, model: 'fixture-only', retrieval: { available: true }, agent: { available: true }, quota: { remaining: 5, limit: 5, resetAt: 'fixture' } });
    if (endpoint === 'catalog') { catalogRequests++; return Response.json({ catalogVersion: version, total: 3, mode: 'keyword', featureSync: current }); }
    if (endpoint === 'chat') {
      chatRequests++;
      if (failChat) { failChat = false; return Response.json({ error: { code: 'CATALOG_VERSION_MISMATCH' } }, { status: 409 }); }
      return Response.json({ catalogVersion: version, featureSync: current, resources: [asset], answer: 'fixture answer', matches: [{ resourceId: 'sound:1', reason: 'observed rumble', matchType: 'feature' }] });
    }
    if (endpoint === 'search') return Response.json({ catalogVersion: version, mode: 'keyword', total: 1, hasMore: false, items: [asset], featureSync: current });
    if (endpoint === 'assets') return Response.json({ catalogVersion: version, items: [asset], featureSync: current });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  let state;
  const app = renderer.createApp({ setup() { state = useAISearch(); return () => null; } });
  const i18n = createI18n({ legacy: false, flatJson: true, locale: 'zh-CN', messages: { 'zh-CN': JSON.parse(fs.readFileSync(require.resolve('../src/i18n/locales/aiSearch/zh-cn.json'), 'utf8')) } });
  app.provide("storage", undefined);
  app.use(i18n);
  app.mount({ children: [] });
  try {
    await waitUntil(() => !state.loadingCatalog.value && !state.loadingArchive.value);
    assert.equal(state.featuresUpdated.value, false);
    state.mode.value = 'free';
    await state.send('first sound');
    const id = state.activeConversationId.value, firstCards = JSON.stringify(state.messages.value[1].cards);
    current = { ...ready, hashes: { sound: hashB, effect: hashA, bgm: hashA } }; version = 'v2';
    await state.send('second sound');
    assert.equal(state.featuresUpdated.value, true, 'New hash is visible across successful Agent rounds');
    assert.equal(state.activeConversationId.value, id);
    assert.equal(JSON.stringify(state.messages.value[1].cards), firstCards, 'Historical result snapshots remain intact');
    assert.equal(state.conversations.value[0].contextStart, 0);
    state.featuresUpdated.value = false;
    current = { ...current, hashes: { ...current.hashes, bgm: hashB } }; version = 'v3';
    state.mode.value = 'basic';
    await state.send('rumble');
    assert.equal(state.featuresUpdated.value, true, 'A BGM-only update triggers the existing frontend update notice');
    assert.equal(JSON.stringify(state.messages.value[1].cards), firstCards);
    current = { ...current, status: 'stale', errorCode: 'ASSET_FEATURES_HTTP' };
    state.mode.value = 'basic';
    await state.send('rumble');
    assert.equal(state.featureSync.value.status, 'stale');
    assert.equal(state.messages.value.at(-1).status, 'complete', 'Last-good descriptions remain searchable');
    state.mode.value = 'free'; failChat = true;
    const beforeCatalogRequests = catalogRequests;
    await state.send('retry sound');
    assert.equal(chatRequests, 3, 'A 409 never automatically repeats the paid request');
    assert.ok(catalogRequests > beforeCatalogRequests, 'Version conflict refreshes catalogue metadata');
    assert.equal(state.messages.value.at(-1).status, 'error');
    assert.equal(state.canRetrySearch.value, true);
    const failedMessages = state.messages.value.length;
    current = { ...current, status: 'ready' };
    await state.retrySearch();
    assert.equal(chatRequests, 4, 'Retry is only sent after the explicit action');
    assert.equal(state.messages.value.length, failedMessages + 2);
    assert.equal(state.messages.value[failedMessages - 1].status, 'error', 'Failed round is retained after retry');
    assert.equal(state.conversations.value[0].contextStart, 0);
    assert.equal(state.canRetrySearch.value, false);
    state.featureMissing.value = false;
  } finally { app.unmount(); global.fetch = originalFetch; }
  const localeFiles = ['zh-cn', 'zh-tw', 'en-us', 'ja-jp', 'ru-ru'].map(locale => JSON.parse(fs.readFileSync(require.resolve(`../src/i18n/locales/aiSearch/${locale}.json`), 'utf8')));
  for (const messages of localeFiles) for (const key of ['updated', 'stale', 'missing', 'retryHint', 'retry', 'dismiss']) assert.ok(messages[`aiSearch.featureSync.${key}`]?.trim());
  console.log('PASS frontend asset features: BGM five-locale audio/use features and hash updates, sidecar isolation, bounded sync parser, missing fallback, five locales, cross-turn update, last-good stale and manual-only 409 retry with preserved history');
})().catch(error => { console.error(error); process.exitCode = 1; });
