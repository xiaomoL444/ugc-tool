/* Run: node scripts/test-ai-search-model-probe.cjs. All provider responses are in-memory mocks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { probeCustomModel } = require('../src/views/AISearch/modelProbe.ts');
const { AISearchError } = require('../src/views/AISearch/aiSearchService.ts');
const fakeKey = 'mock-model-probe-key-not-real';
const nativeEnvelope = (model, content = [{ type: 'text', text: 'OK' }], stop_reason = 'end_turn') => ({
  id: 'msg_local_probe', type: 'message', role: 'assistant', model, content, stop_reason,
});
const openAIEnvelope = (model, content = 'OK', finish_reason = 'stop') => ({ model, choices: [{ message: { role: 'assistant', content }, finish_reason }] });
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
const nativeConfig = { baseUrl: 'https://api.anthropic.com', model: 'claude-mock-local', apiKey: fakeKey, rememberKey: false, protocol: 'auto' };
async function caught(run) {
  try { await run(); } catch (error) { return error; }
  assert.fail('Expected the mocked model validation to fail');
}
function diagnostic(error, kind, status) {
  assert.ok(error instanceof AISearchError); assert.equal(error.requestDiagnostic.stage, 'model'); assert.equal(error.requestDiagnostic.kind, kind);
  assert.equal(error.requestDiagnostic.round, 1);
  if (status !== undefined) assert.equal(error.requestDiagnostic.status, status);
  assert.equal(error.rawResponse, undefined, 'Probe failures do not archive HTTP bodies or generated reasoning as final response text');
  assert.doesNotMatch(JSON.stringify(error.requestDiagnostic), /mock-model-probe-key|PRIVATE_REASONING|PRIVATE_ENVELOPE|PRIVATE_QUERY|PRIVATE_SIGNATURE/);
  return error.requestDiagnostic;
}

(async () => {
  const originalFetch = global.fetch;
  let actualNetworkCalls = 0;
  global.fetch = async () => { actualNetworkCalls += 1; throw new Error('Real model APIs are forbidden in probe tests.'); };
  try {
    for (const fixture of [
      { config: { ...nativeConfig, model: ' claude-mock-local ' }, protocol: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages', returned: 'claude-mock-version' },
      { config: { ...nativeConfig, baseUrl: 'https://provider.example/claude', protocol: 'anthropic' }, protocol: 'anthropic', endpoint: 'https://provider.example/claude/v1/messages', returned: 'proxy-claude-mock' },
      { config: { ...nativeConfig, baseUrl: 'https://provider.example/claude/v1/messages' }, protocol: 'anthropic', endpoint: 'https://provider.example/claude/v1/messages', returned: 'native-auto-mock' },
      { config: { ...nativeConfig, baseUrl: 'https://api.openai.com/v1/responses', model: 'gpt-6-luna' }, protocol: 'openai', endpoint: 'https://api.openai.com/v1/chat/completions', returned: 'gpt-6-luna-mock-version', official: true },
      { config: { ...nativeConfig, baseUrl: 'https://provider.example/openai/v1', model: 'gpt-6-luna', protocol: 'openai' }, protocol: 'openai', endpoint: 'https://provider.example/openai/v1/chat/completions', returned: 'proxy-openai-mock' },
    ]) {
      let calls = 0;
      const result = await probeCustomModel(fixture.config, new AbortController().signal, async (url, options) => {
        calls += 1; assert.equal(url, fixture.endpoint, 'Probe sends directly to the selected model endpoint, without Worker, prompt, or asset requests');
        assert.equal(options.method, 'POST'); const body = JSON.parse(options.body);
        assert.equal(body.model, fixture.config.model.trim()); assert.equal(body.stream, false);
        assert.equal(body.messages.length, 1); assert.equal(body.messages[0].role, 'user');
        for (const field of ['tools', 'system', 'candidates', 'candidateIds', 'previousIds', 'response_format']) assert.equal(Object.hasOwn(body, field), false);
        assert.doesNotMatch(JSON.stringify(body), /mock-model-probe-key|resourceId|catalogVersion/);
        const token = fixture.official ? 'max_completion_tokens' : 'max_tokens'; assert.equal(body[token], 128);
        assert.equal(Object.hasOwn(body, fixture.official ? 'max_tokens' : 'max_completion_tokens'), false);
        if (fixture.protocol === 'anthropic') {
          assert.equal(options.headers['x-api-key'], fakeKey); assert.equal(options.headers.Authorization, undefined);
          assert.equal(options.headers['anthropic-version'], '2023-06-01'); assert.equal(options.headers['anthropic-dangerous-direct-browser-access'], 'true');
          assert.equal(Object.hasOwn(body, 'thinking'), false); assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
          return json(nativeEnvelope(fixture.returned, [{ type: 'thinking', thinking: 'PRIVATE_REASONING', signature: 'PRIVATE_SIGNATURE' }, { type: 'text', text: 'OK' }]));
        }
        assert.equal(options.headers.Authorization, `Bearer ${fakeKey}`); assert.equal(options.headers['x-api-key'], undefined);
        if (fixture.official) assert.equal(body.reasoning_effort, 'none'); else assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
        return json(openAIEnvelope(fixture.returned));
      });
      assert.equal(calls, 1, 'A manually initiated validation makes exactly one model POST, with no retries');
      assert.equal(result.requestedModel, fixture.config.model.trim()); assert.equal(result.returnedModel, fixture.returned);
      assert.equal(result.endpoint, fixture.endpoint); assert.equal(result.protocol, fixture.protocol);
      assert.ok(Number.isInteger(result.elapsedMs) && result.elapsedMs >= 0); assert.equal(result.replyTruncated, undefined);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_REASONING|PRIVATE_SIGNATURE|mock-model-probe-key|"reply"|"messages"/);
    }

    for (const [config, envelope] of [
      [nativeConfig, nativeEnvelope('claude-mock-local', [{ type: 'thinking', thinking: 'PRIVATE_REASONING', signature: 'PRIVATE_SIGNATURE' }], 'max_tokens')],
      [{ ...nativeConfig, baseUrl: 'https://api.openai.com', model: 'mock-thinking-model' }, openAIEnvelope('mock-thinking-model', null, 'length')],
    ]) {
      let calls = 0;
      const result = await probeCustomModel(config, new AbortController().signal, async () => { calls += 1; return json(envelope); });
      assert.equal(calls, 1); assert.equal(result.replyTruncated, true, 'The short generation budget can be accepted even when spent on thinking');
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_REASONING|PRIVATE_SIGNATURE/);
    }

    let badCalls = 0;
    const bad = await caught(() => probeCustomModel(nativeConfig, new AbortController().signal, async () => {
      badCalls += 1;
      return json({ type: 'error', error: { type: 'invalid_request_error', message: `Model rejected request ${fakeKey}`, param: 'model' },
        content: [{ type: 'thinking', thinking: 'PRIVATE_REASONING', signature: 'PRIVATE_SIGNATURE' }], privateEnvelope: 'PRIVATE_ENVELOPE' },
      400, { 'request-id': 'native-probe-request-fake' });
    }));
    assert.equal(bad.code, 'MODEL_REQUEST_REJECTED'); const badDiagnostic = diagnostic(bad, 'http', 400);
    assert.equal(badDiagnostic.requestId, 'native-probe-request-fake'); assert.equal(badDiagnostic.providerCode, 'invalid_request_error'); assert.equal(badDiagnostic.parameter, 'model');
    assert.match(badDiagnostic.providerMessage, /Model rejected request/); assert.equal(badCalls, 1);

    for (const [status, expectedCode] of [[401, 'AUTH'], [403, 'FORBIDDEN'], [404, 'MODEL_REQUEST_REJECTED'], [429, 'PROVIDER_RATE_LIMIT'], [503, 'MODEL_SERVICE_ERROR']]) {
      let calls = 0;
      const failure = await caught(() => probeCustomModel(nativeConfig, new AbortController().signal, async () => {
        calls += 1; return json({ type: 'error', error: { type: 'mock_native_error', message: 'Mock provider failure' } }, status);
      }));
      assert.equal(failure.code, expectedCode); diagnostic(failure, 'http', status); assert.equal(calls, 1);
    }

    let nonJSONCalls = 0;
    const nonJSON = await caught(() => probeCustomModel(nativeConfig, new AbortController().signal, async () => {
      nonJSONCalls += 1; return new Response('<html>PRIVATE_ENVELOPE</html>', { status: 400, headers: { 'request-id': 'native-non-json-fake' } });
    }));
    assert.equal(nonJSON.code, 'MODEL_REQUEST_REJECTED'); assert.equal(diagnostic(nonJSON, 'http', 400).requestId, 'native-non-json-fake'); assert.equal(nonJSONCalls, 1);

    let malformedCalls = 0;
    const malformed = await caught(() => probeCustomModel(nativeConfig, new AbortController().signal, async () => {
      malformedCalls += 1; return json({ ...nativeEnvelope('claude-mock-local'), content: [], privateEnvelope: 'PRIVATE_ENVELOPE' });
    }));
    assert.equal(malformed.code, 'INVALID_RESPONSE'); diagnostic(malformed, 'response', 200); assert.equal(malformedCalls, 1);

    const empty = await caught(() => probeCustomModel({ ...nativeConfig, baseUrl: 'https://api.openai.com', model: 'mock-model' }, new AbortController().signal,
      async () => json(openAIEnvelope('mock-model', ''))));
    assert.equal(empty.code, 'EMPTY_RESPONSE'); diagnostic(empty, 'response', 200);

    const network = await caught(() => probeCustomModel(nativeConfig, new AbortController().signal, async () => {
      throw new TypeError(`Failed to fetch ${fakeKey} https://username:password@provider.example/v1/messages?key=PRIVATE_QUERY`);
    }));
    diagnostic(network, 'network'); assert.doesNotMatch(JSON.stringify(network.requestDiagnostic), /username|password|PRIVATE_QUERY/);
    const controller = new AbortController();
    const timeout = await caught(() => probeCustomModel(nativeConfig, controller.signal, async () => { controller.abort(); throw new DOMException('Aborted', 'AbortError'); }));
    assert.equal(timeout.code, 'REQUEST_ABORTED'); diagnostic(timeout, 'timeout');

    const alreadyAborted = new AbortController(); alreadyAborted.abort();
    let preAbortCalls = 0;
    const preAbort = await caught(() => probeCustomModel(nativeConfig, alreadyAborted.signal, async () => { preAbortCalls += 1; return json(nativeEnvelope('claude-mock-local')); }));
    assert.equal(preAbort.name, 'AbortError'); assert.equal(preAbortCalls, 0, 'Already cancelled probes must not make a model request');

    const lateController = new AbortController(); let lateCalls = 0;
    const late = await caught(() => probeCustomModel(nativeConfig, lateController.signal, async () => {
      lateCalls += 1; lateController.abort(); return json(nativeEnvelope('claude-mock-local'));
    }));
    assert.equal(late.name, 'AbortError'); assert.equal(lateCalls, 1, 'A response arriving after cancellation must not show a successful connection');

    const bodyController = new AbortController(); let bodyCalls = 0, bodyRead = false;
    const duringBody = await caught(() => probeCustomModel(nativeConfig, bodyController.signal, async () => {
      bodyCalls += 1;
      const stream = new ReadableStream({ pull(reader) {
        bodyRead = true; bodyController.abort(); reader.enqueue(new TextEncoder().encode(JSON.stringify(nativeEnvelope('claude-mock-local')))); reader.close();
      } }, { highWaterMark: 0 });
      assert.equal(bodyRead, false);
      return new Response(stream, { headers: { 'content-type': 'application/json' } });
    }));
    assert.equal(bodyRead, true); assert.equal(duringBody.name, 'AbortError'); assert.equal(bodyCalls, 1, 'A response body read completing after cancellation is discarded');

    const echoedIdentity = await probeCustomModel({ ...nativeConfig, model: fakeKey }, new AbortController().signal,
      async () => json(nativeEnvelope(`alias-${fakeKey}`)));
    assert.doesNotMatch(JSON.stringify(echoedIdentity), /mock-model-probe-key/);

    for (const config of [{ ...nativeConfig, apiKey: '' }, { ...nativeConfig, apiKey: `${fakeKey}\r\nInjected: value` },
      { ...nativeConfig, model: '' }, { ...nativeConfig, baseUrl: 'https://provider.example/?api_key=PRIVATE_QUERY' }]) {
      let calls = 0;
      const invalid = await caught(() => probeCustomModel(config, new AbortController().signal, async () => { calls += 1; throw new Error('Must not fetch invalid configurations.'); }));
      assert.equal(invalid.code, 'CONFIG'); assert.equal(calls, 0);
    }
    assert.equal(actualNetworkCalls, 0);
    console.log('PASS model validation: one real-shaped mock POST, 128-token budget, native/OpenAI metadata and compatibility, no Worker/assets/prompt/history, safe HTTP/response/network/timeout diagnostics, no retry. No actual network or keys.');
  } finally { global.fetch = originalFetch; }
})().catch(error => { console.error(error); process.exitCode = 1; });
