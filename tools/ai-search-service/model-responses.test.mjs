import test from 'node:test';
import assert from 'node:assert/strict';
import { responsesUrl, toResponsesRequest, normalizeResponsesResponse, responsesInputBytes } from './model-responses.mjs';
import { detectModelOutput, modelOutputOptions } from './model-output-policy.mjs';

const response = output => ({ object: 'response', status: 'completed', model: 'gpt-6.1-sol', output });
const call = { type: 'function_call', id: 'fc_case', call_id: 'call_Case-1', name: 'search_assets', arguments: '{"query":"metal"}', status: 'completed' };
const reasoning = { type: 'reasoning', id: 'rs_case', summary: [], encrypted_content: 'opaque-reasoning-fixture' };
const tool = { type: 'function', function: { name: 'search_assets', description: 'Search', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] } } };

test('Responses endpoint migration preserves provider prefixes and accepts old saved Chat URLs', () => {
  for (const [base, target] of [
    ['https://api.openai.com', 'https://api.openai.com/v1/responses'],
    ['https://api.openai.com/v1/chat/completions/', 'https://api.openai.com/v1/responses'],
    ['https://api.openai.com/v1/responses/chat/completions', 'https://api.openai.com/v1/responses'],
    ['https://api.deepseek.com/v1/chat/completions', 'https://api.deepseek.com/responses'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'https://dashscope.aliyuncs.com/compatible-mode/v1/responses'],
    ['https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/responses'],
    ['https://ark.cn-beijing.volces.com/api/v3/chat/completions', 'https://ark.cn-beijing.volces.com/api/v3/responses'],
    ['https://proxy.example/custom/v1/responses', 'https://proxy.example/custom/v1/responses'],
  ]) assert.equal(responsesUrl(base), target);
  for (const base of ['http://provider.example', 'https://user:key@provider.example', 'https://provider.example?key=secret']) assert.throws(() => responsesUrl(base));
});

test('Responses schema, optional function parameters and encrypted reasoning replay use native wire fields', () => {
  const policy = detectModelOutput({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-6.1-sol' });
  const normalized = normalizeResponsesResponse(response([reasoning, call]));
  const assistant = normalized.choices[0].message;
  assert.equal(assistant.content, null); assert.equal(assistant.tool_calls[0].id, call.call_id, 'Pair by call_id, never by item id');
  const payload = toResponsesRequest({ model: policy.provider === 'openai' ? 'gpt-6.1-sol' : '', max_tokens: 1400, tools: [tool], tool_choice: 'auto',
    messages: [{ role: 'user', content: 'Find a sound' }, assistant, { role: 'tool', tool_call_id: call.call_id, content: '{"items":["sound:50514"]}' }],
    ...modelOutputOptions(policy, ['sound:50514'], 10, true) }, 'https://api.openai.com/v1/responses');
  assert.equal(payload.max_output_tokens, 1400); assert.equal(payload.store, false);
  assert.deepEqual(payload.include, ['reasoning.encrypted_content']);
  assert.deepEqual(payload.input.slice(1, 3), [reasoning, call]);
  assert.deepEqual(payload.input.at(-1), { type: 'function_call_output', call_id: call.call_id, output: '{"items":["sound:50514"]}' });
  assert.equal(payload.tools[0].name, 'search_assets'); assert.equal(payload.tools[0].strict, false, 'Responses strict defaults must not make optional search fields mandatory');
  assert.deepEqual(payload.tools[0].parameters.required, ['query']);
  assert.equal(payload.text.format.type, 'json_schema'); assert.equal(payload.text.format.strict, true);
  assert.deepEqual(payload.text.format.schema.properties.matches.items.properties.resourceId.enum, ['sound:50514']);
  for (const field of ['messages', 'response_format', 'max_tokens', 'max_completion_tokens', 'reasoning_effort', 'previous_response_id']) assert.equal(Object.hasOwn(payload, field), false);
  assert.equal(responsesInputBytes(payload), Buffer.byteLength(JSON.stringify({ input: payload.input, tools: payload.tools, text: payload.text })));
  assert.throws(() => toResponsesRequest({ model: 'gpt-6.1-sol', max_tokens: 100, messages: [assistant] }));
  assert.throws(() => toResponsesRequest({ model: 'gpt-6.1-sol', max_tokens: 100, messages: [{ ...assistant, tool_calls: [{ ...assistant.tool_calls[0], id: 'wrong' }] }, { role: 'tool', tool_call_id: 'wrong', content: '{}' }] }));
});

test('Responses parsing keeps only answer text visible and handles usage, refusal, truncation and invalid calls', () => {
  const answer = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"answer":"OK",' }, { type: 'output_text', text: '"matches":[]}' }] };
  const normalized = normalizeResponsesResponse({ ...response([reasoning, answer]), usage: { input_tokens: 20, output_tokens: 10, output_tokens_details: { reasoning_tokens: 5 } } });
  assert.equal(normalized.choices[0].message.content, '{"answer":"OK","matches":[]}');
  assert.deepEqual(normalized.usage, { prompt_tokens: 20, completion_tokens: 10 });
  const incomplete = normalizeResponsesResponse({ ...response([reasoning, answer]), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } });
  assert.equal(incomplete.choices[0].finish_reason, 'length');
  const refused = normalizeResponsesResponse(response([{ ...answer, content: [{ type: 'refusal', refusal: 'Cannot answer' }] }]));
  assert.equal(refused.choices[0].message.refusal, 'Cannot answer');
  assert.throws(() => normalizeResponsesResponse({ ...response([]), status: 'failed', error: { message: 'private' } }));
  assert.throws(() => normalizeResponsesResponse(response([call, call])));
  assert.throws(() => normalizeResponsesResponse(response([{ ...call, call_id: '' }])));
  assert.throws(() => normalizeResponsesResponse(response([{ type: 'web_search_call' }])));
  assert.throws(() => normalizeResponsesResponse({ choices: [] }), 'Chat envelopes no longer accepted');
});

