import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import legacyCatalog from './generated/asset-catalog.json' with { type: 'json' };
import { getCatalogInfo as catalogInfoImpl, getAssetDetails as assetDetailsImpl, searchAssets as assetSearchImpl, validateSearchInput, normalizeAssetText } from './asset-search.mjs';

// Full legacy descriptions are test fixtures only; production imports the identity-only catalog.
const legacyEnv = { ASSET_SEARCH_CATALOG: legacyCatalog };
const getCatalogInfo = (env = legacyEnv) => catalogInfoImpl(env);
const getAssetDetails = (ids, locale = 'zh-CN', env = legacyEnv) => assetDetailsImpl(ids, locale, env);
const searchAssets = (raw, env = legacyEnv) => assetSearchImpl(raw, env);

const require = createRequire(import.meta.url);
const { buildCatalog, buildIdentityCatalog, SOURCES, LOCALES } = require('../../scripts/build-ai-asset-catalog.cjs');
function asset(kind, id, feature, options = {}) {
  const audio = options.audio || '';
  return { resourceId: `${kind}:${id}`, id: String(id), kind, titles: { 'zh-CN': options.title || feature },
    description: { 'zh-CN': options.description || feature }, detailedDescription: {}, keywords: {},
    suggestedUses: options.uses ? { 'zh-CN': [options.uses] } : {},
    audio: { description: audio ? { 'zh-CN': audio } : {}, detailedDescription: {}, keywords: {}, suggestedUses: {} },
    hasAudio: kind === 'sound' || kind === 'bgm' || options.hasAudio === true,
    duration: options.duration ?? 1, isLoop: options.isLoop ?? false, category: options.category || kind,
    facetTexts: { feature, audio, suggestion: options.uses || '', audioSuggestion: '' } };
}
function fixture(assets, version = 'fixture-v1') {
  return { schemaVersion: 1, indexVersion: version, sourceBase: 'offline-fixture', coverage: { total: assets.length }, assets };
}
function envFor(assets, version) { return { ASSET_SEARCH_CATALOG: fixture(assets, version) }; }

test('deployment fixture covers all three sources and returns the description language honestly', () => {
  const info = getCatalogInfo();
  assert.ok(info.count > 5000);
  assert.equal(info.count, info.coverage.total);
  for (const kind of ['sound', 'effect', 'bgm']) assert.ok(info.coverage.byKind[kind] > 0);
  assert.equal(info.mode, 'keyword');
  assert.ok(info.coverage.descriptionLocales['en-US'] > 0);
  const item = getAssetDetails(['sound:40106'], 'en-US').assets[0];
  assert.match(item.title, /Punch/i);
  assert.equal(item.descriptionLocale, 'en-US');
  assert.ok(item.shortDescription.length > 0);
  assert.equal(item.href, '/SoundEffectPlayer?id=40106');
  assert.deepEqual(getAssetDetails([], 'zh-cn').assets, []);
  assert.equal(getCatalogInfo().counts.total, info.count);
});

test('real body-hit description is searchable, including a multilingual alias', async () => {
  for (const query of ['拳击音效', 'punch sound', 'パンチ 効果音']) {
    const result = await searchAssets({ query, scope: 'sound', limit: 30 });
    assert.ok(result.candidates.some(item => item.resourceId === 'sound:40106'), query);
    assert.ok(result.candidates.every(item => item.kind === 'sound' || item.audioMatch));
  }
  const body = await searchAssets({ query: '沉闷短促击打', scope: 'sound', limit: 30 });
  assert.ok(body.candidates.some(item => item.kind === 'sound' && item.description.includes('沉闷')));
});

test('general received-hit queries retain distinct physical-hit and creature-reaction senses', async () => {
  const result = await searchAssets({ query: '受到攻击的音效', scope: 'sound', limit: 30 });
  assert.ok(result.candidates.some(item => /躯体打击/.test(item.title)));
  assert.ok(result.candidates.some(item => /叫声/.test(item.title)));
  assert.ok(result.candidates.every(item => item.kind === 'sound'));
});

test('colloquial Chinese fist/body requests rank physical punch sounds above generic short or weapon sounds', async () => {
  const result = await searchAssets({ query: '拳头打到身体上，短促一点', scope: 'sound', limit: 5 });
  assert.equal(result.candidates.length, 5);
  assert.ok(result.candidates.some(item => item.resourceId === 'sound:40106'));
  assert.ok(result.candidates.every(item => /躯体打击_拳击/.test(item.title)));
  const traditional = await searchAssets({ query: '拳頭打到身體上', scope: 'sound', limit: 5 });
  assert.ok(traditional.candidates.every(item => /拳击/.test(item.title)));
});

