/* Deploy separately from the static site. No upstream credentials belong in Vue. */
import { getCatalogInfo, getAssetDetails, searchAssets } from "./asset-search.mjs";
import { handleMcp } from "./mcp-handler.mjs";
import { AGENT_LIMITS, SEARCH_LIMITS, AgentError, buildAgentPrompt, runAssetAgent, resultConfig } from "./agent-runtime.mjs";
import { createProviderBalanceGuard, minimumBalanceCny, PROVIDER_BALANCE_REASONS } from "./provider-balance.mjs";
import { createSystemPromptLoader, renderSystemPrompt, SYSTEM_PROMPT_URL, SystemPromptError } from "./system-prompt.mjs";
import { createAssetCatalogLoader, AssetCatalogError } from "./asset-catalog-loader.mjs";
import { boundedModelText, withModelResponse } from "./model-response.mjs";
const assetCatalogLoader = createAssetCatalogLoader();
const withCatalog = async (env, loader = assetCatalogLoader) => {
  const snapshot = await loader.read(env);
  return { ...env, ASSET_SEARCH_CATALOG: snapshot.catalog, ASSET_FEATURE_SYNC: snapshot.featureSync };
};
const PUBLIC_RETRIEVAL_PATHS = ["/api/ai-search/catalog", "/api/ai-search/search", "/api/ai-search/assets", "/api/ai-search/mcp", "/mcp"];
const featureSync = env => env.ASSET_FEATURE_SYNC || { status: "disabled", hashes: {} };
const DAY = 86400000;
const MAX_BODY_BYTES = 160000;
const MAX_UPSTREAM_BYTES = 65536;
const encoder = new TextEncoder();

class ServiceError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
});
const publicError = error => {
  const rawResponse = error.code === "UPSTREAM_RESPONSE_INVALID" ? boundedModelText(error.rawResponse) : undefined;
  return { code: error.code, message: error.message,
    ...(rawResponse ? { rawResponse } : {}),
    ...(error.code === "PROVIDER_BALANCE_UNAVAILABLE" && PROVIDER_BALANCE_REASONS.includes(error.balanceReason)
      ? { reason: error.balanceReason } : {}) };
};
const balanceFailure = (ErrorClass, error) => Object.assign(new ErrorClass(503, error.code, error.message),
  { balanceReason: error.reason });
const errorResponse = (error) => error instanceof ServiceError || error instanceof AgentError || error instanceof SystemPromptError || error instanceof AssetCatalogError || (error?.name === "AssetSearchError" && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599)
  ? json({ error: publicError(error), ...error.details }, error.status)
  : json({ error: { code: "SERVICE_ERROR", message: "免费搜索服务暂时不可用，请稍后再试。" } }, 503);
const integer = (value, fallback, min, max) => {
  const number = Number(value ?? fallback);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
};

export function settings(env) {
  const inputRate = Number(env.INPUT_CNY_PER_MILLION);
  const outputRate = Number(env.OUTPUT_CNY_PER_MILLION);
  const budget = Number(env.MONTHLY_BUDGET_CNY ?? 50);
  const costSafety = Number(env.COST_SAFETY_FACTOR ?? 1.25);
  const requestedThinking = env.UPSTREAM_THINKING;
  const thinking = ["enabled", "disabled"].includes(requestedThinking) ? requestedThinking : undefined;
  const validThinking = requestedThinking === undefined || requestedThinking === "" || thinking !== undefined;
  let upstream;
  try { upstream = new URL(env.UPSTREAM_URL); } catch { /* configured below */ }
  const configured = Boolean(env.UPSTREAM_API_KEY && env.VISITOR_HASH_SECRET && env.MODEL
    && upstream?.protocol === "https:" && !upstream.username && !upstream.password
    && Number.isFinite(inputRate) && inputRate > 0
    && Number.isFinite(outputRate) && outputRate > 0
    && Number.isFinite(budget) && budget > 0
    && Number.isFinite(costSafety) && costSafety >= 1 && validThinking);
  return {
    configured, systemPromptUrl: env.SYSTEM_PROMPT_URL ?? SYSTEM_PROMPT_URL, upstream: upstream?.href, model: env.MODEL || "未配置免费模型",
    modelName: env.MODEL_NAME || env.MODEL || "网站免费模型",
    inputRate, outputRate, budget, costSafety, thinking, minBalanceCny: minimumBalanceCny(env),
    dailyLimit: integer(env.GUEST_DAILY_LIMIT, 5, 1, 100),
    maxCandidates: integer(env.MAX_CANDIDATES, 50, 1, 50),
    maxMessages: integer(env.MAX_MESSAGES, 12, 0, 30),
    maxQueryLength: integer(env.MAX_QUERY_LENGTH, 2000, 20, 8000),
    maxPromptBytes: integer(env.MAX_PROMPT_BYTES, 30000, 1000, 100000),
    maxOutputTokens: integer(env.MAX_OUTPUT_TOKENS, 5400, 100, 5400),
    maxConcurrency: integer(env.MAX_CONCURRENCY, 4, 1, 20),
    timeoutMs: integer(env.UPSTREAM_TIMEOUT_MS, 30000, 1000, 55000),
    agentTimeoutMs: Math.min(integer(env.UPSTREAM_TIMEOUT_MS, 30000, 1000, 55000) * 3 + 5000, 55000),
  };
}

