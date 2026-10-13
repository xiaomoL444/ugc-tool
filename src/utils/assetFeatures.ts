import { parseAssetFeatureSidecar, FEATURE_LOCALES } from '../../tools/ai-search-service/asset-features.mjs';
import type { FeatureSidecar } from '../../tools/ai-search-service/asset-features.mjs';
import { OSS_BASE_URL, createOss } from './oss';
import { i18n, isAppLocale, loadOssTranslationDictionary } from '../i18n';
import type { AppLocale } from '../i18n';

export type AssetFeatureProject = 'SoundEffectPlayer' | 'EffectPlayer' | 'BgmPlayer';
export type AssetFeaturePart = 'audio' | 'standVisual' | 'tailVisual';
export interface AssetFeatureIdentity { id: string | number; hasAudio?: boolean; audioPath?: string }
export interface AssetFeatureDescription {
  part: AssetFeaturePart;
  short: string;
  detail: string;
  keywords: string[];
  suggestedUses: string[];
  locale: string;
}
export interface AssetFeatureCollection {
  status: 'ready' | 'stale' | 'unavailable';
  errorCode?: string;
  checkedAt: number;
  get(id: string | number, locale: string): AssetFeatureDescription[];
  /** Observed descriptions and keywords in loaded languages, without guessed sources. */
  searchText: ReadonlyMap<string, string>;
  /** Use suggestions are kept separate from observed properties. */
  suggestionSearchText: ReadonlyMap<string, string>;
}
export interface AssetFeatureLoadOptions {
  /** Defaults to the current language; dictionaries always use the shared i18n entry. */
  locale?: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
  cached?: boolean;
  force?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

const CACHE_TTL = 60_000;
const metadataCache = new Map<string, CachedMetadata>();
const metadataPending = new Map<string, Promise<CachedMetadata>>();
const snapshots = new Map<string, CachedFeatures>();
const NAMESPACES: Record<AssetFeatureProject, string> = {
  SoundEffectPlayer: 'soundEffectPlayer', EffectPlayer: 'effectPlayer', BgmPlayer: 'bgmPlayer',
};
interface CachedMetadata {
  raw?: unknown;
  revision?: string;
  status: AssetFeatureCollection['status'];
  checkedAt: number;
  bytes: number;
  errorCode?: string;
}
interface CachedFeatures {
  status: AssetFeatureCollection['status'];
  sidecar?: FeatureSidecar;
  errorCode?: string;
  checkedAt: number;
  locales?: string[];
  metadataRevision?: string;
}
const PARTS: AssetFeaturePart[] = ['standVisual', 'tailVisual', 'audio'];
const unique = (values: string[]) => Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
const stringValue = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function assetFeaturePath(project: AssetFeatureProject): string {
  return `${project}/features.json`;
}
export function assetFeatureUrl(project: AssetFeatureProject, baseUrl: string = OSS_BASE_URL): string {
  return createOss(project, baseUrl).path('features.json');
}
export function normalizeAssetFeatureLocale(locale: string): string {
  const normalized = locale.replace(/_/g, '-').toLowerCase();
  return FEATURE_LOCALES.includes(normalized) ? normalized : '';
}

function availableParts(project: AssetFeatureProject, identity: AssetFeatureIdentity): AssetFeaturePart[] {
  if (project !== 'EffectPlayer') return ['audio'];
  return identity.hasAudio === true && stringValue(identity.audioPath)
    ? PARTS : ['standVisual', 'tailVisual'];
}

/** Bind sidecar records to the current asset list; a sidecar cannot add assets or media. */
export function buildAssetFeatureCollection(project: AssetFeatureProject, raw: unknown,
  identities: readonly AssetFeatureIdentity[], state: { status?: 'ready' | 'stale'; errorCode?: string; checkedAt?: number;
    dictionaries?: Record<string, unknown>; locales?: string[] } = {}): AssetFeatureCollection {
  const sidecar = parseAssetFeatureSidecar(raw, { project, dictionaries: state.dictionaries, requireCompiled: false, locales: state.locales });
  const known = new Map<string, AssetFeatureIdentity>();
  for (const identity of identities) {
    const id = String(identity.id);
    if (/^\d{1,12}$/.test(id)) known.set(id, { ...identity });
  }
  const resolve = (id: string, locale: string): AssetFeatureDescription[] => {
    const identity = known.get(id), normalizedLocale = normalizeAssetFeatureLocale(locale);
    if (!identity || !normalizedLocale) return [];
    const dictionary = sidecar.i18n[normalizedLocale];
    if (!dictionary) return [];
    const metadata = sidecar.resources[id]?.searchMetadata;
    if (!metadata) return [];
    return availableParts(project, identity).flatMap(part => {
      const record = metadata[part] as Record<string, unknown> | undefined;
      if (record?.status !== 'generated') return [];
      const short = stringValue(dictionary[stringValue(record.shortDescriptionI18nKey)]);
      if (!short) return [];
      const refs = (field: string) => unique((Array.isArray(record[field]) ? record[field] as unknown[] : [])
        .map(key => stringValue(dictionary[stringValue(key)])));
      return [{ part, short,
        detail: stringValue(dictionary[stringValue(record.descriptionI18nKey)]),
        keywords: refs('keywordsI18nKeys'), suggestedUses: refs('suggestedUsesI18nKeys'), locale: normalizedLocale }];
    });
  };
  const searchText = new Map<string, string>(), suggestionSearchText = new Map<string, string>();
  for (const id of known.keys()) {
    const facts: string[] = [], suggestions: string[] = [];
    for (const locale of FEATURE_LOCALES) for (const part of resolve(id, locale)) {
      facts.push(part.short, part.detail, ...part.keywords);
      suggestions.push(...part.suggestedUses);
    }
    const observed = unique(facts).join('\n'), suggested = unique(suggestions).join('\n');
    if (observed) searchText.set(id, observed);
    if (suggested) suggestionSearchText.set(id, suggested);
  }
  const memo = new Map<string, AssetFeatureDescription[]>(), empty: AssetFeatureDescription[] = [];
  const get = (id: string | number, locale: string) => {
    const normalized = normalizeAssetFeatureLocale(locale), resourceId = String(id);
    if (!normalized || !known.has(resourceId)) return empty;
    const key = `${resourceId}:${normalized}`;
    let parts = memo.get(key);
    if (!parts) { parts = resolve(resourceId, normalized); memo.set(key, parts); }
    return parts;
  };
  return { status: state.status || 'ready', errorCode: state.errorCode, checkedAt: state.checkedAt ?? Date.now(),
    get, searchText, suggestionSearchText };
}

class FeatureLoadError extends Error {
  constructor(readonly code: string) { super(code); }
}
async function readBody(response: Response, maxBytes: number, signal: AbortSignal, budget: { used: number }): Promise<string> {
  const length = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new FeatureLoadError('ASSET_FEATURES_TOO_LARGE');
  }
  if (!response.body) {
    const text = await response.text();
    budget.used += new TextEncoder().encode(text).byteLength;
    if (budget.used > maxBytes) throw new FeatureLoadError('ASSET_FEATURES_TOO_LARGE');
    return text;
  }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  const text: string[] = [];
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new FeatureLoadError('ASSET_FEATURES_TIMEOUT');
      const item = await reader.read();
      if (signal.aborted) throw new FeatureLoadError('ASSET_FEATURES_TIMEOUT');
      if (item.done) break;
      total += item.value.byteLength;
      budget.used += item.value.byteLength;
      if (total > maxBytes || budget.used > maxBytes) { await reader.cancel(); throw new FeatureLoadError('ASSET_FEATURES_TOO_LARGE'); }
      text.push(decoder.decode(item.value, { stream: true }));
    }
    text.push(decoder.decode());
    return text.join('');
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

