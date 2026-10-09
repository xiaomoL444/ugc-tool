/* Run: node scripts/test-ai-search-request-diagnostics.cjs. Mock-only, no keys or network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { sanitizeRequestDiagnostic } = require('../src/views/AISearch/requestDiagnostics.ts');
const { AISearchError, buildSearchPayload, chatCompletionsUrl, requestSearch, requestServerCatalog, requestServerSearch, requestServerAssets } = require('../src/views/AISearch/aiSearchService.ts');
const { buildAgentSearchPayload, requestAgentSearch } = require('../src/views/AISearch/agentSearchService.ts');
const fakeKey = 'mock-secret-request-diagnostics-only';
const config = { baseUrl: 'https://api.openai.com', model: 'mock-compatible-model', apiKey: fakeKey, rememberKey: false };
const freeBase = 'https://site.example/api/ai-search';
const resource = { resourceId: 'sound:123', id: '123', kind: 'sound', title: '金属撞击', description: '短促金属感撞击', keywords: ['金属', '撞击'], suggestedUses: [],
  duration: 0.8, hasAudio: true, locale: 'zh-CN', href: '/SoundEffectPlayer?id=123', featureText: '', audioText: '', suggestionText: '' };
const finalResult = { answer: '这条是短促金属撞击。', matches: [{ resourceId: resource.resourceId, reason: '短促金属感撞击描述', matchType: 'feature' }] };
const legacyPayload = buildSearchPayload('找金属撞击', 'zh-CN', 'sound', [], [resource], 'diagnostic-legacy');
const agentPayload = buildAgentSearchPayload('找金属撞击', 'zh-CN', 'sound', [], true, 'diagnostic-agent');
const promptFixture = '# Request diagnostic fixture\nReturn at most RESULT_LIMIT resources.\n';
const metadata = { catalogVersion: 'diagnostic-catalog-v1', mode: 'keyword', counts: { total: 1 }, coverage: 1 };
const jsonResponse = (value, options = {}) => new Response(JSON.stringify(value), { ...options,
  headers: { 'content-type': 'application/json', ...options.headers } });
const modelResponse = value => jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
const searchTool = () => jsonResponse({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{
  id: 'diagnostic-search', type: 'function', function: { name: 'search_assets', arguments: JSON.stringify({ query: '金属撞击', scope: 'sound' }) },
}] } }] });
const detailsTool = () => jsonResponse({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{
  id: 'diagnostic-details', type: 'function', function: { name: 'get_assets', arguments: JSON.stringify({ ids: [resource.resourceId] }) },
}] } }] });
const isPrompt = url => String(url).split('?')[0].endsWith('/AISearch/SystemPrompt.md');
const isModel = url => String(url).endsWith('/chat/completions');
function fixtureFetch(route) {
  const counts = { model: 0, site: 0, prompt: 0 };
  const fetcher = async (url, options = {}) => {
    if (isPrompt(url)) {
      counts.prompt += 1;
      assert.equal(options.headers?.Authorization, undefined, 'OSS prompt requests never receive a model key');
      return new Response(promptFixture, { headers: { 'content-type': 'text/markdown' } });
    }
    if (isModel(url)) {
      counts.model += 1;
      assert.equal(options.headers.Authorization, `Bearer ${fakeKey}`);
    } else {
      counts.site += 1;
      assert.equal(options.headers?.Authorization, undefined, 'Worker retrieval requests never receive a model key');
    }
    return route(String(url), options, counts);
  };
  return { fetcher, counts };
}
async function captured(run) {
  try { await run(); } catch (error) { return error; }
  assert.fail('Expected a diagnostic failure');
}
function assertDiagnostic(error, stage, kind, status, round) {
  assert.ok(error instanceof AISearchError, 'Failures remain typed AISearchError values');
  const diagnostic = error.requestDiagnostic;
  assert.ok(diagnostic, `Missing diagnostic for ${error.code}`);
  assert.equal(diagnostic.stage, stage); assert.equal(diagnostic.kind, kind);
  if (status !== undefined) assert.equal(diagnostic.status, status);
  if (round !== undefined) assert.equal(diagnostic.round, round);
  assert.ok(typeof diagnostic.endpoint === 'string' && diagnostic.endpoint.length);
  assert.equal(JSON.stringify(diagnostic).includes(fakeKey), false, 'No diagnostic may retain a known model key');
  assert.equal(error.rawResponse, undefined, 'HTTP/network diagnostics must not masquerade as final-model-text rawResponse');
  return diagnostic;
}
async function runModelFailure(mode, route, signal = new AbortController().signal, overrideConfig) {
  const fixture = fixtureFetch(route);
  const options = { mode: 'custom', config: overrideConfig ?? config, freeBase, signal, fetcher: fixture.fetcher };
  const error = await captured(() => mode === 'agent' ? requestAgentSearch(agentPayload, options) : requestSearch(legacyPayload, [resource], options));
  return { error, counts: fixture.counts };
}

(async () => {
  const sanitized = sanitizeRequestDiagnostic({ stage: 'model', kind: 'http', endpoint: 'https://username:password@provider.example/v1/chat/completions?token=PRIVATE_QUERY#PRIVATE_HASH',
    status: 400, model: 'mock-model', round: 2, requestId: 'request-fake', parameter: 'max_tokens',
    providerCode: 'unsupported_parameter', providerMessage: `Unsupported parameter; ${fakeKey}; Bearer sk-private-diagnostic-key; https://name:pass@provider.example/?key=PRIVATE_QUERY`,
    browserMessage: `network ${fakeKey}`, elapsedMs: 42, headers: { Authorization: `Bearer ${fakeKey}` }, rawBody: 'PRIVATE_ENVELOPE', extra: 'PRIVATE_EXTRA' }, [fakeKey]);
  assert.equal(sanitized.endpoint, 'https://provider.example/v1/chat/completions');
  assert.equal(sanitized.stage, 'model'); assert.equal(sanitized.kind, 'http'); assert.equal(sanitized.status, 400);
  assert.equal(sanitized.parameter, 'max_tokens'); assert.equal(sanitized.round, 2);
  assert.doesNotMatch(JSON.stringify(sanitized), /mock-secret|PRIVATE_QUERY|PRIVATE_HASH|sk-private|username|password|name:pass|PRIVATE_ENVELOPE|PRIVATE_EXTRA/);
  assert.equal(Object.hasOwn(sanitized, 'headers'), false); assert.equal(Object.hasOwn(sanitized, 'rawBody'), false);
  assert.equal(sanitizeRequestDiagnostic({ stage: 'unknown', kind: 'http' }), undefined);
  assert.equal(sanitizeRequestDiagnostic({ stage: 'model', kind: 'unknown' }), undefined);
  assert.ok((sanitizeRequestDiagnostic({ stage: 'model', kind: 'response', endpoint: 'https://provider.example/v1/chat/completions', providerMessage: 'x'.repeat(100000) })?.providerMessage ?? '').length < 100000);

  const promptFields = { stage: 'prompt', kind: 'response', status: 200, validationCode: 'INVALID_UTF8', responseBytes: 16783, responseByteLimit: 32768, contentType: 'text/markdown' };
  assert.deepEqual(sanitizeRequestDiagnostic({ ...promptFields, body: 'PRIVATE_PROMPT_BODY', headers: { authorization: fakeKey } }), promptFields);
  for (const code of ['PROMPT_TOO_LARGE', 'UNSUPPORTED_CONTENT_TYPE', 'INVALID_UTF8', 'EMPTY_PROMPT', 'HTML_RESPONSE', 'INVALID_CONTROL_CHARACTERS', 'REDIRECTED_RESPONSE', 'MISSING_BODY'])
    assert.equal(sanitizeRequestDiagnostic({ ...promptFields, validationCode: code }).validationCode, code);
  assert.equal(sanitizeRequestDiagnostic({ ...promptFields, validationCode: 'PRIVATE_UNKNOWN_REASON' }).validationCode, undefined);
  for (const value of [-1, 1.5, '16783', NaN, Infinity, 1048577]) {
    assert.equal(sanitizeRequestDiagnostic({ ...promptFields, responseBytes: value }).responseBytes, undefined);
    assert.equal(sanitizeRequestDiagnostic({ ...promptFields, responseByteLimit: value }).responseByteLimit, undefined);
  }
  assert.equal(sanitizeRequestDiagnostic({ ...promptFields, responseBytes: 0 }).responseBytes, 0);
  assert.equal(sanitizeRequestDiagnostic({ ...promptFields, responseByteLimit: 0 }).responseByteLimit, undefined);
  assert.equal(sanitizeRequestDiagnostic({ ...promptFields, responseBytes: 1048576, responseByteLimit: 1048576 }).responseBytes, 1048576);
  assert.equal(sanitizeRequestDiagnostic({ ...promptFields, contentType: 'x'.repeat(1000) }).contentType.length, 160);

  const officialInputs = ['https://api.openai.com', 'https://api.openai.com/', 'https://api.openai.com/v1',
    'https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/responses', 'https://api.openai.com/v1/responses/',
    'https://api.openai.com/v1/responses/chat/completions', 'https://api.openai.com/responses', 'https://api.openai.com/responses/chat/completions'];
  for (const baseUrl of officialInputs) assert.equal(chatCompletionsUrl(baseUrl), 'https://api.openai.com/v1/chat/completions', `Normalize known official API path ${baseUrl}`);
  assert.equal(chatCompletionsUrl('https://provider.example/v1'), 'https://provider.example/v1/chat/completions');
  for (const [baseUrl, expected] of [
    ['https://provider.example/openai/v1', 'https://provider.example/openai/v1/chat/completions'],
    ['https://provider.example/v1/responses/chat/completions', 'https://provider.example/v1/responses/chat/completions'],
    ['https://provider.example/custom/chat/completions', 'https://provider.example/custom/chat/completions'],
  ]) assert.equal(chatCompletionsUrl(baseUrl), expected, 'Do not rewrite compatible providers\' custom paths');
  for (const mode of ['legacy', 'agent']) {
    for (const baseUrl of officialInputs) {
      const fixture = fixtureFetch((url, options) => {
        assert.equal(url, 'https://api.openai.com/v1/chat/completions', 'Responses URL must not acquire a duplicated chat/completions suffix');
        const sent = JSON.parse(options.body);
        assert.ok(Number.isInteger(sent.max_completion_tokens) && sent.max_completion_tokens > 0);
        assert.equal(Object.hasOwn(sent, 'max_tokens'), false, 'Official OpenAI uses max_completion_tokens');
        assert.equal(Object.hasOwn(sent, 'reasoning_effort'), false, 'Unrelated models must retain their original request fields');
        return modelResponse(mode === 'agent' ? { answer: '你想要更低沉还是明亮的声音？', matches: [], clarification: true } : finalResult);
      });
      const options = { mode: 'custom', config: { ...config, baseUrl }, freeBase, signal: new AbortController().signal, fetcher: fixture.fetcher };
      const answer = await (mode === 'agent' ? requestAgentSearch(agentPayload, options) : requestSearch(legacyPayload, [resource], options));
      assert.ok(answer.answer); assert.equal(fixture.counts.model, 1, 'URL normalization introduces no extra model request'); assert.equal(fixture.counts.site, 0);
    }

    const http = await runModelFailure(mode, () => jsonResponse({ error: { type: 'invalid_request_error', code: 'unsupported_parameter',
      param: 'max_tokens', message: `Unsupported parameter max_tokens, use max_completion_tokens. ${fakeKey}` } },
    { status: 400, headers: { 'x-request-id': 'provider-request-fake' } }));
    assert.equal(http.error.code, 'MODEL_REQUEST_REJECTED');
    const diagnostic = assertDiagnostic(http.error, 'model', 'http', 400, 1);
    assert.equal(diagnostic.requestId, 'provider-request-fake'); assert.equal(diagnostic.providerCode, 'unsupported_parameter');
    assert.equal(diagnostic.parameter, 'max_tokens'); assert.match(diagnostic.providerMessage, /max_completion_tokens/);
    assert.equal(diagnostic.model, config.model); assert.equal(http.counts.model, 1, 'No HTTP failure triggers a paid retry');

    const nonJSON = await runModelFailure(mode, () => new Response('<html>PRIVATE_HTTP_BODY</html>', { status: 400, headers: { 'cf-ray': 'edge-request-fake' } }));
    assert.equal(nonJSON.error.code, 'MODEL_REQUEST_REJECTED');
    const nonJSONDiagnostic = assertDiagnostic(nonJSON.error, 'model', 'http', 400, 1);
    assert.equal(nonJSONDiagnostic.requestId, 'edge-request-fake'); assert.equal(JSON.stringify(nonJSONDiagnostic).includes('PRIVATE_HTTP_BODY'), false);
    assert.equal(nonJSON.counts.model, 1);

    for (const [status, code] of [[401, 'AUTH'], [403, 'FORBIDDEN'], [429, 'PROVIDER_RATE_LIMIT'], [500, 'MODEL_SERVICE_ERROR'], [503, 'MODEL_SERVICE_ERROR']]) {
      const response = await runModelFailure(mode, () => jsonResponse({ error: { code: 'provider-fake', message: 'Mock failure' } }, { status }));
      assert.equal(response.error.code, code); assertDiagnostic(response.error, 'model', 'http', status, 1);
      assert.equal(response.counts.model, 1);
    }

    const network = await runModelFailure(mode, () => { throw new TypeError(`Failed to fetch; ${fakeKey}`); });
    assertDiagnostic(network.error, 'model', 'network', undefined, 1); assert.equal(network.counts.model, 1);

    const abortController = new AbortController();
    const aborted = await runModelFailure(mode, () => { abortController.abort(); throw new DOMException('Aborted', 'AbortError'); }, abortController.signal);
    assertDiagnostic(aborted.error, 'model', 'timeout', undefined, 1); assert.equal(aborted.counts.model, 1);

    const bodyFailure = await runModelFailure(mode, () => new Response(new ReadableStream({
      start(controller) { controller.error(new TypeError(`Response body read failed ${fakeKey}`)); },
    }), { headers: { 'content-type': 'application/json' } }));
    assertDiagnostic(bodyFailure.error, 'model', 'network', 200, 1); assert.equal(bodyFailure.counts.model, 1);
  }

  for (const compatibility of [
    { baseUrl: 'https://api.openai.com/v1/responses', model: 'gpt-6-luna', reasoning: 'none', official: true },
    { baseUrl: 'https://api.openai.com/v1/responses/chat/completions', model: 'gpt-6-luna', reasoning: 'none', official: true },
    { baseUrl: 'https://api.openai.com', model: 'gpt-4.1-nano', official: true },
    { baseUrl: 'https://provider.example/openai/v1', model: 'gpt-6-luna', official: false },
  ]) {
    const fixture = fixtureFetch((url, options, counts) => {
      if (!isModel(url)) {
        assert.ok(url === `${freeBase}/search` || url === `${freeBase}/assets`);
        if (url.endsWith('/assets')) assert.deepEqual(JSON.parse(options.body).ids, [resource.resourceId]);
        return jsonResponse({ ...metadata, total: 1, items: [resource], hasMore: false });
      }
      assert.equal(url, compatibility.official ? 'https://api.openai.com/v1/chat/completions' : 'https://provider.example/openai/v1/chat/completions');
      const sent = JSON.parse(options.body);
      assert.equal(sent.model, compatibility.model);
      if (compatibility.reasoning) assert.equal(sent.reasoning_effort, compatibility.reasoning, 'Official gpt-6-luna tool requests disable reasoning on every round');
      else assert.equal(Object.hasOwn(sent, 'reasoning_effort'), false, 'Do not force official-model fields onto other models or proxies');
      const tokenField = compatibility.official ? 'max_completion_tokens' : 'max_tokens';
      assert.ok(Number.isInteger(sent[tokenField]) && sent[tokenField] > 0);
      assert.equal(Object.hasOwn(sent, compatibility.official ? 'max_tokens' : 'max_completion_tokens'), false);
      assert.ok(Array.isArray(sent.tools) && sent.tools.length, 'All rounds retain the function schemas');
      assert.equal(sent.tool_choice, counts.model === 3 ? 'none' : 'auto');
      if (counts.model > 1) assert.ok(sent.messages.some(message => message.role === 'tool'), 'Post-tool requests carry the tool results');
      if (counts.model === 1) return searchTool();
      if (counts.model === 2) return detailsTool();
      return modelResponse(finalResult);
    });
    const answer = await requestAgentSearch(agentPayload, { mode: 'custom', config: { ...config, baseUrl: compatibility.baseUrl, model: compatibility.model },
      freeBase, signal: new AbortController().signal, fetcher: fixture.fetcher });
    assert.equal(answer.matches[0].resourceId, resource.resourceId);
    assert.equal(fixture.counts.model, 3, 'The compatibility adjustment does not add retries or a fourth model round');
    assert.equal(fixture.counts.site, 3, 'The mock executes search, tool details, and final card hydration without extra model calls');
  }

  const unsupported = await runModelFailure('agent', () => jsonResponse({ error: { code: 'unsupported_tools', message: 'This model does not support tools.' } }, { status: 400 }));
  assert.equal(unsupported.error.code, 'TOOLS_UNSUPPORTED'); assertDiagnostic(unsupported.error, 'model', 'http', 400, 1);
  assert.equal(unsupported.counts.model, 1);

  const laterRound = await runModelFailure('agent', (url, options, counts) => {
    if (!isModel(url)) {
      assert.equal(url, `${freeBase}/search`);
      return jsonResponse({ ...metadata, total: 1, items: [resource], hasMore: false });
    }
    if (counts.model === 1) return searchTool();
    return jsonResponse({ error: { code: 'invalid_parameter', param: 'max_completion_tokens', message: `Mock later-round rejection ${fakeKey}` } },
      { status: 400, headers: { 'x-request-id': 'provider-second-round-fake' } });
  });
  assert.equal(laterRound.error.code, 'MODEL_REQUEST_REJECTED');
  const laterDiagnostic = assertDiagnostic(laterRound.error, 'model', 'http', 400, 2);
  assert.equal(laterDiagnostic.requestId, 'provider-second-round-fake'); assert.equal(laterDiagnostic.parameter, 'max_completion_tokens');
  assert.equal(laterRound.counts.model, 2, 'A later-round HTTP error stops the loop instead of retrying or starting the third round');
  assert.equal(laterRound.counts.site, 1);

  const workerFailure = await runModelFailure('agent', url => {
    if (isModel(url)) return searchTool();
    assert.equal(url, `${freeBase}/search`);
    return jsonResponse({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origin rejected' } }, { status: 403, headers: { 'cf-ray': 'worker-ray-fake' } });
  });
  assert.equal(workerFailure.error.code, 'RETRIEVAL_FAILED');
  const workerDiagnostic = assertDiagnostic(workerFailure.error, 'search', 'http', 403);
  assert.equal(workerDiagnostic.providerCode, 'ORIGIN_NOT_ALLOWED'); assert.equal(workerDiagnostic.requestId, 'worker-ray-fake');
  assert.equal(workerFailure.counts.model, 1, 'A failed Worker tool request must not make a second paid model request');
  assert.equal(workerFailure.counts.site, 1);

  const workerNetwork = await runModelFailure('agent', url => {
    if (isModel(url)) return searchTool();
    throw new TypeError('Worker connection failed');
  });
  assertDiagnostic(workerNetwork.error, 'search', 'network'); assert.equal(workerNetwork.counts.model, 1);

  const controller = new AbortController();
  const catalogHTTP = await captured(() => requestServerCatalog(freeBase, controller.signal,
    async () => jsonResponse({ error: { code: 'ASSET_FEATURES_UNAVAILABLE', message: 'Catalogue unavailable' } }, { status: 503 })));
  assertDiagnostic(catalogHTTP, 'catalog', 'http', 503);
  const assetsHTTP = await captured(() => requestServerAssets(freeBase, [resource.resourceId], 'zh-CN', metadata.catalogVersion, controller.signal, new Set(),
    async () => jsonResponse({ error: { code: 'ASSET_FEATURES_UNAVAILABLE', message: 'Details unavailable' } }, { status: 503 })));
  assert.equal(assetsHTTP.code, 'ASSET_DETAILS'); assertDiagnostic(assetsHTTP, 'assets', 'http', 503);

  const searchResponse = await captured(() => requestServerSearch(freeBase, { query: '金属', locale: 'zh-CN', scope: 'sound', includeEffectAudio: true, limit: 10 }, controller.signal,
    async () => new Response('PRIVATE_BAD_JSON', { status: 200 })));
  assertDiagnostic(searchResponse, 'search', 'response', 200); assert.equal(JSON.stringify(searchResponse.requestDiagnostic).includes('PRIVATE_BAD_JSON'), false);

  let promptRequests = 0, modelRequests = 0;
  const promptFailure = await captured(() => requestAgentSearch(agentPayload, { mode: 'custom', config, freeBase, signal: controller.signal,
    fetcher: async url => { if (isPrompt(url)) { promptRequests += 1; return new Response('PRIVATE_PROMPT_HTTP_BODY', { status: 403 }); }
      modelRequests += 1; throw new Error('Unexpected model request'); } }));
  assertDiagnostic(promptFailure, 'prompt', 'http', 403); assert.equal(promptRequests, 1); assert.equal(modelRequests, 0);
  assert.equal(JSON.stringify(promptFailure.requestDiagnostic).includes('PRIVATE_PROMPT_HTTP_BODY'), false);

  const promptWithBytes = size => {
    const prefix = '# 公共提示词\n';
    let source = prefix + '雷'.repeat(Math.floor((size - Buffer.byteLength(prefix)) / 3));
    source += 'x'.repeat(size - Buffer.byteLength(source));
    assert.equal(Buffer.byteLength(source), size); return source;
  };
  let acceptedPromptCalls = 0;
  const acceptedPrompt = await requestSearch(legacyPayload, [resource], { mode: 'custom', config, freeBase, signal: controller.signal,
    fetcher: async url => { if (isPrompt(url)) return new Response(new TextEncoder().encode(promptWithBytes(16783)));
      acceptedPromptCalls++; return modelResponse(finalResult); } });
  assert.equal(acceptedPrompt.answer, finalResult.answer); assert.equal(acceptedPromptCalls, 1, 'A 16783-byte UTF-8 prompt below 32768 bytes reaches the model once');
  let oversizedModelCalls = 0;
  const oversizedPrompt = await captured(() => requestAgentSearch(agentPayload, { mode: 'custom', config, freeBase, signal: controller.signal,
    fetcher: async url => { if (isPrompt(url)) return new Response(promptWithBytes(32769), { headers: { 'content-type': 'text/markdown' } });
      oversizedModelCalls++; throw new Error('An oversized prompt must not call the model'); } }));
  const oversizedDiagnostic = assertDiagnostic(oversizedPrompt, 'prompt', 'response', 200);
  assert.equal(oversizedDiagnostic.validationCode, 'PROMPT_TOO_LARGE'); assert.equal(oversizedDiagnostic.responseBytes, 32769);
  assert.equal(oversizedDiagnostic.responseByteLimit, 32768); assert.equal(oversizedDiagnostic.contentType, 'text/markdown');
  assert.equal(oversizedModelCalls, 0);

  const freeFailure = await captured(() => requestAgentSearch(agentPayload, { mode: 'free', config, freeBase, signal: controller.signal,
    fetcher: async url => { assert.equal(url, `${freeBase}/chat`); return jsonResponse({ error: { code: 'FREE_SERVICE_BUSY', message: 'Busy' } }, { status: 429 }); } }));
  assertDiagnostic(freeFailure, 'site', 'http', 429); assert.equal(freeFailure.code, 'FREE_SERVICE_BUSY');
  console.log('AI Search request diagnostic regressions passed (mock-only; no network, credentials, or paid retry).');
})().catch(error => { console.error(error); process.exitCode = 1; });
