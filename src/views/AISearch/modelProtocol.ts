export type ModelProtocol = "auto" | "openai" | "anthropic";
type WireProtocol = Exclude<ModelProtocol, "auto">;
type Value = Record<string, unknown>;
type NativeMessage = { role: "user" | "assistant"; content: Value[] };

function object(value: unknown, label: string): Value {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`Invalid ${label}.`);
  return value as Value;
}
function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`Invalid ${label}.`);
  return value;
}
function modelURL(base: string): URL {
  let url: URL;
  try { url = new URL(base.trim()); } catch { throw new TypeError("Invalid model API URL."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) {
    throw new TypeError("Invalid model API URL.");
  }
  return url;
}

export function resolveModelProtocol(config: { baseUrl: string; protocol?: ModelProtocol }): WireProtocol {
  const url = modelURL(config.baseUrl);
  if (config.protocol !== undefined && !["auto", "openai", "anthropic"].includes(config.protocol)) throw new TypeError("Invalid model API protocol.");
  if (config.protocol === "openai" || config.protocol === "anthropic") return config.protocol;
  return url.hostname === "api.anthropic.com" || /\/v1\/messages\/?$/u.test(url.pathname) ? "anthropic" : "openai";
}

export function anthropicMessagesUrl(base: string): string {
  const url = modelURL(base), path = url.pathname.replace(/\/+$/u, "");
  if (url.hostname === "api.anthropic.com" && ["", "/v1", "/messages", "/v1/messages", "/v1/messages/chat/completions"].includes(path)) {
    url.pathname = "/v1/messages";
  } else if (path.endsWith("/v1/messages")) url.pathname = path;
  else if (path.endsWith("/v1")) url.pathname = `${path}/messages`;
  else url.pathname = `${path}/v1/messages`;
  return url.href;
}

/** Browser opt-in and version headers match the official Anthropic TypeScript SDK. */
export function modelHeaders(protocol: WireProtocol, apiKey: string): Record<string, string> {
  const key = nonempty(apiKey, "model API key").trim();
  if (/[\r\n]/u.test(key)) throw new TypeError("Invalid model API key.");
  if (protocol === "openai") return { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
  if (protocol !== "anthropic") throw new TypeError("Invalid model API protocol.");
  return { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true" };
}

function nativeBlocks(value: unknown): Value[] {
  if (!Array.isArray(value) || !value.length) throw new TypeError("Invalid Anthropic content.");
  const ids = new Set<string>();
  return value.map(entry => {
    const block = object(entry, "Anthropic content block");
    if (block.type === "text") {
      if (typeof block.text !== "string") throw new TypeError("Invalid Anthropic text block.");
    } else if (block.type === "thinking") {
      if (typeof block.thinking !== "string" || typeof block.signature !== "string") throw new TypeError("Invalid Anthropic thinking block.");
    } else if (block.type === "redacted_thinking") {
      if (typeof block.data !== "string") throw new TypeError("Invalid Anthropic redacted thinking block.");
    } else if (block.type === "tool_use") {
      const id = nonempty(block.id, "Anthropic tool ID");
      nonempty(block.name, "Anthropic tool name"); object(block.input, "Anthropic tool input");
      if (ids.has(id)) throw new TypeError("Duplicate Anthropic tool ID.");
      ids.add(id);
    } else throw new TypeError("Unsupported Anthropic content block.");
    // Keep native thinking signatures and complete blocks unchanged for replay.
    return block;
  });
}
function chatText(content: unknown, nullable = false): Value[] {
  if (nullable && (content === null || content === undefined || content === "")) return [];
  if (typeof content !== "string" || !content) throw new TypeError("Invalid chat message content.");
  return [{ type: "text", text: content }];
}
function chatToolBlocks(value: unknown): Value[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError("Invalid chat tool calls.");
  const ids = new Set<string>();
  return value.map(entry => {
    const call = object(entry, "chat tool call"), fn = object(call.function, "chat tool function");
    const id = nonempty(call.id, "chat tool ID"), name = nonempty(fn.name, "chat tool name");
    if (call.type !== "function" || ids.has(id) || typeof fn.arguments !== "string") throw new TypeError("Invalid chat tool call.");
    ids.add(id);
    let input: Value;
    try { input = object(JSON.parse(fn.arguments), "chat tool arguments"); } catch { throw new TypeError("Invalid chat tool arguments."); }
    return { type: "tool_use", id, name, input };
  });
}

/** Converts only the text/function subset used by resource search; tools stay strict JSON. */
export function toAnthropicRequest(chatRequest: Value): Value {
  const source = object(chatRequest, "chat request"), model = nonempty(source.model, "model name");
  const maxTokens = source.max_tokens ?? source.max_completion_tokens;
  if (!Number.isSafeInteger(maxTokens) || Number(maxTokens) < 1) throw new TypeError("Invalid model token limit.");
  if (!Array.isArray(source.messages) || !source.messages.length) throw new TypeError("Invalid chat messages.");
  const system: string[] = [], messages: NativeMessage[] = [], pending = new Set<string>(), seen = new Set<string>();
  const append = (role: NativeMessage["role"], content: Value[]) => {
    if (!content.length) throw new TypeError("Invalid empty chat message.");
    const previous = messages[messages.length - 1];
    if (previous?.role === role) previous.content.push(...content);
    else messages.push({ role, content: [...content] });
  };
  for (const entry of source.messages) {
    const message = object(entry, "chat message");
    if (message.role === "system") {
      if (typeof message.content !== "string") throw new TypeError("Invalid system message.");
      if (message.content) system.push(message.content);
      continue;
    }
    if (message.role === "tool") {
      const id = nonempty(message.tool_call_id, "tool result ID");
      if (!pending.has(id) || typeof message.content !== "string") throw new TypeError("Invalid tool result.");
      pending.delete(id); append("user", [{ type: "tool_result", tool_use_id: id, content: message.content }]); continue;
    }
    if (message.role !== "user" && message.role !== "assistant") throw new TypeError("Unsupported chat message role.");
    if (pending.size) throw new TypeError("Missing tool results.");
    if (message.role === "user") { append("user", chatText(message.content)); continue; }
    const converted = chatToolBlocks(message.tool_calls);
    let blocks: Value[];
    if (message._anthropicContent !== undefined) {
      blocks = nativeBlocks(message._anthropicContent);
      const nativeCalls = blocks.filter(block => block.type === "tool_use");
      if (message.tool_calls !== undefined && (nativeCalls.length !== converted.length || nativeCalls.some((block, index) => {
        const call = converted[index];
        return block.id !== call.id || block.name !== call.name || JSON.stringify(block.input) !== JSON.stringify(call.input);
      }))) throw new TypeError("Mismatched native tool calls.");
    } else blocks = [...chatText(message.content, true), ...converted];
    for (const block of blocks) if (block.type === "tool_use") {
      const id = block.id as string;
      if (seen.has(id)) throw new TypeError("Duplicate tool ID.");
      seen.add(id); pending.add(id);
    }
    append("assistant", blocks);
  }
  if (!messages.length || messages[0].role !== "user" || pending.size) throw new TypeError("Invalid Anthropic message sequence.");
  const request: Value = { model, max_tokens: maxTokens, stream: false, messages, ...(system.length ? { system: system.join("\n\n") } : {}) };
  if (source.tools !== undefined) {
    if (!Array.isArray(source.tools)) throw new TypeError("Invalid chat tool schemas.");
    const names = new Set<string>();
    request.tools = source.tools.map(entry => {
      const tool = object(entry, "chat tool schema"), fn = object(tool.function, "chat tool schema function");
      const name = nonempty(fn.name, "tool schema name"), schema = object(fn.parameters, "tool input schema");
      if (tool.type !== "function" || schema.type !== "object" || names.has(name) || (fn.description !== undefined && typeof fn.description !== "string")) throw new TypeError("Invalid chat tool schema.");
      names.add(name);
      return { name, ...(fn.description !== undefined ? { description: fn.description } : {}), input_schema: schema };
    });
  }
  if (source.tool_choice !== undefined) {
    if (source.tool_choice !== "auto" && source.tool_choice !== "none") throw new TypeError("Unsupported chat tool choice.");
    request.tool_choice = { type: source.tool_choice };
  }
  // Leave thinking unset: defaults differ by model. Native blocks above preserve
  // signatures if a model requires thinking across its tool rounds.
  return request;
}

/** Normalizes the native envelope without making reasoning visible to chat/UI. */
export function normalizeAnthropicResponse(raw: Value): Value {
  const response = object(raw, "Anthropic response");
  if (response.type !== "message" || response.role !== "assistant") throw new TypeError("Invalid Anthropic message response.");
  const model = nonempty(response.model, "Anthropic response model"), content = nativeBlocks(response.content);
  const reason = nonempty(response.stop_reason, "Anthropic stop reason");
  const reasons: Record<string, string> = { end_turn: "stop", stop_sequence: "stop", tool_use: "tool_calls", max_tokens: "length",
    model_context_window_exceeded: "length", refusal: "content_filter", pause_turn: "pause_turn" };
  if (!Object.prototype.hasOwnProperty.call(reasons, reason)) throw new TypeError("Unsupported Anthropic stop reason.");
  const calls = content.filter(block => block.type === "tool_use").map(block => ({ id: block.id, type: "function",
    function: { name: block.name, arguments: JSON.stringify(block.input) } }));
  if (reason === "tool_use" && !calls.length || calls.length && ["end_turn", "stop_sequence", "refusal"].includes(reason)) throw new TypeError("Invalid Anthropic tool stop reason.");
  const text = content.filter(block => block.type === "text").map(block => block.text as string).join("");
  const message: Value = { role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}), _anthropicContent: content,
    ...(reason === "refusal" ? { refusal: text || "Model refused the request." } : {}) };
  return { model, choices: [{ message, finish_reason: reasons[reason] }] };
}