// The day and month roll over at midnight in Asia/Shanghai, independent of host timezone.
export function periods(now = Date.now()) {
  const shifted = new Date(now + 8 * 3600000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  return {
    day: shifted.toISOString().slice(0, 10), month: shifted.toISOString().slice(0, 7),
    resetAt: new Date(Date.UTC(year, month, day + 1) - 8 * 3600000).toISOString(),
    monthResetAt: new Date(Date.UTC(year, month + 1, 1) - 8 * 3600000).toISOString(),
  };
}

async function digest(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function boundedText(stream, maxBytes) {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ServiceError(413, "PAYLOAD_TOO_LARGE", "请求内容过长，请缩短问题或减少候选资源。");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(combined);
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function textField(value, name, max, optional = false) {
  if (optional && (value === undefined || value === null)) return "";
  if (typeof value !== "string" || value.length > max || (!optional && !value.trim())) {
    throw new ServiceError(400, "INVALID_REQUEST", `${name} 格式不正确或内容过长。`);
  }
  return value.trim();
}

export function normalizeRequest(body, config) {
  if (!isObject(body)) throw new ServiceError(400, "INVALID_REQUEST", "请提交有效的搜索请求。");
  const resultLimit = body.resultLimit === undefined ? SEARCH_LIMITS.defaultResults : body.resultLimit;
  if (!Number.isInteger(resultLimit) || resultLimit < 1 || resultLimit > SEARCH_LIMITS.maxResults) throw new ServiceError(400, "INVALID_REQUEST", "结果数量必须是 1 至 50 的整数。");
  const query = textField(body.query, "query", config.maxQueryLength);
  const scope = body.scope ?? "all";
  const matchOn = body.matchOn === undefined ? "any" : body.matchOn;
  if (!["any", "visual", "audio"].includes(matchOn)) throw new ServiceError(400, "INVALID_MATCH_ON", "匹配证据仅支持 any、visual 或 audio。");
  const locales = { "zh-cn": "zh-CN", "zh-tw": "zh-TW", en: "en-US", "en-us": "en-US",
    ja: "ja-JP", "ja-jp": "ja-JP", ru: "ru-RU", "ru-ru": "ru-RU" };
  const requestedLocale = body.locale ?? "zh-CN";
  const localeKey = typeof requestedLocale === "string" ? requestedLocale.toLowerCase() : "";
  const locale = Object.hasOwn(locales, localeKey) ? locales[localeKey] : undefined;
  if (!["all", "sound", "effect", "bgm"].includes(scope)
    || !locale) {
    throw new ServiceError(400, "INVALID_REQUEST", "搜索范围或语言不受支持。");
  }
  const history = body.messages ?? [];
  if (!Array.isArray(history) || history.length > config.maxMessages) {
    throw new ServiceError(400, "INVALID_REQUEST", "对话上下文过长，请开始新对话。");
  }
  const messages = history.map((message) => {
    if (!isObject(message) || !["user", "assistant"].includes(message.role)) {
      throw new ServiceError(400, "INVALID_REQUEST", "对话仅支持用户和助手消息。");
    }
    return { role: message.role, content: textField(message.content, "message.content", 2000) };
  });
  const suppliedCandidates = body.candidateIds !== undefined
    ? (Array.isArray(body.candidateIds) ? body.candidateIds.map(resourceId => ({ resourceId, kind: typeof resourceId === "string" ? resourceId.split(":")[0] : "", title: "asset" })) : null)
    : body.candidates;
  if (!Array.isArray(suppliedCandidates) || suppliedCandidates.length > config.maxCandidates) {
    throw new ServiceError(400, "INVALID_REQUEST", "候选资源数量不正确。");
  }
  const seen = new Set();
  const candidates = suppliedCandidates.map((candidate) => {
    if (!isObject(candidate)) throw new ServiceError(400, "INVALID_REQUEST", "候选资源格式不正确。");
    const resourceId = textField(candidate.resourceId, "resourceId", 110);
    const kind = candidate.kind;
    if (!/^(sound|effect|bgm):[A-Za-z0-9_-]{1,100}$/.test(resourceId)
      || !["sound", "effect", "bgm"].includes(kind) || !resourceId.startsWith(`${kind}:`)
      || seen.has(resourceId)) {
      throw new ServiceError(400, "INVALID_REQUEST", "候选资源 ID 重复或格式不正确。");
    }
    seen.add(resourceId);
    const keywords = candidate.keywords ?? [];
    if (!Array.isArray(keywords) || keywords.length > 16) {
      throw new ServiceError(400, "INVALID_REQUEST", "候选资源关键词过多。");
    }
    const suggestedUses = candidate.suggestedUses ?? [];
    if (!Array.isArray(suggestedUses) || suggestedUses.length > 3) {
      throw new ServiceError(400, "INVALID_REQUEST", "候选资源用途建议过多。");
    }
    const duration = candidate.duration;
    if (duration !== undefined && (!Number.isFinite(duration) || duration < 0 || duration > 86400)) {
      throw new ServiceError(400, "INVALID_REQUEST", "资源时长格式不正确。");
    }
    if (candidate.hasAudio !== undefined && typeof candidate.hasAudio !== "boolean") {
      throw new ServiceError(400, "INVALID_REQUEST", "资源声音状态格式不正确。");
    }
    return {
      resourceId, kind, title: textField(candidate.title, "title", 200),
      description: textField(candidate.description, "description", 1600, true),
      keywords: keywords.map((word) => textField(word, "keyword", 80)),
      suggestedUses: suggestedUses.map((use) => textField(use, "suggestedUse", 200)),
      ...(duration === undefined ? {} : { duration }),
      ...(candidate.hasAudio === undefined ? {} : { hasAudio: candidate.hasAudio }),
    };
  });
  const requestId = body.requestId ?? crypto.randomUUID();
  if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
    throw new ServiceError(400, "INVALID_REQUEST", "requestId 格式不正确。");
  }
  const audioCandidateIds = body.audioCandidateIds ?? [];
  if (!Array.isArray(audioCandidateIds) || audioCandidateIds.length > config.maxCandidates
    || audioCandidateIds.some(id => typeof id !== "string" || !id.startsWith("effect:") || !seen.has(id))
    || new Set(audioCandidateIds).size !== audioCandidateIds.length) {
    throw new ServiceError(400, "INVALID_REQUEST", "音轨候选必须来自当前特效候选列表。");
  }
  return { query, locale, scope, matchOn, messages, candidates, requestId, resultLimit,
    audioCandidateIds,
    includeEffectAudio: body.includeEffectAudio !== false,
    ...(body.catalogVersion === undefined ? {} : { catalogVersion: textField(body.catalogVersion, "catalogVersion", 128) }) };
}

export function normalizeAgentRequest(body, config, env = {}) {
  if (!isObject(body) || body.workflow !== "agent") throw new ServiceError(400, "INVALID_REQUEST", "请提交有效的资产检索请求。");
  const normalized = normalizeRequest({ ...body, candidateIds: [], candidates: [], audioCandidateIds: [] }, config);
  const previousIds = body.previousIds ?? [];
  if (!Array.isArray(previousIds) || previousIds.length > SEARCH_LIMITS.maxPreviousIds || new Set(previousIds).size !== previousIds.length
    || previousIds.some(id => typeof id !== "string" || !/^(sound|effect|bgm):\d{1,100}$/.test(id))) {
    throw new ServiceError(400, "INVALID_REQUEST", "前一轮资源 ID 格式不正确或数量过多。");
  }
  if (body.includeEffectAudio !== undefined && typeof body.includeEffectAudio !== "boolean") {
    throw new ServiceError(400, "INVALID_REQUEST", "特效音轨选项格式不正确。");
  }
  const { candidates, audioCandidateIds, ...request } = normalized;
  return { ...request, workflow: "agent", previousIds, catalogVersion: catalogInfo(env).catalogVersion };
}

/** Browser-submitted descriptions never become the free model's source of truth. */
export function authoritativeRequest(body, config, env = {}) {
  const normalized = normalizeRequest(body, config);
  const info = catalogInfo(env);
  if (normalized.catalogVersion && normalized.catalogVersion !== info.catalogVersion) {
    throw new ServiceError(409, "CATALOG_VERSION_MISMATCH", "资产索引已更新，请重新搜索。");
  }
  const records = [], missingIds = [];
  for (let offset = 0; offset < normalized.candidates.length; offset += 1) {
    const details = getAssetDetails([normalized.candidates[offset].resourceId], normalized.locale, env);
    records.push(...details.assets ?? details.items ?? []);
    missingIds.push(...details.missingIds ?? []);
  }
  if (missingIds.length || records.length !== normalized.candidates.length) {
    throw new ServiceError(400, "UNKNOWN_ASSET", "候选资源不在当前资产目录中，请重新搜索。");
  }
  const candidates = records.map(item => {
    const audioMatch = item.kind === "effect" && (normalized.scope === "sound" || normalized.matchOn === "audio" || normalized.audioCandidateIds.includes(item.resourceId));
    const hasAudioEvidence = Boolean(item.audioDescription) || (item.audioKeywords ?? []).some(word => typeof word === "string" && word.trim());
    if (normalized.matchOn === "visual" && (item.kind !== "effect" || audioMatch)) {
      throw new ServiceError(400, "ASSET_SCOPE_MISMATCH", "候选资源没有可用于视觉匹配的描述。");
    }
    if (audioMatch && (!(normalized.scope === "sound" || normalized.scope === "all" || normalized.scope === "effect")
      || item.hasAudio !== true || normalized.scope === "sound" && !normalized.includeEffectAudio || !hasAudioEvidence)) {
      throw new ServiceError(400, "ASSET_SCOPE_MISMATCH", "该特效没有可用于匹配的声音描述。");
    }
    if (normalized.scope !== "all" && item.kind !== normalized.scope
      && !(normalized.scope === "sound" && audioMatch && normalized.includeEffectAudio && item.hasAudio === true && hasAudioEvidence)) {
      throw new ServiceError(400, "ASSET_SCOPE_MISMATCH", "候选资源与搜索范围不一致。");
    }
    const description = audioMatch ? item.audioShortDescription || item.audioDescription
      : item.shortDescription || item.description || "";
    return { resourceId: item.resourceId, kind: item.kind, title: item.title.slice(0, 200),
      description: String(description || "").slice(0, 600),
      keywords: (audioMatch ? item.audioKeywords ?? [] : item.keywords ?? []).slice(0, 12).map(word => String(word).slice(0, 80)),
      suggestedUses: (audioMatch ? item.audioSuggestedUses ?? [] : item.suggestedUses ?? []).slice(0, 3).map(use => String(use).slice(0, 200)),
      ...(item.duration === undefined ? {} : { duration: item.duration }),
      ...(audioMatch ? { audioMatch: true } : {}),
      ...(item.hasAudio === undefined ? {} : { hasAudio: item.hasAudio }),
    };
  });
  return { ...normalized, candidates, audioCandidateIds: candidates.filter(item => item.audioMatch).map(item => item.resourceId), catalogVersion: info.catalogVersion };
}

export function catalogInfo(env = {}) {
  const info = getCatalogInfo(env);
  const counts = info.counts ?? { total: info.total ?? info.count ?? 0 };
  const coverage = info.coverage ?? {};
  const total = counts.total ?? info.total ?? 0;
  return { ...info, catalogVersion: info.indexVersion ?? info.catalogVersion, featureSync: featureSync(env),
    counts: { ...counts, total }, coverage: { ...coverage,
      description: typeof coverage.description === "number" ? coverage.description
        : total ? (coverage.describedAssetCount ?? coverage.described ?? 0) / total : 0 },
    mode: embeddingSettings(env).configured ? "hybrid" : "keyword", limits: { ...SEARCH_LIMITS } };
}

export async function searchResult(input, env = {}) {
  const result = await searchAssets(input, env);
  const { indexVersion, candidates, ...metadata } = result;
  return { ...metadata, catalogVersion: indexVersion, featureSync: featureSync(env), items: candidates,
    hasMore: Boolean(result.nextCursor) };
}

export function assetsResult(input, env = {}) {
  if (!isObject(input) || !Array.isArray(input.ids)) throw new ServiceError(400, "INVALID_REQUEST", "请提供资产 ID 列表。");
  const result = getAssetDetails(input.ids, input.locale ?? "zh-CN", env);
  const { indexVersion, assets, ...metadata } = result;
  return { ...metadata, catalogVersion: indexVersion, featureSync: featureSync(env), items: assets };
}

export function embeddingSettings(env) {
  let url;
  try { url = new URL(env.EMBEDDING_URL); } catch { /* disabled */ }
  const rate = Number(env.EMBEDDING_CNY_PER_MILLION);
  const budget = Number(env.MONTHLY_BUDGET_CNY ?? 50);
  const costSafety = Number(env.COST_SAFETY_FACTOR ?? 1.25);
  return { configured: env.RETRIEVAL_MODE === "hybrid" && Boolean(env.ASSET_VECTORIZE && env.SEARCH_LEDGER
      && env.EMBEDDING_API_KEY && env.VISITOR_HASH_SECRET && env.EMBEDDING_MODEL && url?.protocol === "https:"
      && !url.username && !url.password && Number.isFinite(rate) && rate > 0 && Number.isFinite(budget) && budget > 0
      && Number.isFinite(costSafety) && costSafety >= 1),
    upstream: url?.href, model: env.EMBEDDING_MODEL, dimensions: integer(env.EMBEDDING_DIMENSIONS, 1024, 64, 2048),
    inputRate: rate, outputRate: 0, budget, costSafety,
    dailyLimit: integer(env.EMBEDDING_DAILY_LIMIT, 20, 1, 100), maxConcurrency: integer(env.MAX_CONCURRENCY, 4, 1, 20),
    timeoutMs: 15000, maxOutputTokens: 0 };
}

export async function callEmbedding(query, config, env, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const native = new URL(config.upstream).pathname.includes("/services/embeddings/");
    const payload = native
      ? { model: config.model, input: { texts: [query] }, parameters: { dimension: config.dimensions, text_type: "query" } }
      : { model: config.model, input: query, dimensions: config.dimensions, encoding_format: "float" };
    const response = await fetcher(config.upstream, { method: "POST", headers: {
      "content-type": "application/json", authorization: `Bearer ${env.EMBEDDING_API_KEY}` },
      body: JSON.stringify(payload), signal: controller.signal });
    if (!response.ok) throw new ServiceError(502, "EMBEDDING_UNAVAILABLE", "语义检索服务暂时不可用。");
    const data = JSON.parse(await boundedText(response.body, 120000));
    const vector = native ? data?.output?.embeddings?.[0]?.embedding : data?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== config.dimensions || !vector.every(value => Number.isFinite(value))) {
      throw new ServiceError(502, "EMBEDDING_RESPONSE_INVALID", "语义检索返回格式不正确。");
    }
    const inputTokens = data?.usage?.prompt_tokens ?? data?.usage?.total_tokens;
    return { vector, usage: { prompt_tokens: inputTokens, completion_tokens: 0 } };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(503, controller.signal.aborted ? "EMBEDDING_TIMEOUT" : "EMBEDDING_UNAVAILABLE", "语义检索服务暂时不可用。");
  } finally { clearTimeout(timer); }
}

