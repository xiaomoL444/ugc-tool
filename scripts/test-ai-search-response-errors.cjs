/* Offline model-response diagnostics, archive roundtrips, and Vue state. No real fetches. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createRenderer, nextTick } = require('vue');
const { createI18n } = require('vue-i18n');
const { AISearchError, buildSearchPayload, requestSearch } = require('../src/views/AISearch/aiSearchService.ts');
const { buildAgentSearchPayload, requestAgentSearch } = require('../src/views/AISearch/agentSearchService.ts');
const { boundedRawResponse, modelResponseText, MAX_RAW_RESPONSE_BYTES } = require('../src/views/AISearch/responseDiagnostics.ts');
const { serializeAISearchArchive, AISearchArchiveRepository } = require('../src/views/AISearch/archiveStorage.ts');
const { useAISearch, restoreConversations } = require('../src/views/AISearch/useAISearch.ts');
const config = { baseUrl: 'https://fixture.invalid/v1', model: 'fixture-model', apiKey: 'fixture-local-key-only', rememberKey: false };
const options = { mode: 'custom', config, freeBase: '/api/ai-search', signal: new AbortController().signal };
const asset = { resourceId: 'sound:1', id: '1', kind: 'sound', title: 'fixture rumble', description: 'observed rumble', keywords: ['rumble'], suggestedUses: [], href: '/SoundEffectPlayer?id=1', locale: 'en-US', featureText: 'rumble', audioText: 'rumble', suggestionText: '' };
const payload = buildSearchPayload('rumble', 'en-US', 'sound', [], [asset], 'fixture');
const agentPayload = buildAgentSearchPayload('rumble', 'en-US', 'sound', [], false, 'fixture-agent');
const prompt = '# Fixture prompt\nReturn at most RESULT_LIMIT resources.\n';
const failingBody = '  <img src=x onerror="alert(1)">\n{"answer":"unfinished","matches":[';
const customResponse = (content, finish_reason = 'stop', extra = {}) => Response.json({
  apiKey: 'fixture-envelope-secret', headers: { Authorization: 'Bearer fixture-header-secret' },
  choices: [{ finish_reason, message: { content, ...extra } }],
});
const fixtureFetch = handler => async (url, input) => {
  if (String(url).split('?')[0].endsWith('/AISearch/SystemPrompt.md')) return new Response(prompt, { headers: { 'Content-Type': 'text/markdown' } });
  assert.ok(String(url).endsWith('/chat/completions'), `Unexpected paid route: ${url}`);
  return handler(url, input);
};
const expectRaw = (code, rawResponse) => error => {
  assert.ok(error instanceof AISearchError);
  assert.equal(error.code, code);
  assert.equal(error.rawResponse, rawResponse);
  assert.ok(!JSON.stringify(error).includes('fixture-envelope-secret'));
  assert.ok(!JSON.stringify(error).includes('fixture-header-secret'));
  return true;
};
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
  for (let round = 0; round < 100; round++) { await nextTick(); if (condition()) return; await new Promise(resolve => setImmediate(resolve)); }
  throw new Error('State did not settle');
}
(async () => {
  assert.equal(boundedRawResponse(failingBody), failingBody, 'Whitespace, fences, and HTML remain plain diagnostic text');
  for (const source of ['x'.repeat(MAX_RAW_RESPONSE_BYTES + 1), '雷'.repeat(MAX_RAW_RESPONSE_BYTES), '😀'.repeat(MAX_RAW_RESPONSE_BYTES), 'a'.repeat(MAX_RAW_RESPONSE_BYTES - 1) + '😀']) {
    const bounded = boundedRawResponse(source);
    assert.ok(Buffer.byteLength(bounded, 'utf8') <= MAX_RAW_RESPONSE_BYTES);
    assert.ok(source.startsWith(bounded), 'Only a real prefix is retained');
    assert.ok(!/[\uD800-\uDBFF]$/u.test(bounded), 'Never split an emoji at the byte boundary');
  }
  assert.equal(boundedRawResponse('x'.repeat(MAX_RAW_RESPONSE_BYTES + 1)).length, MAX_RAW_RESPONSE_BYTES);
  for (const value of [undefined, null, '', ' \n ', { content: 'not a body' }, ['not a body']]) assert.equal(boundedRawResponse(value), undefined);
  const redacted = boundedRawResponse('{"api_key":"fixture-raw-key","access_token":"fixture-token","answer":"unfinished"}\nAuthorization: Bearer fixture-auth-secret');
  for (const secret of ['fixture-raw-key', 'fixture-token', 'fixture-auth-secret']) assert.ok(!redacted.includes(secret));
  const crossesBoundary = 'x'.repeat(MAX_RAW_RESPONSE_BYTES - 3) + config.apiKey;
  assert.ok(!boundedRawResponse(crossesBoundary, [config.apiKey]).endsWith('fix'), 'A credential crossing the clipping boundary cannot leak a prefix');
  assert.equal(modelResponseText({ content: [{ type: 'text', text: 'first' }, { type: 'image_url', image_url: { url: 'secret-url' } }, { type: 'output_text', text: 'second' }] }), 'first\nsecond');
  assert.equal(modelResponseText({ content: null, refusal: 'I cannot answer.', reasoning_content: 'secret-reasoning', tool_calls: [{ function: { arguments: 'secret-arguments' } }] }), 'I cannot answer.');
  assert.equal(modelResponseText({ content: null, reasoning_content: 'secret-reasoning', tool_calls: [{ function: { arguments: 'secret-arguments' } }] }), undefined);
  for (const code of ['NETWORK', 'AUTH', 'QUOTA_EXCEEDED', 'PROVIDER_BALANCE_LOW', 'PROVIDER_BALANCE_UNAVAILABLE', 'TOOL_ARGUMENTS']) {
    assert.equal(new AISearchError(code, undefined, failingBody).rawResponse, undefined, `${code} never invents model output`);
  }
  for (const invoke of [
    fetcher => requestSearch(payload, [asset], { ...options, fetcher }),
    fetcher => requestAgentSearch(agentPayload, { ...options, fetcher }),
  ]) {
    let calls = 0;
    await assert.rejects(() => invoke(fixtureFetch(async () => { calls++; return customResponse(failingBody); })), expectRaw('RESPONSE_FORMAT', failingBody));
    assert.equal(calls, 1, 'Malformed model output does not trigger another model round');
    await assert.rejects(() => invoke(fixtureFetch(async () => customResponse(failingBody, 'length'))), expectRaw('OUTPUT_TRUNCATED', failingBody));
    const invalidIds = JSON.stringify({ answer: 'found', matches: [{ resourceId: 'sound:999', reason: 'invented', matchType: 'feature' }] });
    await assert.rejects(() => invoke(fixtureFetch(async () => customResponse(invalidIds))), expectRaw('RESPONSE_ASSET_ID', invalidIds));
    const invalidShape = '{"answer":"missing matches"}';
    await assert.rejects(() => invoke(fixtureFetch(async () => customResponse(invalidShape))), expectRaw('RESPONSE_FORMAT', invalidShape));
    await assert.rejects(() => invoke(fixtureFetch(async () => customResponse(null, 'stop', { refusal: 'I cannot answer.' }))), expectRaw('RESPONSE_FORMAT', 'I cannot answer.'));
    await assert.rejects(() => invoke(fixtureFetch(async () => customResponse(null, 'stop', { reasoning_content: 'secret-reasoning' }))), expectRaw('EMPTY_RESPONSE', undefined));
    await assert.rejects(() => invoke(fixtureFetch(async () => customResponse(''))), expectRaw('EMPTY_RESPONSE', undefined));
    await assert.rejects(() => invoke(fixtureFetch(async () => customResponse('answer ' + config.apiKey))), expectRaw('RESPONSE_FORMAT', 'answer [REDACTED]'));
    const longBody = '雷😀'.repeat(5000);
    await assert.rejects(() => invoke(fixtureFetch(async () => customResponse(longBody))), error => {
      assert.equal(error.code, 'RESPONSE_FORMAT');
      assert.equal(error.rawResponse, boundedRawResponse(longBody));
      assert.ok(Buffer.byteLength(error.rawResponse, 'utf8') <= MAX_RAW_RESPONSE_BYTES);
      return true;
    });
    await assert.rejects(() => invoke(fixtureFetch(async () => customResponse(failingBody, 'stop', { apiKey: 'fixture-message-secret' }))), expectRaw('RESPONSE_FORMAT', failingBody));
    await assert.rejects(() => invoke(fixtureFetch(async () => Response.json({ error: { code: 'NETWORK', rawResponse: failingBody }, content: 'not-model-output' }, { status: 500 }))), expectRaw('MODEL_SERVICE_ERROR', undefined));
  }
  for (const invoke of [
    fetcher => requestSearch(payload, [asset], { ...options, mode: 'free', fetcher }),
    fetcher => requestAgentSearch(agentPayload, { ...options, mode: 'free', fetcher }),
  ]) {
    for (const code of ['UPSTREAM_RESPONSE_INVALID', 'RESPONSE_FORMAT', 'OUTPUT_TRUNCATED']) {
      await assert.rejects(() => invoke(async () => Response.json({ error: { code, rawResponse: failingBody, headers: { Authorization: 'Bearer fixture-header-secret' } } }, { status: 502 })), expectRaw(code, failingBody));
    }
    await assert.rejects(() => invoke(async () => Response.json({ error: { code: 'UPSTREAM_RESPONSE_INVALID', message: 'not the model body' } }, { status: 502 })), expectRaw('UPSTREAM_RESPONSE_INVALID', undefined));
    await assert.rejects(() => invoke(async () => Response.json({ error: { code: 'PROVIDER_BALANCE_LOW', rawResponse: failingBody, reason: 'NETWORK' } }, { status: 503 })), expectRaw('PROVIDER_BALANCE_LOW', undefined));
  }
  const promptDiagnostic = { stage: 'prompt', kind: 'response', status: 200, endpoint: 'https://oss.fixture.invalid/AISearch/SystemPrompt.md', validationCode: 'PROMPT_TOO_LARGE', responseBytes: 32769, responseByteLimit: 32768, contentType: 'text/markdown' };
  const messages = [
    { id: 'bad-model', role: 'assistant', content: 'localized format error', cards: [], status: 'error', mode: 'custom', rawResponse: failingBody },
    { id: 'complete', role: 'assistant', content: 'success', cards: [], status: 'complete', mode: 'custom', rawResponse: 'must not retain' },
    { id: 'user', role: 'user', content: 'question', cards: [], status: 'error', mode: 'custom', rawResponse: 'must not retain' },
    { id: 'unsafe', role: 'assistant', content: 'error', cards: [], status: 'error', mode: 'custom', rawResponse: { apiKey: 'must not retain' } },
    { id: 'old', role: 'assistant', content: 'legacy error', cards: [], status: 'error', mode: 'custom' },
    { id: 'prompt', role: 'assistant', content: 'prompt size error', cards: [], status: 'error', mode: 'custom', requestDiagnostic: { ...promptDiagnostic, body: 'PRIVATE_PROMPT_BODY' } },
  ];
  const archiveInput = { conversations: [{ id: 'conversation', title: 'fixture', updatedAt: 1, contextStart: 0, messages }], activeConversationId: 'conversation', selectedMode: 'custom' };
  const saved = JSON.parse(serializeAISearchArchive(archiveInput));
  const restored = restoreConversations(saved.conversations)[0].messages;
  assert.equal(restored[0].content, messages[0].content);
  assert.equal(restored[0].rawResponse, failingBody, 'Both the localized error and its real body survive reopening');
  assert.equal(restored[0].error, true);
  assert.deepEqual(restored.at(-1).requestDiagnostic, promptDiagnostic, 'Public prompt validation fields survive safe archive restoration');
  assert.ok(!JSON.stringify(saved).includes('PRIVATE_PROMPT_BODY'));
  for (const message of restored.slice(1)) assert.equal(message.rawResponse, undefined);
  assert.ok(!JSON.stringify(saved).includes('must not retain'));
  const boundedArchive = { ...archiveInput, conversations: [{ ...archiveInput.conversations[0], messages: [{ ...messages[0], rawResponse: '雷'.repeat(MAX_RAW_RESPONSE_BYTES) }] }] };
  assert.ok(Buffer.byteLength(restoreConversations(JSON.parse(serializeAISearchArchive(boundedArchive)).conversations)[0].messages[0].rawResponse, 'utf8') <= MAX_RAW_RESPONSE_BYTES);
  const history = [{ role: 'user', status: 'complete', content: 'rumble', cards: [], mode: 'custom' }, { role: 'assistant', status: 'complete', content: 'found', cards: [asset], mode: 'custom', rawResponse: 'diagnostic must not enter context' }, { role: 'user', status: 'complete', content: 'shorter', cards: [], mode: 'custom' }, messages[0]];
  assert.ok(!JSON.stringify(buildSearchPayload('shorter', 'en-US', 'sound', history, [asset], 'context')).includes('diagnostic must not enter context'));
  assert.ok(!JSON.stringify(buildAgentSearchPayload('shorter', 'en-US', 'sound', history, false, 'context')).includes('diagnostic must not enter context'));
  assert.ok(!JSON.stringify(buildAgentSearchPayload('shorter', 'en-US', 'sound', history, false, 'context')).includes(failingBody));

  const originalFetch = global.fetch;
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  global.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const storage = new MemoryStorage();
  const chatBodies = [];
  let state, requests = 0;
  global.fetch = async (url, input) => {
    const endpoint = String(url).split('?')[0].split('/').pop();
    if (endpoint === 'config') return Response.json({ configured: true, available: true, model: 'fixture', retrieval: { available: true }, agent: { available: true }, quota: { remaining: 5, limit: 5, resetAt: 'fixture' } });
    if (endpoint === 'catalog') return Response.json({ catalogVersion: 'v1', total: 1, mode: 'keyword' });
    assert.equal(endpoint, 'chat', `Unexpected UI request: ${url}`);
    chatBodies.push(JSON.parse(input.body));
    requests++;
    if (requests === 1) return Response.json({ error: { code: 'UPSTREAM_RESPONSE_INVALID', rawResponse: failingBody } }, { status: 502 });
    return Response.json({ catalogVersion: 'v1', resources: [asset], answer: 'found', matches: [{ resourceId: asset.resourceId, reason: 'observed', matchType: 'feature' }] });
  };
  const app = renderer.createApp({ setup() { state = useAISearch(); return () => null; } });
  app.provide('storage', storage);
  app.use(createI18n({ legacy: false, flatJson: true, locale: 'en-US', messages: { 'en-US': JSON.parse(fs.readFileSync(require.resolve('../src/i18n/locales/aiSearch/en-us.json'), 'utf8')) } }));
  app.mount({ children: [] });
  try {
    await waitUntil(() => !state.loadingCatalog.value && !state.loadingArchive.value);
    const localizedPromptError = state.explainError(new AISearchError('PROMPT_UNAVAILABLE', undefined, undefined, promptDiagnostic));
    assert.ok(localizedPromptError.includes('The prompt file exceeds the read limit.') && localizedPromptError.includes('32769') && localizedPromptError.includes('32768'), localizedPromptError);
    const promptDetail = state.requestDiagnosticText(promptDiagnostic);
    assert.ok(promptDetail.includes('PROMPT_TOO_LARGE') && promptDetail.includes('Response size (bytes): 32769') && promptDetail.includes('Read limit (bytes): 32768') && promptDetail.includes('Response content type: text/markdown'), promptDetail);
    assert.ok(promptDetail.includes('before calling the model') && !promptDetail.includes('Check API compatibility'), 'Prompt validation uses a file-specific hint');
    const reasonMessages = { UNSUPPORTED_CONTENT_TYPE: 'content type is unsupported', INVALID_UTF8: 'not valid UTF-8 text', EMPTY_PROMPT: 'file is empty', HTML_RESPONSE: 'returned an HTML page', INVALID_CONTROL_CHARACTERS: 'disallowed control characters', REDIRECTED_RESPONSE: 'returned a redirect', MISSING_BODY: 'no readable body' };
    for (const [validationCode, expected] of Object.entries(reasonMessages)) {
      const diagnostic = { ...promptDiagnostic, validationCode, responseBytes: 16783 };
      const explanation = state.explainError(new AISearchError('PROMPT_UNAVAILABLE', undefined, undefined, diagnostic));
      assert.ok(explanation.includes(expected) && explanation.includes('16783') && explanation.includes('32768'), explanation);
    }
    const genericPromptDetail = state.requestDiagnosticText({ stage: 'prompt', kind: 'response', status: 200 });
    assert.ok(genericPromptDetail.includes('public prompt file') && !genericPromptDetail.includes('API compatibility'));
    await state.send('rumble');
    const failed = state.messages.value.at(-1);
    assert.equal(failed.status, 'error');
    assert.equal(failed.rawResponse, failingBody, 'The current reactive error exposes the exact model body');
    assert.ok(failed.content && failed.content !== failingBody);
    await waitUntil(() => {
      const saved = storage.files.get('/archive.json');
      return saved && JSON.parse(saved).conversations[0].messages.at(-1)?.rawResponse === failingBody;
    });
    const reopened = restoreConversations((await new AISearchArchiveRepository(storage).read()).conversations)[0].messages.at(-1);
    assert.equal(reopened.content, failed.content);
    assert.equal(reopened.rawResponse, failingBody);
    await state.send('shorter');
    assert.equal(requests, 2, 'Only explicit sends issue model requests');
    assert.equal(state.messages.value.at(-1).status, 'complete');
    assert.equal(state.messages.value.at(-1).rawResponse, undefined);
    assert.equal(state.messages.value[1].rawResponse, failingBody, 'The previous failed round retains its original response');
    assert.ok(!JSON.stringify(chatBodies[1]).includes(failingBody), 'The stored failed body never enters the next model context');
  } finally { app.unmount(); global.fetch = originalFetch; }
  console.log('PASS AI response diagnostics: real body and refusal capture, malformed/truncated/invalid-ID responses, 16 KiB Unicode and credential bounds, free legacy compatibility, plain text, archive reopening, current reactive errors, and no diagnostic history or paid retries');
})().catch(error => { console.error(error); process.exitCode = 1; });
