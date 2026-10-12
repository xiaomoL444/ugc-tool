import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssetCatalogSnapshotStore, ASSET_CATALOG_SNAPSHOT_CHUNK_BYTES } from './asset-catalog-snapshot.mjs';
import { searchAssets } from './asset-search.mjs';

const base = 'https://assets.example/catalog';
const identity = 'identity-version-one';
const json = JSON.stringify.bind(JSON);
const bytes = value => Buffer.byteLength(json(value));

class MemoryStorage {
  constructor() { this.values = new Map(); this.puts = []; this.failPut = null; this.beforeGet = null; this.beforeDelete = null; }
  async get(key, options) {
    if (this.beforeGet) await this.beforeGet(key);
    return structuredClone(this.values.get(key));
  }
  async put(key, value, options) {
    if (this.failPut?.(key, value)) throw new Error('storage write failed');
    assert.ok(bytes(value) <= ASSET_CATALOG_SNAPSHOT_CHUNK_BYTES, 'every persisted structured value fits a chunk');
    assert.equal(options?.noCache, true, 'large snapshot values do not accumulate in the storage cache');
    this.puts.push({ key, bytes: bytes(value) }); this.values.set(key, structuredClone(value));
  }
  async delete(keys) {
    if (this.beforeDelete) await this.beforeDelete(keys);
    assert.ok(Array.isArray(keys) && keys.length <= 8);
    for (const key of keys) this.values.delete(key);
  }
  async list({ prefix = '', limit = 1000 } = {}) {
    return new Map([...this.values].filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([key, value]) => [key, structuredClone(value)]));
  }
}

function fixture({ large = false, version = 'one' } = {}) {
  const sources = ['sound', 'effect', 'bgm'].map(kind => {
    const assets = Array.from({ length: large ? 16 : 2 }, (_, index) => ({ resourceId: `${kind}:${index + 1}`, id: String(index + 1), kind,
      description: { 'zh-CN': large ? '雷声✨\n'.repeat(8000) : `${kind}-${version}-${index}` },
      featureFacetsLazy: true, identityFeatureText: `${kind} authoritative name` }));
    const postings = {};
    for (let index = 0; index < (large ? 60 : 2); index += 1) postings[`term-${index}`] = large ? 'AQAAAA=='.repeat(3000) : 'AQAAAA==';
    for (const key of ['__proto__', 'constructor']) Object.defineProperty(postings, key, { value: 'AQAAAA==', enumerable: true });
    return { hash: `source-${kind}-${version}`, etag: `"${version}"`, external: true,
      files: { feature: { hash: 'feature', etag: '"features"' }, i18n: { 'zh-cn': { hash: 'locale', etag: '"locale"' } } },
      assets, lexical: { format: 'uint32-base64-v1', docs: assets.map(asset => [asset.resourceId, 'feature', 3]),
        postings, averageLength: 3, hashAlgorithm: 'sha256', baseIndexVersion: identity,
        featureHash: 'compiled-feature', integrityHash: 'compiled-integrity', customHeader: { retained: true } } };
  });
  return { sources, sync: { status: 'ready', checkedAt: 123, hashes: { sound: 'a', effect: 'b', bgm: 'c' } }, markerVersion: `marker-${version}` };
}
const storeFor = storage => createAssetCatalogSnapshotStore(storage, { baseIndexVersion: identity });
const manifestFor = storage => [...storage.values].find(([key]) => key.endsWith(':manifest'))?.[1];

test('snapshots larger than 2 MiB round-trip through bounded chunks and preserve every lexical header', async () => {
  const storage = new MemoryStorage(), store = storeFor(storage), payload = fixture({ large: true });
  assert.ok(bytes(payload) > 2 * 1024 * 1024);
  await store.write(base, payload);
  assert.deepEqual(await store.read(base), payload);
  assert.ok(storage.puts.filter(item => item.key.includes(':assets:')).length > 3);
  assert.ok(storage.puts.filter(item => item.key.includes(':postings:')).length > 3);
  assert.ok(Math.max(...storage.puts.map(item => item.bytes)) <= ASSET_CATALOG_SNAPSHOT_CHUNK_BYTES);
  assert.equal(Object.getPrototypeOf((await store.read(base)).sources[0].lexical.postings), Object.prototype);
});

