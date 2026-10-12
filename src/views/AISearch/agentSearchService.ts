import { loadSystemPrompt, buildSystemPrompt } from "./systemPrompt";
import { modelResponseText } from "./responseDiagnostics";
import type { RequestContext } from "./requestDiagnostics";
import { parseModelJSON } from "../../../tools/ai-search-service/model-json.mjs";
import { selectSuggestedUses } from "../../../tools/ai-search-service/asset-use-summary.mjs";
import { AISearchError, modelConnection, modelResponseEnvelope, completionTokenOptions, responsesToolCompatibilityOptions, fetchConstrainedModel, fetchAISearch, readAISearchJSON, readAISearchHTTPDiagnostic, providerRequestError, parseFeatureSync, parseServerResources, requestServerAssets, requestServerCatalog, requestServerSearchBatch, validateSearchAnswer } from "./aiSearchService";
import { record } from "./resourceCatalog";
import { MAX_SEARCH_RESULTS, normalizeResultLimit, boundedHistoryContent } from "./resultLimits";
import type { AgentSearchPayload, ChatMessage, ModelConfig, SearchAnswer, SearchResource, SearchScope, SearchMatchOn, ServerSearchInput, FeatureSync, SearchProgress } from "./types";
import { recoverResultDisplay } from "./resultDisplay";
import { detectModelOutput, outputThinkingOptions, outputPrompt, OUTPUT_CONSTRAINTS } from "../../../tools/ai-search-service/model-output-policy.mjs";
import type { OutputConstraint } from "../../../tools/ai-search-service/model-output-policy.mjs";

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({ type: "function", function: { name, description,
  parameters: { type: "object", properties, required, additionalProperties: false } } });
