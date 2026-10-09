import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssetCatalogLoader, FEATURE_CACHE_MS } from './asset-catalog-loader.mjs';
import { getCatalogInfo, getAssetDetails, searchAssets, clearAssetSearchCache } from './asset-search.mjs';
import { identityFixture, featureFixture, featureResponse } from './asset-catalog-fixture.mjs';
const base = 'https://assets.example/catalog';
const environment = { ASSET_FEATURES_BASE_URL: base };
async function fixtures() {
  const identities = identityFixture();
  const sound = await featureFixture('sound', identities);
  const effect = await featureFixture('effect', identities);
  const bgm = await featureFixture('bgm', identities, '舒缓钢琴 peaceful piano', '小关胜利 level victory');
  return { identities, sound, effect, bgm };
}
test('feature loader pins fixed public paths, includes all identity records and reuses precompiled shards', async () => {
  const { identities, sound, effect, bgm } = await fixtures(); const requests = [];
  const loader = createAssetCatalogLoader({ identities, now: () => 100, fetcher: async (url, options) => {
    requests.push({ url, options }); return featureResponse(url.includes('SoundEffectPlayer') ? sound : url.includes('BgmPlayer') ? bgm : effect);
  } });
  const loaded = await loader.read({ ...environment, UPSTREAM_API_KEY: 'synthetic-secret' });
  assert.equal(loaded.featureSync.status, 'ready'); assert.equal(loaded.catalog.assets.length, 6);
  assert.equal(loaded.catalog.lexical.format, 'sharded-uint32-base64-v1');
  assert.deepEqual(requests.map(item => item.url), [base + '/SoundEffectPlayer/features.json?_t=100', base + '/EffectPlayer/features.json?_t=100', base + '/BgmPlayer/features.json?_t=100']);
  for (const { options } of requests) {
    assert.equal(options.redirect, 'manual'); assert.equal(options.cache, 'no-store'); assert.equal(options.method, 'GET');
    assert.equal(options.headers.authorization, undefined); assert.equal(options.headers.cookie, undefined);
  }
  const env = { ASSET_SEARCH_CATALOG: loaded.catalog };
  assert.equal(getCatalogInfo(env).coverage.descriptions.effect, 2);
  const soundResult = await searchAssets({ query: 'thunder', scope: 'sound' }, env);
  assert.ok(soundResult.candidates.some(asset => asset.kind === 'sound'));
  assert.ok(soundResult.candidates.some(asset => asset.kind === 'effect' && asset.audioMatch));
  assert.equal((await searchAssets({ query: 'thunder', scope: 'effect', matchOn: 'visual' }, env)).total, 0);
  assert.equal((await searchAssets({ query: 'blue', scope: 'effect', matchOn: 'visual' }, env)).total, 2);
  assert.equal((await searchAssets({ query: 'storm', scope: 'effect', searchType: 'feature' }, env)).total, 0);
  assert.equal((await searchAssets({ query: 'storm', scope: 'effect', searchType: 'suggestion' }, env)).total, 2);
  assert.equal((await searchAssets({ query: 'thunder', scope: 'sound', filters: { includeTerms: ['detailed'] } }, env)).total, 3);
  assert.equal(getAssetDetails(['effect:1'], 'en-US', env).assets[0].audioDescriptionLocale, 'en-US');
  assert.ok(loaded.catalog.assets.every(asset => !asset.facetTexts));
});
test('one shared refresh serves concurrent callers and a fresh TTL never refetches', async () => {
  const { identities, sound, effect, bgm } = await fixtures(); let clock = 0, count = 0;
  const loader = createAssetCatalogLoader({ identities, now: () => clock, fetcher: async url => {
    count++; await new Promise(resolve => setTimeout(resolve, 10)); return featureResponse(url.includes('SoundEffectPlayer') ? sound : url.includes('BgmPlayer') ? bgm : effect);
  } });
  const [a,b,c] = await Promise.all([loader.read(environment), loader.read(environment), loader.read(environment)]);
  assert.equal(count, 3); assert.equal(a.catalog, b.catalog); assert.equal(b.catalog, c.catalog);
  clock = FEATURE_CACHE_MS - 1; assert.equal((await loader.read(environment)).catalog, a.catalog); assert.equal(count, 3);
});
test('304 uses ETags, while identical 200 bytes preserve catalog identity even with a different ETag', async () => {
  const { identities, sound, effect, bgm } = await fixtures(); let clock = 0, mode = 'initial'; const conditional = [];
  const loader = createAssetCatalogLoader({ identities, now: () => clock, fetcher: async (url, options) => {
    conditional.push(options.headers['if-none-match']);
    if (mode === 'not-modified') return new Response(null, { status: 304 });
    return featureResponse(url.includes('SoundEffectPlayer') ? sound : url.includes('BgmPlayer') ? bgm : effect, mode === 'same-content' ? '"different-etag"' : '"first"');
  } });
  const a = await loader.read(environment); mode = 'not-modified'; clock = FEATURE_CACHE_MS;
  const b = await loader.read(environment); assert.equal(a.catalog, b.catalog); assert.deepEqual(conditional.slice(3), ['"first"','"first"','"first"']);
  mode = 'same-content'; clock += FEATURE_CACHE_MS;
  const c = await loader.read(environment); assert.equal(a.catalog, c.catalog); assert.deepEqual(c.featureSync.hashes, a.featureSync.hashes);
  assert.equal(c.featureSync.updatedAt, a.featureSync.updatedAt); assert.equal(c.featureSync.lastGoodAt, clock);
});
test('validated changed bytes atomically replace catalog, expose new hashes and invalidate only version-bound cursors', async () => {
  const { identities, sound, effect, bgm } = await fixtures(); const updated = await featureFixture('sound', identities, '新的低沉轰鸣 rumble');
  let clock = 0, next = false;
  const loader = createAssetCatalogLoader({ identities, now: () => clock, fetcher: async url => featureResponse(url.includes('SoundEffectPlayer') ? next ? updated : sound : url.includes('BgmPlayer') ? bgm : effect) });
  const old = await loader.read(environment), query = { query: 'identity', scope: 'sound', limit: 1 };
  const page = await searchAssets(query, { ASSET_SEARCH_CATALOG: old.catalog }); assert.ok(page.nextCursor);
  next = true; clock = FEATURE_CACHE_MS; const fresh = await loader.read(environment);
  assert.notEqual(fresh.catalog, old.catalog); assert.notEqual(fresh.catalog.indexVersion, old.catalog.indexVersion);
  assert.notEqual(fresh.featureSync.hashes.sound, old.featureSync.hashes.sound); assert.equal(fresh.featureSync.hashes.effect, old.featureSync.hashes.effect);
  await assert.rejects(searchAssets({ ...query, cursor: page.nextCursor }, { ASSET_SEARCH_CATALOG: fresh.catalog }), { code: 'CATALOG_VERSION_MISMATCH', status: 409 });
  await assert.rejects(searchAssets({ ...query, query: 'other', cursor: page.nextCursor }, { ASSET_SEARCH_CATALOG: old.catalog }), { code: 'INVALID_CURSOR', status: 400 });
  assert.match(getAssetDetails(['sound:1'], 'zh-CN', { ASSET_SEARCH_CATALOG: fresh.catalog }).assets[0].description, /新的低沉轰鸣/);
  assert.match(getAssetDetails(['sound:1'], 'zh-CN', { ASSET_SEARCH_CATALOG: old.catalog }).assets[0].description, /雷声/);
});
test('a failed second source keeps both last-good shards and records stale status without accepting a partial update', async () => {
  const { identities, sound, effect, bgm } = await fixtures(); const updated = await featureFixture('sound', identities, 'changed');
  let clock = 0, fail = false;
  const loader = createAssetCatalogLoader({ identities, now: () => clock, fetcher: async url => {
    if (fail && new URL(url).pathname.endsWith('/EffectPlayer/features.json')) return new Response('gateway failed', { status: 502 });
    return featureResponse(url.includes('SoundEffectPlayer') ? fail ? updated : sound : url.includes('BgmPlayer') ? bgm : effect);
  } });
  const initial = await loader.read(environment); fail = true; clock = FEATURE_CACHE_MS;
  const stale = await loader.read(environment); assert.equal(stale.catalog, initial.catalog);
  assert.equal(stale.featureSync.status, 'stale'); assert.equal(stale.featureSync.lastGoodAt, 0);
  assert.deepEqual(stale.featureSync.hashes, initial.featureSync.hashes); assert.equal(stale.featureSync.checkedAt, clock);
  assert.equal(stale.featureSync.errorCode, 'ASSET_FEATURES_UNAVAILABLE');
});
test('first load fails safely for wrong binding, edited source, edited compiled index, dangling refs and redirect', async () => {
  const { identities, sound, effect, bgm } = await fixtures();
  for (const mutate of [
    value => { value.baseIndexVersion = 'other'; },
    value => { const key = Object.keys(value.i18n['zh-cn'])[0]; value.i18n['zh-cn'][key] = 'edited without reindex'; },
    value => { value.lexical.averageLength += 1; },
    value => { value.resources['1'].searchMetadata.audio.shortDescriptionI18nKey += 'missing'; },
  ]) {
    const invalid = structuredClone(sound); mutate(invalid);
    const loader = createAssetCatalogLoader({ identities, fetcher: async url => featureResponse(url.includes('SoundEffectPlayer') ? invalid : url.includes('BgmPlayer') ? bgm : effect) });
    await assert.rejects(loader.read(environment), { code: 'ASSET_FEATURES_INVALID', status: 503 });
  }
  const redirect = createAssetCatalogLoader({ identities, fetcher: async () => new Response(null, { status: 302, headers: { location: 'https://untrusted.example/' } }) });
  await assert.rejects(redirect.read(environment), { code: 'ASSET_FEATURES_UNAVAILABLE' });
});
test('first load bounds bytes, strict UTF8, source URL and non-cooperating fetch timeout', async () => {
  const { identities, sound } = await fixtures();
  const huge = createAssetCatalogLoader({ identities, maxBytes: 10, fetcher: async () => featureResponse(sound) });
  await assert.rejects(huge.read(environment), { code: 'ASSET_FEATURES_TOO_LARGE' });
  const utf8 = createAssetCatalogLoader({ identities, fetcher: async () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(utf8.read(environment), { code: 'ASSET_FEATURES_INVALID' });
  const timeout = createAssetCatalogLoader({ identities, timeoutMs: 20, fetcher: async () => new Promise(() => {}) });
  await assert.rejects(timeout.read(environment), { code: 'ASSET_FEATURES_TIMEOUT' });
  let called = false; const secure = createAssetCatalogLoader({ identities, fetcher: async () => { called = true; } });
  for (const url of ['http://assets.example/', 'https://name:password@assets.example/', 'https://assets.example/?query=1', 'https://assets.example/#hash']) {
    await assert.rejects(secure.read({ ASSET_FEATURES_BASE_URL: url }), { code: 'ASSET_FEATURES_SOURCE_INVALID' });
  }
  assert.equal(called, false);
});
test('missing remote configuration and explicit synthetic catalog injection never access any network', async () => {
  const identities = identityFixture(); const loader = createAssetCatalogLoader({ identities, fetcher: async () => { throw Error('network should not run'); } });
  const local = await loader.read(); assert.equal(local.catalog, identities); assert.equal(local.featureSync.status, 'disabled');
  const injected = { ...identities, indexVersion: 'injected' };
  const selected = await loader.read({ ...environment, ASSET_SEARCH_CATALOG: injected });
  assert.equal(selected.catalog, injected); assert.equal(selected.featureSync.status, 'disabled');
});
test('an active turn defers refresh, overdue new turns wait for drain, and cancellation never releases another turn pin', async () => {
  const { identities, sound, effect, bgm } = await fixtures(), updated = await featureFixture('sound', identities, 'updated thunder');
  let clock = 0, change = false, calls = 0;
  const loader = createAssetCatalogLoader({ identities, now:()=>clock, fetcher:async url=>{ calls++; return featureResponse(url.includes('SoundEffectPlayer') ? change ? updated : sound : url.includes('BgmPlayer') ? bgm : effect); } });
  const oldPin = await loader.acquire(environment); clock = FEATURE_CACHE_MS; change = true;
  assert.equal((await loader.read(environment)).catalog, oldPin.catalog); assert.equal(calls,3);
  let settled = false; const pending = loader.acquire(environment).then(value=>{settled=true;return value;});
  await Promise.resolve(); assert.equal(settled,false); assert.equal(calls,3);
  const controller = new AbortController(), cancelled = loader.acquire(environment,{signal:controller.signal}); controller.abort();
  await assert.rejects(cancelled,{name:'AbortError'}); assert.equal((await loader.read(environment)).catalog,oldPin.catalog);
  oldPin.release(); oldPin.release(); const newPin = await pending;
  assert.notEqual(newPin.catalog, oldPin.catalog); assert.equal(calls,6); newPin.release();
});
test('pin drain evicts only derived queries and a rejected refresh rebuilds identical old results and cursors', async () => {
  const { identities, sound, effect, bgm } = await fixtures(), updated = await featureFixture('sound', identities, 'uncommitted new sound');
  const corrupt = structuredClone(effect); corrupt.lexical.integrityHash = '0'.repeat(64);
  let clock = 0, rejectRefresh = false, calls = 0, pin;
  const loader = createAssetCatalogLoader({ identities, now: () => clock, fetcher: async url => {
    calls++;
    if (rejectRefresh && calls === 4) assert.equal(clearAssetSearchCache(pin.catalog), false, 'Refresh cleared the old query state before reading');
    return featureResponse(url.includes('SoundEffectPlayer') ? rejectRefresh ? updated : sound : url.includes('BgmPlayer') ? bgm : rejectRefresh ? corrupt : effect);
  } });
  pin = await loader.acquire(environment);
  const env = { ASSET_SEARCH_CATALOG: pin.catalog }, query = { query: 'identity', scope: 'sound', limit: 1 };
  const first = await searchAssets(query, env); assert.ok(first.nextCursor);
  const second = await searchAssets({ ...query, cursor: first.nextCursor }, env);
  const details = getAssetDetails(['sound:1', 'effect:1'], 'en-US', env), assets = pin.catalog.assets, lexical = pin.catalog.lexical;
  clock = FEATURE_CACHE_MS; rejectRefresh = true;
  assert.equal((await loader.read(environment)).catalog, pin.catalog); assert.equal(calls, 3);
  assert.equal(clearAssetSearchCache(pin.catalog), true, 'Pinned reads retain the existing query state');
  assert.deepEqual(await searchAssets(query, env), first); // Rebuild state removed by the test probe.
  pin.release();
  const stale = await loader.read(environment);
  assert.equal(stale.catalog, pin.catalog); assert.equal(stale.catalog.assets, assets); assert.equal(stale.catalog.lexical, lexical);
  assert.equal(stale.featureSync.status, 'stale'); assert.equal(stale.featureSync.errorCode, 'ASSET_FEATURES_INVALID');
  assert.equal(stale.featureSync.lastGoodAt, 0); assert.deepEqual(stale.featureSync.hashes, pin.featureSync.hashes);
  assert.equal(clearAssetSearchCache(stale.catalog), false, 'A failed refresh does not keep the old derived query state');
  assert.deepEqual(await searchAssets(query, env), first);
  assert.deepEqual(await searchAssets({ ...query, cursor: first.nextCursor }, env), second);
  assert.deepEqual(getAssetDetails(['sound:1', 'effect:1'], 'en-US', env), details);
});


test('BGM feature and suggestion evidence is searchable in bgm and all scopes without duplicate identity documents', async () => {
  const { identities, sound, effect, bgm } = await fixtures();
  const byProject = { SoundEffectPlayer: sound, EffectPlayer: effect, BgmPlayer: bgm };
  const loader = createAssetCatalogLoader({ identities, fetcher: async url => featureResponse(byProject[new URL(url).pathname.split('/').at(-2)]) });
  const loaded = await loader.read(environment), env = { ASSET_SEARCH_CATALOG: loaded.catalog };
  assert.equal(loaded.catalog.coverage.descriptions.bgm, 2);
  assert.deepEqual(Object.keys(loaded.featureSync.hashes).sort(), ['bgm', 'effect', 'sound']);
  assert.deepEqual(loaded.catalog.lexical.shards[0].excludeKinds, ['sound', 'effect', 'bgm']);
  assert.equal(new Set(loaded.catalog.assets.map(asset => asset.resourceId)).size, 6);
  for (const locale of ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ru-RU']) {
    assert.match(getAssetDetails(['bgm:1'], locale, env).assets[0].description, /peaceful piano/);
  }
  for (const scope of ['bgm', 'all']) {
    const features = await searchAssets({ query: 'peaceful', scope, searchType: 'feature' }, env);
    assert.deepEqual(features.candidates.map(asset => asset.resourceId).sort(), ['bgm:1', 'bgm:2']);
    const suggestions = await searchAssets({ query: 'victory', scope, searchType: 'suggestion' }, env);
    assert.deepEqual(suggestions.candidates.map(asset => asset.resourceId).sort(), ['bgm:1', 'bgm:2']);
  }
  assert.equal((await searchAssets({ query: 'victory', scope: 'bgm', searchType: 'feature' }, env)).total, 0);
  assert.equal((await searchAssets({ query: 'peaceful', scope: 'sound' }, env)).total, 0);
  assert.equal((await searchAssets({ query: 'peaceful', scope: 'effect' }, env)).total, 0);
});

test('a BGM-only change versions the catalog and leaves sound/effect hashes stable', async () => {
  const { identities, sound, effect, bgm } = await fixtures();
  const updated = await featureFixture('bgm', identities, 'newlyserene harp', 'victory finale');
  let clock = 0, change = false;
  const loader = createAssetCatalogLoader({ identities, now: () => clock, fetcher: async url => featureResponse(
    url.includes('BgmPlayer') ? change ? updated : bgm : url.includes('SoundEffectPlayer') ? sound : effect) });
  const old = await loader.read(environment), query = { query: 'identity', scope: 'bgm', limit: 1 };
  const page = await searchAssets(query, { ASSET_SEARCH_CATALOG: old.catalog }); assert.ok(page.nextCursor);
  change = true; clock = FEATURE_CACHE_MS;
  const fresh = await loader.read(environment);
  assert.notEqual(fresh.catalog.indexVersion, old.catalog.indexVersion);
  assert.notEqual(fresh.featureSync.hashes.bgm, old.featureSync.hashes.bgm);
  assert.equal(fresh.featureSync.hashes.sound, old.featureSync.hashes.sound);
  assert.equal(fresh.featureSync.hashes.effect, old.featureSync.hashes.effect);
  assert.deepEqual((await searchAssets({ query: 'newlyserene', scope: 'bgm' }, { ASSET_SEARCH_CATALOG: fresh.catalog })).candidates.map(a => a.resourceId).sort(), ['bgm:1', 'bgm:2']);
  assert.equal((await searchAssets({ query: 'newlyserene', scope: 'bgm' }, { ASSET_SEARCH_CATALOG: old.catalog })).total, 0);
  await assert.rejects(searchAssets({ ...query, cursor: page.nextCursor }, { ASSET_SEARCH_CATALOG: fresh.catalog }), { code: 'CATALOG_VERSION_MISMATCH' });
});

test('missing or invalid BGM fails cold loading and a third-source failure rejects earlier candidate updates', async () => {
  const { identities, sound, effect, bgm } = await fixtures(), updated = await featureFixture('sound', identities, 'notyetcommitted');
  const invalid = structuredClone(bgm); invalid.baseIndexVersion = 'wrong-generation';
  for (const failedBgm of [null, invalid]) {
    const cold = createAssetCatalogLoader({ identities, fetcher: async url => url.includes('BgmPlayer')
      ? failedBgm ? featureResponse(failedBgm) : new Response('missing', { status: 404 })
      : featureResponse(url.includes('SoundEffectPlayer') ? sound : effect) });
    await assert.rejects(cold.read(environment), { status: 503 });
  }
  let clock = 0, fail = false;
  const loader = createAssetCatalogLoader({ identities, now: () => clock, fetcher: async url => {
    if (url.includes('BgmPlayer')) return fail ? featureResponse(invalid) : featureResponse(bgm);
    return featureResponse(url.includes('SoundEffectPlayer') ? fail ? updated : sound : effect);
  } });
  const old = await loader.read(environment); fail = true; clock = FEATURE_CACHE_MS;
  const stale = await loader.read(environment);
  assert.equal(stale.catalog, old.catalog); assert.equal(stale.featureSync.status, 'stale');
  assert.equal(stale.featureSync.errorCode, 'ASSET_FEATURES_INVALID');
  assert.deepEqual(stale.featureSync.hashes, old.featureSync.hashes);
  assert.equal((await searchAssets({ query: 'notyetcommitted', scope: 'sound' }, { ASSET_SEARCH_CATALOG: stale.catalog })).total, 0);
});
