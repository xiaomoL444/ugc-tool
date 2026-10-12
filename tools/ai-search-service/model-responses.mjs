/* Shared Responses transport. Internal search messages never go on the wire as Chat Completions. */
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = value => typeof value === "string" && value.trim().length > 0;

export function responsesUrl(base) {
  const url = new URL(base.trim());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) throw new TypeError("Invalid model API URL.");
  let path = url.pathname.replace(/\/+$/u, "");
  // Accept saved Chat URLs and pasted Responses URLs without doubling the suffix.
  path = path.replace(/(?:\/responses)?\/chat\/completions$/u, "").replace(/\/responses$/u, "");
  if (url.hostname === "api.openai.com") path = path.replace(/(?:\/responses)+$/u, "");
  if (url.hostname === "api.openai.com" && ["", "/v1"].includes(path)) path = "/v1";
  if (url.hostname === "api.deepseek.com" && ["", "/v1"].includes(path)) path = "";
  url.pathname = `${path}/responses`;
  return url.href;
}

export function toResponsesRequest(source, endpoint = "") {
  if (!object(source) || !nonempty(source.model) || !Array.isArray(source.messages)) throw new TypeError("Invalid model request.");
  const input = [], pending = new Set(), seen = new Set();
  for (const message of source.messages) {
    if (!object(message)) throw new TypeError("Invalid model message.");
    if (message.role === "tool") {
      if (!pending.has(message.tool_call_id) || typeof message.content !== "string") throw new TypeError("Invalid tool result.");
      pending.delete(message.tool_call_id);
      input.push({ type: "function_call_output", call_id: message.tool_call_id, output: message.content });
      continue;
    }
    if (pending.size || !["system", "developer", "user", "assistant"].includes(message.role)) throw new TypeError("Invalid message sequence.");
    const calls = message.tool_calls ?? [];
    if (!Array.isArray(calls) || calls.length && message.role !== "assistant") throw new TypeError("Invalid tool calls.");
    for (const call of calls) {
      if (call?.type !== "function" || !nonempty(call.id) || seen.has(call.id) || !nonempty(call.function?.name) || typeof call.function?.arguments !== "string") throw new TypeError("Invalid tool call.");
      seen.add(call.id); pending.add(call.id);
    }
    if (message._responsesOutput !== undefined) {
      if (message.role !== "assistant" || !Array.isArray(message._responsesOutput)) throw new TypeError("Invalid response replay.");
      const replayCalls = message._responsesOutput.filter(item => item.type === "function_call");
      if (replayCalls.length !== calls.length || replayCalls.some((item, i) => item.call_id !== calls[i].id || item.name !== calls[i].function.name || item.arguments !== calls[i].function.arguments)) throw new TypeError("Mismatched response replay.");
      // Retain complete reasoning, assistant and call items, including encrypted reasoning.
      input.push(...message._responsesOutput);
    } else {
      if (typeof message.content === "string" && message.content) input.push({ role: message.role, content: message.content });
      else if (!calls.length) throw new TypeError("Empty model message.");
      input.push(...calls.map(call => ({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments })));
    }
  }
  if (pending.size || !input.length) throw new TypeError("Missing tool results.");
  const maxTokens = [source.max_output_tokens, source.max_completion_tokens, source.max_tokens].find(value => value !== undefined);
  if (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || maxTokens < 1)) throw new TypeError("Invalid output token limit.");
  const request = { model: source.model, input, ...(maxTokens === undefined ? {} : { max_output_tokens: maxTokens }), stream: source.stream === true, store: false };
  if (source.tools !== undefined) {
    if (!Array.isArray(source.tools)) throw new TypeError("Invalid tools.");
    request.tools = source.tools.map(tool => {
      const fn = tool.function;
      if (tool.type !== "function" || !nonempty(fn?.name) || !object(fn.parameters)) throw new TypeError("Invalid function schema.");
      // Responses otherwise defaults to strict function schemas. Search tools have optional arguments.
      return { type: "function", name: fn.name, description: fn.description ?? "", parameters: fn.parameters, strict: false };
    });
  }
  if (source.tool_choice !== undefined) request.tool_choice = source.tool_choice;
  if (source.text !== undefined) request.text = source.text;
  for (const key of ["enable_thinking", "parallel_tool_calls", "temperature", "top_p"]) if (source[key] !== undefined) request[key] = source[key];
  if (source.reasoning !== undefined) request.reasoning = source.reasoning;
  let host = ""; try { host = new URL(endpoint).hostname; } catch { /* local fixture */ }
  if (host === "api.deepseek.com" && source.reasoning === undefined && source.thinking?.type) {
    request.reasoning = { effort: source.thinking.type === "disabled" ? "none" : "high" };
  } else if (host !== "api.openai.com" && source.thinking !== undefined) request.thinking = source.thinking;
  if (host === "api.openai.com" || host === "ark.cn-beijing.volces.com") request.include = ["reasoning.encrypted_content"];
  return request;
}

export function responsesInputBytes(payload) {
  return new TextEncoder().encode(JSON.stringify({ input: payload.input, tools: payload.tools, text: payload.text })).byteLength;
}

export function normalizeResponsesResponse(raw) {
  if (!object(raw) || raw.object !== "response" || !Array.isArray(raw.output) || !["completed", "incomplete", "failed"].includes(raw.status)) throw new TypeError("Invalid Responses envelope.");
  if (raw.status === "failed" || raw.error) throw new TypeError("Failed model response.");
  const calls = [], ids = new Set(); let content = "", refusal;
  for (const item of raw.output) {
    if (!object(item)) throw new TypeError("Invalid output item.");
    if (item.type === "function_call") {
      if (!nonempty(item.call_id) || ids.has(item.call_id) || !nonempty(item.name) || typeof item.arguments !== "string" || item.status && item.status !== "completed" && raw.status === "completed") throw new TypeError("Invalid function call.");
      ids.add(item.call_id); calls.push({ id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments } });
    } else if (item.type === "message") {
      if (item.role !== "assistant" || !Array.isArray(item.content)) throw new TypeError("Invalid assistant output.");
      for (const part of item.content) {
        if (part.type === "output_text" && typeof part.text === "string") content += part.text;
        else if (part.type === "refusal" && typeof part.refusal === "string") refusal = part.refusal;
        else throw new TypeError("Unsupported assistant content.");
      }
    } else if (item.type !== "reasoning") throw new TypeError("Unsupported output item.");
  }
  const finish = raw.status === "incomplete" ? raw.incomplete_details?.reason === "max_output_tokens" ? "length" : "content_filter" : calls.length ? "tool_calls" : "stop";
  const usage = object(raw.usage) ? { prompt_tokens: raw.usage.input_tokens, completion_tokens: raw.usage.output_tokens } : undefined;
  return { model: raw.model, choices: [{ finish_reason: finish, message: { role: "assistant", content: content || null,
    ...(calls.length ? { tool_calls: calls } : {}), ...(refusal ? { refusal } : {}), _responsesOutput: raw.output } }], ...(usage ? { usage } : {}) };
}