const string = { type: "string" };
export const AGENT_SEARCH_TOOLS = [
  tool("search_assets", "Search asset summaries. Rewrite natural requests into search terms; retry with different terms if needed. For pagination set cursor from nextCursor and keep every other argument identical; a rewritten query starts without cursor. Never invent previousCursor. For more alternatives excludePrevious=true omits the prior displayed IDs.", {
    query: { type: "string", maxLength: 2000, description: "For scene or game-use requests, choose 2–4 concise feature terms for the requested evidence: visual effects or matchOn=visual use color, shape, motion and appearance/disappearance; sound effects or an effect's own soundtrack or matchOn=audio use attack, timbre, pitch, rhythm and decay; background music (bgm) use mood, tempo, instrumentation and musical structure. For effect requests with matchOn=any, follow the user's visual or audio intent; do not force visual requests into acoustic terms. both queries contain short behavior/stage terms; feature queries describe sensory properties rather than whole use-case sentences. Known-name lookup may use the exact name. Do not infer audio properties from visual descriptions." }, scope: { type: "string", enum: ["all", "sound", "effect", "bgm"] }, matchOn: { type: "string", enum: ["any", "visual", "audio"], description: "Matching evidence, independent of returned asset type. Use effect+audio for effects whose audio matches." }, limit: { type: "integer", minimum: 1, maximum: MAX_SEARCH_RESULTS },
    cursor: string, excludePrevious: { type: "boolean" }, searchType: { type: "string", enum: ["feature", "suggestion", "both"], description: "feature searches asset names and described features, constrained by matchOn; suggestion searches existing suggested-use entries; both searches both. For sound use-case requests, also search plausible acoustic feature terms with feature; an exact suggested-use label is not required." },
    filters: { type: "object", additionalProperties: false, properties: { minDuration: { type: "number", minimum: 0 }, maxDuration: { type: "number", minimum: 0 },
      hasAudio: { type: "boolean" }, isLoop: { type: "boolean" }, includeTerms: { type: "array", items: string, maxItems: 10 }, excludeTerms: { type: "array", items: string, maxItems: 10 } } },
  }, ["query"]),
  tool("get_assets", "Read details of up to 5 resource IDs already returned by search_assets.", { ids: { type: "array", items: string, minItems: 1, maxItems: 5 } }, ["ids"]),
  tool("get_asset_catalog", "Read catalogue counts, description coverage and version; does not return all assets.", {}),
];
export function buildAgentSearchPayload(query: string, locale: string, scope: SearchScope, history: ChatMessage[], includeEffectAudio: boolean, requestId: string, resultLimit?: number, matchOn: SearchMatchOn = "any"): AgentSearchPayload {
  // The model decides whether a new message refers to an old topic. Do not gate
  // its context on a hand-written list of refinement phrases.
  const turns: ChatMessage[][] = [];
  for (let index = 0; index + 1 < history.length; index++) {
    const user = history[index], assistant = history[index + 1];
    if (user.role === "user" && assistant.role === "assistant") {
      if (user.status === "complete" && assistant.status === "complete" && !user.error && !assistant.error) turns.push([user, assistant]);
      index++;
    }
  }
  const messages = turns.slice(-4).flat().map(message => ({ role: message.role,
    content: boundedHistoryContent(message.content, message.cards, 'Displayed resources in order', message.sections) }));
  const previousIds = turns[turns.length - 1]?.[1].cards.slice(0, MAX_SEARCH_RESULTS).map(card => card.resourceId) ?? [];
  const payload: AgentSearchPayload = { workflow: "agent", requestId, query, locale, scope, ...(matchOn !== "any" ? { matchOn } : {}), includeEffectAudio, messages, previousIds, resultLimit: normalizeResultLimit(resultLimit) };
  while (new TextEncoder().encode(JSON.stringify(payload)).length > 21000 && payload.messages.length > 2) payload.messages.splice(0, 2);
  if (new TextEncoder().encode(JSON.stringify(payload)).length > 21000) throw new AISearchError("PAYLOAD_TOO_LARGE");
  return payload;
}
interface AgentOptions { mode: "free" | "custom"; config: ModelConfig; freeBase: string; signal: AbortSignal; fetcher?: typeof fetch; maxSearchLimit?: number; maxAssetIds?: number; maxPreviousIds?: number; maxExcludeIds?: number; hydrateFinalAssets?: boolean; onProgress?: (progress: SearchProgress) => void }
interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
type ModelMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; _anthropicContent?: unknown[]; _responsesOutput?: unknown[] };
function summary(item: SearchResource, detail = false, query = "") {
  const value: Record<string, unknown> = { resourceId: item.resourceId, kind: item.kind, title: item.title.slice(0, 80), description: item.description.slice(0, detail ? 1200 : 240),
    keywords: item.keywords.slice(0, 6).map(value => value.slice(0, 60)), suggestedUses: selectSuggestedUses(item.suggestedUses, query, 2, 100), duration: item.duration, hasAudio: item.hasAudio,
    audioMatch: item.audioMatch === true, descriptionLocale: item.locale, matchType: item.matchType,
    ...(item.kind === "effect" ? { visualDescription: (item.visualDescription || (!item.audioMatch ? item.description : "")).slice(0, detail ? 1200 : 240),
      audioDescription: (item.audioDescription || "").slice(0, detail ? 1200 : 240), audioKeywords: (item.audioKeywords ?? []).slice(0, 6).map(value => value.slice(0, 60)) } : {}) };
  // Audio/visual fields already contain this exact projection. Repeating it in
  // description wastes later-round input and can force needless truncation.
  if (item.kind === "effect" && value.description === (item.audioMatch ? value.audioDescription : value.visualDescription)) delete value.description;
  return value;
}
const FINAL_OUTPUT_INSTRUCTION = "Tools closed. Return compact JSON with all grounded matches up to resultLimit. Keep useful partial results; never pad unrelated matches. Each reason: one short evidence-to-fit sentence; aim for 20 words or 40 CJK characters, exceeding this only for essential evidence, required labels or important limits. answer: brief overview with a short clarification only if needed. Omit repeated names, IDs and descriptions in prose. Explain each need in sections; do not repeat it in answer. Preserve all section IDs and explanations. Single need: sections:[].";
const ownKeys = (args: Record<string, unknown>, allowed: string[]) => { if (Object.keys(args).some(key => !allowed.includes(key))) throw new AISearchError("TOOL_ARGUMENTS"); };
function searchArgs(args: Record<string, unknown>, payload: AgentSearchPayload): ServerSearchInput & { excludePrevious: boolean } {
  ownKeys(args, ["query", "scope", "matchOn", "limit", "cursor", "excludePrevious", "searchType", "filters"]);
  if (typeof args.query !== "string" || !args.query.trim() || args.query.length > 2000) throw new AISearchError("TOOL_ARGUMENTS");
  const scope = args.scope ?? payload.scope;
  const matchOn = payload.matchOn && payload.matchOn !== "any" ? payload.matchOn : args.matchOn ?? "any";
  if (!["all", "sound", "effect", "bgm"].includes(String(scope)) || payload.scope !== "all" && scope !== payload.scope) throw new AISearchError("TOOL_ARGUMENTS");
  if (!["any", "visual", "audio"].includes(String(matchOn)) || args.matchOn !== undefined && !["any", "visual", "audio"].includes(String(args.matchOn))) throw new AISearchError("TOOL_ARGUMENTS");
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > MAX_SEARCH_RESULTS)
    || args.cursor !== undefined && (typeof args.cursor !== "string" || args.cursor.length > 4096)
    || args.excludePrevious !== undefined && typeof args.excludePrevious !== "boolean"
    || args.searchType !== undefined && !["feature", "suggestion", "both"].includes(String(args.searchType))) throw new AISearchError("TOOL_ARGUMENTS");
  const filters = args.filters === undefined ? {} : record(args.filters);
  if (args.filters !== undefined && (!args.filters || typeof args.filters !== "object" || Array.isArray(args.filters))) throw new AISearchError("TOOL_ARGUMENTS");
  ownKeys(filters, ["minDuration", "maxDuration", "hasAudio", "isLoop", "includeTerms", "excludeTerms"]);
  for (const key of ["minDuration", "maxDuration"]) if (filters[key] !== undefined && (typeof filters[key] !== "number" || !Number.isFinite(filters[key]) || Number(filters[key]) < 0)) throw new AISearchError("TOOL_ARGUMENTS");
  if (filters.minDuration !== undefined && filters.maxDuration !== undefined && Number(filters.minDuration) > Number(filters.maxDuration)) throw new AISearchError("TOOL_ARGUMENTS");
  for (const key of ["hasAudio", "isLoop"]) if (filters[key] !== undefined && typeof filters[key] !== "boolean") throw new AISearchError("TOOL_ARGUMENTS");
  for (const key of ["includeTerms", "excludeTerms"]) if (filters[key] !== undefined && (!Array.isArray(filters[key]) || (filters[key] as unknown[]).length > 10 || (filters[key] as unknown[]).some(value => typeof value !== "string" || value.length > 80))) throw new AISearchError("TOOL_ARGUMENTS");
  const plainMore = /^(?:再[来來](?:[点點些]|一[点點些]|[几幾][个個]|一批)|多[来來](?:[点點些]|一[点點些]|[几幾][个個])|[换換](?:[几幾][个個]|一批|一些)|再找(?:[几幾][个個]|一些|一批)|更多(?:一些|一[点點])?|more|another|some more|a few more|show me more|もっと)[\s。.!！?？]*$/iu.test(payload.query.trim());
  const excludePrevious = args.excludePrevious === true || plainMore;
  return { query: args.query.trim(), locale: payload.locale, scope: scope as SearchScope, matchOn: matchOn as SearchMatchOn, includeEffectAudio: payload.includeEffectAudio,
    limit: args.limit === undefined ? Math.max(15, normalizeResultLimit(payload.resultLimit)) : Number(args.limit), ...(args.cursor === undefined ? {} : { cursor: args.cursor as string }),
    ...(args.searchType === undefined ? {} : { searchType: args.searchType as ServerSearchInput["searchType"] }), filters,
    ...(excludePrevious ? { excludeIds: payload.previousIds } : {}), excludePrevious };
}
function toolJSON(result: unknown): string {
  const data = record(result);
  if (Array.isArray(data.items)) {
    // Keep identities and pagination. Trim prose instead of silently dropping
    // candidate IDs, even for a catalogue with verbose imported descriptions.
    while (new TextEncoder().encode(JSON.stringify(data)).length > 16000) {
      let shortened = false;
      data.items = (data.items as unknown[]).map(value => {
        const item = record(value);
        for (const field of ["description", "visualDescription", "audioDescription"]) {
          if (typeof item[field] === "string" && (item[field] as string).length > 12) { item[field] = (item[field] as string).slice(0, Math.max(12, Math.floor((item[field] as string).length / 2))); shortened = true; }
        }
        if (typeof item.title === "string" && item.title.length > 20) { item.title = item.title.slice(0, Math.max(20, Math.floor(item.title.length / 2))); shortened = true; }
        for (const field of ["suggestedUses", "keywords", "audioKeywords"]) {
          if (!Array.isArray(item[field])) continue;
          const values = item[field] as unknown[];
          const compact = values.slice(0, 1).map(value => typeof value === "string" ? value.slice(0, 8) : value);
          if (!compact.length) { delete item[field]; shortened = true; }
          else if (JSON.stringify(compact) !== JSON.stringify(values)) { item[field] = compact; shortened = true; }
        }
        // A projected description can duplicate a dedicated evidence field.
        // Keep separate visual/audio fields and the suggestion category flag.
        if (item.kind === "effect" && item.description === (item.audioMatch ? item.audioDescription : item.visualDescription) && typeof item.description === "string") {
          delete item.description; shortened = true;
        }
        for (const field of ["description", "visualDescription", "audioDescription"]) if (item[field] === "") { delete item[field]; shortened = true; }
        return item;
      });
      if (!shortened) {
        // At the largest count, discard redundant prose fields while retaining
        // observed audio/visual descriptions and separately tagged use advice.
        for (const value of data.items as unknown[]) {
          const item = record(value);
          const removable = ["descriptionLocale",
            ...(item.kind === "effect" && (item.visualDescription || item.audioDescription) ? ["description"] : []),
            ...(item.description || item.visualDescription ? ["keywords"] : []),
            ...(item.audioDescription ? ["audioKeywords"] : []),
            ...(item.matchType !== "suggestion" ? ["suggestedUses"] : [])];
          for (const field of removable) if (Object.prototype.hasOwnProperty.call(item, field)) { delete item[field]; shortened = true; }
        }
      }
      if (!shortened) throw new AISearchError("PAYLOAD_TOO_LARGE");
    }
  }
  return JSON.stringify(data);
}
function parseFinal(content: unknown, allowed: SearchResource[], resultLimit: number): { answer: SearchAnswer; clarification: boolean } {
  if (typeof content !== "string" || !content.trim()) throw new AISearchError("EMPTY_RESPONSE");
  let parsed;
  try { parsed = parseModelJSON(content); } catch { throw new AISearchError("RESPONSE_FORMAT"); }
  const result = record(parsed);
  const clarification = result.clarification === true;
  if (Object.hasOwn(result, "clarification")) {
    if (typeof result.clarification !== "boolean" || clarification && (!Array.isArray(result.matches) || result.matches.length
      || result.sections !== undefined && (!Array.isArray(result.sections) || result.sections.length))) throw new AISearchError("RESPONSE_FORMAT");
    delete result.clarification;
  }
  if (Object.keys(result).some(key => !["answer", "matches", "sections"].includes(key))) throw new AISearchError("RESPONSE_FORMAT");
  return { answer: validateSearchAnswer(result, allowed, resultLimit), clarification };
}
export async function requestAgentSearch(payload: AgentSearchPayload, options: AgentOptions): Promise<SearchAnswer> {
  const fetcher = options.fetcher ?? fetch;
  const startedAt = Date.now();
  const reportProgress = (progress: SearchProgress) => {
    if (options.signal.aborted) return;
    try { options.onProgress?.({ ...progress, elapsedMs: Date.now() - startedAt }); } catch { /* Progress rendering cannot invalidate a search. */ }
  };
  if (options.mode === "free") {
    const url = `${options.freeBase.replace(/\/$/, "")}/chat`;
    const context: RequestContext = { stage: "site", endpoint: url, startedAt: Date.now() };
    reportProgress({ phase: "waiting" });
    const response = await fetchAISearch(url, { method: "POST", signal: options.signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, context, fetcher);
    if (!response.ok) {
      const diagnostic = await readAISearchHTTPDiagnostic(response, context, options.signal);
      let raw: Record<string, unknown> = {};
      try { raw = await readAISearchJSON(response, context, options.signal); } catch { /* A gateway may return HTML. */ }
      const error = record(raw.error);
      const code = typeof error.code === "string" ? error.code : response.status === 429 ? "QUOTA_EXCEEDED" : "FREE_UNAVAILABLE";
      throw new AISearchError(code, error.reason, error.rawResponse, diagnostic,
        code === "RESPONSE_ASSET_ID" || code === "UPSTREAM_RESPONSE_INVALID" ? recoverResultDisplay(error.rawResponse, []) : undefined);
    }
    const raw = await readAISearchJSON(response, context, options.signal);
    if (typeof raw.catalogVersion !== "string" || !raw.catalogVersion || raw.catalogVersion.length > 200) throw new AISearchError("INVALID_RESPONSE");
    const resources = parseServerResources(raw.resources, payload.locale, new Set(), true);
    let answer: SearchAnswer;
    try { answer = validateSearchAnswer(raw, resources, normalizeResultLimit(payload.resultLimit)); }
    catch (error) {
      if (error instanceof AISearchError && error.code === "RESPONSE_ASSET_ID") throw new AISearchError(error.code, undefined, undefined, undefined, recoverResultDisplay(raw, resources));
      throw error;
    }
    const matched = new Set(answer.matches.map(match => match.resourceId));
    if (resources.length !== matched.size || resources.some(item => !matched.has(item.resourceId))) throw new AISearchError("INVALID_RESPONSE");
    if (resources.some(item => item.audioMatch && (!item.hasAudio || !item.audioDescription && !item.audioKeywords?.length))) throw new AISearchError("INVALID_RESPONSE");
    if (payload.matchOn === "audio" && resources.some(item => item.kind === "effect" && !item.audioMatch)) throw new AISearchError("INVALID_RESPONSE");
    if (payload.matchOn === "visual" && resources.some(item => item.kind !== "effect" || item.audioMatch)) throw new AISearchError("INVALID_RESPONSE");
    if (payload.scope !== "all" && resources.some(item => payload.scope === "sound" ? item.kind !== "sound" && !(payload.includeEffectAudio && item.audioMatch && item.hasAudio) : item.kind !== payload.scope)) throw new AISearchError("INVALID_RESPONSE");
    const quota = record(raw.quota);
    const mode = raw.mode ?? raw.retrievalMode;
    return { ...answer, resources, catalogVersion: raw.catalogVersion, featureSync: parseFeatureSync(raw.featureSync), model: typeof raw.model === "string" ? raw.model : undefined,
      ...(OUTPUT_CONSTRAINTS.includes(raw.outputConstraint as OutputConstraint) ? { outputConstraint: raw.outputConstraint as OutputConstraint } : {}),
      ...(mode === "keyword" || mode === "hybrid" ? { retrievalMode: mode } : {}),
      ...(Number.isInteger(quota.remaining) && Number.isInteger(quota.limit) && typeof quota.resetAt === "string" ? { quota: { remaining: Math.max(0, Number(quota.remaining)), limit: Math.max(0, Number(quota.limit)), resetAt: quota.resetAt } } : {}) };
  }
  if (!options.config.apiKey.trim() || !options.config.model.trim()) throw new AISearchError("CONFIG");
  const { url, protocol } = modelConnection(options.config), hostname = new URL(url).hostname;
  const deepSeek = hostname === "api.deepseek.com";
  let outputPolicy = detectModelOutput({ ...options.config, protocol });
  const systemPrompt = buildSystemPrompt(await loadSystemPrompt(options.signal, fetcher), "agent", normalizeResultLimit(payload.resultLimit));
  const messages: ModelMessage[] = [{ role: "system", content: `${systemPrompt}\n\n${outputPrompt(true)}` }, ...payload.messages,
    { role: "user", content: JSON.stringify({ query: payload.query, locale: payload.locale, scope: payload.scope, matchOn: payload.matchOn ?? "any", includeEffectAudio: payload.includeEffectAudio, previousIds: payload.previousIds, resultLimit: normalizeResultLimit(payload.resultLimit) }) }];
  const known = new Map<string, SearchResource>();
  const fullDetails = new Map<string, SearchResource>();
  const knownQueries = new Map<string, string>();
  const seenToolIds = new Set<string>();
  let version = "", toolCount = 0;
  let actualRetrievalMode: "keyword" | "hybrid" | undefined;
  let featureSync: FeatureSync | undefined;
  let maxSearchLimit = options.maxSearchLimit ?? 30, maxAssetIds = options.maxAssetIds ?? 10;
  let maxPreviousIds = options.maxPreviousIds ?? 5, maxExcludeIds = options.maxExcludeIds ?? 30;
  const assertVersion = (next: string) => { if (version && version !== next) throw new AISearchError("CATALOG_CHANGED"); version = next; };
  const execute = async (call: ToolCall, round: number) => {
    let args: Record<string, unknown>;
    try { const parsed = JSON.parse(call.function.arguments); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); args = parsed; }
    catch { throw new AISearchError("TOOL_ARGUMENTS"); }
    if (call.function.name === "search_assets") {
      const input = searchArgs(args, payload), { excludePrevious, ...request } = input;
      reportProgress({ phase: "searching", round });
      const result = await requestServerSearchBatch(options.freeBase, request, options.signal, fetcher, maxSearchLimit, { maxPreviousIds, maxExcludeIds });
      assertVersion(result.catalogVersion);
      maxSearchLimit = result.maxSearchLimit ?? maxSearchLimit;
      maxAssetIds = result.maxAssetIds ?? maxAssetIds;
      maxPreviousIds = result.maxPreviousIds ?? maxPreviousIds;
      maxExcludeIds = result.maxExcludeIds ?? maxExcludeIds;
      if (result.featureSync) featureSync = result.featureSync;
      actualRetrievalMode = result.mode;
      const excluded = new Set(excludePrevious ? payload.previousIds : []);
      const items = result.items.filter(item => !excluded.has(item.resourceId));
      items.forEach(item => {
        // Full detail is projected for the retrieved visual or audio evidence.
        if (fullDetails.has(item.resourceId) && Boolean(fullDetails.get(item.resourceId)?.audioMatch) !== Boolean(item.audioMatch)) fullDetails.delete(item.resourceId);
        known.set(item.resourceId, item);
        knownQueries.set(item.resourceId, `${knownQueries.get(item.resourceId) || payload.query} ${input.query}`);
      });
      return { catalogVersion: version, mode: result.mode, total: result.total, items: items.map(item => summary(item, false, knownQueries.get(item.resourceId))),
        hasMore: result.hasMore, nextCursor: result.nextCursor, retrievalNotice: result.retrievalNotice,
        ...(excludePrevious ? { omittedPrevious: (result.omittedExcluded ?? 0) + result.items.length - items.length } : {}) };
    }
    if (call.function.name === "get_assets") {
      ownKeys(args, ["ids"]);
      if (!Array.isArray(args.ids) || !args.ids.length || args.ids.length > 5 || new Set(args.ids).size !== args.ids.length || args.ids.some(id => typeof id !== "string" || !known.has(id))) throw new AISearchError("TOOL_ARGUMENTS");
      const ids = args.ids as string[];
      const audioIds = new Set(ids.filter(id => known.get(id)?.audioMatch));
      reportProgress({ phase: "loading_details", round });
      const details = await requestServerAssets(options.freeBase, ids, payload.locale, version, options.signal, audioIds, fetcher, state => { featureSync = state; }, maxAssetIds);
      details.forEach(item => { known.set(item.resourceId, item); fullDetails.set(item.resourceId, item); });
      return { catalogVersion: version, items: details.map(item => summary(item, true, knownQueries.get(item.resourceId) || payload.query)) };
    }
    if (call.function.name === "get_asset_catalog") {
      ownKeys(args, []);
      reportProgress({ phase: "searching", round });
      const result = await requestServerCatalog(options.freeBase, options.signal, fetcher);
      assertVersion(result.catalogVersion);
      maxSearchLimit = result.maxSearchLimit ?? maxSearchLimit;
      maxAssetIds = result.maxAssetIds ?? maxAssetIds;
      maxPreviousIds = result.maxPreviousIds ?? maxPreviousIds;
      maxExcludeIds = result.maxExcludeIds ?? maxExcludeIds;
      if (result.featureSync) featureSync = result.featureSync;
      return result;
    }
    throw new AISearchError("TOOL_ARGUMENTS");
  };
  for (let round = 0; round < 3; round++) {
    if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const finalRound = round === 2 || toolCount >= 4;
    const request = { model: options.config.model.trim(), stream: true, ...completionTokenOptions(url, normalizeResultLimit(payload.resultLimit), protocol), ...responsesToolCompatibilityOptions(url, options.config.model, !finalRound), messages,
      ...outputThinkingOptions(options.config),
      ...(deepSeek ? { thinking: { type: "disabled" } } : {}),
      ...(finalRound ? { tools: AGENT_SEARCH_TOOLS, tool_choice: "none" }
        : { tools: AGENT_SEARCH_TOOLS, tool_choice: "auto" }) };
    const context: RequestContext = { stage: "model", endpoint: url, model: options.config.model.trim(), round: round + 1, startedAt: Date.now() };
    const secrets = [options.config.apiKey.trim()];
    const roundProgress = (progress: SearchProgress) => reportProgress({ ...progress, round: round + 1 });
    roundProgress({ phase: "waiting" });
    const constrained = await fetchConstrainedModel(url, request, outputPolicy, [...known.keys()], normalizeResultLimit(payload.resultLimit),
      context, options.signal, options.config.apiKey.trim(), fetcher, true, roundProgress);
    outputPolicy = constrained.policy;
    const response = constrained.response;
    if (!response.ok) {
      throw await providerRequestError(response, context, secrets, true, options.signal);
    }
    const envelope = await readAISearchJSON(response, context, options.signal, secrets, roundProgress);
    const raw = modelResponseEnvelope(envelope, protocol, response, context, secrets), choice = record(Array.isArray(raw.choices) ? raw.choices[0] : undefined), message = record(choice.message);
    const rawResponse = modelResponseText(message, [options.config.apiKey.trim()]);
    if (choice.finish_reason === "length") throw new AISearchError("OUTPUT_TRUNCATED", undefined, rawResponse);
    if (message.refusal) throw new AISearchError("RESPONSE_FORMAT", undefined, rawResponse);
    const calls = message.tool_calls;
    if (!Array.isArray(calls) || !calls.length) {
      if (choice.finish_reason !== undefined && choice.finish_reason !== null && choice.finish_reason !== "stop") throw new AISearchError("RESPONSE_FORMAT", undefined, rawResponse);
      let parsedFinal: ReturnType<typeof parseFinal>;
      try {
        parsedFinal = parseFinal(message.content, [...known.values()], normalizeResultLimit(payload.resultLimit));
      } catch (error) {
        if (error instanceof AISearchError) throw new AISearchError(error.code, error.reason, rawResponse, undefined,
          error.code === "RESPONSE_ASSET_ID" ? recoverResultDisplay(message.content, [...known.values()], [options.config.apiKey.trim()]) : undefined);
        throw error;
      }
      const { answer, clarification } = parsedFinal;
      if (!toolCount && !clarification) throw new AISearchError("TOOLS_UNSUPPORTED");
      const selected = answer.matches.map(match => fullDetails.get(match.resourceId) ?? known.get(match.resourceId)!);
      const pendingAssetIds = selected.filter(item => !fullDetails.has(item.resourceId)).map(item => item.resourceId);
      if (options.hydrateFinalAssets !== false && pendingAssetIds.length) {
        roundProgress({ phase: "loading_details" });
        const details = await requestServerAssets(options.freeBase, pendingAssetIds, payload.locale, version, options.signal,
          new Set(selected.filter(item => item.audioMatch).map(item => item.resourceId)), fetcher, state => { featureSync = state; }, maxAssetIds);
        details.forEach(item => fullDetails.set(item.resourceId, item));
      }
      return { ...answer, resources: selected.map(item => fullDetails.get(item.resourceId) ?? item),
        ...(options.hydrateFinalAssets === false ? { pendingAssetIds } : {}),
        catalogVersion: version || undefined, featureSync, model: options.config.model, outputConstraint: outputPolicy.mode, retrievalMode: actualRetrievalMode };
    }
    if (choice.finish_reason !== "tool_calls") throw new AISearchError("RESPONSE_FORMAT", undefined, rawResponse);
    if (finalRound || calls.length > 4 - toolCount) throw new AISearchError("AGENT_LIMIT");
    const verified = calls.map(value => {
      const call = record(value), fn = record(call.function);
      if (call.type !== "function" || typeof call.id !== "string" || !call.id || call.id.length > 200 || seenToolIds.has(call.id)
        || typeof fn.name !== "string" || typeof fn.arguments !== "string" || fn.arguments.length > 5000) throw new AISearchError("TOOL_ARGUMENTS");
      seenToolIds.add(call.id);
      return { id: call.id, type: "function" as const, function: { name: fn.name, arguments: fn.arguments } };
    });
    messages.push({ role: "assistant", content: typeof message.content === "string" ? message.content.slice(0, 3000) : null, tool_calls: verified,
      ...(protocol === "openai" && Array.isArray(message._responsesOutput) ? { _responsesOutput: message._responsesOutput } : {}),
      ...(protocol === "anthropic" && Array.isArray(message._anthropicContent) ? { _anthropicContent: message._anthropicContent } : {}) });
    for (const call of verified) {
      toolCount++;
      try { const result = await execute(call, round + 1); messages.push({ role: "tool", tool_call_id: call.id, content: toolJSON(result) }); }
      catch (error) {
        if (options.signal.aborted || error instanceof AISearchError && error.code !== "TOOL_ARGUMENTS") throw error;
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: { code: "TOOL_ARGUMENTS", message: "Invalid tool arguments or an ID not returned by search. Correct the arguments within the remaining tool budget." } }) });
      }
    }
    if (round === 1 || toolCount >= 4) messages.push({ role: "user", content: FINAL_OUTPUT_INSTRUCTION });
  }
  throw new AISearchError("AGENT_LIMIT");
}
