/* Synthetic fetches, archive storage, and Vue mount/unmount only. No real services or models. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createRenderer, nextTick } = require('vue');
const { createI18n } = require('vue-i18n');
const stateModule = require.resolve('../src/views/AISearch/useAISearch.ts');
const translations = JSON.parse(fs.readFileSync(require.resolve('../src/i18n/locales/aiSearch/en-us.json'), 'utf8'));
const renderer = createRenderer({
  createElement: type => ({ type, children: [] }), createText: text => ({ text }), createComment: text => ({ text }),
  setText: (node, text) => { node.text = text; }, setElementText: (node, text) => { node.text = text; },
  insert: (node, parent) => { parent.children.push(node); }, remove: () => {}, patchProp: () => {}, parentNode: () => null, nextSibling: () => null,
});
const activeMounts = new Set();
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
class MemoryStorage {
  constructor(mode = 'basic', readGate) {
    this.files = new Map([['/archive.json', JSON.stringify({ version: 1, conversations: [{ id: 'fixture', title: 'fixture', updatedAt: 1, contextStart: 0, messages: [] }], activeConversationId: 'fixture', selectedMode: mode, resultLimit: 10 })]]);
    this.readGate = readGate;
  }
  setProject() { return this; }
  async exists(path) { return this.files.has(path); }
  async mkdir() {}
  async readFile(path) { if (this.readGate) await this.readGate; return this.files.get(path); }
  async writeFile(path, source) { this.files.set(path, source); }
}
function freshModule() { delete require.cache[stateModule]; return require(stateModule).useAISearch; }
function mount(useAISearch, storage = new MemoryStorage()) {
  let state;
  const app = renderer.createApp({ setup() { state = useAISearch(); return () => null; } });
  app.provide('storage', storage);
  app.use(createI18n({ legacy: false, flatJson: true, locale: 'en-US', messages: { 'en-US': translations } }));
  app.mount({ children: [] });
  const instance = { state, unmount() { if (activeMounts.delete(instance)) app.unmount(); } };
  activeMounts.add(instance);
  return instance;
}
async function waitUntil(condition, label) {
  for (let round = 0; round < 250; round++) { await nextTick(); if (condition()) return; await new Promise(resolve => setImmediate(resolve)); }
  throw new Error(`State did not settle: ${label}`);
}
const ready = instance => !instance.state.loadingCatalog.value && !instance.state.loadingArchive.value && instance.state.freeStatus.value !== 'checking';
const metadata = (catalogVersion, total) => ({ available: true, catalogVersion, mode: 'keyword', total, counts: { total, sound: total, effect: 0, bgm: 0 }, coverage: 1 });
const configured = (info, remaining = 5) => ({ configured: true, available: true, model: 'fixture-model', retrieval: info, agent: { available: true }, quota: { remaining, limit: 5, resetAt: '2026-10-11T00:00:00+08:00' } });
const originalFetch = global.fetch, originalNow = Date.now;
const originalLocalStorage = global.localStorage, originalSessionStorage = global.sessionStorage;
const browserFiles = new Map();
global.localStorage = { getItem: key => browserFiles.get(key) ?? null, setItem: (key, value) => browserFiles.set(key, value), removeItem: key => browserFiles.delete(key) };
global.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

async function serverCacheScenario() {
  const useAISearch = freshModule(), archiveGate = deferred();
  let configCalls = 0, catalogCalls = 0, chatCalls = 0, nextConfig = configured(metadata('server-v1', 3));
  let nextCatalog = metadata('server-v2', 4), configGate;
  global.fetch = async url => {
    const path = String(url).split('?')[0];
    if (path.endsWith('/AISearch/index.json')) return Response.json({ data: 'release-fixture' });
    if (path.endsWith('/config')) { configCalls++; return configGate ? configGate.promise : Response.json(nextConfig); }
    if (path.endsWith('/catalog')) { catalogCalls++; return Response.json(nextCatalog); }
    if (path.endsWith('/chat')) { chatCalls++; throw new Error('A cache test must never reach a model request'); }
    throw new Error(`Unexpected network route: ${url}`);
  };
  const storage = new MemoryStorage('free', archiveGate.promise);
  const first = mount(useAISearch, storage);
  await waitUntil(() => configCalls === 1, 'configuration begins while archive restoration is pending');
  assert.equal(first.state.loadingArchive.value, true, 'Reading the archive does not serialize the public configuration request');
  archiveGate.resolve();
  await waitUntil(() => ready(first), 'first server mount');
  assert.equal(first.state.catalogCount.value, 3);
  assert.equal(first.state.serverRetrieval.value, true);
  assert.equal(first.state.freeQuota.value.remaining, 5);
  assert.equal(catalogCalls, 0, 'Complete metadata in /config avoids a redundant startup /catalog request');
  first.unmount();

  configGate = deferred();
  const second = mount(useAISearch, storage);
  assert.equal(second.state.loadingCatalog.value, false, 'A repeat visit hydrates directory readiness synchronously');
  assert.equal(second.state.catalogCount.value, 3);
  assert.equal(second.state.freeAvailable.value, false, 'Directory caching never restores payment availability from an older visit');
  await waitUntil(() => !second.state.loadingArchive.value && configCalls === 2, 'second config remains pending');
  await second.state.send('fixture search while entitlement is unknown');
  assert.equal(chatCalls, 0, 'A pending new status check cannot authorize a free model request');
  configGate.resolve(Response.json(configured(metadata('server-v1', 3), 1)));
  await waitUntil(() => ready(second), 'second server mount');
  assert.equal(second.state.freeAvailable.value, true);
  assert.equal(second.state.freeQuota.value.remaining, 1, 'Every visit uses the newly checked free quota');
  assert.equal(configCalls, 2); assert.equal(catalogCalls, 0);

  await second.state.reloadCatalog();
  assert.equal(catalogCalls, 1, 'Explicit reload bypasses the cached directory');
  assert.equal(second.state.catalogCount.value, 4);
  second.unmount();

  configGate = undefined;
  nextConfig = configured(metadata('server-v3', 7), 0);
  const third = mount(useAISearch, storage);
  assert.equal(third.state.catalogCount.value, 4, 'Reloaded metadata is the next visit’s initial snapshot');
  await waitUntil(() => ready(third), 'new catalogue version');
  assert.equal(third.state.catalogCount.value, 7, 'A changed version from config replaces the cached directory');
  assert.equal(third.state.freeQuota.value.remaining, 0);
  await third.state.send('fixture quota exhausted');
  assert.equal(chatCalls, 0, 'A freshly exhausted quota is enforced despite cached assets');
  assert.equal(catalogCalls, 1, 'New complete config metadata still avoids duplicate catalogue loading');
  third.unmount();

  configGate = deferred();
  const failedCheck = mount(useAISearch, storage);
  assert.equal(failedCheck.state.catalogCount.value, 7);
  assert.equal(failedCheck.state.freeAvailable.value, false);
  await waitUntil(() => !failedCheck.state.loadingArchive.value && configCalls === 4, 'failed check pending');
  configGate.reject(new Error('synthetic config outage'));
  await waitUntil(() => failedCheck.state.freeStatus.value !== 'checking', 'failed configuration request');
  assert.equal(failedCheck.state.freeAvailable.value, false, 'A failed fresh check never reopens a cached free entitlement');
  await failedCheck.state.send('fixture search after failed check');
  assert.equal(chatCalls, 0);
  failedCheck.unmount();
}

function isWholeLibraryFile(path) {
  return /\/(?:SoundEffectPlayer|EffectPlayer|BgmPlayer)\/(?:data\.json|features\.json|i18n\/)/u.test(path);
}
async function metadataCompatibilityScenario() {
  const useAISearch = freshModule();
  let configCalls = 0, catalogCalls = 0, libraryCalls = 0;
  global.fetch = async url => {
    const path = new URL(String(url), 'https://fixture.invalid').pathname;
    if (isWholeLibraryFile(path)) { libraryCalls++; throw new Error('Browser must not download any whole asset library'); }
    if (path.endsWith('/AISearch/index.json')) return Response.json({ data: 'release-worker-only' });
    if (path.endsWith('/config')) { configCalls++; return Response.json({ configured: false, available: false, retrieval: { available: true } }); }
    if (path.endsWith('/catalog')) { catalogCalls++; return Response.json(metadata('legacy-config-v1', 3)); }
    throw new Error(`Unexpected compatibility request: ${url}`);
  };
  const page = mount(useAISearch);
  await waitUntil(() => ready(page), 'older config with available retrieval but no embedded metadata');
  assert.equal(configCalls, 1); assert.equal(catalogCalls, 1);
  assert.equal(page.state.serverRetrieval.value, true); assert.equal(page.state.catalogCount.value, 3);
  assert.equal(page.state.catalogError.value, false); assert.equal(libraryCalls, 0);
  page.unmount();
}
async function workerFailureScenario() {
  for (const configFails of [false, true]) {
    const useAISearch = freshModule();
    let configCalls = 0, catalogCalls = 0, libraryCalls = 0, chatCalls = 0;
    global.fetch = async url => {
      const path = new URL(String(url), 'https://fixture.invalid').pathname;
      if (isWholeLibraryFile(path)) { libraryCalls++; throw new Error('A failed Worker must not cause OSS catalogue fallback'); }
      if (path.endsWith('/AISearch/index.json')) return Response.json({ data: 'release-worker-only' });
      if (path.endsWith('/config')) { configCalls++; if (configFails) throw new Error('synthetic config outage'); return Response.json({ configured: false, available: false }); }
      if (path.endsWith('/catalog')) { catalogCalls++; return Response.json({ error: { code: 'SEARCH_UNAVAILABLE' } }, { status: 503 }); }
      if (path.endsWith('/chat') || path.endsWith('/chat/completions')) { chatCalls++; throw new Error('A failed service cannot authorize a model request'); }
      throw new Error(`Unexpected failure request: ${url}`);
    };
    const page = mount(useAISearch, new MemoryStorage('free'));
    await waitUntil(() => ready(page), `failed catalogue, config ${configFails ? 'failed' : 'without retrieval'}`);
    assert.equal(configCalls, 1); assert.equal(catalogCalls, 1);
    assert.equal(page.state.catalogError.value, true, 'Missing Worker catalogue produces an explicit retrieval error');
    assert.ok(page.state.catalogErrorMessage.value);
    assert.equal(page.state.catalogCount.value, 0); assert.equal(page.state.freeAvailable.value, false);
    await page.state.send('fixture after service failure');
    assert.equal(chatCalls, 0); assert.equal(libraryCalls, 0, 'All asset data, features and language dictionaries remain on the Worker');
    page.unmount();
  }
}
async function configFailureWithHealthyCatalogScenario() {
  const useAISearch = freshModule();
  let configCalls = 0, catalogCalls = 0, libraryCalls = 0, searches = 0, modelCalls = 0, freeChatCalls = 0;
  const asset = { resourceId: 'sound:1', kind: 'sound', title: 'fixture sound', description: 'short rumble', keywords: ['rumble'], hasAudio: true };
  global.fetch = async (url, input) => {
    const path = new URL(String(url), 'https://fixture.invalid').pathname;
    if (isWholeLibraryFile(path)) { libraryCalls++; throw new Error('Even config outages must keep library retrieval inside the Worker'); }
    if (path.endsWith('/AISearch/index.json')) return Response.json({ data: 'release-worker-only' });
    if (path.endsWith('/AISearch/SystemPrompt.md')) return new Response('# Fixture prompt\nReturn at most RESULT_LIMIT resources.\n');
    if (path.endsWith('/config')) { configCalls++; throw new Error('synthetic config outage'); }
    if (path.endsWith('/catalog')) { catalogCalls++; return Response.json(metadata('healthy-catalog-v1', 1)); }
    if (path.endsWith('/search')) { searches++; return Response.json({ ...metadata('healthy-catalog-v1', 1), hasMore: false, items: [asset] }); }
    if (path.endsWith('/assets')) return Response.json({ catalogVersion: 'healthy-catalog-v1', items: [asset], missingIds: [] });
    if (path.endsWith('/chat/completions')) {
      modelCalls++;
      assert.equal(new URL(String(url)).hostname, 'fixture-chat.invalid', 'Custom model requests stay on the configured mock endpoint');
      if (modelCalls === 1) return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'fixture-tool', type: 'function', function: { name: 'search_assets', arguments: '{"query":"rumble","scope":"sound"}' } }] } }] });
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answer: 'found', matches: [{ resourceId: asset.resourceId, reason: 'observed rumble', matchType: 'feature' }] }) } }] });
    }
    if (path.endsWith('/chat')) { freeChatCalls++; throw new Error('Config failure must keep the website model disabled'); }
    throw new Error(`Unexpected healthy-catalog request: ${url}`);
  };
  const page = mount(useAISearch);
  await waitUntil(() => ready(page), 'config failure with a working catalogue endpoint');
  assert.equal(configCalls, 1); assert.equal(catalogCalls, 1);
  assert.equal(page.state.catalogError.value, false); assert.equal(page.state.catalogCount.value, 1);
  assert.equal(page.state.freeAvailable.value, false);
  page.state.mode.value = 'basic';
  await page.state.send('rumble');
  assert.equal(page.state.messages.value.at(-1).status, 'complete');
  assert.equal(page.state.messages.value.at(-1).cards[0].resourceId, 'sound:1', 'Working Worker retrieval remains usable without free-model configuration');
  assert.equal(modelCalls, 0);
  assert.equal(page.state.saveConfig({ baseUrl: 'https://fixture-chat.invalid/v1', model: 'fixture-model', apiKey: 'mock-key-only', rememberKey: false }), true);
  await page.state.send('another rumble');
  assert.equal(page.state.messages.value.at(-1).status, 'complete');
  assert.equal(modelCalls, 2, 'A self-configured model can call the healthy Worker tools even when the free-status endpoint fails');
  assert.equal(searches, 2); assert.equal(freeChatCalls, 0); assert.equal(libraryCalls, 0);
  page.unmount();
}
(async () => {
  try {
    await serverCacheScenario();
    await metadataCompatibilityScenario();
    await workerFailureScenario();
    await configFailureWithHealthyCatalogScenario();
    console.log('PASS Worker-only AI catalogue cache: config metadata, parallel archive/config, repeat-visit readiness, fresh quotas, explicit/version refresh, legacy metadata compatibility, no OSS fallback on failure, and basic/custom tools with healthy catalogue');
  } finally {
    for (const instance of [...activeMounts]) instance.unmount();
    global.fetch = originalFetch; Date.now = originalNow;
    if (originalLocalStorage === undefined) delete global.localStorage; else global.localStorage = originalLocalStorage;
    if (originalSessionStorage === undefined) delete global.sessionStorage; else global.sessionStorage = originalSessionStorage;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
