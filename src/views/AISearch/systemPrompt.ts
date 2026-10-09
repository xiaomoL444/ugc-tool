import { OSS_BASE_URL } from "../../utils/oss";
import { AISearchError } from "./aiSearchService";
import { normalizeResultLimit } from "./resultLimits";
import { httpRequestDiagnostic, responseRequestDiagnostic, transportRequestDiagnostic } from "./requestDiagnostics";
import type { RequestContext } from "./requestDiagnostics";

const MAX_PROMPT_BYTES = 16384;
const PROMPT_TIMEOUT_MS = 5000;
const PROMPT_CACHE_MS = 60000;
type CachedSource = { source?: string; expires: number; revision: number };
const sources = new WeakMap<typeof fetch, Map<string, CachedSource>>();
let nextRevision = 0;

function aborted(context?: RequestContext) {
  if (!context) return new DOMException("Aborted", "AbortError");
  const error = new AISearchError("REQUEST_ABORTED", undefined, undefined, transportRequestDiagnostic(new DOMException("Aborted", "AbortError"), context));
  error.name = "AbortError";
  return error;
}
function normalizeSource(source: string): string {
  // Markdown editors can escape identifiers and the JSON array example.
  return source.replace(/\\([_[\]])/g, "$1").trim();
}

async function readSource(response: Response, signal: AbortSignal, context: RequestContext): Promise<string> {
  const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  // Object storage may omit Markdown metadata or serve it as a generic download.
  // Unknown/generic MIME still goes through the bounded UTF-8 and text checks below.
  if (!response.ok) throw new AISearchError("PROMPT_UNAVAILABLE", undefined, undefined, await httpRequestDiagnostic(response, context));
  if (response.redirected || !response.body || !["", "text/plain", "text/markdown", "text/x-markdown", "application/octet-stream"].includes(type)) {
    void response.body?.cancel().catch(() => undefined);
    throw new AISearchError("PROMPT_UNAVAILABLE");
  }
  const length = response.headers.get("content-length");
  if (length && /^\d+$/u.test(length) && Number(length) > MAX_PROMPT_BYTES) {
    void response.body.cancel().catch(() => undefined);
    throw new AISearchError("PROMPT_UNAVAILABLE");
  }
  const reader = response.body.getReader();
  const stop = () => { void reader.cancel().catch(() => { /* The transport may already be closed. */ }); };
  signal.addEventListener("abort", stop, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (signal.aborted) throw aborted();
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) throw aborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_PROMPT_BYTES) { stop(); throw new AISearchError("PROMPT_UNAVAILABLE"); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const source = normalizeSource(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!source || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(source)
      || /^\s*<(?:!doctype\s+html\b|html\b|head\b|body\b)/iu.test(source)) throw new AISearchError("PROMPT_UNAVAILABLE");
    return source;
  } finally {
    signal.removeEventListener("abort", stop);
    reader.releaseLock();
  }
}

/** Read the public site's prompt without sending model credentials or cookies. */
export async function loadSystemPrompt(signal: AbortSignal, fetcher: typeof fetch = fetch, base = OSS_BASE_URL): Promise<string> {
  if (signal.aborted) throw aborted();
  const url = `${base.replace(/\/+$/u, "")}/AISearch/SystemPrompt.md`;
  const context: RequestContext = { stage: "prompt", endpoint: url, startedAt: Date.now() };
  const cache = sources.get(fetcher) ?? new Map<string, CachedSource>();
  sources.set(fetcher, cache);
  const saved = cache.get(url);
  if (saved?.source && saved.expires > Date.now()) return saved.source;
  const revision = ++nextRevision;
  cache.set(url, { ...saved, expires: saved?.expires ?? 0, revision });
  if (cache.size > 16) cache.delete(cache.keys().next().value!);
  const controller = new AbortController();
  let rejectStopped: (reason: unknown) => void = () => undefined;
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
  const stop = () => { controller.abort(); rejectStopped(aborted(context)); };
  signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(() => { controller.abort(); rejectStopped(new AISearchError("PROMPT_UNAVAILABLE", undefined, undefined,
    transportRequestDiagnostic(new DOMException("Prompt request timed out", "TimeoutError"), context))); }, PROMPT_TIMEOUT_MS);
  let response: Response | undefined;
  try {
    const pending = (async () => {
      response = await fetcher(`${url}${url.includes("?") ? "&" : "?"}_t=${Date.now()}`, {
        method: "GET", signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "manual", referrerPolicy: "no-referrer",
      });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => undefined); throw aborted(); }
      const source = await readSource(response, controller.signal, context);
      if (controller.signal.aborted) throw aborted();
      if (cache.get(url)?.revision === revision) cache.set(url, { source, expires: Date.now() + PROMPT_CACHE_MS, revision });
      return source;
    })();
    return await Promise.race([pending, stopped]);
  } catch (error) {
    if (signal.aborted) throw aborted(context);
    if (error instanceof AISearchError && error.requestDiagnostic) throw error;
    const diagnostic = error instanceof AISearchError && response ? responseRequestDiagnostic(response, context)
      : { ...(response ? responseRequestDiagnostic(response, context) : {}), ...transportRequestDiagnostic(error, context, controller.signal) };
    throw new AISearchError("PROMPT_UNAVAILABLE", undefined, undefined, diagnostic);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
    controller.abort();
  }
}

/** Host protocol varies by transport; search behavior comes from the Markdown. */
export function buildSystemPrompt(source: string, workflow: "agent" | "candidates", resultLimit: number): string {
  const limit = normalizeResultLimit(resultLimit);
  const prompt = normalizeSource(source).replace(/\bRESULT_LIMIT\b/gu, String(limit));
  const protocol = workflow === "agent"
    ? "运行协议：当前提供 search_assets、get_assets、get_asset_catalog 工具；每轮搜索最多 3 次模型请求、4 次工具调用。"
    : "运行协议：当前是候选列表筛选模式，不提供工具调用；资产资料在最后一条用户消息的 candidates 中。请从这批候选返回最终 JSON。";
  return `${prompt}\n\n${protocol}\n本轮 resultLimit=${limit}，最多返回 ${limit} 个不同资产；输出为 JSON 对象，字段为 answer 和 matches；matches 每项包含 resourceId、reason、matchType（feature 或 suggestion）。`;
}