test('music mood searches explain missing descriptors without inventing title-based recommendations', async () => {
  for (const query of ['打架用的激昂的音乐', '悠闲的音乐']) {
    const result = await searchAssets({ query, scope: 'all', limit: 20 });
    assert.equal(result.effectiveScope, 'bgm');
    assert.equal(result.total, 0);
    assert.deepEqual(result.candidates, []);
    assert.deepEqual(result.retrievalNotice, { code: 'MUSIC_DESCRIPTION_MISSING' });
  }
  const named = await searchAssets({ query: '战斗的秘仪', scope: 'bgm', limit: 20 });
  assert.ok(named.candidates.some(item => item.resourceId === 'bgm:10044'));
  assert.equal(named.retrievalNotice, undefined);
  const freshEffect = await searchAssets({ query: '爆炸特效', scope: 'all', previousQuery: '悠闲的音乐', previousIds: ['bgm:10044'] });
  assert.equal(freshEffect.effectiveScope, 'effect');
  assert.ok(freshEffect.candidates.length > 0);
  assert.ok(freshEffect.candidates.every(item => item.kind === 'effect'));
  assert.equal(freshEffect.retrievalNotice, undefined);
});

test('music missing-description notice does not claim a catalog with genuine music descriptors lacks them', async () => {
  const env = envFor([asset('bgm', 1, '舒缓旋律', { description: '舒缓、柔和的音乐' })]);
  const empty = await searchAssets({ query: '激昂的音乐', scope: 'bgm' }, env);
  assert.equal(empty.total, 0);
  assert.equal(empty.retrievalNotice, undefined);
  const matched = await searchAssets({ query: '舒缓音乐', scope: 'bgm' }, env);
  assert.equal(matched.candidates[0].resourceId, 'bgm:1');
  assert.equal(matched.retrievalNotice, undefined);
});

test('Chinese, traditional Chinese, English, Japanese and Russian aliases normalize consistently', async () => {
  const env = envFor([asset('sound', 1, '低沉雷声'), asset('sound', 2, '按钮点击')]);
  for (const query of ['雷声', '雷聲', 'thunder', '雷鳴', 'гром']) {
    const result = await searchAssets({ query }, env);
    assert.equal(result.candidates[0].resourceId, 'sound:1', query);
  }
  assert.equal(normalizeAssetText('受擊'), normalizeAssetText('受到攻击'));
});

test('sound scope searches only verified effect audio evidence, never visual names or absent audio', async () => {
  const env = envFor([
    asset('effect', 1, '雷声蓝色烟雾', { hasAudio: true, audio: '清脆按钮点击' }),
    asset('effect', 2, '按钮点击', { hasAudio: false, audio: '按钮点击' }),
    asset('effect', 3, '雷声光效', { hasAudio: true }),
    asset('sound', 4, '低沉雷声'),
  ]);
  const thunder = await searchAssets({ query: '雷声音效', scope: 'sound' }, env);
  assert.deepEqual(thunder.candidates.map(item => item.resourceId), ['sound:4']);
  const click = await searchAssets({ query: '按钮音效', scope: 'sound' }, env);
  assert.equal(click.candidates[0].resourceId, 'effect:1');
  assert.equal(click.candidates[0].audioMatch, true);
  assert.equal(click.candidates[0].description, '清脆按钮点击');
  const standalone = await searchAssets({ query: '按钮音效', scope: 'sound', includeEffectAudio: false }, env);
  assert.equal(standalone.total, 0);
  const visual = await searchAssets({ query: '蓝色烟雾', scope: 'effect' }, env);
  assert.equal(visual.candidates[0].resourceId, 'effect:1');
});

