/* Run: node scripts/test-ai-search-more.cjs. Uses the local catalog, without network or model calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { normalizeSearchText, resourceHref, retrieveResources } = require('../src/views/AISearch/resourceCatalog.ts');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../tools/ai-search-service/generated/asset-catalog.json'), 'utf8'));
const resources = catalog.assets.map(asset => ({
  resourceId: asset.resourceId, id: asset.id, kind: asset.kind, locale: 'zh-CN', title: asset.titles['zh-CN'],
  description: asset.description?.['zh-CN'] || '', keywords: asset.keywords?.['zh-CN'] || [], suggestedUses: asset.suggestedUses?.['zh-CN'] || [],
  href: resourceHref(asset.kind, asset.id), hasAudio: asset.hasAudio, duration: asset.duration,
  featureText: normalizeSearchText(asset.facetTexts.feature || ''), audioText: normalizeSearchText(asset.facetTexts.audio || ''),
  suggestionText: normalizeSearchText(asset.facetTexts.suggestion || ''), audioSuggestionText: normalizeSearchText(asset.facetTexts.audioSuggestion || ''),
  audioDescription: asset.audio?.description?.['zh-CN'] || '', audioKeywords: asset.audio?.keywords?.['zh-CN'] || [], audioSuggestedUses: asset.audio?.suggestedUses?.['zh-CN'] || [],
}));
const options = { scope: 'all', includeEffectAudio: true, limit: 5 };
const first = retrieveResources(resources, { ...options, query: '来点爆炸特效' });
assert.equal(first.length, 5);
assert.ok(first.every(item => item.kind === 'effect' && /爆炸/.test(item.featureText)));
const excludeIds = first.map(item => item.resourceId);
for (const query of ['再来点', '再來點', '再来几个', '再來幾個', '多来点', '多來點', '换几个', '換幾個', '再找几个', '再找幾個', '更多']) {
  const more = retrieveResources(resources, { ...options, query, previous: first, previousQuery: '来点爆炸特效', excludeIds });
  assert.equal(more.length, 5, query);
  assert.ok(more.every(item => item.kind === 'effect' && /爆炸/.test(item.featureText)), query);
  assert.ok(more.every(item => !excludeIds.includes(item.resourceId)), query);
}
const legacyMore = retrieveResources(resources, { ...options, query: '再来点', previous: first });
assert.equal(legacyMore.length, 5);
assert.ok(legacyMore.every(item => !excludeIds.includes(item.resourceId)), 'Older callers can retain the previous titles and request unseen assets');
const fresh = retrieveResources(resources, { ...options, query: '低沉雷声音效', previous: first, previousQuery: '来点爆炸特效', excludeIds });
assert.equal(fresh.length, 5);
assert.ok(fresh.every(item => item.kind === 'sound'));
assert.ok(fresh.some(item => /雷声/.test(item.title)), 'A new subject must not inherit explosion effects');
assert.deepEqual(retrieveResources(resources, { ...options, query: '再来点' }), [], 'A missing prior subject cannot be invented');
console.log('AI search more-results regression passed: real explosion assets, 11 follow-up phrasings, no repeats, and fresh topics.');
