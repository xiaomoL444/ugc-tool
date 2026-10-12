/* Mock-only streaming agent integration; no external requests or generated files. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { responsesFixture } = require('../tools/ai-search-service/responses-fixture.mjs');
const { buildAgentSearchPayload, requestAgentSearch } = require('../src/views/AISearch/agentSearchService.ts');
const version = 'stream-progress-v1', secret = 'PRIVATE_REASONING_NEVER_DISPLAY';
const resources = Array.from({ length: 10 }, (_, index) => ({
  resourceId: `${index === 0 ? 'effect' : 'sound'}:${1001 + index}`, kind: index === 0 ? 'effect' : 'sound',
  title: `结算短音${index + 1}`, description: `清脆单次起音${index + 1}，短尾衰减。`, keywords: ['清脆', '短音'],
  suggestedUses: ['完成反馈'], hasAudio: true,
  ...(index === 0 ? { audioMatch: true, audioDescription: '清脆单次起音1，短尾衰减。', visualDescription: '蓝色光点扩散。', audioKeywords: ['清脆'] } : {}),
}));
const matches = resources.map(item => ({ resourceId: item.resourceId, reason: '用途建议：清脆短尾可用于完成反馈。', matchType: 'suggestion' }));
matches[0].reason = '用途建议：清脆单次起音可用于完成反馈，但实际音轨需试听确认与整关结算的情绪相符，未验证响度和混音表现。';
const sections = [{ answer: '先试听完成瞬间的反馈。', resourceIds: resources.slice(0, 5).map(item => item.resourceId) },
  { answer: '再试听结算界面的反馈。', resourceIds: resources.slice(5).map(item => item.resourceId) }];
const finalValue = { answer: '找到十条可供结算试听的候选。', matches, sections, clarification: false };
const config = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-6.1-sol', apiKey: 'mock-key', rememberKey: false };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const envelope = (calls, value) => responsesFixture({ model: config.model, choices: [{ finish_reason: calls ? 'tool_calls' : 'stop',
  message: { content: calls ? null : JSON.stringify(value), ...(calls ? { tool_calls: calls } : {}) } }] });
function stream(response, generate = false) {
  const events = [];
  if (generate) {
    const text = response.output.find(item => item.type === 'message').content[0].text;
    for (let offset = 0; offset < text.length; offset += 73) events.push({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text.slice(offset, offset + 73) });
  } else {
    events.push({ type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'reasoning_fixture' } });
    events.push({ type: 'response.reasoning_summary_text.delta', delta: secret });
  }
  events.push({ type: 'response.completed', response });
  const bytes = new TextEncoder().encode(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
  return new Response(new ReadableStream({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += 37) controller.enqueue(bytes.subarray(offset, offset + 37));
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}

(async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('Real network forbidden.'); };
  try {
    const progress = []; let rounds = 0, searches = 0, details = 0;
    const payload = buildAgentSearchPayload('关卡完成和结算界面分别适合哪些音效', 'zh-CN', 'sound', [], true, 'stream-progress-fixture', 10);
    const result = await requestAgentSearch(payload, { mode: 'custom', config, freeBase: 'https://assets.fixture.invalid',
      signal: new AbortController().signal, hydrateFinalAssets: false, onProgress: update => progress.push(update), fetcher: async (url, init) => {
        if (String(url).split('?')[0].endsWith('/AISearch/SystemPrompt.md')) return new Response('Use observations; return up to RESULT_LIMIT matches.');
        const sent = JSON.parse(init.body);
        if (String(url).endsWith('/search')) {
          searches++; assert.equal(progress.at(-1).phase, 'searching'); assert.equal(progress.at(-1).round, 1);
          return json({ catalogVersion: version, mode: 'keyword', total: 5, items: searches === 1 ? resources.slice(0, 5) : resources.slice(5), hasMore: false });
        }
        if (String(url).endsWith('/assets')) {
          details++; assert.equal(progress.at(-1).phase, 'loading_details'); assert.equal(progress.at(-1).round, 2);
          return json({ catalogVersion: version, items: resources.filter(item => sent.ids.includes(item.resourceId)), missingIds: [] });
        }
        assert.equal(String(url), 'https://api.openai.com/v1/responses'); rounds++;
        assert.equal(sent.stream, true, 'All custom rounds stream'); assert.equal(sent.reasoning, undefined, 'Default reasoning effort is preserved');
        for (const field of ['max_output_tokens', 'max_completion_tokens', 'max_tokens']) assert.equal(Object.hasOwn(sent, field), false, 'Streaming adds no output quota');
        assert.equal(progress.at(-1).phase, 'waiting'); assert.equal(progress.at(-1).round, rounds);
        if (rounds === 1) {
          const response = envelope([call('search-stage', 'search_assets', { query: '结算', searchType: 'both' }), call('search-feature', 'search_assets', { query: '清脆 短尾', searchType: 'feature' })]);
          response.output.unshift({ type: 'reasoning', id: 'reasoning_fixture', encrypted_content: secret }); return stream(response);
        }
        const outputs = sent.input.filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output));
        assert.equal(outputs[0].items[0].description, undefined, 'Exact projected duplicate is removed below the byte limit');
        assert.equal(outputs[0].items[0].audioDescription, resources[0].audioDescription);
        assert.equal(outputs[0].items[0].visualDescription, resources[0].visualDescription, 'Independent visual evidence survives');
        assert.ok(sent.input.some(item => item.type === 'reasoning' && item.encrypted_content === secret), 'Reasoning items survive continuation in memory');
        if (rounds === 2) return stream(envelope([call('read-details', 'get_assets', { ids: resources.slice(0, 5).map(item => item.resourceId) })]));
        assert.equal(sent.tool_choice, 'none'); assert.match(sent.input.at(-1).content, /one short evidence-to-fit sentence/);
        assert.match(sent.input.at(-1).content, /aim for 20 words or 40 CJK characters/);
        assert.match(sent.input.at(-1).content, /exceeding this only for essential evidence, required labels or important limits/);
        assert.match(sent.input.at(-1).content, /in prose/, 'ID repetition needed by sections is not prohibited');
        assert.match(sent.input.at(-1).content, /do not repeat it in answer/);
        assert.equal(sent.text.format.schema.properties.matches.maxItems, 10);
        assert.deepEqual(sent.text.format.schema.properties.matches.items.properties.resourceId.enum, resources.map(item => item.resourceId));
        assert.equal(outputs[2].items[0].description, undefined); assert.equal(outputs[2].items[0].audioDescription, resources[0].audioDescription);
        return stream(envelope(null, finalValue), true);
      } });
    assert.equal(rounds, 3); assert.equal(searches, 2); assert.equal(details, 1);
    assert.equal(result.matches.length, 10, 'Concise output keeps ten grounded results'); assert.deepEqual(result.sections, sections);
    assert.ok(result.matches.every(match => match.reason && match.matchType === 'suggestion'));
    assert.ok(result.matches[0].reason.length > 40, 'An important limitation may exceed the soft brevity target');
    assert.ok(progress.some(update => update.phase === 'generating' && update.round === 3 && update.receivedCharacters > 0));
    assert.ok(progress.every(update => Number.isFinite(update.elapsedMs) && update.elapsedMs >= 0));
    assert.equal(JSON.stringify(progress).includes(secret), false, 'Reasoning content never reaches UI progress');
    let freeCalls = 0;
    await requestAgentSearch(payload, { mode: 'free', config, freeBase: 'https://assets.fixture.invalid', signal: new AbortController().signal,
      onProgress: () => { throw new Error('UI rendering failed'); }, fetcher: async (_url, init) => {
        freeCalls++; assert.equal(JSON.parse(init.body).stream, undefined, 'Free AI keeps its wire contract');
        return json({ ...finalValue, resources, catalogVersion: version });
      } });
    assert.equal(freeCalls, 1, 'Rendering errors cannot interrupt a search');
    console.log('PASS streaming agent: three rounds and tool phases, UTF-8 SSE, private reasoning replay, ten matches and grouped reasons, duplicate evidence removal, default effort/output budget, free compatibility. Mock-only.');
  } finally { global.fetch = originalFetch; }
})().catch(error => { console.error(error); process.exitCode = 1; });