test('effect audio requests select the effect soundtrack independently of its visual appearance and the sound-scope checkbox', async () => {
  const env = envFor([
    asset('sound', 1, '爆炸低频声'),
    asset('effect', 2, '火焰爆炸特效', { hasAudio: true, audio: '风声呼啸' }),
    asset('effect', 3, '蓝色光环', { hasAudio: true, audio: '爆炸低频声' }),
    asset('effect', 4, '爆炸特效音效', { hasAudio: true }),
    asset('effect', 5, '爆炸光团', { hasAudio: false, audio: '爆炸低频声' }),
    asset('bgm', 6, '爆炸音乐'),
  ]);
  for (const query of ['爆炸', '帮我找一些爆炸的特效的音效', '帮我找一些有爆炸的音效的特效']) {
    const result = await searchAssets({ query, scope: 'effect', matchOn: 'audio', includeEffectAudio: false,
      searchType: 'feature', filters: { hasAudio: true } }, env);
    assert.deepEqual(result.candidates.map(item => item.resourceId), ['effect:3'], query);
    assert.equal(result.candidates[0].audioMatch, true); assert.equal(result.candidates[0].description, '爆炸低频声');
  }
  const visual = await searchAssets({ query: '爆炸', scope: 'effect', matchOn: 'visual', searchType: 'feature' }, env);
  assert.ok(visual.candidates.some(item => item.resourceId === 'effect:2'));
  assert.ok(visual.candidates.every(item => item.kind === 'effect' && !item.audioMatch));
  assert.equal(visual.candidates.some(item => item.resourceId === 'effect:3'), false);
  assert.equal((await searchAssets({ query: '爆炸', scope: 'sound', matchOn: 'visual' }, env)).total, 0);
  const soundOnly = await searchAssets({ query: '爆炸', scope: 'sound', matchOn: 'audio', includeEffectAudio: false }, env);
  assert.deepEqual(soundOnly.candidates.map(item => item.resourceId), ['sound:1']);
  const soundAndEffect = await searchAssets({ query: '爆炸', scope: 'sound', matchOn: 'audio' }, env);
  assert.deepEqual(new Set(soundAndEffect.candidates.map(item => item.resourceId)), new Set(['sound:1', 'effect:3']));
  assert.equal((await searchAssets({ query: '爆炸音乐', scope: 'bgm', matchOn: 'audio' }, env)).candidates[0].resourceId, 'bgm:6');
});

test('two effect/audio word orders imply effect assets while parallel sound and effect types remain broad', async () => {
  const env = envFor([asset('sound', 1, '爆炸'), asset('effect', 2, '爆炸', { hasAudio: true, audio: '爆炸声' })]);
  for (const query of ['帮我找一些爆炸的特效的音效', '帮我找一些有爆炸的音效的特效', '特效里的爆炸音效']) {
    const result = await searchAssets({ query, scope: 'all', matchOn: 'audio' }, env);
    assert.equal(result.effectiveScope, 'effect'); assert.deepEqual(result.candidates.map(item => item.resourceId), ['effect:2']);
  }
  const parallel = await searchAssets({ query: '爆炸音效和特效', scope: 'all' }, env);
  assert.equal(parallel.effectiveScope, 'all');
  assert.deepEqual(new Set(parallel.candidates.map(item => item.kind)), new Set(['sound', 'effect']));
});

test('missing effect soundtrack notice means the whole effect audio corpus lacks features, not a query miss', async () => {
  const missing = envFor([asset('effect', 1, '爆炸特效', { hasAudio: true }), asset('sound', 2, '爆炸音效'), asset('bgm', 3, '爆炸音乐')]);
  const result = await searchAssets({ query: '爆炸', scope: 'effect', matchOn: 'audio' }, missing);
  assert.equal(result.total, 0); assert.deepEqual(result.retrievalNotice, { code: 'EFFECT_AUDIO_DESCRIPTION_MISSING' });
  const described = envFor([asset('effect', 1, '爆炸特效', { hasAudio: true, audio: '风声呼啸' })]);
  const miss = await searchAssets({ query: '爆炸', scope: 'effect', matchOn: 'audio' }, described);
  assert.equal(miss.total, 0); assert.equal(miss.retrievalNotice, undefined);
  assert.equal((await searchAssets({ query: '爆炸', scope: 'effect', matchOn: 'visual' }, missing)).retrievalNotice, undefined);
  const keywordsOnly = asset('effect', 7, '绿色光环', { hasAudio: true });
  keywordsOnly.audio.keywords = { 'zh-CN': ['低频爆炸'] }; keywordsOnly.facetTexts.audio = '低频爆炸';
  const keywordEnv = envFor([keywordsOnly]);
  const keywordMatch = await searchAssets({ query: '爆炸', scope: 'effect', matchOn: 'audio' }, keywordEnv);
  assert.equal(keywordMatch.candidates[0].resourceId, 'effect:7'); assert.equal(keywordMatch.candidates[0].audioMatch, true);
  assert.equal(keywordMatch.candidates[0].description, ''); assert.deepEqual(keywordMatch.candidates[0].keywords, ['低频爆炸']);
  assert.equal(keywordMatch.retrievalNotice, undefined);
  assert.equal((await searchAssets({ query: '雷声', scope: 'effect', matchOn: 'audio' }, keywordEnv)).retrievalNotice, undefined);
});

