// Mocked global fetch exercises the real page composable and scoped Vue watchers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
global.window = {};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { effectScope, nextTick } = require('vue');
const { i18n } = require('../src/i18n/index.ts');
const { useAssetFeatures } = require('../src/utils/useAssetFeatures.ts');
const { useOssTranslations } = require('../src/i18n/useOssTranslations.ts');
const { loadAssetFeatures } = require('../src/utils/assetFeatures.ts');
const { createFeatureSidecar } = require('./ai-search-feature-fixtures.cjs');
const text = { 'zh-cn': '低沉敲击', 'zh-tw': '低沉敲擊', 'en-us': 'low knock', 'ja-jp': '低い打撃音', 'ru-ru': 'низкий стук' };
const { i18n: dictionaries, ...external } = createFeatureSidecar('SoundEffectPlayer', { 7: { audio: { short: text } } });
external.i18nSource = 'project-i18n-v1';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function flushUntil(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(setImmediate);
  }
  assert.ok(predicate(), 'Expected asynchronous watcher state to settle');
}

(async () => {
  const originalFetch = global.fetch, originalLocale = i18n.global.locale.value;
  const requests = [], gates = new Map(), scopes = [];
  global.fetch = async url => {
    const pathname = new URL(url, 'https://fixture.invalid').pathname;
    requests.push(pathname);
    if (pathname.endsWith('/SoundEffectPlayer/features.json')) return Response.json(external);
    const locale = pathname.match(/\/SoundEffectPlayer\/i18n\/(.*)\.json$/)?.[1];
    assert.ok(locale && dictionaries[locale], `Unexpected feature request: ${pathname}`);
    if (gates.has(locale)) await gates.get(locale).promise;
    return Response.json(dictionaries[locale]);
  };
  try {
    i18n.global.locale.value = 'zh-CN';
    const scope = effectScope(); scopes.push(scope);
    const state = scope.run(() => useAssetFeatures('SoundEffectPlayer', () => [{ id: 7 }]));
    const loadTranslations = scope.run(() => useOssTranslations('SoundEffectPlayer', 'soundEffectPlayer'));
    i18n.global.locale.value = 'en-US';
    await nextTick();
    assert.equal(requests.length, 0, 'A page scope does not fetch descriptions before its base catalog enables loading');
    await Promise.all([state.loadFeatures(), loadTranslations()]);
    assert.equal(state.assetFeatures.value.get(7, 'en-US')[0].short, text['en-us']);
    assert.deepEqual(requests.filter(path => path.includes('/i18n/')).map(path => path.split('/').at(-1)), ['en-us.json'],
      'Ordinary names and description consumers share one pending dictionary request');

    i18n.global.locale.value = 'zh-CN';
    await nextTick();
    await flushUntil(() => !state.featuresLoading.value);
    assert.equal(state.assetFeatures.value.get(7, 'zh-CN')[0].short, text['zh-cn']);
    assert.deepEqual(requests.filter(path => path.includes('/i18n/')).map(path => path.split('/').at(-1)), ['en-us.json', 'zh-cn.json'],
      'Changing language only fetches that language');
    assert.equal(requests.filter(path => path.endsWith('/features.json')).length, 1, 'Language changes reuse feature metadata');

    const beforeReturn = requests.length;
    i18n.global.locale.value = 'en-US';
    await nextTick();
    await flushUntil(() => !state.featuresLoading.value);
    assert.equal(state.assetFeatures.value.get(7, 'en-US')[0].short, text['en-us']);
    assert.equal(requests.length, beforeReturn, 'Returning to a loaded locale shares the public cache without new requests');

    const slow = deferred(); gates.set('ja-jp', slow);
    i18n.global.locale.value = 'ja-JP';
    await nextTick();
    await flushUntil(() => requests.some(path => path.endsWith('/ja-jp.json')));
    const slowWork = loadAssetFeatures('SoundEffectPlayer', [{ id: 7 }], { locale: 'ja-JP' });
    i18n.global.locale.value = 'ru-RU';
    await nextTick();
    await flushUntil(() => !state.featuresLoading.value);
    const russian = state.assetFeatures.value;
    assert.equal(russian.get(7, 'ru-RU')[0].short, text['ru-ru']);
    slow.resolve();
    await slowWork;
    await nextTick();
    assert.equal(state.assetFeatures.value, russian, 'A slow previous language response never overwrites the current language');
    assert.equal(state.featuresLoading.value, false, 'An older request does not alter current loading state');

    scope.stop();
    const afterStop = requests.length;
    i18n.global.locale.value = 'zh-TW';
    await nextTick();
    await state.loadFeatures();
    assert.equal(requests.length, afterStop, 'Disposal stops language subscriptions and later explicit loads');
    assert.equal(state.assetFeatures.value, russian);

    const inFlight = deferred(); gates.set('zh-tw', inFlight);
    const pendingScope = effectScope(); scopes.push(pendingScope);
    const pendingState = pendingScope.run(() => useAssetFeatures('SoundEffectPlayer', () => [{ id: 7 }]));
    const work = pendingState.loadFeatures();
    await flushUntil(() => requests.some(path => path.endsWith('/zh-tw.json')));
    pendingScope.stop();
    inFlight.resolve();
    await work;
    assert.equal(pendingState.assetFeatures.value, null, 'A request completed after disposal does not write descriptions');
    assert.equal(pendingState.featuresLoading.value, true, 'A request completed after disposal does not write loading state');
    const afterPendingStop = requests.length;
    i18n.global.locale.value = 'en-US';
    await nextTick();
    assert.equal(requests.length, afterPendingStop, 'A stopped in-flight scope never starts another language request');
    console.log('PASS asset feature scopes: delayed enable, shared name/description singleflight, central locale cache, metadata reuse, latest-language races, and disposal without fetches or writes');
  } finally {
    scopes.forEach(scope => scope.stop());
    gates.forEach(gate => gate.resolve());
    global.fetch = originalFetch;
    i18n.global.locale.value = originalLocale;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
