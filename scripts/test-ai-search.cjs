/* Run: node scripts/test-ai-search.cjs. No network requests or paid model calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { buildSearchResources, retrieveResources, resolveSearchScope, resolveSearchIntent, normalizeSearchText, resourceHref, loadResourceCatalog } = require('../src/views/AISearch/resourceCatalog.ts');
const { buildSearchContext, isSearchRefinement, buildSearchPayload, buildServerChatPayload, validateSearchAnswer, chatCompletionsUrl, requestSearch: requestSearchActual, parseServerCatalog, parseServerResources, requestServerSearch, requestServerAssets } = require('../src/views/AISearch/aiSearchService.ts');
const promptFixture = '# External prompt fixture\nReturn at most RESULT\\_LIMIT resources.\n';
async function requestSearch(payload, candidates, options) {
  const fetcher = options.fetcher;
  return requestSearchActual(payload, candidates, { ...options, fetcher: async (url, input) => {
    if (String(url).split('?')[0].endsWith('/AISearch/SystemPrompt.md')) {
      assert.equal(options.mode, 'custom', 'Free AI keeps prompt loading inside the Worker');
      assert.equal(input.headers?.Authorization, undefined);
      return new Response(promptFixture, { headers: { 'Content-Type': 'text/markdown' } });
    }
    if (String(url).endsWith('/chat/completions')) {
      const system = JSON.parse(input.body).messages[0].content;
      assert.ok(system.includes('External prompt fixture'));
      assert.ok(system.includes(`at most ${payload.resultLimit} resources`));
    }
    return fetcher(url, input);
  } });
}
const { restoreConversations, previousSearchQuery } = require('../src/views/AISearch/useAISearch.ts');
const sources = [{ kind: 'sound', project: 'SoundEffectPlayer', namespace: 'soundEffectPlayer', data: { data: [
  { id: '1', nameI18nKey: 'soundEffectPlayer.data.1', duration: '3', descriptionI18nKey: 'soundEffectPlayer.description.1' },
  { id: '2', nameI18nKey: 'soundEffectPlayer.data.2', duration: '1' },
  { id: '../bad', nameI18nKey: 'bad' },
] }, dictionaries: { 'zh-CN': { 'soundEffectPlayer.data.1': '低沉雷声', 'soundEffectPlayer.description.1': '一次轰鸣，随后渐弱', 'soundEffectPlayer.data.2': '雷声短音' }, 'en-US': { 'soundEffectPlayer.data.1': 'Thunder rumble', 'soundEffectPlayer.data.2': 'Short thunder' } } },
{ kind: 'effect', project: 'EffectPlayer', namespace: 'effectPlayer', data: { effectData: {
  1: { id: '1', nameI18nKey: 'effectPlayer.data.1', duration: 4, hasAudio: true, audioPath: '1.m4a', visualDescriptionI18nKey: 'effectPlayer.visual.1', visualKeywordsI18nKey: 'effectPlayer.visualKeywords.1', audioDescriptionI18nKey: 'effectPlayer.audio.1', audioKeywordsI18nKey: 'effectPlayer.audioKeywords.1', suggestedUsesI18nKey: 'effectPlayer.uses.1', audioSuggestedUsesI18nKey: 'effectPlayer.audioUses.1' },
  2: { id: '2', hasAudio: false, visualDescriptionI18nKey: 'effectPlayer.visual.1' },
} }, dictionaries: { 'zh-CN': { 'effectPlayer.data.1': '法阵', 'effectPlayer.data.2': '静态法阵', 'effectPlayer.visual.1': '蓝色光环逐渐消散', 'effectPlayer.visualKeywords.1': '蓝色、光环', 'effectPlayer.audio.1': '低沉雷声', 'effectPlayer.audioKeywords.1': '雷声、低沉', 'effectPlayer.uses.1': '传送', 'effectPlayer.audioUses.1': '危险提示' } } },
{ kind: 'bgm', project: 'BgmPlayer', namespace: 'bgmPlayer', data: { data: [{ id: 1, song_id: 900000, time: 180000, minute: 3, second: 0, nameI18nKey: 'bgmPlayer.data.1' }] }, dictionaries: { 'zh-CN': { 'bgmPlayer.data.1': '森林探索' } } }];
const { featuresFromLegacy } = require('./ai-search-feature-fixtures.cjs');
for (const source of sources.filter(source => source.kind !== 'bgm')) source.features = featuresFromLegacy(source);
const catalog = buildSearchResources({ sources, failures: [] }, 'zh-CN');
assert.equal(catalog.length, 5);
assert.equal(catalog.find(item => item.kind === 'bgm').duration, 180, 'NetEase milliseconds must not be sent as seconds');
assert.equal(catalog.find(item => item.kind === 'bgm').href, '/BgmPlayer?id=1');
assert.equal(new Set(catalog.map(item => item.resourceId)).size, catalog.length);
assert.throws(() => resourceHref('sound', '../1'));
assert.equal(buildSearchResources({ sources, failures: [] }, 'ja-JP')[0].title, 'soundEffectPlayer.data.1', 'Missing translations do not fall back to Chinese');
const search = (query, scope = 'sound', includeEffectAudio = true, previous) => retrieveResources(catalog, { query, scope, includeEffectAudio, previous });
assert.deepEqual(new Set(search('雷声').map(item => item.resourceId)), new Set(['sound:1', 'sound:2', 'effect:1']));
assert.equal(search('雷声', 'sound', false).every(item => item.kind === 'sound'), true);
assert.equal(search('蓝色', 'sound').length, 0, 'Visual features must not leak into audio search');
assert.equal(search('雷声', 'all').some(item => item.kind === 'effect'), true);
assert.equal(search('thunder').length, 3, 'Search includes loaded language labels and curated aliases');
const uses = search('传送', 'effect');
assert.equal(uses[0].matchType, 'suggestion');
assert.equal(search('传送', 'sound').length, 0, 'Visual use suggestions cannot describe sound');
const audioResult = search('雷声').find(item => item.kind === 'effect');
assert.deepEqual(audioResult.keywords, ['雷声', '低沉']);
assert.deepEqual(audioResult.suggestedUses, ['危险提示']);
assert.equal(audioResult.description, '低沉雷声');
assert.equal(search('更短', 'sound', true, search('雷声'))[0].id, '2');
assert.equal(search('第三个', 'sound', true, search('雷声'))[0].resourceId, search('雷声')[2].resourceId);
const audioOrdinal = search('第一个', 'sound', true, [catalog.find(item => item.resourceId === 'effect:1')])[0];
assert.equal(audioOrdinal.audioMatch, true);
assert.deepEqual(audioOrdinal.keywords, ['雷声', '低沉'], 'Ordinal follow-up must also keep audio features isolated');
assert.equal(search('不存在的锯齿轮声').length, 0);
const hitSound = { ...catalog[0], resourceId: 'sound:40001', id: '40001', title: '战斗_受击_拳击', featureText: '战斗 受击 拳击', audioText: '战斗 受击 拳击', duration: 1 };
const attackedSound = { ...hitSound, resourceId: 'sound:40002', id: '40002', title: '角色_受到攻击', featureText: normalizeSearchText('角色 受到攻击'), audioText: normalizeSearchText('角色 受到攻击'), duration: 2 };
const visualHits = Array.from({ length: 16 }, (_, index) => ({ ...catalog.find(item => item.resourceId === 'effect:2'), resourceId: `effect:${100 + index}`, id: String(100 + index), title: '受击光环', featureText: '受击 光环', audioText: String(100 + index) }));
const hitAudioEffect = { ...catalog.find(item => item.resourceId === 'effect:1'), resourceId: 'effect:200', id: '200', title: '光环', featureText: '光环 蓝色', audioText: '受击 闷响', audioDescription: '短促的受击闷响', audioKeywords: ['受击', '闷响'] };
const namedAudioEffect = { ...hitAudioEffect, resourceId: 'effect:201', id: '201', title: '受击光环', featureText: '受击 光环 蓝色', audioText: '201', audioDescription: '', audioKeywords: [] };
const hits = [...visualHits, hitSound, attackedSound, hitAudioEffect, namedAudioEffect];
for (const query of ['帮我找受击声', '有没有受击的音效']) {
  const results = retrieveResources(hits, { query, scope: 'all', includeEffectAudio: true });
  assert.equal(resolveSearchScope(query, 'all'), 'sound');
  assert.ok(results.some(item => item.resourceId === hitSound.resourceId));
  assert.ok(results.some(item => item.resourceId === attackedSound.resourceId), 'Hit wording must match 受到攻击');
  assert.ok(results.some(item => item.resourceId === hitAudioEffect.resourceId && item.audioMatch));
  assert.ok(results.every(item => item.kind === 'sound' || item.hasAudio === true && item.audioMatch));
  assert.ok(!results.some(item => item.resourceId === namedAudioEffect.resourceId), 'An effect title alone must not establish audio features');
  const payload = buildSearchPayload(query, 'zh-CN', resolveSearchScope(query, 'all'), [], results, 'hit-regression');
  assert.equal(payload.scope, 'sound');
  assert.ok(payload.candidates.filter(item => item.kind === 'effect').every(item => !item.description.includes('蓝色') && !item.keywords.includes('蓝色')));
}
assert.ok(retrieveResources(hits, { query: '受击声', scope: 'all', includeEffectAudio: false }).every(item => item.kind === 'sound'));
assert.equal(resolveSearchScope('受击特效', 'all'), 'effect');
assert.equal(resolveSearchScope('受击声', 'effect'), 'effect', 'Explicit scope overrides query inference');
assert.deepEqual(resolveSearchIntent('特效里的声音', 'all'), { scope: 'effect', matchOn: 'audio', filters: { hasAudio: true } });
assert.equal(resolveSearchScope('受击音效和特效', 'all'), 'all');
assert.equal(resolveSearchScope('背景音乐', 'all'), 'bgm');
assert.equal(resolveSearchScope('音乐', 'all'), 'bgm');
assert.equal(resolveSearchScope('森林背景音效', 'all'), 'sound');
assert.equal(resolveSearchScope('hit sound', 'all'), 'sound');
assert.equal(resolveSearchScope('hit sound effect', 'all'), 'sound');
assert.equal(resolveSearchScope('impact sound effects', 'all'), 'sound');
assert.equal(resolveSearchScope('звуковой эффект', 'all'), 'sound');
assert.equal(resolveSearchScope('効果音', 'all'), 'sound');
assert.equal(resolveSearchScope('更短一点', 'all', [hitSound]), 'sound');
assert.equal(resolveSearchScope('更短一点', 'all', [{ ...hitAudioEffect, audioMatch: true }]), 'effect');
for (const query of ['короче', '短く']) {
  const previous = [{ ...hitAudioEffect, audioMatch: true }];
  assert.equal(resolveSearchScope(query, 'all', previous), 'effect');
  const refined = retrieveResources(hits, { query, scope: 'all', includeEffectAudio: true, previous });
  assert.equal(refined[0].audioMatch, true);
  assert.deepEqual(refined[0].keywords, ['受击', '闷响']);
}
assert.equal(retrieveResources(hits, { query: '第一个', scope: 'effect', includeEffectAudio: false, previous: [{ ...hitAudioEffect, audioMatch: true }] })[0].audioMatch, true, 'An effect audio match remains a valid effect asset on refinement');
const effectAudioExplosion = { ...hitAudioEffect, resourceId: 'effect:300', id: '300', title: '蓝色护盾', featureText: '蓝色 护盾', visualDescription: '蓝色护盾向外展开', audioText: '猛烈爆炸轰鸣', audioDescription: '猛烈爆炸轰鸣', audioKeywords: ['爆炸', '轰鸣'], audioSuggestionText: '' };
const visualExplosionWind = { ...effectAudioExplosion, resourceId: 'effect:301', id: '301', title: '爆炸闪光', featureText: '爆炸 闪光', visualDescription: '爆炸闪光', audioText: '轻微风声', audioDescription: '轻微风声', audioKeywords: ['风声'] };
const visualExplosionUnknown = { ...visualExplosionWind, resourceId: 'effect:302', id: '302', audioText: '302', audioDescription: '', audioKeywords: [], audioSuggestionText: '爆炸' };
const visualExplosionSilent = { ...effectAudioExplosion, resourceId: 'effect:303', id: '303', title: '无声爆炸', featureText: '无声 爆炸', hasAudio: false };
const explosionSound = { ...hitSound, resourceId: 'sound:304', id: '304', title: '火元素爆炸', featureText: '火元素 爆炸', audioText: '火元素 爆炸' };
const explosionResources = [explosionSound, visualExplosionWind, visualExplosionUnknown, visualExplosionSilent, effectAudioExplosion];
for (const query of ['帮我找一些爆炸的特效的音效', '帮我找一些有爆炸的音效的特效', '特效里的爆炸音效', '带爆炸音效的特效']) {
  assert.deepEqual(resolveSearchIntent(query, 'all'), { scope: 'effect', matchOn: 'audio', filters: { hasAudio: true } });
  const matches = retrieveResources(explosionResources, { query, scope: 'all', includeEffectAudio: false });
  assert.deepEqual(matches.map(item => item.resourceId), ['effect:300'], 'Both relationship orders require the effect owner and observed audio, even with sound expansion disabled');
  assert.equal(matches[0].audioMatch, true);
  assert.equal(matches[0].visualDescription, '蓝色护盾向外展开');
  assert.equal(matches[0].description, '猛烈爆炸轰鸣');
}
assert.deepEqual(resolveSearchIntent('爆炸特效', 'all'), { scope: 'effect', matchOn: 'visual' });
assert.deepEqual(resolveSearchIntent('爆炸音效', 'all'), { scope: 'sound', matchOn: 'audio' });
assert.deepEqual(resolveSearchIntent('爆炸音效和特效', 'all'), { scope: 'all', matchOn: 'any' });
assert.deepEqual(resolveSearchIntent('与特效搭配的爆炸音效', 'all'), { scope: 'sound', matchOn: 'audio' });
assert.equal(resolveSearchIntent('带爆炸音效的特效', 'sound').scope, 'sound', 'An explicit UI scope remains a hard asset filter');
for (const scope of ['sound', 'bgm']) assert.deepEqual(retrieveResources(explosionResources, { query: '爆炸特效', scope, includeEffectAudio: true }), [], 'A visual request cannot return effects outside the user’s explicitly selected sound/BGM scope');
assert.deepEqual(retrieveResources(explosionResources, { query: '有爆炸音效的特效', scope: 'all', includeEffectAudio: true, previous: [explosionSound] }).map(item => item.resourceId), ['effect:300'], 'A fresh explicit effect request replaces a preceding sound result');
assert.ok(retrieveResources(explosionResources, { query: '爆炸特效', scope: 'all', includeEffectAudio: true }).every(item => item.kind === 'effect' && !item.audioMatch));
assert.deepEqual(retrieveResources(explosionResources, { query: '爆炸音效', scope: 'all', includeEffectAudio: true }).map(item => item.resourceId).sort(), ['effect:300', 'sound:304']);
assert.equal(retrieveResources([{ ...visualExplosionUnknown, audioKeywords: ['短促'], audioText: '短促' }], { query: '爆炸', scope: 'effect', matchOn: 'audio', searchType: 'suggestion', includeEffectAudio: false })[0].matchType, 'suggestion', 'Explicit use recommendations remain available without claiming an observed sound');
assert.deepEqual(retrieveResources([{ ...effectAudioExplosion, audioDescription: '', audioKeywords: ['爆炸'], audioText: '爆炸' }], { query: '有爆炸音效的特效', scope: 'all', includeEffectAudio: false }).map(item => item.resourceId), ['effect:300'], 'Observed audio keywords can establish an audio match without a prose description');
assert.equal(resolveSearchIntent('更短', 'all', [{ ...effectAudioExplosion, audioMatch: true }], '爆炸音效').scope, 'sound', 'A sound-topic refinement keeps its original range even if only effect audio was returned');
assert.equal(resolveSearchScope('更短一点', 'all'), 'all', 'No context means no inherited scope');
assert.equal(resolveSearchScope('森林', 'all', [hitSound]), 'all', 'A new topic does not inherit the previous scope');
assert.ok(retrieveResources(hits, { query: '受击', scope: 'all', includeEffectAudio: true, limit: 12 }).some(item => item.kind === 'sound'), 'Equal-score visual IDs cannot exclude all sound candidates');
assert.throws(() => validateSearchAnswer({ answer: 'found', matches: [{ resourceId: 'sound:999', reason: 'invented', matchType: 'feature' }] }, catalog));
assert.throws(() => validateSearchAnswer({ answer: 'found', matches: [{ resourceId: 'sound:1', reason: 'one', matchType: 'feature' }, { resourceId: 'sound:1', reason: 'duplicate', matchType: 'feature' }] }, catalog));
assert.equal(validateSearchAnswer({ answer: 'No match', matches: [] }, catalog).matches.length, 0);
assert.equal(chatCompletionsUrl('https://example.com/v1'), 'https://example.com/v1/chat/completions');
assert.equal(chatCompletionsUrl('https://example.com/v1/chat/completions'), 'https://example.com/v1/chat/completions');
assert.throws(() => chatCompletionsUrl('http://external.example/v1'));
assert.throws(() => chatCompletionsUrl('https://user:secret@example.com/v1'));
const restored = restoreConversations([{ id: 'conversation', messages: [{ role: 'assistant', content: 'test', cards: [{ resourceId: 'sound:1', href: 'javascript:alert(1)', title: 'one' }], status: 'complete', mode: 'basic' }] }]);
assert.equal(restored[0].messages[0].cards[0].href, '/SoundEffectPlayer?id=1');
const question = content => ({ role: 'user', status: 'complete', content, cards: [], mode: 'basic', source: 'basic' });
const reply = (content = 'found', cards = [catalog[0]], status = 'complete') => ({ role: 'assistant', status, content, cards, mode: 'basic', source: 'basic' });
const turn = (content, answer = reply()) => [question(content), answer];
assert.equal(previousSearchQuery([...turn('低沉雷声'), ...turn('更短一点'), ...turn('更短'), ...turn('第三个')]), '低沉雷声', 'Repeated refinements retain the last successful explicit asset topic');
assert.equal(previousSearchQuery([...turn('punch impact sound'), ...turn('shorter'), ...turn('a bit shorter please')]), 'punch impact sound');
assert.equal(previousSearchQuery([...turn('低沉雷声'), ...turn('拳击受击声'), ...turn('再短一点')]), '拳击受击声', 'An explicit new topic replaces the old topic');
assert.equal(previousSearchQuery([...turn('雷声'), ...turn('更短一点', reply('failed', [], 'error')), ...turn('もっと短く')]), '雷声', 'A failed refinement does not replace the base topic');
assert.equal(previousSearchQuery([...turn('更短一点'), ...turn('короче')]), '', 'No prior topic is invented after a context reset');
assert.equal(previousSearchQuery(turn('雷'.repeat(2100))).length, 2000);
const screenshotHistory = [...turn('打架用的激昂的音乐', reply('没有找到', [])),
  ...turn('悠闲的音乐', reply('invalid response', [], 'error')), ...turn('悠闲的音乐', reply('invalid response', [], 'error'))];
assert.deepEqual(buildSearchContext(screenshotHistory, '爆炸特效'), [], 'A new effect query never sends an old music request');
assert.equal(previousSearchQuery(screenshotHistory), '', 'Failed user/assistant pairs cannot become a successful retrieval intent');
assert.deepEqual(buildSearchContext(screenshotHistory, '更短一点'), [], 'A failed new topic blocks falling back to an older successful music topic');
const explosionTurn = turn('爆炸特效', reply('爆炸结果', [catalog.find(item => item.kind === 'effect')]));
const explosionContext = buildSearchContext([...screenshotHistory, ...explosionTurn], '第三个');
assert.equal(explosionContext.length, 2);
assert.equal(previousSearchQuery(explosionContext), '爆炸特效');
assert.equal(explosionContext.some(item => item.content.includes('音乐')), false);
const refinedContext = buildSearchContext([...turn('低沉雷声'), ...turn('更短一点', reply('invalid response', [], 'error'))], '再短一点');
assert.equal(refinedContext.length, 2, 'The entire failed turn is excluded, including its user message');
assert.equal(refinedContext[0].content, '低沉雷声');
assert.deepEqual(buildSearchContext([...turn('雷声'), ...turn('森林音效', reply('canceled', [], 'canceled'))], '再来几个'), [], 'A canceled new topic also forms a context boundary');
const longRefinementHistory = [...turn('低沉雷声'), ...Array.from({ length: 8 }, () => turn('更短一点')).flat()];
const longContext = buildSearchContext(longRefinementHistory, '再短一点');
assert.equal(longContext.length, 8);
assert.equal(longContext[0].content, '低沉雷声', 'The base topic survives bounded refinement history');
assert.equal(previousSearchQuery(longContext), '低沉雷声');
for (const query of ['更短一点', '更低沉一点', '更尖锐一些', '低沉一点', '第三个的声音如何', '再来几个', 'a bit shorter please', 'короче', 'もっと短く']) assert.equal(isSearchRefinement(query), true);
for (const query of ['爆炸特效', '悠闲的音乐', '激昂的音乐', '柔和的音乐', '低沉的音效', '打架用的激昂的音乐', '再找一个雷声', '更多火焰特效']) assert.equal(isSearchRefinement(query), false);
const freshPayload = buildSearchPayload('爆炸特效', 'zh-CN', 'effect', screenshotHistory, [catalog.find(item => item.kind === 'effect')], 'fresh-topic');
assert.deepEqual(freshPayload.messages, []);
const refinedPayload = buildSearchPayload('再短一点', 'zh-CN', 'sound', longContext, [catalog[0]], 'refined-topic');
assert.equal(refinedPayload.messages.length, 8);
assert.ok(refinedPayload.messages[0].content.includes('低沉雷声'));
const huge = buildSearchPayload('雷'.repeat(2000), 'zh-CN', 'all', Array.from({ length: 12 }, () => ({ role: 'assistant', status: 'complete', content: '雷'.repeat(3000), cards: [], mode: 'free' })), Array.from({ length: 12 }, (_, index) => ({ ...catalog[0], resourceId: `sound:${index}`, title: '雷'.repeat(200), description: '雷'.repeat(1600), keywords: Array(10).fill('雷'.repeat(80)), suggestedUses: Array(3).fill('雷'.repeat(200)) })), 'test-request');
assert.ok(new TextEncoder().encode(JSON.stringify(huge)).length <= 21000);
(async () => {
  const payload = buildSearchPayload('雷声', 'zh-CN', 'sound', [], [audioResult], 'test-request');
  let outgoing;
  const result = await requestSearch(payload, [audioResult], { mode: 'custom', config: { baseUrl: 'https://example.com/v1', model: 'test', apiKey: 'test-only-placeholder', rememberKey: false }, freeBase: '/api/ai-search', signal: new AbortController().signal,
    fetcher: async (url, options) => { outgoing = { url, options }; return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answer: '匹配音轨', matches: [{ resourceId: 'effect:1', reason: '雷声', matchType: 'feature' }] }) } }] })); } });
  assert.equal(result.matches[0].resourceId, 'effect:1');
  assert.ok(!outgoing.options.body.includes('蓝色'), 'Visual audio leakage must be prevented in the actual model payload');
  assert.ok(!outgoing.options.body.includes('test-only-placeholder'), 'Keys never belong in model context');
  const genericBody = JSON.parse(outgoing.options.body);
  assert.ok(!('thinking' in genericBody), 'Provider-specific flags must not be sent to arbitrary endpoints');
  assert.ok(!('response_format' in genericBody));
  const customOptions = { mode: 'custom', config: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', apiKey: 'test-only-placeholder', rememberKey: false }, freeBase: '/api/ai-search', signal: new AbortController().signal };
  await requestSearch(payload, [audioResult], { ...customOptions, fetcher: async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.deepEqual(body.thinking, { type: 'disabled' });
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"answer":"没有匹配","matches":[]}' } }] }));
  } });
  await assert.rejects(() => requestSearch(payload, [audioResult], { ...customOptions, fetcher: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"answer":"不完整","matches":[]}' } }] })) }), error => error.code === 'OUTPUT_TRUNCATED');
  await assert.rejects(() => requestSearch(payload, [audioResult], { ...customOptions, fetcher: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '' } }] })) }), error => error.code === 'EMPTY_RESPONSE');
  const version = 'fixture-v1';
  const metadata = { catalogVersion: version, mode: 'keyword', counts: { total: 3000 }, coverage: { described: 2000, total: 3000 } };
  assert.equal(parseServerCatalog(metadata).total, 3000);
  assert.equal(parseServerCatalog(metadata).coverage, 2 / 3);
  const summary = { resourceId: 'effect:777', kind: 'effect', title: 'server-only resource', description: '短促受击闷响', keywords: ['受击'], hasAudio: true, audioMatch: true, href: 'javascript:alert(1)' };
  const serverCandidates = parseServerResources([summary], 'zh-CN');
  assert.equal(serverCandidates[0].href, '/EffectPlayer?id=777', 'Routes never trust server/model supplied href');
  assert.equal(serverCandidates[0].audioDescription, summary.description);
  assert.equal(serverCandidates[0].visualDescription, '', 'A projected audio summary never becomes visual evidence');
  const separateEvidence = parseServerResources([{ ...summary, description: '蓝色护盾展开', audioDescription: '爆炸轰鸣', audioKeywords: ['爆炸'] }], 'zh-CN', new Set(['effect:777']), true)[0];
  assert.equal(separateEvidence.visualDescription, '蓝色护盾展开', 'Trusted legacy detail prose remains available as visual evidence before audio projection');
  assert.equal(separateEvidence.description, '爆炸轰鸣');
  assert.deepEqual(separateEvidence.audioKeywords, ['爆炸']);
  const missingEffectAudio = await requestServerSearch('/api/ai-search', { query: '爆炸', scope: 'effect', matchOn: 'audio', locale: 'zh-CN', includeEffectAudio: false }, new AbortController().signal, async (url, input) => {
    const request = JSON.parse(input.body);
    assert.equal(request.matchOn, 'audio');
    assert.equal(request.scope, 'effect');
    return new Response(JSON.stringify({ ...metadata, total: 0, items: [], hasMore: false, retrievalNotice: { code: 'EFFECT_AUDIO_DESCRIPTION_MISSING' } }));
  });
  assert.equal(missingEffectAudio.retrievalNotice.code, 'EFFECT_AUDIO_DESCRIPTION_MISSING');
  await requestServerSearch('/api/ai-search', { query: '爆炸', scope: 'all', matchOn: 'any', locale: 'zh-CN', includeEffectAudio: true }, new AbortController().signal, async (url, input) => {
    assert.ok(!('matchOn' in JSON.parse(input.body)), 'Default any is omitted for legacy Worker compatibility');
    return new Response(JSON.stringify({ ...metadata, total: 0, items: [], hasMore: false }));
  });
  await assert.rejects(() => requestServerSearch('/api/ai-search', { query: '爆炸', scope: 'effect', matchOn: 'audio', locale: 'zh-CN', includeEffectAudio: false }, new AbortController().signal, async () => new Response('{"error":{"code":"INVALID_SEARCH"}}', { status: 400 })), error => error.code === 'RETRIEVAL_MATCH_ON_UNSUPPORTED');
  await assert.rejects(() => requestServerSearch('/api/ai-search', { query: '爆炸', scope: 'effect', matchOn: 'audio', locale: 'zh-CN', includeEffectAudio: false }, new AbortController().signal, async () => new Response(JSON.stringify({ ...metadata, total: 1, items: [{ ...summary, audioMatch: false }], hasMore: false }))), error => error.code === 'RETRIEVAL_RESPONSE', 'An old service cannot silently return visual matches for an explicit audio facet');
  const useSummary = parseServerResources([{ ...summary, description: '危险提示', suggestedUses: ['危险提示'], matchType: 'suggestion' }], 'zh-CN');
  assert.ok(buildSearchPayload('危险提示', 'zh-CN', 'sound', [], useSummary, 'suggested-use').candidates[0].description.startsWith('Suggested use (not observed feature)'), 'Use-based summary evidence must not be labeled as an observed sound feature');
  assert.throws(() => parseServerResources([{ ...summary, resourceId: 'effect:../bad' }], 'zh-CN'));
  assert.throws(() => parseServerResources([{ ...summary, kind: 'sound' }], 'zh-CN'));
  let searchInput;
  const serverFound = await requestServerSearch('/api/ai-search', { query: '更短一点', scope: 'sound', locale: 'zh-CN', includeEffectAudio: true, previousIds: ['effect:777'], previousQuery: '受击声', limit: 20 }, new AbortController().signal, async (url, options) => {
    assert.equal(url, '/api/ai-search/search'); searchInput = JSON.parse(options.body);
    return new Response(JSON.stringify({ ...metadata, total: 1, hasMore: false, items: [summary] }));
  });
  assert.equal(searchInput.limit, 20);
  assert.deepEqual(searchInput.previousIds, ['effect:777']);
  assert.equal(searchInput.previousQuery, '受击声');
  assert.equal(serverFound.items[0].resourceId, 'effect:777', 'Server candidates need not occur in a stale local catalogue');
  await assert.rejects(() => requestServerSearch('/api/ai-search', { query: '声', scope: 'sound', locale: 'zh-CN', includeEffectAudio: true }, new AbortController().signal, async () => new Response(JSON.stringify({ ...metadata, total: 1, hasMore: false, items: [{ ...summary, audioMatch: false }] }))), error => error.code === 'RETRIEVAL_RESPONSE');
  const serverPayload = buildSearchPayload('受击声', 'zh-CN', 'sound', [], [], 'server-request');
  let freeBody;
  const trustedFree = await requestSearch(serverPayload, serverCandidates, { mode: 'free', config: customOptions.config, freeBase: '/api/ai-search', signal: new AbortController().signal, server: { catalogVersion: version, includeEffectAudio: true }, fetcher: async (url, options) => {
    freeBody = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, undefined, 'BYOK keys must not be sent to the website service');
    return new Response(JSON.stringify({ answer: '已找到', matches: [{ resourceId: 'effect:777', reason: '受击闷响', matchType: 'feature' }], catalogVersion: version, resources: [{ ...summary, audioDescription: '服务端权威音频详情', visualDescription: '蓝色光环', description: '蓝色光环', keywords: ['蓝色'] }] }));
  } });
  assert.deepEqual(freeBody.candidateIds, ['effect:777']);
  assert.deepEqual(freeBody.audioCandidateIds, ['effect:777'], 'Audio facets survive the IDs-only free protocol');
  const mixedBody = buildServerChatPayload({ ...serverPayload, scope: 'all' }, serverCandidates, version, true);
  assert.equal(mixedBody.scope, 'all');
  assert.deepEqual(mixedBody.audioCandidateIds, ['effect:777'], 'All-scope audio facets are carried independently of the kind');
  assert.ok(!('candidates' in freeBody) && !JSON.stringify(freeBody).includes(summary.description), 'Server free model receives IDs, not client descriptions');
  const manyServerCandidates = Array.from({ length: 20 }, (_, index) => ({ ...serverCandidates[0], resourceId: `effect:${777 + index}` }));
  const largeServerPayload = buildServerChatPayload(huge, manyServerCandidates, version, true);
  assert.equal(largeServerPayload.candidateIds.length, 20, 'Byte limits trim history rather than dropping authoritative candidate IDs');
  assert.ok(new TextEncoder().encode(JSON.stringify(largeServerPayload)).length <= 21000);
  assert.equal(trustedFree.resources[0].description, '服务端权威音频详情');
  assert.ok(!trustedFree.resources[0].keywords.includes('蓝色'));
  const detailFetch = async () => new Response(JSON.stringify({ catalogVersion: version, items: [{ ...summary, audioMatch: false, description: '视觉光环', audioDescription: '受击声详情', keywords: ['蓝色'], audioKeywords: ['闷响'] }] }));
  const details = await requestServerAssets('/api/ai-search', ['effect:777'], 'zh-CN', version, new AbortController().signal, new Set(['effect:777']), detailFetch);
  assert.equal(details[0].description, '受击声详情');
  assert.deepEqual(details[0].keywords, ['闷响']);
  await assert.rejects(() => requestServerAssets('/api/ai-search', ['effect:777'], 'zh-CN', 'old-version', new AbortController().signal, new Set(), detailFetch), error => error.code === 'CATALOG_CHANGED');
  await assert.rejects(() => requestServerAssets('/api/ai-search', ['effect:777'], 'zh-CN', version, new AbortController().signal, new Set(), async () => new Response(JSON.stringify({ catalogVersion: version, items: [] }))), error => error.code === 'ASSET_DETAILS');
  const largeIds = ['effect:777', 'sound:901', 'sound:902', 'sound:903', 'sound:904'];
  let detailCalls = 0, activeDetails = 0, maxActiveDetails = 0;
  const splitDetails = await requestServerAssets('/api/ai-search', largeIds, 'zh-CN', version, new AbortController().signal, new Set(['effect:777']), async (url, options) => {
    assert.equal(url, '/api/ai-search/assets', 'Splitting details must not call a model');
    const requested = JSON.parse(options.body).ids; detailCalls++;
    if (requested.length > 1) return new Response(JSON.stringify({ error: { code: 'DETAILS_TOO_LARGE' } }), { status: 413 });
    activeDetails++; maxActiveDetails = Math.max(maxActiveDetails, activeDetails);
    await new Promise(resolve => setTimeout(resolve, requested[0] === 'effect:777' ? 15 : 1));
    activeDetails--;
    const id = requested[0];
    return new Response(JSON.stringify({ catalogVersion: version, missingIds: [], items: [{ resourceId: id, kind: id.split(':')[0], title: id, description: '视觉文本', audioDescription: '音轨详情', audioKeywords: ['音轨'] }] }));
  });
  assert.equal(detailCalls, 6, 'First try one batch, then exactly one read per selected ID');
  assert.ok(maxActiveDetails > 1 && maxActiveDetails <= 3, 'Detail reads have at most three concurrent requests');
  assert.deepEqual(splitDetails.map(item => item.resourceId), largeIds, 'Response timing cannot change requested card order');
  assert.equal(splitDetails[0].description, '音轨详情');
  assert.deepEqual(splitDetails[0].keywords, ['音轨']);
  const verifyDetailFailure = async (firstStatus, firstCode, singleReply, expectedCode, expectedCalls) => {
    let calls = 0;
    await assert.rejects(() => requestServerAssets('/api/ai-search', ['sound:901', 'sound:902'], 'zh-CN', version, new AbortController().signal, new Set(), async (url, options) => {
      calls++;
      const requested = JSON.parse(options.body).ids;
      if (requested.length > 1) return new Response(JSON.stringify({ error: { code: firstCode } }), { status: firstStatus });
      return singleReply(requested[0]);
    }), error => error.code === expectedCode);
    assert.equal(calls, expectedCalls);
  };
  await verifyDetailFailure(413, 'DETAILS_TOO_LARGE', () => new Response(JSON.stringify({ error: { code: 'DETAILS_TOO_LARGE' } }), { status: 413 }), 'ASSET_DETAILS', 3);
  await verifyDetailFailure(413, 'DETAILS_TOO_LARGE', id => new Response(JSON.stringify({ catalogVersion: 'changed-version', items: [{ resourceId: id, title: id }] })), 'CATALOG_CHANGED', 3);
  await verifyDetailFailure(413, 'DETAILS_TOO_LARGE', id => new Response(JSON.stringify({ catalogVersion: version, missingIds: [id], items: [] })), 'ASSET_DETAILS', 3);
  await verifyDetailFailure(503, 'DETAILS_TOO_LARGE', () => { throw new Error('must not split a generic server failure'); }, 'ASSET_DETAILS', 1);
  await verifyDetailFailure(413, 'UNKNOWN_ERROR', () => { throw new Error('must not split an unrelated 413'); }, 'ASSET_DETAILS', 1);
  let singleOversizeCalls = 0;
  await assert.rejects(() => requestServerAssets('/api/ai-search', ['sound:901'], 'zh-CN', version, new AbortController().signal, new Set(), async () => {
    singleOversizeCalls++; return new Response(JSON.stringify({ error: { code: 'DETAILS_TOO_LARGE' } }), { status: 413 });
  }), error => error.code === 'ASSET_DETAILS');
  assert.equal(singleOversizeCalls, 1, 'Single-asset size failures are not retried');
  await assert.rejects(() => requestServerSearch('/api/ai-search', { query: '声', scope: 'sound', locale: 'zh-CN', includeEffectAudio: true }, new AbortController().signal, async () => new Response('<html>gateway failure</html>')), error => error.code === 'RETRIEVAL_RESPONSE');
  const failed = await loadResourceCatalog(async () => { throw new Error('offline'); });
  assert.equal(failed.sources.length, 0);
  assert.equal(failed.failures.length, 3);
  // Strict answer validation also diagnoses compatible-provider failures safely.
  const modelReply = (content, extra = {}) => async () => new Response(JSON.stringify({ choices: [{ message: { content }, ...extra }] }));
  const noMatch = '{"answer":"没有符合条件的资源","matches":[]}';
  for (const finishReason of [undefined, null, 'stop']) {
    const compatible = await requestSearch(payload, [audioResult], { ...customOptions, fetcher: modelReply(noMatch, { finish_reason: finishReason }) });
    assert.equal(compatible.matches.length, 0, 'A complete empty-match JSON answer remains valid when compatible gateways omit finish_reason');
  }
  const fenced = await requestSearch(payload, [audioResult], { ...customOptions, fetcher: modelReply(`\n\x60\x60\x60json\n${noMatch}\n\x60\x60\x60\n`, { finish_reason: 'stop' }) });
  assert.equal(fenced.answer, '没有符合条件的资源');
  const repairable = "{answer:'匹配音轨', matches:[{resourceId:'effect:1', reason:'雷声', matchType:'feature',}],}";
  let repairedCalls = 0;
  const repaired = await requestSearch(payload, [audioResult], { ...customOptions, fetcher: async () => {
    repairedCalls++;
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: repairable } }] }));
  } });
  assert.equal(repaired.matches[0].resourceId, 'effect:1');
  assert.equal(repairedCalls, 1, 'Repairing final JSON does not issue a new paid model request');
  const repairedInvalidId = "{answer:'found',matches:[{resourceId:'effect:999',reason:'invented',matchType:'feature',}],}";
  await assert.rejects(() => requestSearch(payload, [audioResult], { ...customOptions, fetcher: modelReply(repairedInvalidId, { finish_reason: 'stop' }) }), error => error.code === 'RESPONSE_ASSET_ID' && error.rawResponse === repairedInvalidId, 'Repair never bypasses the ID allowlist, and diagnostics keep the original model text');
  const repairedDuplicate = "{answer:'found',matches:[{resourceId:'effect:1',reason:'one',matchType:'feature'},{resourceId:'effect:1',reason:'duplicate',matchType:'feature'},],}";
  await assert.rejects(() => requestSearch(payload, [audioResult], { ...customOptions, fetcher: modelReply(repairedDuplicate, { finish_reason: 'stop' }) }), error => error.code === 'RESPONSE_ASSET_ID', 'Repair does not remove duplicate matches');
  const tooMany = "{answer:'found',matches:[" + Array.from({ length: payload.resultLimit + 1 }, () => "{resourceId:'effect:1',reason:'one',matchType:'feature'}").join(',') + ",],}";
  await assert.rejects(() => requestSearch(payload, [audioResult], { ...customOptions, fetcher: modelReply(tooMany, { finish_reason: 'stop' }) }), error => error.code === 'RESPONSE_FORMAT', 'Repaired output retains the configured result-count bound');
  await assert.rejects(() => requestSearch(payload, [audioResult], { ...customOptions, fetcher: modelReply("{answer:'missing matches',}", { finish_reason: 'stop' }) }), error => error.code === 'RESPONSE_FORMAT', 'Repair cannot invent required fields');
  await assert.rejects(() => requestSearch(payload, [audioResult], { ...customOptions, fetcher: modelReply(repairable.slice(0, -2), { finish_reason: 'stop' }) }), error => error.code === 'RESPONSE_FORMAT', 'An obviously unfinished outer object remains an error even without the provider length flag');
  await assert.rejects(() => requestSearch(payload, [audioResult], { ...customOptions, fetcher: modelReply(repairable.slice(0, -2), { finish_reason: 'length' }) }), error => error.code === 'OUTPUT_TRUNCATED', 'Provider truncation is rejected even when jsonrepair could close the brackets');
  await assert.rejects(() => requestSearch(payload, [audioResult], { ...customOptions, fetcher: async () => new Response('{choices:[{message:{content:"{}"},}],}') }), error => error.code === 'INVALID_RESPONSE', 'Provider HTTP envelopes remain strict JSON');
  await assert.rejects(() => requestSearch(payload, [audioResult], { ...customOptions, fetcher: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: null, reasoning_content: noMatch } }] })) }), error => error.code === 'EMPTY_RESPONSE', 'Reasoning text never replaces a missing final answer');
  for (const content of ['这里是结果：' + noMatch, '{"answer":"没有匹配"}', '{"answer":"found","matches":[{"resourceId":"effect:1","reason":"雷声"}]}']) {
    await assert.rejects(() => requestSearch(payload, [audioResult], { ...customOptions, fetcher: modelReply(content, { finish_reason: 'stop' }) }), error => error.code === 'RESPONSE_FORMAT');
  }
  await assert.rejects(() => requestSearch(payload, [audioResult], { ...customOptions, fetcher: modelReply(noMatch, { finish_reason: 'tool_calls' }) }), error => error.code === 'RESPONSE_FORMAT');
  const hiddenCandidate = { ...audioResult, resourceId: 'effect:999', id: '999' };
  const hiddenMatch = JSON.stringify({ answer: 'found', matches: [{ resourceId: hiddenCandidate.resourceId, reason: 'not sent', matchType: 'feature' }] });
  await assert.rejects(() => requestSearch(payload, [audioResult, hiddenCandidate], { ...customOptions, fetcher: modelReply(hiddenMatch, { finish_reason: 'stop' }) }), error => error.code === 'RESPONSE_ASSET_ID', 'Only IDs actually included in the model context can become cards');
  await assert.rejects(() => requestSearch(payload, [audioResult], { ...customOptions, fetcher: async () => new Response('{"error":{"message":"provider rejected"}}', { status: 400 }) }), error => error.code === 'MODEL_REQUEST_REJECTED');
  console.log('PASS AI search: verified IDs, audio/visual isolation, locales, context, payload bounds, legacy + server model validation, trusted details, safe restoration, compatible provider diagnostics, and offline loading');
})().catch(error => { console.error(error); process.exitCode = 1; });