test('failed chunk or manifest writes keep the previous complete generation and the queue remains usable', async () => {
  for (const failedKey of [':docs:', ':manifest']) {
    const storage = new MemoryStorage(), store = storeFor(storage), old = fixture(), updated = fixture({ version: 'two' });
    await store.write(base, old); const previous = structuredClone(manifestFor(storage));
    storage.failPut = key => key.includes(failedKey);
    await assert.rejects(store.write(base, updated), /storage write failed/);
    assert.deepEqual(manifestFor(storage), previous);
    assert.deepEqual(await store.read(base), old);
    storage.failPut = null; await store.write(base, updated);
    assert.deepEqual(await store.read(base), updated);
    assert.ok(![...storage.values.keys()].some(key => key.includes(previous.generation)), 'retired chunks are removed after publication');
  }
});

test('snapshots are bound to both the source base and the base identity version', async () => {
  const storage = new MemoryStorage(), store = storeFor(storage), payload = fixture();
  assert.equal(await store.read(base), null);
  await store.write(base, payload);
  assert.equal(await store.read(base + '/changed'), null);
  const differentIdentity = createAssetCatalogSnapshotStore(storage, { baseIndexVersion: 'different-identity' });
  assert.equal(await differentIdentity.read(base), null);
  await differentIdentity.write(base + '/changed', payload);
  assert.equal(await store.read(base), null);
  assert.deepEqual(await differentIdentity.read(base + '/changed'), payload);
});

test('saving never serializes or clones a complete catalog', async () => {
  const storage = new MemoryStorage(), store = storeFor(storage), payload = fixture({ large: true });
  const originalStringify = JSON.stringify, originalClone = globalThis.structuredClone;
  JSON.stringify = () => { throw new Error('snapshot store must not allocate a serialized catalog'); };
  globalThis.structuredClone = value => {
    assert.ok(!Array.isArray(value) && !value?.sources?.some(source => Array.isArray(source.assets)), 'snapshot store cannot clone an entire catalog or source array');
    if (value !== undefined) assert.ok(bytes(value) <= ASSET_CATALOG_SNAPSHOT_CHUNK_BYTES);
    return originalClone(value);
  };
  try { await store.write(base, payload); }
  finally { JSON.stringify = originalStringify; globalThis.structuredClone = originalClone; }
  assert.deepEqual(await store.read(base), payload);
});

test('an oversized individual record is safely rejected while the previous snapshot remains readable', async () => {
  const storage = new MemoryStorage(), store = storeFor(storage), payload = fixture();
  await store.write(base, payload);
  const excessive = fixture({ version: 'too-large' });
  excessive.sources[0].assets[0].description['zh-CN'] = '界'.repeat(ASSET_CATALOG_SNAPSHOT_CHUNK_BYTES);
  await assert.rejects(store.write(base, excessive), error => error.code === 'ASSET_CATALOG_SNAPSHOT_TOO_LARGE');
  assert.deepEqual(await store.read(base), payload);
});

test('a reader finishes its generation before a queued write can retire any of its chunks', async () => {
  const storage = new MemoryStorage(), store = storeFor(storage), old = fixture(), updated = fixture({ version: 'two' });
  await store.write(base, old);
  let release, entered;
  const blocked = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  storage.beforeGet = async key => { if (key.includes(':assets:')) { storage.beforeGet = null; entered(); await blocked; } };
  const reading = store.read(base); await started;
  const putCount = storage.puts.length; const writing = store.write(base, updated);
  await Promise.resolve(); assert.equal(storage.puts.length, putCount);
  release(); assert.deepEqual(await reading, old); await writing;
  assert.deepEqual(await store.read(base), updated);
});

test('missing persisted chunks do not produce a partial catalog', async () => {
  const storage = new MemoryStorage(), store = storeFor(storage);
  await store.write(base, fixture());
  const key = [...storage.values.keys()].find(key => key.includes(':postings:'));
  storage.values.delete(key);
  assert.equal(await store.read(base), null);
});

