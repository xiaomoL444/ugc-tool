import { parseAssetFeatureSidecar, normalizeAssetFeatureResources, computeLexicalFeatureHash } from "../../../tools/ai-search-service/asset-features.mjs";
import { OSS_BASE_URL } from "../../utils/oss";
import { assetFeatureUrl } from "../../utils/assetFeatures";
import { supportedLocales } from "../../i18n/preferences";
import type { ResourceKind, SearchResource, SearchScope, SearchMatchOn } from "./types";

type Row = Record<string, unknown>;
export interface CatalogSource { kind: ResourceKind; project: string; namespace: string; data: Row; dictionaries: Record<string, Record<string, string>>; features?: ReturnType<typeof parseAssetFeatureSidecar> }
export interface CatalogSnapshot { sources: CatalogSource[]; failures: string[]; featureFailures?: string[]; featureHashes?: { sound?: string; effect?: string } }
const sourceDefinitions = [
  { kind: "sound" as const, project: "SoundEffectPlayer", namespace: "soundEffectPlayer" },
  { kind: "effect" as const, project: "EffectPlayer", namespace: "effectPlayer" },
  { kind: "bgm" as const, project: "BgmPlayer", namespace: "bgmPlayer" },
];
export function record(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
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
      source.kind === "bgm" ? Promise.resolve(undefined) : get(`${assetFeatureUrl(source.project as "SoundEffectPlayer" | "EffectPlayer", base)}?_t=${Date.now()}`),
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
    if (source.kind !== "bgm") {
      try {
        if (feature.status !== "fulfilled") throw new Error("FEATURES_MISSING");
        const data = record(index.value);
        const rows = source.kind === "effect" ? Object.values(record(data.effectData)) : Array.isArray(data.data) ? data.data : [];
        const identities = rows.map(raw => ({ id: String(record(raw).id ?? ""), resourceId: `${source.kind}:${String(record(raw).id ?? "")}`, kind: source.kind, titles: {}, hasAudio: record(raw).hasAudio === true }));
        features = parseAssetFeatureSidecar(feature.value, { project: source.project, kind: source.kind, identities, dictionaries, requireCompiled: false });
        featureHashes[source.kind] = await computeLexicalFeatureHash(features);
      } catch { featureFailures.push(source.project); }
    }
    return { ...source, data: record(index.value), dictionaries, features };
  }));
  const sources: CatalogSource[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") sources.push(result.value);
    else failures.push(sourceDefinitions[index].project);
  });
  return { sources, failures, featureFailures, featureHashes };
}
export function resourceHref(kind: ResourceKind, id: string): string {
  if (!/^\d{1,12}$/.test(id)) throw new Error("INVALID_ASSET_ID");
  const project = sourceDefinitions.find(source => source.kind === kind)?.project;
  if (!project) throw new Error("INVALID_ASSET_KIND");
  return `/${project}?id=${encodeURIComponent(id)}`;
}
function splitTerms(value: string): string[] { return [...new Set(value.split(/[\n,，;；|、]+/).map(text => text.trim()).filter(Boolean))]; }
export function buildSearchResources(snapshot: CatalogSnapshot, locale: string): SearchResource[] {
  const output: SearchResource[] = [];
  for (const source of snapshot.sources) {
    const sourceResources: SearchResource[] = [];
    const current = source.dictionaries[locale] ?? {};
    const texts = (key: string) => Object.values(source.dictionaries).map(dict => dict[key]).filter(Boolean);
    const read = (row: Row, field: string, fallback = "") => {
      // Sound/effect data and its original dictionaries provide identity only.
      if (source.kind !== "bgm") return "";
      const key = string(row[`${field}I18nKey`]);
      return key ? current[key] ?? "" : string(row[field]) || fallback;
    };
    const all = (row: Row, field: string) => {
      if (source.kind !== "bgm") return [];
      const key = string(row[`${field}I18nKey`]);
      return key ? texts(key) : [string(row[field])].filter(Boolean);
    };
    const rows = source.kind === "effect" ? Object.values(record(source.data.effectData))
      : Array.isArray(source.data.data) ? source.data.data : Array.isArray(source.data.musicData) ? source.data.musicData : [];
    for (const raw of rows) {
      const row = record(raw);
      const id = typeof row.id === "number" && Number.isSafeInteger(row.id) ? String(row.id) : string(row.id);
      if (!/^\d{1,12}$/.test(id)) continue;
      const defaultKey = `${source.namespace}.data.${id}`;
      let nameKey = string(row.nameI18nKey) || defaultKey;
      if (source.kind === "effect") {
        nameKey = (string(row.nameI18nKey) || [row.title, row.name].map(string).find(value => value.startsWith("effectPlayer.")) || defaultKey)
          .replace(/^effectPlayer\.names\./, "effectPlayer.data.");
      }
      const title = current[nameKey] || nameKey;
      const names = [id, ...texts(nameKey), ...[row.sourceName, row.sourceTitle, row.name, row.title].map(string).filter(value => value && !value.startsWith(`${source.namespace}.`))];
      const tags = Array.isArray(row.tagList) ? row.tagList.flatMap(tag => texts(`${source.namespace}.tags.${tag}`)) : [];
      const categories = Array.isArray(source.data.category) ? source.data.category.map(record) : [];
      const category = categories.find(item => String(item.id) === String(row.category));
      const categoryTexts = category ? texts(string(category.nameI18nKey)) : [];
      const albumTexts = texts(string(row.albumI18nKey) || `${source.namespace}.album.${row.album_id}`);
      const visualDescription = [read(row, "visualShortDescription"), read(row, "visualDescription"), read(row, "mainDescription"), read(row, "tailDescription")].filter(Boolean).join("\n");
      const audioDescription = [read(row, "audioShortDescription"), read(row, "audioDescription"), read(row, "audioDetailedDescription")].filter(Boolean).join("\n");
      const audioKeywords = splitTerms(read(row, "audioKeywords"));
      const audioSuggestedUses = splitTerms(read(row, "audioSuggestedUses"));
      const genericDescription = [read(row, "shortDescription"), read(row, "description"), read(row, "detailedDescription")].filter(Boolean).join("\n");
      const description = visualDescription || genericDescription;
      const keywords = splitTerms([read(row, "keywords"), read(row, "visualKeywords")].filter(Boolean).join("、"));
      const suggestedUses = splitTerms(read(row, "suggestedUses"));
      const features = ["shortDescription", "description", "detailedDescription", "keywords", "visualShortDescription", "visualDescription", "visualKeywords", "mainDescription", "tailDescription"].flatMap(field => all(row, field));
      const audio = ["audioShortDescription", "audioDescription", "audioDetailedDescription", "audioKeywords"].flatMap(field => all(row, field));
      const suggestions = ["suggestedUses", "audioSuggestedUses", "visualSuggestedUses"].flatMap(field => all(row, field));
      const duration = source.kind === "bgm" && typeof row.minute === "number" && typeof row.second === "number"
        ? row.minute * 60 + row.second : Number(row.duration);
      const hasAudio = source.kind === "sound" ? true : source.kind === "effect"
        ? row.hasAudio === true && !!string(row.audioPath) ? true : row.hasAudio === false ? false : undefined : undefined;
      sourceResources.push({ resourceId: `${source.kind}:${id}`, id, kind: source.kind, locale, title, description, keywords, suggestedUses,
        duration: Number.isFinite(duration) && duration >= 0 ? duration : undefined, hasAudio,
        href: resourceHref(source.kind, id), visualDescription, audioDescription, audioKeywords, audioSuggestedUses,
        featureText: normalizeSearchText([...names, ...tags, ...categoryTexts, ...albumTexts, ...features].join(" ")),
        // A visual effect's name is not evidence of what its audio sounds like.
        audioText: normalizeSearchText([...(source.kind === "effect" ? [id] : names), ...audio].join(" ")),
        suggestionText: normalizeSearchText(suggestions.join(" ")),
        audioSuggestionText: normalizeSearchText(all(row, "audioSuggestedUses").join(" ")),
      });
    }
    if (!source.features) { output.push(...sourceResources); continue; }
    const identities = sourceResources.map(item => ({ resourceId: item.resourceId, id: item.id, kind: item.kind,
      titles: { [locale]: item.title }, hasAudio: item.hasAudio === true, facetTexts: { feature: item.featureText } }));
    const enriched = new Map(normalizeAssetFeatureResources(source.features, identities).map(item => [String(item.id), item]));
    const localizedText = (value: unknown) => string(record(value)[locale]);
    const localizedList = (value: unknown) => {
      const list = record(value)[locale];
      return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
    };
    for (const item of sourceResources) {
      const feature = record(enriched.get(item.id)), audio = record(feature.audio), facets = record(feature.facetTexts);
      const description = [localizedText(feature.description), localizedText(feature.detailedDescription)].filter(Boolean).join("\n");
      const audioDescription = [localizedText(audio.description), localizedText(audio.detailedDescription)].filter(Boolean).join("\n");
      output.push({ ...item, description, keywords: localizedList(feature.keywords), suggestedUses: localizedList(feature.suggestedUses),
        visualDescription: source.kind === "effect" ? description : "", audioDescription,
        audioKeywords: localizedList(audio.keywords), audioSuggestedUses: localizedList(audio.suggestedUses),
        featureText: normalizeSearchText(string(facets.feature)),
        audioText: normalizeSearchText(source.kind === "sound" ? string(facets.feature) : [item.id, string(facets.audio)].join(" ")),
        suggestionText: normalizeSearchText(string(facets.suggestion)), audioSuggestionText: normalizeSearchText(string(facets.audioSuggestion)) });
    }
  }
  return output;
}
export function normalizeSearchText(value: string): string { return value.normalize("NFKC").toLowerCase().replace(/[_\-]/g, " ").replace(/受到攻[击擊]|受擊|挨打/gu, "受击"); }
const aliases: [RegExp, string][] = [
  [/thunder|雷声|雷聲|гром|雷鳴/giu, " 雷 雷声 thunder "], [/engine|引擎|发动机|發動機|двигател|エンジン/giu, " 引擎 engine "],
  [/wind|风声|風聲|ветер|風音/giu, " 风 風 wind "], [/water|水流|流水|река|вод|川/giu, " 水 河流 water "],
  [/blue|蓝色|藍色|син|青色/giu, " 蓝 藍 blue "], [/smoke|烟雾|煙霧|дым|煙/giu, " 烟 煙 smoke "],
  [/button|按钮|按鈕|кноп|ボタン/giu, " 按钮 按鈕 button "], [/fire|火焰|плам|炎/giu, " 火 fire "],
  [/\b(?:hit|impact|hurt)\b|被弾/giu, " 受击 hit impact hurt "],
];
function queryTerms(query: string): string[] {
  let expanded = normalizeSearchText(query).replace(/(?:帮我|幫我|找一下|寻找|尋找|找个|找一|有没有|有沒有|搜索|音效|特效|声音|聲音|资源|資源|please|find|sounds?|effects?|找|的)/giu, " ");
  for (const [pattern, extra] of aliases) if (pattern.test(query)) { pattern.lastIndex = 0; expanded += extra; } else pattern.lastIndex = 0;
  const words = expanded.match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = words.flatMap(word => /[\u3400-\u9fff]/u.test(word) && word.length > 2
    ? [word, ...Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))] : [word]);
  return [...new Set(terms.filter(term => term.length > 1 || /[\u3400-\u9fff]/u.test(term)))].slice(0, 80);
}
export interface SearchIntent { scope: SearchScope; matchOn: SearchMatchOn; filters?: { hasAudio: true } }
export function resolveSearchIntent(query: string, selected: SearchScope, previous: SearchResource[] = [], previousQuery = ""): SearchIntent {
  const text = normalizeSearchText(query);
  const music = /音乐|音樂|配乐|配樂|\bbgm\b|\bmusic\b|音楽|музык/u.test(text);
  const sound = /音效|音频|音頻|背景音|声(?!波)|聲(?!波)|\bsounds?\b|\bsfx\b|\baudio\b|効果音|音声|зву[кч]/u.test(text.replace(/背景音[乐樂]/gu, ""));
  const visualText = text.replace(/\bsound effects?\b|звуков\p{L}*\s+эффект\p{L}*/gu, "");
  const effect = /特效|视觉|視覺|\b(?:visual|effects?|vfx|particles?)\b|エフェクト|эффект/u.test(visualText);
  const intent = (scope: SearchScope, matchOn: SearchMatchOn): SearchIntent => {
    const returnedScope = selected === "all" ? scope : selected;
    return { scope: returnedScope, matchOn, ...(returnedScope === "effect" && matchOn === "audio" ? { filters: { hasAudio: true as const } } : {}) };
  };
  if (music && !sound && !effect) return intent("bgm", "any");
  if (!music && sound && !effect) return intent("sound", "audio");
  if (!music && effect && !sound) return intent("effect", "visual");
  if (!music && sound && effect) {
    // Containment asks for the effect that owns the track. Accompaniment and
    // coordination do not establish that a track comes from an effect asset.
    const accompaniment = /(?:与|與|和|给|給|为|為)特效.{0,16}(?:搭配|配合|配套).{0,16}(?:音效|声音|聲音)|(?:音效|声音|聲音).{0,16}(?:搭配|配合).{0,16}特效/u.test(text);
    if (accompaniment) return intent("sound", "audio");
    const coordinated = /(?:音效|声音|聲音).{0,8}(?:和|与|與|及|、|and).{0,8}特效|特效.{0,8}(?:和|与|與|及|、|and).{0,8}(?:音效|声音|聲音)/u.test(text);
    const effectAudio = !coordinated && /特效(?:中|里|裡|内|內|的).{0,60}(?:音效|声音|聲音|音频|音頻)|(?:带有|帶有|带|帶|有|包含|含有).{0,60}(?:音效|声音|聲音|音频|音頻).{0,12}特效|(?:sound|audio).{0,20}\b(?:from|in|of)\b.{0,20}(?:effects?|vfx)|(?:effects?|vfx).{0,20}\b(?:with|containing|has|have)\b.{0,30}(?:sounds?|audio)/u.test(text);
    if (effectAudio) return intent("effect", "audio");
  }
  if (music || sound || effect) return intent("all", "any");
  // Only refinements inherit the previous results; a fresh topic searches all assets.
  if (previous.length && /更|再|换|換|这|這|那|上|第|more|another|previous|shorter|longer|change|first|second|third|fourth|fifth|ещ|короче|длиннее|もっと|短く|長く/u.test(text)) {
    if (previousQuery) {
      const prior = resolveSearchIntent(previousQuery, selected);
      if (prior.scope !== "all") return prior;
    }
    if (selected === "sound") return intent("sound", "audio");
    if (previous.every(item => item.kind === "effect")) return intent("effect", previous.some(item => item.audioMatch) ? "audio" : "visual");
    if (previous.every(item => item.kind === "sound" || item.audioMatch)) return intent("sound", "audio");
    if (previous.every(item => item.kind === "bgm")) return intent("bgm", "any");
  }
  return intent("all", selected === "sound" ? "audio" : "any");
}
export function resolveSearchScope(query: string, selected: SearchScope, previous: SearchResource[] = []): SearchScope {
  return resolveSearchIntent(query, selected, previous).scope;
}
export interface RetrievalOptions { scope: SearchScope; matchOn?: SearchMatchOn; searchType?: "feature" | "suggestion" | "both"; includeEffectAudio: boolean; limit?: number; previous?: SearchResource[]; previousQuery?: string; excludeIds?: string[]; query: string }
export function retrieveResources(resources: SearchResource[], options: RetrievalOptions): SearchResource[] {
  const more = /^(?:再[来來](?:[点點些]|一[点點些]|[几幾][个個]|一批)|多[来來](?:[点點些]|一[点點些]|[几幾][个個])|[换換](?:[几幾][个個]|一批|一些)|再找(?:[几幾][个個]|一些|一批)|更多(?:一些|一[点點])?|more|another|some more|a few more|show me more|もっと)[\s。.!！?？]*$/iu.test(options.query.trim());
  const searchQuery = more ? options.previousQuery?.trim() || (options.previous ?? []).map(item => item.title).join(" ") || options.query : options.query;
  const intent = resolveSearchIntent(searchQuery, options.scope, options.previous, options.previousQuery);
  const scope = intent.scope;
  const matchOn = options.matchOn ?? intent.matchOn;
  if (matchOn === "visual" && scope !== "all" && scope !== "effect") return [];
  const excluded = new Set(options.excludeIds ?? (more ? (options.previous ?? []).map(item => item.resourceId) : []));
  const eligible = resources.filter(item => !excluded.has(item.resourceId) && (scope === "all" || item.kind === scope
    || scope === "sound" && options.includeEffectAudio && item.kind === "effect" && item.hasAudio === true)
    && (matchOn !== "audio" || item.kind !== "effect" || item.hasAudio === true && !!(item.audioDescription || item.audioKeywords?.length
      || item.audioText.trim() && item.audioText.trim() !== normalizeSearchText(item.id)))
    && (matchOn !== "visual" || item.kind === "effect"));
  const eligibleIds = new Set(eligible.map(item => item.resourceId));
  const previous = (options.previous ?? []).filter(item => eligibleIds.has(item.resourceId));
  const projectPrevious = (item: SearchResource): SearchResource => item.kind === "effect" && (matchOn === "audio" || scope === "sound" || matchOn === "any" && item.audioMatch)
    ? { ...item, visualDescription: item.visualDescription || (!item.audioMatch ? item.description : ""), audioMatch: true, description: item.audioDescription || "", keywords: item.audioKeywords ?? [], suggestedUses: item.audioSuggestedUses ?? [] }
    : { ...item, audioMatch: false };
  const query = normalizeSearchText(options.query);
  const durationFilter = /尾音|余响|混响|tail|decay/u.test(query) ? "" : /更短|短一点|短一點|shorter|короче|短く/u.test(query) ? "short" : /更长|更長|longer|длиннее|長く/u.test(query) ? "long" : "";
  const englishOrdinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth'];
  const ordinal = query.match(/第\s*([一二三四五六七八九十]+|\d+)\s*[个個条條项項]?|(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)/u);
  if (ordinal && previous.length) {
    const digits = '零一二三四五六七八九';
    const chinese = ordinal[1]?.split('十');
    const number = ordinal[1] ? /^\d+$/.test(ordinal[1]) ? Number(ordinal[1])
      : chinese?.length === 2 ? (chinese[0] ? digits.indexOf(chinese[0]) : 1) * 10 + (chinese[1] ? digits.indexOf(chinese[1]) : 0)
      : digits.indexOf(ordinal[1]) : englishOrdinals.indexOf(ordinal[2]) + 1;
    if (number > 0 && number <= previous.length) return [projectPrevious(previous[number - 1])];
  }
  if (durationFilter && previous.length) return previous.filter(item => item.duration !== undefined).sort((a, b) => durationFilter === "short"
    ? a.duration! - b.duration! : b.duration! - a.duration!).slice(0, options.limit ?? 12).map(projectPrevious);
  const normalizedSearchQuery = normalizeSearchText(searchQuery);
  const terms = queryTerms(normalizedSearchQuery);
  if (!terms.length) return [];
  const ranked = eligible.map(item => {
    const audioMatch = item.kind === "effect" && (scope === "sound" || matchOn === "audio");
    const text = audioMatch ? item.audioText : matchOn === "any" && item.hasAudio ? `${item.featureText} ${item.audioText}` : item.featureText;
    const featureScore = options.searchType === "suggestion" ? 0 : terms.reduce((sum, term) => sum + (text.includes(term) ? term.length > 2 ? 3 : 1 : 0), 0);
    const suggestionText = audioMatch ? item.audioSuggestionText || "" : item.suggestionText;
    const useScore = options.searchType === "feature" || matchOn === "audio" && options.searchType !== "suggestion" && options.searchType !== "both"
      ? 0 : terms.reduce((sum, term) => sum + (suggestionText.includes(term) ? .5 : 0), 0);
    const exact = normalizedSearchQuery.trim() === item.id || normalizedSearchQuery.trim() === item.resourceId || !audioMatch && normalizeSearchText(item.title) === normalizedSearchQuery.trim() ? 1000 : 0;
    const matchType = featureScore || exact ? "feature" as const : "suggestion" as const;
    return { score: exact + featureScore + useScore, item: { ...item, visualDescription: item.kind === "effect" ? item.visualDescription || (!item.audioMatch ? item.description : "") : item.visualDescription, audioMatch, matchType,
      description: audioMatch ? item.audioDescription || "" : item.description,
      keywords: audioMatch ? item.audioKeywords ?? [] : item.keywords,
      suggestedUses: audioMatch ? item.audioSuggestedUses ?? [] : item.suggestedUses } };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || (scope === "sound" ? Number(a.item.kind !== "sound") - Number(b.item.kind !== "sound") : 0)
    || a.item.resourceId.localeCompare(b.item.resourceId));
  if (scope !== "all") return ranked.slice(0, options.limit ?? 12).map(item => item.item);
  // Interleave equal-score kinds so the ID prefix cannot fill every candidate slot.
  const balanced: typeof ranked = [];
  for (let start = 0; start < ranked.length;) {
    let end = start + 1;
    while (end < ranked.length && ranked[end].score === ranked[start].score) end++;
    const group = ranked.slice(start, end);
    const buckets = ["sound", "effect", "bgm"].map(kind => group.filter(result => result.item.kind === kind));
    for (let index = 0; index < Math.max(...buckets.map(bucket => bucket.length)); index++) {
      for (const bucket of buckets) if (bucket[index]) balanced.push(bucket[index]);
    }
    start = end;
  }
  return balanced.slice(0, options.limit ?? 12).map(item => item.item);
}
