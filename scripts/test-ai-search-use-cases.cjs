/* Run: node --test scripts/test-ai-search-use-cases.cjs. Offline, no model calls. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { retrieveResources } = require('../src/views/AISearch/resourceCatalog.ts');
const { parseServerResources } = require('../src/views/AISearch/aiSearchService.ts');

function resource(kind, id, feature, uses = [], audio = '', audioUses = []) {
  return { resourceId: `${kind}:${id}`, id: String(id), kind, title: `资源${id}`, locale: 'zh-CN', href: '/',
    description: feature, keywords: feature.split(' '), suggestedUses: uses, featureText: feature, suggestionText: uses.join(' '),
    hasAudio: true, visualDescription: kind === 'effect' ? feature : '', audioDescription: audio,
    audioKeywords: audio.split(' ').filter(Boolean), audioSuggestedUses: audioUses,
    audioText: kind === 'effect' ? audio || String(id) : feature, audioSuggestionText: audioUses.join(' ') };
}
const sounds = [resource('sound', 1, '尖锐 上扬'), resource('sound', 2, '低沉 闷响', ['升级反馈']), resource('sound', 3, '尖锐 上扬', ['升级反馈'])];
const effects = [resource('effect', 1, '尖锐 光束', ['升级反馈'], '低沉 闷响', ['危险提示']),
  resource('effect', 2, '绿色 光环', [], '尖锐 上扬', ['升级反馈']),
  resource('effect', 3, '绿色 光环', ['升级反馈'], '尖锐 上扬')];

test('default local sound search ranks the joint use/acoustic match above either partial match', () => {
  const results = retrieveResources(sounds, { query: '升级 尖锐音效', scope: 'all', includeEffectAudio: false });
  assert.equal(results[0].resourceId, 'sound:3');
  assert.equal(results[0].description, '尖锐 上扬');
  assert.equal(results[0].matchType, 'feature');
  assert.deepEqual(results[0].keywords, ['尖锐', '上扬']);
  assert.deepEqual(results[0].suggestedUses, ['升级反馈']);
  const uses = retrieveResources(sounds, { query: '升级音效', scope: 'all', includeEffectAudio: false });
  assert.deepEqual(uses.map(item => item.resourceId), ['sound:2', 'sound:3']);
  assert.ok(uses.every(item => item.matchType === 'suggestion'));
});

test('explicit feature searches do not gain scores or recall from local use suggestions', () => {
  const options = { scope: 'sound', matchOn: 'audio', includeEffectAudio: false, searchType: 'feature' };
  assert.deepEqual(retrieveResources(sounds, { ...options, query: '升级 尖锐' }).map(item => item.resourceId), ['sound:1', 'sound:3']);
  assert.deepEqual(retrieveResources(sounds, { ...options, query: '升级' }), []);
  const suggestions = retrieveResources(sounds, { ...options, searchType: 'suggestion', query: '升级 尖锐' });
  assert.deepEqual(suggestions.map(item => item.resourceId), ['sound:2', 'sound:3']);
  assert.ok(suggestions.every(item => item.matchType === 'suggestion'));
});

test('local use advice cannot lend audio evidence to a visual match or visual evidence to audio', () => {
  const options = { query: '升级 尖锐', scope: 'effect', matchOn: 'audio', includeEffectAudio: false };
  const audio = retrieveResources(effects, options);
  assert.deepEqual(audio.map(item => item.resourceId), ['effect:2', 'effect:3']);
  assert.equal(audio[0].audioMatch, true);
  assert.equal(audio[0].description, '尖锐 上扬');
  assert.deepEqual(audio[0].suggestedUses, ['升级反馈']);
  const visual = retrieveResources(effects, { ...options, matchOn: 'visual' });
  assert.equal(visual[0].resourceId, 'effect:1');
  assert.ok(visual.every(item => !item.audioMatch));
  const both = retrieveResources([effects[2]], { ...options, matchOn: 'any' });
  assert.equal(both.length, 1);
  assert.equal(both[0].audioMatch, true, 'The matching sharp audio wins independently; visual upgrade advice must not be merged into it');
  assert.deepEqual(both[0].suggestedUses, []);
});

test('local feature matches retain relevant use advice ahead of unrelated suggestions', () => {
  const item = resource('sound', 4, '尖锐 上扬', ['界面关闭', '战斗命中', '拾取道具', '升级反馈']);
  const result = retrieveResources([item], { query: '升级 尖锐', scope: 'sound', includeEffectAudio: false })[0];
  assert.equal(result.matchType, 'feature');
  assert.equal(result.suggestedUses[0], '升级反馈');
  assert.equal(result.description, '尖锐 上扬');
});

test('a server use-only audio summary survives client parsing without becoming invented auditory evidence', async () => {
  const { searchAssets } = await import('../tools/ai-search-service/asset-search.mjs');
  const asset = (id, audio) => ({ resourceId: `effect:${id}`, id: String(id), kind: 'effect', hasAudio: true,
    titles: { 'zh-CN': '绿色光环' }, description: { 'zh-CN': '绿色光环' }, keywords: {}, suggestedUses: {},
    audio: { description: audio ? { 'zh-CN': audio } : {}, keywords: {}, suggestedUses: { 'zh-CN': ['升级反馈'] } },
    facetTexts: { feature: '绿色光环', suggestion: '', audio, audioSuggestion: '升级反馈' } });
  const result = await searchAssets({ query: '升级', scope: 'effect', matchOn: 'audio', searchType: 'suggestion' },
    { ASSET_SEARCH_CATALOG: { indexVersion: 'use-case-fixture', assets: [asset(1, '短促 清脆'), asset(2, '')] } });
  const parsed = parseServerResources(result.candidates, 'zh-CN');
  assert.equal(parsed.find(item => item.id === '1').audioDescription, '短促 清脆');
  assert.equal(parsed.find(item => item.id === '2').audioDescription, '');
  assert.ok(parsed.every(item => item.audioMatch && item.matchType === 'suggestion'));
  assert.ok(parsed.every(item => item.suggestedUses.includes('升级反馈')));
  assert.ok(parsed.every(item => !item.audioDescription.includes('升级')));
});

test('search, trusted details and client parsing retain a game use added after the first three older uses', async () => {
  const { searchAssets, getAssetDetails } = await import('../tools/ai-search-service/asset-search.mjs');
  const uses = ['界面关闭', '战斗命中', '拾取道具', '升级反馈'];
  const observed = { description: { 'zh-CN': '尖锐 上扬' }, keywords: { 'zh-CN': ['尖锐', '上扬'] }, suggestedUses: { 'zh-CN': uses } };
  const env = { ASSET_SEARCH_CATALOG: { indexVersion: 'detail-use-fixture', assets: [
    { resourceId: 'sound:1', id: '1', kind: 'sound', hasAudio: true, titles: { 'zh-CN': '音色一' }, ...observed,
      facetTexts: { feature: '尖锐 上扬', suggestion: uses.join(' ') } },
    { resourceId: 'effect:2', id: '2', kind: 'effect', hasAudio: true, titles: { 'zh-CN': '光环二' },
      description: { 'zh-CN': '绿色 光环' }, keywords: {}, suggestedUses: {}, audio: observed,
      facetTexts: { feature: '绿色 光环', audio: '尖锐 上扬', audioSuggestion: uses.join(' ') } },
  ] } };
  const search = await searchAssets({ query: '升级 尖锐', scope: 'sound', matchOn: 'audio' }, env);
  assert.equal(search.candidates.length, 2);
  assert.ok(search.candidates.every(item => item.suggestedUses[0] === '升级反馈'));
  const audioIds = new Set(search.candidates.filter(item => item.audioMatch).map(item => item.resourceId));
  const details = getAssetDetails(search.candidates.map(item => item.resourceId), 'zh-CN', env);
  const parsed = parseServerResources(details.assets, 'zh-CN', audioIds, true);
  assert.ok(parsed.every(item => item.suggestedUses.includes('升级反馈')), 'Reading trusted details must not replace the relevant game use with only the first three older entries');
  assert.ok(parsed.every(item => item.description.includes('尖锐')));
  assert.equal(parsed.find(item => item.kind === 'effect').audioDescription, '尖锐 上扬');
});
