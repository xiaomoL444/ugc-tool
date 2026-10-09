import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url); let runtime;
try { runtime = require(process.env.MINIFLARE_MODULE_PATH || 'miniflare'); } catch { }

async function inspector(mf) {
  const endpoint = await mf.getInspectorURL(); const http = new URL(endpoint); http.protocol = 'http:';
  const targets = await (await fetch(new URL('/json', http))).json();
  const target = targets.find(target => /feature-runtime/.test(target.title || target.id)) || targets.at(-1);
  const ws = new WebSocket(target.webSocketDebuggerUrl); let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); const waiter = pending.get(message.id); if (waiter) { pending.delete(message.id); waiter(message); } });
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  const command = async method => {
    const id = ++nextId; const promise = new Promise(resolve => pending.set(id, resolve)); ws.send(JSON.stringify({ id, method }));
    const message = await promise; if (message.error) throw Error(message.error.message); return message.result;
  };
  return { heap: () => command('Runtime.getHeapUsage'), close: () => ws.close() };
}

test('workerd Durable Object loads real feature files, checks ETags, swaps changed content and keeps last-good on rejection', {
  skip: runtime ? false : 'Set MINIFLARE_MODULE_PATH to enable the native real-catalog regression.', timeout: 120000,
}, async t => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const identityText = await readFile(new URL('./generated/asset-identities.json', import.meta.url), 'utf8');
  const identities = JSON.parse(identityText);
  const { FEATURE_LOCALES, extractAssetFeatureDictionaries, computeAssetFeatureSourceHash, computeAssetCatalogVersion } = await import('./asset-features.mjs');
  const { createHash } = await import('node:crypto');
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const sourceDirectory = path.resolve(process.env.FEATURE_RUNTIME_SOURCE_DIR || path.join(root, '../../exports/ugc-tool-data'));
  const updateDirectory = process.env.FEATURE_RUNTIME_UPDATE_DIR ? path.resolve(process.env.FEATURE_RUNTIME_UPDATE_DIR) : null;
  const sourceFiles = new Map(), updatedFiles = new Map(), sourceHashes = {}, updatedHashes = {};
  const sourceSuggestions = [], updatedSuggestions = [], suggestionCoverage = { source: {}, updated: {} };
  const audioEffectIds = new Set(identities.assets.filter(asset => asset.kind === 'effect' && asset.hasAudio === true).map(asset => asset.id));
  const selectSuggestions = (sidecar, dictionaries, snapshot) => {
    const tables = extractAssetFeatureDictionaries(sidecar.project, dictionaries);
    const facets = sidecar.kind !== 'effect' ? [['audio', ['audio']]] : [['visual', ['standVisual', 'tailVisual']], ['audio', ['audio']]];
    const samples = [];
    for (const [matchOn, parts] of facets) {
      const candidates = [];
      for (const [id, resource] of Object.entries(sidecar.resources)) {
        if (sidecar.kind === 'effect' && matchOn === 'audio' && !audioEffectIds.has(id)) continue;
        const refs = parts.flatMap(part => resource.searchMetadata[part]?.status === 'generated'
          ? resource.searchMetadata[part].suggestedUsesI18nKeys || [] : []);
        const ref = refs.find(key => FEATURE_LOCALES.every(locale => typeof tables[locale][key] === 'string' && tables[locale][key].trim()));
        if (ref) candidates.push({ resourceId: sidecar.kind + ':' + id, kind: sidecar.kind, matchOn,
          phrases: Object.fromEntries(FEATURE_LOCALES.map(locale => [locale, tables[locale][ref].trim()])) });
      }
      suggestionCoverage[snapshot][sidecar.kind + '/' + matchOn] = candidates.length;
      for (const index of new Set([0, Math.floor(candidates.length / 2), candidates.length - 1])) {
        if (candidates[index]) samples.push(candidates[index]);
      }
    }
    return samples;
  };
  const projects = [['sound', 'SoundEffectPlayer', 'audio'], ['effect', 'EffectPlayer', 'standVisual'], ['bgm', 'BgmPlayer', 'audio']];
  let soundId;
  for (const [kind, project, partName] of projects) {
    const relative = project + '/features.json';
    const sourceRoot = project === 'BgmPlayer' && process.env.FEATURE_RUNTIME_BGM_SOURCE_DIR ? path.resolve(process.env.FEATURE_RUNTIME_BGM_SOURCE_DIR) : sourceDirectory;
    const updateRoot = project === 'BgmPlayer' && process.env.FEATURE_RUNTIME_BGM_SOURCE_DIR ? path.resolve(process.env.FEATURE_RUNTIME_BGM_SOURCE_DIR) : updateDirectory;
    const bytes = await readFile(path.join(sourceRoot, relative));
    sourceFiles.set(relative, bytes);
    const sidecar = JSON.parse(bytes), dictionaries = {}, updatedDictionaries = {}, dictionaryHashes = {}, updatedDictionaryHashes = {};
    const id = Object.keys(sidecar.resources).find(id => sidecar.resources[id].searchMetadata[partName]?.status === 'generated');
    assert.ok(id, 'No generated feature to exercise refresh for ' + project);
    if (kind === 'sound') soundId = id;
    const key = sidecar.resources[id].searchMetadata[partName].shortDescriptionI18nKey;
    for (const locale of FEATURE_LOCALES) {
      const filename = project + '/i18n/' + locale + '.json';
      const original = await readFile(path.join(sourceRoot, filename));
      sourceFiles.set(filename, original); dictionaryHashes[locale] = sha(original);
      dictionaries[locale] = JSON.parse(original);
      let updated;
      if (updateDirectory) updated = await readFile(path.join(updateRoot, filename));
      else {
        const dictionary = JSON.parse(original), table = dictionary.translations || dictionary;
        if (process.env.FEATURE_RUNTIME_UPDATE_ALL === '1') {
          const prefix = (kind === 'sound' ? 'soundEffectPlayer' : 'effectPlayer') + '.search.';
          for (const searchKey in table) if (searchKey.startsWith(prefix)) table[searchKey] = 'NATIVE_UPDATED_RESOURCE_MARKER ' + table[searchKey];
        } else table[key] = 'NATIVE_UPDATED_RESOURCE_MARKER ' + table[key];
        updated = Buffer.from(JSON.stringify(dictionary));
      }
      updatedFiles.set(filename, updated); updatedDictionaryHashes[locale] = sha(updated);
      updatedDictionaries[locale] = JSON.parse(updated);
    }
    sourceSuggestions.push(...selectSuggestions(sidecar, dictionaries, 'source'));
    sourceHashes[kind] = await computeAssetFeatureSourceHash(sha(bytes), dictionaryHashes);
    let updatedSidecar, updatedBytes;
    if (updateDirectory) {
      updatedBytes = await readFile(path.join(updateRoot, relative)); updatedSidecar = JSON.parse(updatedBytes);
    } else {
      updatedSidecar = sidecar;
      await require('../../scripts/export-ai-asset-features.cjs').compileSidecar(updatedSidecar, identities, { dictionaries: updatedDictionaries });
      delete updatedSidecar.i18n;
      updatedBytes = Buffer.from(JSON.stringify(updatedSidecar));
    }
    updatedFiles.set(relative, updatedBytes);
    updatedHashes[kind] = await computeAssetFeatureSourceHash(sha(updatedBytes), updatedDictionaryHashes);
    updatedSuggestions.push(...selectSuggestions(updatedSidecar, updatedDictionaries, 'updated'));
  }
  const expectedInitialVersion = await computeAssetCatalogVersion(identities.indexVersion, sourceHashes);
  const expectedUpdatedVersion = await computeAssetCatalogVersion(identities.indexVersion, updatedHashes);
  assert.notEqual(expectedUpdatedVersion, expectedInitialVersion, 'The update directory must contain changed feature or dictionary bytes');
  const entry = `import worker, { SearchLedger } from './worker.mjs';
    import { createAssetCatalogLoader } from './asset-catalog-loader.mjs';
    import { getAssetDetails } from './asset-search.mjs';
    let clock = 0, hold = false, readHeld = false, releaseOld = false;
    export class RuntimeLedger extends SearchLedger {
      constructor(ctx, env) { super(ctx, env); this.assetCatalog = createAssetCatalogLoader({now: () => clock, timeoutMs: 15000,
        onPhase: phase => fetch('https://runtime-observer.internal/'+phase)}); }
      async fetch(request) {
        if (hold && !this.heldPin) { this.heldPin = await this.assetCatalog.acquire(this.env); this.held = {...this.env, ASSET_SEARCH_CATALOG:this.heldPin.catalog, ASSET_FEATURE_SYNC:this.heldPin.featureSync}; }
        if (releaseOld && this.heldPin) { this.heldPin.release(); this.heldPin = null; this.held = null; }
        if (readHeld) return Response.json({catalogVersion:this.held.ASSET_SEARCH_CATALOG.indexVersion,featureSync:this.held.ASSET_FEATURE_SYNC,
          items:getAssetDetails(['sound:${soundId}'],'zh-CN',this.held).assets});
        return super.fetch(request);
      }
    }
    export default { fetch(request, env) {
      const url = new URL(request.url); clock = Number(url.searchParams.get('clock') || 0); hold = url.searchParams.get('hold') === '1'; readHeld = url.searchParams.get('held') === '1'; releaseOld = url.searchParams.get('release') === '1';
      return worker.fetch(request, env);
    } };`;
  const modules = [{ type: 'ESModule', path: path.join(root, 'feature-runtime-entry.mjs'), contents: entry }];
  for (const name of ['worker.mjs','asset-json-stream.mjs','asset-catalog-loader.mjs','asset-search.mjs','asset-features.mjs','agent-runtime.mjs','mcp-handler.mjs','provider-balance.mjs','system-prompt.mjs','model-response.mjs']) {
    const contents = (await readFile(path.join(root, name), 'utf8')).replace(/ with \{ type: ['"]json['"] \}/g, '');
    modules.push({ type: 'ESModule', path: path.join(root, name), contents });
  }
  modules.push({ type: 'ESModule', path: path.join(root, 'generated/asset-identities.json'), contents: `export default ${identityText};` });
  let scenario = 'healthy'; const requests = [], timings = {}, heapSamples = [];
  const options = { name: 'feature-runtime', modules, modulesRoot: root, compatibilityDate: '2025-04-01', inspectorPort: 0,
    bindings: { ALLOWED_ORIGINS: 'https://site.example', ASSET_FEATURES_BASE_URL: 'https://oss.xiaomol444.xyz/ugc-tool-data', RETRIEVAL_MODE: 'keyword' },
    durableObjects: { SEARCH_LEDGER: { className: 'RuntimeLedger', useSQLite: true } },
    outboundService: async request => {
      const url = new URL(request.url);
      if (process.env.FEATURE_RUNTIME_DEBUG) console.log('outbound', scenario, url.pathname);
      if (url.hostname === 'runtime-observer.internal') { const phase = `${scenario}:${url.pathname}`; void debug.heap().then(value => heapSamples.push({ phase, ...value })).catch(() => {}); return new Response('observed'); }
      requests.push({ url: request.url, etag: request.headers.get('if-none-match'), authorization: request.headers.get('authorization'), cookie: request.headers.get('cookie') });
      const relative = url.pathname.replace(/^\/ugc-tool-data\//, '');
      assert.equal(url.hostname, 'oss.xiaomol444.xyz', 'Unexpected runtime outbound host');
      assert.ok(sourceFiles.has(relative), 'Unexpected runtime source path ' + relative);
      if (scenario === 'not-modified') return new Response(null, { status: 304 });
      if (scenario === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://untrusted.example/redirect' } });
      if (scenario === 'corrupt') return new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } });
      const updated = ['updated', 'same-content'].includes(scenario);
      const body = (updated ? updatedFiles : sourceFiles).get(relative);
      const etag = scenario === 'same-content' ? '"different-etag"' : JSON.stringify(relative + (updated ? ':v2' : ':v1'));
      return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', etag } });
    } };
  const mf = new runtime.Miniflare(runtime.convertV4MiniflareOptions ? runtime.convertV4MiniflareOptions(options) : options);
  let debug, sampleTimer;
  const dispatch = (endpoint, clock, body, extra = '') => mf.dispatchFetch(`http://localhost/api/ai-search/${endpoint}?clock=${clock}${extra}`, {
    headers: { origin: 'https://site.example', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  const suggestionQueries = [];
  const exerciseSuggestions = async (samples, clock, snapshot) => {
    assert.ok(samples.length, 'No real multilingual suggestions available in ' + snapshot);
    for (const sample of samples) for (const locale of FEATURE_LOCALES) {
      const phrase = sample.phrases[locale];
      const response = await dispatch('search', clock, { query: phrase.slice(0, 1900), scope: sample.kind, matchOn: sample.matchOn,
        locale, searchType: 'suggestion', includeEffectAudio: false, filters: { includeTerms: [phrase.slice(0, 80)] }, limit: 50 });
      assert.equal(response.status, 200, snapshot + '/' + sample.resourceId + '/' + locale);
      const result = await response.json();
      assert.ok(result.items.length, 'Real suggestion was not recalled: ' + snapshot + '/' + sample.resourceId + '/' + locale);
      assert.ok(result.items.every(item => item.kind === sample.kind && item.matchType === 'suggestion'), 'Suggestion search crossed its kind or evidence facet');
      if (sample.kind === 'effect') {
        assert.ok(result.items.every(item => (item.audioMatch === true) === (sample.matchOn === 'audio')), 'Effect suggestions crossed visual/audio evidence');
      }
      suggestionQueries.push({ snapshot, sourceId: sample.resourceId, matchOn: sample.matchOn, locale, count: result.items.length });
    }
  };
  try {
    await mf.ready; if (process.env.FEATURE_RUNTIME_DEBUG) console.log('runtime-ready'); debug = await inspector(mf); if (process.env.FEATURE_RUNTIME_DEBUG) console.log('inspector-ready');
    sampleTimer = setInterval(() => { void debug.heap().then(value => heapSamples.push(value)).catch(() => {}); }, 20);
    let started = performance.now(); const cold = await dispatch('catalog', 0); timings.coldMs = Math.round(performance.now() - started);
    if (process.env.FEATURE_RUNTIME_DEBUG) console.log('cold-returned', cold.status); assert.equal(cold.status, 200); assert.equal(cold.headers.get('access-control-allow-origin'), 'https://site.example'); const initial = await cold.json(); assert.equal(initial.counts.total, identities.assets.length); assert.equal(initial.featureSync.status, 'ready');
    heapSamples.push(await debug.heap()); assert.equal(requests.length, sourceFiles.size); assert.equal(initial.catalogVersion, expectedInitialVersion);
    const sound = await dispatch('search', 1, { query: '雷声', scope: 'sound', limit: 1 }); assert.equal(sound.status, 200);
    const page = await sound.json(); assert.ok(page.items.length); assert.ok(page.nextCursor);
    const mcp = await dispatch('mcp', 2, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_asset_catalog', arguments: {} } });
    assert.equal(mcp.status, 200); assert.equal((await mcp.json()).result.structuredContent.catalogVersion, initial.catalogVersion);
    await exerciseSuggestions(sourceSuggestions, 3, 'source');
    scenario = 'not-modified'; const unchanged = await (await dispatch('catalog', 60000)).json();
    assert.equal(unchanged.catalogVersion, initial.catalogVersion); assert.deepEqual(unchanged.featureSync.hashes, initial.featureSync.hashes);
    assert.equal(requests.length, sourceFiles.size * 2); for (const request of requests.slice(sourceFiles.size)) assert.equal(request.etag, JSON.stringify(new URL(request.url).pathname.replace(/^\/ugc-tool-data\//, '') + ':v1'));
    await dispatch('catalog', 60001, undefined, '&hold=1');
    scenario = 'updated'; const requestCountBeforePin = requests.length;
    const deferred = await (await dispatch('catalog', 120000)).json();
    assert.equal(deferred.catalogVersion, initial.catalogVersion); assert.equal(requests.length, requestCountBeforePin, 'a live model turn defers refresh');
    const heldDetails = await (await dispatch('assets', 120001, {ids:['sound:'+soundId],locale:'zh-CN'}, '&held=1')).json();
    assert.equal(heldDetails.catalogVersion, initial.catalogVersion); assert.deepEqual(heldDetails.featureSync.hashes, initial.featureSync.hashes);
    assert.doesNotMatch(heldDetails.items[0].description, /NATIVE_UPDATED_RESOURCE_MARKER/);
    started = performance.now();
    const concurrent = await Promise.all(Array.from({length:10},()=>dispatch('catalog', 120002, undefined, '&release=1').then(response=>response.json())));
    const changed = concurrent[0]; timings.updateMs = Math.round(performance.now() - started);
    assert.ok(concurrent.every(item=>item.catalogVersion===changed.catalogVersion));
    assert.equal(requests.length, requestCountBeforePin+sourceFiles.size, 'ten simultaneous native reads share one complete source refresh');
    assert.equal(changed.featureSync.status, 'ready'); assert.notEqual(changed.catalogVersion, initial.catalogVersion);
    assert.equal(changed.catalogVersion, expectedUpdatedVersion);
    assert.deepEqual(changed.featureSync.hashes, updatedHashes);
    const freshDetails = await (await dispatch('assets', 120001, {ids:['sound:'+soundId],locale:'zh-CN'})).json();
    assert.equal(freshDetails.catalogVersion, expectedUpdatedVersion);
    if (!updateDirectory) {
      assert.match(freshDetails.items[0].description, /NATIVE_UPDATED_RESOURCE_MARKER/);
      const newIndexSearch = await (await dispatch('search', 120003, {query:'NATIVE_UPDATED_RESOURCE_MARKER',scope:'sound'})).json();
      if (process.env.FEATURE_RUNTIME_UPDATE_ALL === '1') {
        assert.ok(newIndexSearch.items.length); assert.ok(newIndexSearch.items.every(item => item.description.includes('NATIVE_UPDATED_RESOURCE_MARKER')));
      } else assert.ok(newIndexSearch.items.some(item=>item.resourceId==='sound:'+soundId));
    }
    await exerciseSuggestions(updatedSuggestions, 120003, 'updated');
    const expired = await dispatch('search', 120004, { query: '雷声', scope: 'sound', limit: 1, cursor: page.nextCursor });
    assert.equal(expired.status, 409); assert.equal((await expired.json()).error.code, 'CATALOG_VERSION_MISMATCH');
    scenario = 'same-content'; const same = await (await dispatch('catalog', 180002)).json();
    assert.equal(same.catalogVersion, changed.catalogVersion); assert.equal(same.featureSync.updatedAt, changed.featureSync.updatedAt);
    scenario = 'redirect'; const stale = await (await dispatch('catalog', 240002)).json();
    assert.equal(stale.catalogVersion, changed.catalogVersion); assert.equal(stale.featureSync.status, 'stale'); assert.equal(stale.featureSync.errorCode, 'ASSET_FEATURES_UNAVAILABLE');
    scenario = 'corrupt'; const corrupt = await (await dispatch('catalog', 300002)).json();
    assert.equal(corrupt.catalogVersion, changed.catalogVersion); assert.equal(corrupt.featureSync.status, 'stale'); assert.equal(corrupt.featureSync.errorCode, 'ASSET_FEATURES_INVALID');
    for (const request of requests) { assert.equal(request.authorization, null); assert.equal(request.cookie, null); }
    heapSamples.push(await debug.heap());
    const peak = heapSamples.reduce((peak, value) => Math.max(peak, value.usedSize + (value.backingStorageSize || 0)), 0);
    t.diagnostic(JSON.stringify({ sourceDirectory, updateDirectory, suggestionCoverage, suggestionQueries: suggestionQueries.length, sourceBytes: Object.fromEntries([...sourceFiles].map(([relative, bytes]) => [relative, bytes.length])), timings,
      inspectorSampledPeakMiB: Math.round(peak / 1048576 * 10) / 10, finalHeap: heapSamples.at(-1), inspectorSamples: heapSamples.length, phaseSamples: heapSamples.filter(sample => sample.phase).map(sample => ({ phase: sample.phase, usedMiB: Math.round(sample.usedSize / 1048576 * 10) / 10, backingMiB: Math.round((sample.backingStorageSize || 0)/1048576 * 10)/10 })),
      v8Flags: process.env.MINIFLARE_WORKERD_V8_FLAGS || 'default', updateAll: process.env.FEATURE_RUNTIME_UPDATE_ALL === '1',
      limitation: 'Local workerd inspector samples do not reproduce Cloudflare production enforcement or guarantee unobserved allocation peaks.' }));
  } catch (error) {
    const peak=heapSamples.reduce((n,value)=>Math.max(n,value.usedSize+(value.backingStorageSize||0)),0);
    t.diagnostic(JSON.stringify({failed:true,scenario,inspectorSampledPeakMiB:Math.round(peak/1048576*10)/10,inspectorSamples:heapSamples.length,lastPhaseSamples:heapSamples.filter(x=>x.phase).slice(-12).map(x=>({phase:x.phase,usedMiB:Math.round(x.usedSize/1048576*10)/10,backingMiB:Math.round((x.backingStorageSize||0)/1048576*10)/10})),lastHeap:heapSamples.at(-1)}));
    throw error;
  } finally { clearInterval(sampleTimer); debug?.close(); await mf.dispose(); }
});
