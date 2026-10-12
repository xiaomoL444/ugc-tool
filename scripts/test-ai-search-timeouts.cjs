/* Fake-clock search lifecycle regression. No network, paid models, or generated files. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createRenderer, nextTick } = require('vue');
const { createI18n } = require('vue-i18n');
const { responsesFixture } = require('../tools/ai-search-service/responses-fixture.mjs');
const { buildAgentSearchPayload, requestAgentSearch } = require('../src/views/AISearch/agentSearchService.ts');
const { useAISearch, restoreConversations } = require('../src/views/AISearch/useAISearch.ts');
const { serializeAISearchArchive } = require('../src/views/AISearch/archiveStorage.ts');

const version = 'timeout-fixture-v1';
const config = { baseUrl: 'https://fixture.invalid/v1', model: 'fixture-model', apiKey: 'fixture-local-key-only', rememberKey: false };
const summary = { resourceId: 'sound:123', id: '123', kind: 'sound', title: 'Trusted short sound', description: 'A short metallic attack.',
  keywords: ['metallic'], suggestedUses: ['confirmation'], hasAudio: true, duration: 0.4 };
const enriched = { ...summary, title: 'Trusted full details', duration: 0.45 };
const second = { ...summary, resourceId: 'sound:124', id: '124', title: 'Another trusted short sound' };
const answer = 'Keep this complete verified model answer even when the asset detail request cannot finish.';
const finalValue = (ids = [summary.resourceId]) => ({ answer, matches: ids.map(resourceId => ({ resourceId, reason: 'Observed short metallic sound', matchType: 'feature' })) });
const modelResponse = value => Response.json(responsesFixture({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
const toolResponse = (name, args, id = 'timeout-search') => Response.json(responsesFixture({ choices: [{ finish_reason: 'tool_calls', message: {
  content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
} }] }));
const toolsResponse = calls => Response.json(responsesFixture({ choices: [{ finish_reason: 'tool_calls', message: {
  content: null, tool_calls: calls.map(({ name, args, id }) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })),
} }] }));
const searchResponse = (items = [summary]) => Response.json({ catalogVersion: version, mode: 'keyword', total: items.length, items, hasMore: false });
const assetResponse = (items = [enriched]) => Response.json({ catalogVersion: version, items, missingIds: [] });
const endpointOf = url => String(url).split('?')[0].split('/').pop();
const promptResponse = () => new Response('# Timeout fixture\nReturn at most RESULT_LIMIT resources.', { headers: { 'Content-Type': 'text/markdown' } });
const deferred = () => { let resolve, reject; const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; }); return { promise, resolve, reject }; };
async function flush() { await nextTick(); await new Promise(resolve => setImmediate(resolve)); await nextTick(); }
async function waitUntil(condition) {
  for (let round = 0; round < 160; round++) { await flush(); if (condition()) return; }
  throw new Error('Mock search state did not settle');
}

class FakeClock {
  constructor() { this.now = 0; this.sequence = 0; this.timers = new Map(); this.original = { setTimeout, clearTimeout, now: Date.now }; }
  install() {
    global.setTimeout = (callback, delay = 0, ...args) => { const id = ++this.sequence; this.timers.set(id, { at: this.now + Math.max(0, Number(delay) || 0), callback, args }); return id; };
    global.clearTimeout = id => this.timers.delete(id);
    Date.now = () => 1800000000000 + this.now;
  }
  async advance(milliseconds) {
    const target = this.now + milliseconds;
    for (;;) {
      const next = [...this.timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      this.now = next[1].at; this.timers.delete(next[0]); next[1].callback(...next[1].args); await flush();
    }
    this.now = target; await flush();
  }
  restore() { global.setTimeout = this.original.setTimeout; global.clearTimeout = this.original.clearTimeout; Date.now = this.original.now; }
}
class MemoryStorage {
  constructor() { this.files = new Map(); }
  setProject() { return this; }
  async exists(path) { return this.files.has(path); }
  async mkdir() {}
  async readFile(path) { return this.files.get(path); }
  async writeFile(path, source) { this.files.set(path, source); }
}
const renderer = createRenderer({
  createElement: type => ({ type, children: [] }), createText: text => ({ text }), createComment: text => ({ text }),
  setText: (node, text) => { node.text = text; }, setElementText: (node, text) => { node.text = text; },
  insert: (node, parent) => { parent.children.push(node); }, remove: () => {}, patchProp: () => {}, parentNode: () => null, nextSibling: () => null,
});
async function mountSearch(route) {
  let state;
  const counts = { model: 0, search: 0, assets: 0, catalog: 0 };
  global.fetch = async (url, input = {}) => {
    const endpoint = endpointOf(url);
    if (endpoint === 'index.json') return Response.json({ data: version });
    if (endpoint === 'SystemPrompt.md') return promptResponse();
    if (endpoint === 'config') return Response.json({ configured: true, available: true, model: 'fixture', retrieval: { available: true },
      agent: { available: true }, limits: { maxResults: 20 }, quota: { remaining: 5, limit: 5, resetAt: 'fixture' } });
    if (endpoint === 'catalog') { counts.catalog++; return Response.json({ catalogVersion: version, total: 2, mode: 'keyword' }); }
    if (endpoint === 'responses') counts.model++;
    if (endpoint === 'search') counts.search++;
    if (endpoint === 'assets') counts.assets++;
    assert.equal(input.headers?.Authorization, endpoint === 'responses' ? `Bearer ${config.apiKey}` : undefined, 'Only the model receives the BYOK credential');
    return route(endpoint, input, counts);
  };
  const app = renderer.createApp({ setup() { state = useAISearch(); return () => null; } });
  const storage = new MemoryStorage(); app.provide('storage', storage);
  const localized = JSON.parse(fs.readFileSync(require.resolve('../src/i18n/locales/aiSearch/en-us.json'), 'utf8'));
  app.use(createI18n({ legacy: false, flatJson: true, locale: 'en-US', messages: { 'en-US': localized } }));
  app.mount({ children: [] });
  await waitUntil(() => !state.loadingCatalog.value && !state.loadingArchive.value);
  state.mode.value = 'custom'; state.modelConfig.value = { ...config };
  let mounted = true;
  return { state, counts, storage, unmount() { if (mounted) { mounted = false; app.unmount(); } } };
}
function verifiedReply(state) {
  const reply = state.messages.value.at(-1);
  assert.equal(reply.content, answer);
  assert.equal(reply.cards.length, 1);
  assert.equal(reply.cards[0].resourceId, summary.resourceId);
  assert.equal(reply.cards[0].href, '/SoundEffectPlayer?id=123');
  return reply;
}
function runSearch(state) {
  const running = state.send('short metallic sound');
  void running.catch(() => {}); // The scenario inspects state before awaiting completion.
  return running;
}
function standardRoute(endpoint, input, counts) {
  if (endpoint === 'responses') return counts.model === 1 ? toolResponse('search_assets', { query: 'short metallic', scope: 'sound' }) : modelResponse(finalValue());
  if (endpoint === 'search') return searchResponse();
  throw new Error(`Unhandled fixture route ${endpoint}`);
}

(async () => {
  // The service returns only validated same-version evidence before UI hydration.
  for (const hydrateFinalAssets of [false, true]) {
    let models = 0; const assetBodies = [];
    const result = await requestAgentSearch(buildAgentSearchPayload('short metallic sound', 'en-US', 'sound', [], true, 'timeout-service'), {
      mode: 'custom', config, freeBase: '/api/ai-search', signal: new AbortController().signal, hydrateFinalAssets,
      fetcher: async (url, input) => {
        const endpoint = endpointOf(url);
        if (endpoint === 'SystemPrompt.md') return promptResponse();
        if (endpoint === 'responses') {
          if (++models === 1) return toolResponse('search_assets', { query: 'short metallic', scope: 'sound' });
          if (models === 2) return toolResponse('get_assets', { ids: [summary.resourceId] }, 'timeout-details');
          return modelResponse(finalValue([summary.resourceId, second.resourceId]));
        }
        if (endpoint === 'search') return searchResponse([summary, second]);
        assert.equal(endpoint, 'assets'); const ids = JSON.parse(input.body).ids; assetBodies.push(ids);
        return assetResponse(ids.map(id => id === summary.resourceId ? enriched : { ...second, title: 'Second full details' }));
      },
    });
    assert.equal(models, 3, 'Detail hydration never repeats the paid model');
    assert.equal(result.resources.find(item => item.resourceId === summary.resourceId).title, enriched.title);
    assert.deepEqual(assetBodies[0], [summary.resourceId]);
    if (!hydrateFinalAssets) {
      assert.equal(assetBodies.length, 1, 'Deferred final hydration avoids the redundant final asset request');
      assert.deepEqual(result.pendingAssetIds, [second.resourceId], 'Only resources lacking full details need UI hydration');
      assert.equal(result.resources.find(item => item.resourceId === second.resourceId).title, second.title);
    } else {
      assert.equal(assetBodies.length, 2); assert.deepEqual(assetBodies[1], [second.resourceId], 'Full get_assets evidence is reused by the final request');
    }
  }
  // The same identity may be rediscovered through a different evidence facet.
  for (const firstAudio of [false, true]) for (const hydrateFinalAssets of [false, true]) {
    const effectId = 'effect:321';
    const visual = { ...summary, resourceId: effectId, id: '321', kind: 'effect', title: 'Trusted visual ring',
      description: 'A blue ring expands.', visualDescription: 'A blue ring expands.', keywords: ['blue', 'ring'], audioMatch: false };
    const audio = { ...visual, title: 'Trusted ring sound', description: 'A brief bright bell.', keywords: ['bell'], audioMatch: true,
      audioDescription: 'A brief bright bell.', audioKeywords: ['bell'], audioSuggestedUses: ['confirmation'] };
    const full = { ...visual, title: 'Trusted full ring details', description: 'A blue ring expands in full detail.', visualDescription: 'A blue ring expands in full detail.',
      audioDescription: 'A brief bright bell in full detail.', audioKeywords: ['bell', 'brief'], audioSuggestedUses: ['confirmation'] };
    const lastAudio = !firstAudio; let models = 0, assetReads = 0; const facets = [];
    const result = await requestAgentSearch(buildAgentSearchPayload('Explore this effect and its sound', 'en-US', 'effect', [], true, 'timeout-facet-switch'), {
      mode: 'custom', config, freeBase: '/api/ai-search', signal: new AbortController().signal, hydrateFinalAssets,
      fetcher: async (url, input) => {
        const endpoint = endpointOf(url);
        if (endpoint === 'SystemPrompt.md') return promptResponse();
        if (endpoint === 'responses') {
          if (++models === 1) return toolResponse('search_assets', { query: 'ring feature', scope: 'effect', matchOn: firstAudio ? 'audio' : 'visual' }, 'facet-first');
          if (models === 2) return toolsResponse([
            { name: 'get_assets', args: { ids: [effectId] }, id: 'facet-details' },
            { name: 'search_assets', args: { query: 'other ring feature', scope: 'effect', matchOn: lastAudio ? 'audio' : 'visual' }, id: 'facet-last' },
          ]);
          return modelResponse(finalValue([effectId]));
        }
        if (endpoint === 'search') { const facet = JSON.parse(input.body).matchOn; facets.push(facet); return searchResponse([facet === 'audio' ? audio : visual]); }
        assert.equal(endpoint, 'assets'); assetReads++; return assetResponse([full]);
      },
    });
    assert.deepEqual(facets, [firstAudio ? 'audio' : 'visual', lastAudio ? 'audio' : 'visual']);
    assert.equal(result.resources[0].audioMatch, lastAudio, 'Cached details cannot overwrite the latest visual/audio evidence projection');
    assert.equal(result.resources[0].description, hydrateFinalAssets
      ? lastAudio ? full.audioDescription : full.description : lastAudio ? audio.description : visual.description);
    assert.equal(models, 3);
    if (hydrateFinalAssets) assert.equal(assetReads, 2, 'Changed evidence projection is hydrated again with the latest audio facet');
    else {
      assert.equal(assetReads, 1); assert.deepEqual(result.pendingAssetIds, [effectId], 'The old projected detail cache does not mark the new facet fully hydrated');
    }
  }
  let invalidCalls = 0, invalidAssetReads = 0;
  await assert.rejects(() => requestAgentSearch(buildAgentSearchPayload('short metallic sound', 'en-US', 'sound', [], true, 'timeout-invalid'), {
    mode: 'custom', config, freeBase: '/api/ai-search', signal: new AbortController().signal, hydrateFinalAssets: false,
    fetcher: async (url) => {
      const endpoint = endpointOf(url);
      if (endpoint === 'SystemPrompt.md') return promptResponse();
      if (endpoint === 'search') return searchResponse();
      if (endpoint === 'assets') { invalidAssetReads++; throw new Error('Unverified IDs cannot be hydrated'); }
      return ++invalidCalls === 1 ? toolResponse('search_assets', { query: 'short metallic', scope: 'sound' }) : modelResponse(finalValue(['sound:999']));
    },
  }), error => error.code === 'RESPONSE_ASSET_ID');
  assert.equal(invalidAssetReads, 0);

  const originals = { fetch: global.fetch, localStorage: global.localStorage, sessionStorage: global.sessionStorage };
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  global.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const clock = new FakeClock(); clock.install();
  try {
    // A model finishing near the 180-second boundary grants details their own full 20 seconds.
    const slowFinal = deferred(), detail = deferred(); let detailSignal;
    const slow = await mountSearch((endpoint, input, counts) => {
      if (endpoint === 'responses' && counts.model === 2) return slowFinal.promise;
      if (endpoint === 'assets') { detailSignal = input.signal; return detail.promise; }
      return standardRoute(endpoint, input, counts);
    });
    try {
      const running = runSearch(slow.state);
      await waitUntil(() => slow.counts.model === 2);
      await clock.advance(60000);
      assert.equal(slow.state.busy.value, true, 'A custom model is allowed to run beyond the former 60-second deadline');
      await clock.advance(119000); slowFinal.resolve(modelResponse(finalValue()));
      await waitUntil(() => slow.counts.assets === 1);
      const reply = verifiedReply(slow.state);
      assert.equal(reply.cards[0].title, summary.title, 'Trusted summary cards display while full metadata is loading');
      await clock.advance(19000);
      assert.equal(detailSignal.aborted, false, 'The expired model phase cannot cancel the new detail phase');
      detail.resolve(assetResponse()); await running;
      assert.equal(reply.status, 'complete'); assert.equal(reply.cards[0].title, enriched.title);
      assert.equal(slow.state.busy.value, false); assert.equal(slow.counts.model, 2);
    } finally { slow.unmount(); }

    // An unresponsive detail fetch is bounded even when it ignores AbortSignal.
    const late = deferred(); let stalledSignal;
    const stalled = await mountSearch((endpoint, input, counts) => {
      if (endpoint === 'assets') { stalledSignal = input.signal; return late.promise; }
      return standardRoute(endpoint, input, counts);
    });
    try {
      const running = runSearch(stalled.state); await waitUntil(() => stalled.counts.assets === 1);
      const reply = verifiedReply(stalled.state); await clock.advance(20000); await running;
      assert.equal(reply.status, 'complete'); assert.notEqual(reply.error, true); assert.equal(reply.cards[0].title, summary.title);
      assert.ok(reply.resultWarning && !reply.resultWarning.startsWith('aiSearch.'), 'Detail failure produces a localized warning beside the retained answer');
      assert.equal(reply.requestDiagnostic.stage, 'assets'); assert.equal(reply.requestDiagnostic.kind, 'timeout');
      assert.equal(reply.requestDiagnostic.abortReason, 'details_timeout'); assert.equal(reply.requestDiagnostic.elapsedMs, 20000);
      assert.equal(reply.requestDiagnostic.totalElapsedMs, 20000); assert.equal(stalledSignal.aborted, true);
      assert.equal(stalled.state.busy.value, false); assert.equal(stalled.counts.model, 2);
      const saved = serializeAISearchArchive({ conversations: stalled.state.conversations.value, activeConversationId: stalled.state.activeConversationId.value, selectedMode: 'custom' });
      const restored = restoreConversations(JSON.parse(saved).conversations)[0].messages.at(-1);
      assert.equal(restored.content, answer); assert.equal(restored.resultWarning, reply.resultWarning);
      assert.equal(restored.requestDiagnostic.abortReason, 'details_timeout', 'Successful retained answers keep their detail warning diagnostics in the archive');
      late.resolve(assetResponse([{ ...enriched, title: 'Late detail must not overwrite summary' }])); await flush();
      assert.equal(reply.cards[0].title, summary.title, 'A response arriving after the detail deadline cannot update the old result');
    } finally { stalled.unmount(); }

    const unavailable = await mountSearch((endpoint, input, counts) => {
      if (endpoint === 'assets') throw new TypeError('Fixture asset network failure');
      return standardRoute(endpoint, input, counts);
    });
    try {
      await unavailable.state.send('short metallic sound'); const reply = verifiedReply(unavailable.state);
      assert.equal(reply.status, 'complete'); assert.ok(reply.resultWarning);
      assert.equal(reply.requestDiagnostic.kind, 'network'); assert.equal(reply.requestDiagnostic.stage, 'assets');
      assert.equal(unavailable.counts.model, 2);
    } finally { unavailable.unmount(); }

    // Final metadata may not silently switch versions under an already selected result.
    const mismatched = await mountSearch((endpoint, input, counts) => endpoint === 'assets'
      ? Response.json({ error: { code: 'CATALOG_VERSION_MISMATCH' } }, { status: 409 }) : standardRoute(endpoint, input, counts));
    try {
      const initialCatalogReads = mismatched.counts.catalog;
      await mismatched.state.send('short metallic sound'); const reply = mismatched.state.messages.value.at(-1);
      assert.equal(reply.status, 'error'); assert.equal(reply.error, true); assert.equal(mismatched.state.canRetrySearch.value, true);
      assert.ok(mismatched.counts.catalog > initialCatalogReads, 'A version conflict refreshes evidence before offering a user retry');
      assert.equal(mismatched.counts.model, 2, 'A version conflict never triggers an automatic paid model retry');
    } finally { mismatched.unmount(); }

    const modelStall = deferred(); let modelSignal;
    const modelTimeout = await mountSearch((endpoint, input, counts) => {
      if (endpoint === 'responses' && counts.model === 2) { modelSignal = input.signal; return modelStall.promise; }
      return standardRoute(endpoint, input, counts);
    });
    try {
      const running = runSearch(modelTimeout.state); await waitUntil(() => modelTimeout.counts.model === 2);
      await clock.advance(180000); await running;
      const reply = modelTimeout.state.messages.value.at(-1);
      assert.equal(reply.status, 'error'); assert.equal(reply.error, true); assert.equal(modelTimeout.state.busy.value, false);
      assert.equal(modelSignal.aborted, true); assert.equal(modelTimeout.counts.assets, 0);
      assert.equal(reply.requestDiagnostic.abortReason, 'search_timeout'); assert.equal(reply.requestDiagnostic.kind, 'timeout');
      assert.equal(reply.requestDiagnostic.totalElapsedMs, 180000); assert.equal(modelTimeout.counts.model, 2);
      modelStall.resolve(modelResponse(finalValue())); await flush();
      assert.equal(reply.cards.length, 0, 'A late model result cannot become a completed answer after timeout');
    } finally { modelTimeout.unmount(); }

    // An unfinished get_assets tool is evidence gathering, before any validated final answer.
    const toolStall = deferred();
    const toolTimeout = await mountSearch((endpoint, input, counts) => {
      if (endpoint === 'responses' && counts.model === 2) return toolResponse('get_assets', { ids: [summary.resourceId] }, 'timeout-unfinished-tool');
      if (endpoint === 'assets') return toolStall.promise;
      return standardRoute(endpoint, input, counts);
    });
    try {
      const running = runSearch(toolTimeout.state); await waitUntil(() => toolTimeout.counts.assets === 1);
      await clock.advance(180000); await running;
      const reply = toolTimeout.state.messages.value.at(-1);
      assert.equal(reply.status, 'error'); assert.equal(reply.error, true); assert.equal(reply.cards.length, 0);
      assert.equal(reply.requestDiagnostic.stage, 'assets'); assert.equal(reply.requestDiagnostic.abortReason, 'search_timeout');
      assert.equal(reply.requestDiagnostic.totalElapsedMs, 180000);
      assert.equal(toolTimeout.counts.model, 2, 'An unfinished evidence tool cannot trigger another paid model round after timeout');
      toolStall.resolve(assetResponse()); await flush();
      assert.equal(reply.status, 'error'); assert.equal(reply.cards.length, 0);
    } finally { toolTimeout.unmount(); }

    // HTTP headers may arrive while the provider's error-body stream stays open forever.
    for (const status of [401, 500, 400]) {
      let streamController;
      const httpStall = await mountSearch((endpoint, input) => {
        assert.equal(endpoint, 'responses');
        if (status === 400) assert.equal(JSON.parse(input.body).text?.format?.type, 'json_schema', 'The stalled 400 body exercises automatic schema-format fallback');
        const error = status === 400 ? { code: 'unsupported_parameter', message: 'json_schema is not supported' }
          : { code: `fixture_http_${status}`, message: 'Fixture provider error body never ends' };
        return new Response(new ReadableStream({ start(controller) {
          streamController = controller; controller.enqueue(new TextEncoder().encode(JSON.stringify({ error })));
        } }), { status, headers: { 'Content-Type': 'application/json', 'x-request-id': `stalled-http-${status}` } });
      });
      if (status === 400) httpStall.state.modelConfig.value = { ...config, model: 'gpt-4.1-nano' };
      try {
        const running = runSearch(httpStall.state); await waitUntil(() => httpStall.counts.model === 1); await flush();
        await clock.advance(180000); await running;
        const reply = httpStall.state.messages.value.at(-1);
        assert.equal(reply.status, 'error'); assert.equal(reply.error, true); assert.equal(httpStall.state.busy.value, false);
        assert.equal(reply.requestDiagnostic.stage, 'model'); assert.equal(reply.requestDiagnostic.kind, 'timeout');
        assert.equal(reply.requestDiagnostic.abortReason, 'search_timeout'); assert.equal(reply.requestDiagnostic.round, 1);
        assert.equal(reply.requestDiagnostic.status, status, 'Timing out a stalled HTTP error body retains its received status');
        assert.equal(reply.requestDiagnostic.requestId, `stalled-http-${status}`);
        assert.equal(reply.requestDiagnostic.totalElapsedMs, 180000); assert.equal(reply.cards.length, 0);
        assert.equal(httpStall.counts.model, 1, 'An unclosed rejection body cannot retry the paid model or leave format fallback waiting forever');
      } finally {
        httpStall.unmount(); try { streamController?.close(); } catch { /* The deadline may already cancel the fixture body. */ }
        await flush();
      }
    }

    for (const action of ['stop', 'switch', 'unmount']) {
      const cancelledDetail = deferred(); let cancelledSignal;
      const fixture = await mountSearch((endpoint, input, counts) => {
        if (endpoint === 'assets') { cancelledSignal = input.signal; return cancelledDetail.promise; }
        return standardRoute(endpoint, input, counts);
      });
      try {
        const running = runSearch(fixture.state); await waitUntil(() => fixture.counts.assets === 1);
        const reply = verifiedReply(fixture.state);
        if (action === 'stop') fixture.state.stop();
        if (action === 'switch') fixture.state.createConversation();
        if (action === 'unmount') fixture.unmount();
        await running;
        assert.equal(reply.status, 'canceled', `${action} explicitly cancels ongoing detail hydration`);
        assert.equal(reply.content, answer, `${action} retains the already validated answer`);
        assert.equal(cancelledSignal.aborted, true); assert.equal(fixture.state.busy.value, false);
        const before = JSON.stringify(reply);
        cancelledDetail.resolve(assetResponse()); await flush();
        assert.equal(JSON.stringify(reply), before, `${action} prevents a late detail request from mutating the canceled reply`);
        assert.equal(fixture.counts.model, 2);
      } finally { fixture.unmount(); }
    }
    assert.equal(clock.timers.size, 0, 'Completing or leaving a search clears all phase deadlines');
  } finally {
    clock.restore(); global.fetch = originals.fetch; global.localStorage = originals.localStorage; global.sessionStorage = originals.sessionStorage;
  }
  console.log('PASS AI search deadlines: validated summary return, facet-safe cached details, 180-second custom phase, independent 20-second hydration, bounded unresponsive fetches and HTTP error bodies, retained answers and diagnostics, version rejection, cancellation, and ignored late responses');
})().catch(error => { console.error(error); process.exitCode = 1; });
