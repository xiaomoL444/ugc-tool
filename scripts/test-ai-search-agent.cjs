/* Mock-only tool calling. No network or paid model calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { buildAgentSearchPayload, requestAgentSearch: requestAgentSearchActual } = require('../src/views/AISearch/agentSearchService.ts');
const promptFixture = '# External prompt fixture\nCURRENT query must define the requested asset. Return at most RESULT\\_LIMIT resources.\n';
async function requestAgentSearch(payload, options) {
  const fetcher = options.fetcher;
  return requestAgentSearchActual(payload, { ...options, fetcher: async (url, input) => {
    if (String(url).split('?')[0].endsWith('/AISearch/SystemPrompt.md')) {
      assert.equal(options.mode, 'custom', 'Free AI keeps prompt loading inside the Worker');
      assert.equal(input.headers?.Authorization, undefined, 'Prompt storage never receives the model key');
      return new Response(promptFixture, { headers: { 'Content-Type': 'text/markdown' } });
    }
    if (String(url).endsWith('/chat/completions')) {
      const system = JSON.parse(input.body).messages[0].content;
      assert.ok(system.includes('External prompt fixture'), 'The external file becomes the actual system message');
      assert.ok(system.includes(`at most ${payload.resultLimit} resources`), 'The escaped result-limit marker is expanded');
    }
    return fetcher(url, input);
  } });
}
const version = 'fixture-agent-v1';
const metadata = { catalogVersion: version, mode: 'keyword', counts: { total: 5378 }, coverage: 0.4 };
const asset = { resourceId: 'effect:777', kind: 'effect', title: '爆炸', description: '短促爆炸', keywords: ['爆炸'], hasAudio: true, href: 'javascript:alert(1)' };
const result = items => new Response(JSON.stringify({ ...metadata, total: items.length, items, hasMore: false }));
const details = items => new Response(JSON.stringify({ catalogVersion: version, items, missingIds: [] }));
const toolCall = (name, args, id = 'call-1') => new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }));
const final = (matches = [{ resourceId: asset.resourceId, reason: '爆炸名称', matchType: 'feature' }]) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answer: '已找到', matches }) } }] }));
const config = { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', apiKey: 'mock-key-only', rememberKey: false };
const options = { mode: 'custom', config, freeBase: '/api/ai-search', signal: new AbortController().signal };
const payload = buildAgentSearchPayload('来点爆炸特效', 'zh-CN', 'all', [], true, 'agent-request');
const question = content => ({ role: 'user', status: 'complete', content, cards: [], mode: 'custom', source: 'custom' });
const answer = (content, cards = [asset], status = 'complete') => ({ role: 'assistant', status, content, cards, mode: 'custom', source: 'custom' });
const followup = buildAgentSearchPayload('再来点', 'zh-CN', 'all', [question('爆炸特效'), answer('上次结果')], true, 'followup');
assert.equal(followup.messages.length, 2);
assert.ok(followup.messages[1].content.includes(asset.resourceId));
assert.deepEqual(followup.previousIds, [asset.resourceId]);
assert.equal(buildAgentSearchPayload('爆炸特效', 'zh-CN', 'all', [question('音乐'), answer('error', [], 'error')], true, 'fresh').messages.length, 0);
(async () => {
  const calls = []; let rounds = 0;
  const found = await requestAgentSearch(payload, { ...options, fetcher: async (url, input) => {
    const body = JSON.parse(input.body); calls.push({ url, body, headers: input.headers });
    if (url.endsWith('/chat/completions')) {
      rounds++;
      assert.deepEqual(body.thinking, { type: 'disabled' });
      assert.ok(!input.body.includes(config.apiKey));
      if (rounds === 1) { assert.equal(body.tool_choice, 'required'); assert.ok(!body.response_format); return toolCall('search_assets', { query: '炮火', scope: 'effect' }); }
      if (rounds === 2) {
        assert.ok(body.messages.some(message => message.role === 'tool' && JSON.parse(message.content).items.length === 0), 'Model must receive empty evidence and be allowed to rewrite the query');
        return toolCall('search_assets', { query: '爆炸', scope: 'effect' }, 'call-2');
      }
      assert.equal(body.tool_choice, 'none'); assert.deepEqual(body.response_format, { type: 'json_object' });
      return final();
    }
    assert.equal(input.headers.Authorization, undefined, 'BYOK never reaches asset service');
    if (url.endsWith('/search')) return body.query === '炮火' ? new Response(JSON.stringify({ ...metadata, mode: 'hybrid', total: 0, items: [], hasMore: false })) : result([asset]);
    if (url.endsWith('/assets')) return details([asset]);
    throw new Error(`Unexpected route ${url}`);
  } });
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/chat/completions', 'AI receives the natural request before retrieval');
  assert.equal(rounds, 3); assert.equal(found.resources[0].href, '/EffectPlayer?id=777');
  assert.equal(found.retrievalMode, 'keyword', 'The latest actual search mode overrides an earlier hybrid mode after fallback');
  assert.equal(found.matches[0].resourceId, asset.resourceId);

  let moreRounds = 0, excluded;
  const newAsset = { ...asset, resourceId: 'effect:778', title: '黄色爆炸' };
  const more = await requestAgentSearch(followup, { ...options, fetcher: async (url, input) => {
    const body = JSON.parse(input.body);
    if (url.endsWith('/chat/completions')) return ++moreRounds === 1 ? toolCall('search_assets', { query: '爆炸', scope: 'effect' }) : final([{ resourceId: newAsset.resourceId, reason: '黄色爆炸名称', matchType: 'feature' }]);
    if (url.endsWith('/search')) { excluded = body.excludeIds; return result([asset, newAsset]); }
    return details([newAsset]);
  } });
  assert.deepEqual(excluded, [asset.resourceId]); assert.equal(more.matches[0].resourceId, 'effect:778');

  let musicRounds = 0;
  const music = { resourceId: 'bgm:9', kind: 'bgm', title: '战斗音乐', description: '', keywords: [] };
  const musicAnswer = await requestAgentSearch(buildAgentSearchPayload('打架用的激昂音乐', 'zh-CN', 'all', [], true, 'music'), { ...options, fetcher: async (url, input) => {
    const body = JSON.parse(input.body);
    if (url.endsWith('/chat/completions')) {
      if (++musicRounds === 1) return toolCall('search_assets', { query: '激昂', scope: 'bgm' });
      if (musicRounds === 2) return toolCall('search_assets', { query: '战斗', scope: 'bgm' }, 'music-rewrite');
      return final([{ resourceId: 'bgm:9', reason: '名称为战斗音乐，尚无风格描述，需试听确认', matchType: 'feature' }]);
    }
    if (url.endsWith('/search')) { assert.equal(body.scope, 'bgm', 'An all-asset request may be narrowed by the model to BGM'); return result(body.query === '激昂' ? [] : [music]); }
    return details([music]);
  } });
  assert.equal(musicRounds, 3); assert.equal(musicAnswer.matches[0].resourceId, 'bgm:9');

  let unsupportedCalls = 0;
  await assert.rejects(() => requestAgentSearch(payload, { ...options, fetcher: async () => { unsupportedCalls++; return new Response('{"error":{"message":"tools unsupported"}}', { status: 400 }); } }), error => error.code === 'TOOLS_UNSUPPORTED');
  assert.equal(unsupportedCalls, 1, 'Unsupported tools do not trigger automatic paid retries');
  await assert.rejects(() => requestAgentSearch(payload, { ...options, fetcher: async () => final([]) }), error => error.code === 'TOOLS_UNSUPPORTED', 'A provider silently ignoring tools cannot report a false empty search');
  await assert.rejects(() => requestAgentSearch(payload, { ...options, fetcher: async () => new Response('{"error":{"message":"unknown model"}}', { status: 400 }) }), error => error.code === 'MODEL_REQUEST_REJECTED', 'A bad model error does not falsely diagnose unsupported tools');
  await assert.rejects(() => requestAgentSearch(payload, { ...options, fetcher: async () => new Response('{"error":{"message":"tools schema invalid"}}', { status: 400 }) }), error => error.code === 'MODEL_REQUEST_REJECTED', 'An invalid tool schema is not proof that tools are unsupported');
  await assert.rejects(() => requestAgentSearch(payload, { ...options, fetcher: async () => final() }), error => error.code === 'RESPONSE_ASSET_ID', 'An invented ID cannot become a card before retrieval');
  let duplicateRounds = 0;
  await assert.rejects(() => requestAgentSearch(payload, { ...options, fetcher: async (url) => url.endsWith('/search') ? result([asset]) : (duplicateRounds++, toolCall('search_assets', { query: '爆炸' }, 'same-across-rounds')) }), error => error.code === 'TOOL_ARGUMENTS');
  assert.equal(duplicateRounds, 2, 'Tool IDs must be unique across the whole turn');

  let repeated = 0;
  await assert.rejects(() => requestAgentSearch(payload, { ...options, fetcher: async (url) => url.endsWith('/search') ? result([asset]) : (repeated++, toolCall('search_assets', { query: '爆炸' }, `repeat-${repeated}`)) }), error => error.code === 'AGENT_LIMIT');
  assert.equal(repeated, 3, 'At most three model requests occur');

  let toolBudgetRequests = 0;
  await assert.rejects(() => requestAgentSearch(payload, { ...options, fetcher: async () => { toolBudgetRequests++; return new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: Array.from({ length: 5 }, (_, index) => ({ id: `over-${index}`, type: 'function', function: { name: 'search_assets', arguments: '{"query":"爆炸"}' } })) } }] })); } }), error => error.code === 'AGENT_LIMIT');
  assert.equal(toolBudgetRequests, 1);

  let freeCalls = 0;
  const free = await requestAgentSearch(payload, { ...options, mode: 'free', fetcher: async (url, input) => {
    freeCalls++; assert.equal(url, '/api/ai-search/chat'); assert.equal(input.headers.Authorization, undefined);
    const body = JSON.parse(input.body); assert.equal(body.workflow, 'agent'); assert.ok(!body.candidates && !body.candidateIds && !body.catalogVersion);
    return new Response(JSON.stringify({ catalogVersion: version, mode: 'keyword', resources: [asset], answer: '已找到', matches: [{ resourceId: asset.resourceId, reason: '爆炸名称', matchType: 'feature' }], quota: { remaining: 4, limit: 5, resetAt: '2026-10-09T00:00:00+08:00' } }));
  } });
  assert.equal(freeCalls, 1); assert.equal(free.quota.remaining, 4); assert.equal(free.resources[0].href, '/EffectPlayer?id=777');
  assert.equal(free.retrievalMode, 'keyword', 'Free agent reports actual Worker retrieval mode');
  const audioAsset = { ...asset, title: '蓝色护盾', description: '蓝色护盾展开', visualDescription: undefined, audioDescription: '猛烈爆炸轰鸣', audioKeywords: ['爆炸', '轰鸣'] };
  for (const query of ['帮我找一些爆炸的特效的音效', '帮我找一些有爆炸的音效的特效']) {
    let audioRounds = 0;
    const audioPayload = buildAgentSearchPayload(query, 'zh-CN', 'effect', [question('爆炸音效'), answer('普通音效', [{ ...asset, resourceId: 'sound:40224', kind: 'sound' }])], false, 'effect-audio-request');
    const audioFound = await requestAgentSearch(audioPayload, { ...options, fetcher: async (url, input) => {
      const body = JSON.parse(input.body);
      if (url.endsWith('/chat/completions')) {
        audioRounds++;
        if (audioRounds === 1) {
          const task = JSON.parse(body.messages.at(-1).content);
          assert.equal(task.query, query);
          assert.equal(task.scope, 'effect');
          assert.equal(task.matchOn, 'any', 'The model receives the query before independently choosing audio evidence');
          assert.ok(body.messages[0].content.includes('CURRENT query'));
          return toolCall('search_assets', { query: '爆炸', scope: 'effect', matchOn: 'audio', searchType: 'feature', filters: { hasAudio: true } });
        }
        if (audioRounds === 2) {
          const observed = JSON.parse(body.messages.find(message => message.role === 'tool').content).items[0];
          assert.equal(observed.audioMatch, true);
          assert.equal(observed.visualDescription, '蓝色护盾展开');
          assert.equal(observed.audioDescription, '猛烈爆炸轰鸣');
          return toolCall('get_assets', { ids: [audioAsset.resourceId] }, 'audio-detail');
        }
        const detail = JSON.parse(body.messages.filter(message => message.role === 'tool').at(-1).content).items[0];
        assert.equal(detail.visualDescription, '蓝色护盾展开', 'get_assets retains trusted legacy visual prose after audio projection');
        assert.equal(detail.audioDescription, '猛烈爆炸轰鸣');
        assert.deepEqual(detail.audioKeywords, ['爆炸', '轰鸣']);
        return final([{ resourceId: audioAsset.resourceId, reason: '音轨描述为爆炸轰鸣', matchType: 'feature' }]);
      }
      if (url.endsWith('/search')) {
        assert.equal(body.scope, 'effect'); assert.equal(body.matchOn, 'audio'); assert.equal(body.searchType, 'feature');
        assert.equal(body.includeEffectAudio, false, 'The hidden sound-expansion checkbox does not prevent searching an effect’s own track');
        assert.deepEqual(body.filters, { hasAudio: true });
        return result([{ ...audioAsset, description: audioAsset.audioDescription, visualDescription: '蓝色护盾展开', audioMatch: true }]);
      }
      return details([audioAsset]);
    } });
    assert.equal(audioFound.resources[0].kind, 'effect');
    assert.equal(audioFound.resources[0].audioMatch, true);
    assert.equal(audioFound.resources[0].visualDescription, '蓝色护盾展开');
    assert.equal(audioFound.resources[0].description, '猛烈爆炸轰鸣');
  }
  const freeEffectAudio = await requestAgentSearch(buildAgentSearchPayload('有爆炸音效的特效', 'zh-CN', 'effect', [], false, 'free-effect-audio'), { ...options, mode: 'free', fetcher: async () => new Response(JSON.stringify({ catalogVersion: version, mode: 'keyword', resources: [{ ...audioAsset, audioMatch: true }], answer: '已找到', matches: [{ resourceId: audioAsset.resourceId, reason: '爆炸音轨', matchType: 'feature' }] })) });
  assert.equal(freeEffectAudio.resources[0].kind, 'effect', 'A free response keeps the requested effect kind even when matching audio');
  assert.equal(freeEffectAudio.resources[0].audioMatch, true);
  await assert.rejects(() => requestAgentSearch(buildAgentSearchPayload('有爆炸音效的特效', 'zh-CN', 'effect', [], false, 'free-fixed-audio', 10, 'audio'), { ...options, mode: 'free', fetcher: async () => new Response(JSON.stringify({ catalogVersion: version, resources: [audioAsset], answer: '画面匹配', matches: [{ resourceId: audioAsset.resourceId, reason: '视觉特征', matchType: 'feature' }] })) }), error => error.code === 'INVALID_RESPONSE', 'A free response cannot silently switch explicit audio evidence back to visual');
  const keywordsOnly = await requestAgentSearch(buildAgentSearchPayload('有爆炸音效的特效', 'zh-CN', 'effect', [], false, 'free-keywords'), { ...options, mode: 'free', fetcher: async () => new Response(JSON.stringify({ catalogVersion: version, resources: [{ ...audioAsset, audioMatch: true, audioDescription: '', audioKeywords: ['爆炸'] }], answer: '音轨关键词匹配', matches: [{ resourceId: audioAsset.resourceId, reason: '音轨关键词包含爆炸', matchType: 'feature' }] })) });
  assert.equal(keywordsOnly.resources[0].description, '', 'A keyword-only match never fabricates a prose audio description');
  assert.deepEqual(keywordsOnly.resources[0].audioKeywords, ['爆炸']);
  await assert.rejects(() => requestAgentSearch(buildAgentSearchPayload('有爆炸音效的特效', 'zh-CN', 'effect', [], false, 'free-unknown-audio'), { ...options, mode: 'free', fetcher: async () => new Response(JSON.stringify({ catalogVersion: version, resources: [{ ...audioAsset, audioMatch: true, audioDescription: '', audioKeywords: [] }], answer: '爆炸', matches: [{ resourceId: audioAsset.resourceId, reason: '视觉标题爆炸', matchType: 'feature' }] })) }), error => error.code === 'INVALID_RESPONSE');
  let missingRounds = 0;
  const missingAudio = await requestAgentSearch(buildAgentSearchPayload('带爆炸音效的特效', 'zh-CN', 'all', [], true, 'missing-audio'), { ...options, fetcher: async (url, input) => {
    const body = JSON.parse(input.body);
    if (url.endsWith('/chat/completions')) {
      if (++missingRounds === 1) return toolCall('search_assets', { query: '爆炸', scope: 'effect', matchOn: 'audio', filters: { hasAudio: true } });
      assert.equal(JSON.parse(body.messages.find(message => message.role === 'tool').content).retrievalNotice.code, 'EFFECT_AUDIO_DESCRIPTION_MISSING');
      return final([]);
    }
    return new Response(JSON.stringify({ ...metadata, total: 0, items: [], hasMore: false, retrievalNotice: { code: 'EFFECT_AUDIO_DESCRIPTION_MISSING' } }));
  } });
  assert.deepEqual(missingAudio.matches, [], 'Missing effect-audio evidence allows an honest empty answer instead of standalone sound substitutes');
  let fixedFacetRounds = 0;
  await requestAgentSearch(buildAgentSearchPayload('带爆炸音效的特效', 'zh-CN', 'effect', [], false, 'fixed-audio', 10, 'audio'), { ...options, fetcher: async (url, input) => {
    const body = JSON.parse(input.body);
    if (url.endsWith('/chat/completions')) return ++fixedFacetRounds === 1 ? toolCall('search_assets', { query: '爆炸', scope: 'effect', matchOn: 'visual' }) : final();
    if (url.endsWith('/search')) { assert.equal(body.matchOn, 'audio', 'An explicit outer evidence constraint cannot be changed by model tool arguments'); return result([{ ...audioAsset, visualDescription: '蓝色护盾展开', audioMatch: true }]); }
    return details([audioAsset]);
  } });
  let oldWorkerModelCalls = 0;
  await assert.rejects(() => requestAgentSearch(payload, { ...options, fetcher: async url => {
    if (url.endsWith('/chat/completions')) { oldWorkerModelCalls++; return toolCall('search_assets', { query: '爆炸', scope: 'effect', matchOn: 'audio' }); }
    return new Response('{"error":{"code":"INVALID_SEARCH"}}', { status: 400 });
  } }), error => error.code === 'RETRIEVAL_MATCH_ON_UNSUPPORTED');
  assert.equal(oldWorkerModelCalls, 1, 'An old Worker rejection does not trigger a paid retry with weaker visual evidence');
  console.log('PASS agent search: model-first tools, empty-search rewrite, bounded rounds/tools, previous alternatives, trusted IDs/routes, no BYOK leakage, unsupported-tools no retry, and free agent protocol');
})().catch(error => { console.error(error); process.exitCode = 1; });
