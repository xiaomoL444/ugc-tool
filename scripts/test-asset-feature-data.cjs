// Synthetic fixtures only: no real assets, providers, keys, or deployments.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createFeatureSidecar } = require('./ai-search-feature-fixtures.cjs');
const { buildAssetFeatureCollection, loadAssetFeatures, assetFeaturePath, assetFeatureUrl } = require('../src/utils/assetFeatures.ts');

const multilingual = { 'zh-cn': '低沉敲击', 'zh-tw': '低沉敲擊', 'en-us': 'low knock', 'ja-jp': '低い打撃音', 'ru-ru': 'низкий стук' };
const effects = createFeatureSidecar('EffectPlayer', {
  1: { standVisual: { short: '蓝色扩散', keywords: ['蓝色', '蓝色'], uses: ['传送建议'], possibleSources: ['未知水元素来源'], uncertainDetails: ['疑似龙形'] },
    tailVisual: { short: '金色尾迹', description: '金色线段随运动拉长' }, audio: { short: multilingual, keywords: ['敲击'] } },
  2: { standVisual: { short: '静态火焰' }, audio: { short: '错误的无声资源音频' } },
  3: { standVisual: { status: 'not_generated' } },
  999: { audio: { short: '已删除资源不可出现' } },
});
const identities = [{ id: 1, hasAudio: true, audioPath: '1.m4a' }, { id: '2', hasAudio: true, audioPath: '' }, { id: '3' }];
const sound = createFeatureSidecar('SoundEffectPlayer', { 7: { audio: { short: multilingual, description: '一次闷响迅速衰减', keywords: ['低沉'], uses: ['探险提示'], possibleSources: ['猜测齿轮'], uncertainDetails: ['未确认鸣叫'] } } });

