import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createAssetCatalogLoader, FEATURE_CACHE_MS } from './asset-catalog-loader.mjs';
import { getAssetDetails, searchAssets } from './asset-search.mjs';
import { FEATURE_LOCALES, parseAssetFeatureSidecar, computeAssetFeatureSourceHash } from './asset-features.mjs';
import { identityFixture, featureFixture } from './asset-catalog-fixture.mjs';

const require = createRequire(import.meta.url);
const { compileSidecar } = require('../../scripts/export-ai-asset-features.cjs');
const base = 'https://assets.example/catalog';
const environment = { ASSET_FEATURES_BASE_URL: base, UPSTREAM_API_KEY: 'synthetic-not-forwarded' };
const projects = { sound: 'SoundEffectPlayer', effect: 'EffectPlayer' };
const namespace = kind => kind === 'sound' ? 'soundEffectPlayer' : 'effectPlayer';
const hash = value => createHash('sha256').update(value).digest('hex');
const featurePath = kind => `${projects[kind]}/features.json`;
const dictionaryPath = (kind, locale) => `${projects[kind]}/i18n/${locale}.json`;

async function fixture() {
  const identities = identityFixture(), sources = {};
  for (const kind of ['sound', 'effect']) {
    const embedded = await featureFixture(kind, identities);
    const dictionaries = Object.fromEntries(FEATURE_LOCALES.map(locale => [locale, {
      translations: { [`${namespace(kind)}.data.1`]: `Existing asset name ${locale}`, ...embedded.i18n[locale] },
    }]));
    const sidecar = { ...embedded, i18nSource: 'project-i18n-v1' };
    delete sidecar.i18n;
    sources[kind] = { feature: sidecar, dictionaries };
  }
  return { identities, sources };
}

async function recompile(source, identities) {
  const hydrated = parseAssetFeatureSidecar(source.feature, {
    dictionaries: source.dictionaries, identities, requireCompiled: false,
  });
  await compileSidecar(hydrated, identities);
  source.feature = { ...hydrated };
  delete source.feature.i18n;
}

function sourceFiles(sources) {
  const files = new Map();
  for (const kind of ['sound', 'effect']) {
    files.set(featurePath(kind), JSON.stringify(sources[kind].feature));
    for (const locale of FEATURE_LOCALES) files.set(dictionaryPath(kind, locale), JSON.stringify(sources[kind].dictionaries[locale]));
  }
  return files;
}

class SyntheticRemote {
  constructor(sources) { this.files = sourceFiles(sources); this.requests = []; this.etagSalt = ''; }
  etag(path) { return `"${hash(this.files.get(path))}${this.etagSalt}"`; }
  fetch = async (url, options) => {
    const parsed = new URL(url), path = parsed.pathname.slice('/catalog/'.length);
    const body = this.files.get(path), etag = body == null ? undefined : this.etag(path);
    const conditional = options.headers['if-none-match'];
    const status = body == null ? 404 : conditional === etag ? 304 : 200;
    this.requests.push({ path, url, options, conditional, status });
    if (status === 304) return new Response(null, { status, headers: { etag } });
    return new Response(body ?? 'missing synthetic file', { status,
      headers: { 'content-type': 'application/json; charset=utf-8', ...(etag ? { etag } : {}) } });
  };
}

async function sourceHash(remote, kind) {
  const dictionaries = Object.fromEntries(FEATURE_LOCALES.map(locale => [locale, hash(remote.files.get(dictionaryPath(kind, locale)))]));
  return computeAssetFeatureSourceHash(hash(remote.files.get(featurePath(kind))), dictionaries);
}
const catalogEnv = loaded => ({ ASSET_SEARCH_CATALOG: loaded.catalog });
const detail = (loaded, id, locale) => getAssetDetails([id], locale, catalogEnv(loaded)).assets[0];

