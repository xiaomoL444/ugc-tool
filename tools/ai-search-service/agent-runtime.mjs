/* The model proposes calls; this host executes the same read-only asset functions as MCP. */
import { ASSET_TOOLS } from "./mcp-handler.mjs";
import { renderSystemPrompt } from "./system-prompt.mjs";
import { withModelResponse } from "./model-response.mjs";
import { parseModelJSON } from "./model-json.mjs";
import { selectSuggestedUses } from "./asset-use-summary.mjs";

const encoder = new TextEncoder();
export const AGENT_LIMITS = Object.freeze({ available: true, maxModelRounds: 3, maxToolCalls: 4 });
export const SEARCH_LIMITS = Object.freeze({ maxResults: 50, defaultResults: 10, maxPreviousIds: 50, maxExcludeIds: 50, maxSearchLimit: 50, maxAssetIds: 10 });
export function resultConfig(request, config) {
  const limit = request.resultLimit ?? SEARCH_LIMITS.defaultResults;
  if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_LIMITS.maxResults) throw new AgentError(400, "INVALID_REQUEST", "结果数量必须是 1 至 50 的整数。");
  const outputBudget = limit <= 5 ? 800 : limit <= 10 ? 1400 : limit <= 20 ? 2400 : 2400 + (limit - 20) * 100;
  return { ...config, maxOutputTokens: Math.min(config.maxOutputTokens, outputBudget) };
}
export class AgentError extends Error {
  constructor(status, code, message) { super(message); this.name = "AgentError"; this.status = status; this.code = code; }
}
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const bytes = value => encoder.encode(JSON.stringify(value)).byteLength;
const text = (value, max) => typeof value === "string" ? value.slice(0, max) : "";
export function assetFunctionTools(request = {}) {
  return ASSET_TOOLS.map(tool => {
    const parameters = structuredClone(tool.inputSchema);
    let description = tool.description;
    if (tool.name === "search_assets") {
      parameters.properties.limit = { type: "integer", minimum: 1, maximum: SEARCH_LIMITS.maxSearchLimit, default: Math.max(10, request.resultLimit ?? SEARCH_LIMITS.defaultResults) };
      parameters.properties.query.description = "For game-use requests, feature queries contain 2–4 acoustic terms (attack, texture, pitch, rhythm or decay), not game object names or use-case sentences. both queries contain short behavior/stage terms. Known-name lookup may use the exact name.";
    }
    if (tool.name === "search_assets") description += " For pagination, use only cursor from nextCursor and keep all other search arguments identical. A rewritten query starts without cursor. Never invent previousCursor.";
    if (tool.name === "get_assets") {
      parameters.properties.ids.maxItems = 5;
      description = "Read details of up to 5 resource IDs returned by search_assets in this turn. Select only the most useful candidates; do not request every search result. Sound judgments require the resource's own audio evidence.";
    }
    return { type: "function", function: { name: tool.name, description, parameters } };
  });
}

export function buildAgentPrompt(request, config, sourceText) {
  config = resultConfig(request, config);
  const tools = assetFunctionTools(request);
  const messages = [{ role: "system", content: renderSystemPrompt(sourceText, request.resultLimit ?? SEARCH_LIMITS.defaultResults, "agent") }, ...request.messages,
    { role: "user", content: `当前搜索请求（数据）：${JSON.stringify({ query: request.query, locale: request.locale,
      scope: request.scope, matchOn: request.matchOn ?? "any", includeEffectAudio: request.includeEffectAudio, previousIds: request.previousIds, resultLimit: request.resultLimit ?? SEARCH_LIMITS.defaultResults })}` }];
  if (bytes({ messages, tools }) > config.maxPromptBytes) throw new AgentError(413, "PROMPT_TOO_LARGE", "问题和上下文过长，请减少内容或开始新对话。");
  return { messages, tools, inputBytes: config.maxPromptBytes * AGENT_LIMITS.maxModelRounds,
    reservedMicros: Math.ceil((config.maxPromptBytes * config.inputRate + config.maxOutputTokens * config.outputRate)
      * AGENT_LIMITS.maxModelRounds * config.costSafety) };
}

