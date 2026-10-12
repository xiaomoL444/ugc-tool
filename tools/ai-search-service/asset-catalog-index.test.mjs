import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssetCatalogLoader } from './asset-catalog-loader.mjs';
import { getAssetDetails, searchAssets } from './asset-search.mjs';
import { identityFixture, featureFixture, featureResponse } from './asset-catalog-fixture.mjs';

const base = 'https://assets.example/catalog';
const environment = { ASSET_FEATURES_BASE_URL: base };
const markerPath = '/catalog/AISearch/index.json';
const sourceProjects = ['SoundEffectPlayer', 'EffectPlayer', 'BgmPlayer'];
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
async function immediate(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} waited for background work`)), 250);
    })]);
  } finally { clearTimeout(timer); }
}
async function fixture(options = {}) {
  const identities = identityFixture();
  const revisions = [];
  for (let revision = 1; revision <= 3; revision++) {
    revisions.push({
      sound: await featureFixture('sound', identities, `revision ${revision} thunder`),
      effect: await featureFixture('effect', identities),
      bgm: await featureFixture('bgm', identities, 'peaceful piano'),
    });
  }
  let marker = 'release-1', revision = 1, clock = 0;
  const requests = [];
  const gates = new Map();
  let failProject = '', afterSource;
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname;
    requests.push({ url: String(url), path, options });
    if (path === markerPath) return Response.json({ data: marker });
    const project = sourceProjects.find(value => path === `/catalog/${value}/features.json`);
    assert.ok(project, `Only fixed public catalogue paths may be fetched: ${url}`);
    if (gates.has(project)) {
      const gate = gates.get(project);
      gate.started?.resolve();
      await gate.promise;
    }
    if (project === failProject) return new Response('synthetic feature outage', { status: 502 });
    const kind = { SoundEffectPlayer: 'sound', EffectPlayer: 'effect', BgmPlayer: 'bgm' }[project];
    const response = featureResponse(revisions[revision - 1][kind], `"${project}-revision-${revision}"`);
    afterSource?.(project);
    return response;
  };
  const loader = createAssetCatalogLoader({ indexDriven: true, identities, now: () => clock, fetcher, ...options });
  return {
    loader, identities, requests, gates, fetcher,
    setMarker(value) { marker = value; },
    setRevision(value) { revision = value; },
    setClock(value) { clock = value; },
    fail(value) { failProject = value; },
    afterSource(value) { afterSource = value; },
    markers: () => requests.filter(request => request.path === markerPath),
    sources: () => requests.filter(request => request.path !== markerPath),
  };
}
const detail = snapshot => getAssetDetails(['sound:1'], 'zh-CN', { ASSET_SEARCH_CATALOG: snapshot.catalog }).assets[0].description;

function memoryStorage() {
  const values = new Map(); let puts = 0, chunkPuts = 0, chunkGets = 0, rejectWrites = false;
  return {
    get: async key => { if (!key.endsWith(':manifest')) chunkGets++; return structuredClone(values.get(key)); },
    put: async (key, value) => {
      if (rejectWrites) throw new Error('synthetic snapshot storage failure');
      puts++; if (!key.endsWith(':manifest')) chunkPuts++; values.set(key, structuredClone(value));
    },
    delete: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key); },
    list: async ({ prefix, limit }) => new Map([...values].filter(([key]) => key.startsWith(prefix)).slice(0, limit)),
    writes: () => puts,
    chunkWrites: () => chunkPuts,
    chunkReads: () => chunkGets,
    rejectWrites(value) { rejectWrites = value; },
  };
}

test('a restarted loader restores the persisted verified generation without any OSS requests', async () => {
  const storage = memoryStorage(), state = await fixture({ storage });
  const initial = await state.loader.read(environment), firstWriteCount = storage.writes(), firstChunkCount = storage.chunkWrites();
  assert.ok(firstWriteCount > 1);
  await state.loader.checkForUpdates(environment);
  assert.equal(storage.chunkWrites(), firstChunkCount, 'An unchanged marker must not rewrite the snapshot chunks');
  const resumed = createAssetCatalogLoader({ indexDriven: true, storage, identities: state.identities,
    fetcher: async () => { throw new Error('Restoring the last-good snapshot must not wait for OSS'); } });
  const restored = await resumed.read(environment);
  assert.equal(restored.catalog.indexVersion, initial.catalog.indexVersion);
  assert.deepEqual(restored.featureSync.hashes, initial.featureSync.hashes);
  assert.deepEqual(restored.catalog.coverage, initial.catalog.coverage);
  assert.equal(detail(restored), detail(initial));
  assert.deepEqual(await searchAssets({ query: 'thunder', scope: 'sound' }, { ASSET_SEARCH_CATALOG: restored.catalog }),
    await searchAssets({ query: 'thunder', scope: 'sound' }, { ASSET_SEARCH_CATALOG: initial.catalog }));
});

test('an idle scheduled check reads only the durable manifest and marker without hydrating the large snapshot', async () => {
  const storage = memoryStorage(), state = await fixture({ storage });
  const initial = await state.loader.read(environment), chunkReads = storage.chunkReads(), chunkWrites = storage.chunkWrites();
  const coldCron = createAssetCatalogLoader({ indexDriven: true, storage, identities: state.identities, now: () => 300_000, fetcher: state.fetcher });
  const networkReads = state.requests.length;
  const checked = await coldCron.checkForUpdates(environment, { metadataOnly: true });
  assert.equal(checked.catalog, undefined, 'A background marker check need not build an in-memory catalogue');
  assert.equal(checked.featureSync.status, 'ready');
  assert.equal(state.requests.length, networkReads + 1); assert.equal(storage.chunkReads(), chunkReads);
  assert.equal(storage.chunkWrites(), chunkWrites);
  const restored = await coldCron.read(environment);
  assert.equal(restored.catalog.indexVersion, initial.catalog.indexVersion);
  assert.equal(restored.featureSync.markerCheckedAt, 300_000);
  assert.equal(state.requests.length, networkReads + 1);
});

test('failed snapshot publication preserves both the live generation and the durable generation', async () => {
  const storage = memoryStorage(), state = await fixture({ storage });
  const initial = await state.loader.read(environment);
  state.setMarker('release-2'); state.setRevision(2); storage.rejectWrites(true);
  const rejected = await state.loader.checkForUpdates(environment);
  assert.equal(rejected.catalog, initial.catalog); assert.equal(rejected.featureSync.status, 'stale');
  storage.rejectWrites(false);
  const resumed = createAssetCatalogLoader({ indexDriven: true, storage, identities: state.identities, fetcher: state.fetcher });
  assert.equal((await resumed.read(environment)).catalog.indexVersion, initial.catalog.indexVersion);
  const recovered = await state.loader.checkForUpdates(environment);
  assert.notEqual(recovered.catalog.indexVersion, initial.catalog.indexVersion);
  assert.equal(recovered.featureSync.status, 'ready');
  const afterRestart = createAssetCatalogLoader({ indexDriven: true, storage, identities: state.identities, fetcher: state.fetcher });
  assert.equal((await afterRestart.read(environment)).catalog.indexVersion, recovered.catalog.indexVersion);
});

test('request-triggered catch-up respects the five-minute interval while explicit scheduled checks can retry', async () => {
  const state = await fixture();
  const initial = await state.loader.read(environment), baselineRequests = state.requests.length;
  state.setMarker('release-2'); state.setRevision(2); state.setClock(299_999);
  assert.equal((await state.loader.checkForUpdates(environment, { respectInterval: true })).catalog, initial.catalog);
  assert.equal(state.requests.length, baselineRequests);
  state.setClock(300_000);
  assert.notEqual((await state.loader.checkForUpdates(environment, { respectInterval: true })).catalog, initial.catalog);
  const afterRefresh = state.requests.length;
  await state.loader.checkForUpdates(environment, { respectInterval: true });
  assert.equal(state.requests.length, afterRefresh);
  await state.loader.checkForUpdates(environment);
  assert.equal(state.requests.length, afterRefresh + 1);
});

test('index-driven cold load establishes a public marker baseline and warm reads never start network work', async () => {
  const state = await fixture();
  const first = await state.loader.read({ ...environment, UPSTREAM_API_KEY: 'synthetic-secret' });
  assert.equal(first.featureSync.status, 'ready');
  assert.equal(first.catalog.assets.length, state.identities.assets.length);
  assert.match(detail(first), /revision 1/);
  assert.ok(state.markers().length >= 1);
  assert.deepEqual(state.sources().map(request => request.path), sourceProjects.map(project => `/catalog/${project}/features.json`));
  for (const { url, options } of state.requests) {
    const target = new URL(url);
    assert.equal(target.origin, 'https://assets.example');
    assert.equal(target.username, ''); assert.equal(target.password, '');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual');
    assert.equal(options.cache, 'no-store');
    assert.equal(new Headers(options.headers).get('authorization'), null);
    assert.equal(new Headers(options.headers).get('cookie'), null);
  }
  const count = state.requests.length;
  state.setClock(10 ** 9); state.setMarker('unobserved-release');
  assert.equal((await immediate(state.loader.read(environment), 'Warm read')).catalog, first.catalog);
  const pin = await immediate(state.loader.acquire(environment), 'Warm acquire');
  assert.equal(pin.catalog, first.catalog); pin.release();
  assert.equal(state.requests.length, count, 'Elapsed time and remote marker changes are inspected only by explicit checks');
});

test('each unchanged marker check reads one small file and skips every large feature source', async () => {
  const state = await fixture();
  const first = await state.loader.read(environment), markers = state.markers().length;
  const files = state.sources().length;
  for (let index = 0; index < 3; index++) {
    state.setClock(index + 1);
    const checked = await state.loader.checkForUpdates(environment);
    assert.equal(checked.catalog, first.catalog);
    assert.deepEqual(checked.featureSync.hashes, first.featureSync.hashes);
  }
  assert.equal(state.markers().length, markers + 3, 'Explicit checks never inherit a TTL backoff');
  assert.equal(state.sources().length, files);
});

test('a changed marker refresh runs behind immediate reads and acquires, then swaps a complete generation', async () => {
  const state = await fixture(), gate = deferred(), entered = deferred();
  const first = await state.loader.read(environment);
  const cursor = await searchAssets({ query: 'identity', scope: 'sound', limit: 1 }, { ASSET_SEARCH_CATALOG: first.catalog });
  assert.ok(cursor.nextCursor);
  state.setMarker('release-2'); state.setRevision(2); state.setClock(100);
  gate.started = entered;
  state.gates.set('SoundEffectPlayer', gate);
  const background = state.loader.checkForUpdates(environment);
  let pin;
  try {
    await immediate(entered.promise, 'Refresh source start');
    assert.equal((await immediate(state.loader.read(environment), 'Read during refresh')).catalog, first.catalog);
    pin = await immediate(state.loader.acquire(environment), 'Acquire during refresh');
    assert.equal(pin.catalog, first.catalog);
  } finally { gate.resolve(); pin?.release(); }
  const updated = await background;
  assert.notEqual(updated.catalog, first.catalog);
  assert.notEqual(updated.catalog.indexVersion, first.catalog.indexVersion);
  assert.match(detail(updated), /revision 2/);
  assert.equal(updated.featureSync.status, 'ready');
  await assert.rejects(searchAssets({ query: 'identity', scope: 'sound', limit: 1, cursor: cursor.nextCursor }, { ASSET_SEARCH_CATALOG: updated.catalog }), { code: 'CATALOG_VERSION_MISMATCH', status: 409 });
});

test('a partial feature failure preserves the last committed marker and retries that same marker immediately', async () => {
  const state = await fixture();
  const first = await state.loader.read(environment);
  state.setMarker('release-2'); state.setRevision(2); state.fail('EffectPlayer');
  const failed = await state.loader.checkForUpdates(environment);
  assert.equal(failed.catalog, first.catalog);
  assert.equal(failed.featureSync.status, 'stale');
  assert.deepEqual(failed.featureSync.hashes, first.featureSync.hashes);
  assert.match(detail(failed), /revision 1/);
  const requests = state.sources().length;
  state.fail('');
  const recovered = await state.loader.checkForUpdates(environment);
  assert.ok(state.sources().length > requests, 'A failed candidate never acknowledges its marker');
  assert.notEqual(recovered.catalog, first.catalog);
  assert.match(detail(recovered), /revision 2/);
  assert.equal(recovered.featureSync.status, 'ready');
  const settledRequests = state.sources().length;
  await state.loader.checkForUpdates(environment);
  assert.equal(state.sources().length, settledRequests, 'Only a successful full generation acknowledges the marker');
});

test('a failed warm marker check keeps searchable evidence and the next explicit check may recover immediately', async () => {
  const state = await fixture(), first = await state.loader.read(environment);
  state.setMarker(undefined);
  const files = state.sources().length;
  const failed = await state.loader.checkForUpdates(environment);
  assert.equal(failed.catalog, first.catalog);
  assert.equal(failed.featureSync.status, 'stale');
  assert.deepEqual(failed.featureSync.hashes, first.featureSync.hashes);
  assert.equal(state.sources().length, files, 'An invalid marker cannot authorize feature loading');
  state.setMarker('release-2'); state.setRevision(2);
  const recovered = await state.loader.checkForUpdates(environment);
  assert.equal(recovered.featureSync.status, 'ready');
  assert.match(detail(recovered), /revision 2/);
});

test('old AI pins retain their evidence while one new generation refreshes, and a third waits for capacity', async () => {
  const state = await fixture(), oldPin = await state.loader.acquire(environment);
  const oldSync = structuredClone(oldPin.featureSync);
  let currentPin;
  try {
    state.setMarker('release-2'); state.setRevision(2);
    const second = await state.loader.checkForUpdates(environment);
    assert.notEqual(second.catalog, oldPin.catalog, 'An existing pin does not block the first replacement generation');
    assert.match(detail(oldPin), /revision 1/);
    assert.deepEqual(oldPin.featureSync, oldSync);
    assert.match(detail(second), /revision 2/);
    currentPin = await immediate(state.loader.acquire(environment), 'Acquire current generation');
    assert.equal(currentPin.catalog, second.catalog);
    const before = state.sources().length;
    state.setMarker('release-3'); state.setRevision(3);
    const thirdCheck = state.loader.checkForUpdates(environment);
    assert.equal((await immediate(state.loader.read(environment), 'Read with two pinned generations')).catalog, second.catalog);
    const newestPin = await immediate(state.loader.acquire(environment), 'Acquire with two pinned generations');
    assert.equal(newestPin.catalog, second.catalog); newestPin.release();
    assert.equal(state.sources().length, before, 'Do not allocate a third feature generation while an old one remains pinned');
    oldPin.release(); oldPin.release();
    await thirdCheck;
    const third = await state.loader.checkForUpdates(environment);
    assert.match(detail(third), /revision 3/);
    assert.match(detail(currentPin), /revision 2/, 'The second generation remains immutable after it becomes old');
  } finally { oldPin.release(); currentPin?.release(); }
});

test('a marker change during source loading rejects the candidate and retries the new marker on the next check', async () => {
  const state = await fixture();
  const first = await state.loader.read(environment);
  state.setMarker('release-2'); state.setRevision(2);
  state.afterSource(project => { if (project === 'SoundEffectPlayer') state.setMarker('release-3'); });
  const failed = await state.loader.checkForUpdates(environment);
  assert.equal(failed.catalog, first.catalog, 'A marker read after all sources must still match the selected marker');
  assert.equal(failed.featureSync.status, 'stale');
  assert.deepEqual(failed.featureSync.hashes, first.featureSync.hashes);
  state.afterSource(undefined); state.setRevision(3);
  const updated = await state.loader.checkForUpdates(environment);
  assert.match(detail(updated), /revision 3/);
  assert.equal(updated.featureSync.status, 'ready');
});

test('concurrent explicit checks share one marker decision and one complete source refresh', async () => {
  const state = await fixture(), gate = deferred();
  await state.loader.read(environment);
  const beforeMarkers = state.markers().length, beforeSources = state.sources().length;
  state.setMarker('release-2'); state.setRevision(2); state.gates.set('SoundEffectPlayer', gate);
  const checks = [state.loader.checkForUpdates(environment), state.loader.checkForUpdates(environment), state.loader.checkForUpdates(environment)];
  gate.resolve();
  const results = await Promise.all(checks);
  assert.ok(results.every(snapshot => snapshot.catalog === results[0].catalog));
  assert.equal(state.sources().length, beforeSources + 3);
  assert.equal(state.markers().length, beforeMarkers + 2, 'One initial marker plus one precommit confirmation serve every concurrent checker');
});

test('cold index-driven loading rejects malformed, oversized, redirected and unavailable public markers without feature requests', async () => {
  const invalid = [
    () => Response.json(null), () => Response.json([]), () => Response.json({}),
    () => Response.json({ data: 123 }), () => Response.json({ data: '' }),
    () => Response.json({ data: '  \n ' }), () => Response.json({ data: 'x'.repeat(257) }),
    () => new Response('{"data":"release",}'),
    () => new Response('{"data":"release","padding":"' + 'x'.repeat(65_536) + '"}'),
    () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
    () => new Response(null, { status: 302, headers: { location: 'https://untrusted.example/index.json' } }),
    () => new Response('synthetic missing marker', { status: 404 }),
  ];
  for (const response of invalid) {
    const requests = [];
    const loader = createAssetCatalogLoader({ indexDriven: true, identities: identityFixture(), fetcher: async url => {
      requests.push(new URL(url).pathname); return response();
    } });
    await assert.rejects(loader.read(environment), error => error.status === 503);
    assert.deepEqual(requests, [markerPath], 'A bad marker must never produce an identity-only ready snapshot or follow a URL from its body');
  }
  let fetched = false;
  const secure = createAssetCatalogLoader({ indexDriven: true, identities: identityFixture(), fetcher: async () => { fetched = true; } });
  for (const untrustedBase of ['http://assets.example/', 'https://name:password@assets.example/', 'https://assets.example/?query=1', 'https://assets.example/#fragment']) {
    await assert.rejects(secure.read({ ASSET_FEATURES_BASE_URL: untrustedBase }), { code: 'ASSET_FEATURES_SOURCE_INVALID', status: 503 });
  }
  assert.equal(fetched, false, 'An untrusted base is rejected before fetching any marker');
});

test('cold source failure returns 503 and an explicit check can retry the uncommitted marker immediately', async () => {
  const state = await fixture();
  state.fail('EffectPlayer');
  await assert.rejects(state.loader.read(environment), error => error.status === 503);
  state.fail('');
  const recovered = await state.loader.checkForUpdates(environment);
  assert.equal(recovered.featureSync.status, 'ready');
  assert.match(detail(recovered), /revision 1/);
});

test('a foreground read joining a cold scheduled restore returns before that check finishes loading a changed marker', async () => {
  const storage = memoryStorage(), state = await fixture({ storage });
  const initial = await state.loader.read(environment);
  const storeGate = deferred(), storeStarted = deferred(), sourceGate = deferred(), sourceStarted = deferred();
  const get = storage.get;
  let firstAssetRead = true;
  storage.get = async key => {
    if (firstAssetRead && key.includes(':assets:')) {
      firstAssetRead = false; storeStarted.resolve(); await storeGate.promise;
    }
    return get(key);
  };
  state.setMarker('release-2'); state.setRevision(2);
  sourceGate.started = sourceStarted; state.gates.set('SoundEffectPlayer', sourceGate);
  const restarted = createAssetCatalogLoader({ indexDriven: true, storage, identities: state.identities,
    fetcher: state.fetcher, now: () => 400_000 });
  let checkFinished = false;
  const checking = restarted.checkForUpdates(environment).then(value => { checkFinished = true; return value; });
  let reading;
  try {
    await immediate(storeStarted.promise, 'Cold scheduled restore');
    reading = restarted.read(environment);
    storeGate.resolve();
    await immediate(sourceStarted.promise, 'Changed marker source load');
    const restored = await immediate(reading, 'Foreground reader that joined restoration');
    assert.equal(restored.catalog.indexVersion, initial.catalog.indexVersion);
    assert.match(detail(restored), /revision 1/);
    assert.equal(checkFinished, false, 'Serving restored evidence must not join the scheduled source refresh');
  } finally {
    storeGate.resolve(); sourceGate.resolve();
    await checking; await reading;
  }
  assert.match(detail(await restarted.read(environment)), /revision 2/);
});

test('a transient storage read failure retries the valid persisted snapshot before downloading any feature sources', async () => {
  const storage = memoryStorage(), state = await fixture({ storage });
  const initial = await state.loader.read(environment), features = state.sources().length;
  const get = storage.get;
  let rejected = false;
  storage.get = async key => {
    if (!rejected && key.endsWith(':manifest')) { rejected = true; throw new Error('synthetic transient storage read failure'); }
    return get(key);
  };
  const restarted = createAssetCatalogLoader({ indexDriven: true, storage, identities: state.identities,
    fetcher: state.fetcher, now: () => 400_000 });
  await assert.rejects(restarted.read(environment), error => error.status === 503);
  const recovered = await restarted.checkForUpdates(environment);
  assert.equal(recovered.featureSync.status, 'ready');
  assert.equal(recovered.catalog.indexVersion, initial.catalog.indexVersion);
  assert.equal(detail(recovered), detail(initial));
  assert.equal(state.sources().length, features, 'A recovered storage read must reuse its verified evidence');
});