test('external cold load reads exactly two feature files and ten project dictionaries with no private headers', async () => {
  const { identities, sources } = await fixture(), remote = new SyntheticRemote(sources);
  const loader = createAssetCatalogLoader({ identities, now: () => 100, fetcher: remote.fetch });
  const [a, b] = await Promise.all([loader.read(environment), loader.read(environment)]);
  assert.equal(a.catalog, b.catalog); assert.equal(remote.requests.length, 12);
  assert.deepEqual(remote.requests.map(request => request.path).sort(), [...remote.files.keys()].sort());
  for (const { url, options } of remote.requests) {
    assert.equal(new URL(url).search, '?_t=100');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual'); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.authorization, undefined); assert.equal(options.headers.cookie, undefined);
    assert.notEqual(options.credentials, 'include');
  }
  assert.equal(a.featureSync.status, 'ready'); assert.equal(a.catalog.assets.length, identities.assets.length);
  assert.equal(a.featureSync.hashes.sound, await sourceHash(remote, 'sound'));
  assert.equal(a.featureSync.hashes.effect, await sourceHash(remote, 'effect'));
  for (const locale of ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ru-RU']) assert.match(detail(a, 'sound:1', locale).description, /thunder/);
  const audio = await searchAssets({ query: 'thunder', scope: 'sound' }, catalogEnv(a));
  assert.ok(audio.candidates.some(asset => asset.resourceId === 'effect:1' && asset.audioMatch));
  assert.equal((await searchAssets({ query: 'thunder', scope: 'effect', matchOn: 'visual' }, catalogEnv(a))).total, 0);
});

test('external TTL, twelve ETags and identical 200 bytes reuse the same complete catalog', async () => {
  const { identities, sources } = await fixture(), remote = new SyntheticRemote(sources); let clock = 0;
  const loader = createAssetCatalogLoader({ identities, now: () => clock, fetcher: remote.fetch });
  const first = await loader.read(environment);
  clock = FEATURE_CACHE_MS - 1;
  assert.equal((await loader.read(environment)).catalog, first.catalog); assert.equal(remote.requests.length, 12);
  clock += 1; const unchanged = await loader.read(environment);
  assert.equal(unchanged.catalog, first.catalog); assert.equal(remote.requests.length, 24);
  assert.ok(remote.requests.slice(12).every(request => request.status === 304 && request.conditional === remote.etag(request.path)));
  remote.etagSalt = '-replacement-etag'; clock += FEATURE_CACHE_MS;
  const sameBytes = await loader.read(environment);
  assert.equal(sameBytes.catalog, first.catalog); assert.deepEqual(sameBytes.featureSync.hashes, first.featureSync.hashes);
  assert.equal(sameBytes.featureSync.updatedAt, first.featureSync.updatedAt);
  assert.ok(remote.requests.slice(24).every(request => request.status === 200));
  clock += FEATURE_CACHE_MS; await loader.read(environment);
  assert.ok(remote.requests.slice(36).every(request => request.status === 304 && request.conditional.endsWith('-replacement-etag"')));
});

test('one changed and reindexed locale updates source hash, catalog version, descriptions and actual lexical results', async () => {
  const { identities, sources } = await fixture(), remote = new SyntheticRemote(sources); let clock = 0;
  const loader = createAssetCatalogLoader({ identities, now: () => clock, fetcher: remote.fetch });
  const old = await loader.read(environment);
  const key = 'soundEffectPlayer.search.1.audio.detail', marker = 'glimmeringcobalt';
  sources.sound.dictionaries['en-us'].translations[key] = `${marker} resonant metallic impact`;
  await recompile(sources.sound, identities); remote.files = sourceFiles(sources); clock = FEATURE_CACHE_MS;
  const fresh = await loader.read(environment);
  assert.notEqual(fresh.catalog, old.catalog); assert.notEqual(fresh.catalog.indexVersion, old.catalog.indexVersion);
  assert.equal(fresh.featureSync.hashes.sound, await sourceHash(remote, 'sound'));
  assert.notEqual(fresh.featureSync.hashes.sound, old.featureSync.hashes.sound);
  assert.equal(fresh.featureSync.hashes.effect, old.featureSync.hashes.effect);
  assert.match(detail(fresh, 'sound:1', 'en-US').description, new RegExp(marker));
  assert.doesNotMatch(detail(old, 'sound:1', 'en-US').description, new RegExp(marker));
  assert.doesNotMatch(detail(fresh, 'sound:1', 'zh-CN').description, new RegExp(marker));
  const search = await searchAssets({ query: marker, scope: 'sound', locale: 'en-US' }, catalogEnv(fresh));
  assert.deepEqual(search.candidates.map(asset => asset.resourceId), ['sound:1']);
  assert.equal((await searchAssets({ query: marker, scope: 'sound' }, catalogEnv(old))).total, 0);
});

test('editing a dictionary without recompiling marks the complete previous generation stale', async () => {
  const { identities, sources } = await fixture(), remote = new SyntheticRemote(sources); let clock = 0;
  const loader = createAssetCatalogLoader({ identities, now: () => clock, fetcher: remote.fetch });
  const good = await loader.read(environment);
  sources.sound.dictionaries['ja-jp'].translations['soundEffectPlayer.search.1.audio.detail'] = 'unindexedchlorite';
  remote.files = sourceFiles(sources); clock = FEATURE_CACHE_MS;
  const stale = await loader.read(environment);
  assert.equal(stale.catalog, good.catalog); assert.equal(stale.featureSync.status, 'stale');
  assert.equal(stale.featureSync.errorCode, 'ASSET_FEATURES_INVALID'); assert.deepEqual(stale.featureSync.hashes, good.featureSync.hashes);
  assert.doesNotMatch(detail(stale, 'sound:1', 'ja-JP').description, /unindexedchlorite/);
  assert.equal((await searchAssets({ query: 'unindexedchlorite', scope: 'sound' }, catalogEnv(stale))).total, 0);
});

test('a missing project dictionary fails cold load and cannot publish a partially refreshed other project', async () => {
  const { identities, sources } = await fixture(), coldRemote = new SyntheticRemote(sources);
  coldRemote.files.delete(dictionaryPath('effect', 'ru-ru'));
  const cold = createAssetCatalogLoader({ identities, fetcher: coldRemote.fetch });
  await assert.rejects(cold.read(environment), { code: 'ASSET_FEATURES_UNAVAILABLE', status: 503 });
  const remote = new SyntheticRemote(sources); let clock = 0;
  const loader = createAssetCatalogLoader({ identities, now: () => clock, fetcher: remote.fetch });
  const good = await loader.read(environment);
  sources.sound.dictionaries['zh-cn'].translations['soundEffectPlayer.search.1.audio.detail'] = 'uncommittedagate';
  await recompile(sources.sound, identities); remote.files = sourceFiles(sources);
  remote.files.delete(dictionaryPath('effect', 'ru-ru')); clock = FEATURE_CACHE_MS;
  const stale = await loader.read(environment);
  assert.equal(stale.catalog, good.catalog); assert.equal(stale.featureSync.status, 'stale');
  assert.deepEqual(stale.featureSync.hashes, good.featureSync.hashes);
  assert.doesNotMatch(detail(stale, 'sound:1', 'zh-CN').description, /uncommittedagate/);
});

test('malformed dictionaries, dangling and foreign references reject before a cold generation becomes visible', async () => {
  for (const mutation of ['malformed-json', 'missing-reference', 'foreign-reference', 'duplicate-normalized-key']) {
    const { identities, sources } = await fixture(), key = 'soundEffectPlayer.search.1.audio.short';
    if (mutation === 'missing-reference') delete sources.sound.dictionaries['en-us'].translations[key];
    if (mutation === 'foreign-reference') sources.sound.feature.resources['1'].searchMetadata.audio.shortDescriptionI18nKey = 'soundEffectPlayer.search.2.audio.short';
    if (mutation === 'duplicate-normalized-key') sources.sound.dictionaries['en-us'].translations['search.1.audio.short'] = 'duplicate';
    const remote = new SyntheticRemote(sources);
    if (mutation === 'malformed-json') remote.files.set(dictionaryPath('sound', 'en-us'), '{malformed');
    const loader = createAssetCatalogLoader({ identities, fetcher: remote.fetch });
    await assert.rejects(loader.read(environment), { code: 'ASSET_FEATURES_INVALID', status: 503 }, mutation);
  }
});

test('new feature file and all five locale dictionaries commit atomically and failed refresh retains previous ETags', async () => {
  const { identities, sources } = await fixture(), remote = new SyntheticRemote(sources); let clock = 0;
  const loader = createAssetCatalogLoader({ identities, now: () => clock, fetcher: remote.fetch });
  const good = await loader.read(environment), oldFeatureEtag = remote.etag(featurePath('sound'));
  const oldRussian = remote.files.get(dictionaryPath('sound', 'ru-ru'));
  for (const locale of FEATURE_LOCALES) {
    sources.sound.dictionaries[locale].translations['soundEffectPlayer.search.1.audio.detail'] = `atomiccelestite ${locale}`;
  }
  await recompile(sources.sound, identities); const completeFiles = sourceFiles(sources);
  remote.files = new Map(completeFiles); remote.files.set(dictionaryPath('sound', 'ru-ru'), oldRussian); clock = FEATURE_CACHE_MS;
  const partial = await loader.read(environment);
  assert.equal(partial.catalog, good.catalog); assert.equal(partial.featureSync.status, 'stale');
  assert.deepEqual(partial.featureSync.hashes, good.featureSync.hashes);
  for (const locale of ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ru-RU']) assert.doesNotMatch(detail(partial, 'sound:1', locale).description, /atomiccelestite/);
  remote.files = completeFiles; const start = remote.requests.length; clock += FEATURE_CACHE_MS;
  const committed = await loader.read(environment);
  assert.equal(remote.requests[start].conditional, oldFeatureEtag, 'Uncommitted ETags cannot suppress a required file read');
  assert.equal(committed.featureSync.status, 'ready'); assert.notEqual(committed.catalog, good.catalog);
  for (const locale of ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ru-RU']) assert.match(detail(committed, 'sound:1', locale).description, /atomiccelestite/);
  assert.deepEqual((await searchAssets({ query: 'atomiccelestite', scope: 'sound' }, catalogEnv(committed))).candidates.map(asset => asset.resourceId), ['sound:1']);
});

test('a non-search translated name change also versions the raw source without changing feature evidence', async () => {
  const { identities, sources } = await fixture(), remote = new SyntheticRemote(sources); let clock = 0;
  const loader = createAssetCatalogLoader({ identities, now: () => clock, fetcher: remote.fetch });
  const old = await loader.read(environment);
  sources.effect.dictionaries['zh-tw'].translations['effectPlayer.data.1'] = '改名但特徵不變';
  remote.files = sourceFiles(sources); clock = FEATURE_CACHE_MS;
  const renamed = await loader.read(environment);
  assert.equal(renamed.featureSync.status, 'ready'); assert.notEqual(renamed.catalog.indexVersion, old.catalog.indexVersion);
  assert.equal(renamed.featureSync.hashes.sound, old.featureSync.hashes.sound);
  assert.notEqual(renamed.featureSync.hashes.effect, old.featureSync.hashes.effect);
  assert.equal(renamed.featureSync.hashes.effect, await sourceHash(remote, 'effect'));
  assert.equal(detail(renamed, 'effect:1', 'zh-TW').description, detail(old, 'effect:1', 'zh-TW').description);
});