(async () => {
  const before = JSON.stringify(effects), list = buildAssetFeatureCollection('EffectPlayer', effects, identities);
  assert.equal(assetFeaturePath('SoundEffectPlayer'), 'SoundEffectPlayer/features.json');
  assert.equal(assetFeatureUrl('EffectPlayer', 'https://fixture.invalid/ugc-tool-data/'), 'https://fixture.invalid/ugc-tool-data/EffectPlayer/features.json');
  assert.deepEqual(list.get(1, 'zh-CN').map(item => item.part), ['standVisual', 'tailVisual', 'audio']);
  assert.deepEqual(list.get(1, 'zh-CN')[0].keywords, ['蓝色']);
  assert.equal(list.get(1, 'zh-CN'), list.get('1', 'zh-cn'), 'Playback rerenders retain the same description array and keep an open tooltip');
  assert.equal(list.get(1, 'en-US').find(item => item.part === 'audio').short, 'low knock');
  assert.equal(list.get(1, 'de-DE').length, 0, 'Unsupported language never displays a Chinese description');
  assert.equal(list.get(999, 'zh-CN').length, 0, 'Sidecar cannot create assets outside the base catalog');
  assert.equal(list.searchText.has('999'), false);
  assert.equal(list.get(2, 'zh-CN').some(item => item.part === 'audio'), false, 'An audio path is required, not just hasAudio');
  const silent = buildAssetFeatureCollection('EffectPlayer', effects, [{ id: 1, hasAudio: false, audioPath: '1.m4a' }]);
  assert.equal(silent.get(1, 'zh-CN').some(item => item.part === 'audio'), false, 'An audio path alone cannot override hasAudio');
  assert.equal(list.get(3, 'zh-CN').length, 0, 'Unfinished descriptions stay absent');
  for (const term of Object.values(multilingual)) assert.ok(list.searchText.get('1').includes(term), 'All languages are searchable');
  for (const term of ['传送建议', '未知水元素来源', '疑似龙形']) assert.ok(!list.searchText.get('1').includes(term));
  assert.equal(list.suggestionSearchText.get('1'), '传送建议');
  assert.equal(JSON.stringify(effects), before, 'Binding does not mutate original records or dictionaries');
  const audio = buildAssetFeatureCollection('SoundEffectPlayer', sound, [{ id: 7 }]);
  assert.equal(audio.get('7', 'ru-RU')[0].short, multilingual['ru-ru'], 'Ordinary sound resources do not use the effect media gate');
  const bad = structuredClone(sound); bad.i18n['ru-ru'] = {};
  assert.throws(() => buildAssetFeatureCollection('SoundEffectPlayer', bad, [{ id: 7 }]));

  let calls = 0, fail = false, gate;
  const waitForFetch = new Promise(resolve => { gate = resolve; });
  const fetcher = async url => { calls++; assert.ok(url.includes('/SoundEffectPlayer/features.json?_t=')); await waitForFetch; return fail ? new Response('', { status: 503 }) : Response.json(sound); };
  const options = { baseUrl: 'https://cache-fixture.invalid/data', cached: true, fetcher };
  const first = loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], options);
  const second = loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], options);
  gate();
  const results = await Promise.all([first, second]);
  assert.equal(calls, 1, 'Concurrent requests share one download');
  assert.ok(results.every(item => item.status === 'ready'));
  await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], options);
  assert.equal(calls, 1, 'Fresh parsed data is reused');
  fail = true;
  const stale = await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], { ...options, force: true });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.get(7, 'en-US')[0].short, 'low knock', 'A failed refresh preserves last-good descriptions');
  assert.equal(stale.errorCode, 'ASSET_FEATURES_UNAVAILABLE');
  const recovered = await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], { ...options, force: true, fetcher: async () => Response.json(sound) });
  assert.equal(recovered.status, 'ready');

  const external = structuredClone(sound), dictionaries = external.i18n;
  external.i18nSource = 'project-i18n-v1'; delete external.i18n;
  const dictionaryInput = Object.fromEntries(Object.entries(dictionaries).map(([locale, values]) => [locale, {
    translations: { ...values, 'soundEffectPlayer.data.7': '原本的资产名称' },
  }]));
  const externalCollection = buildAssetFeatureCollection('SoundEffectPlayer', external, [{ id: 7 }], { dictionaries: dictionaryInput });
  assert.deepEqual(externalCollection.get(7, 'zh-CN'), audio.get(7, 'zh-CN'));
  assert.ok(!externalCollection.searchText.get('7').includes('原本的资产名称'), 'Names remain in the player dictionary, outside feature evidence');
  const orphaned = structuredClone(dictionaryInput);
  for (const value of Object.values(orphaned)) value.translations['soundEffectPlayer.search.999.audio.short'] = '孤立描述不能绑定任何资源';
  assert.throws(() => buildAssetFeatureCollection('SoundEffectPlayer', external, [{ id: 7 }], { dictionaries: orphaned }),
    'Unreferenced feature translation is rejected rather than invented as asset evidence');
  let externalCalls = 0, badLocale = false, changed = false;
  const externalFetcher = async url => {
    externalCalls++;
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/features.json')) return Response.json(external);
    const locale = pathname.match(/\/i18n\/(.*)\.json$/)?.[1];
    assert.ok(locale && dictionaries[locale], 'External mode only loads the five corresponding player dictionaries');
    if (badLocale && locale === 'ru-ru') return new Response('', { status: 404 });
    const values = structuredClone(dictionaryInput[locale]);
    if (changed) values.translations['soundEffectPlayer.search.7.audio.short'] = `updated-${locale}`;
    return Response.json(values);
  };
  const externalOptions = { baseUrl: 'https://external-cache-fixture.invalid/data', fetcher: externalFetcher, cached: true };
  const externalResults = await Promise.all([
    loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], externalOptions),
    loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], externalOptions),
  ]);
  assert.equal(externalCalls, 6, 'External descriptors and all five dictionaries share one atomic singleflight');
  assert.equal(externalResults[0].get(7, 'en-US')[0].short, 'low knock');
  changed = true; badLocale = true;
  const partial = await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], { ...externalOptions, force: true });
  assert.equal(partial.status, 'stale');
  for (const [locale, text] of Object.entries(multilingual)) assert.equal(partial.get(7, locale)[0].short, text,
    'A failed language refresh cannot mix new dictionaries with last-good ones');
  badLocale = false;
  const originalNow = Date.now;
  Date.now = () => originalNow() + 61_000;
  let localeUpdate;
  try { localeUpdate = await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], externalOptions); }
  finally { Date.now = originalNow; }
  assert.equal(localeUpdate.status, 'ready');
  for (const locale of Object.keys(multilingual)) assert.equal(localeUpdate.get(7, locale)[0].short, `updated-${locale}`,
    'TTL reloads dictionary changes even when features.json is byte-for-byte unchanged');
  const tooSmallExternal = await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], {
    ...externalOptions, cached: false, maxBytes: new TextEncoder().encode(JSON.stringify(external)).byteLength + 1,
  });
  assert.equal(tooSmallExternal.errorCode, 'ASSET_FEATURES_TOO_LARGE', 'One byte budget bounds the entire features-plus-dictionaries group');

  for (const [fetcher, options, code] of [
    [async () => new Response('', { status: 404 }), {}, 'ASSET_FEATURES_UNAVAILABLE'],
    [async () => new Response('<html>gateway failed</html>', { headers: { 'Content-Type': 'text/html' } }), {}, 'ASSET_FEATURES_INVALID'],
    [async () => Response.json(bad), {}, 'ASSET_FEATURES_INVALID'],
    [async () => Response.json(sound), { maxBytes: 10 }, 'ASSET_FEATURES_TOO_LARGE'],
    [async () => new Response('x', { headers: { 'Content-Length': '5000', 'Content-Type': 'application/json' } }), { maxBytes: 10 }, 'ASSET_FEATURES_TOO_LARGE'],
    [async () => new Response(new Uint8Array([0xc0, 0xaf]), { headers: { 'Content-Type': 'application/json' } }), {}, 'ASSET_FEATURES_INVALID'],
    [async () => new Promise(() => {}), { timeoutMs: 5 }, 'ASSET_FEATURES_TIMEOUT'],
    [async () => new Response(new ReadableStream({ start() {} })), { timeoutMs: 5 }, 'ASSET_FEATURES_TIMEOUT'],
  ]) {
    const missing = await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], { ...options, fetcher, cached: false });
    assert.equal(missing.status, 'unavailable'); assert.equal(missing.errorCode, code);
    assert.equal(missing.get(7, 'zh-CN').length, 0); assert.equal(missing.searchText.size, 0);
  }
  console.log('Asset feature binding, five languages, external dictionaries, atomic shared cache, evidence separation, limits, timeout and fallback passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
