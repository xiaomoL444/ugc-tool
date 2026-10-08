/* Only the official site's server key is used here. No balance figures leave this module. */
const BALANCE_URL = "https://api.deepseek.com/user/balance";
const CACHE_MS = 30000;
const MAX_BYTES = 16384;
const encoder = new TextEncoder();
export const PROVIDER_BALANCE_REASONS = Object.freeze([
  "MISSING_KEY", "AUTH", "FORBIDDEN", "RATE_LIMIT", "UPSTREAM_ERROR", "TIMEOUT", "NETWORK",
  "INVALID_RESPONSE", "CNY_MISSING", "ACCOUNT_UNAVAILABLE", "ABORTED",
]);
const messages = {
  PROVIDER_BALANCE_LOW: "网站免费模型余额不足，已暂停免费 AI。你可以使用自己的模型或基础搜索。",
  PROVIDER_BALANCE_UNAVAILABLE: "暂时无法核实网站免费模型余额，免费 AI 已暂停。请稍后重试或使用自己的模型。",
};
const blocked = (code, reason) => ({ available: false, error: { code, message: messages[code],
  ...(code === "PROVIDER_BALANCE_UNAVAILABLE" && PROVIDER_BALANCE_REASONS.includes(reason) ? { reason } : {}) } });
const unavailable = reason => blocked("PROVIDER_BALANCE_UNAVAILABLE", reason);
class BalanceQueryError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

function decimal(value) {
  if (typeof value !== "string" || !/^-?\d{1,18}(?:\.\d{1,18})?$/.test(value)) return null;
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  return { amount: BigInt(whole + fraction) * (negative ? -1n : 1n), places: fraction.length };
}
export function minimumBalanceCny(env = {}) {
  const raw = env.MIN_BALANCE_CNY === undefined ? "20" : String(env.MIN_BALANCE_CNY);
  const parsed = decimal(raw);
  const number = Number(raw);
  return parsed && parsed.amount > 0n && Number.isFinite(number) && number <= 1000000 && decimal(String(number)) ? number : 20;
}
function applies(config) {
  try { return new URL(config.upstream).hostname === "api.deepseek.com"; } catch { return false; }
}
function permitted(data, minimum) {
  if (!object(data) || typeof data.is_available !== "boolean") return unavailable("INVALID_RESPONSE");
  if (!Array.isArray(data.balance_infos) || data.balance_infos.length > 16) return unavailable("INVALID_RESPONSE");
  const currencies = new Set();
  for (const item of data.balance_infos) {
    if (!object(item) || !["CNY", "USD"].includes(item.currency) || currencies.has(item.currency)
      || !decimal(item.total_balance)
      || ["granted_balance", "topped_up_balance"].some(field => Object.hasOwn(item, field) && !decimal(item[field]))) {
      return unavailable("INVALID_RESPONSE");
    }
    currencies.add(item.currency);
  }
  const rows = data.balance_infos.filter(item => item.currency === "CNY");
  if (!rows.length) return unavailable("CNY_MISSING");
  const balance = decimal(rows[0].total_balance), threshold = decimal(String(minimum));
  if (!balance || !threshold) return unavailable("INVALID_RESPONSE");
  const scale = Math.max(balance.places, threshold.places);
  if (balance.amount * 10n ** BigInt(scale - balance.places) < threshold.amount * 10n ** BigInt(scale - threshold.places)) {
    return blocked("PROVIDER_BALANCE_LOW");
  }
  return data.is_available ? { available: true } : unavailable("ACCOUNT_UNAVAILABLE");
}
async function boundedBody(response, signal) {
  if (!response.body) throw new BalanceQueryError("INVALID_RESPONSE");
  const reader = response.body.getReader(), chunks = []; let size = 0;
  const cancel = () => { Promise.resolve(reader.cancel()).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new BalanceQueryError("INVALID_RESPONSE"); }
      chunks.push(part.value);
    }
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new BalanceQueryError("INVALID_RESPONSE"); }
}

async function query(config, env, { fetcher = fetch, timeoutMs = 5000, signal } = {}) {
  const key = typeof env.UPSTREAM_API_KEY === "string" ? env.UPSTREAM_API_KEY.trim() : "";
  if (!key) return unavailable("MISSING_KEY");
  const controller = new AbortController();
  let timer, abort, stopReason;
  const stopped = new Promise((_, reject) => {
    const stop = reason => {
      if (stopReason) return;
      stopReason = reason; controller.abort(); reject(new BalanceQueryError(reason));
    };
    abort = () => stop("ABORTED");
    timer = setTimeout(() => stop("TIMEOUT"), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
  const pending = (async () => {
    if (controller.signal.aborted) throw new BalanceQueryError(stopReason);
    // Workers supports follow/manual only. Manual plus the non-2xx check rejects redirects without forwarding the key.
    const response = await fetcher(BALANCE_URL, { method: "GET", redirect: "manual", cache: "no-store",
      headers: { accept: "application/json", authorization: `Bearer ${key}` }, signal: controller.signal });
    if (!response.ok) throw new BalanceQueryError(response.status === 401 ? "AUTH"
      : response.status === 403 ? "FORBIDDEN" : response.status === 429 ? "RATE_LIMIT" : "UPSTREAM_ERROR");
    const data = await boundedBody(response, controller.signal);
    if (controller.signal.aborted) throw new BalanceQueryError(stopReason);
    return permitted(data, config.minBalanceCny ?? 20);
  })();
  try { return await Promise.race([pending, stopped]); }
  catch (error) { return unavailable(stopReason || (error instanceof BalanceQueryError ? error.reason : "NETWORK")); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

/** Cache only public availability. Chat checks always bypass both cached values and in-flight config checks. */
export function createProviderBalanceGuard() {
  const cache = new Map(), inFlight = new Map(), revisions = new Map(); let revision = 0;
  return {
    async check(config, env, options = {}) {
      if (!applies(config)) return { available: true };
      // Hashing avoids retaining keys as cache identifiers. Threshold changes also invalidate a cached decision.
      const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`${env.UPSTREAM_API_KEY || ""}\n${config.minBalanceCny ?? 20}`)));
      const key = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
      const previous = cache.get(key);
      if (options.cached && previous?.expires > Date.now()) return structuredClone(previous.status);
      if (options.cached && inFlight.has(key)) return structuredClone(await inFlight.get(key));
      const current = ++revision; revisions.set(key, current);
      const pending = query(config, env, options).then(status => {
        // An older config query must not replace a more recent fresh chat check.
        if (revisions.get(key) === current) {
          if (cache.size >= 16 && !cache.has(key)) {
            const oldest = cache.keys().next().value; cache.delete(oldest); revisions.delete(oldest);
          }
          cache.set(key, { expires: Date.now() + CACHE_MS, status });
        }
        return status;
      });
      if (options.cached) inFlight.set(key, pending);
      try { return structuredClone(await pending); }
      finally { if (inFlight.get(key) === pending) inFlight.delete(key); }
    },
  };
}
