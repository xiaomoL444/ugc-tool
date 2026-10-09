import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { StorageClass } from "../../services/storage/storage";
import { useI18n } from "vue-i18n";
import { record, resourceHref, resolveSearchScope, resolveSearchIntent } from "./resourceCatalog";
import { AISearchError, fetchAISearch, readAISearchJSON, featureHashesChanged, buildSearchContext, buildSearchPayload, chatCompletionsUrl, previousSearchQuery, requestSearch, parseServerCatalog, requestServerCatalog, requestServerSearchBatch, requestServerAssets } from "./aiSearchService";
import { buildAgentSearchPayload, requestAgentSearch } from "./agentSearchService";
import { AISearchArchiveRepository } from "./archiveStorage";
import { boundedRawResponse } from "./responseDiagnostics";
import { sanitizeRequestDiagnostic, httpRequestDiagnostic, responseRequestDiagnostic } from "./requestDiagnostics";
import type { RequestDiagnostic } from "./requestDiagnostics";
import { DEFAULT_SEARCH_RESULTS, MAX_SEARCH_RESULTS, normalizeResultLimit } from "./resultLimits";
import { createDataUpdateMonitor } from "./dataUpdateMonitor";
import { resolveModelProtocol, anthropicMessagesUrl } from "./modelProtocol";
import type { ChatMessage, Conversation, FreeQuota, ModelConfig, ResourceCard, SearchMode, SearchScope, SearchResource, ServerCatalogInfo, RetrievalMode, FeatureSync } from "./types";

const HISTORY_KEY = "ugc-tools.ai-search.history.v1";
const CONFIG_KEY = "ugc-tools.ai-search.model.v1";
const SESSION_KEY = "ugc-tools.ai-search.session-key.v1";
const FREE_BASE = process.env.VUE_APP_AI_SEARCH_API_BASE || "/api/ai-search";
const DEFAULT_MIN_BALANCE_CNY = 20;
const uid = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const text = (value: unknown, max = 4000) => typeof value === "string" ? value.slice(0, max) : "";

