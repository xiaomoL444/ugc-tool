const { responsesFixture } = require('../tools/ai-search-service/responses-fixture.mjs');
/* Mock-only provider constraints. No credentials, real network, or generated repo artifacts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { detectModelOutput, modelOutputOptions, searchAnswerSchema, outputThinkingOptions, isOutputConstraintRejection } = require('../tools/ai-search-service/model-output-policy.mjs');
const { requestSearch, buildSearchPayload, fetchConstrainedModel } = require('../src/views/AISearch/aiSearchService.ts');
const { requestAgentSearch, buildAgentSearchPayload } = require('../src/views/AISearch/agentSearchService.ts');
const { toAnthropicRequest } = require('../src/views/AISearch/modelProtocol.ts');
const { restoreConversations } = require('../src/views/AISearch/useAISearch.ts');
const key = 'mock-output-key-not-real';
const config = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: key, rememberKey: false };
const resource = { resourceId: 'sound:30001', id: '30001', kind: 'sound', title: '冲刺音效', description: '短促风声', keywords: [], suggestedUses: [],
  href: '/SoundEffectPlayer?id=30001', locale: 'zh-CN', featureText: '', audioText: '', suggestionText: '' };
const match = { resourceId: resource.resourceId, reason: '短促风声', matchType: 'feature' };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const reply = value => json(responsesFixture({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
const final = () => reply({ answer: '已找到', matches: [match] });
const promptResponse = () => new Response('Return one JSON object. At most RESULT_LIMIT matches.');
const rejection = (message, status = 400) => new Response(JSON.stringify({ error: { message } }), { status });
const signal = () => new AbortController().signal;

(async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('Real network is forbidden.'); };
  try {
    for (const [baseUrl, model, provider, mode] of [
      [config.baseUrl, 'gpt-4o-mini', 'openai', 'json_schema'],
      [config.baseUrl, 'gpt-4o-2024-05-13', 'openai', 'json_object'],
      [config.baseUrl, 'gpt-4o-2024-08-06', 'openai', 'json_schema'],
      [config.baseUrl, 'gpt-4-turbo', 'openai', 'json_object'],
      [config.baseUrl, 'o1-preview', 'openai', 'prompt'],
      [config.baseUrl, 'gpt-6-luna', 'openai', 'json_schema'],
      ['https://api.deepseek.com/v1', 'deepseek-chat', 'deepseek', 'json_object'],
      ['https://api.deepseek.com/v1', 'deepseek-reasoner', 'deepseek', 'json_object'],
      ['https://api.deepseek.com', 'deepseek-flash', 'deepseek', 'json_schema'],
      ['https://ark.cn-beijing.volces.com/api/v3', 'doubao-seed-2-1-pro-260915', 'doubao', 'json_schema'],
      ['https://api.anthropic.com/v1', 'claude-sonnet-4-5', 'claude', 'json_schema'],
      ['https://api.anthropic.com/v1', 'claude-3-5-sonnet-latest', 'claude', 'prompt'],
      ['https://proxy.example/v1', 'claude-sonnet-4-5', 'claude', 'json_object'],
      ['https://proxy.example/v1/messages', 'claude-sonnet-4-5', 'claude', 'json_schema'],
      ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-flash', 'qwen', 'prompt'],
      ['https://cn-beijing.maas.aliyuncs.com/compatible-mode/v1', 'qwen3.7-plus', 'qwen', 'prompt'],
      ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'deepseek-v4-pro', 'deepseek', 'json_object'],
      ['https://proxy.example/v1', 'openai/gpt-4o-mini', 'openai', 'json_schema'],
      ['https://api.openai.com.evil.example/v1', 'custom-model', 'unknown', 'prompt'],
      ['https://api.deepseek.com.evil.example/v1', 'custom-model', 'unknown', 'prompt'],
      ['incomplete', '', 'unknown', 'prompt'],
    ]) {
      const policy = detectModelOutput({ baseUrl, model });
      assert.equal(policy.provider, provider, model); assert.equal(policy.mode, mode, model);
    }
    assert.equal(detectModelOutput({ ...config, baseUrl: 'https://proxy.example/v1' }).inferred, true);
    assert.equal(detectModelOutput({ ...config, outputMode: 'prompt' }).mode, 'prompt');
    assert.equal(detectModelOutput({ ...config, outputMode: 'invalid' }).requested, 'auto');
    assert.deepEqual(outputThinkingOptions({ baseUrl: 'https://dashscope.aliyuncs.com/v1', model: 'qwen-flash' }), { enable_thinking: false });
    assert.deepEqual(outputThinkingOptions({ ...config, baseUrl: 'https://proxy.example/v1' }), {});
    const schema = searchAnswerSchema(['sound:30001', 'sound:30001', 'bgm:10128', 'bad'], 5, true);
    assert.deepEqual(schema.properties.matches.items.properties.resourceId.enum, ['sound:30001', 'bgm:10128']);
    assert.equal(schema.properties.matches.maxItems, 5);
    assert.deepEqual(schema.required, ['answer', 'matches', 'clarification']);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.matches.items.additionalProperties, false);
    assert.equal(searchAnswerSchema([], 5, true).properties.matches.maxItems, 0);
    assert.equal(Object.hasOwn(searchAnswerSchema(['sound:30001'], 5, true, true).properties.matches, 'maxItems'), false);

    const nativePolicy = detectModelOutput({ baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' });
    const native = toAnthropicRequest({ model: 'claude-sonnet-4-5', max_tokens: 1000,
      messages: [{ role: 'user', content: 'JSON please.' }], ...modelOutputOptions(nativePolicy, [resource.resourceId], 5) });
    assert.equal(native.output_config.format.type, 'json_schema');
    assert.deepEqual(native.output_config.format.schema.properties.matches.items.properties.resourceId.enum, [resource.resourceId]);
    assert.equal(Object.hasOwn(native, 'response_format'), false);

    const payload = buildSearchPayload('找冲刺音效', 'zh-CN', 'sound', [], [resource], 'strict-fixture', 5);
    let candidateCalls = 0;
    const answer = await requestSearch(payload, [resource], { mode: 'custom', config, freeBase: '/api/ai-search', signal: signal(), fetcher: async (url, init) => {
      if (String(url).split('?')[0].endsWith('/AISearch/SystemPrompt.md')) return promptResponse();
      candidateCalls++; const sent = JSON.parse(init.body);
      assert.equal(sent.text?.format.type, 'json_schema'); assert.equal(sent.text.format.strict, true);
      assert.deepEqual(sent.text.format.schema.properties.matches.items.properties.resourceId.enum, [resource.resourceId]);
      assert.equal(init.body.includes(key), false); return final();
    } });
    assert.equal(candidateCalls, 1); assert.equal(answer.outputConstraint, 'json_schema');

    const claude = await requestSearch(payload, [resource], { mode: 'custom', config: { ...config, baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' },
      freeBase: '/api', signal: signal(), fetcher: async (url, init) => {
        if (String(url).split('?')[0].endsWith('/AISearch/SystemPrompt.md')) return promptResponse();
        const sent = JSON.parse(init.body);
        assert.equal(sent.output_config.format.type, 'json_schema');
        assert.deepEqual(sent.output_config.format.schema.properties.matches.items.properties.resourceId.enum, [resource.resourceId]);
        assert.equal(Object.hasOwn(sent, 'response_format'), false);
        return json({ type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify({ answer: '已找到', matches: [match] }) }] });
      } });
    assert.equal(claude.outputConstraint, 'json_schema');

    let round = 0;
    const agentPayload = buildAgentSearchPayload('找冲刺音效', 'zh-CN', 'sound', [], false, 'agent-strict', 5);
    const agent = await requestAgentSearch(agentPayload, { mode: 'custom', config, freeBase: 'https://assets.example', signal: signal(), fetcher: async (url, init) => {
      if (String(url).split('?')[0].endsWith('/AISearch/SystemPrompt.md')) return promptResponse();
      if (String(url).endsWith('/search')) return json({ catalogVersion: 'v1', mode: 'keyword', total: 1, items: [resource], hasMore: false });
      if (String(url).endsWith('/assets')) return json({ catalogVersion: 'v1', items: [resource], missingIds: [] });
      const sent = JSON.parse(init.body); round++;
      assert.equal(sent.text?.format.type, 'json_schema', 'Every round constrains a possible final answer');
      const matchSchema = sent.text.format.schema.properties.matches;
      if (round === 1) {
        assert.equal(matchSchema.maxItems, 0);
        return json(responsesFixture({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'call-1', type: 'function',
          function: { name: 'search_assets', arguments: JSON.stringify({ query: '风声', scope: 'sound' }) } }] } }] }));
      }
      assert.deepEqual(matchSchema.items.properties.resourceId.enum, [resource.resourceId]);
      return reply({ answer: '已找到', matches: [match], clarification: false });
    } });
    assert.equal(round, 2, 'Natural early completion remains constrained without an extra model call');
    assert.equal(agent.outputConstraint, 'json_schema'); assert.equal(agent.matches[0].resourceId, resource.resourceId);

    const context = { stage: 'model', endpoint: 'https://proxy.example/v1/responses', model: config.model, round: 1, startedAt: Date.now() };
    const baseRequest = { model: config.model, messages: [{ role: 'user', content: 'Return JSON.' }] };
    let attempts = 0;
    const downgraded = await fetchConstrainedModel(context.endpoint, baseRequest, detectModelOutput(config), [resource.resourceId], 5, context, signal(), key, async (_url, init) => {
      const sent = JSON.parse(init.body); attempts++;
      for (const field of ['max_output_tokens', 'max_completion_tokens', 'max_tokens']) assert.equal(Object.hasOwn(sent, field), false, 'Format compatibility retries cannot reintroduce an output quota');
      if (attempts === 1) { assert.equal(sent.text?.format.type, 'json_schema'); return rejection('response_format json_schema is not supported'); }
      if (attempts === 2) { assert.equal(sent.text?.format.type, 'json_object'); return rejection('response_format json_object is unsupported'); }
      assert.equal(Object.hasOwn(sent, 'response_format'), false); return final();
    });
    assert.equal(attempts, 3); assert.equal(downgraded.policy.mode, 'prompt');
    for (const [status, message] of [[401, 'unsupported json_schema'], [429, 'unsupported json_schema'], [500, 'unsupported json_schema'],
      [400, 'invalid schema: additionalProperties required'], [400, 'model unsupported'], [400, 'tools are unsupported']]) {
      let calls = 0;
      const failed = await fetchConstrainedModel(context.endpoint, baseRequest, detectModelOutput(config), [resource.resourceId], 5, context, signal(), key,
        async () => { calls++; return rejection(message, status); });
      assert.equal(calls, 1); assert.equal(failed.response.status, status);
    }
    assert.equal(isOutputConstraintRejection(400, 'JSON schema is too complex; structured outputs unsupported'), false);
    let explicitCalls = 0;
    await fetchConstrainedModel(context.endpoint, baseRequest, detectModelOutput({ ...config, outputMode: 'json_schema' }), [], 5, context, signal(), key,
      async () => { explicitCalls++; return rejection('json_schema unsupported'); });
    assert.equal(explicitCalls, 1, 'Explicit user overrides never silently downgrade');
    const controller = new AbortController(); let cancelledCalls = 0;
    await assert.rejects(fetchConstrainedModel(context.endpoint, baseRequest, detectModelOutput(config), [], 5, context, controller.signal, key,
      async () => { cancelledCalls++; controller.abort(); return rejection('json_schema unsupported'); }), error => error.name === 'AbortError');
    assert.equal(cancelledCalls, 1);
    const bodyController = new AbortController(); let bodyCalls = 0;
    const timer = setTimeout(() => bodyController.abort(), 20);
    try {
      await assert.rejects(fetchConstrainedModel(context.endpoint, baseRequest, detectModelOutput(config), [], 5, context, bodyController.signal, key,
        async () => { bodyCalls++; return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"error":')); } }), { status: 400 }); }),
      error => error.name === 'AbortError');
      assert.equal(bodyCalls, 1, 'A stalled error body cannot prevent cancellation or trigger another request');
    } finally { clearTimeout(timer); }

    // Strict provider claims never bypass the application's ID and duplicate checks.
    for (const matches of [[{ ...match, resourceId: 'bgm:10128' }], [match, { ...match, reason: '另一理由' }]]) {
      let calls = 0;
      await assert.rejects(requestSearch(payload, [resource], { mode: 'custom', config, freeBase: '/api', signal: signal(), fetcher: async url => {
        if (String(url).split('?')[0].endsWith('/AISearch/SystemPrompt.md')) return promptResponse();
        calls++; return reply({ answer: '错误结果', matches });
      } }), error => error.code === 'RESPONSE_ASSET_ID' && error.displayResult?.cards.length === matches.length);
      assert.equal(calls, 1, 'Invalid generated results are not retried');
    }
    let proseCalls = 0;
    await assert.rejects(requestSearch(payload, [resource], { mode: 'custom', config, freeBase: '/api', signal: signal(), fetcher: async url => {
      if (String(url).split('?')[0].endsWith('/AISearch/SystemPrompt.md')) return promptResponse();
      proseCalls++; return json(responsesFixture({ choices: [{ finish_reason: 'stop', message: { content: '额外文字\n{"answer":"已找到","matches":[]}' } }] }));
    } }), error => error.code === 'RESPONSE_FORMAT');
    assert.equal(proseCalls, 1);
    const restored = restoreConversations([{ id: 'output-archive', messages: [{ id: 'm1', role: 'assistant', status: 'complete', mode: 'custom', content: '已找到', cards: [], outputConstraint: 'json_object' }] }]);
    assert.equal(restored[0].messages[0].outputConstraint, 'json_object');
    console.log('PASS output constraints: provider/model detection, strict candidate enums, native Claude conversion, early agent completion, bounded explicit-rejection fallback, cancellation, validation and archive markers. Mock-only.');
  } finally { global.fetch = originalFetch; }
})().catch(error => { console.error(error); process.exitCode = 1; });
