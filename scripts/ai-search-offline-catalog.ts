// Complete multilingual snapshots for offline catalogue regression checks.
// Browser pages use the Worker catalogue API and the shared i18n loader instead.
import { parseAssetFeatureSidecar, computeLexicalFeatureHash } from "../tools/ai-search-service/asset-features.mjs";
import { OSS_BASE_URL, createOss } from "../src/utils/oss";
import { supportedLocales } from "../src/i18n/preferences";
import { record, sourceDefinitions } from "../src/views/AISearch/resourceCatalog";
import type { CatalogSnapshot, CatalogSource } from "../src/views/AISearch/resourceCatalog";

const string = (value: unknown) => typeof value === "string" ? value : "";
function dictionary(raw: unknown, namespace: string): Record<string, string> {
  const input = record(raw);
  const wrapped = record(input.translations);
  return Object.fromEntries(Object.entries(Object.keys(wrapped).length ? wrapped : input)
    .filter(([key, value]) => typeof value === "string" && !key.split(".").some(part => ["__proto__", "constructor", "prototype"].includes(part)))
    .map(([key, value]) => [key.startsWith(`${namespace}.`) ? key : `${namespace}.${key}`, value as string]));
}
export async function loadResourceCatalog(fetcher: typeof fetch = fetch, base = OSS_BASE_URL): Promise<CatalogSnapshot> {
  const get = async (url: string, maxLength = 40000000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetcher(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("CATALOG_HTTP");
      const raw = await response.text();
      if (raw.length > maxLength) throw new Error("CATALOG_TOO_LARGE");
      return JSON.parse(raw) as unknown;
    } finally { clearTimeout(timer); }
  };
  const failures: string[] = [];
  const featureFailures: string[] = [];
  const featureHashes: NonNullable<CatalogSnapshot["featureHashes"]> = {};
  const settled = await Promise.allSettled(sourceDefinitions.map(async (source) => {
    const root = `${base.replace(/\/$/, "")}/${source.project}`;
    const [index, feature, ...translations] = await Promise.allSettled([
      get(`${root}/data.json?_t=${Date.now()}`),
      get(`${createOss(source.project, base).path('features.json')}?_t=${Date.now()}`),
      ...supportedLocales.map(({ value }) => get(`${root}/i18n/${value.toLowerCase()}.json?_t=${Date.now()}`)),
    ]);
    if (index.status !== "fulfilled" || !Object.keys(record(index.value)).length) throw new Error(source.project);
    const dictionaries: CatalogSource["dictionaries"] = {};
    translations.forEach((result, index) => {
      const locale = supportedLocales[index].value;
      if (result.status === "fulfilled") dictionaries[locale] = dictionary(result.value, source.namespace);
      else failures.push(`${source.project}/${locale}`);
    });
    let features: CatalogSource["features"];
    try {
      if (feature.status !== "fulfilled") throw new Error("FEATURES_MISSING");
      const data = record(index.value);
      const rows = source.kind === "effect" ? Object.values(record(data.effectData)) : Array.isArray(data.data) ? data.data : Array.isArray(data.musicData) ? data.musicData : [];
      const identities = rows.map(raw => ({ id: String(record(raw).id ?? ""), resourceId: `${source.kind}:${String(record(raw).id ?? "")}`, kind: source.kind, titles: {}, hasAudio: source.kind !== "effect" || record(raw).hasAudio === true && !!string(record(raw).audioPath) }));
      features = parseAssetFeatureSidecar(feature.value, { project: source.project, kind: source.kind, identities, dictionaries, requireCompiled: false });
      featureHashes[source.kind] = await computeLexicalFeatureHash(features);
    } catch { featureFailures.push(source.project); }
    return { ...source, data: record(index.value), dictionaries, features };
  }));
  const sources: CatalogSource[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") sources.push(result.value);
    else failures.push(sourceDefinitions[index].project);
  });
  return { sources, failures, featureFailures, featureHashes };
}
