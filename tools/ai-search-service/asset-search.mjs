import defaultCatalog from './generated/asset-identities.json' with { type: 'json' };

const LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ru-RU'];
const SHORT_LOCALES = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP', ru: 'ru-RU' };
const LOWER_LOCALES = Object.fromEntries(LOCALES.map(locale => [locale.toLowerCase(), locale]));
const SCOPES = ['all', 'sound', 'effect', 'bgm'];
const ID = /^(sound|effect|bgm):\d{1,12}$/;
const encoder = new TextEncoder();
const catalogs = new WeakMap();
const aliases = [
  [/受到攻[击擊]|受擊|挨打|被打|被[击擊]中|被攻[击擊]|被弾|\bhurt\b|\bhit reaction\b/giu, '受击'],
  [/雷聲|雷鳴|\bthunder\b|гром\p{L}*/giu, '雷声'],
  [/風聲|\bwind\b|風音|ветер|ветра/giu, '风声'],
  [/發動機|引擎|\bengine\b|エンジン|двигател\p{L}*/giu, '发动机'],
  [/藍色|\bblue\b|青色|син\p{L}*/giu, '蓝色'],
  [/煙霧|烟尘|煙塵|\bsmoke\b|\bsmoky\b|дым\p{L}*|煙/giu, '烟雾'],
  [/按鈕|\bbutton\b|ボタン|кноп\p{L}*/giu, '按钮'],
  [/火焰|\bfire\b|\bflame\b|плам\p{L}*|炎/giu, '火焰'],
  [/拳擊|拳头|拳頭|挥拳|揮拳|\bpunch(?:ing)?\b|パンチ|удар\p{L}*\s+кулак\p{L}*/giu, '拳击'],
  [/躯體|軀體|身体|身體|肉体|肉體|\bbody\b/giu, '躯体'],
  [/打擊|打到|打中|打撃|\bimpact\b|\bstrike\b|\bhit\b/giu, '打击'],
  [/金屬|\bmetal(?:lic)?\b|金属|металл\p{L}*/giu, '金属'],
  [/低頻|低沉|\blow(?: frequency)?\b|低音|низк\p{L}*/giu, '低频'],
  [/短促|\bshort\b|短い|корот\p{L}*/giu, '短促'],
];
const noise = /(?:我想要|帮我|幫我|找一下|找一些|寻找|尋找|找一个|找一個|找个|找個|有没有|有沒有|搜索|检索|檢索|音效|特效|资源|資源|声音|聲音|一[个個些]|please|\bfind\b|\b(?:sounds?|effects?|assets?)\b|的)/giu;
export class AssetSearchError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'AssetSearchError'; this.code = code; this.status = status; }
}
const fail = (code, message, status) => { throw new AssetSearchError(code, message, status); };
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (obj, key) => Object.hasOwn(obj, key);
const clip = (text, max) => [...String(text || '')].slice(0, max).join('');
const unique = list => [...new Set(list)];
export function normalizeAssetText(value) {
  let result = value.normalize('NFKC').toLowerCase().replace(/[_\-]/g, ' ');
  for (const [pattern, canonical] of aliases) { pattern.lastIndex = 0; result = result.replace(pattern, canonical); }
  return result;
}
function tokenize(value, query = false) {
  // Remove type labels before overlapping words such as 雷声音效 can match generic 声音.
  const text = normalizeAssetText(value).replace(query ? /音效|特效|効果音|звуки|звуков\p{L}*\s+эффект\p{L}*/giu : /$^/u, ' ').replace(query ? noise : /$^/u, ' ');
  const words = text.match(/[\p{L}\p{N}]+/gu) || [];
  const result = [];
  for (const word of words) {
    if (/[\u3400-\u9fff\u3040-\u30ff]/u.test(word)) {
      const chars = [...word];
      if (chars.length <= 12) result.push(word);
      for (const n of [2, 3]) for (let i = 0; i <= chars.length - n; i++) result.push(chars.slice(i, i + n).join(''));
      if (chars.length === 1) result.push(word);
    } else result.push(word);
  }
  return query ? unique(result).slice(0, 100) : result;
}
function localeOf(value) {
  const locale = value ?? 'zh-CN';
  if (LOCALES.includes(locale)) return locale;
  if (own(LOWER_LOCALES, locale)) return LOWER_LOCALES[locale];
  if (own(SHORT_LOCALES, locale)) return SHORT_LOCALES[locale];
  fail('INVALID_LOCALE', 'Unsupported locale');
}
function listOfTerms(value, key) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 12 || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 80)) fail('INVALID_FILTER', `Invalid ${key}`);
  return unique(value.map(item => item.trim()));
}
export function validateSearchInput(raw) {
  if (!isObject(raw)) fail('INVALID_SEARCH', 'Search must be an object');
  const allowed = ['query', 'locale', 'scope', 'matchOn', 'includeEffectAudio', 'limit', 'cursor', 'filters', 'searchType', 'previousIds', 'previousQuery', 'excludeIds'];
  if (Object.keys(raw).some(key => !allowed.includes(key))) fail('INVALID_SEARCH', 'Unknown search field');
  if (typeof raw.query !== 'string' || raw.query.length > 2000 || !raw.query.trim()) fail('INVALID_QUERY', 'Query must contain 1–2000 characters');
  const scope = raw.scope ?? 'all';
  if (!SCOPES.includes(scope)) fail('INVALID_SCOPE', 'Unsupported scope');
  const matchOn = raw.matchOn === undefined ? 'any' : raw.matchOn;
  if (!['any', 'visual', 'audio'].includes(matchOn)) fail('INVALID_MATCH_ON', 'Match on any, visual or audio evidence');
  const searchType = raw.searchType ?? 'both';
  if (!['feature', 'suggestion', 'both'].includes(searchType)) fail('INVALID_SEARCH_TYPE', 'Unsupported search type');
  const limit = raw.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('INVALID_LIMIT', 'Limit must be 1–50');
  if (raw.includeEffectAudio != null && typeof raw.includeEffectAudio !== 'boolean') fail('INVALID_SEARCH', 'includeEffectAudio must be boolean');
  if (raw.cursor != null && (typeof raw.cursor !== 'string' || raw.cursor.length > 500)) fail('INVALID_CURSOR', 'Invalid cursor');
  if (raw.previousQuery != null && (typeof raw.previousQuery !== 'string' || raw.previousQuery.length > 2000)) fail('INVALID_QUERY', 'Invalid previous query');
  const previousIds = raw.previousIds ?? [];
  if (!Array.isArray(previousIds) || previousIds.length > 50 || previousIds.some(id => typeof id !== 'string' || !ID.test(id))) fail('INVALID_IDS', 'Invalid previous resource IDs');
  const excludeIds = raw.excludeIds ?? [];
  if (!Array.isArray(excludeIds) || excludeIds.length > 50 || excludeIds.some(id => typeof id !== 'string' || !ID.test(id))) fail('INVALID_IDS', 'Exclude at most 50 valid resource IDs');
  const inputFilters = raw.filters ?? {};
  if (!isObject(inputFilters) || Object.keys(inputFilters).some(key => !['minDuration', 'maxDuration', 'hasAudio', 'isLoop', 'includeTerms', 'excludeTerms'].includes(key))) fail('INVALID_FILTER', 'Unknown filter');
  const filters = { includeTerms: listOfTerms(inputFilters.includeTerms, 'includeTerms'), excludeTerms: listOfTerms(inputFilters.excludeTerms, 'excludeTerms') };
  for (const key of ['minDuration', 'maxDuration']) if (inputFilters[key] != null) {
    if (typeof inputFilters[key] !== 'number' || !Number.isFinite(inputFilters[key]) || inputFilters[key] < 0 || inputFilters[key] > 86400) fail('INVALID_FILTER', `Invalid ${key}`);
    filters[key] = inputFilters[key];
  }
  if (filters.minDuration != null && filters.maxDuration != null && filters.minDuration > filters.maxDuration) fail('INVALID_FILTER', 'Duration interval is reversed');
  for (const key of ['hasAudio', 'isLoop']) if (inputFilters[key] != null) {
    if (typeof inputFilters[key] !== 'boolean') fail('INVALID_FILTER', `Invalid ${key}`);
    filters[key] = inputFilters[key];
  }
  return { query: raw.query.trim(), locale: localeOf(raw.locale), scope, matchOn, includeEffectAudio: raw.includeEffectAudio !== false,
    limit, cursor: raw.cursor || null, filters, searchType, previousIds: unique(previousIds), previousQuery: raw.previousQuery?.trim() || '', excludeIds: unique(excludeIds).sort() };
}
function baseStateFor(env = {}) {
  const catalog = env.ASSET_SEARCH_CATALOG || defaultCatalog;
  if (!isObject(catalog) || !Array.isArray(catalog.assets) || typeof catalog.indexVersion !== 'string') fail('CATALOG_UNAVAILABLE', 'Asset catalog is unavailable', 503);
  if (catalogs.has(catalog)) return catalogs.get(catalog);
  const byId = new Map();
  for (const asset of catalog.assets) {
    if (!isObject(asset) || typeof asset.resourceId !== 'string' || !ID.test(asset.resourceId) || !['sound', 'effect', 'bgm'].includes(asset.kind) || asset.resourceId.split(':')[0] !== asset.kind || String(asset.id) !== asset.resourceId.split(':')[1] || byId.has(asset.resourceId)) fail('CATALOG_INVALID', 'Invalid catalog resource identity', 503);
    byId.set(asset.resourceId, asset);
  }
  const state = { catalog, byId, resultsCache: new Map() }; catalogs.set(catalog, state); return state;
}
export function compileLexicalIndex(catalog) {
  const docs = [], postings = new Map();
  let totalLength = 0;
  const addDocument = (asset, facet, text, titleText = '') => {
    if (!text.trim()) return;
    const tokens = tokenize(text), frequencies = new Map();
    for (const token of tokens) frequencies.set(token, Math.min(3, (frequencies.get(token) || 0) + 1));
    for (const token of tokenize(titleText)) frequencies.set(token, Math.min(6, (frequencies.get(token) || 0) + 2));
    const doc = [asset.resourceId, facet, Math.max(tokens.length, 1)];
    const index = docs.length; docs.push(doc); totalLength += doc[2];
    for (const [term, count] of frequencies) {
      let posting = postings.get(term); if (!posting) postings.set(term, posting = []); posting.push(index * 8 + count);
    }
  };
  for (const asset of catalog.assets) {
    const title = Object.values(asset.titles || {}).join(' ');
    const facets = asset.facetTexts || {};
    addDocument(asset, 'feature', facets.feature || title, title);
    addDocument(asset, 'suggestion', facets.suggestion || '');
    if (asset.kind === 'effect' && asset.hasAudio === true) {
      addDocument(asset, 'audio', facets.audio || ''); addDocument(asset, 'audioSuggestion', facets.audioSuggestion || '');
    }
  }
  const packedPostings = {};
  for (const [term, posting] of postings) {
    const bytes = new Uint8Array(Uint32Array.from(posting).buffer);
    let binary = ''; for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
    Object.defineProperty(packedPostings, term, { value: btoa(binary), enumerable: true, configurable: true, writable: true });
  }
  return { format: 'uint32-base64-v1', docs, postings: packedPostings, averageLength: totalLength / Math.max(docs.length, 1) };
}
function stateFor(env = {}) {
  const state = baseStateFor(env); if (state.docs) return state;
  const lexical = state.catalog.lexical || compileLexicalIndex(state.catalog);
  const shards = lexical.format === 'sharded-uint32-base64-v1' ? lexical.shards : [{ lexical }];
  if (!Array.isArray(shards) || !shards.length) fail('CATALOG_INVALID', 'Unsupported lexical index', 503);
  state.docs = []; state.shards = []; state.normalizedDocs = new Map();
  let totalLength = 0, activeDocCount = 0;
  for (const shard of shards) {
    const index = shard.lexical;
    if (index?.format !== 'uint32-base64-v1' || !Array.isArray(index.docs) || !isObject(index.postings)) fail('CATALOG_INVALID', 'Unsupported lexical index', 503);
    const offset = state.docs.length;
    for (const [id, facet, length] of index.docs) {
      const asset = state.byId.get(id);
      if (!asset || !['feature', 'suggestion', 'audio', 'audioSuggestion'].includes(facet) || !Number.isInteger(length) || length < 1) fail('CATALOG_INVALID', 'Invalid lexical document', 503);
      const disabled = shard.excludeKinds?.includes(asset.kind) === true;
      state.docs.push({ asset, facet, length, disabled, normalized: null, normalizedCache: state.normalizedDocs });
      if (!disabled) { totalLength += length; activeDocCount += 1; }
    }
    state.shards.push({ postings: index.postings, offset });
  }
  state.decodedPostings = new Map(); state.averageLength = totalLength / Math.max(activeDocCount, 1); state.activeDocCount = activeDocCount;
  return state;
}
function postingFor(state, term) {
  if (state.decodedPostings.has(term)) return state.decodedPostings.get(term);
  const values = [];
  for (const shard of state.shards) {
    if (!own(shard.postings, term)) continue;
    const binary = atob(shard.postings[term]);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const posting = new Uint32Array(bytes.buffer);
    for (const packed of posting) {
      const index = (packed >>> 3) + shard.offset;
      if (!state.docs[index]) fail('CATALOG_INVALID', 'Invalid lexical posting', 503);
      if (!state.docs[index].disabled) values.push(index * 8 + (packed & 7));
    }
  }
  if (!values.length) return null;
  const posting = Uint32Array.from(values);
  if (state.decodedPostings.size >= 256) state.decodedPostings.delete(state.decodedPostings.keys().next().value);
  state.decodedPostings.set(term, posting); return posting;
}
function facetTextFor(asset, facet) {
  if (!asset.featureFacetsLazy) return asset.facetTexts?.[facet] || '';
  const all = map => Object.values(map || {}).flat();
  const join = values => values.filter(Boolean).join('\n');
  if (facet === 'suggestion') return join(all(asset.suggestedUses));
  if (facet === 'audioSuggestion') return join(all(asset.audio?.suggestedUses));
  const evidence = facet === 'audio' ? asset.audio || {} : asset;
  return join([...(facet === 'feature' ? [asset.identityFeatureText, asset.facetTexts?.feature, ...all(asset.titles)] : []),
    ...all(evidence.description), ...all(evidence.detailedDescription), ...all(evidence.keywords)]);
}
export function getCatalogInfo(env = {}) {
  const { catalog, byId } = baseStateFor(env);
  return { indexVersion: catalog.indexVersion, count: byId.size, coverage: catalog.coverage,
    counts: { ...(catalog.coverage?.byKind || {}), total: byId.size },
    mode: env.RETRIEVAL_MODE !== 'keyword' && env.ASSET_VECTORIZE && env.ASSET_EMBEDDING?.embedQuery ? 'hybrid' : 'keyword', locales: LOCALES,
    sourceBase: catalog.sourceBase, descriptionFallbackLocale: 'zh-CN' };
}
function localValue(map, locale, fallback = '') {
  if (map?.[locale]) return { value: map[locale], locale };
  if (map?.['zh-CN']) return { value: map['zh-CN'], locale: 'zh-CN' };
  const first = Object.entries(map || {}).find(([, value]) => !!value);
  return first ? { value: first[1], locale: first[0] } : { value: fallback, locale: null };
}
function hrefFor(asset) { return `/${{ sound: 'SoundEffectPlayer', effect: 'EffectPlayer', bgm: 'BgmPlayer' }[asset.kind]}?id=${asset.id}`; }
function detailFor(asset, locale) {
  const name = localValue(asset.titles, locale, `${asset.kind} ${asset.id}`);
  const desc = localValue(asset.description, locale);
  const full = localValue(asset.detailedDescription, locale);
  const audioDesc = localValue(asset.audio?.description, locale);
  const audioFull = localValue(asset.audio?.detailedDescription, locale);
  return { resourceId: asset.resourceId, id: asset.id, kind: asset.kind, title: name.value, titleLocale: name.locale, href: hrefFor(asset),
    description: clip([desc.value, full.value].filter(Boolean).join('\n'), 1900), shortDescription: clip(desc.value || full.value, 220),
    fullDescription: clip(full.value, 1500), descriptionLocale: desc.locale || full.locale,
    keywords: localValue(asset.keywords, locale, []).value.slice(0, 16), suggestedUses: localValue(asset.suggestedUses, locale, []).value.slice(0, 3),
    audioDescription: clip([audioDesc.value, audioFull.value].filter(Boolean).join('\n'), 1900), audioShortDescription: clip(audioDesc.value || audioFull.value, 220),
    audioDescriptionLocale: audioDesc.locale || audioFull.locale, audioKeywords: localValue(asset.audio?.keywords, locale, []).value.slice(0, 16),
    audioSuggestedUses: localValue(asset.audio?.suggestedUses, locale, []).value.slice(0, 3), hasAudio: asset.hasAudio === true,
    ...(asset.duration != null ? { duration: asset.duration } : {}), ...(asset.isLoop != null ? { isLoop: asset.isLoop } : {}),
    ...(asset.category ? { category: asset.category } : {}), ...(asset.giVersion ? { giVersion: asset.giVersion } : {}) };
}
export function getAssetDetails(idsOrInput, locale = 'zh-CN', env = {}) {
  let ids = idsOrInput;
  if (isObject(idsOrInput)) { ids = idsOrInput.ids; locale = idsOrInput.locale ?? locale; }
  const selectedLocale = localeOf(locale), state = baseStateFor(env);
  if (!Array.isArray(ids) || ids.length > 10 || ids.some(id => typeof id !== 'string' || !ID.test(id))) fail('INVALID_IDS', 'Details require at most 10 resource IDs');
  const assets = [], missingIds = [];
  for (const id of unique(ids)) { const asset = state.byId.get(id); if (asset) assets.push(detailFor(asset, selectedLocale)); else missingIds.push(id); }
  const result = { indexVersion: state.catalog.indexVersion, assets, missingIds };
  // Avoid silently deleting requested evidence when the details response is too large.
  if (encoder.encode(JSON.stringify(result)).length > 30_000) fail('DETAILS_TOO_LARGE', 'Request fewer asset details', 413);
  return result;
}
function effectiveScope(input, state) {
  if (input.scope !== 'all') return input.scope;
  const q = normalizeAssetText(queryFor(input));
  const bgm = /音乐|音樂|配乐|配樂|\bbgm\b|\bmusic\b|音楽|музык/u.test(q);
  const sound = /音效|音频|音頻|背景音(?![乐樂])|声音|聲音|\bsounds?\b|\bsfx\b|\baudio\b|効果音|зву[кч]/u.test(q);
  const visual = /特效|视觉|視覺|\bvisual\b|\bvfx\b|\bparticle|エフェクト/u.test(q);
  if (sound && visual && !bgm) {
    // An effect's soundtrack and an effect with a sound both return effect assets. Parallel types stay broad.
    if (/特效(?:的|(?:里|裡|中|内|內)(?:面)?的?)[^，。！？、;]*?(?:音效|声音|聲音)|(?:音效|声音|聲音)的特效/u.test(q)) return 'effect';
    return 'all';
  }
  if (sound && !visual && !bgm) return 'sound';
  if (bgm && !sound && !visual) return 'bgm';
  if (visual && !sound && !bgm) return 'effect';
  if (/更|再|这|這|那|第|shorter|longer|another|previous|もっと|короче/u.test(q) && input.previousIds.length) {
    const kinds = unique(input.previousIds.map(id => state.byId.get(id)?.kind).filter(Boolean));
    if (kinds.length === 1) return kinds[0];
  }
  return 'all';
}
function allowedDoc(doc, input, scope) {
  const { asset, facet } = doc;
  if (doc.disabled) return false;
  if (input.excludeIds.includes(asset.resourceId)) return false;
  const audioMatch = facet === 'audio' || facet === 'audioSuggestion';
  const suggestion = facet === 'suggestion' || facet === 'audioSuggestion';
  if (input.matchOn === 'visual' && (asset.kind !== 'effect' || audioMatch)) return false;
  if (input.matchOn === 'audio' && asset.kind === 'effect' && (asset.hasAudio !== true || !audioMatch)) return false;
  if (scope === 'sound' && asset.kind !== 'sound' && !(input.includeEffectAudio && asset.kind === 'effect' && asset.hasAudio === true && audioMatch)) return false;
  if (scope === 'effect' && asset.kind !== 'effect' || scope === 'bgm' && asset.kind !== 'bgm') return false;
  if (input.searchType === 'feature' && suggestion || input.searchType === 'suggestion' && !suggestion) return false;
  const f = input.filters;
  if (f.hasAudio != null && (asset.hasAudio === true) !== f.hasAudio || f.isLoop != null && asset.isLoop !== f.isLoop) return false;
  if (f.minDuration != null && (asset.duration == null || asset.duration < f.minDuration) || f.maxDuration != null && (asset.duration == null || asset.duration > f.maxDuration)) return false;
  if (f.includeTerms.length || f.excludeTerms.length) {
    if (doc.normalized == null) {
      if (doc.normalizedCache.size >= 256) {
        const oldest = doc.normalizedCache.keys().next().value;
        oldest.normalized = null; doc.normalizedCache.delete(oldest);
      }
      doc.normalized = normalizeAssetText(facetTextFor(asset, facet)); doc.normalizedCache.set(doc, true);
    }
    if (f.includeTerms.some(term => !doc.normalized.includes(normalizeAssetText(term))) || f.excludeTerms.some(term => doc.normalized.includes(normalizeAssetText(term)))) return false;
  }
  return true;
}
function queryFor(input) {
  const q = input.query;
  // "More" keeps the search subject, while excludeIds asks for unseen assets.
  const more = /^(?:再[来來](?:[点點些]|一[点點些]|[几幾][个個]|一批)|多[来來](?:[点點些]|一[点點些]|[几幾][个個])|[换換](?:[几幾][个個]|一批|一些)|再找(?:[几幾][个個]|一些|一批)|更多(?:一些|一[点點])?|more|another|some more|a few more|show me more|もっと)[\s。.!！?？]*$/iu.test(q);
  if (more && input.previousQuery) return input.previousQuery;
  // Carry forward the subject only for a refinement; a new explicit subject stays independent.
  const refinement = /^(?:(?:有没有|有沒有|能不能|能否|可以)?(?:这个|這個|那个|那個|它|声音|聲音|音效|第[一二三四五12345][个個])?(?:更|再)?(?:短|长|長|低沉|高|低|尖锐|尖銳|明亮|亮|响|響|柔和|清脆|沉闷|沉悶|厚重|轻|輕|快|慢|强|強|弱|安静|安靜)(?:一些|一点点|一點點|一点|一點|点|點|些)?(?:的)?(?:吗|嗎)?|再来(?:一些|一点|一點)?|换(?:一批|一些)|換(?:一批|一些)|shorter|longer|more|another|もっと|короче)[\s。.!！?？]*$/iu.test(q);
  return refinement && input.previousQuery ? `${input.previousQuery} ${q}` : q;
}
function rankKeyword(state, input, scope) {
  const query = queryFor(input), terms = tokenize(query, true), scores = new Map();
  for (const term of terms) {
    const posting = postingFor(state, term); if (!posting) continue;
    const idf = Math.log(1 + (state.activeDocCount - posting.length + 0.5) / (posting.length + 0.5));
    for (const packed of posting) {
      const index = packed >> 3, tf = packed & 7;
      const doc = state.docs[index]; if (!allowedDoc(doc, input, scope)) continue;
      const normalization = tf + 1.2 * (0.25 + 0.75 * doc.length / state.averageLength);
      scores.set(index, (scores.get(index) || 0) + idf * tf * 2.2 / normalization);
    }
  }
  // Exact trusted IDs are searchable, without inventing auditory evidence for visual assets.
  const exactId = query.trim().match(/^(?:(sound|effect|bgm):)?(\d{1,12})$/);
  if (exactId) state.docs.forEach((doc, index) => {
    if (doc.asset.id === exactId[2] && (!exactId[1] || doc.asset.kind === exactId[1]) && allowedDoc(doc, input, scope)) scores.set(index, 1000);
  });
  const ranked = [...scores].map(([index, score]) => ({ doc: state.docs[index], score }));
  ranked.sort((a, b) => b.score - a.score || a.doc.asset.resourceId.localeCompare(b.doc.asset.resourceId));
  return ranked;
}
function deduplicate(ranked) {
  const seen = new Set(); return ranked.filter(item => { const id = item.doc.asset.resourceId; if (seen.has(id)) return false; seen.add(id); return true; });
}
function diversify(ranked) {
  const pool = deduplicate(ranked).slice(0, 600).map(item => ({ ...item, group: senseGroup(item.doc.asset) })), selected = [], categoryCounts = new Map();
  if (new Set(pool.map(item => item.group)).size <= 1) return pool.slice(0, 100);
  // Equivalent senses/categories should remain visible rather than sorting all creature IDs first.
  while (pool.length && selected.length < 100) {
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const group = pool[i].group;
      const adjusted = pool[i].score / (1 + (categoryCounts.get(group) || 0) * 0.12);
      if (adjusted > bestScore) { best = i; bestScore = adjusted; }
    }
    const [item] = pool.splice(best, 1), group = item.group;
    categoryCounts.set(group, (categoryCounts.get(group) || 0) + 1); selected.push(item);
  }
  return selected;
}
function senseGroup(asset) {
  const name = asset.titles?.['zh-CN'] || '';
  // Use real catalog name hierarchy, not resource ID order or guessed exclusion rules.
  const family = asset.kind === 'sound' ? name.split('_').slice(0, 4).join('_') : '';
  return `${asset.kind}:${asset.category || 'uncategorized'}:${family}`;
}
async function hybridRank(state, keyword, input, scope, env) {
  if (env.RETRIEVAL_MODE === 'keyword') return { ranked: diversify(keyword), mode: 'keyword' };
  if (!env.ASSET_VECTORIZE || typeof env.ASSET_EMBEDDING?.embedQuery !== 'function') return { ranked: diversify(keyword), mode: 'keyword',
    ...(env.ASSET_VECTORIZE || env.ASSET_EMBEDDING ? { retrievalWarning: 'VECTOR_PROVIDER_INCOMPLETE' } : {}) };
  try {
    const baseFilter = {
      ...(input.filters.hasAudio != null ? { hasAudio: input.filters.hasAudio } : {}),
      ...(env.EMBEDDING_MODEL ? { model: env.EMBEDDING_MODEL } : {}), ...(env.EMBEDDING_DIMENSIONS ? { dimensions: Number(env.EMBEDDING_DIMENSIONS) } : {}) };
    const kinds = scope === 'sound' ? input.includeEffectAudio ? ['sound', 'effect'] : ['sound'] : scope === 'all' ? ['sound', 'effect', 'bgm'] : [scope];
    let filters;
    if (input.matchOn === 'visual') {
      filters = scope === 'all' || scope === 'effect' ? [{ ...baseFilter, kind: 'effect', facet: 'feature' }] : [];
    } else if (scope === 'sound' || input.matchOn === 'audio') {
      const ordinary = kinds.filter(kind => kind !== 'effect');
      filters = [...(ordinary.length ? [{ ...baseFilter, kind: { $in: ordinary }, facet: 'feature' }] : []),
        ...(kinds.includes('effect') && input.filters.hasAudio !== false ? [{ ...baseFilter, kind: 'effect', facet: 'audio', hasAudio: true }] : [])];
    } else filters = [{ ...baseFilter, kind: { $in: kinds }, facet: { $in: ['feature', 'audio'] } }];
    if (!filters.length) return { ranked: diversify(keyword), mode: 'keyword' };
    const vector = await env.ASSET_EMBEDDING.embedQuery(queryFor(input));
    if (!Array.isArray(vector) || !vector.length || vector.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Invalid query vector');
    // Reuse one query embedding; separate audio scopes prevent visual effects crowding out sound evidence.
    const results = await Promise.all(filters.map(selected => env.ASSET_VECTORIZE.query(vector,
      { topK: 50, returnMetadata: 'all', namespace: state.catalog.indexVersion, filter: selected })));
    const vectors = [];
    for (const match of results.flatMap(result => result.matches || [])) {
      const metadata = match.metadata || {}, id = metadata.resourceId;
      if (metadata.indexVersion !== state.catalog.indexVersion || !state.byId.has(id) || !['feature', 'audio'].includes(metadata.facet)
        || metadata.kind !== state.byId.get(id).kind
        || env.EMBEDDING_MODEL && metadata.model !== env.EMBEDDING_MODEL
        || env.EMBEDDING_DIMENSIONS && metadata.dimensions !== Number(env.EMBEDDING_DIMENSIONS)) continue;
      const doc = state.docs.find(item => item.asset.resourceId === id && item.facet === metadata.facet);
      if (doc && allowedDoc(doc, input, scope) && typeof match.score === 'number' && Number.isFinite(match.score)) vectors.push({ doc, score: match.score });
    }
    vectors.sort((a, b) => b.score - a.score);
    const fused = new Map();
    for (const list of [deduplicate(keyword), deduplicate(vectors)]) list.slice(0, 200).forEach((item, index) => {
      const id = item.doc.asset.resourceId, previous = fused.get(id);
      const addition = 1 / (60 + index + 1);
      if (previous) previous.score += addition; else fused.set(id, { doc: item.doc, score: addition });
    });
    return { ranked: diversify([...fused.values()].sort((a, b) => b.score - a.score)), mode: 'hybrid' };
  } catch {
    return { ranked: diversify(keyword), mode: 'keyword', retrievalWarning: 'VECTOR_RETRIEVAL_UNAVAILABLE' };
  }
}
function encodeCursor(value) {
  const bytes = encoder.encode(JSON.stringify(value)); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeCursor(value) {
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))); }
  catch { fail('INVALID_CURSOR', 'Invalid cursor'); }
}
async function fingerprint(input, version, scope, env) {
  const { cursor, limit, ...bound } = input;
  const provider = env.RETRIEVAL_MODE === 'keyword' ? 'keyword-explicit' : env.ASSET_VECTORIZE && env.ASSET_EMBEDDING?.embedQuery ? 'hybrid'
    : env.ASSET_VECTORIZE || env.ASSET_EMBEDDING ? 'keyword-incomplete' : 'keyword';
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify({ input: bound, version, scope, provider,
    model: env.EMBEDDING_MODEL || '', dimensions: env.EMBEDDING_DIMENSIONS || '' })));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function candidateFor(item, locale) {
  const asset = item.doc.asset, audioMatch = ['audio', 'audioSuggestion'].includes(item.doc.facet);
  const suggestion = ['suggestion', 'audioSuggestion'].includes(item.doc.facet);
  const desc = localValue(audioMatch ? asset.audio?.description : asset.description, locale);
  const full = localValue(audioMatch ? asset.audio?.detailedDescription : asset.detailedDescription, locale);
  const keywords = localValue(audioMatch ? asset.audio?.keywords : asset.keywords, locale, []).value;
  const uses = localValue(audioMatch ? asset.audio?.suggestedUses : asset.suggestedUses, locale, []).value;
  return { resourceId: asset.resourceId, title: localValue(asset.titles, locale, `${asset.kind} ${asset.id}`).value, kind: asset.kind,
    description: clip(suggestion ? uses.join('；') : desc.value || full.value, 220), descriptionLocale: suggestion ? localValue(audioMatch ? asset.audio?.suggestedUses : asset.suggestedUses, locale, []).locale : desc.locale || full.locale,
    keywords: keywords.slice(0, 6).map(value => clip(value, 80)), ...(suggestion ? { suggestedUses: uses.slice(0, 3).map(value => clip(value, 200)) } : {}),
    ...(asset.duration != null ? { duration: asset.duration } : {}), hasAudio: asset.hasAudio === true, href: hrefFor(asset),
    matchType: suggestion ? 'suggestion' : 'feature', ...(audioMatch ? { audioMatch: true } : {}) };
}
function musicDescriptionsMissing(state) {
  let hasMusic = false;
  for (const asset of state.byId.values()) {
    if (asset.kind !== 'bgm') continue;
    hasMusic = true;
    // A song title or album name is catalog information, not an observed mood or sound feature.
    if ([asset.description, asset.detailedDescription].some(map => Object.values(map || {}).some(value => typeof value === 'string' && value.trim()))
      || Object.values(asset.keywords || {}).some(values => Array.isArray(values) && values.some(value => typeof value === 'string' && value.trim()))) return false;
  }
  return hasMusic;
}
function effectAudioDescriptionsMissing(state) {
  let hasEffectAudio = false;
  for (const asset of state.byId.values()) {
    if (asset.kind !== 'effect' || asset.hasAudio !== true) continue;
    hasEffectAudio = true;
    if ([asset.audio?.description, asset.audio?.detailedDescription].some(map => Object.values(map || {}).some(value => typeof value === 'string' && value.trim()))
      || Object.values(asset.audio?.keywords || {}).some(values => Array.isArray(values) && values.some(value => typeof value === 'string' && value.trim()))) return false;
  }
  return hasEffectAudio;
}
export async function searchAssets(raw, env = {}) {
  const input = validateSearchInput(raw), state = stateFor(env);
  // Old conversations may reference removed assets; their IDs are not evidence in this version.
  input.previousIds = input.previousIds.filter(id => state.byId.has(id));
  const scope = effectiveScope(input, state);
  const hash = await fingerprint(input, state.catalog.indexVersion, scope, env);
  let offset = 0;
  if (input.cursor) {
    const parsed = decodeCursor(input.cursor);
    if (!isObject(parsed) || typeof parsed.v !== 'string' || !parsed.v || typeof parsed.h !== 'string'
      || !/^[a-f0-9]{64}$/.test(parsed.h) || !Number.isInteger(parsed.o) || parsed.o < 1 || parsed.o >= 100) fail('INVALID_CURSOR', 'Invalid cursor');
    if (parsed.v !== state.catalog.indexVersion) fail('CATALOG_VERSION_MISMATCH', 'Asset catalog has updated; search again', 409);
    if (parsed.h !== hash) fail('INVALID_CURSOR', 'Cursor does not belong to this search');
    offset = parsed.o;
  }
  let retrieval = state.resultsCache.get(hash);
  if (!retrieval || retrieval.expires <= Date.now()) {
    retrieval = { ...await hybridRank(state, rankKeyword(state, input, scope), input, scope, env), expires: Date.now() + 120_000 };
    if (state.resultsCache.size >= 50) state.resultsCache.delete(state.resultsCache.keys().next().value);
    state.resultsCache.set(hash, retrieval);
  }
  const end = Math.min(offset + input.limit, retrieval.ranked.length);
  return { indexVersion: state.catalog.indexVersion, mode: retrieval.mode, effectiveScope: scope, matchOn: input.matchOn, total: retrieval.ranked.length,
    candidates: retrieval.ranked.slice(offset, end).map(item => candidateFor(item, input.locale)),
    nextCursor: end < retrieval.ranked.length ? encodeCursor({ v: state.catalog.indexVersion, h: hash, o: end }) : null,
    coverage: state.catalog.coverage, ...(retrieval.retrievalWarning ? { retrievalWarning: retrieval.retrievalWarning } : {}),
    ...(scope === 'bgm' && retrieval.ranked.length === 0 && musicDescriptionsMissing(state)
      ? { retrievalNotice: { code: 'MUSIC_DESCRIPTION_MISSING' } } : {}),
    ...(scope === 'effect' && input.matchOn === 'audio' && retrieval.ranked.length === 0 && effectAudioDescriptionsMissing(state)
      ? { retrievalNotice: { code: 'EFFECT_AUDIO_DESCRIPTION_MISSING' } } : {}) };
}
