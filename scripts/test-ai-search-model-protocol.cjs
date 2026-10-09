/* Run: node scripts/test-ai-search-model-protocol.cjs. Pure/in-memory mocks only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { resolveModelProtocol, anthropicMessagesUrl, modelHeaders, toAnthropicRequest, normalizeAnthropicResponse } = require('../src/views/AISearch/modelProtocol.ts');
const { AISearchError, buildSearchPayload, requestSearch } = require('../src/views/AISearch/aiSearchService.ts');
const { buildAgentSearchPayload, requestAgentSearch } = require('../src/views/AISearch/agentSearchService.ts');
const key = 'mock-native-protocol-key-not-real';
const schema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false };
const tools = [{ type: 'function', function: { name: 'search_assets', description: 'Search the local resource catalogue.', parameters: schema, strict: true } }];
const call = (id = 'toolu_Case-sensitive-1', input = { query: 'metal impact' }) => ({ id, type: 'function', function: { name: 'search_assets', arguments: JSON.stringify(input) } });
const request = messages => ({ model: 'claude-mock-local', max_completion_tokens: 768, messages, tools, tool_choice: 'auto' });
const response = (content, stop_reason = 'end_turn') => ({ id: 'msg_mock', type: 'message', role: 'assistant', model: 'claude-mock-local', content, stop_reason });
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

(async () => {
  const previousFetch = global.fetch;
  let forbiddenCalls = 0;
  global.fetch = async () => { forbiddenCalls += 1; throw new Error('Real network is forbidden in model protocol tests.'); };
  try {
    for (const [baseUrl, protocol, expected] of [
      ['https://api.anthropic.com', undefined, 'anthropic'],
      ['https://api.anthropic.com/v1', 'auto', 'anthropic'],
      ['https://provider.example/claude/v1/messages', 'auto', 'anthropic'],
      ['http://127.0.0.1:1234/v1/messages/', 'auto', 'anthropic'],
      ['https://api.openai.com/v1', 'auto', 'openai'],
      ['https://api.deepseek.com', undefined, 'openai'],
      ['https://api.anthropic.com', 'openai', 'openai'],
      ['https://provider.example', 'anthropic', 'anthropic'],
      ['https://api.anthropic.com.evil.example', undefined, 'openai'],
      ['https://provider.example/v1/messages/other', undefined, 'openai'],
    ]) assert.equal(resolveModelProtocol({ baseUrl, protocol }), expected);
    for (const [baseUrl, expected] of [
      ['https://api.anthropic.com', 'https://api.anthropic.com/v1/messages'],
      ['https://api.anthropic.com/', 'https://api.anthropic.com/v1/messages'],
      ['https://api.anthropic.com/v1/', 'https://api.anthropic.com/v1/messages'],
      ['https://api.anthropic.com/v1/messages', 'https://api.anthropic.com/v1/messages'],
      ['https://api.anthropic.com/v1/messages/', 'https://api.anthropic.com/v1/messages'],
      ['https://api.anthropic.com/messages', 'https://api.anthropic.com/v1/messages'],
      ['https://api.anthropic.com/v1/messages/chat/completions', 'https://api.anthropic.com/v1/messages'],
      ['https://provider.example', 'https://provider.example/v1/messages'],
      ['https://provider.example/proxy/claude', 'https://provider.example/proxy/claude/v1/messages'],
      ['https://provider.example/proxy/v1', 'https://provider.example/proxy/v1/messages'],
      ['https://provider.example/proxy/v1/messages', 'https://provider.example/proxy/v1/messages'],
      ['http://localhost:1234/v1', 'http://localhost:1234/v1/messages'],
      ['http://[::1]:1234', 'http://[::1]:1234/v1/messages'],
    ]) assert.equal(anthropicMessagesUrl(baseUrl), expected);
    for (const baseUrl of ['http://provider.example/v1', 'ftp://provider.example', 'not-a-url', 'https://name:password@provider.example',
      'https://provider.example/?api_key=PRIVATE', 'https://provider.example/#PRIVATE']) {
      assert.throws(() => anthropicMessagesUrl(baseUrl), TypeError);
      assert.throws(() => resolveModelProtocol({ baseUrl }), TypeError);
    }
    assert.throws(() => resolveModelProtocol({ baseUrl: 'https://provider.example', protocol: 'unsupported' }), TypeError);
    assert.deepEqual(modelHeaders('openai', ` ${key} `), { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` });
    assert.deepEqual(modelHeaders('anthropic', ` ${key} `), { 'Content-Type': 'application/json', 'x-api-key': key,
      'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
    assert.equal(Object.hasOwn(modelHeaders('anthropic', key), 'Authorization'), false, 'Native keys use x-api-key only');
    assert.throws(() => modelHeaders('anthropic', ''), TypeError);
    assert.throws(() => modelHeaders('anthropic', 'fake\r\nInjected: value'), TypeError);

    const source = freeze({ ...request([
      { role: 'system', content: 'Primary instructions.' }, { role: 'system', content: 'Further instructions.' },
      { role: 'user', content: 'Find a metallic impact.' },
      { role: 'assistant', content: 'I will search.', tool_calls: [call(), call('toolu_SECOND', { query: 'bell' })] },
      { role: 'tool', tool_call_id: 'toolu_Case-sensitive-1', content: '{"items":["sound:123"]}' },
      { role: 'tool', tool_call_id: 'toolu_SECOND', content: '{"items":[]}' },
      { role: 'user', content: 'Return the final JSON.' },
    ]), apiKey: key, response_format: { type: 'json_object' }, reasoning_effort: 'none', thinking: { type: 'enabled', budget_tokens: 1024 }, stream: true });
    const native = toAnthropicRequest(source);
    assert.equal(native.model, 'claude-mock-local'); assert.equal(native.max_tokens, 768); assert.equal(native.stream, false);
    assert.equal(native.system, 'Primary instructions.\n\nFurther instructions.');
    assert.deepEqual(native.tools, [{ name: 'search_assets', description: tools[0].function.description, input_schema: schema }]);
    assert.deepEqual(native.tool_choice, { type: 'auto' });
    assert.equal(native.messages.length, 3);
    assert.deepEqual(native.messages[1], { role: 'assistant', content: [{ type: 'text', text: 'I will search.' },
      { type: 'tool_use', id: 'toolu_Case-sensitive-1', name: 'search_assets', input: { query: 'metal impact' } },
      { type: 'tool_use', id: 'toolu_SECOND', name: 'search_assets', input: { query: 'bell' } }] });
    assert.deepEqual(native.messages[2], { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'toolu_Case-sensitive-1', content: '{"items":["sound:123"]}' },
      { type: 'tool_result', tool_use_id: 'toolu_SECOND', content: '{"items":[]}' },
      { type: 'text', text: 'Return the final JSON.' }] });
    for (const field of ['max_completion_tokens', 'response_format', 'reasoning_effort', 'thinking', 'apiKey']) assert.equal(Object.hasOwn(native, field), false);
    assert.equal(JSON.stringify(native).includes(key), false, 'Keys and unknown wrapper fields never enter the model body');
    assert.deepEqual(toAnthropicRequest({ ...request([{ role: 'user', content: 'JSON only.' }]), max_tokens: 128, tool_choice: 'none' }).tool_choice, { type: 'none' });
    assert.equal(toAnthropicRequest({ ...request([{ role: 'user', content: 'Hi' }]), max_tokens: 128 }).max_tokens, 128, 'Preserve the caller token budget');

    const malformedRequests = [
      { ...request([{ role: 'user', content: 'Hi' }]), max_completion_tokens: 0 },
      { ...request([{ role: 'user', content: 'Hi' }]), max_completion_tokens: 1.5 },
      { ...request([{ role: 'user', content: 'Hi' }]), model: '' }, request([]), request([{ role: 'system', content: 'Only instructions.' }]),
      request([{ role: 'assistant', content: 'No preceding user.' }]), request([{ role: 'user', content: [{ type: 'text', text: 'Not a supported chat input.' }] }]),
      request([{ role: 'user', content: 'Hi' }, { role: 'tool', tool_call_id: 'unrelated', content: '{}' }]),
      request([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: null, tool_calls: [call()] }]),
      request([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: null, tool_calls: [call(), call()] }]),
      { ...request([{ role: 'user', content: 'Hi' }]), tool_choice: 'required' },
      { ...request([{ role: 'user', content: 'Hi' }]), tools: [{ type: 'function', function: { name: 'search_assets', parameters: [] } }] },
    ];
    for (const args of ['{query:"metal"}', '{"query":"metal",}', '{"query":', 'null', '[]', '42']) {
      malformedRequests.push(request([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: null,
        tool_calls: [{ ...call(), function: { name: 'search_assets', arguments: args } }] },
      { role: 'tool', tool_call_id: 'toolu_Case-sensitive-1', content: '{}' }]));
    }
    for (const value of malformedRequests) assert.throws(() => toAnthropicRequest(value), TypeError, 'Malformed native inputs fail before a network request; arguments are not repaired');

    const thoughtContent = freeze([
      { type: 'thinking', thinking: 'PRIVATE_REASONING_TEXT', signature: 'exact-signature/+=A', extra: 'retain-this-exactly' },
      { type: 'redacted_thinking', data: 'PRIVATE_REDACTED_DATA' }, { type: 'text', text: 'Searching the catalogue.' },
      { type: 'tool_use', id: 'toolu_Case-sensitive-1', name: 'search_assets', input: { query: 'metal impact' } },
    ]);
    const toolResponse = normalizeAnthropicResponse(response(thoughtContent, 'tool_use'));
    const choice = toolResponse.choices[0], message = choice.message;
    assert.equal(toolResponse.model, 'claude-mock-local'); assert.equal(choice.finish_reason, 'tool_calls');
    assert.equal(message.content, 'Searching the catalogue.'); assert.equal(message.tool_calls[0].id, 'toolu_Case-sensitive-1');
    assert.deepEqual(JSON.parse(message.tool_calls[0].function.arguments), { query: 'metal impact' });
    assert.deepEqual(message._anthropicContent, thoughtContent, 'Native thinking blocks remain complete and unmodified for internal replay');
    assert.doesNotMatch(JSON.stringify({ content: message.content, tool_calls: message.tool_calls }), /PRIVATE_REASONING_TEXT|PRIVATE_REDACTED_DATA|exact-signature/,
      'Visible content and function arguments never include reasoning or signatures');
    const replay = toAnthropicRequest(request([{ role: 'user', content: 'Find a metallic impact.' }, message,
      { role: 'tool', tool_call_id: 'toolu_Case-sensitive-1', content: '{"items":["sound:123"]}' }]));
    assert.deepEqual(replay.messages[1].content, thoughtContent);
    assert.equal(replay.messages[1].content[0].signature, 'exact-signature/+=A');
    assert.equal(replay.messages[2].content[0].tool_use_id, 'toolu_Case-sensitive-1');
    assert.throws(() => toAnthropicRequest(request([{ role: 'user', content: 'Hi' }, { ...message, tool_calls: [call('different-id')] },
      { role: 'tool', tool_call_id: 'different-id', content: '{}' }])), TypeError, 'Verified tool calls must match native content');

    const final = normalizeAnthropicResponse(response([{ type: 'thinking', thinking: 'PRIVATE_FINAL_REASONING', signature: 'signature-final' },
      { type: 'text', text: '{"answer":' }, { type: 'text', text: '"Ready","matches":[]}' }]));
    assert.equal(final.choices[0].finish_reason, 'stop');
    assert.deepEqual(JSON.parse(final.choices[0].message.content), { answer: 'Ready', matches: [] });
    assert.equal(Object.hasOwn(final.choices[0].message, 'tool_calls'), false);
    assert.equal(normalizeAnthropicResponse(response([{ type: 'text', text: 'Ready' }], 'stop_sequence')).choices[0].finish_reason, 'stop');
    for (const stopReason of ['max_tokens', 'model_context_window_exceeded']) {
      const truncated = normalizeAnthropicResponse(response([{ type: 'text', text: '{"answer":' }], stopReason));
      assert.equal(truncated.choices[0].finish_reason, 'length', 'Incomplete output keeps the truncation guard active');
    }
    const thinkingOnly = normalizeAnthropicResponse(response([{ type: 'thinking', thinking: 'PRIVATE', signature: 'signature' }], 'max_tokens'));
    assert.equal(thinkingOnly.choices[0].finish_reason, 'length'); assert.equal(thinkingOnly.choices[0].message.content, null);
    const refused = normalizeAnthropicResponse(response([{ type: 'text', text: 'I cannot answer this.' }], 'refusal'));
    assert.equal(refused.choices[0].finish_reason, 'content_filter'); assert.equal(refused.choices[0].message.refusal, 'I cannot answer this.');
    assert.equal(normalizeAnthropicResponse(response([{ type: 'text', text: 'Paused' }], 'pause_turn')).choices[0].finish_reason, 'pause_turn', 'Paused responses must not become a completed final answer');

    const malformedResponses = [{}, { type: 'error', error: { type: 'invalid_request_error', message: 'Native HTTP error envelope' } },
      { ...response([{ type: 'text', text: 'Hi' }]), role: 'user' }, { ...response([{ type: 'text', text: 'Hi' }]), model: '' },
      response([]), response({ type: 'text', text: 'Hi' }), response([{ type: 'text', text: 123 }]),
      response([{ type: 'thinking', thinking: 'Incomplete thinking block' }]), response([{ type: 'redacted_thinking', data: null }]),
      response([{ type: 'unsupported', text: 'Do not synthesize a final answer' }]), response([{ type: 'text', text: 'Hi' }], null),
      response([{ type: 'text', text: 'Hi' }], 'unknown_stop'), response([{ type: 'text', text: 'No actual tool call' }], 'tool_use'),
      response([{ type: 'tool_use', id: 'id', name: 'search_assets', input: [] }], 'tool_use'),
      response([{ type: 'tool_use', id: 'id', name: 'search_assets', input: {} }], 'end_turn'),
      response([{ type: 'tool_use', id: 'id', name: 'search_assets', input: {} }, { type: 'tool_use', id: 'id', name: 'search_assets', input: {} }], 'tool_use'),
    ];
    for (const value of malformedResponses) assert.throws(() => normalizeAnthropicResponse(value), TypeError, 'Malformed native envelopes do not turn into valid empty choices');

    let mockCalls = 0;
    const mockFetch = async (url, options) => {
      mockCalls += 1; assert.equal(url, 'https://api.anthropic.com/v1/messages'); assert.equal(options.headers['x-api-key'], key);
      const body = JSON.parse(options.body); assert.equal(body.max_tokens, 128); assert.equal(body.messages[0].role, 'user');
      return new Response(JSON.stringify(response([{ type: 'text', text: 'MOCK_OK' }])), { headers: { 'content-type': 'application/json' } });
    };
    const mocked = await mockFetch(anthropicMessagesUrl('https://api.anthropic.com'), { method: 'POST', headers: modelHeaders('anthropic', key),
      body: JSON.stringify(toAnthropicRequest({ model: 'claude-mock-local', max_tokens: 128, messages: [{ role: 'user', content: 'Reply MOCK_OK.' }] })) });
    assert.equal(normalizeAnthropicResponse(await mocked.json()).choices[0].message.content, 'MOCK_OK');
    assert.equal(mockCalls, 1); assert.equal(forbiddenCalls, 0);

    const site = 'https://site.example/api/ai-search', nativeEndpoint = 'https://api.anthropic.com/v1/messages';
    const config = { baseUrl: 'https://api.anthropic.com', model: 'claude-mock-local', apiKey: key, rememberKey: false, protocol: 'auto' };
    const resource = { resourceId: 'sound:123', id: '123', kind: 'sound', title: '金属撞击', description: '短促金属感撞击', keywords: ['金属', '撞击'], suggestedUses: [],
      duration: 0.8, hasAudio: true, locale: 'zh-CN', href: '/SoundEffectPlayer?id=123', featureText: '', audioText: '', suggestionText: '' };
    const finalResult = { answer: '这条是短促金属撞击。', matches: [{ resourceId: resource.resourceId, reason: '短促金属感撞击描述', matchType: 'feature' }] };
    const nativeToolContent = freeze([{ type: 'thinking', thinking: 'PRIVATE_SERVICE_REASONING', signature: 'exact-service-signature/+=A' },
      { type: 'text', text: 'Searching.' }, { type: 'tool_use', id: 'toolu_SearchCase-sensitive-1', name: 'search_assets', input: { query: '金属撞击', scope: 'sound' } }]);
    const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
    function serviceFixture(finalModelResponse) {
      const counts = { model: 0, worker: 0, prompt: 0 };
      const fetcher = async (url, options = {}) => {
        if (String(url).split('?')[0].endsWith('/AISearch/SystemPrompt.md')) {
          counts.prompt += 1;
          assert.equal(options.headers?.['x-api-key'], undefined); assert.equal(options.headers?.Authorization, undefined);
          return new Response('# Mock resource instructions\nReturn valid JSON and at most RESULT_LIMIT results.');
        }
        if (url === nativeEndpoint) {
          counts.model += 1;
          assert.deepEqual(options.headers, modelHeaders('anthropic', key));
          const sent = JSON.parse(options.body);
          assert.ok(Number.isInteger(sent.max_tokens) && sent.max_tokens > 0); assert.equal(sent.model, config.model);
          for (const field of ['max_completion_tokens', 'response_format', 'reasoning_effort', 'thinking']) assert.equal(Object.hasOwn(sent, field), false);
          assert.ok(typeof sent.system === 'string' && sent.system.length); assert.equal(sent.messages.some(message => message.role === 'system'), false);
          if (counts.model === 1) return json(response(nativeToolContent, 'tool_use'));
          assert.equal(counts.model, 2, 'No automatic retry or extra native model request');
          const assistant = sent.messages.find(message => message.role === 'assistant');
          assert.deepEqual(assistant.content, nativeToolContent, 'Service replays complete thinking and exact signatures only to Claude');
          const result = sent.messages.flatMap(message => message.content).find(block => block.type === 'tool_result');
          assert.equal(result.tool_use_id, 'toolu_SearchCase-sensitive-1');
          assert.match(result.content, /sound:123/);
          return finalModelResponse();
        }
        counts.worker += 1;
        assert.ok(url === `${site}/search` || url === `${site}/assets`, 'Only the selected Worker search/details endpoints are called');
        for (const header of ['x-api-key', 'Authorization', 'anthropic-version', 'anthropic-dangerous-direct-browser-access']) assert.equal(options.headers?.[header], undefined);
        assert.doesNotMatch(JSON.stringify(options), /mock-native-protocol-key|PRIVATE_SERVICE_REASONING|exact-service-signature|_anthropicContent/,
          'Keys and native reasoning never enter Worker retrieval');
        if (url.endsWith('/assets')) assert.deepEqual(JSON.parse(options.body).ids, [resource.resourceId]);
        return json({ catalogVersion: 'native-test-v1', mode: 'keyword', total: 1, items: [resource], hasMore: false });
      };
      return { fetcher, counts };
    }
    const payload = buildAgentSearchPayload('找金属撞击', 'zh-CN', 'sound', [], true, 'native-agent-mock');
    const successful = serviceFixture(() => json(response([{ type: 'thinking', thinking: 'PRIVATE_FINAL_REASONING', signature: 'private-final-signature' },
      { type: 'text', text: JSON.stringify(finalResult) }])));
    const answer = await requestAgentSearch(payload, { mode: 'custom', config, freeBase: site, signal: new AbortController().signal, fetcher: successful.fetcher });
    assert.equal(answer.matches[0].resourceId, resource.resourceId); assert.equal(answer.resources[0].resourceId, resource.resourceId);
    assert.doesNotMatch(JSON.stringify(answer), /PRIVATE_|signature|_anthropicContent/);
    assert.equal(successful.counts.model, 2); assert.equal(successful.counts.worker, 2, 'Search and final card hydration each execute once');

    const rejected = serviceFixture(() => json({ type: 'error', error: { type: 'invalid_request_error', message: `Mock native rejection ${key}` },
      content: nativeToolContent }, 400, { 'request-id': 'native-http-request-fake' }));
    let failure;
    try { await requestAgentSearch(payload, { mode: 'custom', config, freeBase: site, signal: new AbortController().signal, fetcher: rejected.fetcher }); }
    catch (error) { failure = error; }
    assert.ok(failure instanceof AISearchError); assert.equal(failure.code, 'MODEL_REQUEST_REJECTED');
    assert.equal(failure.requestDiagnostic.stage, 'model'); assert.equal(failure.requestDiagnostic.kind, 'http');
    assert.equal(failure.requestDiagnostic.status, 400); assert.equal(failure.requestDiagnostic.round, 2);
    assert.equal(failure.requestDiagnostic.requestId, 'native-http-request-fake');
    assert.doesNotMatch(JSON.stringify(failure.requestDiagnostic), /mock-native-protocol-key|PRIVATE_SERVICE_REASONING|exact-service-signature|_anthropicContent/);
    assert.equal(failure.rawResponse, undefined); assert.equal(rejected.counts.model, 2); assert.equal(rejected.counts.worker, 1);

    let legacyModel = 0;
    const legacy = await requestSearch(buildSearchPayload('找金属撞击', 'zh-CN', 'sound', [], [resource], 'native-legacy-mock'), [resource],
      { mode: 'custom', config, freeBase: site, signal: new AbortController().signal, fetcher: async (url, options = {}) => {
        if (String(url).split('?')[0].endsWith('/AISearch/SystemPrompt.md')) return new Response('# Mock legacy prompt\nReturn JSON.');
        assert.equal(url, nativeEndpoint); legacyModel += 1; assert.deepEqual(options.headers, modelHeaders('anthropic', key));
        const sent = JSON.parse(options.body); assert.ok(sent.system); assert.ok(sent.max_tokens > 0);
        return json(response([{ type: 'thinking', thinking: 'PRIVATE_LEGACY_REASONING', signature: 'private-legacy-signature' },
          { type: 'text', text: JSON.stringify(finalResult).replace(/}$/, ',}') }]));
      } });
    assert.equal(legacy.matches[0].resourceId, resource.resourceId); assert.equal(legacyModel, 1);
    assert.doesNotMatch(JSON.stringify(legacy), /PRIVATE_|signature|_anthropicContent/);
    assert.equal(forbiddenCalls, 0);
    console.log('PASS native Anthropic protocol: URL/header mapping, strict tool arguments, exact tool IDs and thinking replay, safe visible text, stop reasons, malformed envelopes. Mock-only; no real network or credentials.');
    console.log('PASS native service integration: Claude thinking survives tool rounds, verified IDs render cards, Worker/HTTP diagnostics exclude native reasoning, legacy final JSON repair remains supported.');
  } finally { global.fetch = previousFetch; }
})().catch(error => { console.error(error); process.exitCode = 1; });
