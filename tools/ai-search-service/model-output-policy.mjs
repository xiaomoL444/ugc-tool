/* Shared by the browser and Worker. Detection is local; it never probes an API. */
export const OUTPUT_MODES = Object.freeze(["auto", "json_schema", "json_object", "prompt"]);
export const OUTPUT_CONSTRAINTS = Object.freeze(["json_schema", "json_object", "prompt"]);

/** Sections reference the already validated, unique final matches; they cannot add assets. */
export function normalizeAnswerSections(value, resourceIds) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new TypeError("RESPONSE_FORMAT");
  const allowed = new Set(resourceIds), used = new Set();
  if (value.length && allowed.size !== resourceIds.length) throw new TypeError("RESPONSE_ASSET_ID");
  const sections = value.map(section => {
    if (!section || typeof section !== "object" || Array.isArray(section)
      || Object.keys(section).some(key => !["answer", "resourceIds"].includes(key))
      || typeof section.answer !== "string" || !section.answer.trim() || section.answer.length > 1800
      || !Array.isArray(section.resourceIds) || section.resourceIds.length > 50) throw new TypeError("RESPONSE_FORMAT");
    for (const id of section.resourceIds) {
      if (typeof id !== "string" || !allowed.has(id) || used.has(id)) throw new TypeError("RESPONSE_ASSET_ID");
      used.add(id);
    }
    return { answer: section.answer.trim(), resourceIds: [...section.resourceIds] };
  });
  if (sections.length && used.size !== allowed.size) throw new TypeError("RESPONSE_ASSET_ID");
  return sections;
}

export function detectModelOutput(config) {
  let host = "", path = "";
  try { const url = new URL(config.baseUrl ?? config.upstream); host = url.hostname; path = url.pathname; } catch { /* Editing an incomplete URL. */ }
  const model = String(config.model ?? "").trim().toLowerCase().split("/").pop();
  const protocol = config.protocol === "anthropic" || config.protocol !== "openai" && (host === "api.anthropic.com" || /\/v1\/messages\/?$/u.test(path)) ? "anthropic" : "openai";
  const official = host === "api.openai.com" ? "openai" : host === "api.anthropic.com" ? "claude" : host === "api.deepseek.com" ? "deepseek"
    : ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"].includes(host) || host.endsWith(".maas.aliyuncs.com") ? "qwen"
    : host === "ark.cn-beijing.volces.com" ? "doubao" : undefined;
  const named = /^(?:gpt-|chatgpt-|o[134](?:-|$))/u.test(model) ? "openai" : /^claude-/u.test(model) ? "claude"
    : /^deepseek-/u.test(model) ? "deepseek" : /^qwen/u.test(model) ? "qwen" : /^doubao-/u.test(model) ? "doubao" : undefined;
  // Hosted catalogues and gateways may serve families other than their own.
  const provider = named ?? official ?? "unknown";
  const inferred = !official || Boolean(named && named !== official);
  let mode = "prompt";
  if (protocol === "anthropic") {
    // Native Claude structured outputs: Opus/Sonnet/Haiku 4.5+.
    if (provider === "claude" && /^claude-(?:opus|sonnet|haiku)-(?:4-[5-9]|[5-9](?:-|$))/u.test(model)) mode = "json_schema";
  } else if (provider === "deepseek") mode = host === "api.deepseek.com" && /^(?:deepseek-flash|deepseek-v4-pro)(?:-|$)/u.test(model) ? "json_schema" : "json_object";
  else if (provider === "qwen") {
    // Bailian's Responses reference omits text.format and silently ignores unlisted parameters.
    // Do not claim its Chat Completions schema support transfers to Responses.
    mode = "prompt";
  } else if (provider === "doubao") mode = /^doubao-seed-2-[01]-(?:pro|lite|mini)(?:-|$)/u.test(model) ? "json_schema" : "json_object";
  else if (provider === "openai") {
    const dated4o = /^gpt-4o-(\d{4}-\d{2}-\d{2})$/u.exec(model);
    const old4o = dated4o && dated4o[1] < "2024-08-06";
    if (!old4o && /^(?:gpt-(?:4o(?:-|$)|4\.[15](?:-|$)|[5-9](?:[.-]|$))|chatgpt-4o(?:-|$)|o[134](?:-|$))/u.test(model)
      && !/^o1-(?:preview|mini)(?:-|$)/u.test(model)) mode = "json_schema";
    else if (/^gpt-(?:3\.5-turbo|4-turbo|4o)(?:-|$)/u.test(model)) mode = "json_object";
  } else if (provider === "claude") mode = "json_object"; // An OpenAI-compatible bridge, not native Claude Schema.
  const requested = OUTPUT_MODES.includes(config.outputMode) ? config.outputMode : "auto";
  if (requested !== "auto") mode = requested;
  // Native Messages has no OpenAI json_object parameter.
  if (protocol === "anthropic" && mode === "json_object") mode = "prompt";
  return { provider, protocol, mode, inferred, requested };
}