export function buildPrompt(normalized, config, sourceText) {
  config = resultConfig(normalized, config);
  const { query, locale, scope, matchOn = "any", candidates, resultLimit = SEARCH_LIMITS.defaultResults } = normalized;
  const makeMessages = rows => [
    { role: "system", content: renderSystemPrompt(sourceText, resultLimit, "candidates") }, ...normalized.messages,
    { role: "user", content: `当前搜索请求（数据）：\n${JSON.stringify({ query, locale, scope, matchOn, candidates: rows, resultLimit })}` },
  ];
  let messages = makeMessages(candidates);
  let inputBytes = encoder.encode(JSON.stringify(messages)).byteLength;
  if (inputBytes > config.maxPromptBytes) {
    // More cards use shorter summaries instead of raising the input/context budget.
    for (const [descriptionLength, titleLength, keywordCount, fieldLength] of [
      [320, 160, 6, 80], [180, 120, 4, 60], [100, 80, 2, 40], [40, 60, 1, 24], [24, 40, 1, 16],
    ]) {
      const compact = candidates.map(item => ({ ...item, title: item.title.slice(0, titleLength),
        description: item.description.slice(0, descriptionLength),
        keywords: item.keywords.slice(0, keywordCount).map(word => word.slice(0, fieldLength)),
        suggestedUses: item.suggestedUses.slice(0, 1).map(use => use.slice(0, fieldLength)),
      }));
      messages = makeMessages(compact); inputBytes = encoder.encode(JSON.stringify(messages)).byteLength;
      if (inputBytes <= config.maxPromptBytes) break;
    }
    if (inputBytes > config.maxPromptBytes) throw new ServiceError(413, "PROMPT_TOO_LARGE", "问题、上下文和候选描述合计过长，请减少内容。");
  }
  // Byte count is a deliberately generous token estimate for usual UTF-8 tokenizers.
  // Configure correct upstream prices and safety factor; incorrect prices cannot guarantee the cap.
  const reservedMicros = Math.ceil((inputBytes * config.inputRate
    + config.maxOutputTokens * config.outputRate) * config.costSafety);
  return { messages, inputBytes, reservedMicros };
}