test('explicit duration/audio/loop/include/exclude filters are applied without inferred exclusions', async () => {
  const env = envFor([
    asset('sound', 1, '受击 金属', { duration: 0.5 }),
    asset('sound', 2, '受击 躯体', { duration: 2 }),
    asset('sound', 3, '受击 金属循环', { duration: 0.4, isLoop: true }),
    asset('bgm', 4, '受击音乐'),
  ]);
  const result = await searchAssets({ query: '受击', scope: 'sound', filters: { maxDuration: 1, minDuration: 0.1, hasAudio: true, isLoop: false,
    includeTerms: ['金属'], excludeTerms: ['躯体'] } }, env);
  assert.deepEqual(result.candidates.map(item => item.resourceId), ['sound:1']);
  assert.equal((await searchAssets({ query: '受击', scope: 'bgm' }, env)).candidates[0].kind, 'bgm');
});

test('suggested use search is separately labeled and is not presented as observed audio evidence', async () => {
  const env = envFor([asset('sound', 1, '按钮点击', { uses: '适合科幻电梯提示' })]);
  const result = await searchAssets({ query: '科幻电梯', searchType: 'suggestion' }, env);
  assert.equal(result.candidates[0].matchType, 'suggestion');
  assert.match(result.candidates[0].description, /适合/);
  assert.equal((await searchAssets({ query: '科幻电梯', searchType: 'feature' }, env)).total, 0);
});

test('all kinds have trusted deep links and unknown IDs are never synthesized', async () => {
  const env = envFor([asset('sound', 1, '同名'), asset('effect', 2, '同名'), asset('bgm', 3, '同名')]);
  const result = getAssetDetails(['sound:1', 'effect:2', 'bgm:3', 'sound:999'], 'zh-CN', env);
  assert.deepEqual(result.assets.map(item => item.href), ['/SoundEffectPlayer?id=1', '/EffectPlayer?id=2', '/BgmPlayer?id=3']);
  assert.deepEqual(result.missingIds, ['sound:999']);
  assert.throws(() => getAssetDetails(['sound:1?x=bad'], 'zh-CN', env), { code: 'INVALID_IDS' });
  assert.throws(() => getAssetDetails(Array(11).fill('sound:1'), 'zh-CN', env), { code: 'INVALID_IDS' });
});

test('pagination returns at most 100 candidates, keeps short summaries and binds query/filter/version', async () => {
  const assets = Array.from({ length: 130 }, (_, i) => asset('sound', i + 1, '雷声环境', { description: '低沉雷声'.repeat(100) }));
  const env = envFor(assets), query = { query: '雷声', limit: 30 };
  const seen = new Set(); let cursor = null, pages = 0;
  do {
    const page = await searchAssets({ ...query, cursor }, env);
    assert.equal(page.total, 100); assert.ok(page.candidates.length <= 30);
    for (const item of page.candidates) { assert.ok(!seen.has(item.resourceId)); seen.add(item.resourceId); assert.ok([...item.description].length <= 220); }
    cursor = page.nextCursor; pages++;
  } while (cursor);
  assert.equal(seen.size, 100); assert.equal(pages, 4);
  const first = await searchAssets(query, env);
  await assert.rejects(searchAssets({ ...query, query: '按钮', cursor: first.nextCursor }, env), { code: 'INVALID_CURSOR' });
  await assert.rejects(searchAssets({ ...query, filters: { maxDuration: 2 }, cursor: first.nextCursor }, env), { code: 'INVALID_CURSOR' });
  await assert.rejects(searchAssets({ ...query, matchOn: 'audio', cursor: first.nextCursor }, env), { code: 'INVALID_CURSOR' });
  await assert.rejects(searchAssets({ ...query, cursor: first.nextCursor }, envFor(assets, 'fixture-v2')), { code: 'CATALOG_VERSION_MISMATCH', status: 409 });
});

