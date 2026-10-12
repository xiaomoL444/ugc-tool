import { awaitRequest } from "./requestTimeout";
import { boundedRawResponse } from "./responseDiagnostics";

export interface ModelStreamProgress {
  phase: "waiting" | "thinking" | "generating";
  receivedCharacters: number;
  answerPreview?: string;
}
export class ModelStreamError extends Error {
  constructor(readonly code: "INVALID_RESPONSE" | "MODEL_STREAM_ERROR" = "INVALID_RESPONSE") {
    super(code === "MODEL_STREAM_ERROR" ? "The model stream failed." : "The model response stream is invalid or incomplete.");
    this.name = "ModelStreamError";
  }
}
type Value = Record<string, unknown>;
const isObject = (value: unknown): value is Value => value !== null && typeof value === "object" && !Array.isArray(value);
const object = (value: unknown): Value => isObject(value) ? value : {};
const MAX_JSON_CHARS = 100000;
// A valid 100K-character JSON envelope can occupy 300K UTF-8 bytes. Streaming
// also repeats token/event metadata, so its transport budget is deliberately larger.
const MAX_EVENT_BYTES = 512 * 1024;
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const MAX_PREVIEW_CHARS = 6000;
const encoder = new TextEncoder();
const invalid = () => new ModelStreamError();

