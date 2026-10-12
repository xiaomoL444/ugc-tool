const { responsesFixture, responsesMessages } = require('../tools/ai-search-service/responses-fixture.mjs');
/* Mock-only recovery of readable model results. No network, model fees, or files produced. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createRenderer, nextTick } = require('vue');
const { createI18n } = require('vue-i18n');
const { AISearchError, buildSearchPayload, requestSearch, requestServerAssets, requestServerDisplayAssets } = require('../src/views/AISearch/aiSearchService.ts');
const { buildAgentSearchPayload, requestAgentSearch } = require('../src/views/AISearch/agentSearchService.ts');
const { recoverResultDisplay } = require('../src/views/AISearch/resultDisplay.ts');
const { createPreviewMediaLoader } = require('../src/views/AISearch/previewMedia.ts');
const { serializeAISearchArchive, AISearchArchiveRepository } = require('../src/views/AISearch/archiveStorage.ts');
const { restoreConversations, useAISearch } = require('../src/views/AISearch/useAISearch.ts');

const version = 'partial-results-fixture-v1';
const config = { baseUrl: 'https://fixture.invalid/v1', model: 'fixture-model', apiKey: 'fixture-local-key-only', rememberKey: false };
const options = { mode: 'custom', config, freeBase: '/api/ai-search', signal: new AbortController().signal };
const resourceIds = ['effect:10004137', 'effect:10001173', 'effect:10004005', 'sound:50514', 'sound:50586', 'sound:50583',
  'sound:50545', 'sound:50934', 'sound:50931', 'sound:50933', 'effect:10010092', 'effect:10017232'];
const resources = resourceIds.map((resourceId, index) => {
  const [kind, id] = resourceId.split(':');
  const audioMatch = kind === 'effect';
  return { resourceId, id, kind, title: `Trusted sound ${index}`, description: `Observed short metallic sound ${index}`,
    keywords: ['short', 'metallic'], suggestedUses: ['item feedback'], duration: index + 0.25, hasAudio: true,
    href: `/${kind === 'effect' ? 'EffectPlayer' : 'SoundEffectPlayer'}?id=${id}`, audioMatch,
    ...(audioMatch ? { audioDescription: `Observed short metallic sound ${index}`, audioKeywords: ['short', 'metallic'],
      audioSuggestedUses: ['item feedback'], visualDescription: 'Trusted visual evidence' } : {}),
    locale: 'en-US', featureText: '', audioText: '', suggestionText: '' };
});
const unresolvedId = 'sound:10128';
const malformedId = 'sound:not-a-number';
const answer = 'Release sounds are followed by insufficient-item feedback. Keep the full answer, including this final sentence.';
const mixed = { answer, matches: [...resourceIds, unresolvedId, resourceIds[3], malformedId].map((resourceId, index) => ({
  resourceId, reason: `Original model reason ${index}`, matchType: index % 2 ? 'suggestion' : 'feature',
})) };
const rawResponse = JSON.stringify(mixed);
const modelResponse = content => Response.json(responsesFixture({ choices: [{ finish_reason: 'stop', message: { content } }] }));
const searchResponse = items => Response.json({ catalogVersion: version, mode: 'keyword', total: items.length, items, hasMore: false });
const assetResponse = (items, missingIds = []) => Response.json({ catalogVersion: version, items, missingIds });
const promptResponse = () => new Response('# Fixture prompt\nReturn at most RESULT_LIMIT resources.', { headers: { 'Content-Type': 'text/markdown' } });
const endpointOf = url => String(url).split('?')[0].split('/').pop();

function assertPlaceholder(card, resourceId, reason) {
  assert.equal(card.resourceId, resourceId);
  assert.equal(card.id, resourceId, 'An unresolved ID remains exactly copyable, including its prefix');
  assert.equal(card.unresolved, true);
  assert.equal(card.title, '');
  assert.equal(card.description, '');
  assert.equal(card.href, '', 'An unverified model ID never creates a resource link');
  assert.deepEqual(card.keywords, []);
  assert.deepEqual(card.suggestedUses, []);
  assert.equal(card.matchReason, reason);
}
function assertMixedDisplay(display) {
  assert.ok(display);
  assert.equal(display.answer, answer);
  assert.deepEqual(display.cards.map(card => card.resourceId), mixed.matches.map(match => match.resourceId), 'Order and duplicates are preserved');
  assert.equal(display.cards.length, 15);
  for (let index = 0; index < resources.length; index++) {
    const card = display.cards[index], trusted = resources[index];
    assert.equal(card.title, trusted.title);
    assert.equal(card.description, trusted.description);
    assert.equal(card.id, trusted.id);
    assert.equal(card.href, trusted.href);
    assert.equal(card.duration, trusted.duration);
    assert.equal(card.hasAudio, true);
    assert.equal(card.audioMatch, trusted.audioMatch);
    assert.notEqual(card.unresolved, true);
    assert.deepEqual(card.keywords, trusted.keywords);
    assert.equal(card.matchReason, mixed.matches[index].reason);
    assert.equal(card.matchType, mixed.matches[index].matchType);
  }
  assertPlaceholder(display.cards[12], unresolvedId, mixed.matches[12].reason);
  assert.equal(display.cards[13].title, resources[3].title);
  assert.equal(display.cards[13].matchReason, mixed.matches[13].reason, 'A repeated card retains its own model explanation');
  assertPlaceholder(display.cards[14], malformedId, mixed.matches[14].reason);
}
async function captureError(action, expectedCode = 'RESPONSE_ASSET_ID') {
  let captured;
  await assert.rejects(action, error => {
    assert.ok(error instanceof AISearchError);
    assert.equal(error.code, expectedCode);
    assert.equal(error.rawResponse, rawResponse, 'Recovery does not replace or discard the original model response');
    captured = error;
    return true;
  });
  return captured;
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
async function waitUntil(condition) {
  for (let round = 0; round < 150; round++) {
    await nextTick();
    if (condition()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('State did not settle');
}

(async () => {
  assertMixedDisplay(recoverResultDisplay(mixed, resources));
  const noEvidence = recoverResultDisplay(mixed, []);
  assert.equal(noEvidence.answer, answer);
  assert.deepEqual(noEvidence.cards.map(card => card.resourceId), mixed.matches.map(match => match.resourceId));
  noEvidence.cards.forEach((card, index) => assertPlaceholder(card, mixed.matches[index].resourceId, mixed.matches[index].reason));
  for (const invalid of [undefined, null, 1, [], 'unfinished JSON', {}, { answer }, { answer, matches: null },
    { answer: null, matches: mixed.matches }, { answer, matches: [] },
    { answer, matches: [{}] }, { answer, matches: [{ resourceId: true }] },
    { answer, matches: [{ resourceId: NaN }] }, { answer, matches: [{ resourceId: Infinity }] },
    { answer, matches: [{ resourceId: {} }] }]) {
    assert.equal(recoverResultDisplay(invalid, resources), undefined, 'A malformed response cannot invent displayable results');
  }
  const idsOnly = recoverResultDisplay({ answer, matches: [{ resourceId: unresolvedId }, { resourceId: malformedId }] }, []);
  assert.ok(idsOnly);
  assertPlaceholder(idsOnly.cards[0], unresolvedId, '');
  assertPlaceholder(idsOnly.cards[1], malformedId, '');
  const numericId = recoverResultDisplay({ answer, matches: [{ resourceId: 10128 }] }, resources);
  assertPlaceholder(numericId.cards[0], '10128', '');
  const mixedShapes = recoverResultDisplay({ answer, matches: [null, {}, { resourceId: true }, { resourceId: unresolvedId }] }, []);
  assert.deepEqual(mixedShapes.cards.map(card => card.resourceId), [unresolvedId], 'Unreadable match entries do not discard readable IDs');
  assert.equal(recoverResultDisplay({ answer: '', matches: [{ resourceId: unresolvedId }] }, []).answer, '', 'An empty model answer can still expose readable cards');
  const secret = 'fixture-secret-in-model-text';
  const sanitized = recoverResultDisplay({ answer: `Feedback ${secret}`, matches: [{ resourceId: `sound:${secret}`, reason: `Reason ${secret}` }] }, [], [secret]);
  assert.ok(sanitized);
  assert.ok(!JSON.stringify(sanitized).includes(secret), 'Recovering model prose and IDs keeps explicit credential redaction');
  const bounded = recoverResultDisplay({ answer, matches: Array.from({ length: 55 }, () => ({ resourceId: unresolvedId })) }, []);
  assert.equal(bounded.cards.length, 50, 'Partial presentation respects the existing card ceiling without deduplicating');

  let previewReads = 0;
  const previewLoader = createPreviewMediaLoader(async () => { previewReads++; throw new Error('An unresolved card must not load media'); }, 'https://fixture.invalid');
  for (const kind of ['sound', 'effect', 'bgm']) {
    assert.equal(await previewLoader({ kind, id: '999', resourceId: `${kind}:999`, unresolved: true }), null,
      'Even a plausible numeric ID cannot preview media while unresolved');
  }
  assert.equal(previewReads, 0);

  const legacyErrorText = 'Previously localized invalid-resource error';
  const legacyArchive = [{ id: 'legacy-results', title: 'Old result', updatedAt: 1, contextStart: 0, messages: [
    { id: 'legacy-question', role: 'user', content: 'old query', cards: [], status: 'complete', mode: 'free', source: 'free' },
    { id: 'legacy-error', role: 'assistant', content: legacyErrorText, cards: [], status: 'error', mode: 'free', source: 'free', rawResponse },
  ] }];
  const legacyWarning = 'Localized warning for recovered historical results';
  const recoveredLegacy = restoreConversations(legacyArchive, legacyWarning);
  const legacyReply = recoveredLegacy[0].messages[1];
  assert.equal(legacyReply.content, answer, 'A stored JSON response restores its readable answer without another search');
  assert.equal(legacyReply.status, 'error');
  assert.equal(legacyReply.error, true);
  assert.equal(legacyReply.rawResponse, rawResponse);
  assert.equal(legacyReply.resultWarning, legacyWarning);
  assert.deepEqual(legacyReply.cards.map(card => card.resourceId), mixed.matches.map(match => match.resourceId));
  legacyReply.cards.forEach((card, index) => assertPlaceholder(card, mixed.matches[index].resourceId, mixed.matches[index].reason));
  assert.equal(restoreConversations(legacyArchive)[0].messages[1].resultWarning, legacyErrorText,
    'Without a supplied translation the previous readable error becomes the warning');
  const savedLegacy = JSON.parse(serializeAISearchArchive({ conversations: recoveredLegacy, activeConversationId: 'legacy-results', selectedMode: 'free' }));
  const reopenedLegacy = restoreConversations(savedLegacy.conversations, 'A later warning translation')[0].messages[1];
  assert.equal(reopenedLegacy.content, answer);
  assert.equal(reopenedLegacy.resultWarning, legacyWarning, 'Reopening keeps the saved warning and cards instead of recovering them again');
  assert.deepEqual(reopenedLegacy.cards, legacyReply.cards);
  const legacyNextPayload = buildAgentSearchPayload('shorter', 'en-US', 'all', recoveredLegacy[0].messages, true, 'legacy-next', 20);
  assert.deepEqual(legacyNextPayload.messages, []);
  assert.deepEqual(legacyNextPayload.previousIds, []);

  let modelCalls = 0, searchCalls = 0;
  const agentPayload = buildAgentSearchPayload('short metallic feedback', 'en-US', 'all', [], true, 'partial-agent', 20);
  const agentError = await captureError(() => requestAgentSearch(agentPayload, { ...options, fetcher: async (url, input) => {
    const endpoint = endpointOf(url);
    if (endpoint === 'SystemPrompt.md') return promptResponse();
    if (endpoint === 'search') { searchCalls++; return searchResponse(resources); }
    assert.equal(endpoint, 'responses', `Unexpected model recovery request: ${url}`);
    if (++modelCalls === 1) return Response.json(responsesFixture({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
      { id: 'fixture-search', type: 'function', function: { name: 'search_assets', arguments: JSON.stringify({ query: 'short metallic', scope: 'all', limit: 20 }) } },
    ] } }] }));
    const request = JSON.parse(input.body);
    assert.ok(responsesMessages(request).some(message => message.role === 'tool' && message.content.includes(resources[0].resourceId)));
    return modelResponse(rawResponse);
  } }));
  assert.equal(modelCalls, 2, 'A display recovery never retries the paid model');
  assert.equal(searchCalls, 1);
  assertMixedDisplay(agentError.displayResult);

  let selectionCalls = 0;
  const selectionPayload = buildSearchPayload('short metallic feedback', 'en-US', 'all', [], resources, 'partial-selection', 20);
  const selectionError = await captureError(() => requestSearch(selectionPayload, resources, { ...options, fetcher: async url => {
    if (endpointOf(url) === 'SystemPrompt.md') return promptResponse();
    assert.equal(endpointOf(url), 'responses');
    selectionCalls++;
    return modelResponse(rawResponse);
  } }));
  assert.equal(selectionCalls, 1);
  assertMixedDisplay(selectionError.displayResult);

  let unobservedCalls = 0;
  const unobservedError = await captureError(() => requestAgentSearch(agentPayload, { ...options, fetcher: async url => {
    if (endpointOf(url) === 'SystemPrompt.md') return promptResponse();
    assert.equal(endpointOf(url), 'responses');
    unobservedCalls++;
    return modelResponse(rawResponse);
  } }));
  assert.equal(unobservedCalls, 1);
  assert.equal(unobservedError.displayResult.answer, answer);
  unobservedError.displayResult.cards.forEach((card, index) => assertPlaceholder(card, mixed.matches[index].resourceId, mixed.matches[index].reason));

  // The tolerant reader is for error presentation; success responses remain strict.
  const detailIds = [resourceIds[3], unresolvedId, resourceIds[3], malformedId];
  const detailRequests = [];
  const partialFetch = async (url, input) => {
    assert.equal(endpointOf(url), 'assets');
    const ids = JSON.parse(input.body).ids;
    detailRequests.push(ids);
    return assetResponse(ids.includes(resourceIds[3]) ? [resources[3]] : [], ids.filter(id => id !== resourceIds[3]));
  };
  const partialDetails = await requestServerDisplayAssets('/api/ai-search', detailIds, 'en-US', new AbortController().signal, partialFetch, 10);
  assert.deepEqual(partialDetails.map(item => item.resourceId), [resourceIds[3]]);
  assert.ok(detailRequests.flat().every(id => /^(sound|effect|bgm):\d{1,12}$/.test(id)), 'Malformed IDs never reach the asset endpoint');
  assert.ok(detailRequests.every(ids => new Set(ids).size === ids.length), 'Details are fetched once per unique asset');
  await assert.rejects(() => requestServerAssets('/api/ai-search', [resourceIds[3], unresolvedId], 'en-US', version,
    new AbortController().signal, new Set(), partialFetch), error => error.code === 'ASSET_DETAILS');

  let freeChatCalls = 0;
  const freeError = await captureError(() => requestAgentSearch(agentPayload, { ...options, mode: 'free', fetcher: async url => {
    assert.equal(endpointOf(url), 'chat', 'A free service error returns readable IDs before UI metadata hydration');
    freeChatCalls++;
    return Response.json({ error: { code: 'UPSTREAM_RESPONSE_INVALID', rawResponse } }, { status: 502 });
  } }), 'UPSTREAM_RESPONSE_INVALID');
  assert.equal(freeChatCalls, 1);
  assert.equal(freeError.displayResult.answer, answer);
  freeError.displayResult.cards.forEach((card, index) => assertPlaceholder(card, mixed.matches[index].resourceId, mixed.matches[index].reason));

  for (const invoke of [
    fetcher => requestAgentSearch(agentPayload, { ...options, mode: 'free', fetcher }),
    fetcher => requestSearch(selectionPayload, resources, { ...options, mode: 'free', fetcher }),
  ]) {
    let responseCalls = 0;
    await assert.rejects(() => invoke(async url => {
      assert.equal(endpointOf(url), 'chat');
      responseCalls++;
      return Response.json({ ...mixed, catalogVersion: version, resources });
    }), error => {
      assert.ok(error instanceof AISearchError);
      assert.equal(error.code, 'RESPONSE_ASSET_ID');
      assert.equal(error.rawResponse, undefined, 'A parsed HTTP 200 result recovers without inventing diagnostic raw text');
      assertMixedDisplay(error.displayResult);
      return true;
    });
    assert.equal(responseCalls, 1, 'An HTTP 200 validation failure is displayed without retrying chat');
  }

  const originalFetch = global.fetch;
  const originalLocalStorage = global.localStorage, originalSessionStorage = global.sessionStorage;
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  global.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const storage = new MemoryStorage(), chatBodies = [];
  let state, uiChatCalls = 0, assetReadsFail = false, failedDetailRequests = 0;
  global.fetch = async (url, input) => {
    const endpoint = endpointOf(url);
    if (endpoint === 'config') return Response.json({ configured: true, available: true, model: 'fixture', retrieval: { available: true },
      agent: { available: true }, limits: { maxResults: 20 }, quota: { remaining: 5, limit: 5, resetAt: 'fixture' } });
    if (endpoint === 'catalog') return Response.json({ catalogVersion: version, total: resources.length, mode: 'keyword' });
    if (endpoint === 'assets') {
      if (assetReadsFail) {
        failedDetailRequests++;
        return Response.json({ error: { code: 'ASSET_DETAILS' } }, { status: 503 });
      }
      const ids = JSON.parse(input.body).ids;
      return assetResponse(resources.filter(item => ids.includes(item.resourceId)), ids.filter(id => !resourceIds.includes(id)));
    }
    assert.equal(endpoint, 'chat', `Unexpected UI route: ${url}`);
    chatBodies.push(JSON.parse(input.body));
    if (++uiChatCalls !== 2) return Response.json({ error: { code: 'UPSTREAM_RESPONSE_INVALID', rawResponse } }, { status: 502 });
    return Response.json({ catalogVersion: version, resources: [resources[3]], answer: 'A new successful answer',
      matches: [{ resourceId: resourceIds[3], reason: 'New grounded result', matchType: 'feature' }] });
  };
  const app = renderer.createApp({ setup() { state = useAISearch(); return () => null; } });
  app.provide('storage', storage);
  const localized = JSON.parse(fs.readFileSync(require.resolve('../src/i18n/locales/aiSearch/en-us.json'), 'utf8'));
  app.use(createI18n({ legacy: false, flatJson: true, locale: 'en-US', messages: { 'en-US': localized } }));
  app.mount({ children: [] });
  try {
    await waitUntil(() => !state.loadingCatalog.value && !state.loadingArchive.value);
    state.mode.value = 'free';
    state.resultLimit.value = 20;
    await state.send('short metallic feedback');
    const failed = state.messages.value.at(-1);
    assert.equal(failed.status, 'error');
    assert.equal(failed.error, true);
    assert.equal(failed.content, answer, 'The model answer remains readable above its recovered cards');
    assert.ok(failed.resultWarning && !failed.resultWarning.startsWith('aiSearch.'), 'The error warning remains separately localized');
    assert.equal(failed.rawResponse, rawResponse);
    assertMixedDisplay({ answer: failed.content, cards: failed.cards });
    assert.equal(uiChatCalls, 1, 'Rendering partial results does not issue a second chat');
    await waitUntil(() => {
      const saved = storage.files.get('/archive.json');
      return saved && JSON.parse(saved).conversations[0].messages.at(-1)?.cards.length === 15;
    });
    const reopened = restoreConversations((await new AISearchArchiveRepository(storage).read()).conversations)[0].messages.at(-1);
    assert.equal(reopened.status, 'error');
    assert.equal(reopened.rawResponse, rawResponse);
    assert.equal(reopened.resultWarning, failed.resultWarning);
    assertMixedDisplay({ answer: reopened.content, cards: reopened.cards });
    const serializedAgain = JSON.parse(serializeAISearchArchive({ conversations: [{ id: 'reopened', title: 'Recovered results',
      updatedAt: 1, contextStart: 0, messages: [reopened] }], activeConversationId: 'reopened', selectedMode: 'free' }));
    const restoredAgain = restoreConversations(serializedAgain.conversations)[0].messages[0];
    assertMixedDisplay({ answer: restoredAgain.content, cards: restoredAgain.cards });
    await state.send('shorter');
    assert.equal(uiChatCalls, 2, 'Only another user send invokes the model again');
    assert.equal(state.messages.value.at(-1).status, 'complete');
    assert.ok(!JSON.stringify(chatBodies[1]).includes(answer), 'An error answer with partial cards stays out of future model history');
    assert.ok(!JSON.stringify(chatBodies[1]).includes(unresolvedId));
    assert.ok(!JSON.stringify(chatBodies[1]).includes(malformedId));
    assert.deepEqual(chatBodies[1].previousIds, []);
    assert.equal(state.messages.value[1].rawResponse, rawResponse);
    assetReadsFail = true;
    state.createConversation();
    await state.send('feedback with unavailable metadata');
    const failedMetadata = state.messages.value.at(-1);
    assert.ok(failedDetailRequests > 0);
    assert.equal(uiChatCalls, 3, 'A failed metadata read does not invoke another model call');
    assert.equal(failedMetadata.status, 'error');
    assert.equal(failedMetadata.rawResponse, rawResponse);
    assert.equal(failedMetadata.content, answer);
    assert.ok(failedMetadata.resultWarning);
    assert.deepEqual(failedMetadata.cards.map(card => card.resourceId), mixed.matches.map(match => match.resourceId));
    failedMetadata.cards.forEach((card, index) => assertPlaceholder(card, mixed.matches[index].resourceId, mixed.matches[index].reason));
  } finally {
    app.unmount();
    global.fetch = originalFetch;
    global.localStorage = originalLocalStorage;
    global.sessionStorage = originalSessionStorage;
  }
  console.log('PASS partial AI results: ordered duplicate cards and copyable IDs, trusted metadata, strict success validation, HTTP 200 recovery, tolerant missing details, old archive restoration, unresolved preview blocking, failed-history exclusion, and no model retries');
})().catch(error => { console.error(error); process.exitCode = 1; });