function compactRecord(item, details = false, query = "") {
  const detailDescription = item.description && item.fullDescription && !item.description.includes(item.fullDescription)
    ? `${item.description}\n${item.fullDescription}` : item.description || item.fullDescription || item.shortDescription;
  return { resourceId: item.resourceId, kind: item.kind, title: text(item.title, 200),
    description: text(details && item.kind === "effect" ? item.shortDescription || item.description : details ? detailDescription : item.shortDescription || item.description,
      details && item.kind === "effect" ? 160 : details ? 900 : 260),
    keywords: (item.keywords ?? []).slice(0, 10).map(word => text(word, 80)),
    suggestedUses: selectSuggestedUses(item.suggestedUses ?? [], query, 3, 160),
    ...(item.audioMatch ? { audioMatch: true } : {}),
    ...(item.matchType ? { matchType: item.matchType } : {}),
    ...(item.duration === undefined ? {} : { duration: item.duration }),
    ...(item.hasAudio === undefined ? {} : { hasAudio: item.hasAudio }),
    ...(details && item.kind === "effect" ? { visualDescription: text(item.visualDescription || (!item.audioMatch ? detailDescription : ""), 600),
      audioDescription: text(item.audioDescription || (item.audioMatch ? detailDescription : ""), 600),
      audioKeywords: (item.audioKeywords ?? (item.audioMatch ? item.keywords : []) ?? []).slice(0, 6).map(word => text(word, 80)) } : {}),
    ...(item.descriptionLocale ? { descriptionLocale: item.descriptionLocale } : {}) };
}

// Preserve every trusted ID and evidence facet; several tool replies share one prompt budget.
function compactSearchValue(value, callId, messages, tools, maxPromptBytes) {
  const fits = (candidate, history = messages) => bytes({ messages: [...history, { role: "tool", tool_call_id: callId, content: JSON.stringify(candidate) }], tools }) + 512 <= maxPromptBytes;
  if (fits(value)) return value;
  const shorten = (input, [descriptionLength, titleLength, keywordCount, fieldLength, useCount]) => ({ ...input,
    items: input.items.map(item => ({ ...item,
      title: text(item.title, titleLength), description: text(item.description, descriptionLength),
      keywords: (item.keywords ?? []).slice(0, keywordCount).map(word => text(word, fieldLength)),
      suggestedUses: (item.suggestedUses ?? []).slice(0, useCount).map(word => text(word, fieldLength)),
      ...(Object.hasOwn(item, "visualDescription") ? { visualDescription: text(item.visualDescription, descriptionLength) } : {}),
      ...(Object.hasOwn(item, "audioDescription") ? { audioDescription: text(item.audioDescription, descriptionLength) } : {}),
      ...(Object.hasOwn(item, "audioKeywords") ? { audioKeywords: (item.audioKeywords ?? []).slice(0, keywordCount).map(word => text(word, fieldLength)) } : {}),
    })), summariesShortened: true });
  const previous = messages.map(message => {
    if (message.role !== "tool") return null;
    try { const parsed = JSON.parse(message.content); return Array.isArray(parsed.items) ? parsed : null; } catch { return null; }
  });
  for (const level of [
    [180, 120, 4, 60, 1], [120, 100, 2, 40, 1], [80, 80, 1, 32, 1], [40, 60, 1, 24, 1], [24, 40, 1, 16, 1],
    [16, 32, 1, 12, 1], [8, 20, 1, 8, 1], [8, 12, 1, 8, 0],
  ]) {
    const candidate = shorten(value, level);
    if (fits(candidate)) return candidate;
    const history = messages.map((message, index) => previous[index]
      ? { ...message, content: JSON.stringify(shorten(previous[index], level)) } : message);
    if (fits(candidate, history)) {
      for (let index = 0; index < messages.length; index++) messages[index] = history[index];
      return candidate;
    }
  }
  throw new AgentError(413, "PROMPT_TOO_LARGE", "工具结果与上下文过长，请开始新对话或缩小范围。");
}