function emptySearchAnswer(locale) {
  const messages = {
    "zh-CN": "本次未找到符合描述的资源。可以换一组关键词，或按资源名称、ID 搜索。",
    "zh-TW": "本次未找到符合描述的資源。可以換一組關鍵詞，或依資源名稱、ID 搜尋。",
    "en-US": "No resources matched this description. Try different keywords, an asset name, or an ID.",
    "ja-JP": "説明に一致する素材が見つかりませんでした。別のキーワード、素材名、IDで検索してください。",
    "ru-RU": "Ресурсы по этому описанию не найдены. Попробуйте другие ключевые слова, название ресурса или ID.",
  };
  return messages[locale];
}

export function validateModelResult(value, candidates, resultLimit = SEARCH_LIMITS.defaultResults) {
  if (!isObject(value) || typeof value.answer !== "string" || value.answer.length > 1800
    || !Number.isInteger(resultLimit) || resultLimit < 1 || resultLimit > SEARCH_LIMITS.maxResults || !Array.isArray(value.matches) || value.matches.length > resultLimit) {
    throw new ServiceError(502, "UPSTREAM_RESPONSE_INVALID", "模型返回格式不正确，请稍后再试。");
  }
  const ids = new Set(candidates.map((candidate) => candidate.resourceId));
  const used = new Set();
  const unsafeText = /https?:\/\/|javascript:|data:|<\/?[a-z][^>]*>|\[[^\]]*\]\(/i;
  if (unsafeText.test(value.answer)) throw new ServiceError(502, "UPSTREAM_RESPONSE_INVALID", "模型返回了不受支持的链接或代码。");
  const matches = value.matches.map((match) => {
    if (!isObject(match) || !ids.has(match.resourceId) || used.has(match.resourceId)
      || typeof match.reason !== "string" || match.reason.length > 300
      || unsafeText.test(match.reason) || !["feature", "suggestion"].includes(match.matchType)) {
      throw new ServiceError(502, "UPSTREAM_RESPONSE_INVALID", "模型返回了候选范围外或格式不正确的资源。");
    }
    used.add(match.resourceId);
    return { resourceId: match.resourceId, reason: match.reason, matchType: match.matchType };
  });
  return { answer: value.answer.trim(), matches };
}

function cardResource(item, maxBytes = 3400) {
  const clip = (value, max) => typeof value === "string" ? value.slice(0, max) : "";
  const audioMatch = item.audioMatch === true;
  const description = clip(item.description, 600);
  const keywords = (item.keywords ?? []).slice(0, 6).map(word => clip(word, 80));
  const suggestedUses = (item.suggestedUses ?? []).slice(0, 3).map(use => clip(use, 160));
  // Cards need bounded summaries. Reading full details here duplicated visual/audio text
  // and could make 50 selected cards exceed the browser and ledger response limits.
  const resource = { resourceId: item.resourceId, id: item.id, kind: item.kind,
    title: clip(item.title, 200), href: item.href, descriptionLocale: item.descriptionLocale,
    description: audioMatch ? "" : description, keywords: audioMatch ? [] : keywords,
    suggestedUses: audioMatch ? [] : suggestedUses, hasAudio: item.hasAudio === true,
    ...(audioMatch ? { audioMatch: true, audioDescription: description, audioKeywords: keywords, audioSuggestedUses: suggestedUses } : {}),
    ...(typeof item.duration === "number" && Number.isFinite(item.duration) ? { duration: item.duration } : {}) };
  const byteLength = () => encoder.encode(JSON.stringify(resource)).byteLength;
  // Keep all IDs and descriptions; optional chips yield first when metadata is verbose.
  while (byteLength() > maxBytes && suggestedUses.length) suggestedUses.pop();
  while (byteLength() > maxBytes && keywords.length) keywords.pop();
  const descriptionKey = audioMatch ? "audioDescription" : "description";
  while (byteLength() > maxBytes && resource[descriptionKey].length > 24) {
    resource[descriptionKey] = resource[descriptionKey].slice(0, Math.floor(resource[descriptionKey].length * 0.75));
  }
  while (byteLength() > maxBytes && resource.title.length > 24) resource.title = resource.title.slice(0, Math.floor(resource.title.length * 0.75));
  return resource;
}