test('previous IDs are trusted and bounded, with explicit previous-query refinement', async () => {
  const env = envFor([asset('sound', 1, '雷声'), asset('effect', 2, '烟雾')]);
  const result = await searchAssets({ query: '更短一些', previousQuery: '雷声', previousIds: ['sound:1'] }, env);
  assert.equal(result.effectiveScope, 'sound');
  assert.equal(result.candidates[0].resourceId, 'sound:1');
  const stale = await searchAssets({ query: '雷声', previousIds: ['sound:999'] }, env);
  assert.equal(stale.candidates[0].resourceId, 'sound:1');
  await assert.rejects(searchAssets({ query: '雷声', previousIds: ['sound:not-a-real-id'] }, env), { code: 'INVALID_IDS' });
});

test('twenty previous cards can guide a follow-up and all are excluded from its next batch', async () => {
  const env = envFor(Array.from({ length: 40 }, (_, index) => asset('sound', index + 1, `雷声 ${index + 1}`)));
  const first = await searchAssets({ query: '雷声', scope: 'sound', limit: 20 }, env);
  const previousIds = first.candidates.map(item => item.resourceId);
  assert.equal(previousIds.length, 20);
  const next = await searchAssets({ query: '再来点', previousQuery: '雷声', previousIds, excludeIds: previousIds, limit: 20 }, env);
  assert.equal(next.candidates.length, 20);
  assert.ok(next.candidates.every(item => !previousIds.includes(item.resourceId)));
  await assert.rejects(searchAssets({ query: '雷声', previousIds: Array.from({ length: 51 }, (_, index) => `sound:${index + 1}`) }, env), { code: 'INVALID_IDS' });
});

test('real short/low/sharp refinements keep the preceding thunder subject without invented duration filters', async () => {
  const previous = await searchAssets({ query: '低沉的雷声', scope: 'sound', limit: 5 });
  const previousIds = previous.candidates.map(item => item.resourceId);
  assert.equal(previousIds.length, 5);
  for (const query of ['更短一点', '更短一點', '再短一点', '短一点', '更长一点', '更長一點', '更低沉一些', '高一些', '尖锐一些', '尖銳一些']) {
    const result = await searchAssets({ query, previousQuery: '低沉的雷声', previousIds, scope: 'sound', limit: 30 });
    assert.ok(result.candidates.length > 0, query);
    assert.ok(result.candidates.some(item => /雷声/.test(item.title)), query);
    // A shorter preference does not imply an arbitrary hard one-second limit.
    assert.ok(result.candidates.some(item => /雷声/.test(item.title) && item.duration > 1), query);
  }
  const fresh = await searchAssets({ query: '拳击音效', previousQuery: '低沉的雷声', previousIds, scope: 'sound', limit: 5 });
  assert.ok(fresh.candidates.every(item => /拳击/.test(item.title)));
});

test('more requests keep the real explosion topic and exclude the five assets already shown', async () => {
  const first = await searchAssets({ query: '来点爆炸特效', scope: 'all', limit: 5 });
  assert.equal(first.effectiveScope, 'effect');
  assert.equal(first.candidates.length, 5);
  const previousIds = first.candidates.map(item => item.resourceId);
  for (const query of ['再来点', '再來點', '再来几个', '再來幾個', '多来点', '多來點', '换几个', '換幾個', '再找几个', '再找幾個', '更多']) {
    const more = await searchAssets({ query, previousQuery: '来点爆炸特效', previousIds, excludeIds: previousIds, scope: 'all', limit: 5 });
    assert.equal(more.effectiveScope, 'effect', query);
    assert.equal(more.candidates.length, 5, query);
    assert.ok(more.candidates.every(item => !previousIds.includes(item.resourceId)), query);
    assert.ok(more.candidates.every(item => item.kind === 'effect' && /爆炸/.test(item.title)), query);
  }
  const newTopic = await searchAssets({ query: '拳击音效', previousQuery: '来点爆炸特效', previousIds, excludeIds: previousIds, scope: 'all', limit: 5 });
  assert.equal(newTopic.effectiveScope, 'sound');
  assert.ok(newTopic.candidates.every(item => item.kind === 'sound' && /拳击/.test(item.title)));
});

