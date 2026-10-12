import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
let runtime;
try { runtime = require(process.env.MINIFLARE_MODULE_PATH || 'miniflare'); } catch { }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function connectInspector(mf) {
  const endpoint = await mf.getInspectorURL(), http = new URL(endpoint); http.protocol = 'http:';
  const targets = await (await fetch(new URL('/json', http))).json();
  const target = targets.find(value => /index-catalog-runtime/.test(value.title || value.id)) || targets.at(-1);
  assert.ok(target?.webSocketDebuggerUrl, 'The native test requires a heap inspector target');
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  let id = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); waiter(message); }
  });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  return {
    async heap() {
      const next = ++id, result = new Promise(resolve => pending.set(next, resolve));
      socket.send(JSON.stringify({ id: next, method: 'Runtime.getHeapUsage' }));
      const message = await result;
      if (message.error) throw Error(message.error.message);
      return message.result;
    },
    close() { socket.close(); },
  };
}

test('native SQLite index loader restores real catalogues without OSS and refreshes behind old requests and AI pins', {
  skip: runtime ? false : 'Set MINIFLARE_MODULE_PATH to enable the native SQLite index regression.', timeout: 180000,
}, async t => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const sourceDirectory = path.resolve(process.env.FEATURE_INDEX_RUNTIME_SOURCE_DIR || path.join(root, '../../../ugc-ai-search-file/exports/ugc-tool-data'));
  const outputRoot = path.resolve(process.env.FEATURE_INDEX_RUNTIME_OUTPUT_DIR || path.join(root, '../../../ugc-ai-search-file/experiments/index-marker-background-20261012/native'));
  const repository = path.resolve(root, '../..');
  assert.ok(outputRoot !== repository && !outputRoot.startsWith(repository + path.sep), 'Native SQLite and temporary output must be outside the repository');
  await mkdir(outputRoot, { recursive: true });
  const runDirectory = await mkdtemp(path.join(outputRoot, 'run-'));
  const tmpDirectory = path.join(runDirectory, 'tmp'), persistenceDirectory = path.join(runDirectory, 'sqlite');
  await mkdir(tmpDirectory, { recursive: true }); await mkdir(persistenceDirectory, { recursive: true });
  const identityText = await readFile(path.join(root, 'generated/asset-identities.json'), 'utf8'), identities = JSON.parse(identityText);
  const { FEATURE_LOCALES } = await import('./asset-features.mjs');
  const sourceFiles = new Map(), updatedFiles = new Map();
  let soundId;
  for (const project of ['SoundEffectPlayer', 'EffectPlayer', 'BgmPlayer']) {
    const filename = project + '/features.json', bytes = await readFile(path.join(sourceDirectory, filename));
    sourceFiles.set(filename, bytes); updatedFiles.set(filename, bytes);
    const sidecar = JSON.parse(bytes), dictionaries = {};
    for (const locale of FEATURE_LOCALES) {
      const name = project + '/i18n/' + locale + '.json', dictionary = await readFile(path.join(sourceDirectory, name));
      sourceFiles.set(name, dictionary); updatedFiles.set(name, dictionary);
      if (project === 'SoundEffectPlayer') dictionaries[locale] = JSON.parse(dictionary);
    }
    if (project === 'SoundEffectPlayer') {
      soundId = Object.keys(sidecar.resources).find(id => sidecar.resources[id].searchMetadata.audio?.status === 'generated');
      assert.ok(soundId, 'A real generated sound is required to exercise lexical replacement');
      const key = sidecar.resources[soundId].searchMetadata.audio.shortDescriptionI18nKey;
      const table = dictionaries['zh-cn'].translations || dictionaries['zh-cn'];
      table[key] = 'NATIVE_INDEX_REPLACEMENT_MARKER ' + table[key];
      await require('../../scripts/export-ai-asset-features.cjs').compileSidecar(sidecar, identities, { dictionaries });
      delete sidecar.i18n;
      updatedFiles.set(filename, Buffer.from(JSON.stringify(sidecar)));
      updatedFiles.set(project + '/i18n/zh-cn.json', Buffer.from(JSON.stringify(dictionaries['zh-cn'])));
    }
  }
  assert.equal(sourceFiles.size, 18);
  const sourceEtags = new Map([...sourceFiles].map(([name, bytes]) => [name, JSON.stringify(createHash('sha256').update(bytes).digest('hex'))]));
  const updatedEtags = new Map([...updatedFiles].map(([name, bytes]) => [name, JSON.stringify(createHash('sha256').update(bytes).digest('hex'))]));
  const entry = `
    import { createAssetCatalogLoader } from './asset-catalog-loader.mjs';
    import { getAssetDetails, getCatalogInfo, searchAssets } from './asset-search.mjs';
    export class IndexRuntimeLedger {
      constructor(ctx, env) { this.ctx = ctx; this.env = env; this.clock = 0; this.reset(); }
      reset() {
        this.pin?.release(); this.pin = undefined; this.pending = undefined;
        this.chunkReads=0;this.chunkWrites=0;
        const store={get:(...args)=>{if(typeof args[0]==='string'&&args[0].includes(':g:'))this.chunkReads++;return this.ctx.storage.get(...args);},
          put:(...args)=>{if(typeof args[0]==='string'&&args[0].includes(':g:'))this.chunkWrites++;return this.ctx.storage.put(...args);},
          delete:(...args)=>this.ctx.storage.delete(...args),list:(...args)=>this.ctx.storage.list(...args)};
        this.loader = createAssetCatalogLoader({indexDriven:true,storage:store,now:()=>this.clock,timeoutMs:30000,
          onPhase:phase=>fetch('https://index-runtime-observer.internal/'+phase)});
      }
      info(snapshot) { const info=getCatalogInfo({ASSET_SEARCH_CATALOG:snapshot.catalog}); return {catalogVersion:snapshot.catalog.indexVersion,total:info.counts.total,featureSync:snapshot.featureSync}; }
      async fetch(request) {
        const url=new URL(request.url); this.clock=Number(url.searchParams.get('clock')||0);
        try {
          if(url.pathname==='/check') {
            this.pending=this.loader.checkForUpdates(this.env).then(snapshot=>this.info(snapshot));
            this.ctx.waitUntil(this.pending); return Response.json({started:true});
          }
          if(url.pathname==='/wait') return Response.json(await this.pending);
          if(url.pathname==='/reset-metadata') {this.reset();await this.loader.checkForUpdates(this.env,{metadataOnly:true});return Response.json({checked:true,chunkReads:this.chunkReads,chunkWrites:this.chunkWrites});}
          if(url.pathname==='/reset') this.reset();
          if(url.pathname==='/hold') this.pin=await this.loader.acquire(this.env);
          if(url.pathname==='/release') {this.pin?.release();this.pin=undefined;}
          if(url.pathname==='/stats') {
            const manifest=await this.ctx.storage.get('asset-catalog-snapshot:v1:manifest',{noCache:true});
            return Response.json({sqlite:[...this.ctx.storage.sql.exec('SELECT 1 AS ready')][0].ready,databaseBytes:this.ctx.storage.sql.databaseSize,chunkReads:this.chunkReads,chunkWrites:this.chunkWrites,
              generation:manifest?.generation,markerVersion:manifest?.markerVersion,chunks:manifest?.sources?.reduce((sum,source)=>sum+source.assets.chunks+source.docs.chunks+source.postings.chunks,0)});
          }
          const snapshot=url.pathname==='/held'?this.pin:await this.loader.read(this.env);
          if(url.pathname==='/assets'||url.pathname==='/held') return Response.json({...this.info(snapshot),items:getAssetDetails(['sound:${soundId}'],'zh-CN',{ASSET_SEARCH_CATALOG:snapshot.catalog}).assets});
          if(url.pathname==='/search') {
            const result=await searchAssets(await request.json(),{ASSET_SEARCH_CATALOG:snapshot.catalog,RETRIEVAL_MODE:'keyword'});
            const {candidates,indexVersion,...metadata}=result;return Response.json({...metadata,catalogVersion:indexVersion,items:candidates,featureSync:snapshot.featureSync});
          }
          return Response.json(this.info(snapshot));
        }catch(error){return Response.json({error:{code:error.code||error.name,message:error.message}},{status:error.status||500});}
      }
    }
    export default {fetch(request,env){return env.INDEX_RUNTIME.get(env.INDEX_RUNTIME.idFromName('real-catalog')).fetch(request);}};`;
  const modules = [{ type: 'ESModule', path: path.join(root, 'index-catalog-runtime-entry.mjs'), contents: entry }];
  // Include every production module so newly added imports in other work never become omitted dependencies.
  for (const file of await readdir(root)) {
    if (!file.endsWith('.mjs') || file.endsWith('.test.mjs') || file.endsWith('.fixture.mjs') || file === 'asset-catalog-fixture.mjs') continue;
    modules.push({ type: 'ESModule', path: path.join(root, file), contents: (await readFile(path.join(root, file), 'utf8')).replace(/ with \{ type: ['"]json['"] \}/g, '') });
  }
  modules.push({ type: 'ESModule', path: path.join(root, 'generated/asset-identities.json'), contents: `export default ${identityText};` });
  let scenario = 'source', marker = 'native-release-1', debug, gate, entered, sampleTimer;
  const requests = [], heapSamples = [], timings = {};
  const sample = async phase => {
    if (!debug) return;
    heapSamples.push({ phase, ...await debug.heap() });
  };
  const options = {
    name: 'index-catalog-runtime', modules, modulesRoot: root, compatibilityDate: '2025-04-01', inspectorPort: 0,
    rootPath: runDirectory, resourceTmpPath: tmpDirectory, resourcePersistencePath: persistenceDirectory, isolatedResourcePersistencePath: persistenceDirectory,
    bindings: { ASSET_FEATURES_BASE_URL: 'https://assets.example/ugc-tool-data' },
    durableObjects: { INDEX_RUNTIME: { className: 'IndexRuntimeLedger', useSQLite: true } },
    outboundService: async request => {
      const url = new URL(request.url);
      if (url.hostname === 'index-runtime-observer.internal') { await sample(scenario + ':' + url.pathname); return new Response('observed'); }
      assert.equal(url.hostname, 'assets.example');
      const relative = url.pathname.replace(/^\/ugc-tool-data\//, '');
      const record = { scenario, relative, conditional: request.headers.get('if-none-match'), authorization: request.headers.get('authorization'), cookie: request.headers.get('cookie') };
      requests.push(record);
      if (relative === 'AISearch/index.json') { record.status = 200; return Response.json({ data: marker }); }
      assert.ok(sourceFiles.has(relative), 'Only the trusted eighteen fixture files may be fetched');
      if (scenario === 'updated' && relative === 'SoundEffectPlayer/features.json' && gate) { entered.resolve(); await gate.promise; }
      if (scenario === 'failure' && relative === 'EffectPlayer/features.json') { record.status = 502; return new Response('synthetic outage', { status: 502 }); }
      const files = scenario === 'source' ? sourceFiles : updatedFiles, bytes = files.get(relative);
      const tag = (files === sourceFiles ? sourceEtags : updatedEtags).get(relative);
      if (scenario !== 'same-content' && request.headers.get('if-none-match') === tag) { record.status = 304; return new Response(null, { status: 304, headers: { etag: tag } }); }
      record.status = 200;
      return new Response(bytes, { headers: { 'content-type': 'application/json; charset=utf-8', etag: tag } });
    },
  };
  const mf = new runtime.Miniflare(runtime.convertV4MiniflareOptions ? runtime.convertV4MiniflareOptions(options) : options);
  const dispatch = (endpoint, body) => mf.dispatchFetch(`http://localhost/${endpoint}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const read = async (endpoint, body) => { const response = await dispatch(endpoint, body); const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result; };
  const summary = () => ({ sourceDirectory, runDirectory, timings, files: sourceFiles.size, sourceBytes: [...sourceFiles.values()].reduce((total, bytes) => total + bytes.length, 0),
    inspectorSampledPeakMiB: Math.round(heapSamples.reduce((peak, sample) => Math.max(peak, sample.usedSize + (sample.backingStorageSize || 0)), 0) / 1048576 * 10) / 10,
    inspectorSamples: heapSamples.length, v8Flags: process.env.MINIFLARE_WORKERD_V8_FLAGS || 'default',
    limitation: 'Local synthetic OSS transport and workerd inspector sampling do not measure production latency or guarantee every transient allocation peak.' });
  try {
    await mf.ready; debug = await connectInspector(mf);
    sampleTimer = setInterval(() => { void sample(scenario + ':interval').catch(() => {}); }, 40);
    let started = performance.now();
    const first = await read('catalog'); timings.coldMs = Math.round(performance.now() - started);
    assert.equal(first.total, identities.assets.length); assert.equal(first.featureSync.status, 'ready');
    assert.equal(requests.filter(value => value.relative !== 'AISearch/index.json').length, 18);
    const stats = await read('stats'); assert.equal(stats.sqlite, 1); assert.ok(stats.chunks > 3); assert.equal(stats.markerVersion, marker); assert.ok(stats.databaseBytes > 0);
    const page = await read('search', { query: '雷声', scope: 'sound', limit: 1 }); assert.ok(page.items.length); assert.ok(page.nextCursor);
    const sourceCount = requests.length;
    started = performance.now();
    const coldMetadata = await read('reset-metadata'); timings.coldMetadataCheckMs = Math.round(performance.now() - started);
    assert.equal(coldMetadata.chunkReads, 0); assert.equal(coldMetadata.chunkWrites, 0);
    assert.equal(requests.length, sourceCount + 1, 'Cold metadata-only scheduled checks load one small marker and no SQLite data chunks');
    started = performance.now(); const restored = await read('reset'); timings.sqliteRestoreMs = Math.round(performance.now() - started);
    assert.equal(restored.catalogVersion, first.catalogVersion); assert.deepEqual(restored.featureSync.hashes, first.featureSync.hashes);
    assert.equal(requests.length, sourceCount + 1, 'Replacing the loader restores all evidence from actual SQLite without any OSS request');
    await read('check'); const unchanged = await read('wait');
    assert.equal(unchanged.catalogVersion, first.catalogVersion); assert.equal(requests.length, sourceCount + 2);
    await read('hold'); const heldBefore = await read('held');
    scenario = 'updated'; marker = 'native-release-2'; gate = deferred(); entered = deferred();
    started = performance.now(); await read('check');
    let sourceStartTimer;
    try {
      await Promise.race([entered.promise, new Promise((_, reject) => { sourceStartTimer = setTimeout(() => reject(Error('Background refresh never entered its source fetch')), 5000); })]);
    } finally { clearTimeout(sourceStartTimer); }
    let responsivenessTimer;
    try {
      const immediate = Promise.all([read('catalog'), read('search', { query: '雷声', scope: 'sound', limit: 1 })]);
      const [oldCatalog, oldSearch] = await Promise.race([immediate, new Promise((_, reject) => { responsivenessTimer = setTimeout(() => reject(Error('Native foreground requests waited for the gated background refresh')), 1500); })]);
      timings.foregroundDuringUpdateMs = Math.round(performance.now() - started);
      assert.equal(oldCatalog.catalogVersion, first.catalogVersion); assert.equal(oldSearch.catalogVersion, first.catalogVersion);
      assert.ok(oldSearch.items.length);
    } finally { clearTimeout(responsivenessTimer); gate.resolve(); }
    const updated = await read('wait'); timings.updateMs = Math.round(performance.now() - started);
    assert.notEqual(updated.catalogVersion, first.catalogVersion); assert.equal(updated.featureSync.status, 'ready');
    assert.ok(requests.filter(value => value.scenario === 'updated' && /^(EffectPlayer|BgmPlayer)\//.test(value.relative)).every(value => value.status === 304), 'Unchanged real project files must use their matching OSS ETags');
    const heldAfter = await read('held');
    assert.equal(heldAfter.catalogVersion, heldBefore.catalogVersion); assert.deepEqual(heldAfter.featureSync.hashes, heldBefore.featureSync.hashes);
    assert.doesNotMatch(heldAfter.items[0].description, /NATIVE_INDEX_REPLACEMENT_MARKER/);
    assert.match((await read('assets')).items[0].description, /NATIVE_INDEX_REPLACEMENT_MARKER/);
    const changedQuery = await read('search', { query: 'NATIVE_INDEX_REPLACEMENT_MARKER', scope: 'sound' });
    assert.ok(changedQuery.items.some(value => value.resourceId === 'sound:' + soundId));
    const expired = await dispatch('search', { query: '雷声', scope: 'sound', limit: 1, cursor: page.nextCursor });
    assert.equal(expired.status, 409); assert.equal((await expired.json()).error.code, 'CATALOG_VERSION_MISMATCH');
    await sample('updated:old-pin-plus-new-catalog-and-sqlite');
    await read('release');
    scenario = 'same-content'; marker = 'native-release-3';
    started = performance.now(); await read('check'); const same = await read('wait'); timings.sameContent200Ms = Math.round(performance.now() - started);
    assert.equal(same.catalogVersion, updated.catalogVersion); assert.deepEqual(same.featureSync.hashes, updated.featureSync.hashes);
    assert.equal(same.featureSync.updatedAt, updated.featureSync.updatedAt); assert.equal(same.featureSync.status, 'ready');
    const sameFiles = requests.filter(value => value.scenario === 'same-content' && value.relative !== 'AISearch/index.json');
    assert.equal(sameFiles.length, 18); assert.ok(sameFiles.every(value => value.status === 200), 'The runtime must tolerate an OSS server ignoring every conditional header');
    assert.equal((await read('stats')).markerVersion, 'native-release-3');
    await sample('same-content:all-eighteen-200-complete');
    scenario = 'failure'; marker = 'native-release-4';
    await read('check'); const stale = await read('wait');
    assert.equal(stale.catalogVersion, updated.catalogVersion); assert.equal(stale.featureSync.status, 'stale');
    assert.deepEqual(stale.featureSync.hashes, updated.featureSync.hashes);
    assert.equal((await read('stats')).markerVersion, 'native-release-3', 'A failed replacement never commits its marker to SQLite');
    const beforeFailureRestore = requests.length;
    assert.equal((await read('reset')).catalogVersion, updated.catalogVersion);
    assert.equal(requests.length, beforeFailureRestore, 'Last successful SQLite snapshot survives a failed refresh');
    for (const request of requests) { assert.equal(request.authorization, null); assert.equal(request.cookie, null); }
    await sample('complete');
    const report = { passed: true, ...summary(), requests, heapSamples };
    await writeFile(path.join(runDirectory, 'native-verification.json'), JSON.stringify(report, null, 2));
    t.diagnostic(JSON.stringify({ passed: true, ...summary(), persisted: stats }));
  } catch (error) {
    const report = { passed: false, ...summary(), scenario, error: { message: error.message, stack: error.stack }, requests, heapSamples };
    await writeFile(path.join(runDirectory, 'native-verification.json'), JSON.stringify(report, null, 2));
    t.diagnostic(JSON.stringify({ passed: false, ...summary(), scenario }));
    throw error;
  } finally { gate?.resolve(); clearInterval(sampleTimer); debug?.close(); await mf.dispose(); }
});
