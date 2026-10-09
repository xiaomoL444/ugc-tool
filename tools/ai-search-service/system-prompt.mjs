/* The site's editable Markdown is the only source of search instructions. */
export const SYSTEM_PROMPT_URL = "https://oss.xiaomol444.xyz/ugc-tool-data/AISearch/SystemPrompt.md";
const MAX_BYTES = 32768;
const CACHE_MS = 60000;
export class SystemPromptError extends Error {
  constructor() {
    super("暂时无法读取 AI 搜索系统提示词，请稍后重试。");
    this.name = "SystemPromptError"; this.status = 503; this.code = "PROMPT_UNAVAILABLE";
  }
}
function sourceUrl(value) {
  try {
    if (typeof value !== "string" || value.length > 2048) throw new Error();
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
    return url.href;
  } catch { throw new SystemPromptError(); }
}
function validText(value) {
  if (typeof value !== "string" || !value.trim() || new TextEncoder().encode(value).byteLength > MAX_BYTES
    || /^\s*<(?:!doctype\s+html\b|html\b|head\b|body\b)/i.test(value)
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new SystemPromptError();
  return value.trim();
}
/** Undo Markdown's identifier escaping, then resolve the host's bounded result count. */
export function renderSystemPrompt(source, resultLimit = 10, mode = "agent") {
  if (!Number.isInteger(resultLimit) || resultLimit < 1 || resultLimit > 50) throw new SystemPromptError();
  const content = validText(source).replace(/\\([_\[\]])/g, "$1").replace(/\bRESULT_LIMIT\b/g, String(resultLimit));
  const protocol = mode === "agent"
    ? "本轮运行协议：可使用提供的只读工具，最多 3 轮模型调用、4 次工具调用。完成后返回 JSON 对象 answer、matches；matches 每项含 resourceId、reason、matchType。"
    : "本轮运行协议：没有可调用工具；候选已在本轮 JSON 的 candidates 中提供，仅从 candidates 选择 ID。返回 JSON 对象 answer、matches；matches 每项含 resourceId、reason、matchType。";
  return `${content}\n\n${protocol}本轮 resultLimit=${resultLimit}，matches 最多 ${resultLimit} 项。`;
}
async function readBody(response, signal) {
  if (!response.body) throw new SystemPromptError();
  const reader = response.body.getReader(), chunks = []; let size = 0;
  const cancel = () => { Promise.resolve(reader.cancel()).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new SystemPromptError(); }
      chunks.push(part.value);
    }
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return validText(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
async function query(url, fetcher, timeoutMs, signal, timestamp) {
  const controller = new AbortController(); let timer, abort;
  const stopped = new Promise((_, reject) => {
    abort = () => { controller.abort(); reject(new SystemPromptError()); };
    timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
  const pending = (async () => {
    if (controller.signal.aborted) throw new SystemPromptError();
    // Workers supports manual/follow. Reject redirects without following another source.
    const freshUrl = new URL(url); freshUrl.searchParams.set("_t", String(timestamp));
    const response = await fetcher(freshUrl.href, { method: "GET", redirect: "manual", cache: "no-store",
      headers: { accept: "text/markdown, text/plain" }, signal: controller.signal });
    const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    // OSS may omit Markdown's MIME metadata or serve it as a generic download.
    // Those responses still pass the bounded UTF-8 and HTML/body checks below.
    if (!response.ok || response.redirected || !["", "text/plain", "text/markdown", "text/x-markdown", "application/octet-stream"].includes(type)) throw new SystemPromptError();
    const source = await readBody(response, controller.signal);
    if (controller.signal.aborted) throw new SystemPromptError();
    return source;
  })();
  try { return await Promise.race([pending, stopped]); }
  catch { throw new SystemPromptError(); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
/** Successes live for one minute per ledger instance; failures and cancellations never replace cached success. */
export function createSystemPromptLoader({ fetcher, now = () => Date.now(), timeoutMs = 5000 } = {}) {
  const cache = new Map(), revisions = new Map();
  return {
    async read(config = {}, { signal } = {}) {
      if (signal?.aborted) throw new SystemPromptError();
      const url = sourceUrl(config.systemPromptUrl ?? SYSTEM_PROMPT_URL);
      const previous = cache.get(url);
      if (previous?.expires > now()) return previous.source;
      const current = Symbol(); revisions.set(url, current);
      // Each caller owns its request: one visitor's cancellation cannot abort another visitor.
      try {
        const source = await query(url, fetcher ?? fetch, timeoutMs, signal, now());
        if (signal?.aborted) throw new SystemPromptError();
        if (revisions.get(url) === current) {
          if (cache.size >= 4 && !cache.has(url)) cache.delete(cache.keys().next().value);
          cache.set(url, { source, expires: now() + CACHE_MS });
        }
        return source;
      } finally { if (revisions.get(url) === current) revisions.delete(url); }
    },
  };
}