test('excluded IDs are bounded, tolerate removed assets, and are bound to pagination cursors', async () => {
  const env = envFor(Array.from({ length: 40 }, (_, index) => asset('effect', index + 1, '爆炸')));
  const input = { query: '爆炸特效', limit: 5, excludeIds: ['effect:1', 'effect:999'] };
  const first = await searchAssets(input, env);
  assert.equal(first.total, 39);
  assert.ok(first.candidates.every(item => item.resourceId !== 'effect:1'));
  assert.ok(first.nextCursor);
  const next = await searchAssets({ ...input, cursor: first.nextCursor }, env);
  assert.ok(next.candidates.every(item => !first.candidates.some(previous => previous.resourceId === item.resourceId)));
  await assert.rejects(searchAssets({ ...input, excludeIds: ['effect:2', 'effect:999'], cursor: first.nextCursor }, env), { code: 'INVALID_CURSOR' });
  await assert.rejects(searchAssets({ ...input, excludeIds: ['effect:1'], cursor: first.nextCursor }, env), { code: 'INVALID_CURSOR' });
  assert.deepEqual(validateSearchInput({ query: '爆炸', excludeIds: ['effect:2', 'effect:1', 'effect:2'] }).excludeIds, ['effect:1', 'effect:2']);
  for (const excludeIds of ['effect:1', Array(51).fill('effect:1'), ['effect:bad'], ['effect:1?injected']]) {
    assert.throws(() => validateSearchInput({ query: '爆炸', excludeIds }), { code: 'INVALID_IDS' });
  }
});

test('Vectorize merges only current-version trusted metadata and requests bounded metadata', async () => {
  const env = envFor([asset('sound', 1, '按钮'), asset('effect', 2, '烟雾', { hasAudio: true, audio: '呼啸' })]);
  let calls = 0;
  Object.assign(env, { EMBEDDING_MODEL: 'test-embedding', EMBEDDING_DIMENSIONS: '2',
    ASSET_EMBEDDING: { embedQuery: async () => [0.1, 0.2] },
    ASSET_VECTORIZE: { query: async (vector, options) => {
      calls++; assert.deepEqual(vector, [0.1, 0.2]); assert.equal(options.namespace, 'fixture-v1'); assert.equal(options.topK, 50);
      assert.equal(options.returnMetadata, 'all'); assert.equal(options.filter.model, 'test-embedding');
      const metadata = (resourceId, facet, extra = {}) => ({ resourceId, facet, kind: resourceId.split(':')[0], indexVersion: 'fixture-v1', model: 'test-embedding', dimensions: 2, ...extra });
      return { matches: [
        { id: 'opaque-hash-1', score: 0.9, metadata: metadata('effect:2', 'audio') },
        { id: 'opaque-hash-2', score: 1, metadata: metadata('sound:999', 'feature') },
        { id: 'opaque-hash-3', score: 1, metadata: metadata('sound:1', 'feature', { indexVersion: 'stale' }) },
        { id: 'opaque-hash-4', score: 1, metadata: metadata('sound:1', 'feature', { model: 'different' }) },
      ] };
    } } });
  const result = await searchAssets({ query: '不存在的语义', scope: 'sound' }, env);
  assert.equal(result.mode, 'hybrid'); assert.deepEqual(result.candidates.map(item => item.resourceId), ['effect:2']);
  assert.equal(result.candidates[0].description, '呼啸');
  await searchAssets({ query: '不存在的语义', scope: 'sound' }, env); assert.equal(calls, 2);
  const excluded = await searchAssets({ query: '不存在的语义', scope: 'sound', excludeIds: ['effect:2'] }, env);
  assert.equal(excluded.total, 0, 'Vector matches must also respect excluded resource IDs');
});

