import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

// Run with MINIFLARE_MODULE_PATH pointing to an installed miniflare package when it is not a project dependency.
// All upstream responses are synthetic; these tests never query DeepSeek or use a real API key.
const require = createRequire(import.meta.url);
let runtime;
try { runtime = require(process.env.MINIFLARE_MODULE_PATH || "miniflare"); }
catch { /* Optional runtime check; ordinary unit tests do not need Miniflare installed. */ }

test("Cloudflare native fetch accepts the balance request and enforces balance, redirects and timeout", {
  skip: runtime ? false : "Install miniflare or set MINIFLARE_MODULE_PATH to enable the workerd regression check.",
}, async () => {
  const provider = await readFile(new URL("./provider-balance.mjs", import.meta.url), "utf8");
  const script = `${provider}\nconst guard = createProviderBalanceGuard();
    export default { async fetch() {
      const result = await guard.check({ upstream: "https://api.deepseek.com/chat/completions", minBalanceCny: 20 },
        { UPSTREAM_API_KEY: "synthetic-runtime-key" }, { timeoutMs: 200 });
      return Response.json(result);
    } };`;
  let scenario = "healthy";
  const requests = [];
  const options = { modules: true, script, compatibilityDate: "2025-04-01", outboundService: async request => {
    const current = scenario;
    requests.push({ url: request.url, method: request.method,
      authorized: request.headers.get("authorization") === "Bearer synthetic-runtime-key" });
    if (current === "timeout") await new Promise(resolve => setTimeout(resolve, 800));
    const balance = current === "low" ? "19.99" : "20.00";
    const body = { is_available: true, balance_infos: [{ currency: "CNY", total_balance: balance,
      granted_balance: balance, topped_up_balance: "0.00" }] };
    return new Response(JSON.stringify(body), { status: current === "auth" ? 401 : current === "redirect" ? 302 : 200,
      headers: { "content-type": "application/json", ...(current === "redirect" ? { location: "https://untrusted.example/" } : {}) } });
  } };
  const mf = new runtime.Miniflare(runtime.convertV4MiniflareOptions ? runtime.convertV4MiniflareOptions(options) : options);
  try {
    for (const [name, code, reason] of [
      ["healthy"], ["low", "PROVIDER_BALANCE_LOW"], ["auth", "PROVIDER_BALANCE_UNAVAILABLE", "AUTH"],
      ["redirect", "PROVIDER_BALANCE_UNAVAILABLE", "UPSTREAM_ERROR"],
      ["timeout", "PROVIDER_BALANCE_UNAVAILABLE", "TIMEOUT"],
    ]) {
      scenario = name;
      const response = await mf.dispatchFetch("http://localhost/balance-runtime-check");
      assert.equal(response.status, 200);
      const result = await response.json();
      if (!code) assert.deepEqual(result, { available: true });
      else {
        assert.equal(result.available, false, name);
        assert.equal(result.error.code, code, name);
        assert.equal(result.error.reason, reason, name);
        assert.doesNotMatch(JSON.stringify(result), /synthetic-runtime-key|balance_infos|total_balance/, name);
      }
    }
    assert.equal(requests.length, 5, "each check issues one request; no redirect destination is contacted");
    for (const request of requests) {
      assert.equal(request.url, "https://api.deepseek.com/user/balance");
      assert.equal(request.method, "GET");
      assert.equal(request.authorized, true);
    }
  } finally { await mf.dispose(); }
});