test('repeated packed postings spanning multiple chunks restore as searchable evidence', async () => {
  const storage = new MemoryStorage(), store = storeFor(storage), payload = fixture();
  const source = payload.sources[0];
  source.assets = Array.from({ length: 9000 }, (_, index) => ({ resourceId: `sound:${index + 1}`, id: String(index + 1), kind: 'sound',
    titles: { 'en-US': 'shared signal' }, description: { 'en-US': 'shared signal' }, hasAudio: true, featureFacetsLazy: true, identityFeatureText: 'shared signal' }));
  source.lexical.docs = source.assets.map(asset => [asset.resourceId, 'feature', 3]);
  const packed = Buffer.from(Uint32Array.from(source.assets, (_, index) => index * 8 + 1).buffer).toString('base64');
  source.lexical.postings = Object.fromEntries(Array.from({ length: 24 }, (_, index) => [index === 0 ? 'signal' : `shared-term-${index}`, packed]));
  await store.write(base, payload);
  assert.ok(storage.puts.filter(item => item.key.includes(':0:postings:')).length > 1);
  const restored = await store.read(base);
  assert.deepEqual(restored.sources[0].lexical.postings, source.lexical.postings);
  const catalog = { indexVersion: 'restored-synthetic-version', assets: restored.sources.flatMap(item => item.assets),
    lexical: { format: 'sharded-uint32-base64-v1', shards: restored.sources.map(item => ({ lexical: item.lexical })) } };
  const query = { query: 'signal', scope: 'sound', includeEffectAudio: false, locale: 'en-US', limit: 6 };
  const result = await searchAssets(query, { ASSET_SEARCH_CATALOG: catalog });
  const originalCatalog = { ...catalog, assets: payload.sources.flatMap(item => item.assets),
    lexical: { format: 'sharded-uint32-base64-v1', shards: payload.sources.map(item => ({ lexical: item.lexical })) } };
  assert.deepEqual(result, await searchAssets(query, { ASSET_SEARCH_CATALOG: originalCatalog }));
  assert.ok(result.total >= 6);
  assert.equal(result.candidates.length, 6);
  assert.ok(result.candidates.every(asset => asset.kind === 'sound'));
});

test('metadata reads and sync updates only touch the small manifest and keep the generation unchanged', async () => {
  const storage = new MemoryStorage(), store = storeFor(storage), payload = fixture({ large: true });
  await store.write(base, payload);
  const generation = manifestFor(storage).generation, get = storage.get.bind(storage), reads = [], originalWrites = storage.puts.length;
  storage.get = async (key, options) => { reads.push(key); assert.ok(key.endsWith(':manifest'), 'Metadata operations cannot restore any asset/index chunks'); return get(key, options); };
  assert.deepEqual(await store.readMetadata(base), { sync: payload.sync, markerVersion: payload.markerVersion });
  const updatedSync = { ...payload.sync, checkedAt: 700, markerCheckedAt: 700, markerVersion: payload.markerVersion };
  assert.equal(await store.updateSync(base, updatedSync), true);
  assert.deepEqual(await store.readMetadata(base), { sync: updatedSync, markerVersion: payload.markerVersion });
  assert.equal(storage.puts.length, originalWrites + 1);
  assert.ok(storage.puts.at(-1).key.endsWith(':manifest'), 'Updating state never rewrites the large evidence chunks');
  assert.equal(manifestFor(storage).generation, generation);
  assert.equal(reads.length, 3);
  storage.get = get;
  assert.deepEqual(await store.read(base), { ...payload, sync: updatedSync });
});

test('metadata operations reject incompatible source/identity and malformed state without changing a valid snapshot', async () => {
  const storage = new MemoryStorage(), store = storeFor(storage), payload = fixture();
  await store.write(base, payload); const puts = storage.puts.length;
  assert.equal(await store.readMetadata(base + '/other'), null);
  assert.equal(await store.updateSync(base + '/other', payload.sync), false);
  const otherIdentity = createAssetCatalogSnapshotStore(storage, { baseIndexVersion: 'other-identity' });
  assert.equal(await otherIdentity.readMetadata(base), null);
  assert.equal(await otherIdentity.updateSync(base, payload.sync), false);
  for (const sync of [null, [], {}, { ...payload.sync, status: 'disabled' }, { ...payload.sync, hashes: null },
    { ...payload.sync, hashes: { sound: 'a' } }, { ...payload.sync, markerCheckedAt: 'wrong-time' },
    { ...payload.sync, checkedAt: -1 }, { ...payload.sync, markerVersion: 'different-marker' }]) {
    await assert.rejects(store.updateSync(base, sync), error => error.code === 'ASSET_CATALOG_SNAPSHOT_INVALID');
  }
  assert.equal(storage.puts.length, puts);
  assert.deepEqual(await store.read(base), payload);
  storage.failPut = key => key.endsWith(':manifest');
  await assert.rejects(store.updateSync(base, { ...payload.sync, checkedAt: 900 }), /storage write failed/);
  storage.failPut = null;
  assert.deepEqual(await store.readMetadata(base), { sync: payload.sync, markerVersion: payload.markerVersion });
  const manifestKey = [...storage.values.keys()].find(key => key.endsWith(':manifest'));
  const originalManifest = structuredClone(manifestFor(storage));
  for (const invalidState of [{ sync: null }, { sync: [] }, { markerVersion: '' }, { markerVersion: 123 },
    { markerVersion: '  whitespace  ' }, { markerVersion: 'x'.repeat(257) }]) {
    storage.values.set(manifestKey, { ...originalManifest, ...invalidState });
    assert.equal(await store.readMetadata(base), null);
    assert.equal(await store.read(base), null, 'Malformed manifest state cannot escape into loader restoration');
  }
});