export function searchAnswerSchema(ids, resultLimit = 10, agent = false, native = false) {
  const allowed = [...new Set(ids.filter(id => typeof id === "string" && /^(sound|effect|bgm):\d{1,12}$/u.test(id)))];
  const matches = { type: "array", items: { type: "object", additionalProperties: false,
    properties: { resourceId: { type: "string", enum: allowed.length ? allowed : [""] },
      reason: { type: "string" }, matchType: { type: "string", enum: ["feature", "suggestion"] } },
    required: ["resourceId", "reason", "matchType"] } };
  // Claude does not support array-length constraints. The host always checks them.
  if (!native) matches.maxItems = allowed.length ? Math.min(50, Math.max(1, resultLimit)) : 0;
  const sections = { type: "array", description: "For multiple requested sounds or effects, give separate answer-and-card sections in request order. Use [] for a single request. Each final match ID belongs to exactly one section.",
    items: { type: "object", additionalProperties: false, properties: { answer: { type: "string" },
      resourceIds: { type: "array", items: { type: "string", enum: allowed.length ? allowed : [""] } } }, required: ["answer", "resourceIds"] } };
  if (!native) { sections.maxItems = 8; sections.items.properties.resourceIds.maxItems = matches.maxItems; }
  return { type: "object", additionalProperties: false,
    properties: { answer: { type: "string" }, matches, sections,
      ...(agent ? { clarification: { type: "boolean", description: "True only for a clarification with empty matches; otherwise false." } } : {}) },
    required: ["answer", "matches", "sections", ...(agent ? ["clarification"] : [])] };
}

export function modelOutputOptions(policy, ids, resultLimit, agent = false) {
  if (policy.mode === "json_object") return { text: { format: { type: "json_object" } } };
  if (policy.mode !== "json_schema") return {};
  const schema = searchAnswerSchema(ids, resultLimit, agent, policy.protocol === "anthropic");
  if (policy.protocol === "anthropic") return { output_config: { format: { type: "json_schema", schema } } };
  return { text: { format: { type: "json_schema", name: "asset_search_result", ...(policy.provider === "deepseek" ? {} : { strict: true }), schema } } };
}

export function outputThinkingOptions(config) {
  let host = ""; try { host = new URL(config.baseUrl ?? config.upstream).hostname; } catch { return {}; }
  const dashScope = ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"].includes(host) || host.endsWith(".maas.aliyuncs.com");
  return dashScope && /^qwen/iu.test(String(config.model).trim()) ? { enable_thinking: false } : {};
}

export function outputPrompt(agent = false) {
  return 'Return only one complete JSON object, with no prose or Markdown outside it. JSON example: '
    + JSON.stringify({ answer: "A brief answer", matches: [], sections: [], ...(agent ? { clarification: true } : {}) })
    + '. For matches use only IDs returned in this turn and include resourceId, reason, and matchType (feature or suggestion).'
    + ' Current host output contract adds sections to answer and matches, overriding any older field-only rules. For multiple requested sounds, stages or effects, search and select for each need separately within the tool budget; return sections in request order, each with answer (its own explanation) and resourceIds (its selected final match IDs).'
    + ' Every final match belongs to exactly one section. Keep the combined matches within resultLimit. If one need has no grounded result, keep its section with an explanation and empty resourceIds; do not fill it with unrelated assets. Use sections:[] for a single need or a clarification. Max 8 sections; keep explanations concise.';
}

/** Only explicit parameter rejection may downgrade; never retry auth, truncation, or bad results. */
export function isOutputConstraintRejection(status, text) {
  return [400, 422].includes(status)
    && /(?:text[._\s]?format|json_schema|json_object|output_config|structured.?outputs?)/iu.test(text)
    && /(?:not support|unsupported|not available|not enabled|unknown parameter|unrecognized|不支持)/iu.test(text)
    && !/(?:invalid schema|schema is too complex|invalid json schema|additionalProperties|required.*schema)/iu.test(text);
}

export function weakerOutputPolicy(policy) {
  if (policy.mode === "prompt") return undefined;
  return { ...policy, mode: policy.mode === "json_schema" && policy.protocol === "openai" ? "json_object" : "prompt" };
}
