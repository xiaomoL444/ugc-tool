import { BoundedJsonParser } from './asset-json-stream.mjs';
import defaultIdentities from './generated/asset-identities.json' with { type: 'json' };
import { verifyAssetFeatureSidecar, normalizeAssetFeatureResources, computeAssetCatalogVersion, computeAssetFeatureSourceHash, FEATURE_LOCALES } from './asset-features.mjs';

export const FEATURE_CACHE_MS = 60_000;
export const FEATURE_SOURCE_PATHS = Object.freeze([
  { kind: 'sound', project: 'SoundEffectPlayer', path: 'SoundEffectPlayer/features.json' },
  { kind: 'effect', project: 'EffectPlayer', path: 'EffectPlayer/features.json' },
]);
export class AssetCatalogError extends Error {
  constructor(code = 'ASSET_FEATURES_UNAVAILABLE') {
    super('暂时无法更新资源特征文件，请稍后重试。');
    this.name = 'AssetCatalogError'; this.code = code; this.status = 503;
  }
}
function baseUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || value.length > 2048) throw new Error();
    return url.href.replace(/\/$/, '');
  } catch { throw new AssetCatalogError('ASSET_FEATURES_SOURCE_INVALID'); }
}
async function hash(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
async function readFeatureResponse(response, signal, maxBytes) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw new AssetCatalogError('ASSET_FEATURES_TOO_LARGE');
  if (!response.body) throw new AssetCatalogError();
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  // DigestStream is a Cloudflare native extension and never retains written source bytes.
  // Node unit fixtures use the bounded WebCrypto fallback instead.
  const digestStream = typeof crypto.DigestStream === 'function' ? new crypto.DigestStream('SHA-256') : null;
  const writer = digestStream?.getWriter(); let chunks = digestStream ? null : [], size = 0;
  const parser = new BoundedJsonParser();
  digestStream?.digest.catch(() => {});
  const cancel = () => { Promise.resolve(reader.cancel()).catch(() => {}); if (writer) void writer.abort().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new AssetCatalogError('ASSET_FEATURES_TIMEOUT');
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new AssetCatalogError('ASSET_FEATURES_TOO_LARGE'); }
      if (writer) await writer.write(value); else chunks.push(value);
      try { parser.feed(decoder.decode(value, { stream: true })); } catch { throw new AssetCatalogError('ASSET_FEATURES_INVALID'); }
    }
    try { parser.feed(decoder.decode()); } catch { throw new AssetCatalogError('ASSET_FEATURES_INVALID'); }
    if (signal.aborted) throw new AssetCatalogError('ASSET_FEATURES_TIMEOUT');
    let contentHash;
    if (writer) {
      await writer.close();
      contentHash = [...new Uint8Array(await digestStream.digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    } else {
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      chunks = null; contentHash = await hash(bytes);
    }
    let value; try { value = parser.finish(); } catch { throw new AssetCatalogError('ASSET_FEATURES_INVALID'); }
    return { contentHash, value };
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); writer?.releaseLock(); }
}
function shareLexical(index, previous) {
  if (!index || !previous || !Array.isArray(index.docs) || !index.postings || typeof index.postings !== 'object') return;
  for (const term in index.postings) if (Object.hasOwn(index.postings, term) && typeof index.postings[term] === 'string'
    && Object.hasOwn(previous.postings, term) && index.postings[term] === previous.postings[term]) index.postings[term] = previous.postings[term];
  for (let i = 0; i < index.docs.length; i++) {
    const a = index.docs[i], b = previous.docs[i];
    if (Array.isArray(a) && b && a.length === 3 && a.every((value, j) => value === b[j])) index.docs[i] = b;
  }
}
function sameMap(a = {}, b = {}) {
  const keys = Object.keys(a); if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(b, key)) return false;
    const left = a[key], right = b[key];
    if (left === right) continue;
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.some((value, i) => value !== right[i])) return false;
  }
  return true;
}
function shareAssets(assets, previous) {
  if (!previous) return assets;
  const byId = new Map(previous.map(asset => [asset.resourceId, asset]));
  return assets.map(asset => {
    const before = byId.get(asset.resourceId); if (!before) return asset;
    for (const field of ['description', 'detailedDescription', 'keywords', 'suggestedUses']) {
      if (!sameMap(asset[field], before[field]) || !sameMap(asset.audio?.[field], before.audio?.[field])) return asset;
    }
    return before;
  });
}
async function readJsonFile(url, previous, fetcher, timeoutMs, maxBytes) {
  const controller = new AbortController(); let timer;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new AssetCatalogError('ASSET_FEATURES_TIMEOUT')); }, timeoutMs);
  });
  const pending = (async () => {
    const response = await fetcher(url, { method: 'GET', redirect: 'manual', cache: 'no-store',
      headers: { accept: 'application/json', 'cache-control': 'no-cache', ...(previous?.etag ? { 'if-none-match': previous.etag } : {}) }, signal: controller.signal });
    if (response.redirected) throw new AssetCatalogError();
    if (response.status === 304 && previous) return { ...previous };
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (response.status !== 200 || !(type === 'application/json' || type.endsWith('+json'))) throw new AssetCatalogError();
    const payload = await readFeatureResponse(response, controller.signal, maxBytes);
    return { hash: payload.contentHash, etag: response.headers.get('etag'), value: payload.value };
  })();
  try { return await Promise.race([pending, timedOut]); }
  catch (error) { throw error instanceof AssetCatalogError ? error : new AssetCatalogError(); }
  finally { clearTimeout(timer); }
}
const fileState = file => ({ hash: file.hash, etag: file.etag });
async function readSource(url, previous, source, identities, fetcher, timeoutMs, maxBytes, onPhase) {
  let feature = await readJsonFile(url, previous?.files?.feature || (previous && { hash: previous.hash, etag: previous.etag }), fetcher, timeoutMs, maxBytes);
  const external = feature.value === undefined ? previous?.external === true : feature.value?.i18nSource === 'project-i18n-v1';
  const dictionaryFiles = {}, dictionaries = {};
  const dictionaryUrl = locale => {
    const target = new URL('i18n/' + locale + '.json', url);
    target.searchParams.set('_t', new URL(url).searchParams.get('_t') || '');
    return target.href;
  };
  let contentHash = feature.hash;
  if (external) {
    // File state retains only hashes/ETags, not a second complete source dictionary.
    for (const locale of FEATURE_LOCALES) dictionaryFiles[locale] = await readJsonFile(dictionaryUrl(locale), previous?.files?.i18n?.[locale], fetcher, timeoutMs, Math.min(maxBytes, 12_000_000));
    contentHash = await computeAssetFeatureSourceHash(feature.hash, Object.fromEntries(FEATURE_LOCALES.map(locale => [locale, dictionaryFiles[locale].hash])));
  }
  const states = () => ({ feature: fileState(feature), ...(external ? { i18n: Object.fromEntries(FEATURE_LOCALES.map(locale => [locale, fileState(dictionaryFiles[locale])])) } : {}) });
  if (previous?.hash === contentHash) return { ...previous, etag: feature.etag, files: states() };
  // An unchanged 304 file is fetched without conditionals only when another file
  // changed and the whole project must be validated/normalized together.
  if (feature.value === undefined) feature = await readJsonFile(url, undefined, fetcher, timeoutMs, maxBytes);
  if (external) {
    if (feature.value?.i18nSource !== 'project-i18n-v1') throw new AssetCatalogError('ASSET_FEATURES_INVALID');
    for (const locale of FEATURE_LOCALES) {
      if (dictionaryFiles[locale].value === undefined) dictionaryFiles[locale] = await readJsonFile(dictionaryUrl(locale), undefined, fetcher, timeoutMs, Math.min(maxBytes, 12_000_000));
      dictionaries[locale] = dictionaryFiles[locale].value;
    }
    contentHash = await computeAssetFeatureSourceHash(feature.hash, Object.fromEntries(FEATURE_LOCALES.map(locale => [locale, dictionaryFiles[locale].hash])));
  } else contentHash = feature.hash;
  let raw = feature.value;
  shareLexical(raw?.lexical, previous?.lexical);
  if (onPhase) { await onPhase(source.kind + ':read'); await onPhase(source.kind + ':parsed'); }
  let sidecar;
  try {
    sidecar = await verifyAssetFeatureSidecar(raw, { project: source.project, kind: source.kind,
      baseIndexVersion: identities.indexVersion, identities, requireCompiled: true, ...(external ? { dictionaries } : {}) });
    if (onPhase) await onPhase(source.kind + ':verified');
    let assets = normalizeAssetFeatureResources(sidecar, identities, { includeFacetTexts: false });
    const identityById = new Map(identities.assets.map(asset => [asset.resourceId, asset]));
    for (const asset of assets) { asset.featureFacetsLazy = true; asset.identityFeatureText = identityById.get(asset.resourceId)?.facetTexts?.feature; }
    assets = shareAssets(assets, previous?.assets);
    if (onPhase) await onPhase(source.kind + ':normalized');
    return { hash: contentHash, etag: feature.etag, external, files: states(), assets, lexical: sidecar.lexical };
  } catch (error) { throw new AssetCatalogError(error?.code === 'ASSET_FEATURES_INVALID' ? error.code : 'ASSET_FEATURES_INVALID'); }
  finally { raw = null; sidecar = null; feature.value = undefined; for (const locale of FEATURE_LOCALES) if (dictionaryFiles[locale]) dictionaryFiles[locale].value = undefined; }
}
function coverageFor(assets, original = {}) {
  const coverage = { ...original, total: assets.length, byKind: { sound: 0, effect: 0, bgm: 0 },
    descriptions: { sound: 0, effect: 0, bgm: 0 }, detailedDescriptions: 0, audioDescriptions: 0, effectsWithAudio: 0,
    namesByLocale: {}, descriptionLocales: {}, describedAssetCount: 0, describedAudioAssetCount: 0 };
  for (const asset of assets) {
    coverage.byKind[asset.kind] += 1;
    const described = Object.values(asset.description || {}).some(Boolean);
    if (described) { coverage.descriptions[asset.kind] += 1; coverage.describedAssetCount += 1; }
    if (Object.values(asset.detailedDescription || {}).some(Boolean)) coverage.detailedDescriptions += 1;
    const audioDescribed = Object.values(asset.audio?.description || {}).some(Boolean) || Object.values(asset.audio?.detailedDescription || {}).some(Boolean);
    if (audioDescribed) coverage.audioDescriptions += 1;
    if (asset.kind === 'effect' && asset.hasAudio) coverage.effectsWithAudio += 1;
    if (asset.kind === 'sound' && described || asset.kind === 'effect' && audioDescribed) coverage.describedAudioAssetCount += 1;
    for (const locale of ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ru-RU']) {
      coverage.namesByLocale[locale] = (coverage.namesByLocale[locale] || 0) + Number(Boolean(asset.titles?.[locale]));
      coverage.descriptionLocales[locale] = (coverage.descriptionLocales[locale] || 0) + Number(Boolean(asset.description?.[locale]));
    }
  }
  return coverage;
}
async function assemble(identities, sources) {
  const byKind = new Map(sources.map((source, index) => [FEATURE_SOURCE_PATHS[index].kind, source]));
  const assets = [...sources.flatMap(source => source.assets), ...identities.assets.filter(asset => !byKind.has(asset.kind))];
  const hashes = Object.fromEntries(FEATURE_SOURCE_PATHS.map((source, index) => [source.kind, sources[index].hash]));
  const indexVersion = await computeAssetCatalogVersion(identities.indexVersion, hashes);
  return { ...identities, assets, indexVersion, coverage: coverageFor(assets, identities.coverage),
    lexical: { format: 'sharded-uint32-base64-v1', shards: [
      { lexical: identities.lexical, excludeKinds: ['sound', 'effect'] }, ...sources.map(source => ({ lexical: source.lexical })),
    ] } };
}
/** Request-driven, per-isolate refresh. A visitor cancellation never cancels a shared refresh. */
export function createAssetCatalogLoader({ fetcher, now = () => Date.now(), timeoutMs = 5000, maxBytes = 48_000_000,
  identities = defaultIdentities, cacheMs = FEATURE_CACHE_MS, onPhase } = {}) {
  let current, sources, sync, nextCheckAt = 0, inFlight, configuredBase, activePins = 0;
  const pinWaiters = new Set();
  const snapshot = () => ({ catalog: current, featureSync: { ...sync, hashes: { ...sync.hashes } } });
  const waitForPins = signal => new Promise((resolve, reject) => {
    const waiter = { finish: () => { pinWaiters.delete(waiter); signal?.removeEventListener('abort', abort); resolve(); } };
    const abort = () => { pinWaiters.delete(waiter); signal?.removeEventListener('abort', abort); reject(new DOMException('Aborted', 'AbortError')); };
    if (signal?.aborted) { abort(); return; }
    pinWaiters.add(waiter); signal?.addEventListener('abort', abort, { once: true });
  });
  const api = {
    async acquire(env = {}, { signal } = {}) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      // New long-running turns wait for an overdue generation to drain instead of
      // extending the lifetime of the old generation indefinitely.
      while (current && activePins && now() >= nextCheckAt) await waitForPins(signal);
      const selected = await api.read(env);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (selected.featureSync.status === 'disabled') return { ...selected, release() {} };
      activePins += 1; let released = false;
      return { ...selected, release() {
        if (released) return; released = true; activePins -= 1;
        if (!activePins) for (const waiter of [...pinWaiters]) waiter.finish();
      } };
    },
    async read(env = {}) {
      if (env.ASSET_SEARCH_CATALOG) return { catalog: env.ASSET_SEARCH_CATALOG,
        featureSync: env.ASSET_FEATURE_SYNC || { status: 'disabled', hashes: {} } };
      if (!env.ASSET_FEATURES_BASE_URL) return { catalog: identities, featureSync: { status: 'disabled', hashes: {} } };
      const base = baseUrl(env.ASSET_FEATURES_BASE_URL);
      if (configuredBase && configuredBase !== base && (inFlight || activePins)) throw new AssetCatalogError('ASSET_FEATURES_SOURCE_INVALID');
      if (configuredBase && configuredBase !== base) { current = sources = sync = undefined; nextCheckAt = 0; }
      configuredBase = base;
      if (current && activePins) return snapshot();
      if (inFlight) return inFlight;
      if (now() < nextCheckAt) { if (current) return snapshot(); throw new AssetCatalogError(sync?.errorCode); }
      const checkedAt = now();
      inFlight = (async () => {
        try {
          const candidate = [];
          // Read sequentially: never retain two source response byte buffers or parsed dictionaries.
          for (const [index, source] of FEATURE_SOURCE_PATHS.entries()) {
            const url = new URL(`${base}/${source.path}`); url.searchParams.set('_t', String(checkedAt));
            candidate.push(await readSource(url.href, sources?.[index], source, identities, fetcher ?? fetch, timeoutMs, maxBytes, onPhase));
          }
          const changed = !sources || candidate.some((source, index) => source.hash !== sources[index].hash);
          if (changed) {
            if (onPhase) await onPhase('before-swap');
            current = await assemble(identities, candidate);
            if (onPhase) await onPhase('after-swap');
          }
          sources = candidate;
          const hashes = Object.fromEntries(FEATURE_SOURCE_PATHS.map((source, index) => [source.kind, sources[index].hash]));
          sync = { status: 'ready', hashes, checkedAt, lastGoodAt: now(),
            updatedAt: changed ? now() : sync?.updatedAt ?? now() };
          nextCheckAt = now() + cacheMs;
          return snapshot();
        } catch (error) {
          const failure = error instanceof AssetCatalogError ? error : new AssetCatalogError();
          sync = { ...sync, status: 'stale', hashes: sync?.hashes || {}, checkedAt, errorCode: failure.code };
          nextCheckAt = now() + cacheMs;
          if (current) return snapshot();
          throw failure;
        } finally { inFlight = undefined; }
      })();
      return inFlight;
    },
  };
  return api;
}
