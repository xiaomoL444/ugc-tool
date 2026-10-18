// Synthetic fixtures only: no real assets, providers, keys, or deployments.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
global.window = {};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createFeatureSidecar } = require('./ai-search-feature-fixtures.cjs');
const { buildAssetFeatureCollection, loadAssetFeatures, assetFeaturePath, assetFeatureUrl } = require('../src/utils/assetFeatures.ts');
const { loadOssTranslations, loadOssTranslationDictionary, remoteI18n } = require('../src/i18n/index.ts');

const deferred = () => { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; };
const flush = async () => { for (let round = 0; round < 4; round++) await new Promise(resolve => setImmediate(resolve)); };
class FakeClock {
  constructor() { this.now = 0; this.sequence = 0; this.timers = new Map(); this.original = { setTimeout, clearTimeout, now: Date.now }; }
  install() {
    global.setTimeout = (callback, delay = 0, ...args) => {
      const id = ++this.sequence;
      this.timers.set(id, { at: this.now + Math.max(0, Number(delay) || 0), callback, args });
      return id;
    };
    global.clearTimeout = id => this.timers.delete(id);
    Date.now = () => 1_800_000_000_000 + this.now;
  }
  async advance(milliseconds) {
    const target = this.now + milliseconds;
    for (;;) {
      const next = [...this.timers].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      this.now = next[1].at; this.timers.delete(next[0]); next[1].callback(...next[1].args);
      await flush();
    }
    this.now = target; await flush();
  }
  restore() { global.setTimeout = this.original.setTimeout; global.clearTimeout = this.original.clearTimeout; Date.now = this.original.now; }
}

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
    version: 1, namespace: 'soundEffectPlayer', locale,
    translations: Object.fromEntries(Object.entries({ ...values, 'soundEffectPlayer.data.7': '原本的资产名称' })
      .map(([key, value]) => [key.replace(/^soundEffectPlayer\./, ''), value])),
  }]));
  const externalCollection = buildAssetFeatureCollection('SoundEffectPlayer', external, [{ id: 7 }], { dictionaries: dictionaryInput });
  assert.deepEqual(externalCollection.get(7, 'zh-CN'), audio.get(7, 'zh-CN'));
  assert.ok(!externalCollection.searchText.get('7').includes('原本的资产名称'), 'Names remain in the player dictionary, outside feature evidence');
  const orphaned = structuredClone(dictionaryInput);
  for (const value of Object.values(orphaned)) value.translations['search.999.audio.short'] = '孤立描述不能绑定任何资源';
  assert.throws(() => buildAssetFeatureCollection('SoundEffectPlayer', external, [{ id: 7 }], { dictionaries: orphaned }),
    'Unreferenced feature translation is rejected rather than invented as asset evidence');
  let externalCalls = 0, badLocale = false, changed = false;
  const externalFetcher = async url => {
    externalCalls++;
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/features.json')) return Response.json(external);
    const locale = pathname.match(/\/i18n\/(.*)\.json$/)?.[1];
    assert.ok(locale && dictionaries[locale], 'External mode uses the corresponding project dictionary');
    if (badLocale && locale === 'en-us') return new Response('', { status: 503 });
    const values = structuredClone(dictionaryInput[locale]);
    if (changed) values.translations['search.7.audio.short'] = `updated-${locale}`;
    return Response.json(values);
  };
  const externalOptions = { baseUrl: 'https://external-cache-fixture.invalid/data', fetcher: externalFetcher, cached: true, locale: 'en-US' };
  const externalResults = await Promise.all([
    loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], externalOptions),
    loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], externalOptions),
  ]);
  assert.equal(externalCalls, 2, 'Concurrent description consumers download metadata and the selected shared dictionary once');
  assert.equal(externalResults[0].get(7, 'en-US')[0].short, 'low knock');
  changed = true; badLocale = true;
  const partial = await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], { ...externalOptions, force: true });
  assert.equal(partial.status, 'stale');
  assert.equal(partial.get(7, 'en-US')[0].short, 'low knock', 'A failed refresh retains its last-good language');
  assert.deepEqual(partial.get(7, 'zh-CN'), [], 'Last-good data cannot fall back to another language');
  badLocale = false;
  const retry = await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], externalOptions);
  assert.equal(retry.get(7, 'en-US')[0].short, 'updated-en-us', 'The shared i18n entry retries a failed refresh without an explicit force');
  const afterRecovery = externalCalls;
  const originalNow = Date.now;
  Date.now = () => originalNow() + 61_000;
  let localeUpdate;
  try { localeUpdate = await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], externalOptions); }
  finally { Date.now = originalNow; }
  assert.equal(localeUpdate.status, 'ready');
  assert.equal(localeUpdate.get(7, 'en-US')[0].short, 'updated-en-us');
  assert.equal(externalCalls, afterRecovery + 1, 'The metadata TTL does not bypass the central dictionary cache');
  const explicitRefresh = await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], { ...externalOptions, force: true });
  assert.equal(explicitRefresh.get(7, 'en-US')[0].short, 'updated-en-us', 'An explicit refresh goes through the shared dictionary entry');
  const tooSmallExternal = await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], {
    ...externalOptions, cached: false, maxBytes: new TextEncoder().encode(JSON.stringify(external)).byteLength + 1,
  });
  assert.equal(tooSmallExternal.errorCode, 'ASSET_FEATURES_TOO_LARGE', 'One byte budget bounds the entire features-plus-dictionaries group');

  const localeRequests = [];
  const localeFetcher = async url => {
    const pathname = new URL(url).pathname;
    localeRequests.push(pathname);
    if (pathname.endsWith('/features.json')) return Response.json(external);
    const locale = pathname.match(/\/i18n\/(.*)\.json$/)?.[1];
    assert.ok(locale && dictionaryInput[locale]);
    return Response.json(dictionaryInput[locale]);
  };
  const localeOptions = { baseUrl: 'https://locale-cache-fixture.invalid/data', fetcher: localeFetcher, cached: true, locale: 'zh-CN' };
  const chinese = await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], localeOptions);
  assert.equal(chinese.status, 'ready');
  assert.equal(chinese.get(7, 'zh-CN')[0].short, multilingual['zh-cn']);
  assert.deepEqual(chinese.get(7, 'en-US'), [], 'Unloaded languages have no guessed fallback descriptions');
  assert.ok(!chinese.searchText.get('7').includes('low knock'), 'Search only indexes downloaded descriptions');
  assert.deepEqual(localeRequests, ['/data/SoundEffectPlayer/features.json', '/data/SoundEffectPlayer/i18n/zh-cn.json'],
    'External descriptions only download the current dictionary');
  await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], { ...localeOptions, locale: 'zh_cn' });
  assert.equal(localeRequests.length, 2, 'Equivalent locale spellings share cached data');
  const english = await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], { ...localeOptions, locale: 'en-US' });
  assert.equal(english.get(7, 'en-US')[0].short, multilingual['en-us']);
  assert.deepEqual(english.get(7, 'zh-CN'), [], 'A language switch uses an independent parsed snapshot');
  assert.deepEqual(localeRequests.slice(2), ['/data/SoundEffectPlayer/i18n/en-us.json'], 'Language switches reuse locale-independent feature metadata');
  await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], localeOptions);
  assert.equal(localeRequests.length, 3, 'Switching back reuses the public dictionary cache');
  const failedEnglish = await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], {
    ...localeOptions, locale: 'en-US', force: true, fetcher: async () => new Response('', { status: 503 }),
  });
  assert.equal(failedEnglish.status, 'stale');
  assert.equal(failedEnglish.get(7, 'en-US')[0].short, multilingual['en-us']);
  assert.deepEqual(failedEnglish.get(7, 'zh-CN'), [], 'Last-good refresh data remains scoped to its language');
  let embeddedCalls = 0;
  const embedded = await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], {
    locale: 'zh-CN', fetcher: async () => { embeddedCalls++; return Response.json(sound); }, cached: false,
  });
  assert.equal(embeddedCalls, 1, 'Embedded dictionaries do not trigger any extra i18n request');
  assert.equal(embedded.get(7, 'en-US')[0].short, multilingual['en-us'], 'Embedded sidecars keep their existing multilingual search');
  const wrongLanguage = await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], {
    ...localeOptions, cached: false, locale: 'en-US', fetcher: async url => url.includes('/features.json')
      ? Response.json(external) : Response.json({ ...dictionaryInput['en-us'], locale: 'zh-cn' }),
  });
  assert.equal(wrongLanguage.status, 'unavailable');
  assert.equal(wrongLanguage.errorCode, 'ASSET_FEATURES_INVALID', 'A mislabeled wrapper must not display another language as English');

  // Reproduce a sidecar gaining new description references while shared dictionaries
  // are already cached. Successful metadata updates must revalidate each used language.
  const updatedShort = Object.fromEntries(Object.keys(multilingual).map(locale => [locale, `new-${locale}`]));
  const updatedDetail = Object.fromEntries(Object.keys(multilingual).map(locale => [locale, `detail-${locale}`]));
  const revisions = [sound, createFeatureSidecar('SoundEffectPlayer', {
    7: { audio: { short: multilingual, description: updatedDetail, keywords: ['低沉'], uses: ['探险提示'],
      possibleSources: ['猜测齿轮'], uncertainDetails: ['未确认鸣叫'] } },
    8: { audio: { short: updatedShort } },
  })];
  let revision = 0;
  const updateRequests = [];
  const updateFetcher = async url => {
    const pathname = new URL(url).pathname;
    updateRequests.push(pathname);
    if (pathname.endsWith('/features.json')) {
      const { i18n, ...metadata } = revisions[revision];
      return Response.json({ ...metadata, i18nSource: 'project-i18n-v1' });
    }
    const locale = pathname.match(/\/i18n\/(.*)\.json$/)?.[1];
    assert.ok(locale && revisions[revision].i18n[locale]);
    return Response.json(revisions[revision].i18n[locale]);
  };
  const updateOptions = { baseUrl: 'https://metadata-update-fixture.invalid/data', fetcher: updateFetcher, cached: true, locale: 'zh-CN' };
  const updateIdentities = [{ id: 7 }, { id: 8 }];
  await loadAssetFeatures('SoundEffectPlayer', updateIdentities, updateOptions);
  await loadAssetFeatures('SoundEffectPlayer', updateIdentities, { ...updateOptions, locale: 'en-US' });
  assert.equal(updateRequests.length, 3, 'Initial metadata is shared across the two explicitly selected languages');
  revision = 1;
  Date.now = () => originalNow() + 61_000;
  let updated;
  try {
    updated = await Promise.all([
      loadAssetFeatures('SoundEffectPlayer', updateIdentities, updateOptions),
      loadAssetFeatures('SoundEffectPlayer', updateIdentities, updateOptions),
    ]);
  } finally { Date.now = originalNow; }
  assert.ok(updated.every(collection => collection.status === 'ready'), 'Changed metadata plus its shared dictionary recover atomically');
  assert.equal(updated[0].get(8, 'zh-CN')[0].short, 'new-zh-cn');
  assert.equal(updated[0].get(7, 'zh-CN')[0].detail, 'detail-zh-cn');
  assert.deepEqual(updated[0].get(8, 'en-US'), [], 'The current snapshot never reads another cached language');
  assert.equal(updateRequests.length, 5, 'Changed metadata triggers one current-language revalidation, shared by concurrent consumers');
  await loadAssetFeatures('SoundEffectPlayer', updateIdentities, updateOptions);
  assert.equal(updateRequests.length, 5, 'An already aligned metadata/dictionary pair returns to normal shared caching');
  const updatedEnglish = await loadAssetFeatures('SoundEffectPlayer', updateIdentities, { ...updateOptions, locale: 'en-US' });
  assert.equal(updatedEnglish.status, 'ready');
  assert.equal(updatedEnglish.get(8, 'en-US')[0].short, 'new-en-us');
  assert.deepEqual(updatedEnglish.get(8, 'zh-CN'), [], 'A previously cached language is revalidated without a cross-language fallback');
  assert.equal(updateRequests.length, 6, 'Switching to an older cached language refreshes only its shared dictionary');
  Date.now = () => originalNow() + 122_000;
  try { await loadAssetFeatures('SoundEffectPlayer', updateIdentities, updateOptions); }
  finally { Date.now = originalNow; }
  assert.equal(updateRequests.length, 7, 'Unchanged metadata after another TTL revalidation does not fetch a dictionary again');

  const namesOnlyBase = 'https://name-first-fixture.invalid/data';
  revision = 0;
  await loadOssTranslations('SoundEffectPlayer', 'soundEffectPlayer', 'i18n', {
    locale: 'zh-CN', baseUrl: namesOnlyBase, fetcher: updateFetcher,
  });
  revision = 1;
  const namesOnlyRequests = updateRequests.length;
  const firstDescription = await loadAssetFeatures('SoundEffectPlayer', updateIdentities, { ...updateOptions, baseUrl: namesOnlyBase });
  assert.equal(firstDescription.status, 'ready', 'A first description load recovers a dictionary cached earlier by a name-only consumer');
  assert.equal(firstDescription.get(8, 'zh-CN')[0].short, 'new-zh-cn');
  assert.equal(updateRequests.length, namesOnlyRequests + 2, 'Dangling references cause just one shared dictionary refresh');

  // The large player dictionaries also supply names. A name-first caller must give
  // a shared request the same budget as its later description consumer.
  const clock = new FakeClock();
  clock.install();
  const originalFetch = global.fetch;
  try {
    const metadataGate = deferred(), dictionaryGate = deferred(), slowRequests = [];
    const slowFetcher = (url, input) => {
      const pathname = new URL(url).pathname;
      slowRequests.push({ pathname, signal: input.signal });
      return pathname.endsWith('/features.json') ? metadataGate.promise : dictionaryGate.promise;
    };
    const slowOptions = { baseUrl: 'https://slow-first-fixture.invalid/data', fetcher: slowFetcher, locale: 'en-US', cached: true };
    const slowNames = loadOssTranslations('SoundEffectPlayer', 'soundEffectPlayer', 'i18n', slowOptions);
    let firstFinished = false;
    const slowDescriptions = loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], slowOptions).then(value => { firstFinished = true; return value; });
    await flush();
    assert.deepEqual(slowRequests.map(item => item.pathname).sort(), [
      '/data/SoundEffectPlayer/features.json', '/data/SoundEffectPlayer/i18n/en-us.json',
    ], 'Names and metadata download in parallel and only request the selected language');
    await clock.advance(12_000);
    assert.equal(firstFinished, false, 'A first description request remains pending beyond the former 10-second deadline');
    assert.ok(slowRequests.every(item => !item.signal.aborted), 'Neither the metadata nor the name-first dictionary aborts at 12 seconds');
    metadataGate.resolve(Response.json(external));
    dictionaryGate.resolve(Response.json(dictionaryInput['en-us']));
    const slowResult = await slowDescriptions;
    assert.equal((await slowNames)[0].status, 'loaded');
    assert.equal(slowResult.status, 'ready');
    assert.equal(slowResult.get(7, 'en-US')[0].short, 'low knock');
    assert.equal(slowRequests.length, 2, 'Descriptions join the existing name request without a second dictionary download');

    for (const [project, namespace] of [['EffectPlayer', 'effectPlayer'], ['BgmPlayer', 'bgmPlayer']]) {
      const gate = deferred(); let signal;
      const loading = loadOssTranslationDictionary(project, namespace, 'i18n', {
        locale: 'ja-JP', baseUrl: 'https://slow-player-fixture.invalid/data',
        fetcher: (_url, input) => { signal = input.signal; return gate.promise; },
      });
      await clock.advance(12_000);
      assert.equal(signal.aborted, false, `${project} shares the longer default dictionary timeout`);
      gate.resolve(Response.json({ version: 1, namespace, locale: 'ja-JP', translations: { 'data.7': '遅い名前' } }));
      const result = await loading;
      assert.equal(result.result.status, 'loaded');
      assert.equal(result.dictionary[`${namespace}.data.7`], '遅い名前');
    }

    const lateMetadata = deferred(); let metadataAttempts = 0, metadataSignal, metadataFinished = false;
    const deadlineOptions = { baseUrl: 'https://metadata-deadline-fixture.invalid/data', cached: true,
      fetcher: (_url, input) => {
        metadataAttempts++; metadataSignal = input.signal;
        return metadataAttempts === 1 ? lateMetadata.promise : Promise.resolve(Response.json(sound));
      } };
    const stalledMetadata = loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], deadlineOptions)
      .then(value => { metadataFinished = true; return value; });
    await clock.advance(59_999);
    assert.equal(metadataFinished, false);
    await clock.advance(1);
    const metadataTimeout = await stalledMetadata;
    assert.equal(metadataTimeout.errorCode, 'ASSET_FEATURES_TIMEOUT');
    assert.equal(metadataSignal.aborted, true, 'The default metadata deadline aborts at 60 seconds');
    const lateSidecar = createFeatureSidecar('SoundEffectPlayer', { 7: { audio: { short: 'late metadata must not win' } } });
    lateMetadata.resolve(Response.json(lateSidecar));
    await flush();
    const metadataRetry = await loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], deadlineOptions);
    assert.equal(metadataAttempts, 2, 'A late response cannot turn a failed metadata request into a cached success');
    assert.equal(metadataRetry.get(7, 'en-US')[0].short, 'low knock');

    // Exercise the public production store, with all network calls intercepted, so
    // a late non-cooperative response can be checked without starting another load.
    const lateDictionary = deferred(); let dictionarySignal, dictionaryAttempt = 0, dictionaryFinished = false;
    global.fetch = (_url, input) => {
      dictionaryAttempt++; dictionarySignal = input.signal;
      return dictionaryAttempt === 1 ? Promise.resolve(Response.json(dictionaryInput['ru-ru'])) : lateDictionary.promise;
    };
    const publicOptions = { locale: 'ru-RU' };
    await loadOssTranslationDictionary('SoundEffectPlayer', 'soundEffectPlayer', 'i18n', publicOptions);
    const stalledDictionary = loadOssTranslationDictionary('SoundEffectPlayer', 'soundEffectPlayer', 'i18n', { ...publicOptions, refresh: true })
      .then(value => { dictionaryFinished = true; return value; });
    await clock.advance(59_999);
    assert.equal(dictionaryFinished, false);
    await clock.advance(1);
    const dictionaryTimeout = await stalledDictionary;
    assert.equal(dictionaryTimeout.result.status, 'failed', 'A non-cooperative fetch still ends at the 60-second dictionary deadline');
    assert.equal(dictionarySignal.aborted, true);
    assert.equal(dictionaryTimeout.dictionary['soundEffectPlayer.search.7.audio.short'], multilingual['ru-ru'], 'A timed-out refresh preserves its last-good dictionary');
    const changedDictionary = structuredClone(dictionaryInput['ru-ru']);
    changedDictionary.translations['search.7.audio.short'] = 'late dictionary must not win';
    lateDictionary.resolve(Response.json(changedDictionary));
    await flush();
    assert.equal(remoteI18n.getDictionary('soundEffectPlayer', 'ru-RU')['soundEffectPlayer.search.7.audio.short'], multilingual['ru-ru'],
      'A late response cannot overwrite the public translation snapshot after timeout');

    for (const [project, namespace, timeoutMs, deadline] of [
      ['EffectPlayer', 'effectPlayer', 25, 25],
      ['StructViewer', 'structViewer', undefined, 8_000],
    ]) {
      const gate = deferred(); let signal, finished = false;
      const loading = loadOssTranslations(project, namespace, 'i18n', {
        locale: 'en-US', baseUrl: 'https://short-deadline-fixture.invalid/data', timeoutMs,
        fetcher: (_url, input) => { signal = input.signal; return gate.promise; },
      }).then(value => { finished = true; return value; });
      await clock.advance(deadline - 1);
      assert.equal(finished, false);
      await clock.advance(1);
      assert.equal((await loading)[0].status, 'failed');
      assert.equal(signal.aborted, true, timeoutMs ? 'An explicit short timeout overrides the player default' : 'Other projects retain the 8-second default');
      gate.resolve(Response.json({ version: 1, namespace, locale: 'en-US', translations: { 'data.7': 'late' } }));
      await flush();
    }
  } finally { global.fetch = originalFetch; clock.restore(); }

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
  console.log('Asset feature binding, shared current-language dictionaries, metadata revision coherence, central cache and refresh, embedded multilingual data, evidence separation, limits, 60-second deadlines, late-response isolation, explicit timeouts and fallback passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