test('keyword and hybrid retrieval enforce the same visual/audio facets even if Vectorize returns disallowed metadata', async () => {
  const assets = [asset('sound', 1, '爆炸声'), asset('effect', 2, '爆炸光团', { hasAudio: true, audio: '风声呼啸' }),
    asset('effect', 3, '蓝色光环', { hasAudio: true, audio: '爆炸声' }), asset('effect', 4, '爆炸光团', { hasAudio: false, audio: '爆炸声' })];
  const keywordEnv = envFor(assets), hybridEnv = envFor(assets); const filters = [];
  Object.assign(hybridEnv, { ASSET_EMBEDDING: { embedQuery: async () => [0.1] }, ASSET_VECTORIZE: { query: async (_vector, options) => {
    filters.push(options.filter);
    return { matches: [{ score: 0.9, metadata: { indexVersion: 'fixture-v1', resourceId: 'effect:3', kind: 'effect', facet: 'audio' } },
      { score: 1, metadata: { indexVersion: 'fixture-v1', resourceId: 'effect:2', kind: 'effect', facet: 'feature' } },
      { score: 1, metadata: { indexVersion: 'fixture-v1', resourceId: 'effect:4', kind: 'effect', facet: 'audio' } },
      { score: 1, metadata: { indexVersion: 'fixture-v1', resourceId: 'sound:1', kind: 'sound', facet: 'feature' } }] };
  } } });
  const input = { query: '爆炸', scope: 'effect', matchOn: 'audio', includeEffectAudio: false, searchType: 'feature' };
  for (const env of [keywordEnv, hybridEnv]) {
    const result = await searchAssets(input, env);
    assert.deepEqual(result.candidates.map(item => item.resourceId), ['effect:3']); assert.equal(result.candidates[0].audioMatch, true);
  }
  assert.deepEqual(filters, [{ kind: 'effect', facet: 'audio', hasAudio: true }]);
  const visual = await searchAssets({ ...input, matchOn: 'visual' }, hybridEnv);
  assert.ok(visual.candidates.every(item => item.kind === 'effect' && !item.audioMatch));
  assert.deepEqual(filters.at(-1), { kind: 'effect', facet: 'feature' });
});

test('missing/failed vector providers fall back honestly and keyword mode makes no embedding call', async () => {
  const env = envFor([asset('sound', 1, '雷声')]);
  const missing = await searchAssets({ query: '雷声' }, { ...env, ASSET_VECTORIZE: {} });
  assert.equal(missing.mode, 'keyword'); assert.equal(missing.retrievalWarning, 'VECTOR_PROVIDER_INCOMPLETE');
  const failing = await searchAssets({ query: '雷声' }, { ...env, ASSET_VECTORIZE: { query: async () => { throw Error('failed'); } }, ASSET_EMBEDDING: { embedQuery: async () => [1] } });
  assert.equal(failing.mode, 'keyword'); assert.equal(failing.retrievalWarning, 'VECTOR_RETRIEVAL_UNAVAILABLE');
  let called = false;
  const keyword = await searchAssets({ query: '雷声' }, { ...env, RETRIEVAL_MODE: 'keyword', ASSET_VECTORIZE: {}, ASSET_EMBEDDING: { embedQuery: async () => { called = true; return [1]; } } });
  assert.equal(keyword.mode, 'keyword'); assert.equal(called, false);
});

test('invalid inputs reject instead of widening scope, dropping filters, or accepting injected fields', async () => {
  for (const input of [null, {}, { query: '' }, { query: 'x'.repeat(2001) }, { query: '雷', limit: 51 }, { query: '雷', scope: 'unknown' },
    { query: '雷', locale: '__proto__' }, { query: '雷', filters: { minDuration: 2, maxDuration: 1 } },
    { query: '雷', filters: { hasAudio: 'yes' } }, { query: '雷', filters: { excludeTerms: [''] } },
    { query: '雷', tools: [] }, { query: '雷', previousIds: Array(51).fill('sound:1') },
    { query: '雷', filters: { unknown: true } }, { query: '雷', matchOn: 'unknown' }, { query: '雷', matchOn: null }]) assert.throws(() => validateSearchInput(input));
  await assert.rejects(searchAssets({ query: '雷', cursor: 'not-a-cursor' }), { code: 'INVALID_CURSOR' });
  for (const value of [null, [], 1, {}, { v: 'old' }, { v: 1, h: 'a'.repeat(64), o: 1 },
    { v: 'old', h: 'invalid', o: 1 }, { v: 'old', h: 'a'.repeat(64), o: -1 }]) {
    const cursor = Buffer.from(JSON.stringify(value)).toString('base64url');
    await assert.rejects(searchAssets({ query: '雷', cursor }), { code: 'INVALID_CURSOR', status: 400 });
  }
});

