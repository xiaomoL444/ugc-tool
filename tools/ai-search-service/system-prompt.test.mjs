import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSystemPromptLoader, renderSystemPrompt, SYSTEM_PROMPT_URL } from "./system-prompt.mjs";
import { buildAgentPrompt } from "./agent-runtime.mjs";
import { promptResponse, TEST_SYSTEM_PROMPT } from "./system-prompt-fixture.mjs";

const unavailable = error => error.code === "PROMPT_UNAVAILABLE" && error.status === 503;

test("prompt source validates Markdown and rendering handles escaped identifiers and both modes", () => {
  const source = "FROM_FILE search\\_assets RESULT\\_LIMIT matches:\\[\\] RESULT_LIMIT";
  const agent = renderSystemPrompt(source, 20, "agent");
  const legacy = renderSystemPrompt(source, 10, "candidates");
  assert.match(agent, /FROM_FILE search_assets 20 matches:\[\] 20/);
  assert.match(agent, /最多 3 轮模型调用、4 次工具调用/);
  assert.match(legacy, /FROM_FILE search_assets 10 matches:\[\] 10/);
  assert.match(legacy, /没有可调用工具/);
  for (const bad of [undefined, "", "  ", "<!doctype html><html>error</html>"]) {
    assert.throws(() => renderSystemPrompt(bad), unavailable);
  }
  assert.match(renderSystemPrompt("Markdown 可包含 `<html>` 示例。", 5), /<html>/);
  assert.throws(() => renderSystemPrompt("hidden\u0000instruction"), unavailable);
});

test("loader uses one configured HTTPS source with cache busting and no upstream key or browser data", async () => {
  let calls = 0;
  const loader = createSystemPromptLoader({ now: () => 12345, fetcher: async (url, options) => {
    calls += 1;
    assert.equal(url, "https://source.example/AISearch/SystemPrompt.md?version=1&_t=12345");
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "manual");
    assert.equal(options.cache, "no-store"); assert.deepEqual(options.headers, { accept: "text/markdown, text/plain" });
    assert.equal(Object.hasOwn(options, "body"), false);
    return promptResponse();
  } });
  assert.equal(await loader.read({ systemPromptUrl: "https://source.example/AISearch/SystemPrompt.md?version=1", UPSTREAM_API_KEY: "mock-key" }), TEST_SYSTEM_PROMPT);
  assert.equal(calls, 1);
  for (const bad of ["http://source.example/prompt.md", "https://user:secret@source.example/prompt.md", "https://source.example/prompt.md#fragment", "garbage", 12]) {
    await assert.rejects(loader.read({ systemPromptUrl: bad }), unavailable);
  }
  assert.equal(calls, 1);
});

test("only successful sources cache for 60 seconds and expired sources never fall back after failure", async () => {
  let clock = 0, calls = 0, reject = false;
  const loader = createSystemPromptLoader({ now: () => clock, fetcher: async url => {
    calls += 1; assert.equal(new URL(url).searchParams.get("_t"), String(clock));
    if (reject) throw new Error("private network detail");
    return promptResponse(`SOURCE_${calls}`);
  } });
  assert.equal(await loader.read(), "SOURCE_1"); clock = 59999;
  assert.equal(await loader.read(), "SOURCE_1"); assert.equal(calls, 1);
  clock = 60000; reject = true;
  await assert.rejects(loader.read(), unavailable);
  await assert.rejects(loader.read(), unavailable); assert.equal(calls, 3);
  reject = false; assert.equal(await loader.read(), "SOURCE_4"); assert.equal(calls, 4);
  assert.equal(await loader.read(), "SOURCE_4"); assert.equal(calls, 4);
});

test("bad status, redirects, HTML, empty and malformed UTF-8 sources all fail closed", async () => {
  const cases = [
    () => new Response("redirect", { status: 302, headers: { location: "https://other.example", "content-type": "text/plain" } }),
    () => new Response("rejected", { status: 403, headers: { "content-type": "text/plain" } }),
    () => new Response("upstream unavailable", { status: 500, headers: { "content-type": "text/plain" } }),
    () => new Response("html", { headers: { "content-type": "text/html" } }),
    () => new Response("{}", { headers: { "content-type": "application/json" } }),
    () => promptResponse(""), () => promptResponse("   "),
    () => promptResponse("<html><body>cached gateway error</body></html>"),
    () => new Response(new Uint8Array([0xff, 0xfe]), { headers: { "content-type": "text/markdown" } }),
  ];
  for (const make of cases) {
    let calls = 0;
    const loader = createSystemPromptLoader({ fetcher: async () => { calls += 1; return make(); } });
    await assert.rejects(loader.read(), unavailable);
    await assert.rejects(loader.read(), unavailable); assert.equal(calls, 2);
  }
});

