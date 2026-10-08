import { loadSystemPrompt, buildSystemPrompt } from "./systemPrompt";
import { boundedRawResponse, modelResponseText } from "./responseDiagnostics";
import type { ChatMessage, ModelConfig, SearchAnswer, SearchResource, SearchScope, SearchMatchOn, ServerCatalogInfo, ServerSearchInput, ServerSearchResult, ServerChatPayload, FeatureSync } from "./types";
import { record, resourceHref } from "./resourceCatalog";
import { DEFAULT_SEARCH_RESULTS, MAX_SEARCH_RESULTS, normalizeResultLimit, searchOutputTokens, boundedHistoryContent } from "./resultLimits";

const PROVIDER_BALANCE_REASONS = ["MISSING_KEY", "AUTH", "FORBIDDEN", "RATE_LIMIT", "UPSTREAM_ERROR", "TIMEOUT", "NETWORK", "INVALID_RESPONSE", "CNY_MISSING", "ACCOUNT_UNAVAILABLE", "ABORTED"] as const;
export type ProviderBalanceReason = typeof PROVIDER_BALANCE_REASONS[number];
const MODEL_RESPONSE_ERROR_CODES = ["RESPONSE_FORMAT", "RESPONSE_ASSET_ID", "OUTPUT_TRUNCATED", "EMPTY_RESPONSE", "INVALID_RESPONSE", "UPSTREAM_RESPONSE_INVALID"];
export class AISearchError extends Error {
  public readonly reason?: ProviderBalanceReason;
  public readonly rawResponse?: string;
  constructor(public readonly code: string, reason?: unknown, rawResponse?: unknown) {
    super(code);
    // Only retain public diagnostic categories, never provider text or account data.
    if (typeof reason === "string" && PROVIDER_BALANCE_REASONS.includes(reason as ProviderBalanceReason)) this.reason = reason as ProviderBalanceReason;
    if (MODEL_RESPONSE_ERROR_CODES.includes(code)) this.rawResponse = boundedRawResponse(rawResponse);
  }
}
export interface SearchPayload {
  requestId: string; query: string; locale: string; scope: SearchScope;
  matchOn?: SearchMatchOn;
  messages: { role: "user" | "assistant"; content: string }[];
  candidates: { resourceId: string; kind: SearchResource["kind"]; title: string; description: string; keywords: string[]; suggestedUses: string[]; duration?: number; hasAudio?: boolean; audioMatch?: boolean; matchType?: "feature" | "suggestion" }[];
  resultLimit?: number;
}
// Only references and self-contained refinements inherit a previous search. A new
// asset topic keeps its visible chat history, but does not send unrelated turns.
export function isSearchRefinement(query: string): boolean {
  const value = query.trim().replace(/[\s。.!！?？]+$/u, "");
  return [
    /^(?:(?:请|請|麻烦|麻煩|能不能|可以)(?:再|更)?)?(?:更|再|稍微)?(?:短|长|長)(?:一点|一點|一些|些|点|點)?(?:的)?(?:音效|声音|聲音|特效|音乐|音樂)?$/u,
    /^(?:请|請|麻烦|麻煩|能不能|可以)?(?:(?:更|再|稍微)(?:低沉|清脆|尖锐|尖銳|响|響|轻|輕|重|安静|安靜|快|慢|柔和|激昂|舒缓|舒緩)(?:一点|一點|一些|些|点|點)?|(?:低沉|清脆|尖锐|尖銳|响|響|轻|輕|重|安静|安靜|快|慢|柔和|激昂|舒缓|舒緩)(?:一点|一點|一些|些|点|點))(?:的)?(?:音效|声音|聲音|特效|音乐|音樂)?$/u,
    /^(?:再来|再來|再找|换|換)(?:一批|一些|几个|幾個|一点|一點|点|點|些|一组|一組|一个|一個)?(?:同类|同類|类似|類似|相似)?(?:的)?(?:音效|声音|聲音|特效|音乐|音樂|资源|資源|结果|結果)?$/u,
    /^(?:第\s*[一二三四五六七八九十\d]+\s*[个個条條项項]|(?:这|這|那)(?:个|個|些)|上(?:一个|一個|面)(?:的)?|刚才|剛才)/u,
    /^(?:不要|别|別)(?:这么|這麼|那么|那麼)?(?:短|长|長|低沉|清脆|尖锐|尖銳|响|響|重|快|慢|激昂)(?:了|的)?$/u,
    /^(?:(?:a bit|make it|make them)\s+)?(?:shorter|longer|quieter|louder|slower|faster|softer)(?:\s+please)?$/iu,
    /^(?:(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)(?:\s+(?:one|result))?|(?:that|this|those|these|previous)(?:\s+(?:one|ones|results))?)(?:\s|$)/iu,
    /^(?:more|another|different)(?:\s+(?:one|ones|results))?(?:\s+please)?$/iu,
    /^(?:もっと(?:短く|長く)?|短く|長く|もう一度|別の|короче|длиннее|ещ[её])$/iu,
  ].some(pattern => pattern.test(value));
}
function searchTurns(history: ChatMessage[]): { user: ChatMessage; assistant?: ChatMessage }[] {
  const turns: { user: ChatMessage; assistant?: ChatMessage }[] = [];
  for (const message of history) {
    if (message.role === "user") turns.push({ user: message });
    else if (turns.length && !turns[turns.length - 1].assistant) turns[turns.length - 1].assistant = message;
  }
  return turns;
}
export function previousSearchQuery(history: ChatMessage[]): string {
  const turns = searchTurns(history);
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index];
    if (isSearchRefinement(turn.user.content)) continue;
    // A failed new topic still forms a boundary: do not silently revive an older one.
    return turn.user.status === "complete" && !turn.user.error && turn.assistant?.status === "complete" && !turn.assistant.error
      ? turn.user.content.trim().slice(0, 2000) : "";
  }
  return "";
}
export function buildSearchContext(history: ChatMessage[], query: string): ChatMessage[] {
  if (!isSearchRefinement(query)) return [];
  const turns = searchTurns(history);
  let start = turns.length - 1;
  while (start >= 0 && isSearchRefinement(turns[start].user.content)) start--;
  if (start < 0 || !previousSearchQuery(history)) return [];
  const messages = turns.slice(start).flatMap(turn => turn.user.status === "complete" && !turn.user.error
    && turn.assistant?.status === "complete" && !turn.assistant.error ? [turn.user, turn.assistant] : []);
  // Keep the topic pair when bounding a long chain of refinements.
  return messages.length <= 8 ? messages : [...messages.slice(0, 2), ...messages.slice(-6)];
}
function shrinkHistoryContent(content: string): string {
  const marker = content.indexOf("\nPrevious results, in display order:");
  const prose = marker < 0 ? content : content.slice(0, marker);
  if (prose.length <= 100) return content;
  // Displayed ID tables remain whole when reducing an older-model request.
  return prose.slice(0, Math.max(100, Math.floor(prose.length / 2))) + (marker < 0 ? "" : content.slice(marker));
}
export function buildSearchPayload(query: string, locale: string, scope: SearchScope, history: ChatMessage[], candidates: SearchResource[], requestId: string, resultLimit?: number, matchOn: SearchMatchOn = "any"): SearchPayload {
  const payload: SearchPayload = { requestId, query, locale, scope, matchOn, resultLimit: normalizeResultLimit(resultLimit),
    messages: buildSearchContext(history, query).map(message => ({ role: message.role,
      content: boundedHistoryContent(message.content, message.cards, 'Previous results, in display order') })),
    candidates: candidates.slice(0, MAX_SEARCH_RESULTS).map(item => ({ resourceId: item.resourceId, kind: item.kind, title: item.title.slice(0, 200),
      description: (item.matchType === "suggestion" ? `Suggested use (not observed feature): ${item.description}` : item.audioMatch ? item.audioDescription || "" : [item.description && `${item.kind === "sound" ? "Audio" : item.kind === "bgm" ? "Music" : "Visual/general"}: ${item.description}`, item.kind === "effect" && item.audioDescription && `Audio: ${item.audioDescription}`].filter(Boolean).join("\n")).slice(0, 900),
      keywords: item.keywords.slice(0, 10).map(word => word.slice(0, 80)), suggestedUses: item.suggestedUses.slice(0, 3).map(use => use.slice(0, 200)),
      duration: item.duration, hasAudio: item.hasAudio, audioMatch: item.audioMatch === true, matchType: item.matchType,
    })),
  };
  // Bound bytes, rather than characters: CJK characters often occupy three UTF-8 bytes.
  const size = () => new TextEncoder().encode(JSON.stringify(payload)).length;
  while (size() > 21000 && payload.messages.length > 4) payload.messages.splice(2, 2);
  while (size() > 21000 && payload.candidates.some(item => item.description.length > 60)) {
    payload.candidates.forEach(item => { item.description = item.description.slice(0, Math.max(60, Math.floor(item.description.length / 2))); });
  }
  if (size() > 21000) payload.candidates.forEach(item => { item.title = item.title.slice(0, 80); item.keywords = item.keywords.slice(0, 2).map(word => word.slice(0, 40)); item.suggestedUses = item.suggestedUses.slice(0, 1).map(use => use.slice(0, 80)); });
  while (size() > 21000 && payload.messages.some(message => shrinkHistoryContent(message.content) !== message.content)) {
    payload.messages.forEach(message => { message.content = shrinkHistoryContent(message.content); });
  }
  if (size() > 21000) payload.candidates.forEach(item => { item.title = item.title.slice(0, 40); item.keywords = []; item.suggestedUses = []; });
  // Keep enough real candidate IDs for the requested result count. Tighten prose
  // before reducing the pool, and never fill a larger answer with invented IDs.
  if (size() > 21000) payload.candidates.forEach(item => { item.title = item.title.slice(0, 16); item.description = item.description.slice(0, 24); });
  if (size() > 21000) payload.candidates.forEach(item => { item.title = item.title.slice(0, 12); item.description = item.description.slice(0, 12); });
  const minimumCandidates = Math.min(candidates.length, normalizeResultLimit(resultLimit));
  while (size() > 21000 && payload.candidates.length > minimumCandidates) payload.candidates.pop();
  if (size() > 21000) throw new AISearchError("PAYLOAD_TOO_LARGE");
  payload.messages.forEach(message => { message.content = message.content.slice(0, 1900); });
  return payload;
}
export function buildServerChatPayload(payload: SearchPayload, candidates: SearchResource[], catalogVersion: string, includeEffectAudio: boolean): ServerChatPayload {
  const body = { requestId: payload.requestId, query: payload.query, locale: payload.locale, scope: payload.scope, ...(payload.matchOn && payload.matchOn !== "any" ? { matchOn: payload.matchOn } : {}),
    messages: payload.messages.map(message => ({ ...message })), catalogVersion,
    candidateIds: candidates.map(item => item.resourceId), audioCandidateIds: candidates.filter(item => item.audioMatch === true).map(item => item.resourceId), includeEffectAudio, resultLimit: normalizeResultLimit(payload.resultLimit) };
  const size = () => new TextEncoder().encode(JSON.stringify(body)).length;
  while (size() > 21000 && body.messages.length > 4) body.messages.splice(2, 2);
  while (size() > 21000 && body.messages.some(message => shrinkHistoryContent(message.content) !== message.content)) {
    body.messages.forEach(message => { message.content = shrinkHistoryContent(message.content); });
  }
  if (size() > 21000) throw new AISearchError("PAYLOAD_TOO_LARGE");
  return body;
}
export function chatCompletionsUrl(base: string): string {
  let url: URL;
  try { url = new URL(base.trim()); } catch { throw new AISearchError("CONFIG"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) throw new AISearchError("CONFIG");
  if (!url.pathname.replace(/\/$/, "").endsWith("/chat/completions")) url.pathname = `${url.pathname.replace(/\/$/, "")}/chat/completions`;
  return url.href;
}
export function validateSearchAnswer(raw: unknown, candidates: SearchResource[], resultLimit = MAX_SEARCH_RESULTS): SearchAnswer {
  const result = record(raw);
  if (typeof result.answer !== "string" || !result.answer.trim() || result.answer.length > 6000 || !Array.isArray(result.matches) || result.matches.length > Math.min(MAX_SEARCH_RESULTS, resultLimit)) throw new AISearchError("RESPONSE_FORMAT");
  const allowed = new Set(candidates.map(item => item.resourceId));
  const seen = new Set<string>();
  const matches = result.matches.map(rawMatch => {
    const match = record(rawMatch);
    if (typeof match.resourceId !== "string" || !allowed.has(match.resourceId) || seen.has(match.resourceId)) throw new AISearchError("RESPONSE_ASSET_ID");
    if (typeof match.reason !== "string" || match.reason.length > 800 || !["feature", "suggestion"].includes(String(match.matchType))) throw new AISearchError("RESPONSE_FORMAT");
    seen.add(match.resourceId);
    return { resourceId: match.resourceId, reason: match.reason, matchType: match.matchType as "feature" | "suggestion" };
  });
  return { answer: result.answer, matches };
}
async function getJSON(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > 100000) throw new AISearchError("INVALID_RESPONSE");
  try { return JSON.parse(text) as unknown; } catch { throw new AISearchError("INVALID_RESPONSE"); }
}
const clipped = (value: unknown, limit: number) => typeof value === "string" ? value.slice(0, limit) : "";
const strings = (value: unknown, count: number, length: number) => (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string").slice(0, count).map(item => item.slice(0, length));
function coverageRatio(value: unknown, total: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) return value;
  const coverage = record(value);
  const ratio = coverage.description ?? coverage.descriptionRatio ?? coverage.ratio;
  if (typeof ratio === "number" && Number.isFinite(ratio) && ratio >= 0 && ratio <= 1) return ratio;
  const described = coverage.described ?? coverage.withDescription;
  return typeof described === "number" && Number.isFinite(described) && total > 0 ? Math.min(1, Math.max(0, described / total)) : 0;
}
/** Keep only bounded public sync diagnostics from the asset service. */
export function parseFeatureSync(raw: unknown): FeatureSync | undefined {
  if (raw === undefined) return;
  const value = record(raw), hashes = record(value.hashes);
  if (!["ready", "stale", "disabled"].includes(String(value.status)) || !value.hashes || typeof value.hashes !== "object" || Array.isArray(value.hashes)
    || Object.keys(hashes).some(key => key !== "sound" && key !== "effect")) throw new AISearchError("RETRIEVAL_RESPONSE");
  const result: FeatureSync = { status: value.status as FeatureSync["status"], hashes: {} };
  for (const kind of ["sound", "effect"] as const) {
    if (hashes[kind] === undefined) continue;
    if (typeof hashes[kind] !== "string" || !/^[a-f0-9]{64}$/u.test(hashes[kind])) throw new AISearchError("RETRIEVAL_RESPONSE");
    result.hashes[kind] = hashes[kind];
  }
  for (const field of ["checkedAt", "lastGoodAt", "updatedAt"] as const) {
    if (value[field] === undefined) continue;
    if (!Number.isSafeInteger(value[field]) || Number(value[field]) < 0 || Number(value[field]) > 8640000000000000) throw new AISearchError("RETRIEVAL_RESPONSE");
    result[field] = Number(value[field]);
  }
  if (value.errorCode !== undefined) {
    if (typeof value.errorCode !== "string" || !/^[A-Z][A-Z0-9_]{0,79}$/u.test(value.errorCode)) throw new AISearchError("RETRIEVAL_RESPONSE");
    result.errorCode = value.errorCode;
  }
  return result;
}
export function featureHashesChanged(previous: FeatureSync["hashes"], next: FeatureSync["hashes"]): boolean {
  return Object.keys(previous).length > 0 && Object.keys(next).length > 0
    && (["sound", "effect"] as const).some(kind => previous[kind] !== next[kind]);
}
export function parseServerCatalog(raw: unknown): ServerCatalogInfo {
  const data = record(raw);
  const counts = record(data.counts);
  const total = data.total ?? counts.total;
  if (typeof data.catalogVersion !== "string" || !data.catalogVersion || data.catalogVersion.length > 200 || !Number.isInteger(total) || Number(total) < 0 || !["keyword", "hybrid"].includes(String(data.mode))) throw new AISearchError("RETRIEVAL_RESPONSE");
  const limits = record(data.limits);
  const capability = (field: string, fallback: number) => Number.isInteger(limits[field]) && Number(limits[field]) >= 1
    ? Math.min(MAX_SEARCH_RESULTS, Number(limits[field])) : fallback;
  return { catalogVersion: data.catalogVersion, featureSync: parseFeatureSync(data.featureSync), total: Number(total), mode: data.mode as ServerCatalogInfo["mode"], coverage: coverageRatio(data.coverage, Number(total)),
    maxPreviousIds: capability("maxPreviousIds", 5), maxExcludeIds: capability("maxExcludeIds", 30), maxSearchLimit: capability("maxSearchLimit", 30), maxAssetIds: capability("maxAssetIds", 10) };
}
// The server provides descriptions, but routes always derive from the verified numeric identity.
export function parseServerResources(raw: unknown, locale: string, audioIds: Set<string> = new Set(), details = false): SearchResource[] {
  if (!Array.isArray(raw) || raw.length > MAX_SEARCH_RESULTS) throw new AISearchError("RETRIEVAL_RESPONSE");
  const seen = new Set<string>();
  return raw.map(value => {
    const item = record(value);
    const identity = clipped(item.resourceId, 40).match(/^(sound|effect|bgm):(\d{1,12})$/);
    if (!identity || seen.has(identity[0]) || (item.kind !== undefined && item.kind !== identity[1]) || typeof item.title !== "string") throw new AISearchError("RETRIEVAL_RESPONSE");
    seen.add(identity[0]);
    const kind = identity[1] as SearchResource["kind"];
    const audioMatch = kind === "effect" && (item.audioMatch === true || audioIds.has(identity[0]));
    const rawDescription = clipped(item.description, 6000);
    // Detail description is the trusted visual/general field in the legacy
    // endpoint. Audio-projected summary prose must never become visual evidence.
    const visualDescription = kind === "effect" ? clipped(item.visualDescription, 6000) || (details || item.audioMatch !== true ? rawDescription : "") : "";
    const audioDescription = clipped(item.audioDescription, 6000) || (!details && item.audioMatch === true ? rawDescription : "");
    const audioKeywords = strings(item.audioKeywords ?? (!details && item.audioMatch === true ? item.keywords : undefined), 20, 100);
    const audioSuggestedUses = strings(item.audioSuggestedUses ?? (!details && item.audioMatch === true ? item.suggestedUses : undefined), 10, 500);
    const description = audioMatch ? audioDescription : rawDescription;
    const keywords = audioMatch ? audioKeywords : strings(item.keywords, 20, 100);
    const suggestedUses = audioMatch ? audioSuggestedUses : strings(item.suggestedUses, 10, 500);
    return { resourceId: identity[0], id: identity[2], kind, title: item.title.slice(0, 200), description, keywords, suggestedUses,
      locale: clipped(item.descriptionLocale, 20) || locale, featureText: "", audioText: "", suggestionText: "",
      href: resourceHref(kind, identity[2]), audioMatch, audioDescription, audioKeywords, audioSuggestedUses,
      visualDescription, hasAudio: item.hasAudio === true,
      matchType: item.matchType === "suggestion" ? "suggestion" : "feature",
      ...(typeof item.duration === "number" && Number.isFinite(item.duration) && item.duration >= 0 ? { duration: item.duration } : {}),
    };
  });
}
async function serverJSON(base: string, endpoint: string, signal: AbortSignal, body?: unknown, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>> {
  const response = await fetcher(`${base.replace(/\/$/, "")}/${endpoint}`, { signal, cache: "no-store",
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  let data: Record<string, unknown>;
  try { data = record(await getJSON(response)); }
  catch { throw new AISearchError("RETRIEVAL_RESPONSE"); }
  if (!response.ok) {
    const code = record(data.error).code;
    if (endpoint === "assets" && response.status === 413 && code === "DETAILS_TOO_LARGE") throw new AISearchError("DETAILS_TOO_LARGE");
    throw new AISearchError(code === "CATALOG_VERSION_MISMATCH" ? "CATALOG_CHANGED"
      : endpoint === "search" && code === "INVALID_SEARCH" && record(body).matchOn ? "RETRIEVAL_MATCH_ON_UNSUPPORTED" : "RETRIEVAL_FAILED");
  }
  return data;
}
export async function requestServerCatalog(base: string, signal: AbortSignal, fetcher?: typeof fetch): Promise<ServerCatalogInfo> {
  try { return parseServerCatalog(await serverJSON(base, "catalog", signal, undefined, fetcher)); }
  catch (error) { if (error instanceof AISearchError || signal.aborted) throw error; throw new AISearchError("RETRIEVAL_FAILED"); }
}
export async function requestServerSearch(base: string, input: ServerSearchInput, signal: AbortSignal, fetcher?: typeof fetch): Promise<ServerSearchResult> {
  try {
    const { matchOn, ...request } = input;
    const limit = Math.min(MAX_SEARCH_RESULTS, Math.max(1, input.limit ?? DEFAULT_SEARCH_RESULTS));
    if (!Number.isInteger(limit)) throw new AISearchError("RETRIEVAL_RESPONSE");
    const raw = await serverJSON(base, "search", signal, { ...request, ...(matchOn && matchOn !== "any" ? { matchOn } : {}), limit }, fetcher);
    const info = parseServerCatalog(raw);
    if (typeof raw.hasMore !== "boolean" || (raw.hasMore && (typeof raw.nextCursor !== "string" || raw.nextCursor.length > 4096))) throw new AISearchError("RETRIEVAL_RESPONSE");
    const items = parseServerResources(raw.items, input.locale);
    if (items.length > limit) throw new AISearchError("RETRIEVAL_RESPONSE");
    if (input.scope === "sound" && items.some(item => item.kind !== "sound" && !(input.includeEffectAudio && item.kind === "effect" && item.hasAudio && item.audioMatch))) throw new AISearchError("RETRIEVAL_RESPONSE");
    if ((input.scope === "effect" || input.scope === "bgm") && items.some(item => item.kind !== input.scope)) throw new AISearchError("RETRIEVAL_RESPONSE");
    if (items.some(item => item.audioMatch && (!item.hasAudio || !item.audioDescription && !item.audioKeywords?.length))) throw new AISearchError("RETRIEVAL_RESPONSE");
    if (input.matchOn === "audio" && items.some(item => item.kind === "effect" && !item.audioMatch)) throw new AISearchError("RETRIEVAL_RESPONSE");
    if (input.matchOn === "visual" && items.some(item => item.kind !== "effect" || item.audioMatch)) throw new AISearchError("RETRIEVAL_RESPONSE");
    const notice = record(raw.retrievalNotice);
    return { ...info, items, hasMore: raw.hasMore, nextCursor: typeof raw.nextCursor === "string" ? raw.nextCursor : undefined,
      ...(notice.code === "MUSIC_DESCRIPTION_MISSING" || notice.code === "EFFECT_AUDIO_DESCRIPTION_MISSING" ? { retrievalNotice: { code: notice.code } } : {}) };
  } catch (error) { if (error instanceof AISearchError || signal.aborted) throw error; throw new AISearchError("RETRIEVAL_FAILED"); }
}
/** One evidence search may read multiple compatible HTTP pages without another model call. */
export async function requestServerSearchBatch(base: string, input: ServerSearchInput, signal: AbortSignal, fetcher?: typeof fetch, serviceLimit = 30,
  capabilities: { maxPreviousIds?: number; maxExcludeIds?: number } = {}): Promise<ServerSearchResult> {
  const wanted = Math.min(MAX_SEARCH_RESULTS, Math.max(1, input.limit ?? DEFAULT_SEARCH_RESULTS));
  const pageLimit = Number.isInteger(serviceLimit) && serviceLimit >= 1 ? Math.min(MAX_SEARCH_RESULTS, serviceLimit) : 30;
  const idLimit = (value: number | undefined, fallback: number) => Number.isInteger(value) && Number(value) >= 1 ? Math.min(MAX_SEARCH_RESULTS, Number(value)) : fallback;
  for (const values of [input.previousIds, input.excludeIds]) {
    if (values !== undefined && (!Array.isArray(values) || values.length > MAX_SEARCH_RESULTS || values.some(id => typeof id !== "string" || !/^(sound|effect|bgm):\d{1,12}$/.test(id)))) throw new AISearchError("RETRIEVAL_RESPONSE");
  }
  const excluded = new Set(input.excludeIds ?? []);
  // The old service understands only a prefix of the exclusion list. Keep the
  // complete list locally, and freeze the wire filters across cursor pages.
  const request = { ...input,
    ...(input.previousIds === undefined ? {} : { previousIds: input.previousIds.slice(0, idLimit(capabilities.maxPreviousIds, 5)) }),
    ...(input.excludeIds === undefined ? {} : { excludeIds: input.excludeIds.slice(0, idLimit(capabilities.maxExcludeIds, 30)) }) };
  let result: ServerSearchResult | undefined;
  const items: SearchResource[] = [];
  const ids = new Set<string>(), cursors = new Set<string>();
  let omittedExcluded = 0;
  let cursor = input.cursor;
  // Even a one-item page may first contain every locally excluded resource.
  // Unique IDs and a nonempty page ensure this bounded scan makes progress.
  for (let page = 0; page < wanted + excluded.size && items.length < wanted; page++) {
    const next = await requestServerSearch(base, { ...request, limit: Math.min(pageLimit, wanted - items.length), ...(cursor ? { cursor } : {}) }, signal, fetcher);
    if (result && result.catalogVersion !== next.catalogVersion) throw new AISearchError("CATALOG_CHANGED");
    if (!next.items.length && next.hasMore) throw new AISearchError("RETRIEVAL_RESPONSE");
    for (const item of next.items) {
      if (ids.has(item.resourceId)) throw new AISearchError("RETRIEVAL_RESPONSE");
      ids.add(item.resourceId);
      if (excluded.has(item.resourceId)) omittedExcluded++;
      else items.push(item);
    }
    result = next;
    if (!next.hasMore || items.length >= wanted) break;
    if (!next.nextCursor || cursors.has(next.nextCursor)) throw new AISearchError("RETRIEVAL_RESPONSE");
    cursors.add(next.nextCursor); cursor = next.nextCursor;
  }
  if (!result) throw new AISearchError("RETRIEVAL_RESPONSE");
  return { ...result, items, ...(omittedExcluded ? { omittedExcluded } : {}) };
}
export async function requestServerAssets(base: string, ids: string[], locale: string, catalogVersion: string, signal: AbortSignal, audioIds = new Set<string>(), fetcher?: typeof fetch, onFeatureSync?: (state: FeatureSync) => void, serviceLimit = 10): Promise<SearchResource[]> {
  if (!ids.length) return [];
  if (ids.length > MAX_SEARCH_RESULTS || new Set(ids).size !== ids.length || ids.some(id => !/^(sound|effect|bgm):\d{1,12}$/.test(id))) throw new AISearchError("ASSET_DETAILS");
  const read = async (requested: string[]) => {
    const raw = await serverJSON(base, "assets", signal, { ids: requested, locale }, fetcher);
    if (raw.catalogVersion !== catalogVersion) throw new AISearchError("CATALOG_CHANGED");
    if (raw.missingIds !== undefined && (!Array.isArray(raw.missingIds) || raw.missingIds.length)) throw new AISearchError("ASSET_DETAILS");
    const items = parseServerResources(raw.items, locale, audioIds, true);
    const allowed = new Set(requested);
    if (items.length !== allowed.size || items.some(item => !allowed.has(item.resourceId))) throw new AISearchError("ASSET_DETAILS");
    const sync = parseFeatureSync(raw.featureSync);
    if (sync) onFeatureSync?.(sync);
    return requested.map(id => items.find(item => item.resourceId === id)!);
  };
  try {
    try {
      const items: SearchResource[] = [];
      // Honour advertised capabilities; old deployments accept ten IDs per batch.
      const batchLimit = Number.isInteger(serviceLimit) && serviceLimit >= 1 ? Math.min(MAX_SEARCH_RESULTS, serviceLimit) : 10;
      for (let offset = 0; offset < ids.length; offset += batchLimit) items.push(...await read(ids.slice(offset, offset + batchLimit)));
      return items;
    }
    catch (error) {
      if (!(error instanceof AISearchError) || error.code !== "DETAILS_TOO_LARGE" || ids.length === 1 || signal.aborted) throw error;
      // Only a known response-size limit can split a detail read; chat is never retried.
      const items: SearchResource[] = [];
      for (let offset = 0; offset < ids.length; offset += 3) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        const batch = await Promise.all(ids.slice(offset, offset + 3).map(id => read([id])));
        items.push(...batch.flat());
      }
      return items;
    }
  } catch (error) { if (error instanceof AISearchError && error.code === "CATALOG_CHANGED" || signal.aborted) throw error; throw new AISearchError("ASSET_DETAILS"); }
}
export async function requestSearch(payload: SearchPayload, candidates: SearchResource[], options: { mode: "free" | "custom"; config: ModelConfig; freeBase: string; signal: AbortSignal; fetcher?: typeof fetch; server?: { catalogVersion: string; includeEffectAudio: boolean } }): Promise<SearchAnswer> {
  const fetcher = options.fetcher ?? fetch;
  const custom = options.mode === "custom";
  if (custom && (!options.config.apiKey.trim() || !options.config.model.trim())) throw new AISearchError("CONFIG");
  const url = custom ? chatCompletionsUrl(options.config.baseUrl) : `${options.freeBase.replace(/\/$/, "")}/chat`;
  const hostname = custom ? new URL(url).hostname : "";
  const deepSeek = hostname === "api.deepseek.com";
  const jsonSupported = deepSeek || ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"].includes(hostname) || hostname.endsWith(".maas.aliyuncs.com");
  const systemPrompt = custom ? buildSystemPrompt(await loadSystemPrompt(options.signal, fetcher), "candidates", normalizeResultLimit(payload.resultLimit)) : "";
  if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
  const response = await fetcher(url, { method: "POST", signal: options.signal,
    headers: custom ? { "Content-Type": "application/json", Authorization: `Bearer ${options.config.apiKey.trim()}` } : { "Content-Type": "application/json" },
    body: JSON.stringify(custom ? { model: options.config.model.trim(), stream: false, max_tokens: searchOutputTokens(normalizeResultLimit(payload.resultLimit)),
      ...(jsonSupported ? { response_format: { type: "json_object" } } : {}),
      ...(deepSeek ? { thinking: { type: "disabled" } } : {}),
      messages: [{ role: "system", content: systemPrompt }, ...payload.messages, { role: "user", content: JSON.stringify({ query: payload.query, locale: payload.locale, scope: payload.scope, matchOn: payload.matchOn ?? "any", resultLimit: normalizeResultLimit(payload.resultLimit), candidates: payload.candidates }) }] } : options.server
      ? buildServerChatPayload(payload, candidates, options.server.catalogVersion, options.server.includeEffectAudio) : payload),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new AISearchError("AUTH");
    if (response.status === 429) throw new AISearchError("QUOTA_EXCEEDED");
    if (!custom) {
      const error = record(record(await getJSON(response)).error);
      throw new AISearchError(typeof error.code === "string" ? error.code : "FREE_UNAVAILABLE", error.reason, error.rawResponse);
    }
    if (response.status === 400 || response.status === 404 || response.status === 422) throw new AISearchError("MODEL_REQUEST_REJECTED");
    throw new AISearchError("NETWORK");
  }
  const raw = record(await getJSON(response));
  let answer: SearchAnswer;
  if (custom) {
    if (!Array.isArray(raw.choices) || !raw.choices.length) throw new AISearchError("RESPONSE_FORMAT");
    const choice = record(Array.isArray(raw.choices) ? raw.choices[0] : undefined);
    if (!choice.message || typeof choice.message !== "object" || Array.isArray(choice.message)) throw new AISearchError("RESPONSE_FORMAT");
    const message = record(choice.message);
    const content = message.content;
    const rawResponse = modelResponseText(message, [options.config.apiKey.trim()]);
    if (choice.finish_reason === "length") throw new AISearchError("OUTPUT_TRUNCATED", undefined, rawResponse);
    // Some compatible gateways omit finish_reason. A complete, validated JSON
    // answer is still required; tool calls, refusals and known truncation fail.
    if ((choice.finish_reason !== undefined && choice.finish_reason !== null && choice.finish_reason !== "stop")
      || message.refusal || (Array.isArray(message.tool_calls) && message.tool_calls.length)) throw new AISearchError("RESPONSE_FORMAT", undefined, rawResponse);
    if (content === undefined || content === null || typeof content === "string" && !content.trim()) throw new AISearchError("EMPTY_RESPONSE");
    if (typeof content !== "string") throw new AISearchError("RESPONSE_FORMAT", undefined, rawResponse);
    let parsed: unknown;
    try { parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); } catch { throw new AISearchError("RESPONSE_FORMAT", undefined, rawResponse); }
    const transmittedIds = new Set(payload.candidates.map(item => item.resourceId));
    try {
      answer = validateSearchAnswer(parsed, candidates.filter(item => transmittedIds.has(item.resourceId)), normalizeResultLimit(payload.resultLimit));
    } catch (error) {
      if (error instanceof AISearchError) throw new AISearchError(error.code, error.reason, rawResponse);
      throw error;
    }
    answer.model = options.config.model;
  } else {
    answer = validateSearchAnswer(raw, candidates, normalizeResultLimit(payload.resultLimit));
    answer.featureSync = parseFeatureSync(raw.featureSync);
    if (raw.catalogVersion !== undefined) {
      if (typeof raw.catalogVersion !== "string" || !raw.catalogVersion || raw.catalogVersion.length > 200) throw new AISearchError("INVALID_RESPONSE");
      answer.catalogVersion = raw.catalogVersion;
    }
    if (options.server) {
      if (raw.catalogVersion !== options.server.catalogVersion) throw new AISearchError("CATALOG_CHANGED");
      const matchedIds = new Set(answer.matches.map(match => match.resourceId));
      const audioIds = new Set(candidates.filter(item => item.audioMatch).map(item => item.resourceId));
      answer.resources = parseServerResources(raw.resources, payload.locale, audioIds, true);
      if (answer.resources.length !== matchedIds.size || answer.resources.some(item => !matchedIds.has(item.resourceId))) throw new AISearchError("INVALID_RESPONSE");
      answer.catalogVersion = raw.catalogVersion as string;
    }
    answer.model = typeof raw.model === "string" ? raw.model : undefined;
    const quota = record(raw.quota);
    if (Number.isInteger(quota.remaining) && Number.isInteger(quota.limit) && typeof quota.resetAt === "string") answer.quota = {
      remaining: Math.max(0, Number(quota.remaining)), limit: Math.max(0, Number(quota.limit)), resetAt: quota.resetAt,
    };
  }
  return answer;
}
