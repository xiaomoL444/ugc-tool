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
    if (scenario === "published") return new Response(new TextEncoder().encode("x".repeat(16783)));
    if (scenario === "unicode-boundary") return new Response("字".repeat(10922) + "ab", { headers: { "content-type": "text/markdown" } });
    if (scenario === "unicode-large") return new Response("字".repeat(32768), { headers: { "content-type": "text/markdown" } });
    if (scenario === "invalid-utf8") return new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/octet-stream" } });
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
    scenario = "published";
    const published = await dispatch(120002); assert.equal(published.status, 200);
    assert.ok((await published.json()).content.startsWith("x".repeat(16783)));
    assert.equal((await dispatch(120003)).status, 200);
    assert.equal(requests.length, 5, "the current 16,783-byte OSS-sized source is cached");

    scenario = "unicode-boundary";
    const boundary = "字".repeat(10922) + "ab";
    assert.equal(Buffer.byteLength(boundary), 32768);
    const accepted = await dispatch(180002); assert.equal(accepted.status, 200);
    assert.ok((await accepted.json()).content.startsWith(boundary));
    assert.equal(requests.length, 6);
    scenario = "unicode-large";
    const large = "字".repeat(32768);
    assert.equal(Buffer.byteLength(large), 96 * 1024);
    for (const clock of [240002, 240003]) {
      const response = await dispatch(clock); assert.equal(response.status, 200);
      assert.ok((await response.json()).content.startsWith(large));
    }
    assert.equal(requests.length, 7, "a valid 96KiB source loads and caches without the former file size cap");
    scenario = "invalid-utf8";
    for (const clock of [300002, 300003]) {
      const malformed = await dispatch(clock); assert.equal(malformed.status, 503);
      assert.equal((await malformed.json()).error.code, "PROMPT_UNAVAILABLE");
    }
    assert.equal(requests.length, 9, "removing the file size cap still rejects malformed UTF-8 without caching or reusing expired success");
    assert.ok(requests.every(request => !/deepseek|chat\/completions/.test(request.url)), "loading a prompt never calls a paid model");
  } finally { await mf.dispose(); }
});