test("missing or generic OSS MIME metadata accepts validated Markdown and retains body checks", async () => {
  const source = "# OSS Markdown\n外部系统提示词 RESULT_LIMIT。";
  for (const headers of [{}, { "content-type": "application/octet-stream" }]) {
    const response = value => new Response(typeof value === "string" ? new TextEncoder().encode(value) : value, { headers });
    const loader = createSystemPromptLoader({ fetcher: async () => response(source) });
    assert.equal(await loader.read(), source);
    for (const invalid of ["", "   ", "<html><body>gateway error</body></html>", "<!doctype html><html>gateway error</html>",
      "hidden\u0000instruction", new Uint8Array([0xff, 0xfe])]) {
      const rejected = createSystemPromptLoader({ fetcher: async () => response(invalid) });
      await assert.rejects(rejected.read(), unavailable);
    }
  }
});

test("the current OSS-sized prompt is accepted and cached with missing MIME metadata", async () => {
  const source = "# Published prompt\n" + "x".repeat(16783 - Buffer.byteLength("# Published prompt\n"));
  assert.equal(Buffer.byteLength(source), 16783);
  let calls = 0;
  const loader = createSystemPromptLoader({ fetcher: async () => {
    calls += 1; return new Response(new TextEncoder().encode(source));
  } });
  assert.equal(await loader.read(), source);
  assert.equal(await loader.read(), source);
  assert.equal(calls, 1);
});

test("large prompts above the former 32KiB limit load, render and cache without a file byte cap", async () => {
  const large = "字".repeat(32768);
  assert.equal(Buffer.byteLength(large), 96 * 1024);
  for (const source of ["字".repeat(10923), "x".repeat(32769), large, "\ufeff" + large + "\r\n"]) {
    for (const mode of ["agent", "candidates"]) assert.ok(renderSystemPrompt(source, 10, mode).startsWith(source.trim()));
    const bytes = new TextEncoder().encode(source); let calls = 0;
    const loader = createSystemPromptLoader({ fetcher: async () => {
      calls += 1;
      return new Response(new ReadableStream({ start(controller) {
        // Cross both former limits and split a multibyte character between chunks.
        for (let offset = 0; offset < bytes.length; offset += 16385) controller.enqueue(bytes.subarray(offset, offset + 16385));
        controller.close();
      } }), { headers: { "content-type": "text/markdown", "content-length": String(bytes.length) } });
    } });
    assert.equal(await loader.read(), source.trim());
    assert.equal(await loader.read(), source.trim());
    assert.equal(calls, 1, "a valid large prompt gets the same successful cache as a small one");
  }
});

test("a fetch or body that never settles still obeys the complete prompt deadline", async () => {
  for (const fetcher of [
    async () => new Promise(() => {}),
    async () => new Response(new ReadableStream({ start() {}, cancel() {} }), { headers: { "content-type": "text/markdown" } }),
  ]) {
    const loader = createSystemPromptLoader({ timeoutMs: 10, fetcher });
    await assert.rejects(loader.read(), unavailable);
  }
});

test("one visitor's cancellation cannot abort another visitor or overwrite a good cached prompt", async () => {
  let calls = 0, releaseFirst, releaseSecond;
  const loader = createSystemPromptLoader({ timeoutMs: 1000, fetcher: async () => {
    calls += 1; return new Promise(resolve => {
      if (calls === 1) releaseFirst = () => resolve(promptResponse("STALE_CANCELLED"));
      else releaseSecond = () => resolve(promptResponse("CURRENT_SOURCE"));
    });
  } });
  const controller = new AbortController();
  const first = loader.read({}, { signal: controller.signal });
  const rejected = assert.rejects(first, unavailable);
  const second = loader.read();
  controller.abort(); releaseSecond();
  await rejected; assert.equal(await second, "CURRENT_SOURCE");
  releaseFirst(); await Promise.resolve();
  assert.equal(await loader.read(), "CURRENT_SOURCE"); assert.equal(calls, 2);
  await assert.rejects(loader.read({}, { signal: controller.signal }), unavailable);
});

