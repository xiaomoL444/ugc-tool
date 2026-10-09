/* Mock-only OSS revision checks. Never contacts asset storage, search services, or models. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);

const { createDataUpdateMonitor } = require('../src/views/AISearch/dataUpdateMonitor.ts');
const base = 'https://fixture.invalid/ugc-tool-data/';
const originalFetch = global.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(global, 'localStorage');
global.fetch = async () => { throw new Error('Unexpected real fetch in data update tests'); };

class MemoryStorage {
  constructor(entries = []) { this.values = new Map(entries); this.writes = []; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); this.writes.push([key, String(value)]); }
}
const json = value => Response.json(value);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function validateRequest(url, init) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://fixture.invalid');
  assert.equal(parsed.pathname, '/ugc-tool-data/AISearch/index.json', 'Revision checks only request the OSS index');
  assert.ok(/^\d+$/u.test(parsed.searchParams.get('_t') ?? ''), 'The source URL bypasses stale CDN copies');
  assert.equal(init.method, 'GET');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.credentials, 'omit');
  assert.equal(new Headers(init.headers).get('authorization'), null, 'OSS never receives a model key');
  assert.ok(init.signal instanceof AbortSignal);
}
function source(read) {
  return async (url, init) => { validateRequest(url, init); return read(init); };
}

(async () => {
  const monitors = [];
  const monitor = (onUpdate, fetcher, storage) => {
    const current = createDataUpdateMonitor(onUpdate, fetcher, base, storage);
    monitors.push(current);
    return current;
  };
  try {
    const storage = new MemoryStorage(), updates = [];
    let revision = ' 2026-10-09-21-05-48 ', reads = 0;
    const current = monitor(value => updates.push(value), source(() => { reads++; return json({ data: revision }); }), storage);
    await current.check();
    assert.deepEqual(updates, [], 'The first valid revision establishes a baseline');
    assert.ok([...storage.values.values()].includes(revision.trim()), 'Successful revisions are persisted after trimming');
    await current.check();
    assert.deepEqual(updates, [], 'The same revision does not prompt');
    revision = '2026-10-09-22-05-48';
    await current.check();
    await current.check();
    assert.deepEqual(updates, [revision], 'A changed revision prompts once');
    revision = '2026-10-09-23-05-48';
    await current.check();
    assert.deepEqual(updates, ['2026-10-09-22-05-48', revision], 'A later distinct revision prompts again');
    assert.equal(reads, 5);
    current.dispose();

    const restoredUpdates = [];
    let restoredRevision = revision;
    const restored = monitor(value => restoredUpdates.push(value), source(() => json({ data: restoredRevision })), storage);
    await restored.check();
    assert.deepEqual(restoredUpdates, [], 'A new monitor restores the last successful revision');
    restoredRevision = '2026-10-10-00-05-48';
    await restored.check();
    assert.deepEqual(restoredUpdates, [restoredRevision], 'Persisted revisions detect updates across page visits');
    restored.dispose();

    const legacyStorage = new MemoryStorage(), legacyUpdates = [];
    const legacyRevision = 'legacy-conversation-v1';
    const legacy = monitor(value => legacyUpdates.push(value), source(() => json({ data: legacyRevision })), legacyStorage);
    await legacy.check(true);
    await legacy.check(true);
    assert.deepEqual(legacyUpdates, [legacyRevision], 'An existing conversation without a recorded revision prompts once on first valid load');
    assert.ok([...legacyStorage.values.values()].includes(legacyRevision), 'The first legacy-conversation revision is persisted');
    legacy.dispose();
    const legacyRestoredUpdates = [];
    const legacyRestored = monitor(value => legacyRestoredUpdates.push(value), source(() => json({ data: legacyRevision })), legacyStorage);
    await legacyRestored.check(true);
    assert.deepEqual(legacyRestoredUpdates, [], 'A stored matching revision stays silent even with an existing conversation');
    legacyRestored.dispose();

    const newUserUpdates = [], newUserStorage = new MemoryStorage();
    const newUser = monitor(value => newUserUpdates.push(value), source(() => json({ data: 'new-user-v1' })), newUserStorage);
    await newUser.check(false);
    await newUser.check(true);
    assert.deepEqual(newUserUpdates, [], 'An explicit new-user check establishes a silent baseline and later checks do not relabel it as an update');
    assert.ok([...newUserStorage.values.values()].includes('new-user-v1'));
    newUser.dispose();

    for (const initialFailure of [
      () => { throw new Error('Synthetic initial connection failure'); },
      () => new Response('', { status: 503 }),
      () => new Response('{invalid json'),
      () => json({ data: '' }),
    ]) {
      const retryUpdates = [], retryStorage = new MemoryStorage();
      let retryReads = 0;
      const retry = monitor(value => retryUpdates.push(value), source(() => ++retryReads === 1 ? initialFailure() : json({ data: 'retry-legacy-v1' })), retryStorage);
      await retry.check(true);
      assert.deepEqual(retryUpdates, [], 'An unsuccessful initial legacy-conversation check cannot prompt');
      assert.equal(retryStorage.writes.length, 0, 'An unsuccessful initial check cannot consume the legacy-conversation baseline');
      await retry.check(true);
      await retry.check(true);
      assert.deepEqual(retryUpdates, ['retry-legacy-v1'], 'A successful retry still prompts the legacy conversation exactly once');
      assert.ok([...retryStorage.values.values()].includes('retry-legacy-v1'));
      retry.dispose();
    }

    const legacyConcurrentResponse = deferred(), legacyConcurrentUpdates = [];
    let legacyConcurrentReads = 0;
    const legacyConcurrent = monitor(value => legacyConcurrentUpdates.push(value), source(() => {
      legacyConcurrentReads++;
      return legacyConcurrentResponse.promise;
    }), new MemoryStorage());
    const legacyConcurrentCheck = legacyConcurrent.check(true);
    await legacyConcurrent.check(true);
    assert.equal(legacyConcurrentReads, 1, 'Concurrent first-load legacy checks share the active request');
    legacyConcurrentResponse.resolve(json({ data: 'legacy-concurrent-v1' }));
    await legacyConcurrentCheck;
    await legacyConcurrent.check(true);
    assert.deepEqual(legacyConcurrentUpdates, ['legacy-concurrent-v1'], 'Concurrent first-load checks and later checks prompt the legacy conversation once');
    legacyConcurrent.dispose();

    const legacyNoStorageUpdates = [];
    const legacyNoStorage = monitor(value => legacyNoStorageUpdates.push(value), source(() => json({ data: 'legacy-memory-v1' })), {
      getItem() { throw new Error('Storage blocked'); },
      setItem() { throw new Error('Storage blocked'); },
    });
    await legacyNoStorage.check(true);
    await legacyNoStorage.check(true);
    await legacyNoStorage.check(true);
    assert.deepEqual(legacyNoStorageUpdates, ['legacy-memory-v1'], 'An unavailable storage still deduplicates the first-load prompt within the monitor');
    legacyNoStorage.dispose();

    const persisted = [...storage.values.entries()];
    const failureUpdates = [];
    const failures = [
      () => new Response('', { status: 404 }),
      () => new Response('', { status: 503 }),
      () => new Response('{invalid json'),
      () => { throw new Error('Synthetic connection failure'); },
      ...[null, [], {}, { data: null }, { data: 20261009 }, { data: '' }, { data: ' \n ' }, { data: 'x'.repeat(257) }].map(value => () => json(value)),
    ];
    const failed = monitor(value => failureUpdates.push(value), source(() => failures.length ? failures.shift()() : json({ data: restoredRevision })), storage);
    while (failures.length) {
      await failed.check();
      assert.deepEqual([...storage.values.entries()], persisted, 'Failed or invalid reads never replace the successful baseline');
    }
    await failed.check();
    assert.deepEqual(failureUpdates, [], 'Recovery with the last good revision does not falsely prompt');
    failed.dispose();

    const concurrentResponse = deferred();
    let concurrentReads = 0;
    const concurrentUpdates = [];
    const concurrent = monitor(value => concurrentUpdates.push(value), source(() => { concurrentReads++; return concurrentResponse.promise; }), storage);
    const firstCheck = concurrent.check();
    await concurrent.check();
    assert.equal(concurrentReads, 1, 'Overlapping checks share one active request');
    concurrentResponse.resolve(json({ data: 'concurrent-new-revision' }));
    await firstCheck;
    assert.deepEqual(concurrentUpdates, ['concurrent-new-revision']);
    concurrent.dispose();

    const lateResponse = deferred(), lateUpdates = [];
    const beforeDispose = [...storage.values.entries()];
    let lateSignal, lateReads = 0;
    const disposed = monitor(value => lateUpdates.push(value), source(init => { lateReads++; lateSignal = init.signal; return lateResponse.promise; }), storage);
    const lateCheck = disposed.check();
    disposed.dispose();
    assert.equal(lateSignal.aborted, true, 'Disposal aborts the pending OSS request');
    lateResponse.resolve(json({ data: 'must-not-be-observed' }));
    await lateCheck;
    await disposed.check();
    assert.equal(lateReads, 1, 'A disposed monitor cannot start another request');
    assert.deepEqual(lateUpdates, [], 'A late response after disposal cannot prompt');
    assert.deepEqual([...storage.values.entries()], beforeDispose, 'A late response cannot persist an unobserved revision');

    const unavailableUpdates = [];
    let unavailableRevision = 'memory-v1';
    const unavailable = monitor(value => unavailableUpdates.push(value), source(() => json({ data: unavailableRevision })), {
      getItem() { throw new Error('Storage blocked'); },
      setItem() { throw new Error('Storage blocked'); },
    });
    await unavailable.check();
    unavailableRevision = 'memory-v2';
    await unavailable.check();
    await unavailable.check();
    assert.deepEqual(unavailableUpdates, ['memory-v2'], 'Unavailable storage preserves in-memory detection and deduplication');
    unavailable.dispose();

    const globalStorage = new MemoryStorage();
    Object.defineProperty(global, 'localStorage', { configurable: true, value: globalStorage });
    const implicit = monitor(() => {}, source(() => json({ data: 'implicit-v1' })));
    await implicit.check();
    implicit.dispose();
    assert.ok([...globalStorage.values.values()].includes('implicit-v1'), 'The default monitor uses accessible global localStorage');
    const implicitUpdates = [];
    const implicitRestored = monitor(value => implicitUpdates.push(value), source(() => json({ data: 'implicit-v2' })));
    await implicitRestored.check();
    assert.deepEqual(implicitUpdates, ['implicit-v2']);
    implicitRestored.dispose();

    Object.defineProperty(global, 'localStorage', { configurable: true, get() { throw new Error('Global storage blocked'); } });
    let noStorageRevision = 'no-storage-v1';
    const noStorageUpdates = [];
    const noStorage = monitor(value => noStorageUpdates.push(value), source(() => json({ data: noStorageRevision })));
    await noStorage.check();
    noStorageRevision = 'no-storage-v2';
    await noStorage.check();
    assert.deepEqual(noStorageUpdates, ['no-storage-v2'], 'A throwing global storage getter falls back to memory');
    noStorage.dispose();

    const realSetTimeout = global.setTimeout, realClearTimeout = global.clearTimeout;
    let deadline, deadlineMs, timeoutSignal;
    try {
      global.setTimeout = (callback, delay) => { deadline = callback; deadlineMs = delay; return 123; };
      global.clearTimeout = () => {};
      const timeoutUpdates = [], timeoutStorage = new MemoryStorage(storage.values);
      const timeoutBefore = [...timeoutStorage.values.entries()];
      const timed = monitor(value => timeoutUpdates.push(value), source(init => {
        timeoutSignal = init.signal;
        return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('Synthetic abort')), { once: true }));
      }), timeoutStorage);
      const timeoutCheck = timed.check();
      assert.equal(deadlineMs, 5000, 'The metadata request has a five-second deadline');
      deadline();
      await timeoutCheck;
      assert.equal(timeoutSignal.aborted, true);
      assert.deepEqual(timeoutUpdates, []);
      assert.deepEqual([...timeoutStorage.values.entries()], timeoutBefore);
      timed.dispose();
    } finally { global.setTimeout = realSetTimeout; global.clearTimeout = realClearTimeout; }

    console.log('PASS AI search data update: first-load baseline, legacy-conversation migration and retries, changed revision deduplication, persisted visits, failed/invalid read isolation, concurrent checks, disposal, storage fallback, five-second abort and OSS-only requests');
  } finally {
    for (const current of monitors) current.dispose();
    global.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(global, 'localStorage', originalStorage);
    else delete global.localStorage;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