function snapshots() {
  return SOURCES.map(source => {
    const row = { id: '1', nameI18nKey: `${source.namespace}.data.1`, duration: 1,
      ...(source.kind === 'effect' ? { hasAudio: true, audioPath: '1.m4a' } : {}),
      ...(source.kind === 'sound' ? { shortDescriptionI18nKey: `${source.namespace}.desc.1` } : {}) };
    return { ...source, data: source.kind === 'effect' ? { effectData: { 1: row } } : source.kind === 'bgm' ? { musicData: [row] } : { data: [row] },
      dictionaries: Object.fromEntries(LOCALES.map(locale => [locale, { [`${source.namespace}.data.1`]: `${locale} source name`,
        ...(source.kind === 'sound' && locale === 'zh-CN' ? { [`${source.namespace}.desc.1`]: '源站描述优先' } : {}) }])) };
  });
}
test('builder preserves source truth, merges external descriptions by ID and does not invent translations/audio', () => {
  const external = [{ id: 1, name: '不得覆盖名称', short_description: '外部短描述', detailed_description: '中文详细听感' },
    { id: 999, short_description: '不得新增资产' }];
  const built = buildCatalog(snapshots(), external);
  assert.equal(built.assets.length, 3);
  const sound = built.assets.find(item => item.kind === 'sound');
  assert.equal(sound.description['zh-CN'], '源站描述优先');
  assert.equal(sound.detailedDescription['zh-CN'], '中文详细听感');
  assert.equal(sound.description['en-US'], undefined);
  assert.equal(sound.titles['zh-CN'], 'zh-CN source name');
  assert.equal(built.assets.find(item => item.kind === 'effect').facetTexts.audio, '');
  assert.equal(buildCatalog(snapshots(), external).indexVersion, built.indexVersion);
});

test('builder CLI accepts offline fixtures and produces a complete reproducible cache', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ugc-asset-catalog-'));
  try {
    for (const snapshot of snapshots()) {
      const project = path.join(directory, snapshot.project); await mkdir(path.join(project, 'i18n'), { recursive: true });
      await writeFile(path.join(project, 'data.json'), JSON.stringify(snapshot.data));
      for (const locale of LOCALES) await writeFile(path.join(project, 'i18n', `${locale.toLowerCase()}.json`), JSON.stringify(snapshot.dictionaries[locale]));
    }
    const identities = buildIdentityCatalog(snapshots());
    const { compileSidecar } = require('../../scripts/export-ai-asset-features.cjs');
    for (const { project, kind } of SOURCES.filter(source => source.kind !== 'bgm')) {
      const sidecar = { schemaVersion: 1, project, kind, baseIndexVersion: identities.indexVersion, resources: {},
        i18n: Object.fromEntries(LOCALES.map(locale => [locale.toLowerCase(), {}])) };
      await compileSidecar(sidecar, identities);
      await writeFile(path.join(directory, project, 'features.json'), JSON.stringify(sidecar));
    }
    const output = path.join(directory, 'catalog.json');
    const script = new URL('../../scripts/build-ai-asset-catalog.cjs', import.meta.url);
    const result = spawnSync(process.execPath, [script.pathname.replace(/^\/(\w:)/, '$1'), '--base', directory, '--output', output, '--identities-output', path.join(directory, 'identities.json')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const built = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(built.coverage.total, 3); assert.equal(built.sourceBase, 'ugc-tool-data');
    assert.match(built.indexVersion, /^[a-f0-9]{64}$/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('fifty-item batches cover the hundred-item pool with stable cursors and exclude all fifty prior cards', async () => {
  const env = envFor(Array.from({ length: 130 }, (_, index) => asset('sound', index + 1, `雷声 ${index + 1}`)));
  const input = { query: '雷声', scope: 'sound', limit: 50 };
  const first = await searchAssets(input, env);
  assert.equal(first.candidates.length, 50); assert.equal(first.total, 100); assert.ok(first.nextCursor);
  const second = await searchAssets({ ...input, cursor: first.nextCursor }, env);
  assert.equal(second.candidates.length, 50); assert.equal(second.nextCursor, null);
  const previousIds = first.candidates.map(item => item.resourceId);
  assert.equal(second.candidates.some(item => previousIds.includes(item.resourceId)), false);
  const more = await searchAssets({ query: '再来点', previousQuery: '雷声', previousIds, excludeIds: previousIds, scope: 'sound', limit: 50 }, env);
  assert.equal(more.candidates.length, 50);
  assert.equal(more.candidates.some(item => previousIds.includes(item.resourceId)), false);
  assert.equal(validateSearchInput({ query: '雷声' }).limit, 10);
  for (const limit of [0, 1.5, 51, '50']) assert.throws(() => validateSearchInput({ ...input, limit }), { code: 'INVALID_LIMIT' });
});
