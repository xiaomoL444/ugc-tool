import { responsesInputBytes, toResponsesRequest } from './model-responses.mjs';
import { responsesFixture, responsesMessages } from './responses-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentPrompt, runAssetAgent } from './agent-runtime.mjs';
import { buildPrompt, callUpstream, validateModelResult } from './worker.mjs';
import { TEST_SYSTEM_PROMPT } from './system-prompt-fixture.mjs';

const config = { upstream: 'https://api.openai.com/v1/responses', model: 'gpt-4o-mini', maxOutputTokens: 5400,
  timeoutMs: 1000, agentTimeoutMs: 3000, inputRate: 1, outputRate: 1, costSafety: 1 };
const asset = { resourceId: 'sound:30001', kind: 'sound', title: '冲刺音效', description: '短促风声', keywords: [], suggestedUses: [] };
const match = { resourceId: asset.resourceId, reason: '短促风声', matchType: 'feature' };
const result = { answer: '已找到', matches: [match] };
const request = { query: '找冲刺音效', locale: 'zh-CN', scope: 'sound', messages: [{ role: 'assistant', content: 'Historical bgm:10128' }],
  previousIds: ['bgm:10128'], includeEffectAudio: false, resultLimit: 5 };
const response = message => new Response(JSON.stringify(responsesFixture({ choices: [{ finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }] })));

test('Worker agent constrains early completion to observed IDs and includes Schema in input reservation', async () => {
  const prompt = buildAgentPrompt(request, config, TEST_SYSTEM_PROMPT);
  let round = 0;
  const output = await runAssetAgent(request, prompt, config, {}, { search: async () => ({ items: [asset] }) }, validateModelResult, async (_url, init) => {
    const body = JSON.parse(init.body); round++;
    assert.equal(body.text?.format.type, 'json_schema'); assert.equal(body.text.format.strict, true);
    assert.equal(body.max_output_tokens, 800); assert.equal(Object.hasOwn(body, 'max_tokens'), false);
    const schema = body.text.format.schema;
    if (round === 1) {
      assert.equal(schema.properties.matches.maxItems, 0);
      assert.equal(prompt.inputBytes, responsesInputBytes(body));
      return response({ content: null, tool_calls: [{ id: 'strict-search-1', type: 'function', function: { name: 'search_assets', arguments: '{"query":"风声"}' } }] });
    }
    assert.deepEqual(schema.properties.matches.items.properties.resourceId.enum, [asset.resourceId], 'Historical BGM never joins this turn’s enum');
    assert.equal(body.tool_choice, 'auto', 'The second round can finish naturally');
    return response({ content: JSON.stringify({ ...result, clarification: false }) });
  });
  assert.equal(round, 2); assert.equal(output.outputConstraint, 'json_schema'); assert.deepEqual(output.result, result);
});

test('Worker candidate workflow sends strict Schema and accounts for its input bytes without retries', async () => {
  const normalized = { ...request, candidates: [asset] };
  const prompt = buildPrompt(normalized, config, TEST_SYSTEM_PROMPT);
  let calls = 0;
  const output = await callUpstream(normalized, prompt, config, {}, async (_url, init) => {
    calls++; const body = JSON.parse(init.body);
    assert.equal(body.max_output_tokens, 800);
    assert.equal(body.text.format.strict, true);
    assert.deepEqual(body.text.format.schema.properties.matches.items.properties.resourceId.enum, [asset.resourceId]);
    assert.equal(prompt.inputBytes, responsesInputBytes(body));
    return response({ content: JSON.stringify(result) });
  });
  assert.equal(calls, 1); assert.equal(output.outputConstraint, 'json_schema'); assert.deepEqual(output.result, result);
});

test('Strict provider output never bypasses Worker validation or causes a paid repair retry', async () => {
  const normalized = { ...request, candidates: [asset] };
  const prompt = buildPrompt(normalized, config, TEST_SYSTEM_PROMPT);
  let calls = 0;
  await assert.rejects(callUpstream(normalized, prompt, config, {}, async () => {
    calls++; return response({ content: JSON.stringify({ ...result, matches: [{ ...match, resourceId: 'bgm:10128' }] }) });
  }), error => /候选范围外或重复/u.test(error.message));
  assert.equal(calls, 1);
});