test('Responses output limits are optional while explicit budgets remain validated', () => {
  const request = { model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'Return JSON.' }] };
  const unconstrained = toResponsesRequest(request, 'https://api.openai.com/v1/responses');
  for (const field of ['max_output_tokens', 'max_completion_tokens', 'max_tokens']) assert.equal(Object.hasOwn(unconstrained, field), false);
  assert.deepEqual(unconstrained.input, [{ role: 'user', content: 'Return JSON.' }]);
  for (const field of ['max_output_tokens', 'max_completion_tokens', 'max_tokens']) {
    assert.equal(toResponsesRequest({ ...request, [field]: 1400 }).max_output_tokens, 1400, 'Explicit Worker budgets survive conversion');
    for (const limit of [null, 0, -1, 1.5, '1400', NaN, Infinity]) {
      assert.throws(() => toResponsesRequest({ ...request, [field]: limit }), TypeError, `Reject invalid explicit ${field}`);
    }
  }
});

test('Provider formats stay in Responses text.format and do not assume Chat schema support', () => {
  const deepseek = detectModelOutput({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' });
  const format = modelOutputOptions(deepseek, ['sound:1'], 10).text.format;
  assert.equal(format.type, 'json_schema'); assert.equal(format.name, 'asset_search_result');
  assert.equal(Object.hasOwn(format, 'strict'), false, 'DeepSeek documents schema but not the strict option');
  const request = { model: 'deepseek-flash', max_tokens: 128, messages: [{ role: 'user', content: 'JSON' }], thinking: { type: 'disabled' } };
  const deepseekWire = toResponsesRequest(request, 'https://api.deepseek.com/responses');
  assert.deepEqual(deepseekWire.reasoning, { effort: 'none' }); assert.equal(Object.hasOwn(deepseekWire, 'thinking'), false);
  const openaiWire = toResponsesRequest({ ...request, model: 'gpt-6.1-sol' }, 'https://api.openai.com/v1/responses');
  assert.equal(Object.hasOwn(openaiWire, 'reasoning'), false); assert.equal(Object.hasOwn(openaiWire, 'thinking'), false);
  const qwen = detectModelOutput({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-max' });
  assert.equal(qwen.mode, 'prompt', 'Unlisted parameters can be ignored by this provider');
  const manual = detectModelOutput({ baseUrl: 'https://proxy.example/v1', model: 'qwen3.8-max', outputMode: 'json_object' });
  assert.deepEqual(modelOutputOptions(manual, [], 10), { text: { format: { type: 'json_object' } } });
});
