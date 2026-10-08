import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { StorageClass } from "../../services/storage/storage";
import { useI18n } from "vue-i18n";
import { buildSearchResources, loadResourceCatalog, record, resourceHref, resolveSearchScope, resolveSearchIntent, retrieveResources } from "./resourceCatalog";
import type { CatalogSnapshot } from "./resourceCatalog";
import { AISearchError, featureHashesChanged, buildSearchContext, buildSearchPayload, chatCompletionsUrl, previousSearchQuery, requestSearch, requestServerCatalog, requestServerSearchBatch, requestServerAssets } from "./aiSearchService";
import { buildAgentSearchPayload, requestAgentSearch } from "./agentSearchService";
import { AISearchArchiveRepository } from "./archiveStorage";
import { boundedRawResponse } from "./responseDiagnostics";
import { DEFAULT_SEARCH_RESULTS, MAX_SEARCH_RESULTS, normalizeResultLimit } from "./resultLimits";
import type { ChatMessage, Conversation, FreeQuota, ModelConfig, ResourceCard, SearchMode, SearchScope, SearchResource, ServerCatalogInfo, RetrievalMode, FeatureSync } from "./types";

const HISTORY_KEY = "ugc-tools.ai-search.history.v1";
const CONFIG_KEY = "ugc-tools.ai-search.model.v1";
const SESSION_KEY = "ugc-tools.ai-search.session-key.v1";
const FREE_BASE = process.env.VUE_APP_AI_SEARCH_API_BASE || "/api/ai-search";
const DEFAULT_MIN_BALANCE_CNY = 20;
const uid = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const text = (value: unknown, max = 4000) => typeof value === "string" ? value.slice(0, max) : "";

export { previousSearchQuery } from "./aiSearchService";

