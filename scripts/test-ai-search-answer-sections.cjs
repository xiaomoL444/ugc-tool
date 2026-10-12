/* Mock-only multi-answer integration. No external requests, keys, or generated files. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { responsesFixture } = require('../tools/ai-search-service/responses-fixture.mjs');
const { searchAnswerSchema, normalizeAnswerSections } = require('../tools/ai-search-service/model-output-policy.mjs');
const { validateSearchAnswer, requestSearch, buildSearchPayload } = require('../src/views/AISearch/aiSearchService.ts');
const { requestAgentSearch, buildAgentSearchPayload } = require('../src/views/AISearch/agentSearchService.ts');
const { restoreConversations, useAISearch } = require('../src/views/AISearch/useAISearch.ts');
const { serializeAISearchArchive } = require('../src/views/AISearch/archiveStorage.ts');
const { boundedHistoryContent } = require('../src/views/AISearch/resultLimits.ts');
const { createRenderer, nextTick } = require('vue');
const { createI18n } = require('vue-i18n');

const version = 'answer-sections-v1';
const resources = ['sound:50514', 'sound:50934'].map((resourceId, i) => ({ resourceId, id: resourceId.split(':')[1], kind: 'sound',
  title: i ? '提示性 UI 错误音' : '短促金属释放音', description: i ? '短促金属音下滑后停止' : '清脆金属音明亮上扬',
  keywords: ['金属'], suggestedUses: [], hasAudio: true, href: '/SoundEffectPlayer?id=' + resourceId.split(':')[1],
  locale: 'zh-CN', featureText: '', audioText: '', suggestionText: '' }));
const matches = resources.map(item => ({ resourceId: item.resourceId, reason: item.description, matchType: 'suggestion' }));
const sections = [
  { answer: '释放道具：明亮上扬的短促金属声，可用于生效瞬间。', resourceIds: [resources[0].resourceId] },
  { answer: '道具不足：下行并突停的短音，可用于否定反馈。', resourceIds: [resources[1].resourceId] },
];
const output = { answer: '分别推荐两种道具反馈。', matches, sections };
const config = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-6.1-sol', apiKey: 'mock-sections-key-only', rememberKey: false };
const options = { mode: 'custom', config, freeBase: '/api/ai-search', signal: new AbortController().signal };
const envelope = content => Response.json(responsesFixture({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }));
const prompt = () => new Response('# Fixture prompt\nReturn RESULT_LIMIT resources.');
const toolCalls = () => Response.json(responsesFixture({ choices: [{ finish_reason: 'tool_calls', message: { content: null,
  tool_calls: ['释放', '不足'].map((query, index) => ({ id: 'sections-call-' + index, type: 'function', function: {
    name: 'search_assets', arguments: JSON.stringify({ query, scope: 'sound', matchOn: 'audio' }),
  } })) } }] }));

class Storage {
  constructor() { this.files = new Map(); }
  setProject() { return this; }
  async exists(path) { return this.files.has(path); }
  async mkdir() {}
  async readFile(path) { return this.files.get(path); }
  async writeFile(path, data) { this.files.set(path, data); }
}
const renderer = createRenderer({ createElement: type => ({ type, children: [] }), createText: text => ({ text }), createComment: text => ({ text }),
  setText: (node, text) => { node.text = text; }, setElementText: (node, text) => { node.text = text; },
  insert: (node, parent) => { parent.children.push(node); }, remove() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
async function settle(condition) {
  for (let i = 0; i < 150; i++) { await nextTick(); if (condition()) return; await new Promise(resolve => setImmediate(resolve)); }
  throw new Error('State did not settle');
}

(async () => {
  const ids = resources.map(item => item.resourceId);
  assert.deepEqual(validateSearchAnswer(output, resources).sections, sections);
  assert.equal(validateSearchAnswer({ answer: '旧回复', matches }, resources).sections, undefined);
  assert.deepEqual(normalizeAnswerSections([{ answer: '该组暂无合适结果', resourceIds: [] }], []), [{ answer: '该组暂无合适结果', resourceIds: [] }]);
  for (const invalid of [
    [{ answer: '外部 ID', resourceIds: ['sound:999'] }],
    [{ answer: '遗漏第二组', resourceIds: [ids[0]] }],
    [sections[0], { answer: '重复第一组', resourceIds: ids }],
  ]) assert.throws(() => validateSearchAnswer({ ...output, sections: invalid }, resources), error => error.code === 'RESPONSE_ASSET_ID');
  assert.throws(() => validateSearchAnswer({ ...output, sections: [{ answer: '', resourceIds: ids }] }, resources), error => error.code === 'RESPONSE_FORMAT');
  for (const native of [false, true]) {
    const schema = searchAnswerSchema(ids, 10, true, native);
    assert.ok(schema.required.includes('sections'));
    assert.deepEqual(schema.properties.sections.items.properties.resourceIds.items.enum, ids);
    assert.equal(schema.properties.sections.items.additionalProperties, false);
    if (native) assert.equal(schema.properties.sections.maxItems, undefined);
  }
  const payload = buildSearchPayload('释放道具和道具不足各推荐一类音效', 'zh-CN', 'sound', [], resources, 'sections-candidates');
  for (const native of [false, true]) {
    let calls = 0;
    const result = await requestSearch(payload, resources, { ...options, config: native ? { ...config, baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' } : config,
      fetcher: async (url, init) => {
        if (url.includes('SystemPrompt.md')) return prompt();
        calls++;
        const wire = JSON.parse(init.body), schema = native ? wire.output_config.format.schema : wire.text.format.schema;
        assert.deepEqual(schema.properties.sections.items.properties.resourceIds.items.enum, ids);
        return native ? Response.json({ type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(output) }] }) : envelope(output);
      } });
    assert.equal(calls, 1); assert.deepEqual(result.sections, sections);
  }
  let rounds = 0; const queries = [];
  const agent = await requestAgentSearch(buildAgentSearchPayload(payload.query, 'zh-CN', 'sound', [], false, 'sections-agent'), {
    ...options, fetcher: async (url, init) => {
      if (url.includes('SystemPrompt.md')) return prompt();
      if (url.endsWith('/responses')) return ++rounds === 1 ? toolCalls() : envelope({ ...output, clarification: false });
      const body = JSON.parse(init.body);
      if (url.endsWith('/search')) {
        queries.push(body.query); const index = body.query === '释放' ? 0 : 1;
        return Response.json({ catalogVersion: version, total: 1, mode: 'keyword', items: [resources[index]], hasMore: false });
      }
      assert.ok(url.endsWith('/assets'));
      return Response.json({ catalogVersion: version, items: resources, missingIds: [] });
    } });
  assert.equal(rounds, 2); assert.deepEqual(queries, ['释放', '不足']); assert.deepEqual(agent.sections, sections);
  const { validateModelResult, settings, buildPrompt, callUpstream } = await import('../tools/ai-search-service/worker.mjs');
  const { runAssetAgent, buildAgentPrompt } = await import('../tools/ai-search-service/agent-runtime.mjs');
  assert.deepEqual(validateModelResult(output, resources).sections, sections);
  assert.throws(() => validateModelResult({ ...output, sections: [{ answer: '<img src=x>', resourceIds: ids }] }, resources), error => error.code === 'UPSTREAM_RESPONSE_INVALID');
  const env = { UPSTREAM_URL: config.baseUrl, MODEL: config.model, UPSTREAM_API_KEY: 'mock-only', VISITOR_HASH_SECRET: 'mock-only', INPUT_CNY_PER_MILLION: '5', OUTPUT_CNY_PER_MILLION: '20' };
  const cfg = settings(env);
  const request = { ...payload, resultLimit: 10 };
  const selected = await callUpstream(request, buildPrompt(request, cfg, '# Test prompt'), cfg, env, async () => envelope(output));
  assert.deepEqual(selected.result.sections, sections);
  let workerRounds = 0;
  const workerRequest = { ...buildAgentSearchPayload(payload.query, 'zh-CN', 'sound', [], false, 'worker-sections'), resultLimit: 10 };
  const worker = await runAssetAgent(workerRequest, buildAgentPrompt(workerRequest, cfg, '# Test prompt'), cfg, env, {
    search: async args => ({ catalogVersion: version, items: [resources[args.query === '释放' ? 0 : 1]] }),
  }, validateModelResult, async () => ++workerRounds === 1 ? toolCalls() : envelope({ ...output, clarification: false }));
  assert.equal(workerRounds, 2); assert.deepEqual(worker.result.sections, sections);

  const saved = JSON.parse(serializeAISearchArchive({ conversations: [{ id: 'c1', title: '两种反馈', updatedAt: 1, contextStart: 0,
    messages: [{ id: 'm1', role: 'assistant', content: output.answer, cards: resources, sections, status: 'complete', mode: 'custom' }] }], activeConversationId: 'c1', selectedMode: 'custom' }));
  assert.deepEqual(restoreConversations(saved.conversations)[0].messages[0].sections, sections);
  const failedArchive = structuredClone(saved); failedArchive.conversations[0].messages[0].status = 'error';
  assert.equal(restoreConversations(failedArchive.conversations)[0].messages[0].sections, undefined, 'Error text and diagnostics stay visible instead of being hidden by sections');
  saved.conversations[0].messages[0].sections[0].resourceIds = ['sound:999'];
  const damaged = restoreConversations(saved.conversations)[0].messages[0];
  assert.equal(damaged.sections, undefined); assert.equal(damaged.cards.length, 2);
  const history = boundedHistoryContent(output.answer, resources, 'Displayed resources', sections);
  assert.ok(history.includes(sections[1].answer)); assert.ok(history.includes('"positions":[2]'));
  const many = Array.from({ length: 50 }, (_, i) => ({ ...resources[0], resourceId: 'effect:' + (999999999999 - i) }));
  const manySections = Array.from({ length: 8 }, (_, i) => ({ answer: '长解释'.repeat(100), resourceIds: many.filter((_, j) => j % 8 === i).map(card => card.resourceId) }));
  assert.ok(boundedHistoryContent('正文'.repeat(1000), many, 'Displayed resources', manySections).length <= 1900);

  const previous = { fetch: global.fetch, localStorage: global.localStorage, sessionStorage: global.sessionStorage };
  global.localStorage = global.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const storage = new Storage(); let state, chatCalls = 0;
  global.fetch = async url => {
    const endpoint = String(url).split('?')[0].split('/').at(-1);
    if (endpoint === 'config') return Response.json({ configured: true, available: true, model: 'fixture', retrieval: { available: true }, agent: { available: true }, limits: { maxResults: 10 } });
    if (endpoint === 'catalog') return Response.json({ catalogVersion: version, total: 2, mode: 'keyword' });
    if (endpoint === 'index.json') return Response.json({ data: version });
    assert.equal(endpoint, 'chat'); chatCalls++;
    return Response.json({ ...output, catalogVersion: version, resources });
  };
  const app = renderer.createApp({ setup() { state = useAISearch(); return () => null; } });
  app.provide('storage', storage);
  app.use(createI18n({ legacy: false, flatJson: true, locale: 'zh-CN', messages: { 'zh-CN': JSON.parse(fs.readFileSync(require.resolve('../src/i18n/locales/aiSearch/zh-cn.json'), 'utf8')) } }));
  app.mount({ children: [] });
  try {
    await settle(() => !state.loadingCatalog.value && !state.loadingArchive.value);
    state.mode.value = 'free'; await state.send(payload.query);
    const reply = state.messages.value.at(-1);
    assert.equal(reply.status, 'complete'); assert.deepEqual(JSON.parse(JSON.stringify(reply.sections)), sections);
    assert.deepEqual(reply.cards.map(card => card.resourceId), ids); assert.equal(chatCalls, 1, 'Two card groups use one final service response');
    await settle(() => storage.files.get('/archive.json') && JSON.parse(storage.files.get('/archive.json')).conversations[0].messages.at(-1)?.sections?.length === 2);
  } finally { app.unmount(); Object.assign(global, previous); }
  console.log('PASS answer sections: Responses and Claude Schema, separate retrieval, Worker/candidate/agent transport, unique complete membership, empty groups, bounded history, UI state and archive roundtrip. Mock-only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
