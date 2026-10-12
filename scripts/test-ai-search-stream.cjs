/* Run: node scripts/test-ai-search-stream.cjs. Pure mocks; compilation and fixtures stay in memory. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { readModelStream, ModelStreamError } = require('../src/views/AISearch/modelStream.ts');
const { toResponsesRequest, normalizeResponsesResponse } = require('../tools/ai-search-service/model-responses.mjs');
const { toAnthropicRequest, normalizeAnthropicResponse } = require('../src/views/AISearch/modelProtocol.ts');
const encoder = new TextEncoder();
const secret = 'mock-private-stream-credential';
function envelope(text, status = 'completed') {
  return { object: 'response', model: 'mock-model', status, output: [
    { type: 'reasoning', id: 'reasoning-case', encrypted_content: 'PRIVATE_ENCRYPTED_REASONING' },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
  ], usage: { input_tokens: 123, output_tokens: 42, output_tokens_details: { reasoning_tokens: 12 } } };
}
const event = value => 'event: ' + value.type + '\r\ndata: ' + JSON.stringify(value) + '\r\n\r\n';
function responseFrom(source, stride = 13, onCancel = () => {}) {
  const bytes = encoder.encode(source);
  let offset = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset >= bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.slice(offset, offset + stride)); offset += stride;
  }, cancel: onCancel }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}
const responsesSource = (text, terminal, deltas = [text]) => event({ type: 'response.created', response: { status: 'in_progress' } })
  + event({ type: 'response.output_item.added', item: { type: 'reasoning' } })
  + deltas.map(delta => event({ type: 'response.output_text.delta', delta })).join('')
  + event({ type: 'response.' + terminal.status, response: terminal });
const isInvalid = error => error instanceof ModelStreamError && error.code === 'INVALID_RESPONSE';

(async () => {
  const oldFetch = global.fetch;
  let networkAttempts = 0;
  global.fetch = async () => { networkAttempts++; throw new Error('Real network forbidden in stream regressions'); };
  try {
    const input = { model: 'mock-model', messages: [{ role: 'user', content: 'hello' }] };
    assert.equal(toResponsesRequest(input).stream, false);
    assert.equal(toResponsesRequest({ ...input, stream: true }).stream, true);
    const native = { ...input, max_tokens: 128 };
    assert.equal(toAnthropicRequest(native).stream, false);
    assert.equal(toAnthropicRequest({ ...native, stream: true }).stream, true);
    const answer = JSON.stringify({ matches: [{ nested: { answer: 'NESTED_JSON_MUST_STAY_HIDDEN' } }], answer: '开始中文\n带有"引号"与😀。', sections: [] });
    const terminal = envelope(answer), updates = [];
    const result = await readModelStream(responseFrom(responsesSource(answer, terminal, Array.from(answer))), 'openai', undefined, update => updates.push(update));
    assert.deepEqual(result, terminal, 'Responses terminal retains native reasoning, encryption, usage, and output');
    assert.equal(normalizeResponsesResponse(result).choices[0].message.content, answer);
    assert.ok(updates.some(update => update.phase === 'waiting'));
    assert.ok(updates.some(update => update.phase === 'thinking'));
    assert.ok(updates.some(update => update.phase === 'generating' && update.answerPreview === '开始中文\n带有"引号"与😀。'));
    assert.equal(JSON.stringify(updates).includes('NESTED_JSON_MUST_STAY_HIDDEN'), false);
    assert.equal(JSON.stringify(updates).includes('PRIVATE_ENCRYPTED_REASONING'), false);
    assert.equal(JSON.stringify(updates).includes('"matches"'), false, 'Raw JSON and nested answer text are not previews');

    for (const credential of [secret, 'abcd-a']) {
      const content = JSON.stringify({ answer: '安全文本 ' + credential + ' 后续', matches: [] });
      const snapshots = [];
      await readModelStream(responseFrom(responsesSource(content, envelope(content), Array.from(content))), 'openai', undefined, update => snapshots.push(update), [credential]);
      assert.equal(JSON.stringify(snapshots).includes(credential), false);
      assert.equal(snapshots.some(update => (update.answerPreview || '').includes(credential.slice(0, credential.length - 1))), false, 'Unfinished known credentials cannot leak across delta boundaries');
      assert.ok(snapshots.at(-1).answerPreview.includes('[REDACTED]'));
    }
    const beforeComplete = new AbortController(), previewSnapshots = [];
    let responseController;
    const pending = new Response(new ReadableStream({ start(controller) { responseController = controller; } }), { headers: { 'content-type': 'text/event-stream' } });
    const reading = readModelStream(pending, 'openai', beforeComplete.signal, update => previewSnapshots.push(update));
    responseController.enqueue(encoder.encode(event({ type: 'response.output_text.delta', delta: '{"answer":"渐进预览' })));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(previewSnapshots.some(update => update.answerPreview === '渐进预览'), 'Useful preview appears before terminal completion');
    beforeComplete.abort(new DOMException('Stopped', 'AbortError'));
    await assert.rejects(reading, error => error.name === 'AbortError');

    const toolTerminal = { object: 'response', status: 'completed', output: [{ type: 'function_call', call_id: 'call-preserved', name: 'search_assets', arguments: '{"query":"short"}' }], usage: { input_tokens: 12, output_tokens: 8 } };
    assert.deepEqual(await readModelStream(responseFrom(event({ type: 'response.function_call_arguments.delta', delta: 'PRIVATE_TOOL_ARGUMENTS' }) + event({ type: 'response.completed', response: toolTerminal })), 'openai'), toolTerminal);
    for (const status of ['incomplete', 'failed']) {
      const value = envelope(answer, status);
      if (status === 'incomplete') value.incomplete_details = { reason: 'max_output_tokens' };
      else value.error = { message: 'PRIVATE_UPSTREAM_ERROR' };
      assert.deepEqual(await readModelStream(responseFrom(event({ type: 'response.' + status, response: value })), 'openai'), value);
    }
    await assert.rejects(() => readModelStream(responseFrom(event({ type: 'error', error: { message: secret } })), 'openai'), error => error.code === 'MODEL_STREAM_ERROR' && !error.message.includes(secret));
    await assert.rejects(() => readModelStream(responseFrom(event({ type: 'response.output_text.delta', delta: '{"answer":"unfinished' })), 'openai'), isInvalid);
    await assert.rejects(() => readModelStream(responseFrom('data: {invalid}\n\n'), 'openai'), isInvalid);
    await assert.rejects(() => readModelStream(responseFrom(': ' + 'x'.repeat(512 * 1024 + 1) + '\n\n' + event({ type: 'response.completed', response: terminal }), 65536), 'openai'), isInvalid);
    const pingFlood = ': ' + 'x'.repeat(50000) + '\n\n';
    await assert.rejects(() => readModelStream(responseFrom(pingFlood.repeat(340) + event({ type: 'response.completed', response: terminal }), 65536), 'openai'), isInvalid);
    const unicodeText = '中'.repeat(80000), unicodeEnvelope = envelope(unicodeText);
    assert.ok(JSON.stringify(unicodeEnvelope).length < 100000);
    assert.deepEqual(await readModelStream(responseFrom(responsesSource(unicodeText, unicodeEnvelope), 65536), 'openai'), unicodeEnvelope,
      'Streaming does not reject a UTF-8 envelope accepted by the existing 100K-character JSON limit');
    assert.deepEqual(await readModelStream(Response.json(terminal), 'openai'), terminal, 'Providers returning JSON retain fallback support');
    await assert.rejects(() => readModelStream(new Response(JSON.stringify({ text: 'x'.repeat(100000) })), 'openai'), isInvalid);
    let canceled = false;
    const abort = new AbortController();
    const stopped = readModelStream(new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { 'content-type': 'text/event-stream' } }), 'openai', abort.signal);
    await new Promise(resolve => setImmediate(resolve)); abort.abort(new DOMException('Search expired', 'TimeoutError'));
    await assert.rejects(stopped, error => error.name === 'TimeoutError'); assert.equal(canceled, true);

    const nativeEvents = [
      { type: 'message_start', message: { id: 'msg-case', type: 'message', role: 'assistant', model: 'claude-mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 55, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'PRIVATE_NATIVE_THINKING' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'PRIVATE_SIGNATURE' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu-preserved', name: 'search_assets', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"短雷声"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 22 } },
      { type: 'message_stop' },
    ];
    const nativeUpdates = [], nativeResult = await readModelStream(responseFrom(nativeEvents.map(event).join(''), 3), 'anthropic', undefined, update => nativeUpdates.push(update));
    assert.deepEqual(nativeResult.usage, { input_tokens: 55, output_tokens: 22 });
    assert.equal(nativeResult.content[0].signature, 'PRIVATE_SIGNATURE');
    assert.deepEqual(nativeResult.content[1].input, { query: '短雷声' });
    assert.equal(normalizeAnthropicResponse(nativeResult).choices[0].message.tool_calls[0].id, 'toolu-preserved');
    assert.equal(JSON.stringify(nativeUpdates).includes('PRIVATE_NATIVE_THINKING'), false);
    assert.ok(nativeUpdates.some(update => update.phase === 'thinking'));
    const finalNative = [nativeEvents[0], { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"answer":"你好' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '","matches":[]}' } },
      { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } }, { type: 'message_stop' }];
    const nativePreviews = [];
    const textResult = await readModelStream(responseFrom(finalNative.map(event).join(''), 1), 'anthropic', undefined, update => nativePreviews.push(update));
    assert.equal(textResult.stop_reason, 'end_turn'); assert.ok(nativePreviews.some(update => update.answerPreview === '你好'));
    await assert.rejects(() => readModelStream(responseFrom(finalNative.slice(0, -1).map(event).join('')), 'anthropic'), isInvalid);
    await assert.rejects(() => readModelStream(responseFrom([nativeEvents[0], nativeEvents[5], { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{bad}' } }, nativeEvents[8], nativeEvents[9], nativeEvents[10]].map(event).join('')), 'anthropic'), isInvalid);
    assert.equal(networkAttempts, 0);
    console.log('AI Search stream regressions passed (mock-only: native Responses/Anthropic envelopes, early safe previews, credential boundaries, cancellation, limits, errors, and JSON fallback).');
  } finally { global.fetch = oldFetch; }
})().catch(error => { console.error(error); process.exitCode = 1; });
