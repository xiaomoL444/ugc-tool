/* Offline custom-model stream integration. No real fetches or generated files. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { responsesFixture } = require('../tools/ai-search-service/responses-fixture.mjs');
const { buildSearchPayload, requestSearch, AISearchError } = require('../src/views/AISearch/aiSearchService.ts');
const resource = { resourceId: 'sound:1', id: '1', kind: 'sound', title: 'Trusted sound', description: 'Short bright tone',
  locale: 'zh-CN', featureText: 'Short bright tone', audioText: '', suggestionText: '', keywords: [], suggestedUses: [], href: '/SoundEffectPlayer?id=1' };
const config = { baseUrl: 'https://fixture.invalid/v1', model: 'fixture-stream-model', apiKey: 'fixture-stream-key-only', rememberKey: false };
const value = (resourceId = resource.resourceId) => ({ answer: '逐步显示答案', matches: [{ resourceId, reason: '短促明亮', matchType: 'feature' }], sections: [] });
const envelope = result => responsesFixture({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] });
const options = { mode: 'custom', config, freeBase: '/api/ai-search', signal: new AbortController().signal };
const payload = buildSearchPayload('结算音效', 'zh-CN', 'sound', [], [resource], 'stream-integration');
const event = data => new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
const fixtureFetch = route => async (url, input) => {
  if (String(url).split('?')[0].endsWith('/AISearch/SystemPrompt.md')) return new Response('Return at most RESULT_LIMIT resources.');
  assert.ok(String(url).endsWith('/responses'), `Unexpected route: ${url}`);
  return route(input);
};
const flush = () => new Promise(resolve => setImmediate(resolve));
async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 50; attempt++) { if (predicate()) return; await flush(); }
  throw new Error('Offline stream state did not settle.');
}

(async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('Real network is forbidden.'); };
  try {
    let streamController, settled = false;
    const updates = [];
    const pending = requestSearch(payload, [resource], { ...options, onProgress: update => updates.push(update), fetcher: fixtureFetch(input => {
      assert.equal(JSON.parse(input.body).stream, true);
      return new Response(new ReadableStream({ start(controller) { streamController = controller; } }), { headers: { 'content-type': 'text/event-stream' } });
    }) });
    pending.then(() => { settled = true; }, () => { settled = true; });
    await waitUntil(() => streamController);
    streamController.enqueue(event({ type: 'response.created', response: { object: 'response', status: 'in_progress', output: [] } }));
    streamController.enqueue(event({ type: 'response.output_text.delta', delta: '{"answer":"逐步' }));
    await waitUntil(() => updates.some(update => update.phase === 'generating' && update.answerPreview?.includes('逐步')));
    assert.equal(settled, false, 'Progress arrives before the complete response and validation');
    assert.ok(updates.every(update => !JSON.stringify(update).includes(config.apiKey)));
    streamController.enqueue(event({ type: 'response.completed', response: envelope(value()) }));
    streamController.close();
    const result = await pending;
    assert.equal(result.answer, value().answer);
    assert.equal(result.matches[0].resourceId, resource.resourceId);

    await assert.rejects(requestSearch(payload, [resource], { ...options, fetcher: fixtureFetch(() => new Response(
      event({ type: 'response.completed', response: envelope(value('sound:999999')) }), { headers: { 'content-type': 'text/event-stream' } }
    )) }), error => error instanceof AISearchError && error.code === 'RESPONSE_ASSET_ID');

    await assert.rejects(requestSearch(payload, [resource], { ...options, fetcher: fixtureFetch(() => new Response(
      event({ type: 'error', error: { message: `private ${config.apiKey}`, type: 'server_error' } }), { headers: { 'content-type': 'text/event-stream' } }
    )) }), error => {
      assert.equal(error.code, 'MODEL_SERVICE_ERROR');
      assert.equal(error.requestDiagnostic.stage, 'model');
      assert.equal(error.requestDiagnostic.kind, 'response');
      assert.ok(!JSON.stringify(error).includes(config.apiKey));
      return true;
    });

    const attempts = [];
    const fallback = await requestSearch(payload, [resource], { ...options, fetcher: fixtureFetch(input => {
      const request = JSON.parse(input.body); attempts.push(request.stream);
      return request.stream ? Response.json({ error: { message: 'Unsupported parameter: stream', param: 'stream' } }, { status: 400 }) : Response.json(envelope(value()));
    }) });
    assert.deepEqual(attempts, [true, false], 'Only explicit unsupported-stream rejection permits a non-streaming request');
    assert.equal(fallback.matches.length, 1);
    for (const status of [401, 429, 500]) {
      let count = 0;
      await assert.rejects(requestSearch(payload, [resource], { ...options, fetcher: fixtureFetch(() => {
        count++; return Response.json({ error: { message: 'Fixture failure' } }, { status });
      }) }));
      assert.equal(count, 1, `HTTP ${status} does not trigger a retry`);
    }
    const ignored = await requestSearch(payload, [resource], { ...options, fetcher: fixtureFetch(() => Response.json(envelope(value()))) });
    assert.equal(ignored.matches.length, 1, 'Compatible gateways that ignore stream keep returning validated JSON');
    console.log('Custom-model stream integration passed: early progress, final ID validation, safe errors, explicit compatibility fallback, no result retries.');
  } finally { global.fetch = originalFetch; }
})().catch(error => { console.error(error); process.exitCode = 1; });