const bounded = (value: number | undefined, fallback: number, limit: number) =>
  value !== undefined && Number.isFinite(value) ? Math.min(limit, Math.max(1, value)) : fallback;

/** Only metadata is fetched here. Translation files are owned by the i18n loader. */
async function fetchMetadata(project: AssetFeatureProject, url: string, options: AssetFeatureLoadOptions,
  previous?: CachedMetadata): Promise<CachedMetadata> {
  const controller = new AbortController();
  const timeoutMs = bounded(options.timeoutMs, 10_000, 60_000);
  const maxBytes = bounded(options.maxBytes, project === 'SoundEffectPlayer' ? 40_000_000 : 70_000_000, 90_000_000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const budget = { used: 0 };
    const work = async () => {
      const response = await (options.fetcher || fetch)(`${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`, {
        cache: 'no-store', credentials: 'omit', signal: controller.signal,
      });
      if (!response.ok) throw new FeatureLoadError('ASSET_FEATURES_UNAVAILABLE');
      const type = response.headers.get('Content-Type') || '';
      if (type && !/application\/(?:[\w.+-]+\+)?json(?:;|$)/i.test(type)) {
        await response.body?.cancel().catch(() => undefined);
        throw new FeatureLoadError('ASSET_FEATURES_INVALID');
      }
      const text = await readBody(response, maxBytes, controller.signal, budget);
      // Keep only a small content stamp after parsing, without retaining another JSON body.
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const revision = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      return { raw: JSON.parse(text.replace(/^\uFEFF/, '')) as unknown, revision };
    };
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new FeatureLoadError('ASSET_FEATURES_TIMEOUT')); }, timeoutMs);
    });
    const { raw, revision } = await Promise.race([work(), timedOut]);
    return { status: 'ready', raw, revision, bytes: budget.used, checkedAt: Date.now() };
  } catch (error) {
    controller.abort();
    const errorCode = error instanceof FeatureLoadError ? error.code : 'ASSET_FEATURES_INVALID';
    return { status: previous?.raw ? 'stale' : 'unavailable', raw: previous?.raw,
      revision: previous?.revision, bytes: previous?.bytes ?? 0, errorCode, checkedAt: Date.now() };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function translationErrorCode(error: Error): string {
  if (error.name === 'AbortError' || /timeout|timed out|abort/i.test(error.message)) return 'ASSET_FEATURES_TIMEOUT';
  if (/too large|size limit|byte limit|maximum.*bytes/i.test(error.message)) return 'ASSET_FEATURES_TOO_LARGE';
  if (/request failed|fetch|network/i.test(error.message)) return 'ASSET_FEATURES_UNAVAILABLE';
  return 'ASSET_FEATURES_INVALID';
}

/** Metadata has its own TTL; shared i18n owns language downloads, refreshes and caching. */
export async function loadAssetFeatures(project: AssetFeatureProject, identities: readonly AssetFeatureIdentity[],
  options: AssetFeatureLoadOptions = {}): Promise<AssetFeatureCollection> {
  const url = assetFeatureUrl(project, options.baseUrl);
  const locale = normalizeAssetFeatureLocale(options.locale ?? i18n.global.locale.value);
  const appLocale = locale.replace(/^([a-z]+)-([a-z]+)$/, (_, language: string, region: string) => `${language}-${region.toUpperCase()}`);
  const key = `${project}:${url}:${locale}`;
  // Synthetic/custom fetchers are isolated unless their caller explicitly asks for caching.
  const useCache = options.cached ?? !options.fetcher;
  const previous = useCache ? snapshots.get(key) : undefined;
  let source: CachedFeatures;
  try {
    if (!isAppLocale(appLocale)) throw new FeatureLoadError('ASSET_FEATURES_INVALID');
    let metadata = useCache ? metadataCache.get(url) : undefined;
    if (!metadata?.raw || options.force || Date.now() - metadata.checkedAt >= CACHE_TTL) {
      if (useCache) {
        let work = metadataPending.get(url);
        if (!work) {
          work = fetchMetadata(project, url, options, metadata);
          metadataPending.set(url, work);
          void work.finally(() => { if (metadataPending.get(url) === work) metadataPending.delete(url); });
        }
        metadata = await work;
        metadataCache.set(url, metadata);
      } else metadata = await fetchMetadata(project, url, options);
    }
    if (!metadata.raw) throw new FeatureLoadError(metadata.errorCode ?? 'ASSET_FEATURES_UNAVAILABLE');
    const raw = metadata.raw;
    let dictionaries: Record<string, unknown> | undefined, locales: string[] | undefined;
    let status = metadata.status, errorCode = metadata.errorCode;
    let readDictionary: ((refresh: boolean) => Promise<void>) | undefined;
    const refreshDictionary = options.force === true || Boolean(previous?.metadataRevision
      && previous.metadataRevision !== metadata.revision);
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).i18nSource === 'project-i18n-v1') {
      const maxBytes = bounded(options.maxBytes, project === 'SoundEffectPlayer' ? 40_000_000 : 70_000_000, 90_000_000);
      if (metadata.bytes >= maxBytes) throw new FeatureLoadError('ASSET_FEATURES_TOO_LARGE');
      locales = [locale];
      readDictionary = async refresh => {
        const { result, dictionary } = await loadOssTranslationDictionary(project, NAMESPACES[project], 'i18n', {
          locale: appLocale as AppLocale, refresh, baseUrl: options.baseUrl,
          fetcher: options.fetcher, timeoutMs: options.timeoutMs, maxBytes: maxBytes - metadata.bytes,
        });
        if (result.status === 'missing') {
          // A missing dictionary removes its public i18n snapshot; descriptions follow it.
          if (useCache) snapshots.delete(key);
          throw new FeatureLoadError('ASSET_FEATURES_DICTIONARY_MISSING');
        }
        status = metadata.status;
        errorCode = metadata.errorCode;
        if (result.status === 'failed') {
          errorCode = translationErrorCode(result.error);
          if (!dictionary) throw new FeatureLoadError(errorCode);
          status = 'stale';
        }
        if (!dictionary) throw new FeatureLoadError('ASSET_FEATURES_INVALID');
        dictionaries = { [locale]: dictionary };
      };
      await readDictionary(refreshDictionary);
    }
    const parse = () => parseAssetFeatureSidecar(raw, { project, dictionaries, requireCompiled: false, locales });
    let parsed: FeatureSidecar;
    try {
      parsed = parse();
    } catch (error) {
      // A dictionary loaded by a name-only consumer may predate this metadata even on
      // the first description load. Retry its shared source once for reference changes.
      if (!readDictionary || refreshDictionary || !(error instanceof Error)
        || !/Dangling feature translation reference|Unowned or oversized feature translation/.test(error.message)) throw error;
      await readDictionary(true);
      parsed = parse();
    }
    // The browser does not use the Worker postings index; release it after validation.
    const sidecar: FeatureSidecar = { schemaVersion: parsed.schemaVersion, project: parsed.project, kind: parsed.kind,
      baseIndexVersion: parsed.baseIndexVersion, resources: parsed.resources, i18n: parsed.i18n };
    source = { status, sidecar, locales, errorCode, metadataRevision: metadata.revision, checkedAt: Date.now() };
    if (useCache) snapshots.set(key, source);
  } catch (error) {
    const missingDictionary = error instanceof FeatureLoadError && error.code === 'ASSET_FEATURES_DICTIONARY_MISSING';
    const errorCode = missingDictionary ? 'ASSET_FEATURES_UNAVAILABLE'
      : error instanceof FeatureLoadError ? error.code : 'ASSET_FEATURES_INVALID';
    // Invalid metadata must remain retryable, just like a failed translation download.
    if (errorCode === 'ASSET_FEATURES_INVALID') metadataCache.delete(url);
    const lastGood = missingDictionary ? undefined : previous;
    source = { status: lastGood?.sidecar ? 'stale' : 'unavailable', sidecar: lastGood?.sidecar,
      metadataRevision: lastGood?.metadataRevision, locales: lastGood?.locales, errorCode, checkedAt: Date.now() };
  }
  if (!source.sidecar) return { status: 'unavailable', errorCode: source.errorCode, checkedAt: source.checkedAt,
    get: () => [], searchText: new Map(), suggestionSearchText: new Map() };
  return buildAssetFeatureCollection(project, source.sidecar, identities, {
    status: source.status === 'unavailable' ? 'stale' : source.status, errorCode: source.errorCode, checkedAt: source.checkedAt,
    locales: source.locales,
  });
}
