import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

// MINIFLARE_MODULE_PATH can enable this when Miniflare is not a project dependency.
// Every outbound response is synthetic. No real prompt, provider, API key or paid model is contacted.
const require = createRequire(import.meta.url);
let runtime;
try { runtime = require(process.env.MINIFLARE_MODULE_PATH || "miniflare"); }
catch { /* Optional workerd regression; unit tests can run without this dependency. */ }

test("Cloudflare native fetch reads external Markdown, caches for 60s and rejects redirects without forwarding credentials", {
  skip: runtime ? false : "Install miniflare or set MINIFLARE_MODULE_PATH to enable the workerd regression check.",
}, async () => {
  // Inline the helper as Wrangler's bundle does, without exposing its constants as Worker entry points.
  const source = (await readFile(new URL("./system-prompt.mjs", import.meta.url), "utf8"))
    .replace(/(^|\n)export (?=(?:const|class|function)\b)/g, "$1");
  const script = `${source}\nlet clock = 0;
    const loader = createSystemPromptLoader({ now: () => clock, timeoutMs: 200 });
    export default { async fetch(request) {
      clock = Number(new URL(request.url).searchParams.get("clock"));
      try {
        const text = await loader.read({ UPSTREAM_API_KEY: "synthetic-server-key" }, { signal: request.signal });
        return Response.json({ content: renderSystemPrompt(text, 20, "agent") });
      } catch (error) {
        return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status || 503 });
      }
    } };`;
  let scenario = "healthy";
  const requests = [];
  const options = { modules: true, script, compatibilityDate: "2025-04-01", outboundService: async request => {
    requests.push({ url: request.url, method: request.method, authorization: request.headers.get("authorization"),
      cookie: request.headers.get("cookie"), accept: request.headers.get("accept") });
    if (scenario === "redirect") return new Response("redirect", { status: 302,
      headers: { "content-type": "text/markdown", location: "https://untrusted.example/second-target" } });
    if (scenario === "html") return new Response("<html>gateway failure</html>", { headers: { "content-type": "text/html" } });
    return new Response(`${scenario === "updated" ? "UPDATED" : "RUNTIME"}_SOURCE search\\_assets RESULT\\_LIMIT matches:\\[\\]`, {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  } };
  const mf = new runtime.Miniflare(runtime.convertV4MiniflareOptions ? runtime.convertV4MiniflareOptions(options) : options);
  const dispatch = clock => mf.dispatchFetch(`http://localhost/prompt-runtime-check?clock=${clock}`, {
    headers: { authorization: "Bearer synthetic-browser-key", cookie: "session=synthetic-browser-session" },
  });
  try {
    const first = await dispatch(0); assert.equal(first.status, 200);
    const initial = await first.json();
    assert.match(initial.content, /RUNTIME_SOURCE search_assets 20 matches:\[\]/);
    assert.match(initial.content, /resultLimit=20/); assert.equal(requests.length, 1);
    scenario = "updated";
    assert.deepEqual(await (await dispatch(59999)).json(), initial); assert.equal(requests.length, 1);
    const refreshed = await dispatch(60000); assert.equal(refreshed.status, 200);
    assert.match((await refreshed.json()).content, /UPDATED_SOURCE search_assets 20/);
    assert.equal(requests.length, 2);
    scenario = "redirect";
    const redirected = await dispatch(120000); assert.equal(redirected.status, 503);
    const rejected = await redirected.json(); assert.equal(rejected.error.code, "PROMPT_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(rejected), /synthetic|untrusted|UPDATED_SOURCE/);
    assert.equal(requests.length, 3, "a redirect fails without contacting its second target");
    scenario = "html";
    const html = await dispatch(120001); assert.equal(html.status, 503);
    assert.equal((await html.json()).error.code, "PROMPT_UNAVAILABLE");
    assert.equal(requests.length, 4, "failures are not cached and cannot reuse an expired success");
    for (const [index, request] of requests.entries()) {
      const url = new URL(request.url);
      assert.equal(url.origin, "https://oss.xiaomol444.xyz");
      assert.equal(url.pathname, "/ugc-tool-data/AISearch/SystemPrompt.md");
      assert.equal(url.searchParams.get("_t"), String([0, 60000, 120000, 120001][index]));
      assert.equal(request.method, "GET"); assert.equal(request.authorization, null); assert.equal(request.cookie, null);
      assert.equal(request.accept, "text/markdown, text/plain");
    }
    assert.ok(requests.every(request => !/deepseek|chat\/completions/.test(request.url)), "loading a prompt never calls a paid model");
  } finally { await mf.dispose(); }
});