export async function callUpstream(normalized, prompt, config, env, fetcher = fetch) {
  config = resultConfig(normalized, config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetcher(config.upstream, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.UPSTREAM_API_KEY}` },
      body: JSON.stringify({ model: config.model, messages: prompt.messages,
        max_tokens: config.maxOutputTokens, stream: false, response_format: { type: "json_object" },
        ...(config.thinking === undefined ? {} : { thinking: { type: config.thinking } }) }),
      signal: controller.signal,
    });
    if (!response.ok) throw new ServiceError(502, "UPSTREAM_REJECTED", "上游模型暂时无法响应，请联系网站维护者。");
    let data;
    try { data = JSON.parse(await boundedText(response.body, MAX_UPSTREAM_BYTES)); }
    catch { throw new ServiceError(502, "UPSTREAM_RESPONSE_INVALID", "上游模型响应无法解析。"); }
    const choice = data?.choices?.[0];
    if (choice?.finish_reason !== "stop" || typeof choice?.message?.content !== "string") {
      throw withModelResponse(new ServiceError(502, "UPSTREAM_RESPONSE_INVALID", "模型回答未完整生成，请稍后再试。"), choice?.message, env);
    }
    let parsed;
    try { parsed = JSON.parse(choice.message.content); }
    catch { throw withModelResponse(new ServiceError(502, "UPSTREAM_RESPONSE_INVALID", "模型回答不是有效 JSON。"), choice.message, env); }
    let result;
    try { result = validateModelResult(parsed, normalized.candidates, normalized.resultLimit); }
    catch (error) { throw withModelResponse(error, choice.message, env); }
    return { result, usage: data.usage };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(503, controller.signal.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE",
      controller.signal.aborted ? "模型响应超时，请稍后重试同一条请求。" : "暂时无法连接上游模型，请稍后再试。");
  } finally { clearTimeout(timer); }
}

export class SearchLedger {
  constructor(state, env) { this.state = state; this.env = env; this.providerBalance = createProviderBalanceGuard(); this.systemPrompt = createSystemPromptLoader(); this.assetCatalog = createAssetCatalogLoader(); }

  async embedding(body, visitor, parentRequestKey) {
    const config = embeddingSettings(this.env);
    if (!config.configured) throw new ServiceError(503, "EMBEDDING_NOT_CONFIGURED", "语义检索尚未配置。");
    const query = textField(body?.query, "query", 2000);
    const fingerprint = await digest(JSON.stringify({ query, model: config.model, dimensions: config.dimensions, upstream: config.upstream }));
    const cacheKey = `embedding-cache:${fingerprint}`;
    const cached = await this.state.storage.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return json({ vector: cached.vector, cached: true });
    const inputBytes = encoder.encode(query).byteLength;
    const prompt = { inputBytes, reservedMicros: Math.ceil(inputBytes * config.inputRate * config.costSafety) };
    const normalized = { requestId: `embed-${fingerprint.slice(0, 32)}-${periods().day}`,
      ...(parentRequestKey ? { parentRequestKey } : {}) };
    const reservation = await this.reserve(`embedding-${visitor}`, normalized, prompt, config, fingerprint);
    if (reservation.cached) return json(reservation.cached.body, reservation.cached.httpStatus);
    await this.state.storage.setAlarm(Date.now() + config.timeoutMs + 15000);
    let outcome;
    try {
      const response = await callEmbedding(query, config, this.env);
      await this.state.storage.put(cacheKey, { vector: response.vector, expiresAt: Date.now() + DAY });
      outcome = { status: 200, body: { vector: response.vector, cached: false }, usage: response.usage };
    } catch (error) {
      outcome = { status: error.status ?? 503, body: { error: { code: error.code ?? "EMBEDDING_UNAVAILABLE", message: "语义检索暂时不可用，使用关键词搜索。" } } };
    }
    const finished = await this.finish(reservation.key, outcome.body, outcome.status, config, prompt, outcome.usage);
    return json(finished?.body ?? outcome.body, finished?.httpStatus ?? outcome.status);
  }

  async expireActive(storage, now) {
    const active = await storage.get("active") || {};
    for (const [key, expiresAt] of Object.entries(active)) {
      if (expiresAt > now) continue;
      const record = await storage.get(key);
      if (record?.status === "processing") {
        record.status = "done";
        record.httpStatus = 503;
        record.body = { error: { code: "UPSTREAM_TIMEOUT", message: "模型请求已超时；此请求的费用预留仍计入预算。" }, quota: record.quota };
        await storage.put(key, record);
      }
      delete active[key];
    }
    await storage.put("active", active);
    return active;
  }

  async info(visitor, config, now = Date.now()) {
    const period = periods(now);
    const info = await this.state.storage.transaction(async (storage) => {
      await this.expireActive(storage, now);
      const used = await storage.get(`daily:${period.day}:${visitor}`) || 0;
      const budget = await storage.get(`budget:${period.month}`) || 0;
      const quota = { limit: config.dailyLimit, remaining: Math.max(0, config.dailyLimit - used), resetAt: period.resetAt };
      const budgetAvailable = budget < Math.floor(config.budget * 1000000);
      const available = config.configured && quota.remaining > 0 && budgetAvailable;
      const code = !config.configured ? "FREE_SERVICE_NOT_CONFIGURED"
        : !quota.remaining ? "FREE_QUOTA_EXHAUSTED" : !budgetAvailable ? "FREE_BUDGET_EXHAUSTED" : undefined;
      const message = !config.configured ? "网站免费 AI 尚未配置；你可以使用自己的模型配置。"
        : !quota.remaining ? "今日免费额度已用完，明日重置。" : !budgetAvailable ? "网站本月免费预算已用完。" : undefined;
      return { configured: config.configured, available, model: config.model,
        models: config.configured ? [{ id: config.model, name: config.modelName, free: true }] : [],
        quota, limits: { maxCandidates: config.maxCandidates, maxMessages: config.maxMessages, maxQueryLength: config.maxQueryLength,
          minBalanceCny: config.minBalanceCny, ...SEARCH_LIMITS },
        agent: { ...AGENT_LIMITS, timeoutMs: config.agentTimeoutMs },
        ...(code ? { error: { code, message } } : {}) };
    });
    // Never hold a ledger transaction open during a provider network request.
    if (!config.configured) return info;
    const balance = await this.providerBalance.check(config, this.env, { cached: true });
    return balance.available ? info : { ...info, available: false,
      error: publicError({ ...balance.error, balanceReason: balance.error.reason }) };
  }

  async reserve(visitor, normalized, prompt, config, fingerprint, now = Date.now()) {
    const period = periods(now);
    const key = `request:${visitor}:${normalized.requestId}`;
    return this.state.storage.transaction(async (storage) => {
      const active = await this.expireActive(storage, now);
      const existing = await storage.get(key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new ServiceError(409, "REQUEST_ID_CONFLICT", "同一 requestId 不能对应不同的搜索内容。");
        if (existing.status === "processing") throw new ServiceError(409, "REQUEST_IN_PROGRESS", "这条搜索仍在处理中，请稍后重试同一 requestId。", { quota: existing.quota });
        return { cached: existing, key };
      }
      const dailyKey = `daily:${period.day}:${visitor}`;
      const used = await storage.get(dailyKey) || 0;
      const quota = { limit: config.dailyLimit, remaining: Math.max(0, config.dailyLimit - used), resetAt: period.resetAt };
      if (used >= config.dailyLimit) throw new ServiceError(429, "FREE_QUOTA_EXHAUSTED", "今日免费额度已用完，明日重置。", { quota });
      const parent = normalized.parentRequestKey ? await storage.get(normalized.parentRequestKey) : null;
      const nested = Boolean(parent?.status === "processing" && active[normalized.parentRequestKey] > now);
      if (normalized.parentRequestKey && !nested) throw new ServiceError(503, "UPSTREAM_TIMEOUT", "资产搜索已超时。");
      // Internal embeddings belong to an existing chat slot, but still expire independently.
      let slots = 0;
      if (!nested) for (const activeKey of Object.keys(active)) {
        const activeRecord = await storage.get(activeKey);
        if (!activeRecord?.parentRequestKey) slots += 1;
      }
      if (!nested && slots >= config.maxConcurrency) throw new ServiceError(429, "FREE_SERVICE_BUSY", "免费服务当前繁忙，请稍后重试。", { quota });
      const budgetKey = `budget:${period.month}`;
      const allocated = await storage.get(budgetKey) || 0;
      if (allocated + prompt.reservedMicros > Math.floor(config.budget * 1000000)) {
        throw new ServiceError(503, "FREE_BUDGET_EXHAUSTED", "网站本月剩余额度不足以完成这条搜索。", { quota });
      }
      quota.remaining -= 1;
      const record = { status: "processing", fingerprint, createdAt: now,
        ...(nested ? { parentRequestKey: normalized.parentRequestKey } : {}),
        budgetKey, reservedMicros: prompt.reservedMicros, quota };
      active[key] = now + config.timeoutMs + 10000;
      await storage.put(dailyKey, used + 1);
      await storage.put(budgetKey, allocated + prompt.reservedMicros);
      await storage.put(key, record);
      await storage.put("active", active);
      return { key, record };
    });
  }

  async finish(key, body, httpStatus, config, prompt, usage) {
    return this.state.storage.transaction(async (storage) => {
      const record = await storage.get(key);
      if (!record || record.status !== "processing") return record;
      // Only a complete successful response with valid bounded usage can release unused reservation.
      const input = usage?.prompt_tokens;
      const output = usage?.completion_tokens;
      if (httpStatus === 200 && Number.isInteger(input) && input >= 0 && input <= prompt.inputBytes
        && Number.isInteger(output) && output >= 0 && output <= config.maxOutputTokens) {
        const chargedMicros = Math.min(record.reservedMicros,
          Math.ceil((input * config.inputRate + output * config.outputRate) * config.costSafety));
        const allocated = await storage.get(record.budgetKey) || record.reservedMicros;
        await storage.put(record.budgetKey, Math.max(0, allocated - record.reservedMicros + chargedMicros));
      }
      record.status = "done";
      record.httpStatus = httpStatus;
      record.body = body;
      await storage.put(key, record);
      const active = await storage.get("active") || {};
      delete active[key];
      await storage.put("active", active);
      return record;
    });
  }

  async fetch(request) {
    let featurePin;
    try {
      const config = settings(this.env);
      const visitor = request.headers.get("x-visitor-key");
      const path = new URL(request.url).pathname;
      if (PUBLIC_RETRIEVAL_PATHS.includes(path) && request.headers.get("x-public-retrieval") === "1") {
        featurePin = embeddingSettings(this.env).configured ? await this.assetCatalog.acquire(this.env, { signal: request.signal }) : undefined;
        const catalogEnv = featurePin ? { ...this.env, ASSET_SEARCH_CATALOG: featurePin.catalog, ASSET_FEATURE_SYNC: featurePin.featureSync } : await withCatalog(this.env, this.assetCatalog);
        if (path.endsWith("/catalog") && request.method === "GET") return json(catalogInfo(catalogEnv));
        if (request.method !== "POST") throw new ServiceError(405, "METHOD_NOT_ALLOWED", "请求方法不受支持。");
        let input;
        try { input = JSON.parse(await boundedText(request.body, MAX_BODY_BYTES)); }
        catch (error) { if (error instanceof ServiceError) throw error; throw new ServiceError(400, "INVALID_JSON", "请求不是有效 JSON。"); }
        const retrievalEnv = { ...catalogEnv };
        if (embeddingSettings(this.env).configured) retrievalEnv.ASSET_EMBEDDING = { embedQuery: async query => {
          if (!visitor || !/^[a-f0-9]{64}$/.test(visitor)) throw new ServiceError(503, "VISITOR_ID_UNAVAILABLE", "无法确定语义检索额度。");
          const response = await this.embedding({ query }, visitor);
          const data = await response.json();
          if (!response.ok) throw new ServiceError(response.status, data.error?.code ?? "EMBEDDING_UNAVAILABLE", "语义检索暂时不可用。");
          return data.vector;
        } };
        if (path.endsWith("/mcp")) return await handleMcp(input, {
          catalog: () => catalogInfo(retrievalEnv), search: args => searchResult(args, retrievalEnv), assets: args => assetsResult(args, retrievalEnv),
        }, request.headers.get("mcp-protocol-version"));
        return json(path.endsWith("/assets") ? assetsResult(input, retrievalEnv) : await searchResult(input, retrievalEnv));
      }
      if (!visitor || !/^[a-f0-9]{64}$/.test(visitor)) throw new ServiceError(403, "FORBIDDEN", "此服务仅供网站访问。");
      if (path === "/api/ai-search/config" && request.method === "GET") {
        const catalogEnv = await withCatalog(this.env, this.assetCatalog);
        return json({ ...await this.info(visitor, config), retrieval: { available: true, ...catalogInfo(catalogEnv) } });
      }
      if (path === "/api/ai-search/embedding" && request.method === "POST") {
        let body;
        try { body = JSON.parse(await boundedText(request.body, 10000)); }
        catch (error) { if (error instanceof ServiceError) throw error; throw new ServiceError(400, "INVALID_JSON", "请求不是有效 JSON。"); }
        return await this.embedding(body, visitor);
      }
      if (path !== "/api/ai-search/chat" || request.method !== "POST") throw new ServiceError(404, "NOT_FOUND", "接口不存在。");
      if (!config.configured) throw new ServiceError(503, "FREE_SERVICE_NOT_CONFIGURED", "网站免费 AI 尚未配置；你可以使用自己的模型配置。");
      let input;
      try { input = JSON.parse(await boundedText(request.body, MAX_BODY_BYTES)); }
      catch (error) { if (error instanceof ServiceError) throw error; throw new ServiceError(400, "INVALID_JSON", "请求不是有效 JSON。"); }
      featurePin = await this.assetCatalog.acquire(this.env, { signal: request.signal });
      const catalogEnv = { ...this.env, ASSET_SEARCH_CATALOG: featurePin.catalog, ASSET_FEATURE_SYNC: featurePin.featureSync };
      const agentMode = input?.workflow === "agent";
      const normalized = agentMode ? normalizeAgentRequest(input, config, catalogEnv) : authoritativeRequest(input, config, catalogEnv);
      // Fresh on every chat, including idempotent retries. No model, quota or budget allocation below the threshold.
      const balance = await this.providerBalance.check(config, this.env, { signal: request.signal });
      if (!balance.available) throw balanceFailure(ServiceError, balance.error);
      if (!agentMode && !normalized.candidates.length) {
        const info = await this.info(visitor, config);
        return json({ answer: emptySearchAnswer(normalized.locale), matches: [], resources: [],
          catalogVersion: normalized.catalogVersion, featureSync: featureSync(catalogEnv), quota: info.quota, requestId: normalized.requestId });
      }
      const searchConfig = resultConfig(normalized, config);
      const sourceText = await this.systemPrompt.read(config, { signal: request.signal });
      const prompt = agentMode ? buildAgentPrompt(normalized, searchConfig, sourceText) : buildPrompt(normalized, searchConfig, sourceText);
      // One chat turn reserves its worst-case three model rounds, and occupies one slot throughout.
      const turnConfig = agentMode ? { ...searchConfig, timeoutMs: searchConfig.agentTimeoutMs,
        maxOutputTokens: searchConfig.maxOutputTokens * AGENT_LIMITS.maxModelRounds } : searchConfig;
      const { requestId, ...requestContents } = normalized;
      const fingerprint = await digest(JSON.stringify(requestContents));
      const reservation = await this.reserve(visitor, normalized, prompt, turnConfig, fingerprint);
      if (reservation.cached) return json(reservation.cached.body, reservation.cached.httpStatus);
      // Alarm releases orphaned concurrency slots and prunes retained history; unknown costs stay reserved.
      await this.state.storage.setAlarm(Date.now() + turnConfig.timeoutMs + 15000);
      let outcome;
      try {
        let firstModelRound = true;
        const guardedFetch = async (url, options) => {
          if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
          if (!firstModelRound) {
            const balance = await this.providerBalance.check(config, this.env, { signal: options.signal });
            if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
            if (!balance.available) throw balanceFailure(AgentError, balance.error);
          }
          firstModelRound = false;
          if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
          return fetch(url, options);
        };
        const retrievalEnv = { ...catalogEnv };
        if (agentMode && embeddingSettings(this.env).configured) {
          retrievalEnv.ASSET_EMBEDDING = { embedQuery: async query => {
            const response = await this.embedding({ query }, visitor, reservation.key);
            const data = await response.json();
            if (!response.ok) throw new ServiceError(response.status, data.error?.code ?? "EMBEDDING_UNAVAILABLE", "语义检索暂时不可用。");
            return data.vector;
          } };
        }
        const upstream = agentMode ? await runAssetAgent(normalized, prompt, searchConfig, this.env, {
          catalog: () => catalogInfo(retrievalEnv), search: args => searchResult(args, retrievalEnv),
          assets: args => assetsResult(args, retrievalEnv),
        }, validateModelResult, guardedFetch) : await callUpstream(normalized, prompt, searchConfig, this.env, guardedFetch);
        // Leave headroom for the model answer/reasons and the ledger record metadata.
        const cardByteBudget = Math.min(3400, Math.floor((110000 - encoder.encode(JSON.stringify(upstream.result)).byteLength) / Math.max(1, upstream.result.matches.length)));
        const resources = upstream.result.matches.map(match => {
          const item = getAssetDetails([match.resourceId], normalized.locale, catalogEnv).assets[0];
          const audioMatch = agentMode ? upstream.records.get(match.resourceId)?.audioMatch === true
            : normalized.audioCandidateIds.includes(match.resourceId);
          return cardResource(audioMatch ? { ...item, audioMatch: true, description: item.audioDescription,
            shortDescription: item.audioShortDescription || item.audioDescription,
            descriptionLocale: item.audioDescriptionLocale,
            keywords: item.audioKeywords ?? [], suggestedUses: item.audioSuggestedUses ?? [] } : item, cardByteBudget);
        });
        outcome = { status: 200, usage: upstream.usage, body: { ...upstream.result,
          resources, catalogVersion: normalized.catalogVersion, featureSync: featureSync(catalogEnv),
          ...(agentMode ? { agent: { steps: upstream.steps, rounds: upstream.rounds } } : {}),
          ...(agentMode && upstream.retrievalMode ? { mode: upstream.retrievalMode } : {}),
          ...(Number.isInteger(upstream.usage?.prompt_tokens) && Number.isInteger(upstream.usage?.completion_tokens)
            ? { usage: { inputTokens: upstream.usage.prompt_tokens, outputTokens: upstream.usage.completion_tokens } } : {}),
          quota: reservation.record.quota, model: config.model, requestId } };
      } catch (error) {
        const serviceError = error instanceof ServiceError || error instanceof AgentError ? error : new ServiceError(503, "SERVICE_ERROR", "搜索服务暂时不可用。");
        outcome = { status: serviceError.status, body: { error: publicError(serviceError),
          quota: reservation.record.quota, requestId } };
      }
      const finished = await this.finish(reservation.key, outcome.body, outcome.status, turnConfig, prompt, outcome.usage);
      return json(finished?.body || outcome.body, finished?.httpStatus || outcome.status);
    } catch (error) { return errorResponse(error); }
    finally { featurePin?.release(); }
  }

  async alarm() {
    const now = Date.now();
    await this.state.storage.transaction((storage) => this.expireActive(storage, now));
    // Scan bounded pages with a persistent cursor: busy low-sorting visitors cannot starve old records.
    // Cloudflare's multi-key delete accepts at most 128 keys per operation.
    const prune = async (prefix, obsolete) => {
      const cursorKey = `cleanup:${prefix}`;
      let cursor = await this.state.storage.get(cursorKey);
      for (let page = 0; page < 10; page += 1) {
        const values = await this.state.storage.list({ prefix, limit: 500, ...(cursor ? { startAfter: cursor } : {}) });
        const keys = [...values.keys()];
        const removed = [...values].filter(([key, value]) => obsolete(key, value)).map(([key]) => key);
        for (let offset = 0; offset < removed.length; offset += 128) {
          await this.state.storage.delete(removed.slice(offset, offset + 128));
        }
        if (values.size < 500) { await this.state.storage.delete(cursorKey); return; }
        cursor = keys[keys.length - 1];
      }
      await this.state.storage.put(cursorKey, cursor);
    };
    // Completed results can echo user text; keep them for at least 48 hours, then prune.
    await prune("request:", (_key, record) => record.status === "done" && now - record.createdAt > 2 * DAY);
    await prune("embedding-cache:", (_key, record) => record.expiresAt < now);
    const cutoffDay = periods(now - 7 * DAY).day;
    await prune("daily:", (key) => key.slice(6, 16) < cutoffDay);
    const cutoffMonth = periods(now - 400 * DAY).month;
    await prune("budget:", (key) => key.slice(7) < cutoffMonth);
    await this.state.storage.setAlarm(now + DAY);
  }
}

export default {
  async fetch(request, env) {
    let cors = {};
    try {
      const url = new URL(request.url);
      const origin = request.headers.get("origin");
      const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
      if (origin && !allowed.includes(origin)) throw new ServiceError(403, "ORIGIN_NOT_ALLOWED", "此来源不能访问免费服务。");
      if (origin) cors = { "access-control-allow-origin": origin, vary: "Origin" };
      const methods = { "/api/ai-search/config": "GET", "/api/ai-search/catalog": "GET", "/api/ai-search/chat": "POST",
        "/api/ai-search/search": "POST", "/api/ai-search/assets": "POST", "/api/ai-search/mcp": "POST", "/mcp": "POST" };
      if (!Object.hasOwn(methods, url.pathname)) throw new ServiceError(404, "NOT_FOUND", "接口不存在。");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors,
        "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, accept, mcp-protocol-version",
        "access-control-expose-headers": "mcp-protocol-version", "access-control-max-age": "600" } });
      if (request.method !== methods[url.pathname]) throw new ServiceError(405, "METHOD_NOT_ALLOWED", "请求方法不受支持。");
      const outgoingResponse = (response) => {
        const headers = new Headers(response.headers);
        for (const [key, value] of Object.entries(cors)) headers.set(key, value);
        headers.set("x-content-type-options", "nosniff");
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      };
      // Real feature files are parsed and validated in the Durable Object, whose CPU allowance
      // covers full catalogs. The ordinary Worker only validates the bounded request and forwards it.
      if (env.ASSET_FEATURES_BASE_URL && [...PUBLIC_RETRIEVAL_PATHS, "/api/ai-search/config"].includes(url.pathname)) {
        if (!env.SEARCH_LEDGER) throw new AssetCatalogError("ASSET_FEATURES_RUNTIME_UNAVAILABLE");
        let body;
        if (request.method === "POST") {
          if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ServiceError(415, "CONTENT_TYPE_NOT_SUPPORTED", "请使用 application/json。");
          body = await boundedText(request.body, MAX_BODY_BYTES);
        }
        const headers = new Headers({ "x-public-retrieval": "1" });
        if (request.method === "POST") headers.set("content-type", "application/json");
        const protocol = request.headers.get("mcp-protocol-version"); if (protocol) headers.set("mcp-protocol-version", protocol);
        const ip = request.headers.get("cf-connecting-ip");
        if (ip) headers.set("x-visitor-key", await digest(`${env.VISITOR_HASH_SECRET || "unconfigured"}\n${ip}`));
        const id = env.SEARCH_LEDGER.idFromName("global-budget-v1");
        const response = await env.SEARCH_LEDGER.get(id).fetch(new Request(`https://ledger.internal${url.pathname}`, { method: request.method, headers, body, signal: request.signal }));
        return outgoingResponse(response);
      }
      // Explicitly injected and identity-only local catalogs remain usable without a remote source.
      const catalogEnv = url.pathname.endsWith("/chat") ? env : await withCatalog(env);
      if (url.pathname === "/api/ai-search/catalog") return outgoingResponse(json(catalogInfo(catalogEnv)));
      let publicBody;
      if (request.method === "POST") {
        if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
          throw new ServiceError(415, "CONTENT_TYPE_NOT_SUPPORTED", "请使用 application/json。");
        }
        publicBody = await boundedText(request.body, MAX_BODY_BYTES);
      }
      const getInput = () => {
        try { return JSON.parse(publicBody); }
        catch { throw new ServiceError(400, "INVALID_JSON", "请求不是有效 JSON。"); }
      };
      if (["/api/ai-search/search", "/api/ai-search/assets", "/api/ai-search/mcp", "/mcp"].includes(url.pathname)) {
        const retrievalEnv = { ...catalogEnv };
        if (embeddingSettings(env).configured) {
          retrievalEnv.ASSET_EMBEDDING = { embedQuery: async (query) => {
            const ip = request.headers.get("cf-connecting-ip");
            if (!ip) throw new ServiceError(503, "VISITOR_ID_UNAVAILABLE", "无法确定语义检索额度。");
            const visitor = await digest(`${env.VISITOR_HASH_SECRET}\n${ip}`);
            const id = env.SEARCH_LEDGER.idFromName("global-budget-v1");
            const response = await env.SEARCH_LEDGER.get(id).fetch(new Request("https://ledger.internal/api/ai-search/embedding", {
              method: "POST", headers: { "x-visitor-key": visitor, "content-type": "application/json" }, body: JSON.stringify({ query }) }));
            const data = await response.json();
            if (!response.ok) throw new ServiceError(response.status, data.error?.code ?? "EMBEDDING_UNAVAILABLE", "语义检索暂时不可用。");
            return data.vector;
          } };
        }
        const input = getInput();
        if (url.pathname.endsWith("/mcp")) return outgoingResponse(await handleMcp(input, {
          catalog: () => catalogInfo(retrievalEnv), search: args => searchResult(args, retrievalEnv), assets: args => assetsResult(args, retrievalEnv),
        }, request.headers.get("mcp-protocol-version")));
        return outgoingResponse(json(url.pathname.endsWith("/assets") ? assetsResult(input, retrievalEnv) : await searchResult(input, retrievalEnv)));
      }
      if (!env.SEARCH_LEDGER || (url.pathname.endsWith("/config") && !settings(env).configured)) {
        if (url.pathname.endsWith("/config")) return outgoingResponse(json({ configured: false, available: false, models: [],
          limits: { ...SEARCH_LIMITS, minBalanceCny: settings(env).minBalanceCny },
          agent: { ...AGENT_LIMITS, timeoutMs: settings(env).agentTimeoutMs },
          retrieval: { available: true, ...catalogInfo(catalogEnv) }, error: { code: "FREE_SERVICE_NOT_CONFIGURED", message: "网站免费 AI 尚未配置。" } }));
        throw new ServiceError(503, "FREE_SERVICE_NOT_CONFIGURED", "网站免费服务尚未部署。");
      }
      // CF-Connecting-IP is supplied by Cloudflare; do not trust client-chosen visitor IDs or X-Forwarded-For.
      const ip = request.headers.get("cf-connecting-ip");
      if (!ip) throw new ServiceError(503, "VISITOR_ID_UNAVAILABLE", "无法确定匿名访客额度，请稍后再试。");
      const visitor = await digest(`${env.VISITOR_HASH_SECRET || "unconfigured"}\n${ip}`);
      const headers = new Headers({ "x-visitor-key": visitor });
      const body = publicBody;
      if (request.method === "POST") headers.set("content-type", "application/json");
      const id = env.SEARCH_LEDGER.idFromName("global-budget-v1");
      const response = await env.SEARCH_LEDGER.get(id).fetch(new Request(`https://ledger.internal${url.pathname}`, { method: request.method, headers, body, signal: request.signal }));
      if (url.pathname.endsWith("/config")) {
        const payload = await response.json();
        return outgoingResponse(json({ ...payload, retrieval: { available: true, ...catalogInfo(catalogEnv) } }, response.status));
      }
      const outgoing = new Headers(response.headers);
      for (const [key, value] of Object.entries(cors)) outgoing.set(key, value);
      outgoing.set("x-content-type-options", "nosniff");
      return new Response(response.body, { status: response.status, headers: outgoing });
    } catch (error) {
      const response = errorResponse(error);
      for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
      return response;
    }
  },
};