export function restoreConversations(raw: unknown): Conversation[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 30).flatMap(value => {
    const source = record(value);
    if (typeof source.id !== "string" || !Array.isArray(source.messages)) return [];
    const messages: ChatMessage[] = source.messages.slice(-100).flatMap(value => {
      const item = record(value);
      if (!["user", "assistant"].includes(String(item.role))) return [];
      const cards: ResourceCard[] = (Array.isArray(item.cards) ? item.cards : []).slice(0, MAX_SEARCH_RESULTS).flatMap(rawCard => {
        const card = record(rawCard);
        const match = text(card.resourceId, 40).match(/^(sound|effect|bgm):(\d{1,12})$/);
        if (!match) return [];
        const kind = match[1] as ResourceCard["kind"];
        return [{ resourceId: match[0], id: match[2], kind, title: text(card.title, 200), description: text(card.description, 1600),
          keywords: (Array.isArray(card.keywords) ? card.keywords : []).map(value => text(value, 80)).filter(Boolean).slice(0, 10),
          suggestedUses: (Array.isArray(card.suggestedUses) ? card.suggestedUses : []).map(value => text(value, 200)).filter(Boolean).slice(0, 3),
          href: resourceHref(kind, match[2]), matchReason: text(card.matchReason, 800), audioMatch: card.audioMatch === true,
          ...(typeof card.hasAudio === "boolean" ? { hasAudio: card.hasAudio } : {}),
          matchType: card.matchType === "suggestion" ? "suggestion" as const : "feature" as const,
          ...(typeof card.duration === "number" && Number.isFinite(card.duration) && card.duration >= 0 ? { duration: card.duration } : {}),
        }];
      });
      const mode: SearchMode = item.mode === "free" || item.mode === "custom" ? item.mode : "basic";
      const status = item.status === "complete" ? "complete" : item.status === "error" ? "error" : "canceled";
      const rawResponse = item.role === "assistant" && status === "error" ? boundedRawResponse(item.rawResponse) : undefined;
      return [{ id: text(item.id, 100) || uid(), role: item.role as ChatMessage["role"], content: text(item.content), cards, status,
        mode, source: mode, model: text(item.model, 100), error: status === "error", ...(rawResponse ? { rawResponse } : {}) }];
    });
    const contextStart = Number.isInteger(source.contextStart) ? Math.min(messages.length, Math.max(0, Number(source.contextStart) - Math.max(0, source.messages.length - 100))) : 0;
    return [{ id: source.id.slice(0, 100), title: text(source.title, 80), updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : Date.now(), messages, contextStart }];
  });
}
function readSavedConfig(): ModelConfig {
  const defaults: ModelConfig = { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-flash", apiKey: "", rememberKey: false };
  try {
    const saved = record(JSON.parse(localStorage.getItem(CONFIG_KEY) || "null"));
    return { baseUrl: text(saved.baseUrl, 500) || defaults.baseUrl, model: text(saved.model, 100) || defaults.model,
      rememberKey: saved.rememberKey === true, apiKey: saved.rememberKey === true ? text(saved.apiKey, 500) : sessionStorage.getItem(SESSION_KEY) || "" };
  } catch { return defaults; }
}
export function useAISearch() {
  const { t, locale } = useI18n({ useScope: "global" });
  const storage = inject<StorageClass>("storage");
  const archive = storage ? new AISearchArchiveRepository(storage) : undefined;
  const conversations = ref<Conversation[]>([]);
  const activeConversationId = ref("");
  const messages = computed(() => conversations.value.find(item => item.id === activeConversationId.value)?.messages ?? []);
  const mode = ref<SearchMode>("free");
  const resultLimit = ref(DEFAULT_SEARCH_RESULTS);
  const freeResultLimit = ref(5);
  const freePreviousIdLimit = ref(5);
  const scope = ref<SearchScope>("all");
  const includeEffectAudio = ref(true);
  const modelConfig = ref<ModelConfig>(readSavedConfig());
  const busy = ref(false);
  const loadingCatalog = ref(true);
  const loadingArchive = ref(true);
  const archiveError = ref("");
  const catalogError = ref(false);
  const errorMessage = ref("");
  const snapshot = shallowRef<CatalogSnapshot>({ sources: [], failures: [] });
  const resources = computed(() => buildSearchResources(snapshot.value, locale.value));
  const serverRetrieval = ref(false);
  const serverAgent = ref(false);
  const serverCatalog = shallowRef<ServerCatalogInfo | null>(null);
  const retrievalMode = ref<RetrievalMode>("local");
  const catalogErrorMessage = ref("");
  const featureSync = shallowRef<FeatureSync>();
  const featuresUpdated = ref(false);
  const featureMissing = ref(false);
  const retryQuery = ref("");
  const retryConversationId = ref("");
  const canRetrySearch = computed(() => !!retryQuery.value && retryConversationId.value === activeConversationId.value);
  let observedHashes: FeatureSync["hashes"] = {};
  function observeFeatureSync(state?: FeatureSync) {
    if (!state) return;
    if (featureHashesChanged(observedHashes, state.hashes)) featuresUpdated.value = true;
    if (Object.keys(state.hashes).length) observedHashes = { ...state.hashes };
    featureSync.value = state;
  }
  const catalogCount = computed(() => serverRetrieval.value ? serverCatalog.value?.total ?? 0 : resources.value.length);
  const descriptionCoverage = computed(() => serverRetrieval.value ? serverCatalog.value?.coverage ?? 0 : resources.value.length ? resources.value.filter(item => item.description || item.audioDescription).length / resources.value.length : 0);
  const freeAvailable = ref(false);
  const freeModel = ref("");
  const freeStatus = ref<"checking" | "available" | "unconfigured" | "unavailable">("checking");
  const freeQuota = ref<FreeQuota | null>(null);
  const freeError = ref("");
  const freeMinBalanceCny = ref(DEFAULT_MIN_BALANCE_CNY);
  let currentRun: { controller: AbortController; message: ChatMessage; timedOut: boolean } | undefined;
  let catalogGeneration = 0;
  let freeGeneration = 0;
  let destroyed = false;
  let archiveWritable = false;

  function addConversation() {
    stop();
    const conversation: Conversation = { id: uid(), title: t("aiSearch.newConversationDefault"), updatedAt: Date.now(), messages: [], contextStart: 0 };
    conversations.value.unshift(conversation);
    conversations.value = conversations.value.slice(0, 30);
    activeConversationId.value = conversation.id;
    errorMessage.value = "";
    return conversation.id;
  }
  function createConversation() { return loadingArchive.value ? "" : addConversation(); }
  function selectConversation(id: string) { if (!loadingArchive.value && conversations.value.some(item => item.id === id)) { stop(); activeConversationId.value = id; errorMessage.value = ""; } }
  function renameConversation(id: string, title: string) { if (loadingArchive.value) return; const item = conversations.value.find(item => item.id === id); if (item && title.trim()) item.title = title.trim().slice(0, 80); }
  function deleteConversation(id: string) {
    if (loadingArchive.value) return;
    if (id === activeConversationId.value) stop();
    conversations.value = conversations.value.filter(item => item.id !== id);
    if (id === activeConversationId.value) activeConversationId.value = conversations.value[0]?.id || "";
    if (!conversations.value.length) createConversation();
  }
  function clearContext() {
    if (loadingArchive.value) return;
    stop();
    const conversation = conversations.value.find(item => item.id === activeConversationId.value);
    if (!conversation) return;
    conversation.messages.push({ id: uid(), role: "assistant", content: t("aiSearch.contextCleared"), cards: [], status: "complete", mode: "basic", source: "basic" });
    conversation.contextStart = conversation.messages.length;
  }
  function stop() {
    if (!currentRun) return;
    const run = currentRun;
    currentRun = undefined;
    run.controller.abort();
    run.message.status = "canceled";
    run.message.content = t("aiSearch.canceled");
    busy.value = false;
  }
  function saveConfig(config: ModelConfig): boolean {
    try { chatCompletionsUrl(config.baseUrl); } catch { errorMessage.value = t("aiSearch.errors.config"); return false; }
    if (!config.model.trim() || config.model.length > 100 || !config.apiKey.trim()) { errorMessage.value = t("aiSearch.errors.config"); return false; }
    modelConfig.value = { baseUrl: config.baseUrl.trim(), model: config.model.trim(), apiKey: config.apiKey.trim(), rememberKey: config.rememberKey };
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify({ baseUrl: modelConfig.value.baseUrl, model: modelConfig.value.model, rememberKey: config.rememberKey,
        ...(config.rememberKey ? { apiKey: modelConfig.value.apiKey } : {}) }));
      if (config.rememberKey) sessionStorage.removeItem(SESSION_KEY);
      else sessionStorage.setItem(SESSION_KEY, modelConfig.value.apiKey);
    } catch { /* The in-memory configuration remains usable. */ }
    mode.value = "custom";
    errorMessage.value = "";
    return true;
  }
  async function restoreArchive() {
    try {
      if (!archive) throw new Error("Archive provider is unavailable");
      const saved = await archive.read();
      if (destroyed) return;
      let legacy: string | null = null;
      if (saved) {
        conversations.value = restoreConversations(saved.conversations);
        activeConversationId.value = conversations.value.some(item => item.id === saved.activeConversationId) ? saved.activeConversationId : conversations.value[0]?.id || "";
        mode.value = saved.selectedMode;
        resultLimit.value = normalizeResultLimit(saved.resultLimit);
      } else {
        try { legacy = localStorage.getItem(HISTORY_KEY); } catch { /* The archive does not depend on localStorage access. */ }
        if (legacy !== null) {
          if (legacy.length > 2500000) throw new Error("Legacy history is too large");
          const parsed: unknown = JSON.parse(legacy);
          if (!Array.isArray(parsed)) throw new Error("Invalid legacy history");
          conversations.value = restoreConversations(parsed);
          activeConversationId.value = conversations.value[0]?.id || "";
        }
      }
      if (!activeConversationId.value) addConversation();
      if (legacy !== null) {
        // Keep the old source until the new provider confirms the write.
        await archive.write({ conversations: conversations.value, activeConversationId: activeConversationId.value, selectedMode: mode.value, resultLimit: resultLimit.value });
        try { if (localStorage.getItem(HISTORY_KEY) === legacy) localStorage.removeItem(HISTORY_KEY); } catch { /* A leftover migration source is harmless. */ }
      }
      if (!destroyed) archiveWritable = true;
    } catch {
      // A failed read must never be mistaken for an empty save and overwritten.
      archiveError.value = t("aiSearch.errors.archiveRead");
      if (!activeConversationId.value) addConversation();
    } finally { loadingArchive.value = false; }
  }
  function saveArchive() {
    if (destroyed || loadingArchive.value || !archiveWritable || !archive) return;
    void archive.write({ conversations: conversations.value, activeConversationId: activeConversationId.value, selectedMode: mode.value, resultLimit: resultLimit.value })
      .then(() => { if (!destroyed) archiveError.value = ""; })
      .catch(() => { if (!destroyed) archiveError.value = t("aiSearch.errors.storage"); });
  }
  async function reloadCatalog() {
    const generation = ++catalogGeneration;
    loadingCatalog.value = true;
    try {
      if (serverRetrieval.value) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const loaded = await requestServerCatalog(FREE_BASE, controller.signal);
          if (generation !== catalogGeneration || destroyed) return;
          serverCatalog.value = loaded;
          observeFeatureSync(loaded.featureSync);
          featureMissing.value = false;
          retrievalMode.value = loaded.mode;
          catalogError.value = false;
          catalogErrorMessage.value = "";
        } finally { clearTimeout(timer); }
      } else {
        const loaded = await loadResourceCatalog();
        if (generation !== catalogGeneration || destroyed) return;
        snapshot.value = loaded;
        featureMissing.value = !!loaded.featureFailures?.length;
        observeFeatureSync({ status: "ready", hashes: loaded.featureHashes ?? {} });
        retrievalMode.value = "local";
        catalogError.value = loaded.failures.length > 0;
        catalogErrorMessage.value = catalogError.value ? t("aiSearch.catalogError") : "";
      }
    } catch (error) { if (generation === catalogGeneration && !destroyed) { catalogError.value = true; catalogErrorMessage.value = serverRetrieval.value ? t("aiSearch.errors.retrieval") : explainError(error); } }
    finally { if (generation === catalogGeneration && !destroyed) loadingCatalog.value = false; }
  }
  async function refreshFreeStatus() {
    const generation = ++freeGeneration;
    freeStatus.value = "checking";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${FREE_BASE.replace(/\/$/, "")}/config`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("FREE_UNAVAILABLE");
      const raw = record(await response.json());
      if (typeof raw.configured !== "boolean" || typeof raw.available !== "boolean") throw new Error("FREE_UNAVAILABLE");
      if (generation !== freeGeneration || destroyed) return;
      const retrieval = record(raw.retrieval);
      const nextServerRetrieval = retrieval.available === true;
      const retrievalChanged = serverRetrieval.value !== nextServerRetrieval;
      serverRetrieval.value = nextServerRetrieval;
      serverAgent.value = record(raw.agent).available === true;
      const limits = record(raw.limits);
      freeMinBalanceCny.value = typeof limits.minBalanceCny === "number" && Number.isFinite(limits.minBalanceCny) && limits.minBalanceCny > 0
        ? limits.minBalanceCny : DEFAULT_MIN_BALANCE_CNY;
      freeResultLimit.value = Number.isInteger(limits.maxResults) && Number(limits.maxResults) >= 5
        ? Math.min(MAX_SEARCH_RESULTS, Number(limits.maxResults)) : 5;
      freePreviousIdLimit.value = Number.isInteger(limits.maxPreviousIds) && Number(limits.maxPreviousIds) >= 5
        ? Math.min(MAX_SEARCH_RESULTS, Number(limits.maxPreviousIds)) : 5;
      if (retrievalChanged && !loadingCatalog.value) void reloadCatalog();
      freeAvailable.value = raw.configured && raw.available;
      freeModel.value = raw.configured ? text(raw.model, 100) : "";
      freeStatus.value = !raw.configured ? "unconfigured" : raw.available ? "available" : "unavailable";
      const quota = record(raw.quota);
      freeQuota.value = raw.configured && Number.isInteger(quota.remaining) && Number.isInteger(quota.limit) && typeof quota.resetAt === "string"
        ? { remaining: Math.max(0, Number(quota.remaining)), limit: Math.max(0, Number(quota.limit)), resetAt: quota.resetAt } : null;
      const serviceError = record(raw.error);
      freeError.value = freeAvailable.value ? "" : explainError(new AISearchError(typeof serviceError.code === "string" ? serviceError.code : "FREE_UNAVAILABLE", serviceError.reason));
    } catch {
      if (generation === freeGeneration && !destroyed) { freeAvailable.value = false; freeModel.value = ""; freeStatus.value = "unconfigured"; freeQuota.value = null; freeError.value = t("aiSearch.errors.freeUnavailable"); }
    } finally { clearTimeout(timer); }
  }
  function explainError(error: unknown): string {
    const code = error instanceof AISearchError ? error.code : "NETWORK";
    if (code === "PROVIDER_BALANCE_LOW") return t("aiSearch.errors.providerBalanceLow", { threshold: freeMinBalanceCny.value });
    if (code === "PROVIDER_BALANCE_UNAVAILABLE") {
      const reason = error instanceof AISearchError ? error.reason : undefined;
      return reason ? t(`aiSearch.errors.providerBalanceReason.${reason}`, { threshold: freeMinBalanceCny.value }) : t("aiSearch.errors.providerBalanceUnavailable");
    }
    if (code === "PROMPT_UNAVAILABLE" || code === "SYSTEM_PROMPT_UNAVAILABLE") return t("aiSearch.errors.promptUnavailable");
    if (code === "CONFIG") return t("aiSearch.errors.config");
    if (code === "AUTH") return t("aiSearch.errors.auth");
    if (code === "CATALOG_CHANGED" || /CATALOG_VERSION/u.test(code)) return t("aiSearch.errors.catalogChanged");
    if (code === "ASSET_DETAILS") return t("aiSearch.errors.assetDetails");
    if (code === "RETRIEVAL_MATCH_ON_UNSUPPORTED") return t("aiSearch.errors.matchOnUnsupported");
    if (/RETRIEVAL/u.test(code)) return t("aiSearch.errors.retrieval");
    if (/BUDGET/u.test(code)) return t("aiSearch.errors.budget");
    if (/QUOTA|DAILY|RATE_LIMIT/u.test(code)) return t("aiSearch.errors.quota");
    if (/TIMEOUT/u.test(code)) return t("aiSearch.errors.timeout");
    if (code === "OUTPUT_TRUNCATED") return t("aiSearch.errors.outputTruncated");
    if (code === "EMPTY_RESPONSE") return t("aiSearch.errors.emptyResponse");
    if (code === "RESPONSE_FORMAT") return t("aiSearch.errors.responseFormat");
    if (code === "RESPONSE_ASSET_ID") return t("aiSearch.errors.responseAssetId");
    if (code === "MODEL_REQUEST_REJECTED") return t("aiSearch.errors.modelRequestRejected");
    if (code === "TOOLS_UNSUPPORTED") return t("aiSearch.errors.toolsUnsupported");
    if (code === "AGENT_LIMIT") return t("aiSearch.errors.agentLimit");
    if (code === "TOOL_ARGUMENTS") return t("aiSearch.errors.toolArguments");
    if (/RESPONSE|OUTPUT|RESULT/u.test(code)) return t("aiSearch.errors.invalidResponse");
    if (/CONFIGURED|UNAVAILABLE|SERVICE_ERROR/u.test(code)) return t("aiSearch.errors.freeUnavailable");
    return t("aiSearch.errors.network");
  }
  async function send(input: string) {
    const query = input.trim();
    if (!query || query.length > 2000 || busy.value || loadingCatalog.value || loadingArchive.value) return;
    if (!catalogCount.value) { errorMessage.value = t("aiSearch.errors.catalog"); return; }
    const selectedMode = mode.value;
    const selectedResultLimit = selectedMode === "free" ? Math.min(normalizeResultLimit(resultLimit.value), freeResultLimit.value) : normalizeResultLimit(resultLimit.value);
    const agentWorkflow = serverRetrieval.value && (selectedMode === "custom" || selectedMode === "free" && serverAgent.value);
    if (selectedMode === "free" && !freeAvailable.value) { errorMessage.value = freeError.value || t("aiSearch.errors.freeUnavailable"); return; }
    if (selectedMode === "free" && freeQuota.value?.remaining === 0) { errorMessage.value = t("aiSearch.errors.quota"); return; }
    if (selectedMode === "custom" && !modelConfig.value.apiKey.trim()) { errorMessage.value = t("aiSearch.errors.config"); return; }
    const conversation = conversations.value.find(item => item.id === activeConversationId.value)!;
    let context = buildSearchContext(conversation.messages.slice(conversation.contextStart), query);
    let previousCards = [...context].reverse().find(item => item.role === "assistant" && item.cards.length)?.cards ?? [];
    const previousScope = resolveSearchScope(previousSearchQuery(context), "all");
    // Switching a manually selected asset type also starts a fresh search.
    if (scope.value !== "all" && (previousScope !== "all" && previousScope !== scope.value
      || previousCards.some(card => scope.value === "sound" ? card.kind !== "sound" && !card.audioMatch
        : card.kind !== scope.value))) { context = []; previousCards = []; }
    const resourceMap = new Map(resources.value.map(item => [item.resourceId, item]));
    const useServer = serverRetrieval.value;
    const previous: SearchResource[] = useServer ? previousCards.map(card => ({ ...card, locale: locale.value, featureText: "", audioText: "", suggestionText: "" }))
      : previousCards.flatMap(card => { const item = resourceMap.get(card.resourceId); return item ? [{ ...item, audioMatch: card.audioMatch }] : []; });
    const selectedIntent = resolveSearchIntent(query, scope.value, previous, previousSearchQuery(context));
    const selectedScope = selectedIntent.scope;
    const moreAlternatives = /^(?:再[来來](?:[点點些]|一[点點些]|[几幾][个個]|一批)|多[来來](?:[点點些]|一[点點些]|[几幾][个個])|[换換](?:[几幾][个個]|一批|一些)|再找(?:[几幾][个個]|一些|一批)|更多(?:一些|一[点點])?|more|another|some more|a few more|show me more|もっと)[\s。.!！?？]*$/iu.test(query);
    const excludeIds = moreAlternatives ? previousCards.map(card => card.resourceId) : [];
    retryQuery.value = "";
    retryConversationId.value = "";
    const requestLocale = locale.value;
    const includeAudio = includeEffectAudio.value;
    const assistant: ChatMessage = { id: uid(), role: "assistant", content: "", cards: [], status: "pending", mode: selectedMode, source: selectedMode };
    conversation.messages.push({ id: uid(), role: "user", content: query, cards: [], status: "complete", mode: selectedMode, source: selectedMode }, assistant);
    // Use the reactive array entry so updates are visible to Vue and the storage watcher.
    const reply = conversation.messages[conversation.messages.length - 1];
    if (conversation.messages.length === 2) conversation.title = query.slice(0, 36);
    conversation.updatedAt = Date.now();
    errorMessage.value = "";
    const run = { controller: new AbortController(), message: reply, timedOut: false };
    currentRun = run;
    busy.value = true;
    const timer = setTimeout(() => { run.timedOut = true; run.controller.abort(); }, agentWorkflow ? 60000 : 45000);
    try {
      if (agentWorkflow) {
        const history = conversation.messages.slice(conversation.contextStart, -2);
        // The model interprets whether this is a refinement or a new topic. Keep
        // the explicit selector as a filter, rather than inferring one up front.
        const payload = buildAgentSearchPayload(query, requestLocale, scope.value, history, includeAudio, uid(), selectedResultLimit);
        if (selectedMode === "free") payload.previousIds = payload.previousIds.slice(0, freePreviousIdLimit.value);
        const result = await requestAgentSearch(payload, { mode: selectedMode as "free" | "custom", config: { ...modelConfig.value }, freeBase: FREE_BASE, signal: run.controller.signal,
          maxSearchLimit: serverCatalog.value?.maxSearchLimit, maxAssetIds: serverCatalog.value?.maxAssetIds,
          maxPreviousIds: serverCatalog.value?.maxPreviousIds, maxExcludeIds: serverCatalog.value?.maxExcludeIds });
        if (currentRun !== run || run.controller.signal.aborted || destroyed) return;
        if (result.quota) freeQuota.value = result.quota;
        if (selectedMode === "free" && text(result.model, 100)) freeModel.value = text(result.model, 100);
        observeFeatureSync(result.featureSync);
        if (result.retrievalMode) retrievalMode.value = result.retrievalMode;
        reply.content = result.answer;
        reply.model = result.model;
        reply.cards = result.matches.flatMap(match => {
          const item = result.resources?.find(item => item.resourceId === match.resourceId);
          return item ? [{ ...item, matchReason: match.reason, matchType: match.matchType }] : [];
        });
        reply.status = "complete";
        return;
      }
      let candidates: SearchResource[];
      let catalogVersion = "";
      let musicDescriptionsMissing = false;
      let effectAudioDescriptionsMissing = false;
      if (useServer) {
        const retrieved = await requestServerSearchBatch(FREE_BASE, { query, locale: requestLocale, scope: selectedScope, matchOn: selectedIntent.matchOn, includeEffectAudio: includeAudio, limit: Math.max(20, selectedResultLimit),
          ...(selectedIntent.filters ? { filters: selectedIntent.filters, searchType: "feature" } : {}), previousIds: previousCards.slice(0, MAX_SEARCH_RESULTS).map(card => card.resourceId), previousQuery: previousSearchQuery(context), ...(excludeIds.length ? { excludeIds } : {}) }, run.controller.signal, undefined, serverCatalog.value?.maxSearchLimit,
          { maxPreviousIds: serverCatalog.value?.maxPreviousIds, maxExcludeIds: serverCatalog.value?.maxExcludeIds });
        if (currentRun !== run || run.controller.signal.aborted || destroyed) return;
        candidates = retrieved.items;
        catalogVersion = retrieved.catalogVersion;
        observeFeatureSync(retrieved.featureSync);
        musicDescriptionsMissing = retrieved.retrievalNotice?.code === "MUSIC_DESCRIPTION_MISSING";
        effectAudioDescriptionsMissing = retrieved.retrievalNotice?.code === "EFFECT_AUDIO_DESCRIPTION_MISSING";
        // Search.total is the count of matches, not the catalogue size.
        retrievalMode.value = retrieved.mode;
      } else {
        const audioEffects = resources.value.filter(item => item.kind === "effect" && item.hasAudio);
        effectAudioDescriptionsMissing = selectedScope === "effect" && selectedIntent.matchOn === "audio" && audioEffects.length > 0
          && audioEffects.every(item => !item.audioDescription && !item.audioKeywords?.length);
        candidates = retrieveResources(resources.value, { query, scope: selectedScope, matchOn: selectedIntent.matchOn, includeEffectAudio: includeAudio, previous, previousQuery: previousSearchQuery(context), excludeIds, limit: Math.max(20, selectedResultLimit) });
        if (!candidates.length && previous.length && context.length) {
          const priorQuestion = previousSearchQuery(context);
          candidates = retrieveResources(resources.value, { query: `${priorQuestion} ${query}`, scope: selectedScope, matchOn: selectedIntent.matchOn, includeEffectAudio: includeAudio, previous, limit: Math.max(20, selectedResultLimit) });
        }
      }
      // With no retrieved evidence there is nothing for a paid model to choose.
      if (!candidates.length) {
        reply.content = t(effectAudioDescriptionsMissing ? "aiSearch.effectAudioDescriptionsMissing" : musicDescriptionsMissing && selectedScope === "bgm" ? "aiSearch.musicDescriptionsMissing" : "aiSearch.noSearchCandidates");
        reply.mode = "basic";
        reply.source = "basic";
        reply.status = "complete";
        return;
      }
      const detailsFor = async (chosen: SearchResource[]) => {
        if (!useServer || !chosen.length) return chosen;
        const details = await requestServerAssets(FREE_BASE, chosen.map(item => item.resourceId), requestLocale, catalogVersion, run.controller.signal, new Set(chosen.filter(item => item.audioMatch).map(item => item.resourceId)), undefined, state => { if (currentRun === run && !destroyed) observeFeatureSync(state); }, serverCatalog.value?.maxAssetIds);
        return chosen.map(summary => {
          const detail = details.find(item => item.resourceId === summary.resourceId)!;
          // A projected audio summary can safely fill absent audio detail fields; visual detail cannot.
          return summary.audioMatch ? { ...detail, audioMatch: true, description: detail.audioDescription || summary.description,
            keywords: detail.audioKeywords?.length ? detail.audioKeywords : summary.keywords,
            suggestedUses: detail.audioSuggestedUses?.length ? detail.audioSuggestedUses : summary.suggestedUses } : detail;
        });
      };
      if (selectedMode === "basic") {
        const selected = candidates.slice(0, selectedResultLimit);
        const details = await detailsFor(selected);
        if (currentRun !== run || run.controller.signal.aborted || destroyed) return;
        reply.cards = details.map((item, index) => ({ ...item, matchType: selected[index].matchType, matchReason: t(selected[index].matchType === "suggestion" ? "aiSearch.match.suggestion" : "aiSearch.match.feature") }));
        reply.content = t(reply.cards.length ? previous.length ? "aiSearch.basicRefine" : "aiSearch.basicAnswer" : "aiSearch.basicEmpty", { count: reply.cards.length });
      } else {
        const serverFree = useServer && selectedMode === "free";
        const modelCandidates = selectedMode === "free" ? candidates.slice(0, freeResultLimit.value > 5 ? MAX_SEARCH_RESULTS : 12) : candidates;
        const payload = buildSearchPayload(query, requestLocale, selectedScope, context, serverFree ? [] : modelCandidates, uid(), selectedResultLimit, selectedIntent.matchOn);
        const boundedCandidates = serverFree ? modelCandidates : modelCandidates.filter(item => payload.candidates.some(candidate => candidate.resourceId === item.resourceId));
        const result = await requestSearch(payload, boundedCandidates, { mode: selectedMode, config: { ...modelConfig.value }, freeBase: FREE_BASE, signal: run.controller.signal,
          ...(serverFree ? { server: { catalogVersion, includeEffectAudio: includeAudio } } : {}) });
        if (currentRun !== run || run.controller.signal.aborted || destroyed) return;
        if (result.quota) freeQuota.value = result.quota;
        if (selectedMode === "free" && text(result.model, 100)) freeModel.value = text(result.model, 100);
        observeFeatureSync(result.featureSync);
        const chosen = result.matches.map(match => boundedCandidates.find(item => item.resourceId === match.resourceId)!);
        const detailed = serverFree && result.resources ? result.resources : await detailsFor(chosen);
        if (currentRun !== run || run.controller.signal.aborted || destroyed) return;
        reply.content = result.answer;
        reply.model = result.model;
        reply.cards = result.matches.flatMap(match => {
          const item = detailed.find(item => item.resourceId === match.resourceId);
          return item ? [{ ...item, matchReason: match.reason, matchType: match.matchType }] : [];
        });
      }
      if (currentRun === run) reply.status = "complete";
    } catch (error) {
      if (currentRun !== run || destroyed) return;
      reply.status = "error";
      reply.error = true;
      reply.content = run.timedOut ? t("aiSearch.errors.timeout") : explainError(error);
      if (!run.timedOut && error instanceof AISearchError && error.rawResponse) reply.rawResponse = error.rawResponse;
      if (error instanceof AISearchError && (error.code === "CATALOG_CHANGED" || /CATALOG_VERSION/u.test(error.code))) {
        retryQuery.value = query;
        retryConversationId.value = conversation.id;
        // Refresh evidence only. Retrying a model call requires a fresh user action.
        await reloadCatalog();
      }
      if (selectedMode === "free") {
        if (error instanceof AISearchError && (error.code === "PROVIDER_BALANCE_LOW" || error.code === "PROVIDER_BALANCE_UNAVAILABLE")) {
          // A current chat failure wins over any earlier, still-pending status check.
          ++freeGeneration;
          freeAvailable.value = false;
          freeStatus.value = "unavailable";
          freeError.value = explainError(error);
        } else void refreshFreeStatus();
      }
    } finally {
      clearTimeout(timer);
      if (currentRun === run) { currentRun = undefined; busy.value = false; }
    }
  }
  async function retrySearch() {
    if (!canRetrySearch.value || busy.value || loadingCatalog.value || loadingArchive.value) return;
    await send(retryQuery.value);
  }
  watch(conversations, saveArchive, { deep: true });
  watch(activeConversationId, saveArchive);
  watch(mode, saveArchive);
  watch(resultLimit, saveArchive);
  // Discover retrieval capability before downloading the legacy full catalogue.
  onMounted(() => { void (async () => { await restoreArchive(); if (destroyed) return; await refreshFreeStatus(); if (!destroyed) { saveArchive(); await reloadCatalog(); } })(); });
  onBeforeUnmount(() => { stop(); saveArchive(); destroyed = true; });
  return { conversations, activeConversationId, messages, busy, loadingCatalog, loadingArchive, archiveError, catalogError, catalogErrorMessage, catalogCount, descriptionCoverage, serverRetrieval, retrievalMode, featureSync, featuresUpdated, featureMissing, canRetrySearch, retrySearch,
    mode, scope, resultLimit, freeResultLimit, includeEffectAudio, freeAvailable, freeModel, freeStatus, freeQuota, freeError, modelConfig, errorMessage,
    createConversation, selectConversation, renameConversation, deleteConversation, clearContext, send, stop, saveConfig, refreshFreeStatus, reloadCatalog };
}