// Keep only public catalogue metadata across route visits, independently of quota and credentials.
type WarmCatalog = { catalog: ServerCatalogInfo; agent: boolean };
let warmCatalog: WarmCatalog | undefined;
let catalogRequest: Promise<ServerCatalogInfo> | undefined;
function requestCatalog() {
  if (!catalogRequest) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    catalogRequest = requestServerCatalog(FREE_BASE, controller.signal).finally(() => {
      clearTimeout(timer);
      catalogRequest = undefined;
    });
  }
  return catalogRequest;
}

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
      const requestDiagnostic = item.role === "assistant" && status === "error" ? sanitizeRequestDiagnostic(item.requestDiagnostic) : undefined;
      return [{ id: text(item.id, 100) || uid(), role: item.role as ChatMessage["role"], content: text(item.content), cards, status,
        mode, source: mode, model: text(item.model, 100), error: status === "error", ...(rawResponse ? { rawResponse } : {}), ...(requestDiagnostic ? { requestDiagnostic } : {}) }];
    });
    const contextStart = Number.isInteger(source.contextStart) ? Math.min(messages.length, Math.max(0, Number(source.contextStart) - Math.max(0, source.messages.length - 100))) : 0;
    return [{ id: source.id.slice(0, 100), title: text(source.title, 80), updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : Date.now(), messages, contextStart }];
  });
}
function readSavedConfig(): ModelConfig {
  const defaults: ModelConfig = { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-flash", apiKey: "", rememberKey: false, protocol: "auto" };
  try {
    const saved = record(JSON.parse(localStorage.getItem(CONFIG_KEY) || "null"));
    return { baseUrl: text(saved.baseUrl, 500) || defaults.baseUrl, model: text(saved.model, 100) || defaults.model,
      protocol: saved.protocol === "openai" || saved.protocol === "anthropic" ? saved.protocol : "auto",
      rememberKey: saved.rememberKey === true, apiKey: saved.rememberKey === true ? text(saved.apiKey, 500) : sessionStorage.getItem(SESSION_KEY) || "" };
  } catch { return defaults; }
}
export function useAISearch() {
  const cachedCatalog = warmCatalog;
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
  const loadingCatalog = ref(!cachedCatalog);
  const loadingArchive = ref(true);
  const archiveError = ref("");
  const catalogError = ref(false);
  const errorMessage = ref("");
  const serverRetrieval = ref(true);
  const serverAgent = ref(cachedCatalog?.agent ?? false);
  const serverCatalog = shallowRef<ServerCatalogInfo | null>(cachedCatalog?.catalog ?? null);
  const retrievalMode = ref<RetrievalMode>(cachedCatalog?.catalog.mode ?? "keyword");
  const catalogErrorMessage = ref("");
  const catalogDiagnostic = shallowRef<RequestDiagnostic>();
  const featureSync = shallowRef<FeatureSync | undefined>(cachedCatalog?.catalog.featureSync);
  const featuresUpdated = ref(false);
  const dataUpdateVersion = ref("");
  const dataUpdateMonitor = createDataUpdateMonitor(version => { dataUpdateVersion.value = version; });
  let dataUpdateTimer: ReturnType<typeof setInterval> | undefined;
  let notifyOnFirstDataLoad = false;
  function checkDataUpdate() {
    if (loadingArchive.value) return;
    if (typeof document === "undefined" || document.visibilityState !== "hidden") void dataUpdateMonitor.check(notifyOnFirstDataLoad);
  }
  const featureMissing = ref(false);
  const retryQuery = ref("");
  const retryConversationId = ref("");
  const canRetrySearch = computed(() => !!retryQuery.value && retryConversationId.value === activeConversationId.value);
  let observedHashes: FeatureSync["hashes"] = { ...featureSync.value?.hashes };
  function observeFeatureSync(state?: FeatureSync) {
    if (!state) return;
    if (featureHashesChanged(observedHashes, state.hashes)) featuresUpdated.value = true;
    if (Object.keys(state.hashes).length) observedHashes = { ...state.hashes };
    featureSync.value = state;
  }
  const catalogCount = computed(() => serverCatalog.value?.total ?? 0);
  const descriptionCoverage = computed(() => serverCatalog.value?.coverage ?? 0);
  const freeAvailable = ref(false);
  const freeModel = ref("");
  const freeStatus = ref<"checking" | "available" | "unconfigured" | "unavailable">("checking");
  const freeQuota = ref<FreeQuota | null>(null);
  const freeError = ref("");
  const freeDiagnostic = shallowRef<RequestDiagnostic>();
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
    const protocol = config.protocol ?? "auto";
    if (!["auto", "openai", "anthropic"].includes(protocol)) { errorMessage.value = t("aiSearch.errors.config"); return false; }
    try { if (resolveModelProtocol({ ...config, protocol }) === "anthropic") anthropicMessagesUrl(config.baseUrl); else chatCompletionsUrl(config.baseUrl); } catch { errorMessage.value = t("aiSearch.errors.config"); return false; }
    if (!config.model.trim() || config.model.length > 100 || !config.apiKey.trim() || /[\r\n]/u.test(config.apiKey.trim())) { errorMessage.value = t("aiSearch.errors.config"); return false; }
    modelConfig.value = { baseUrl: config.baseUrl.trim(), model: config.model.trim(), apiKey: config.apiKey.trim(), rememberKey: config.rememberKey, protocol };
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify({ baseUrl: modelConfig.value.baseUrl, model: modelConfig.value.model, rememberKey: config.rememberKey, protocol,
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
    } finally {
      // Only restored messages count as old history; new searches must not trigger migration notices.
      notifyOnFirstDataLoad = conversations.value.some(conversation => conversation.messages.length > 0);
      loadingArchive.value = false;
    }
  }
  function saveArchive() {
    if (destroyed || loadingArchive.value || !archiveWritable || !archive) return;
    void archive.write({ conversations: conversations.value, activeConversationId: activeConversationId.value, selectedMode: mode.value, resultLimit: resultLimit.value })
      .then(() => { if (!destroyed) archiveError.value = ""; })
      .catch(() => { if (!destroyed) archiveError.value = t("aiSearch.errors.storage"); });
  }
  function applyServerCatalog(loaded: ServerCatalogInfo) {
    serverCatalog.value = loaded;
    warmCatalog = { catalog: loaded, agent: serverAgent.value };
    observeFeatureSync(loaded.featureSync);
    featureMissing.value = false;
    retrievalMode.value = loaded.mode;
    catalogError.value = false;
    catalogErrorMessage.value = "";
    catalogDiagnostic.value = undefined;
  }
  async function refreshCatalog(background = false) {
    const generation = ++catalogGeneration;
    loadingCatalog.value = !background || !catalogCount.value;
    try {
      const loaded = await requestCatalog();
      if (generation !== catalogGeneration || destroyed) return;
      applyServerCatalog(loaded);
    } catch (error) { if (generation === catalogGeneration && !destroyed) { catalogError.value = true; catalogErrorMessage.value = explainError(error); catalogDiagnostic.value = error instanceof AISearchError ? sanitizeRequestDiagnostic(error.requestDiagnostic) : undefined; } }
    finally { if (generation === catalogGeneration && !destroyed) loadingCatalog.value = false; }
  }
  function reloadCatalog() { return refreshCatalog(); }
  async function refreshFreeStatus() {
    const generation = ++freeGeneration;
    let catalogLoaded = false;
    freeStatus.value = "checking";
    freeDiagnostic.value = undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const endpoint = `${FREE_BASE.replace(/\/$/, "")}/config`;
    const context = { stage: "site" as const, endpoint, startedAt: Date.now() };
    try {
      const response = await fetchAISearch(endpoint, { signal: controller.signal, cache: "no-store" }, context, fetch, [], "FREE_UNAVAILABLE");
      const diagnostic = response.ok ? undefined : await httpRequestDiagnostic(response, context);
      let raw: Record<string, unknown>;
      try { raw = await readAISearchJSON(response, context, controller.signal); }
      catch (error) { if (diagnostic) throw new AISearchError("FREE_UNAVAILABLE", undefined, undefined, diagnostic); throw error; }
      if (!response.ok) { const error = record(raw.error); throw new AISearchError(typeof error.code === "string" ? error.code : "FREE_UNAVAILABLE", error.reason, undefined, diagnostic); }
      if (typeof raw.configured !== "boolean" || typeof raw.available !== "boolean") throw new AISearchError("FREE_UNAVAILABLE", undefined, undefined, responseRequestDiagnostic(response, context));
      if (generation !== freeGeneration || destroyed) return;
      const retrieval = record(raw.retrieval);
      const nextServerRetrieval = retrieval.available === true;
      serverAgent.value = record(raw.agent).available === true;
      if (nextServerRetrieval) {
        try {
          const loaded = parseServerCatalog(retrieval);
          // /config already carries the same validated public metadata as /catalog.
          ++catalogGeneration;
          applyServerCatalog(loaded);
          loadingCatalog.value = false;
          catalogLoaded = true;
        } catch { /* Older services may only advertise retrieval availability. */ }
      }
      const limits = record(raw.limits);
      freeMinBalanceCny.value = typeof limits.minBalanceCny === "number" && Number.isFinite(limits.minBalanceCny) && limits.minBalanceCny > 0
        ? limits.minBalanceCny : DEFAULT_MIN_BALANCE_CNY;
      freeResultLimit.value = Number.isInteger(limits.maxResults) && Number(limits.maxResults) >= 5
        ? Math.min(MAX_SEARCH_RESULTS, Number(limits.maxResults)) : 5;
      freePreviousIdLimit.value = Number.isInteger(limits.maxPreviousIds) && Number(limits.maxPreviousIds) >= 5
        ? Math.min(MAX_SEARCH_RESULTS, Number(limits.maxPreviousIds)) : 5;
      freeAvailable.value = raw.configured && raw.available;
      freeModel.value = raw.configured ? text(raw.model, 100) : "";
      freeStatus.value = !raw.configured ? "unconfigured" : raw.available ? "available" : "unavailable";
      const quota = record(raw.quota);
      freeQuota.value = raw.configured && Number.isInteger(quota.remaining) && Number.isInteger(quota.limit) && typeof quota.resetAt === "string"
        ? { remaining: Math.max(0, Number(quota.remaining)), limit: Math.max(0, Number(quota.limit)), resetAt: quota.resetAt } : null;
      const serviceError = record(raw.error);
      freeDiagnostic.value = freeAvailable.value ? undefined : sanitizeRequestDiagnostic(serviceError.requestDiagnostic);
      freeError.value = freeAvailable.value ? "" : explainError(new AISearchError(typeof serviceError.code === "string" ? serviceError.code : "FREE_UNAVAILABLE", serviceError.reason, undefined, freeDiagnostic.value));
    } catch (error) {
      if (generation === freeGeneration && !destroyed) { freeAvailable.value = false; freeModel.value = ""; freeStatus.value = "unconfigured"; freeQuota.value = null; freeError.value = explainError(error); freeDiagnostic.value = error instanceof AISearchError ? sanitizeRequestDiagnostic(error.requestDiagnostic) : undefined; }
    } finally { clearTimeout(timer); }
    return catalogLoaded;
  }
  function explainErrorCode(error: unknown): string {
    const code = error instanceof AISearchError ? error.code : "NETWORK";
    if (code === "PROVIDER_BALANCE_LOW") return t("aiSearch.errors.providerBalanceLow", { threshold: freeMinBalanceCny.value });
    if (code === "PROVIDER_BALANCE_UNAVAILABLE") {
      const reason = error instanceof AISearchError ? error.reason : undefined;
      return reason ? t(`aiSearch.errors.providerBalanceReason.${reason}`, { threshold: freeMinBalanceCny.value }) : t("aiSearch.errors.providerBalanceUnavailable");
    }
    if (code === "PROMPT_UNAVAILABLE" || code === "SYSTEM_PROMPT_UNAVAILABLE") return t("aiSearch.errors.promptUnavailable");
    if (code === "CONFIG") return t("aiSearch.errors.config");
    if (code === "AUTH") return t("aiSearch.errors.auth");
    if (code === "FORBIDDEN") return t("aiSearch.errors.forbidden");
    if (code === "PROVIDER_RATE_LIMIT") return t("aiSearch.errors.providerRateLimit");
    if (code === "MODEL_SERVICE_ERROR") return t("aiSearch.errors.modelServiceError");
    if (code === "REQUEST_ABORTED") return t("aiSearch.errors.requestAborted");
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
  function diagnosticHint(diagnostic: RequestDiagnostic): string | undefined {
    if (diagnostic.stage === "prompt" && diagnostic.validationCode) return "promptValidation";
    if (diagnostic.stage === "prompt" && diagnostic.kind === "response") return "promptResponse";
    if (diagnostic.kind === "network") return diagnostic.status === undefined ? "noResponse" : "bodyInterrupted";
    if (diagnostic.kind === "timeout") return "timeout";
    if (diagnostic.stage === "prompt") return "promptResponse";
    if (diagnostic.status === 401) return diagnostic.stage === "model" ? "auth" : "serviceAuth";
    if (diagnostic.status === 403) return diagnostic.stage === "model" ? "forbidden" : "serviceAuth";
    if (diagnostic.status === 429) return diagnostic.stage === "model" ? "rateLimit" : "serviceRateLimit";
    if (diagnostic.status && diagnostic.status >= 500) return "serviceError";
    if ([400, 404, 422].includes(diagnostic.status ?? 0)) return "rejected";
    if (diagnostic.kind === "response") return "response";
  }
  function requestDiagnosticText(raw: RequestDiagnostic): string {
    const diagnostic = sanitizeRequestDiagnostic(raw);
    if (!diagnostic) return "";
    const fields: [string, string | number | undefined][] = [
      ["stage", t(`aiSearch.requestDiagnostics.stages.${diagnostic.stage}`)],
      ["status", diagnostic.status === undefined ? undefined : `HTTP ${diagnostic.status}`],
      ["endpoint", diagnostic.endpoint], ["model", diagnostic.model], ["round", diagnostic.round],
      ["elapsed", diagnostic.elapsedMs === undefined ? undefined : t("aiSearch.requestDiagnostics.elapsedValue", { milliseconds: Math.round(diagnostic.elapsedMs) })],
      ["providerCode", diagnostic.providerCode], ["providerMessage", diagnostic.providerMessage],
      ["validationCode", diagnostic.stage === "prompt" && diagnostic.validationCode ? t("aiSearch.errors.promptValidation." + diagnostic.validationCode) + " (" + diagnostic.validationCode + ")" : diagnostic.validationCode],
      ["responseBytes", diagnostic.responseBytes], ["responseByteLimit", diagnostic.responseByteLimit], ["contentType", diagnostic.contentType],
      ["parameter", diagnostic.parameter], ["requestId", diagnostic.requestId], ["browserMessage", diagnostic.browserMessage],
    ];
    const lines = fields.filter(([, value]) => value !== undefined && value !== "").map(([field, value]) => `${t(`aiSearch.requestDiagnostics.${field}`)}: ${value}`);
    const hint = diagnosticHint(diagnostic);
    if (hint) lines.push("", t(`aiSearch.requestDiagnostics.hints.${hint}`));
    return lines.join("\n");
  }
  function explainError(error: unknown, timedOut = false): string {
    const diagnostic = error instanceof AISearchError ? sanitizeRequestDiagnostic(error.requestDiagnostic, [modelConfig.value.apiKey]) : undefined;
    const code = error instanceof AISearchError ? error.code : "NETWORK";
    const transportFailure = diagnostic?.kind === "network" && ["NETWORK", "FREE_UNAVAILABLE", "RETRIEVAL_FAILED", "RETRIEVAL_RESPONSE", "ASSET_DETAILS", "PROMPT_UNAVAILABLE", "SYSTEM_PROMPT_UNAVAILABLE"].includes(code);
    const noResponse = transportFailure && diagnostic?.status === undefined;
    const bodyInterrupted = transportFailure && diagnostic?.status !== undefined;
    const serviceDenied = !!diagnostic && diagnostic.stage !== "model" && ["AUTH", "FORBIDDEN"].includes(code);
    const promptValidation = diagnostic?.stage === "prompt" && diagnostic.validationCode ? t("aiSearch.errors.promptValidation." + diagnostic.validationCode) : undefined;
    const base = promptValidation ?? (timedOut ? t("aiSearch.errors.timeout") : noResponse ? t("aiSearch.errors.noResponse") : bodyInterrupted ? t("aiSearch.errors.bodyInterrupted") : serviceDenied ? t("aiSearch.errors.serviceDenied") : explainErrorCode(error));
    if (!diagnostic) return base;
    const context = `${t("aiSearch.requestDiagnostics.stage")}: ${t(`aiSearch.requestDiagnostics.stages.${diagnostic.stage}`)}${diagnostic.status === undefined ? "" : ` · HTTP ${diagnostic.status}`}`;
    const reason = [diagnostic.providerCode, diagnostic.providerMessage].filter(Boolean).join(": ").slice(0, 240);
    const promptSize = promptValidation && diagnostic.responseBytes !== undefined
      ? diagnostic.responseByteLimit !== undefined ? t("aiSearch.errors.promptSize", { bytes: diagnostic.responseBytes, limit: diagnostic.responseByteLimit })
        : t("aiSearch.errors.promptBytes", { bytes: diagnostic.responseBytes }) : undefined;
    return [base, context, promptSize, reason].filter(Boolean).join(" · ");
  }
  async function send(input: string) {
    const query = input.trim();
    if (!query || query.length > 2000 || busy.value || loadingCatalog.value || loadingArchive.value) return;
    checkDataUpdate();
    if (!catalogCount.value) { errorMessage.value = t("aiSearch.errors.catalog"); return; }
    const selectedMode = mode.value;
    const selectedResultLimit = selectedMode === "free" ? Math.min(normalizeResultLimit(resultLimit.value), freeResultLimit.value) : normalizeResultLimit(resultLimit.value);
    const agentWorkflow = selectedMode === "custom" || selectedMode === "free" && serverAgent.value;
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
    const previous: SearchResource[] = previousCards.map(card => ({ ...card, locale: locale.value, featureText: "", audioText: "", suggestionText: "" }));
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
      const retrieved = await requestServerSearchBatch(FREE_BASE, { query, locale: requestLocale, scope: selectedScope, matchOn: selectedIntent.matchOn, includeEffectAudio: includeAudio, limit: Math.max(20, selectedResultLimit),
        ...(selectedIntent.filters ? { filters: selectedIntent.filters, searchType: "feature" } : {}), previousIds: previousCards.slice(0, MAX_SEARCH_RESULTS).map(card => card.resourceId), previousQuery: previousSearchQuery(context), ...(excludeIds.length ? { excludeIds } : {}) }, run.controller.signal, undefined, serverCatalog.value?.maxSearchLimit,
        { maxPreviousIds: serverCatalog.value?.maxPreviousIds, maxExcludeIds: serverCatalog.value?.maxExcludeIds });
      if (currentRun !== run || run.controller.signal.aborted || destroyed) return;
      const candidates = retrieved.items;
      const catalogVersion = retrieved.catalogVersion;
      observeFeatureSync(retrieved.featureSync);
      const musicDescriptionsMissing = retrieved.retrievalNotice?.code === "MUSIC_DESCRIPTION_MISSING";
      const effectAudioDescriptionsMissing = retrieved.retrievalNotice?.code === "EFFECT_AUDIO_DESCRIPTION_MISSING";
      // Search.total is the count of matches, not the catalogue size.
      retrievalMode.value = retrieved.mode;
      // With no retrieved evidence there is nothing for a paid model to choose.
      if (!candidates.length) {
        reply.content = t(effectAudioDescriptionsMissing ? "aiSearch.effectAudioDescriptionsMissing" : musicDescriptionsMissing && selectedScope === "bgm" ? "aiSearch.musicDescriptionsMissing" : "aiSearch.noSearchCandidates");
        reply.mode = "basic";
        reply.source = "basic";
        reply.status = "complete";
        return;
      }
      const detailsFor = async (chosen: SearchResource[]) => {
        if (!chosen.length) return chosen;
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
        const serverFree = selectedMode === "free";
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
      reply.content = explainError(error, run.timedOut);
      const requestDiagnostic = error instanceof AISearchError ? sanitizeRequestDiagnostic(error.requestDiagnostic, [modelConfig.value.apiKey]) : undefined;
      if (requestDiagnostic) reply.requestDiagnostic = requestDiagnostic;
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
  onMounted(() => {
    checkDataUpdate();
    if (typeof window !== "undefined") {
      dataUpdateTimer = setInterval(checkDataUpdate, 60000);
      window.addEventListener("focus", checkDataUpdate);
      document.addEventListener("visibilitychange", checkDataUpdate);
    }
  });
  // Restore history and check the Worker independently; no browser-side asset library download.
  onMounted(() => { void (async () => {
    const [, catalogLoaded] = await Promise.all([restoreArchive(), refreshFreeStatus()]);
    if (destroyed) return;
    checkDataUpdate();
    saveArchive();
    if (!catalogLoaded) await refreshCatalog(true);
  })(); });
  onBeforeUnmount(() => {
    stop(); saveArchive(); destroyed = true;
    dataUpdateMonitor.dispose();
    clearInterval(dataUpdateTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", checkDataUpdate);
      document.removeEventListener("visibilitychange", checkDataUpdate);
    }
  });
  return { catalogDiagnostic, freeDiagnostic, conversations, activeConversationId, messages, busy, loadingCatalog, loadingArchive, archiveError, catalogError, catalogErrorMessage, catalogCount, descriptionCoverage, serverRetrieval, retrievalMode, featureSync, featuresUpdated, dataUpdateVersion, featureMissing, canRetrySearch, retrySearch,
    explainError, requestDiagnosticText, mode, scope, resultLimit, freeResultLimit, includeEffectAudio, freeAvailable, freeModel, freeStatus, freeQuota, freeError, modelConfig, errorMessage,
    createConversation, selectConversation, renameConversation, deleteConversation, clearContext, send, stop, saveConfig, refreshFreeStatus, reloadCatalog };
}
