/* Mock-only tool calling. No network or paid model calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { AGENT_SEARCH_TOOLS, buildAgentSearchPayload, requestAgentSearch: requestAgentSearchActual } = require('../src/views/AISearch/agentSearchService.ts');
const { buildSearchPayload, chatToolCompatibilityOptions } = require('../src/views/AISearch/aiSearchService.ts');
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
const finalValue = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
const final = (matches = [{ resourceId: asset.resourceId, reason: '爆炸名称', matchType: 'feature' }]) => finalValue({ answer: '已找到', matches });
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
  const { assetFunctionTools } = await import('../tools/ai-search-service/agent-runtime.mjs');
  const workerQuery = assetFunctionTools().find(item => item.function.name === 'search_assets').function.parameters.properties.query.description;
  const customQuery = AGENT_SEARCH_TOOLS.find(item => item.function.name === 'search_assets').function.parameters.properties.query.description;
  assert.equal(customQuery, workerQuery, 'Site AI and custom models receive the same feature vocabulary guidance');
  const sceneCases = [
    { id: 'visual-scene', query: 'A mysterious blue ring slowly expands.', scope: 'effect', matchOn: 'visual',
      terms: 'blue ring expanding', asset: { ...asset, description: 'A blue circular ring slowly expands.', hasAudio: false } },
    { id: 'all-visual-scene', query: 'Find a blue expanding ring visual.', scope: 'all', matchOn: 'any', toolScope: 'effect', toolMatchOn: 'visual',
      terms: 'blue ring expanding', asset: { ...asset, description: 'A blue circular ring slowly expands.', hasAudio: false } },
    { id: 'effect-audio-scene', query: 'A brief shimmering portal opening sound.', scope: 'effect', matchOn: 'audio',
      terms: 'brief bright chime', asset: { ...asset, audioMatch: true, audioDescription: 'A brief bright chime with a clean decay.', audioKeywords: ['chime'], hasAudio: true } },
    { id: 'bgm-scene', query: 'Gentle piano music for quiet exploration.', scope: 'bgm', matchOn: 'audio',
      terms: 'gentle piano light rhythm', asset: { resourceId: 'bgm:17', kind: 'bgm', title: 'Gentle piano', description: 'Gentle piano melody with a light steady pulse.', keywords: ['piano', 'gentle'], hasAudio: true } },
  ];
  for (const scene of sceneCases) {
    let modelCalls = 0, searches = 0;
    const scenePayload = buildAgentSearchPayload(scene.query, 'en-US', scene.scope, [], true, scene.id, 5, scene.matchOn);
    const expectedScope = scene.toolScope ?? scene.scope, expectedMatchOn = scene.toolMatchOn ?? scene.matchOn;
    const completed = await requestAgentSearch(scenePayload, { ...options, fetcher: async (url, input) => {
      const sent = JSON.parse(input.body);
      if (url.endsWith('/chat/completions')) {
        modelCalls++;
        const guide = sent.tools.find(item => item.function.name === 'search_assets').function.parameters.properties.query.description;
        assert.equal(guide, workerQuery, 'The corrected instruction reaches the actual provider request');
        assert.match(guide, /visual effects or matchOn=visual use color, shape, motion/);
        assert.match(guide, /matchOn=audio use attack, timbre, pitch, rhythm and decay/);
        assert.match(guide, /background music \(bgm\) use mood, tempo, instrumentation/);
        assert.match(guide, /matchOn=any, follow the user's visual or audio intent/);
        if (modelCalls === 1) return toolCall('search_assets', { query: scene.terms, scope: expectedScope, matchOn: expectedMatchOn, searchType: 'feature' }, scene.id);
        return finalValue({ answer: 'Found a candidate for this scene.', matches: [{ resourceId: scene.asset.resourceId, reason: 'Use suggestion: the described properties may suit this scene.', matchType: 'suggestion' }] });
      }
      assert.equal(input.headers.Authorization, undefined);
      if (url.endsWith('/search')) {
        searches++;
        assert.equal(sent.scope, expectedScope); assert.equal(sent.matchOn, expectedMatchOn);
        assert.equal(sent.query, scene.terms); assert.equal(sent.locale, 'en-US');
        assert.equal(sent.filters?.hasAudio, undefined, 'Visual and BGM requests must not receive an invented audio filter');
        return result([scene.asset]);
      }
      if (url.endsWith('/assets')) return details([scene.asset]);
      throw new Error(`Unexpected scene route ${url}`);
    } });
    assert.equal(modelCalls, 2); assert.equal(searches, 1);
    assert.equal(completed.matches[0].resourceId, scene.asset.resourceId);
    assert.equal(completed.resources[0].kind, scene.asset.kind);
    assert.equal(Boolean(completed.resources[0].audioMatch), scene.matchOn === 'audio' && scene.scope === 'effect');
  }
  const calls = []; let rounds = 0;
  const found = await requestAgentSearch(payload, { ...options, fetcher: async (url, input) => {
    const body = JSON.parse(input.body); calls.push({ url, body, headers: input.headers });
    if (url.endsWith('/chat/completions')) {
      rounds++;
      assert.deepEqual(body.thinking, { type: 'disabled' });
      assert.ok(!input.body.includes(config.apiKey));
      if (rounds === 1) { assert.equal(body.tool_choice, 'auto'); assert.ok(!body.response_format); return toolCall('search_assets', { query: '炮火', scope: 'effect' }); }
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

  const repairableFinal = "{answer:'已找到',matches:[{resourceId:'effect:777',reason:'名称为爆炸',matchType:'feature',}],}";
  let repairRounds = 0;
  const repairedAgent = await requestAgentSearch(payload, { ...options, fetcher: async (url) => {
    if (url.endsWith('/chat/completions')) return ++repairRounds === 1 ? toolCall('search_assets', { query: '爆炸', scope: 'effect' })
      : new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: repairableFinal } }] }));
    if (url.endsWith('/search')) return result([asset]);
    return details([asset]);
  } });
  assert.equal(repairedAgent.matches[0].resourceId, asset.resourceId);
  assert.equal(repairRounds, 2, 'Repair uses the received model text without another model round');
  for (const [content, expectedCode] of [
    ["{answer:'found',matches:[{resourceId:'effect:999',reason:'invented',matchType:'feature',}],}", 'RESPONSE_ASSET_ID'],
    ["{answer:'found',matches:[{resourceId:'effect:777',reason:'one',matchType:'feature'},{resourceId:'effect:777',reason:'two',matchType:'feature'},],}", 'RESPONSE_ASSET_ID'],
    ["{answer:'found',matches:[{resourceId:'effect:777',reason:'wrong type',matchType:'unknown'},],}", 'RESPONSE_MATCH_TYPE'],
    ["{answer:'missing matches',}", 'RESPONSE_FORMAT'],
    [repairableFinal.slice(0, -2), 'RESPONSE_FORMAT'],
  ]) {
    let rounds = 0;
    await assert.rejects(() => requestAgentSearch(payload, { ...options, fetcher: async url => {
      if (url.endsWith('/chat/completions')) return ++rounds === 1 ? toolCall('search_assets', { query: '爆炸', scope: 'effect' })
        : new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
      return result([asset]);
    } }), error => error.code === expectedCode && error.rawResponse === content, 'Repaired finals still validate IDs, duplicates and shape, with unchanged raw diagnostics');
    assert.equal(rounds, 2, 'Invalid repaired fields do not trigger paid retry');
  }
  let truncatedRepairRounds = 0;
  await assert.rejects(() => requestAgentSearch(payload, { ...options, fetcher: async url => url.endsWith('/chat/completions')
    ? ++truncatedRepairRounds === 1 ? toolCall('search_assets', { query: '爆炸', scope: 'effect' }) : new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: repairableFinal.slice(0, -2) } }] }))
    : result([asset]) }), error => error.code === 'OUTPUT_TRUNCATED', 'A truncated agent final cannot be repaired into apparent success');
  await assert.rejects(() => requestAgentSearch(payload, { ...options, fetcher: async () => new Response('{choices:[{message:{content:"{}"},}],}') }), error => error.code === 'INVALID_RESPONSE', 'Agent provider envelopes remain strict JSON');

  const unclearQuery = '想做解锁反馈，但还没想好声音，先聊聊可以是什么感觉';
  const clarificationPayload = buildAgentSearchPayload(unclearQuery, 'zh-CN', 'sound', [], true, 'clarification');
  let clarificationModelCalls = 0, clarificationRetrievalCalls = 0;
  const clarified = await requestAgentSearch(clarificationPayload, { ...options, fetcher: async (url, input) => {
    if (!url.endsWith('/chat/completions')) { clarificationRetrievalCalls++; throw new Error(`Unexpected clarification retrieval ${url}`); }
    clarificationModelCalls++;
    assert.equal(JSON.parse(input.body).tool_choice, 'auto', 'DeepSeek may ask a useful question before searching');
    return finalValue({ answer: '更想要轻巧咔哒、清脆上扬，还是柔和的电子音？', matches: [], clarification: true });
  } });
  assert.equal(clarificationModelCalls, 1, 'Direct clarification finishes after one model request');
  assert.equal(clarificationRetrievalCalls, 0, 'Direct clarification does not search or read details');
  assert.deepEqual(clarified.matches, []); assert.deepEqual(clarified.resources, []);
  assert.equal(Object.hasOwn(clarified, 'clarification'), false, 'The host consumes the protocol marker');

  const directionPayload = buildAgentSearchPayload('清脆上扬，短一点', 'zh-CN', 'sound', [question(unclearQuery), answer(clarified.answer, [])], true, 'direction');
  assert.equal(directionPayload.messages.length, 2, 'A completed clarification without cards stays in the next turn');
  assert.deepEqual(directionPayload.previousIds, []);
  const directionAsset = { resourceId: 'sound:50928', kind: 'sound', title: '提示性UI_重_提示_03', description: '短促清脆金属撞击，伴明亮鸣响迅速衰减。', keywords: ['短促', '清脆'], hasAudio: true };
  let directionModelCalls = 0, directionSearchCalls = 0, directionDetailCalls = 0;
  const direction = await requestAgentSearch(directionPayload, { ...options, fetcher: async (url, input) => {
    const body = JSON.parse(input.body);
    if (url.endsWith('/chat/completions')) {
      if (++directionModelCalls === 1) {
        assert.equal(body.messages[1].content, unclearQuery);
        assert.equal(body.messages[2].content, clarified.answer, 'The question and its offered directions reach the model');
        return toolCall('search_assets', { query: '短促 清脆 上扬', scope: 'sound', matchOn: 'audio', searchType: 'feature' });
      }
      return final([{ resourceId: directionAsset.resourceId, reason: '用途建议：短促清脆的听感可尝试用于解锁反馈', matchType: 'suggestion' }]);
    }
    if (url.endsWith('/search')) { directionSearchCalls++; assert.equal(body.searchType, 'feature'); return result([directionAsset]); }
    if (url.endsWith('/assets')) { directionDetailCalls++; return details([directionAsset]); }
    throw new Error(`Unexpected direction route ${url}`);
  } });
  assert.equal(directionModelCalls, 2); assert.equal(directionSearchCalls, 1); assert.equal(directionDetailCalls, 1);
  assert.equal(direction.matches[0].resourceId, directionAsset.resourceId);
  assert.equal(direction.matches[0].matchType, 'suggestion', 'Feature evidence can support a clearly labeled use recommendation');

  for (const value of [
    { answer: '选哪个方向？', matches: [], clarification: false },
    { answer: '选哪个方向？', matches: [], clarification: 'true' },
    { answer: '选哪个方向？', matches: [], clarification: null },
    { answer: '选哪个方向？', matches: [], clarification: true, unknown: 'Do not discard this field' },
    { answer: '选哪个方向？', matches: [], unknown: true },
    { answer: ' ', matches: [], clarification: true },
    { answer: '选哪个方向？', clarification: true },
    { answer: '选哪个方向？', matches: {}, clarification: true },
    { answer: '未经搜索的资源', matches: [{ resourceId: asset.resourceId, reason: '猜测', matchType: 'feature' }], clarification: true },
  ]) {
    await assert.rejects(() => requestAgentSearch(clarificationPayload, { ...options, fetcher: async () => finalValue(value) }), error => error.code === 'RESPONSE_FORMAT', 'A clarification accepts only the true marker, nonempty answer and empty matches, without extra fields');
  }

  let afterSearchModelCalls = 0, afterSearchDetailCalls = 0;
  const afterSearchClarification = await requestAgentSearch(payload, { ...options, fetcher: async url => {
    if (url.endsWith('/chat/completions')) return ++afterSearchModelCalls === 1 ? toolCall('search_assets', { query: '爆炸', scope: 'effect' })
      : finalValue({ answer: '更想要烟尘还是明亮的闪光？', matches: [], clarification: true });
    if (url.endsWith('/search')) return result([asset]);
    afterSearchDetailCalls++; throw new Error(`Unexpected empty-match detail route ${url}`);
  } });
  assert.equal(afterSearchModelCalls, 2); assert.equal(afterSearchDetailCalls, 0);
  assert.deepEqual(afterSearchClarification.matches, [], 'The same clarification protocol works after tools');
  for (const value of [
    { answer: '确认一下？', matches: [], clarification: false },
    { answer: '确认一下？', matches: [{ resourceId: asset.resourceId, reason: '已搜索资源', matchType: 'feature' }], clarification: true },
  ]) {
    let modelCalls = 0;
    await assert.rejects(() => requestAgentSearch(payload, { ...options, fetcher: async url => url.endsWith('/search') ? result([asset])
      : ++modelCalls === 1 ? toolCall('search_assets', { query: '爆炸', scope: 'effect' }) : finalValue(value) }), error => error.code === 'RESPONSE_FORMAT', 'Tool evidence does not permit invalid clarification markers or nonempty clarification matches');
  }

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
  const gameUse = '升级完成反馈：短促尖锐起音可用于有穿透力的强化确认';
  const gameSound = { resourceId: 'sound:50941', kind: 'sound', title: '短音', description: '短促尖锐电子音', keywords: ['短促', '尖锐'],
    suggestedUses: ['影视转场：短促尖锐电子音', '消息通知：短促尖锐电子音', '视频剪辑点缀：短促尖锐电子音', gameUse] };
  let gameRounds = 0;
  const gameFound = await requestAgentSearch(buildAgentSearchPayload('更短', 'zh-CN', 'sound', [question('适合升级的尖锐音效'), answer('可尝试尖锐的强化确认。', [])], true, 'game-upgrade', 10, 'audio'), {
    ...options, fetcher: async (url, input) => {
      const body = JSON.parse(input.body);
      if (url.endsWith('/chat/completions')) {
        if (++gameRounds === 1) return toolCall('search_assets', { query: '升级 短促 尖锐', scope: 'sound', matchOn: 'audio', searchType: 'feature' });
        const observed = JSON.parse(body.messages.filter(message => message.role === 'tool').at(-1).content).items[0];
        assert.equal(observed.suggestedUses[0], gameUse, 'Custom AI sees the relevant added game use beyond the first three legacy entries');
        assert.equal(observed.description, gameSound.description);
        if (gameRounds === 2) return toolCall('get_assets', { ids: [gameSound.resourceId] }, 'game-detail');
        assert.equal(body.tool_choice, 'none');
        assert.ok(body.messages.at(-1).content.includes('Show useful candidates even when few'));
        return finalValue({ answer: '先试这个短音；你想要轻量还是更有力度的升级反馈？', matches: [
          { resourceId: gameSound.resourceId, reason: '用途建议：短促尖锐起音可用于强化确认。', matchType: 'suggestion' },
        ] });
      }
      return url.endsWith('/search') ? result([gameSound]) : details([gameSound]);
    },
  });
  assert.equal(gameRounds, 3); assert.equal(gameFound.matches[0].resourceId, gameSound.resourceId);
  assert.deepEqual(gameFound.resources[0].suggestedUses, gameSound.suggestedUses, 'Prompt excerpts do not change stored uses');
  const legacyPayload = buildSearchPayload('适合升级的尖锐音效', 'zh-CN', 'sound', [], [gameFound.resources[0]], 'legacy-game-upgrade');
  assert.equal(legacyPayload.candidates[0].suggestedUses[0], gameUse, 'Candidate-only AI also receives the relevant game use');
  assert.ok(legacyPayload.candidates[0].description.includes(gameSound.description));
  for (const host of ['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'workspace.cn-beijing.maas.aliyuncs.com']) {
    assert.deepEqual(chatToolCompatibilityOptions(`https://${host}/compatible-mode/v1/chat/completions`, 'qwen-flash'), { parallel_tool_calls: true });
    assert.deepEqual(chatToolCompatibilityOptions(`https://${host}/compatible-mode/v1/chat/completions`, 'qwen-flash', false), { parallel_tool_calls: false });
  }
  for (const host of ['api.deepseek.com', 'proxy.example', 'dashscope.aliyuncs.com.example', 'maas.aliyuncs.com.example']) {
    assert.deepEqual(chatToolCompatibilityOptions(`https://${host}/v1/chat/completions`, 'qwen-flash'), {}, 'Unknown providers do not inherit DashScope options');
  }
  assert.deepEqual(chatToolCompatibilityOptions('https://api.openai.com/v1/chat/completions', 'gpt-6-luna', false), { reasoning_effort: 'none' });
  let dashScopeRounds = 0;
  const dashScopeFound = await requestAgentSearch(buildAgentSearchPayload('机关锁定的声音', 'zh-CN', 'sound', [], true, 'dashscope-dual-search', 10, 'audio'), {
    ...options, config: { ...config, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-flash' },
    fetcher: async (url, input) => {
      const body = JSON.parse(input.body);
      if (url.endsWith('/chat/completions')) {
        dashScopeRounds++;
        assert.equal(body.parallel_tool_calls, dashScopeRounds < 3);
        if (dashScopeRounds === 1) return new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
          { id: 'usage-route', type: 'function', function: { name: 'search_assets', arguments: JSON.stringify({ query: '机关锁定', searchType: 'both' }) } },
          { id: 'acoustic-route', type: 'function', function: { name: 'search_assets', arguments: JSON.stringify({ query: '短促 咔哒', searchType: 'feature' }) } },
        ] } }] }));
        if (dashScopeRounds === 2) {
          assert.equal(body.messages.filter(message => message.role === 'tool').length, 2, 'Both independent results reach the next model round');
          return toolCall('get_assets', { ids: [gameSound.resourceId] }, 'dashscope-detail');
        }
        assert.equal(body.tool_choice, 'none');
        assert.equal(body.messages.filter(message => message.role === 'tool').length, 3);
        return finalValue({ answer: '候选待场景试听。', matches: [{ resourceId: gameSound.resourceId, reason: '用途建议：短音可考虑用于瞬间确认。', matchType: 'suggestion' }] });
      }
      return url.endsWith('/search') ? result([gameSound]) : details([gameSound]);
    },
  });
  assert.equal(dashScopeRounds, 3);
  assert.equal(dashScopeFound.matches[0].resourceId, gameSound.resourceId);
  console.log('PASS agent search: direct and post-tool clarification, retained clarification history, acoustic use recommendations, model-first tools, empty-search rewrite, bounded rounds/tools, previous alternatives, trusted IDs/routes, no BYOK leakage, unsupported-tools no retry, and free agent protocol');
})().catch(error => { console.error(error); process.exitCode = 1; });