test("source configuration changes cannot reuse another source's cached Markdown", async () => {
  let calls = 0;
  const loader = createSystemPromptLoader({ fetcher: async url => { calls += 1; return promptResponse(new URL(url).pathname); } });
  assert.equal(await loader.read(), new URL(SYSTEM_PROMPT_URL).pathname);
  assert.equal(await loader.read({ systemPromptUrl: "https://source.example/other.md" }), "/other.md");
  assert.equal(calls, 2);
});

test("an older read cannot replace newer Markdown when same-source requests finish out of order", async () => {
  let calls = 0, first, second;
  const loader = createSystemPromptLoader({ fetcher: async () => new Promise(resolve => {
    calls += 1;
    if (calls === 1) first = () => resolve(promptResponse("OLD_SOURCE"));
    else second = () => resolve(promptResponse("NEW_SOURCE"));
  }) });
  const oldRead = loader.read(), newRead = loader.read();
  second(); assert.equal(await newRead, "NEW_SOURCE");
  first(); assert.equal(await oldRead, "OLD_SOURCE");
  assert.equal(await loader.read(), "NEW_SOURCE"); assert.equal(calls, 2);
});

test("parallel reads of different configured URLs both retain their own successful cache", async () => {
  const pending = new Map(); let calls = 0;
  const loader = createSystemPromptLoader({ fetcher: async url => new Promise(resolve => {
    calls += 1; const path = new URL(url).pathname;
    pending.set(path, () => resolve(promptResponse(path)));
  }) });
  const firstConfig = { systemPromptUrl: "https://source.example/one.md" };
  const secondConfig = { systemPromptUrl: "https://source.example/two.md" };
  const first = loader.read(firstConfig), second = loader.read(secondConfig);
  pending.get("/two.md")(); pending.get("/one.md")();
  assert.equal(await first, "/one.md"); assert.equal(await second, "/two.md");
  assert.equal(await loader.read(firstConfig), "/one.md");
  assert.equal(await loader.read(secondConfig), "/two.md"); assert.equal(calls, 2);
});


test("custom result limits render all integers from one through fifty and reject invalid values", () => {
  for (const count of [1, 6, 21, 33, 50]) assert.match(renderSystemPrompt(TEST_SYSTEM_PROMPT, count), new RegExp(`matches 最多 ${count} 项`));
  assert.match(renderSystemPrompt(TEST_SYSTEM_PROMPT), /resultLimit=10/);
  for (const count of [0, -1, 1.5, 51, '50', null]) assert.throws(() => renderSystemPrompt(TEST_SYSTEM_PROMPT, count), unavailable);
});

test("the editable game-search prompt loads and fits the actual agent budget without network requests", async () => {
  const source = await readFile(new URL("./SystemPrompt.md", import.meta.url), "utf8");
  const loader = createSystemPromptLoader({ fetcher: async () => promptResponse(source) });
  const loaded = await loader.read();
  assert.equal(loaded, source.trim());
  const config = { maxPromptBytes: 30000, maxOutputTokens: 5400, inputRate: 0, outputRate: 0, costSafety: 1 };
  for (const resultLimit of [1, 10, 50]) {
    const request = { query: "适合机器人模块安装或跳跃落地的音效", scope: "sound", matchOn: "audio",
      locale: "zh-CN", includeEffectAudio: true, messages: [], previousIds: [], resultLimit };
    const { messages, tools } = buildAgentPrompt(request, config, loaded);
    assert.ok(Buffer.byteLength(JSON.stringify({ messages, tools }), "utf8") <= config.maxPromptBytes);
    for (const mode of ["agent", "candidates"]) {
      const rendered = renderSystemPrompt(loaded, resultLimit, mode);
      assert.ok(rendered.startsWith(loaded.replace(/\bRESULT_LIMIT\b/g, String(resultLimit))));
      assert.doesNotMatch(rendered, /\bRESULT_LIMIT\b/);
    }
  }
});