function scopedRecord(item, request, audioHint = false) {
  if (!object(item) || !/^(sound|effect|bgm):\d+$/.test(item.resourceId ?? "")) return null;
  const audioMatch = item.kind === "effect" && (request.scope === "sound" || request.matchOn === "audio" || audioHint || item.audioMatch === true);
  if (request.matchOn === "visual" && (item.kind !== "effect" || audioMatch)) return null;
  if (request.scope !== "all" && item.kind !== request.scope
    && !(request.scope === "sound" && audioMatch && request.includeEffectAudio)) return null;
  if (audioMatch) {
    // Search returns audio-facet summaries; details additionally carry the original visual description.
    const audioDescription = item.audioDescription || (item.audioMatch === true ? item.description : "") || item.audioShortDescription;
    const audioKeywords = item.audioKeywords ?? (item.audioMatch ? item.keywords : []) ?? [];
    if (request.scope === "sound" && !request.includeEffectAudio || item.hasAudio !== true
      || !audioDescription && !audioKeywords.some(word => typeof word === "string" && word.trim())) return null;
    const visualDescription = item.visualDescription || (item.audioMatch ? "" : [item.description, item.fullDescription].filter(Boolean).join("\n"));
    return { ...item, audioMatch: true, visualDescription, audioDescription, description: audioDescription, shortDescription: item.audioShortDescription || audioDescription,
      fullDescription: audioDescription,
      keywords: audioKeywords,
      suggestedUses: item.audioSuggestedUses ?? (item.audioMatch ? item.suggestedUses : []) ?? [] };
  }
  return item;
}

async function boundedResponse(response, limit = 65536) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  let size = 0; const chunks = [];
  try {
    while (true) { const value = await reader.read(); if (value.done) break;
      size += value.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new AgentError(502, "UPSTREAM_RESPONSE_INVALID", "模型响应内容过长。"); }
      chunks.push(value.value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(buffer);
}

async function modelRound(messages, tools, config, env, fetcher, forcedFinal, remainingMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, remainingMs));
  try {
    const deepSeekApi = new URL(config.upstream).hostname === "api.deepseek.com";
    const payload = { model: config.model, messages, max_tokens: config.maxOutputTokens, stream: false, tools,
      tool_choice: forcedFinal ? "none" : "auto",
      ...(forcedFinal ? { response_format: { type: "json_object" } } : {}),
      // DeepSeek thinking needs reasoning transcripts. Search uses its supported non-thinking tool path.
      ...(config.thinking === undefined && !deepSeekApi ? {} : { thinking: { type: "disabled" } }) };
    const response = await fetcher(config.upstream, { method: "POST", headers: {
      "content-type": "application/json", authorization: `Bearer ${env.UPSTREAM_API_KEY}` },
      body: JSON.stringify(payload), signal: controller.signal });
    if (!response.ok) {
      if ([400, 404, 422].includes(response.status)) {
        let rejection = ""; try { rejection = await boundedResponse(response, 10000); } catch { /* never expose raw provider text */ }
        if (/(?:not support|unsupported|not available|not enabled|unknown parameter|unrecognized)[\s\S]{0,160}(?:tools?|function|tool_choice)|(?:tools?|function|tool_choice)[\s\S]{0,160}(?:not support|unsupported|not available|not enabled)/i.test(rejection)) {
          throw new AgentError(502, "TOOLS_UNSUPPORTED", "当前免费模型接口不支持工具调用，请维护者配置支持 function calling 的模型。");
        }
      }
      throw new AgentError(502, "UPSTREAM_REJECTED", "上游模型暂时无法响应，请联系网站维护者。");
    }
    let data; try { data = JSON.parse(await boundedResponse(response)); }
    catch (error) { if (error instanceof AgentError) throw error; throw new AgentError(502, "UPSTREAM_RESPONSE_INVALID", "模型响应无法解析。"); }
    const choice = data?.choices?.[0];
    if (!object(choice?.message) || !["stop", "tool_calls"].includes(choice.finish_reason)) {
      throw withModelResponse(new AgentError(502, "UPSTREAM_RESPONSE_INVALID", "模型回答未完整生成，请稍后重试。"), choice?.message, env);
    }
    return { message: choice.message, finishReason: choice.finish_reason, usage: data.usage };
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError(503, controller.signal.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE",
      controller.signal.aborted ? "资产搜索超时，请稍后重试同一请求。" : "暂时无法连接上游模型。");
  } finally { clearTimeout(timer); }
}

function toolArguments(call) {
  if (!object(call) || call.type !== "function" || typeof call.id !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(call.id)
    || !object(call.function) || typeof call.function.name !== "string" || typeof call.function.arguments !== "string"
    || call.function.arguments.length > 6000) throw new AgentError(502, "TOOL_ARGUMENTS", "模型工具调用格式不正确。");
  let args; try { args = JSON.parse(call.function.arguments); } catch { throw new AgentError(502, "TOOL_ARGUMENTS", "模型工具参数不是有效 JSON。"); }
  if (!object(args)) throw new AgentError(502, "TOOL_ARGUMENTS", "模型工具参数格式不正确。");
  return args;
}

