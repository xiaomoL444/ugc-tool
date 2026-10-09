import { parseAssetFeatureSidecar, FEATURE_LOCALES } from '../../tools/ai-search-service/asset-features.mjs';
import type { FeatureSidecar } from '../../tools/ai-search-service/asset-features.mjs';
import { OSS_BASE_URL, createOss } from './oss';

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
  /** Observed descriptions and keywords in all five languages, without guessed sources. */
  searchText: ReadonlyMap<string, string>;
  /** Use suggestions are kept separate from observed properties. */
  suggestionSearchText: ReadonlyMap<string, string>;
}
export interface AssetFeatureLoadOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
  cached?: boolean;
  force?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

const CACHE_TTL = 60_000;
const cache = new Map<string, CachedFeatures>();
const pending = new Map<string, Promise<CachedFeatures>>();
interface CachedFeatures {
  status: AssetFeatureCollection['status'];
  sidecar?: FeatureSidecar;
  errorCode?: string;
  checkedAt: number;
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
    dictionaries?: Record<string, unknown> } = {}): AssetFeatureCollection {
  const sidecar = parseAssetFeatureSidecar(raw, { project, dictionaries: state.dictionaries, requireCompiled: false });
  const known = new Map<string, AssetFeatureIdentity>();
  for (const identity of identities) {
    const id = String(identity.id);
    if (/^\d{1,12}$/.test(id)) known.set(id, { ...identity });
  }
  const resolve = (id: string, locale: string): AssetFeatureDescription[] => {
    const identity = known.get(id), normalizedLocale = normalizeAssetFeatureLocale(locale);
    if (!identity || !normalizedLocale) return [];
    const dictionary = sidecar.i18n[normalizedLocale];
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

async function fetchFeatures(project: AssetFeatureProject, url: string, options: AssetFeatureLoadOptions,
  previous?: CachedFeatures): Promise<CachedFeatures> {
  const controller = new AbortController();
  const bounded = (value: number | undefined, fallback: number, limit: number) =>
    value !== undefined && Number.isFinite(value) ? Math.min(limit, Math.max(1, value)) : fallback;
  const timeoutMs = bounded(options.timeoutMs, 10_000, 60_000);
  const maxBytes = bounded(options.maxBytes, project === 'SoundEffectPlayer' ? 40_000_000 : 70_000_000, 90_000_000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const budget = { used: 0 };
    const json = async (path: string): Promise<unknown> => {
      const response = await (options.fetcher || fetch)(`${path}${path.includes('?') ? '&' : '?'}_t=${Date.now()}`, {
        cache: 'no-store', credentials: 'omit', signal: controller.signal,
      });
      if (!response.ok) throw new FeatureLoadError('ASSET_FEATURES_UNAVAILABLE');
      const type = response.headers.get('Content-Type') || '';
      if (type && !/application\/(?:[\w.+-]+\+)?json(?:;|$)/i.test(type)) {
        await response.body?.cancel().catch(() => undefined);
        throw new FeatureLoadError('ASSET_FEATURES_INVALID');
      }
      return JSON.parse((await readBody(response, maxBytes, controller.signal, budget)).replace(/^\uFEFF/, '')) as unknown;
    };
    const work = async () => {
      const raw = await json(url);
      let dictionaries: Record<string, unknown> | undefined;
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).i18nSource === 'project-i18n-v1') {
        const oss = createOss(project, options.baseUrl);
        const locales = await Promise.all(FEATURE_LOCALES.map(async locale =>
          [locale, await json(oss.path('i18n', `${locale}.json`))] as const));
        dictionaries = Object.fromEntries(locales);
      }
      const parsed = parseAssetFeatureSidecar(raw, { project, dictionaries, requireCompiled: false });
      // The browser does not use the Worker postings index; release it after validation.
      const sidecar: FeatureSidecar = { schemaVersion: parsed.schemaVersion, project: parsed.project, kind: parsed.kind,
        baseIndexVersion: parsed.baseIndexVersion, resources: parsed.resources, i18n: parsed.i18n };
      return sidecar;
    };
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new FeatureLoadError('ASSET_FEATURES_TIMEOUT')); }, timeoutMs);
    });
    const sidecar = await Promise.race([work(), timedOut]);
    return { status: 'ready', sidecar, checkedAt: Date.now() };
  } catch (error) {
    controller.abort();
    const errorCode = error instanceof FeatureLoadError ? error.code : 'ASSET_FEATURES_INVALID';
    return { status: previous?.sidecar ? 'stale' : 'unavailable', sidecar: previous?.sidecar, errorCode, checkedAt: Date.now() };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A per-project, 60-second parsed cache shared by asset player pages. Failures never replace last-good data. */
export async function loadAssetFeatures(project: AssetFeatureProject, identities: readonly AssetFeatureIdentity[],
  options: AssetFeatureLoadOptions = {}): Promise<AssetFeatureCollection> {
  const url = assetFeatureUrl(project, options.baseUrl), key = `${project}:${url}`;
  // Synthetic/custom fetchers are isolated unless their caller explicitly asks for caching.
  const useCache = options.cached ?? !options.fetcher;
  let source = useCache ? cache.get(key) : undefined;
  if (!source || options.force || Date.now() - source.checkedAt >= CACHE_TTL) {
    if (useCache) {
      let work = pending.get(key);
      if (!work) {
        work = fetchFeatures(project, url, options, source);
        pending.set(key, work);
        void work.finally(() => { if (pending.get(key) === work) pending.delete(key); });
      }
      source = await work;
      cache.set(key, source);
    } else source = await fetchFeatures(project, url, options);
  }
  if (!source.sidecar) return { status: 'unavailable', errorCode: source.errorCode, checkedAt: source.checkedAt,
    get: () => [], searchText: new Map(), suggestionSearchText: new Map() };
  return buildAssetFeatureCollection(project, source.sidecar, identities, {
    status: source.status === 'unavailable' ? 'stale' : source.status, errorCode: source.errorCode, checkedAt: source.checkedAt,
  });
}