function json(source: string, limit = MAX_JSON_CHARS): Value {
  if (source.length > limit) throw invalid();
  try { const value: unknown = JSON.parse(source); if (isObject(value)) return value; } catch { /* Never include JSON or provider prose in errors. */ }
  throw invalid();
}
function checkEnvelope(value: Value): Value {
  if (JSON.stringify(value).length > MAX_JSON_CHARS) throw invalid();
  return value;
}
function stringToken(source: string, start: number): { text: string; end: number; complete: boolean } | undefined {
  let text = "";
  for (let index = start + 1; index < source.length; index++) {
    const character = source[index];
    if (character === '"') return { text, end: index + 1, complete: true };
    if (character.charCodeAt(0) < 32) return;
    if (character !== "\\") { text += character; continue; }
    if (++index >= source.length) return { text, end: source.length, complete: false };
    const escape = source[index];
    const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
    if (Object.hasOwn(escapes, escape)) { text += escapes[escape]; continue; }
    if (escape !== "u") return;
    const digits = source.slice(index + 1, index + 5);
    if (digits.length < 4) return /^[\da-f]*$/iu.test(digits) ? { text, end: source.length, complete: false } : undefined;
    if (!/^[\da-f]{4}$/iu.test(digits)) return;
    text += String.fromCharCode(parseInt(digits, 16)); index += 4;
  }
  return { text, end: source.length, complete: false };
}
/** Only a root object's answer string can become visible; nested fields and raw JSON cannot. */
function answerPrefix(source: string): string | undefined {
  let index = 0; while (/[\s\uFEFF]/u.test(source[index] || "") && index < source.length) index++;
  if (source[index] !== "{") return;
  let depth = 1, keyExpected = true;
  for (index++; index < source.length; index++) {
    const character = source[index];
    if (character === '"') {
      const token = stringToken(source, index); if (!token) return;
      if (depth === 1 && keyExpected) {
        if (!token.complete) return;
        keyExpected = false;
        if (token.text === "answer") {
          let next = token.end; while (/\s/u.test(source[next] || "") && next < source.length) next++;
          if (source[next++] !== ":") return;
          while (/\s/u.test(source[next] || "") && next < source.length) next++;
          if (source[next] !== '"') return;
          return stringToken(source, next)?.text;
        }
      }
      if (!token.complete) return;
      index = token.end - 1;
    } else if (character === "{" || character === "[") depth++;
    else if (character === "}" || character === "]") { if (--depth === 0) return; }
    else if (character === "," && depth === 1) keyExpected = true;
  }
}
function safePreview(source: string | undefined, secrets: readonly string[]): string | undefined {
  if (!source) return;
  // A credential can cross delta boundaries. Withhold every suffix that is a known
  // credential's unfinished prefix before doing whole-preview redaction.
  let safe = source;
  for (const secret of [...secrets].filter(Boolean).sort((left, right) => right.length - left.length)) safe = safe.split(secret).join("[REDACTED]");
  for (const secret of secrets) {
    if (!secret) continue;
    for (let length = Math.min(secret.length - 1, safe.length); length > 0; length--) {
      if (safe.endsWith(secret.slice(0, length))) { safe = safe.slice(0, -length); break; }
    }
  }
  safe = boundedRawResponse(safe, secrets) ?? "";
  safe = safe.replace(/\bBearer\s+[^\s"'<>,;]+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/gu, "[REDACTED]");
  safe = safe.slice(0, MAX_PREVIEW_CHARS).replace(/[\uD800-\uDBFF]$/u, "");
  return safe || undefined;
}
function finalText(response: Value, protocol: "openai" | "anthropic"): string {
  if (protocol === "anthropic") return (Array.isArray(response.content) ? response.content : []).map(object)
    .filter(block => block.type === "text" && typeof block.text === "string").map(block => block.text as string).join("");
  return (Array.isArray(response.output) ? response.output : []).map(object).filter(item => item.type === "message")
    .flatMap(item => Array.isArray(item.content) ? item.content : []).map(object)
    .filter(block => block.type === "output_text" && typeof block.text === "string").map(block => block.text as string).join("");
}

/** Parse native SSE while preserving its final envelope for the existing result validators. */
export async function readModelStream(response: Response, protocol: "openai" | "anthropic", signal?: AbortSignal,
  onProgress?: (update: ModelStreamProgress) => void, secrets: readonly string[] = []): Promise<Value> {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  if (protocol !== "openai" && protocol !== "anthropic") throw invalid();
  let phase: ModelStreamProgress["phase"] = "waiting", text = "", previous = "";
  const progress = () => {
    const update: ModelStreamProgress = { phase, receivedCharacters: text.length };
    const preview = safePreview(answerPrefix(text), secrets); if (preview) update.answerPreview = preview;
    const signature = JSON.stringify(update); if (signature === previous) return; previous = signature;
    try { onProgress?.(update); } catch { /* Progress rendering must not invalidate a provider response. */ }
  };
  progress();
  const reader = response.body?.getReader(); if (!reader) throw invalid();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const streaming = response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") === true;
  let receivedBytes = 0, buffer = "", terminal: Value | undefined;
  let eventBytes = 0, dataLines: string[] = [], eventName = "";
  let message: Value | undefined;
  const blocks = new Map<number, { value: Value; input: string; stopped: boolean }>();
  const addText = (value: string) => { if (text.length + value.length > MAX_JSON_CHARS) throw invalid(); text += value; phase = "generating"; progress(); };
  const processOpenAI = (value: Value, type: string) => {
    if (type === "error") throw new ModelStreamError("MODEL_STREAM_ERROR");
    if (!text && (["response.created", "response.in_progress", "response.function_call_arguments.delta"].includes(type)
      || type === "response.output_item.added" && ["reasoning", "function_call"].includes(String(object(value.item).type))
      || type.startsWith("response.reasoning"))) { phase = "thinking"; progress(); }
    if (type === "response.output_text.delta") { if (typeof value.delta !== "string") throw invalid(); addText(value.delta); }
    if (["response.completed", "response.incomplete", "response.failed"].includes(type)) {
      const result = object(value.response);
      if (result.object !== "response" || result.status !== type.slice(9) || !Array.isArray(result.output)) throw invalid();
      terminal = checkEnvelope(result);
    }
  };
  const blockIndex = (value: Value): number => { if (!Number.isInteger(value.index) || Number(value.index) < 0 || Number(value.index) > 100) throw invalid(); return Number(value.index); };
  const processAnthropic = (value: Value, type: string) => {
    if (type === "error") throw new ModelStreamError("MODEL_STREAM_ERROR");
    if (type === "message_start") {
      if (message) throw invalid(); const start = object(value.message);
      if (start.type !== "message" || start.role !== "assistant" || !Array.isArray(start.content) || start.content.length) throw invalid();
      message = { ...start, content: [] }; return;
    }
    if (type === "ping") return;
    if (!message) throw invalid();
    if (type === "content_block_start") {
      const index = blockIndex(value), block = object(value.content_block);
      if (blocks.has(index) || index !== blocks.size || !["text", "thinking", "redacted_thinking", "tool_use"].includes(String(block.type))) throw invalid();
      const clone = { ...block }; blocks.set(index, { value: clone, input: "", stopped: false });
      if (block.type === "text") { if (typeof block.text !== "string") throw invalid(); if (block.text) addText(block.text); }
      if (block.type === "thinking" || block.type === "redacted_thinking") { if (!text) { phase = "thinking"; progress(); } }
      return;
    }
    if (type === "content_block_delta") {
      const state = blocks.get(blockIndex(value)); if (!state || state.stopped) throw invalid();
      const delta = object(value.delta), block = state.value;
      if (delta.type === "text_delta" && block.type === "text" && typeof delta.text === "string") { block.text = String(block.text ?? "") + delta.text; addText(delta.text); }
      else if (delta.type === "thinking_delta" && block.type === "thinking" && typeof delta.thinking === "string") block.thinking = String(block.thinking ?? "") + delta.thinking;
      else if (delta.type === "signature_delta" && block.type === "thinking" && typeof delta.signature === "string") block.signature = String(block.signature ?? "") + delta.signature;
      else if (delta.type === "input_json_delta" && block.type === "tool_use" && typeof delta.partial_json === "string") { state.input += delta.partial_json; if (state.input.length > MAX_JSON_CHARS) throw invalid(); }
      else if (delta.type === "citations_delta" && block.type === "text" && isObject(delta.citation)) block.citations = [...(Array.isArray(block.citations) ? block.citations : []), delta.citation];
      else throw invalid();
      return;
    }
    if (type === "content_block_stop") {
      const state = blocks.get(blockIndex(value)); if (!state || state.stopped) throw invalid();
      if (state.value.type === "tool_use" && state.input) state.value.input = json(state.input);
      state.stopped = true; return;
    }
    if (type === "message_delta") {
      const delta = object(value.delta);
      for (const key of ["stop_reason", "stop_sequence"]) if (Object.hasOwn(delta, key)) message[key] = delta[key];
      if (isObject(value.usage)) message.usage = { ...object(message.usage), ...value.usage };
      return;
    }
    if (type === "message_stop") {
      if (!blocks.size || [...blocks.values()].some(block => !block.stopped) || typeof message.stop_reason !== "string" || !message.stop_reason) throw invalid();
      message.content = [...blocks.values()].map(block => block.value); terminal = checkEnvelope(message);
    }
  };
  const processEvent = () => {
    const source = dataLines.join("\n"), name = eventName; dataLines = []; eventName = ""; eventBytes = 0;
    if (!source || source === "[DONE]") return;
    const value = json(source, MAX_EVENT_BYTES), type = typeof value.type === "string" ? value.type : name;
    if (protocol === "openai") processOpenAI(value, type); else processAnthropic(value, type);
  };
  const processLine = (line: string) => {
    eventBytes += encoder.encode(line).byteLength + 1; if (eventBytes > MAX_EVENT_BYTES) throw invalid();
    if (!line) { processEvent(); return; }
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    else if (line.startsWith("event:")) eventName = line.slice(6).trim();
  };
  const consumeLines = (ended = false) => {
    while (!terminal) {
      const index = buffer.search(/[\r\n]/); if (index < 0) break;
      if (!ended && buffer[index] === "\r" && index === buffer.length - 1) break;
      const width = buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
      const line = buffer.slice(0, index); buffer = buffer.slice(index + width); processLine(line);
    }
    if (!terminal && eventBytes + encoder.encode(buffer).byteLength > MAX_EVENT_BYTES) throw invalid();
  };
  try {
    while (!terminal) {
      const chunk = await awaitRequest(() => reader.read(), signal);
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      if (chunk.done) {
        try { buffer += decoder.decode(); } catch { throw invalid(); }
        if (!streaming) { terminal = json(buffer); break; }
        consumeLines(true);
        if (!terminal && buffer) { processLine(buffer); buffer = ""; }
        if (!terminal && dataLines.length) processEvent();
        if (!terminal) throw invalid();
        break;
      }
      receivedBytes += chunk.value.byteLength; if (receivedBytes > MAX_STREAM_BYTES) throw invalid();
      try { buffer += decoder.decode(chunk.value, { stream: true }); } catch { throw invalid(); }
      if (streaming) consumeLines(); else if (buffer.length > MAX_JSON_CHARS) throw invalid();
    }
    if (!terminal) throw invalid();
    if (protocol === "anthropic" || terminal.status === "completed") {
      text = finalText(terminal, protocol); if (text.length > MAX_JSON_CHARS) throw invalid(); if (text) phase = "generating"; progress();
    }
    return terminal;
  } finally {
    signal?.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => undefined); reader.releaseLock();
  }
}
