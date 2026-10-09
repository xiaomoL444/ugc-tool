// Shared by the offline exporter and Worker. No filesystem, provider, or model calls.
// parseAssetFeatureSidecar(raw, options) validates structure, references and identity binding.
// normalizeAssetFeatureResources(sidecar, identities) produces the existing search asset shape.
// verifyAssetFeatureSidecar(raw, options) additionally checks the precompiled feature hash.
export const FEATURE_LOCALES = ['zh-cn', 'zh-tw', 'en-us', 'ja-jp', 'ru-ru'];
export const FEATURE_HASH_ALGORITHM = 'sha256-json-blocks-v1';
export const FEATURE_LIMITS = { resources: 25000, dictionaryKeysPerLocale: 120000, textLength: 20000, arrayReferences: 64,
  rawCharacters: 90000000, dictionaryCharacters: 30000000, lexicalDocuments: 100000, lexicalTerms: 500000, postingCharacters: 60000000 };
const SEARCH_LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ru-RU'];
const PROJECTS = { SoundEffectPlayer: { kind: 'sound', namespace: 'soundEffectPlayer' }, EffectPlayer: { kind: 'effect', namespace: 'effectPlayer' }, BgmPlayer: { kind: 'bgm', namespace: 'bgmPlayer' } };
const PARTS = ['standVisual', 'tailVisual', 'audio'];
const ARRAY_FIELDS = ['keywordsI18nKeys', 'possibleSourcesI18nKeys', 'suggestedUsesI18nKeys', 'uncertainDetailsI18nKeys'];
const ARRAY_SUFFIXES = { keywordsI18nKeys: 'keywords', possibleSourcesI18nKeys: 'possible_sources', suggestedUsesI18nKeys: 'suggested_uses', uncertainDetailsI18nKeys: 'uncertain_details' };
const STATUSES = ['generated', 'not_generated', 'not_available', 'catalog_no_audio', 'failed'];
const FACETS = ['feature', 'suggestion', 'audio', 'audioSuggestion'];
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.trim() : '';
const unique = values => [...new Set(values.filter(Boolean))];
const join = values => unique(values.map(text)).join('\n');
const values = map => Object.values(map || {}).flat();
const own = (value, key) => Object.hasOwn(value, key);
function assert(condition, message) { if (!condition) throw new AssetFeatureError(message); }
export class AssetFeatureError extends Error {
  constructor(message) { super(message); this.name = 'AssetFeatureError'; this.code = 'ASSET_FEATURES_INVALID'; this.status = 503; }
}
function identityRows(identities) {
  if (Array.isArray(identities)) return identities;
  assert(object(identities) && Array.isArray(identities.assets), 'Missing asset identities');
  return identities.assets;
}
function references(part) {
  return [part.shortDescriptionI18nKey, part.descriptionI18nKey, ...ARRAY_FIELDS.flatMap(field => part[field] || [])].filter(Boolean);
}
function metadataSize(value, depth = 0) {
  assert(depth <= 6, 'Feature provenance exceeds nesting limit');
  if (typeof value === 'string') { assert(value.length <= FEATURE_LIMITS.textLength, 'Feature provenance string exceeds size limit'); return value.length; }
  if (Array.isArray(value)) { assert(value.length <= 1024, 'Feature provenance array exceeds size limit'); return value.reduce((size, child) => size + metadataSize(child, depth + 1), 0); }
  if (object(value)) {
    const entries = Object.entries(value); assert(entries.length <= 100, 'Feature provenance object exceeds size limit');
    return entries.reduce((size, [key, child]) => { assert(key.length <= 250 && !['__proto__', 'prototype', 'constructor'].includes(key), 'Invalid feature provenance key'); return size + key.length + metadataSize(child, depth + 1); }, 0);
  }
  assert(value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value), 'Invalid feature provenance value');
  return 0;
}
// Project dictionaries may contain base UI/name translations. Only this project's
// namespace.search.* entries become feature evidence; retain their insertion order.
export function extractAssetFeatureDictionary(project, raw) {
  const source = typeof project === 'string' && own(PROJECTS, project) ? PROJECTS[project] : null;
  assert(source, 'Missing project feature dictionaries');
  assert(object(raw), 'Incomplete project feature locales');
  const prefix = source.namespace + '.search.', table = object(raw.translations) ? raw.translations : raw;
  const selected = Object.create(null);
  for (const key in table) {
    if (!own(table, key)) continue;
    const canonical = key.startsWith('search.') ? source.namespace + '.' + key : key;
    if (!canonical.startsWith(prefix)) continue;
    assert(!own(selected, canonical), 'Duplicate normalized feature translation');
    selected[canonical] = table[key];
  }
  return selected;
}
export function extractAssetFeatureDictionaries(project, dictionaries) {
  assert(object(dictionaries), 'Missing project feature dictionaries');
  const output = {};
  for (let index = 0; index < FEATURE_LOCALES.length; index++) {
    const locale = FEATURE_LOCALES[index];
    output[locale] = extractAssetFeatureDictionary(project, dictionaries[locale] ?? dictionaries[SEARCH_LOCALES[index]]);
  }
  return output;
}
export function parseAssetFeatureSidecar(raw, options = {}) {
  let sidecar = raw;
  if (typeof raw === 'string') {
    assert(raw.length <= FEATURE_LIMITS.rawCharacters, 'Feature JSON exceeds size limit');
    try { sidecar = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { throw new AssetFeatureError('Malformed feature JSON'); }
  }
  assert(object(sidecar) && sidecar.schemaVersion === 1, 'Unsupported feature schema');
  const source = typeof sidecar.project === 'string' && own(PROJECTS, sidecar.project) ? PROJECTS[sidecar.project] : null;
  assert(source && sidecar.kind === source.kind, 'Invalid feature project or kind');
  for (const key of ['project', 'kind', 'baseIndexVersion']) if (options[key] != null) assert(sidecar[key] === options[key], `Feature ${key} mismatch`);
  assert(typeof sidecar.baseIndexVersion === 'string' && sidecar.baseIndexVersion.length > 0 && sidecar.baseIndexVersion.length <= 200, 'Missing identity index version');
  if (object(options.identities) && options.identities.indexVersion) assert(sidecar.baseIndexVersion === options.identities.indexVersion, 'Feature identity index version mismatch');
  assert(sidecar.i18nSource == null || sidecar.i18nSource === 'project-i18n-v1', 'Unsupported feature dictionary source');
  if (sidecar.i18nSource === 'project-i18n-v1' && options.dictionaries != null) sidecar = { ...sidecar, i18n: extractAssetFeatureDictionaries(sidecar.project, options.dictionaries) };
  assert(object(sidecar.resources) && object(sidecar.i18n), 'Missing feature records or dictionaries');
  assert(Object.keys(sidecar.resources).length <= FEATURE_LIMITS.resources, 'Too many feature resources');
  assert(Object.keys(sidecar.i18n).length === FEATURE_LOCALES.length && FEATURE_LOCALES.every(locale => object(sidecar.i18n[locale])), 'Incomplete feature locales');
  const knownIds = options.identities ? new Set(identityRows(options.identities).filter(item => item.kind === source.kind).map(item => String(item.id))) : null;
  const prefix = `${source.namespace}.search.`, refs = new Set();
  let provenanceCharacters = 0;
  for (const [id, entry] of Object.entries(sidecar.resources)) {
    assert(/^\d{1,12}$/.test(id) && (!knownIds || knownIds.has(id)), 'Unknown feature resource ID');
    assert(object(entry) && Object.keys(entry).length === 1 && object(entry.searchMetadata) && entry.searchMetadata.schemaVersion === 1, 'Invalid feature resource metadata');
    const metadata = entry.searchMetadata;
    provenanceCharacters += metadataSize(metadata);
    assert(provenanceCharacters <= 12000000, 'Feature provenance exceeds total size limit');
    assert(Object.keys(metadata).every(key => key === 'schemaVersion' || PARTS.includes(key) && (source.kind === 'effect' || key === 'audio')), 'Unexpected feature part');
    for (const partName of PARTS) {
      if (!own(metadata, partName)) continue;
      const part = metadata[partName];
      assert(object(part) && STATUSES.includes(part.status), 'Invalid feature generation state');
      for (const [field, suffix] of [['shortDescriptionI18nKey', 'short'], ['descriptionI18nKey', 'detail']]) if (own(part, field)) assert(part[field] === `${prefix}${id}.${partName}.${suffix}`, 'Feature reference belongs to another resource or field');
      for (const field of ARRAY_FIELDS) if (own(part, field)) assert(Array.isArray(part[field]) && part[field].length <= FEATURE_LIMITS.arrayReferences && part[field].every(key => typeof key === 'string' && key.length <= 250 && key.startsWith(`${prefix}${id}.${partName}.${ARRAY_SUFFIXES[field]}.`) && /^\d+$/.test(key.split('.').at(-1))), 'Invalid feature array reference');
      const partRefs = references(part);
      if (part.status === 'generated') assert(text(part.shortDescriptionI18nKey), 'Generated feature has no short description');
      else assert(partRefs.length === 0, 'Unavailable feature contains generated references');
      for (const key of partRefs) {
        refs.add(key);
        for (const locale of FEATURE_LOCALES) assert(own(sidecar.i18n[locale], key) && typeof sidecar.i18n[locale][key] === 'string' && sidecar.i18n[locale][key].trim(), 'Dangling feature translation reference');
      }
    }
  }
  let dictionaryCharacters = 0;
  for (const locale of FEATURE_LOCALES) {
    let dictionaryKeys = 0;
    for (const key in sidecar.i18n[locale]) {
      if (!own(sidecar.i18n[locale], key)) continue;
      dictionaryKeys++;
      assert(dictionaryKeys <= FEATURE_LIMITS.dictionaryKeysPerLocale, 'Too many feature dictionary keys');
      const value = sidecar.i18n[locale][key];
      assert(key.length <= 250 && key.startsWith(prefix) && refs.has(key) && typeof value === 'string' && value.length <= FEATURE_LIMITS.textLength, 'Unowned or oversized feature translation');
      dictionaryCharacters += key.length + value.length;
    }
  }
  assert(dictionaryCharacters <= FEATURE_LIMITS.dictionaryCharacters, 'Feature dictionaries exceed size limit');
  if (options.requireCompiled !== false) {
    const lexical = sidecar.lexical;
    assert(sidecar.hashAlgorithm === FEATURE_HASH_ALGORITHM, 'Unsupported feature hash algorithm');
    assert(typeof sidecar.lexicalFeatureHash === 'string' && /^[a-f0-9]{64}$/.test(sidecar.lexicalFeatureHash), 'Missing lexical feature hash');
    assert(object(lexical) && lexical.format === 'uint32-base64-v1' && Array.isArray(lexical.docs) && object(lexical.postings) && Number.isFinite(lexical.averageLength) && lexical.averageLength >= 0, 'Invalid compiled feature index');
    assert(lexical.docs.length <= FEATURE_LIMITS.lexicalDocuments, 'Compiled feature index exceeds count limits');
    for (const doc of lexical.docs) assert(Array.isArray(doc) && doc.length === 3 && typeof doc[0] === 'string' && new RegExp(`^${source.kind}:\\d{1,12}$`).test(doc[0]) && (!knownIds || knownIds.has(doc[0].slice(source.kind.length + 1))) && (source.kind === 'effect' ? FACETS : ['feature', 'suggestion']).includes(doc[1]) && Number.isInteger(doc[2]) && doc[2] > 0 && doc[2] <= 1000000, 'Invalid compiled feature document');
    let postingCharacters = 0, postingTerms = 0;
    for (const term in lexical.postings) {
      if (!own(lexical.postings, term)) continue;
      postingTerms++;
      assert(postingTerms <= FEATURE_LIMITS.lexicalTerms, 'Compiled feature index exceeds count limits');
      const packed = lexical.postings[term];
      assert(term.length > 0 && term.length <= 250 && typeof packed === 'string' && packed.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(packed), 'Invalid compiled feature postings');
      postingCharacters += packed.length;
      assert(postingCharacters <= FEATURE_LIMITS.postingCharacters && packed.length <= Math.ceil(lexical.docs.length * 4 / 3) * 4, 'Compiled feature postings exceed size limit');
      const binary = atob(packed);
      assert(binary.length % 4 === 0, 'Misaligned compiled feature postings');
      let previous = -1;
      for (let offset = 0; offset < binary.length; offset += 4) {
        const value = (binary.charCodeAt(offset) | binary.charCodeAt(offset + 1) << 8 | binary.charCodeAt(offset + 2) << 16 | binary.charCodeAt(offset + 3) << 24) >>> 0;
        const docIndex = Math.floor(value / 8), frequency = value & 7;
        assert(docIndex < lexical.docs.length && docIndex > previous && frequency > 0, 'Compiled feature posting out of range');
        previous = docIndex;
      }
    }
    assert(postingCharacters <= FEATURE_LIMITS.postingCharacters, 'Compiled feature postings exceed size limit');
    assert(lexical.hashAlgorithm === FEATURE_HASH_ALGORITHM && lexical.featureHash === sidecar.lexicalFeatureHash && lexical.baseIndexVersion === sidecar.baseIndexVersion && typeof lexical.integrityHash === 'string' && /^[a-f0-9]{64}$/.test(lexical.integrityHash), 'Compiled feature header mismatch');
  }
  return sidecar;
}
async function digestText(payload) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
// Each block is at most 64 Ki UTF-16 code units / 192 KiB UTF-8. Never serialize
// an entire dictionary or postings table into a second full-size string/buffer.
function blockHasher(domain) {
  const blockCharacters = 65536, hashes = [];
  let pending = '';
  const flush = async () => { if (pending) { const block = pending; pending = ''; hashes.push(await digestText(block)); } };
  return {
    async add(value) {
      const line = JSON.stringify(value) + '\n';
      let offset = 0;
      while (offset < line.length) {
        let end = Math.min(line.length, offset + blockCharacters - pending.length);
        // Keep a supplementary Unicode character in one UTF-8 block.
        if (end < line.length && end > offset && /[\uD800-\uDBFF]/u.test(line[end - 1]) && /[\uDC00-\uDFFF]/u.test(line[end])) end--;
        if (end === offset) { await flush(); continue; }
        pending += line.slice(offset, end); offset = end;
        if (pending.length >= blockCharacters) await flush();
      }
    },
    async finish() { await flush(); return digestText(JSON.stringify({ algorithm: FEATURE_HASH_ALGORITHM, domain, blocks: hashes })); },
  };
}
export async function computeLexicalFeatureHash(sidecar) {
  const hasher = blockHasher('asset-feature-source');
  await hasher.add(['header', sidecar.schemaVersion, sidecar.project, sidecar.kind, sidecar.baseIndexVersion]);
  await hasher.add(['resources']);
  for (const id in sidecar.resources) if (own(sidecar.resources, id)) await hasher.add([id, sidecar.resources[id]]);
  for (const locale of FEATURE_LOCALES) {
    await hasher.add(['locale', locale]);
    const dictionary = sidecar.i18n[locale];
    for (const key in dictionary) if (own(dictionary, key)) await hasher.add([key, dictionary[key]]);
  }
  return hasher.finish();
}
export async function computeLexicalIndexHash(lexical) {
  const hasher = blockHasher('asset-feature-lexical');
  await hasher.add(['header', lexical.format, lexical.averageLength]);
  await hasher.add(['docs']);
  for (const doc of lexical.docs) await hasher.add(doc);
  await hasher.add(['postings']);
  for (const term in lexical.postings) if (own(lexical.postings, term)) await hasher.add([term, lexical.postings[term]]);
  return hasher.finish();
}
// Version each external sidecar together with all five raw project dictionaries.
export async function computeAssetFeatureSourceHash(feature, dictionaryHashes) {
  assert(typeof feature === 'string' && /^[a-f0-9]{64}$/.test(feature) && object(dictionaryHashes), 'Invalid feature source hash inputs');
  const i18n = {};
  for (const locale of FEATURE_LOCALES) {
    const hash = dictionaryHashes[locale];
    assert(typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash), 'Invalid feature dictionary hash');
    i18n[locale] = hash;
  }
  return digestText(JSON.stringify({ feature, i18n }));
}
export async function computeAssetCatalogVersion(baseIndexVersion, hashes) {
  assert(typeof baseIndexVersion === 'string' && baseIndexVersion.length > 0 && ['sound', 'effect'].every(kind => typeof hashes?.[kind] === 'string' && /^[a-f0-9]{64}$/.test(hashes[kind])), 'Invalid catalog version inputs');
  const selected = { sound: hashes.sound, effect: hashes.effect };
  if (own(hashes, 'bgm')) {
    assert(typeof hashes.bgm === 'string' && /^[a-f0-9]{64}$/.test(hashes.bgm), 'Invalid BGM catalog version input');
    selected.bgm = hashes.bgm;
  }
  const payload = JSON.stringify({ baseIndexVersion, hashes: selected });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function verifyAssetFeatureSidecar(raw, options = {}) {
  const sidecar = parseAssetFeatureSidecar(raw, options);
  assert(sidecar.lexicalFeatureHash === await computeLexicalFeatureHash(sidecar), 'Compiled feature source hash mismatch');
  if (options.requireCompiled !== false) assert(sidecar.lexical.integrityHash === await computeLexicalIndexHash(sidecar.lexical), 'Compiled feature index hash mismatch');
  return sidecar;
}
function resolvedPart(metadata, partName, dictionaries) {
  const result = { description: {}, detailedDescription: {}, keywords: {}, suggestedUses: {} };
  const part = metadata?.[partName];
  if (part?.status !== 'generated') return result;
  for (let index = 0; index < FEATURE_LOCALES.length; index++) {
    const locale = SEARCH_LOCALES[index], dictionary = dictionaries[FEATURE_LOCALES[index]];
    for (const [name, field] of [['description', 'shortDescriptionI18nKey'], ['detailedDescription', 'descriptionI18nKey']]) {
      const value = text(dictionary[part[field]]); if (value) result[name][locale] = value;
    }
    for (const [name, field] of [['keywords', 'keywordsI18nKeys'], ['suggestedUses', 'suggestedUsesI18nKeys']]) {
      const list = unique((part[field] || []).map(key => text(dictionary[key]))); if (list.length) result[name][locale] = list;
    }
  }
  // possibleSources and uncertainDetails remain in raw records; neither is confirmed evidence.
  return result;
}
function combine(parts, field, list = false) {
  const result = {};
  for (const locale of SEARCH_LOCALES) {
    const merged = parts.flatMap(part => part[field][locale] || []);
    const value = list ? unique(merged) : join(merged);
    if (value.length) result[locale] = value;
  }
  return result;
}
export function normalizeAssetFeatureResources(sidecar, identities, options = {}) {
  return identityRows(identities).filter(asset => asset.kind === sidecar.kind).map(identity => {
    const metadata = sidecar.resources[identity.id]?.searchMetadata;
    const sound = resolvedPart(metadata, 'audio', sidecar.i18n);
    const primary = identity.kind === 'sound' || identity.kind === 'bgm' ? [sound] : ['standVisual', 'tailVisual'].map(part => resolvedPart(metadata, part, sidecar.i18n));
    const description = combine(primary, 'description'), detailedDescription = combine(primary, 'detailedDescription');
    const keywords = combine(primary, 'keywords', true), suggestedUses = combine(primary, 'suggestedUses', true);
    const audio = identity.kind === 'effect' && identity.hasAudio === true ? sound : { description: {}, detailedDescription: {}, keywords: {}, suggestedUses: {} };
    const result = { ...identity, description, detailedDescription, keywords, suggestedUses, audio };
    if (options.includeFacetTexts === false) { delete result.facetTexts; return options.reuseAsset ? options.reuseAsset(result) : result; }
    result.facetTexts = { feature: join([identity.facetTexts?.feature || join([identity.id, ...values(identity.titles)]), ...values(description), ...values(detailedDescription), ...values(keywords)]),
        audio: identity.kind === 'effect' && identity.hasAudio === true ? join([...values(audio.description), ...values(audio.detailedDescription), ...values(audio.keywords)]) : '',
        suggestion: join(values(suggestedUses)), audioSuggestion: join(values(audio.suggestedUses)) };
    return options.reuseAsset ? options.reuseAsset(result) : result;
  });
}