/** One visitor turn, bounded model rounds, bounded tool calls, no provider retry. */
export async function runAssetAgent(request, prompt, config, env, handlers, validateResult, fetcher = fetch) {
  config = resultConfig(request, config);
  const messages = structuredClone(prompt.messages), tools = prompt.tools;
  const known = new Map(), knownQueries = new Map(), steps = [], callIds = new Set();
  let toolCount = 0, inputTokens = 0, outputTokens = 0, usageKnown = true, retrievalMode;
  const deadline = Date.now() + config.agentTimeoutMs;
  for (let round = 0; round < AGENT_LIMITS.maxModelRounds; round += 1) {
    const forcedFinal = round === AGENT_LIMITS.maxModelRounds - 1 || toolCount >= AGENT_LIMITS.maxToolCalls;
    if (bytes({ messages, tools }) > config.maxPromptBytes) throw new AgentError(413, "PROMPT_TOO_LARGE", "工具结果与上下文过长，请开始新对话或缩小范围。");
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new AgentError(503, "UPSTREAM_TIMEOUT", "资产搜索超时，请稍后重试同一请求。");
    const response = await modelRound(messages, tools, config, env, fetcher, forcedFinal, remainingMs);
    const usage = response.usage;
    if (Number.isInteger(usage?.prompt_tokens) && usage.prompt_tokens >= 0 && usage.prompt_tokens <= config.maxPromptBytes
      && Number.isInteger(usage?.completion_tokens) && usage.completion_tokens >= 0 && usage.completion_tokens <= config.maxOutputTokens) {
      inputTokens += usage.prompt_tokens; outputTokens += usage.completion_tokens;
    } else usageKnown = false;
    const message = response.message;
    if (!message.tool_calls?.length) {
      if (response.finishReason !== "stop" || typeof message.content !== "string") throw withModelResponse(new AgentError(502, "UPSTREAM_RESPONSE_INVALID", "模型回答格式不正确。"), message, env);
      let parsed; try { parsed = parseModelJSON(message.content); } catch { throw withModelResponse(new AgentError(502, "UPSTREAM_RESPONSE_INVALID", "模型最终回答不是有效 JSON。"), message, env); }
      // Before any catalogue lookup, only an explicit clarification may finish without tools.
      const clarification = object(parsed) && Object.hasOwn(parsed, "clarification");
      if (clarification) {
        if (parsed.clarification !== true || !Array.isArray(parsed.matches) || parsed.matches.length
          || typeof parsed.answer !== "string" || !parsed.answer.trim()) {
          throw withModelResponse(new AgentError(502, "UPSTREAM_RESPONSE_INVALID", "模型澄清回答格式不正确。"), message, env);
        }
        // Consume only this protocol marker; keep all other fields for the existing result validator.
        delete parsed.clarification;
      } else if (round === 0) {
        throw new AgentError(502, "TOOLS_UNSUPPORTED", "模型未执行要求的资料库工具调用，请切换支持 function calling 的模型。");
      }
      let result;
      try { result = validateResult(parsed, [...known.values()], request.resultLimit ?? SEARCH_LIMITS.defaultResults); }
      catch (error) { throw withModelResponse(error, message, env); }
      return { result, records: known, steps, rounds: round + 1,
        ...(retrievalMode ? { retrievalMode } : {}),
        ...(usageKnown ? { usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens } } : {}) };
    }
    if (forcedFinal || response.finishReason !== "tool_calls" || !Array.isArray(message.tool_calls)
      || toolCount + message.tool_calls.length > AGENT_LIMITS.maxToolCalls) {
      throw new AgentError(502, "AGENT_LIMIT", "模型超出本轮可执行的检索次数，请重新描述需求。");
    }
    const prepared = message.tool_calls.map(call => {
      const args = toolArguments(call);
      if (callIds.has(call.id)) throw new AgentError(502, "UPSTREAM_RESPONSE_INVALID", "模型工具调用 ID 重复。");
      callIds.add(call.id);
      if (!tools.some(tool => tool.function.name === call.function.name)) throw new AgentError(502, "UPSTREAM_RESPONSE_INVALID", "模型请求了未知工具。");
      return { call, args };
    });
    messages.push({ role: "assistant", content: typeof message.content === "string" ? message.content : null,
      tool_calls: message.tool_calls.map(call => ({ id: call.id, type: "function", function: call.function })) });
    for (const { call, args } of prepared) {
      toolCount += 1; let value;
      try {
        if (call.function.name === "search_assets") {
          const scope = request.scope === "all" && ["all", "sound", "effect", "bgm"].includes(args.scope) ? args.scope : request.scope;
          const matchOn = request.matchOn && request.matchOn !== "any" ? request.matchOn : args.matchOn ?? "any";
          if (!["any", "visual", "audio"].includes(matchOn)) throw new AgentError(400, "INVALID_MATCH_ON", "匹配证据仅支持 any、visual 或 audio。");
          const result = await handlers.search({ ...args, query: args.query, scope, matchOn, locale: request.locale,
            includeEffectAudio: request.includeEffectAudio, limit: Math.min(SEARCH_LIMITS.maxSearchLimit, Number.isInteger(args.limit) ? Math.max(1, args.limit) : Math.max(10, request.resultLimit ?? SEARCH_LIMITS.defaultResults)) });
          if (["keyword", "hybrid"].includes(result.mode)) retrievalMode = result.mode;
          const items = (result.items ?? result.candidates ?? []).map(item => scopedRecord(item, { ...request, scope, matchOn })).filter(Boolean);
          for (const item of items) { known.set(item.resourceId, item); knownQueries.set(item.resourceId, `${knownQueries.get(item.resourceId) || request.query} ${args.query}`); }
          value = { catalogVersion: result.catalogVersion ?? result.indexVersion, mode: result.mode, total: result.total,
            items: items.map(item => compactRecord(item, false, knownQueries.get(item.resourceId))), nextCursor: result.nextCursor, hasMore: Boolean(result.nextCursor),
            ...(result.retrievalWarning ? { retrievalWarning: result.retrievalWarning } : {}),
            ...(result.retrievalNotice ? { retrievalNotice: result.retrievalNotice } : {}) };
          steps.push({ tool: call.function.name, query: text(args.query, 160), count: items.length });
        } else if (call.function.name === "get_assets") {
          if (!Array.isArray(args.ids) || args.ids.length > 5) throw new AgentError(400, "INVALID_REQUEST", "每次最多读取5个资源的详情。");
          if (args.ids.some(id => !known.has(id))) throw new AgentError(400, "UNOBSERVED_ASSET", "详情只能读取本轮搜索已经返回的资源 ID。");
          const result = await handlers.assets({ ids: args.ids, locale: request.locale });
          const items = (result.items ?? result.assets ?? []).filter(item => args.ids.includes(item.resourceId) && known.has(item.resourceId))
            .map(item => scopedRecord(item, request, known.get(item.resourceId)?.audioMatch === true)).filter(Boolean);
          for (const item of items) known.set(item.resourceId, item);
          value = { catalogVersion: result.catalogVersion ?? result.indexVersion, items: items.map(item => compactRecord(item, true, knownQueries.get(item.resourceId) || request.query)),
            missingIds: [...(result.missingIds ?? []), ...args.ids.filter(id => !items.some(item => item.resourceId === id) && !(result.missingIds ?? []).includes(id))] };
          steps.push({ tool: call.function.name, count: items.length });
        } else {
          if (Object.keys(args).length) throw new AgentError(400, "INVALID_REQUEST", "目录工具不接受参数。");
          const info = await handlers.catalog();
          value = { catalogVersion: info.catalogVersion ?? info.indexVersion, counts: info.counts, mode: info.mode,
            coverage: info.coverage, locales: info.locales, descriptionFallbackLocale: info.descriptionFallbackLocale };
          steps.push({ tool: call.function.name });
        }
      } catch (error) {
        value = { error: { code: error.code ?? "SEARCH_UNAVAILABLE", message: error.code ? text(error.message, 220) : "资产检索暂时不可用。" } };
        steps.push({ tool: call.function.name, error: value.error.code });
      }
      if (Array.isArray(value.items)) value = compactSearchValue(value, call.id, messages, tools, config.maxPromptBytes);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(value) });
    }
    if (round === AGENT_LIMITS.maxModelRounds - 2 || toolCount >= AGENT_LIMITS.maxToolCalls) {
      messages.push({ role: "user", content: "检索次数已到上限。现在根据本轮工具结果给出最终 JSON。候选少也照常展示；用途请求优先给有声音依据的候选，近似方案说明吻合与差异，可同时追问期望感受。不把未命中说成资料不足，不编造资源或声学特征；仅在本轮没有可依据的候选时返回空 matches。" });
    }
  }
  throw new AgentError(502, "AGENT_LIMIT", "模型未在限定次数内完成回答。");
}
