import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentError, assetFunctionTools, buildAgentPrompt as buildAgentPromptFromSource, runAssetAgent } from "./agent-runtime.mjs";
import { settings, validateModelResult } from "./worker.mjs";
import { TEST_SYSTEM_PROMPT, withPromptFetch } from "./system-prompt-fixture.mjs";
const buildAgentPrompt = (request, config) => buildAgentPromptFromSource(request, config, TEST_SYSTEM_PROMPT);

const config = () => settings({ UPSTREAM_URL: "https://provider.example/v1/chat/completions", MODEL: "mock-model",
  UPSTREAM_API_KEY: "mock-key", VISITOR_HASH_SECRET: "mock-secret", INPUT_CNY_PER_MILLION: "5", OUTPUT_CNY_PER_MILLION: "20" });
const request = (scope = "all") => ({ query: "再来点", scope, locale: "zh-CN", includeEffectAudio: true,
  previousIds: ["effect:100"], messages: [{ role: "user", content: "来点爆炸特效" }, { role: "assistant", content: "已找到爆炸候选 effect:100" }] });
const asset = { resourceId: "effect:101", kind: "effect", title: "黄色爆炸", description: "", keywords: [], suggestedUses: [], hasAudio: false };
const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const response = (calls, result = { answer: "找到新的爆炸特效。", matches: [{ resourceId: "effect:101", reason: "名称匹配爆炸", matchType: "feature" }] }) =>
  new Response(JSON.stringify({ choices: [{ finish_reason: calls ? "tool_calls" : "stop", message: calls ? { content: null, tool_calls: calls } : { content: JSON.stringify(result) } }],
    usage: { prompt_tokens: 100, completion_tokens: 40 } }));

test("agent tool descriptions agree with the enforced details limit and cursor protocol", () => {
  const tools = assetFunctionTools();
  const details = tools.find(tool => tool.function.name === "get_assets").function;
  assert.equal(details.parameters.properties.ids.maxItems, 5);
  assert.match(details.description, /up to 5 resource IDs/);
  const search = tools.find(tool => tool.function.name === "search_assets").function;
  assert(Object.hasOwn(search.parameters.properties, "cursor"));
  assert(!Object.hasOwn(search.parameters.properties, "previousCursor"));
  assert.match(search.description, /keep all other search arguments identical/);
});

test("more-results reasoning is passed to model and its rewritten query reaches the shared search tool", async () => {
  const req = request(), cfg = config(); let rounds = 0, searched;
  const result = await runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, { UPSTREAM_API_KEY: "mock-key" }, {
    search: async args => { searched = args; return { catalogVersion: "v1", items: [asset], total: 1, mode: "keyword", nextCursor: null,
      retrievalNotice: { code: "MUSIC_DESCRIPTION_MISSING" } }; },
  }, validateModelResult, async (_url, options) => {
    const sent = JSON.parse(options.body); rounds += 1;
    if (rounds === 1) {
      assert.equal(sent.tool_choice, "auto"); assert.ok(sent.messages.at(-1).content.includes('"previousIds":["effect:100"]'));
      assert.equal(Object.hasOwn(sent, "response_format"), false);
      assert.equal(Object.hasOwn(sent, "thinking"), false, "Generic providers receive no unsolicited thinking option");
      assert.equal(Object.hasOwn(sent, "parallel_tool_calls"), false, "Generic providers receive no unsolicited parallel-tool option");
      return response([call("search-1", "search_assets", { query: "爆炸", scope: "effect", excludeIds: ["effect:100"] })]);
    }
    assert.equal(sent.messages.at(-1).role, "tool"); assert.match(sent.messages.at(-1).content, /effect:101/);
    assert.equal(JSON.parse(sent.messages.at(-1).content).retrievalNotice.code, "MUSIC_DESCRIPTION_MISSING");
    return response(null);
  });
  assert.equal(searched.query, "爆炸"); assert.equal(searched.scope, "effect"); assert.deepEqual(searched.excludeIds, ["effect:100"]);
  assert.equal(searched.limit, 10); assert.equal(result.rounds, 2); assert.equal(result.usage.prompt_tokens, 200);
  assert.equal(result.retrievalMode, "keyword");
});

test("DashScope enables native parallel searches and disables them for the forced final without bypassing evidence or tool limits", async t => {
  for (const host of ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "cn-beijing.maas.aliyuncs.com"]) {
    await t.test(host, async () => {
      const req = { ...request("sound"), query: "装置到位需要一次短确认声", matchOn: "audio", messages: [], previousIds: [], resultLimit: 5 };
      const cfg = { ...config(), upstream: `https://${host}/compatible-mode/v1/chat/completions` };
      const sound = { resourceId: "sound:123", kind: "sound", title: "电子短声", description: "短促清脆电子音。",
        keywords: ["短促", "清脆", "电子音"], suggestedUses: [] };
      const effect = { resourceId: "effect:124", kind: "effect", title: "装置光点", description: "短促金属撞击。",
        audioDescription: "短促金属撞击，快速衰减。", audioKeywords: ["短促", "金属感"], hasAudio: true, audioMatch: true };
      let rounds = 0, searches = 0, details = 0;
      const flags = [];
      const completed = await runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, { UPSTREAM_API_KEY: "mock-key" }, {
        search: async args => {
          searches++;
          assert.equal(args.scope, "sound"); assert.equal(args.matchOn, "audio");
          return { items: args.searchType === "both" ? [sound] : [effect], mode: "keyword", total: 1 };
        },
        assets: async args => {
          details++;
          assert.deepEqual(args.ids, [sound.resourceId, effect.resourceId]);
          assert(args.ids.length <= 5);
          return { items: [sound, { ...effect, description: "VISUAL_ONLY_白色光点扩散", visualDescription: "VISUAL_ONLY_白色光点扩散",
            audioDescription: "短促金属撞击，快速衰减。", audioKeywords: ["短促", "金属感"] }], missingIds: [] };
        },
      }, validateModelResult, async (_url, input) => {
        const sent = JSON.parse(input.body); rounds++;
        flags.push(sent.parallel_tool_calls);
        if (rounds === 1) return response([
          call("dashscope-use-search", "search_assets", { query: "装置 到位", searchType: "both" }),
          call("dashscope-audio-search", "search_assets", { query: "短促 清脆", searchType: "feature" }),
        ]);
        const values = sent.messages.filter(message => message.role === "tool").map(message => JSON.parse(message.content));
        assert.deepEqual(values.slice(0, 2).flatMap(value => value.items.map(item => item.resourceId)), [sound.resourceId, effect.resourceId]);
        assert.equal(values[1].items[0].audioMatch, true);
        if (rounds === 2) return response([call("dashscope-details", "get_assets", { ids: [sound.resourceId, effect.resourceId] })]);
        assert.equal(sent.tool_choice, "none");
        const evidence = values[2].items.find(item => item.resourceId === effect.resourceId);
        assert.equal(evidence.audioMatch, true);
        assert.match(evidence.audioDescription, /金属撞击/);
        assert.doesNotMatch(evidence.audioDescription, /VISUAL_ONLY/);
        assert.match(evidence.visualDescription, /VISUAL_ONLY/);
        return response(null, { answer: "两条真实声音可以用于场景试听。", matches: [
          { resourceId: sound.resourceId, reason: "用途建议：短电子音可考虑用于轻量确认。", matchType: "suggestion" },
          { resourceId: effect.resourceId, reason: "用途建议：短金属撞击可考虑用于装置到位。", matchType: "suggestion" },
        ] });
      });
      assert.deepEqual(flags, [true, true, false]);
      assert.equal(rounds, 3); assert.equal(searches, 2); assert.equal(details, 1);
      assert.equal(completed.steps.length, 3, "Native parallel calls remain inside the four-call turn budget");
      assert.deepEqual([...completed.records.keys()], [sound.resourceId, effect.resourceId]);
      assert.deepEqual(completed.result.matches.map(match => match.resourceId), [sound.resourceId, effect.resourceId]);
    });
  }
});

test("explicit user type and locale cannot be widened by model tool arguments", async () => {
  const req = request("sound"), cfg = config(); let rounds = 0;
  const result = await runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {
    search: async args => {
      assert.equal(args.scope, "sound"); assert.equal(args.locale, "zh-CN");
      assert.equal(args.includeEffectAudio, true);
      return { items: [asset], mode: "keyword" };
    },
  }, validateModelResult, async () => ++rounds === 1
    ? response([call("search-1", "search_assets", { query: "爆炸", scope: "all", locale: "ru-RU", includeEffectAudio: false })])
    : response(null, { answer: "目前只有视觉名称，无法确认声音。", matches: [] }));
  assert.equal(result.records.size, 0); assert.deepEqual(result.result.matches, []);
});

test("effect audio is selected only with authoritative audio evidence and stays projected after detail reads", async () => {
  const req = request("sound"), cfg = config(); let rounds = 0;
  const audioAsset = { ...asset, hasAudio: true, audioMatch: true, description: "短促爆裂声" };
  const result = await runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {
    search: async () => ({ items: [audioAsset] }),
    assets: async () => ({ items: [{ ...asset, hasAudio: true, description: "黄色光团", fullDescription: "巨大黄色冲击视觉",
      audioShortDescription: "短促爆裂声", audioDescription: "短促爆裂声，随后出现低频衰减尾音。", audioKeywords: ["爆裂"] }] }),
  }, validateModelResult, async (_url, options) => {
    rounds += 1; const sent = JSON.parse(options.body);
    if (rounds === 1) return response([call("search-1", "search_assets", { query: "爆裂" })]);
    if (rounds === 2) return response([call("details-1", "get_assets", { ids: ["effect:101"] })]);
    assert.equal(sent.tool_choice, "none"); assert.deepEqual(sent.response_format, { type: "json_object" });
    const detail = JSON.parse(sent.messages.find(message => message.role === "tool" && message.tool_call_id === "details-1").content).items[0];
    assert.ok(detail.description.includes("短促爆裂声")); assert.equal(detail.description.includes("黄色光团"), false);
    assert.ok(detail.audioDescription.includes("低频衰减尾音"));
    assert.ok(detail.visualDescription.includes("黄色光团")); assert.ok(detail.visualDescription.includes("巨大黄色冲击视觉"));
    return response(null, { answer: "这个特效有短促爆裂声。", matches: [{ resourceId: "effect:101", reason: "音轨描述为短促爆裂声", matchType: "feature" }] });
  });
  assert.equal(result.records.get("effect:101").audioMatch, true); assert.equal(result.rounds, 3);
});

test("detail tools provide full evidence and official DeepSeek disables thinking even when not configured", async () => {
  const req = request(), cfg = { ...config(), upstream: "https://api.deepseek.com/chat/completions", model: "deepseek-flash" };
  let rounds = 0;
  await runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {
    search: async () => ({ items: [asset] }),
    assets: async () => ({ items: [{ ...asset, shortDescription: "简短摘要", description: "详细描述的前言", fullDescription: "完整描述：先闪光，随后扩散烟尘。" }] }),
  }, validateModelResult, async (_url, options) => {
    const sent = JSON.parse(options.body); rounds += 1;
    assert.deepEqual(sent.thinking, { type: "disabled" });
    if (rounds === 1) return response([call("search-1", "search_assets", { query: "黄色爆炸", scope: "effect", matchOn: "visual" })]);
    if (rounds === 2) return response([call("details-1", "get_assets", { ids: ["effect:101"] })]);
    const details = JSON.parse(sent.messages.find(message => message.tool_call_id === "details-1").content).items[0].visualDescription;
    assert.ok(details.includes("详细描述的前言")); assert.ok(details.includes("先闪光")); assert.equal(details.includes("简短摘要"), false);
    return response(null);
  });
});

test("effect audio scope and its fixed evidence survive tool arguments, detail reads and a disabled sound-expansion checkbox", async () => {
  const req = { ...request("effect"), query: "帮我找一些有爆炸的音效的特效", matchOn: "audio", includeEffectAudio: false }, cfg = config();
  let rounds = 0;
  const result = await runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {
    search: async args => {
      assert.equal(args.scope, "effect"); assert.equal(args.matchOn, "audio"); assert.equal(args.includeEffectAudio, false);
      assert.deepEqual(args.filters, { hasAudio: true });
      return { items: [{ ...asset, hasAudio: true, audioMatch: true, description: "低频爆炸声" }] };
    },
    assets: async () => ({ items: [{ ...asset, hasAudio: true, description: "黄色烟尘扩散", fullDescription: "一道黄色光团炸开",
      audioDescription: "低频爆炸声和短暂衰减", audioKeywords: ["爆炸", "低频"] }] }),
  }, validateModelResult, async (_url, options) => {
    const sent = JSON.parse(options.body); rounds += 1;
    if (rounds === 1) {
      assert.match(sent.messages[0].content, /TEST_PROMPT_SOURCE/);
      assert.doesNotMatch(sent.messages[0].content, /RESULT(?:\\)?_LIMIT/);
      assert.deepEqual(sent.tools.find(tool => tool.function.name === "search_assets").function.parameters.properties.matchOn.enum, ["any", "visual", "audio"]);
      return response([call("audio-search", "search_assets", { query: "爆炸", scope: "sound", matchOn: "visual", filters: { hasAudio: true } })]);
    }
    if (rounds === 2) return response([call("audio-details", "get_assets", { ids: ["effect:101"] })]);
    const details = JSON.parse(sent.messages.find(message => message.tool_call_id === "audio-details").content).items[0];
    assert.equal(details.audioMatch, true); assert.match(details.description, /低频爆炸声/);
    assert.match(details.visualDescription, /黄色烟尘/); assert.match(details.audioDescription, /短暂衰减/);
    assert.deepEqual(details.audioKeywords, ["爆炸", "低频"]);
    return response(null);
  });
  assert.equal(result.records.get("effect:101").audioMatch, true); assert.equal(result.rounds, 3);
});

test("visual effect details retain independent audio evidence without changing the matched visual facet", async () => {
  const req = { ...request("effect"), query: "爆炸光团", matchOn: "visual" }, cfg = config(); let rounds = 0;
  const result = await runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {
    search: async () => ({ items: [{ ...asset, description: "黄色爆炸光团", hasAudio: true }] }),
    assets: async () => ({ items: [{ ...asset, description: "黄色爆炸光团扩散", hasAudio: true, audioDescription: "风声呼啸", audioKeywords: ["呼啸"] }] }),
  }, validateModelResult, async (_url, options) => {
    rounds += 1;
    if (rounds === 1) return response([call("visual-search", "search_assets", { query: "爆炸", matchOn: "visual" })]);
    if (rounds === 2) return response([call("visual-details", "get_assets", { ids: ["effect:101"] })]);
    const sent = JSON.parse(options.body), details = JSON.parse(sent.messages.find(message => message.tool_call_id === "visual-details").content).items[0];
    assert.match(details.visualDescription, /黄色爆炸光团/); assert.equal(details.audioDescription, "风声呼啸");
    assert.equal(details.audioMatch, undefined); return response(null);
  });
  assert.equal(result.records.get("effect:101").audioMatch, undefined);
});

test("detail reads cannot introduce IDs that were never returned by this turn's search", async () => {
  const req = request(), cfg = config(); let rounds = 0, reads = 0;
  const result = await runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {
    assets: async () => { reads += 1; return { items: [asset] }; },
    search: async () => ({ items: [asset] }),
  }, validateModelResult, async (_url, options) => {
    rounds += 1; const sent = JSON.parse(options.body);
    if (rounds === 1) return response([call("unobserved", "get_assets", { ids: ["effect:101"] })]);
    if (rounds === 2) {
      assert.equal(JSON.parse(sent.messages.at(-1).content).error.code, "UNOBSERVED_ASSET");
      return response([call("search-now", "search_assets", { query: "爆炸", scope: "effect" })]);
    }
    return response(null);
  });
  assert.equal(reads, 0); assert.equal(result.records.size, 1);
});

test("missing effect soundtrack coverage is passed to the model without substituting sound or visual resources", async () => {
  const req = { ...request("effect"), query: "特效里的爆炸音效", matchOn: "audio" }, cfg = config(); let rounds = 0;
  const result = await runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {
    search: async args => { assert.equal(args.matchOn, "audio"); return { items: [], retrievalNotice: { code: "EFFECT_AUDIO_DESCRIPTION_MISSING" } }; },
  }, validateModelResult, async (_url, options) => {
    rounds += 1;
    if (rounds === 1) return response([call("missing-audio", "search_assets", { query: "爆炸", matchOn: "audio", searchType: "feature" })]);
    const sent = JSON.parse(options.body);
    assert.equal(JSON.parse(sent.messages.at(-1).content).retrievalNotice.code, "EFFECT_AUDIO_DESCRIPTION_MISSING");
    return response(null, { answer: "特效音轨还没有特征资料，无法确认爆炸声。", matches: [] });
  });
  assert.deepEqual(result.result.matches, []); assert.equal(result.records.size, 0);
});

test("real soundtrack keywords remain evidence when prose is absent and visual keywords cannot replace them", async () => {
  const req = { ...request("effect"), matchOn: "audio", includeEffectAudio: false }, cfg = config(); let rounds = 0;
  const result = await runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {
    search: async () => ({ items: [{ ...asset, hasAudio: true, audioMatch: true, keywords: ["低频爆炸"] },
      { ...asset, resourceId: "effect:102", hasAudio: true, keywords: ["爆炸视觉"] }] }),
  }, validateModelResult, async (_url, options) => {
    rounds += 1;
    if (rounds === 1) return response([call("keyword-audio", "search_assets", { query: "爆炸", matchOn: "audio" })]);
    const sent = JSON.parse(options.body), items = JSON.parse(sent.messages.at(-1).content).items;
    assert.deepEqual(items.map(item => item.resourceId), ["effect:101"]); assert.deepEqual(items[0].keywords, ["低频爆炸"]);
    assert.equal(items[0].description, ""); return response(null);
  });
  assert.equal(result.records.size, 1);
});

test("actual retrieval mode follows the last successful search including keyword fallback", async () => {
  const req = request(), cfg = config(); let rounds = 0, searches = 0;
  const answer = await runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {
    search: async () => ({ items: [asset], mode: ++searches === 1 ? "hybrid" : "keyword",
      ...(searches === 2 ? { retrievalWarning: "VECTOR_RETRIEVAL_UNAVAILABLE" } : {}) }),
  }, validateModelResult, async (_url, options) => {
    const sent = JSON.parse(options.body); rounds += 1;
    if (rounds < 3) return response([call(`search-${rounds}`, "search_assets", { query: rounds === 1 ? "爆炸" : "黄色爆炸" })]);
    assert.ok(sent.messages.some(message => message.role === "tool" && message.content.includes("VECTOR_RETRIEVAL_UNAVAILABLE")));
    return response(null);
  });
  assert.equal(answer.retrievalMode, "keyword");
});

test("unknown or unobserved final IDs and excess tool execution are rejected", async () => {
  const req = request(), cfg = config(); let rounds = 0;
  await assert.rejects(runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, { search: async () => ({ items: [] }) }, validateModelResult,
    async () => ++rounds === 1 ? response([call("search-1", "search_assets", { query: "爆炸" })]) : response(null)), error => error.code === "UPSTREAM_RESPONSE_INVALID");
  rounds = 0; let toolExecutions = 0;
  await assert.rejects(runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, { search: async () => { toolExecutions += 1; return { items: [] }; } }, validateModelResult,
    async () => response(Array.from({ length: 5 }, (_, index) => call(`tool-${index}`, "search_assets", { query: "爆炸" })))), error => error.code === "AGENT_LIMIT");
  assert.equal(toolExecutions, 0);
});

test("unsupported tools have specific safe errors and are never automatically retried", async () => {
  const req = request(), cfg = config(); let calls = 0;
  await assert.rejects(runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {}, validateModelResult, async () => {
    calls += 1; return new Response(JSON.stringify({ error: { message: "This model does not support tools; mock-secret" } }), { status: 400 });
  }), error => error.code === "TOOLS_UNSUPPORTED" && !error.message.includes("mock-secret"));
  assert.equal(calls, 1);
  await assert.rejects(runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {}, validateModelResult,
    async () => new Response('{"error":{"message":"unknown model"}}', { status: 400 })), error => error.code === "UPSTREAM_REJECTED");
});

test("model tool arguments remain strict JSON instead of using final-answer repair", async () => {
  const req = request(), cfg = config(); let modelRequests = 0, toolExecutions = 0;
  const malformed = call("strict-tool-arguments", "search_assets", {});
  malformed.function.arguments = "{query:'爆炸',}";
  await assert.rejects(runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {
    search: async () => { toolExecutions += 1; return { items: [asset] }; },
  }, validateModelResult, async () => { modelRequests += 1; return response([malformed]); }), error => error.code === "TOOL_ARGUMENTS");
  assert.equal(modelRequests, 1); assert.equal(toolExecutions, 0);
});

test("large prompts and tool transcripts proceed without the old fixed byte cap", async () => {
  const req = request(), cfg = config();
  const prompt = buildAgentPromptFromSource(req, { ...cfg, maxPromptBytes: 1 }, TEST_SYSTEM_PROMPT + "\n" + "Long system context. ".repeat(2000));
  assert.ok(prompt.inputBytes > 30000);
  assert.equal(prompt.inputBytes, Buffer.byteLength(JSON.stringify({ messages: prompt.messages, tools: prompt.tools })));
  assert.equal(prompt.reservedMicros, Math.ceil((prompt.inputBytes * cfg.inputRate + 1400 * cfg.outputRate) * cfg.costSafety));
  let calls = 0;
  const result = await runAssetAgent(req, prompt, cfg, {}, { catalog: async () => ({ coverage: "x".repeat(40000) }) }, validateModelResult,
    async (_url, options) => {
      calls += 1;
      const sent = JSON.parse(options.body);
      assert.ok(Buffer.byteLength(JSON.stringify({ messages: sent.messages, tools: sent.tools })) > 30000);
      if (calls === 1) return response([call("catalog-1", "get_asset_catalog", {})]);
      assert.equal(JSON.parse(sent.messages.find(item => item.role === "tool").content).coverage.length, 40000);
      return response(null, { answer: "No matching assets in this catalogue.", matches: [] });
    });
  assert.equal(calls, 2);
  assert.equal(result.rounds, 2);
});

test("the complete turn deadline still stops requests before calling the model", async () => {
  const req = request(), cfg = config();
  await assert.rejects(runAssetAgent(req, buildAgentPrompt(req, cfg), { ...cfg, agentTimeoutMs: 0 }, {}, {}, validateModelResult,
    async () => { throw new Error("must not call"); }), error => error.code === "UPSTREAM_TIMEOUT");
});

test("usage above the former byte cap is checked against each round's actual input", async () => {
  const req = request(), cfg = config();
  const prompt = buildAgentPromptFromSource(req, cfg, TEST_SYSTEM_PROMPT + "\n" + "Large system context. ".repeat(2000));
  let calls = 0;
  const result = await runAssetAgent(req, prompt, cfg, {}, { catalog: async () => ({ coverage: "x".repeat(40000) }) }, validateModelResult,
    async (_url, options) => {
      calls += 1;
      const sent = JSON.parse(options.body);
      const inputTokens = calls === 1 ? 31000 : 55000;
      assert.ok(inputTokens <= Buffer.byteLength(JSON.stringify({ messages: sent.messages, tools: sent.tools })));
      return new Response(JSON.stringify({ choices: [{ finish_reason: calls === 1 ? "tool_calls" : "stop",
        message: calls === 1 ? { content: null, tool_calls: [call("large-usage-catalog", "get_asset_catalog", {})] }
          : { content: JSON.stringify({ answer: "No matching assets.", matches: [] }) } }],
        usage: { prompt_tokens: inputTokens, completion_tokens: 40 } }));
    });
  assert.equal(calls, 2);
  assert.deepEqual(result.usage, { prompt_tokens: 86000, completion_tokens: 80 });
});

test("expanded agent result counts reach tools and final validation without increasing model rounds", async () => {
  for (const [count, limit] of [[6, 10], [10, 10], [20, 20]]) {
    const req = { ...request("effect"), resultLimit: limit };
    const cfg = config(); let rounds = 0;
    const items = Array.from({ length: count }, (_, index) => ({ ...asset, resourceId: `effect:${300 + index}`, title: `爆炸${index}` }));
    const result = await runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {
      search: async args => {
        assert.equal(args.limit, limit);
        return { items, mode: "keyword" };
      },
    }, validateModelResult, async (_url, options) => {
      const sent = JSON.parse(options.body); rounds += 1;
      assert.equal(sent.max_tokens, limit === 10 ? 1400 : 2400);
      assert.match(sent.messages[0].content, new RegExp(`最多 ${limit} 条`));
      const searchTool = sent.tools.find(tool => tool.function.name === "search_assets").function.parameters;
      assert.equal(searchTool.properties.limit.maximum, 50);
      assert.equal(searchTool.properties.limit.default, limit);
      const detailsTool = sent.tools.find(tool => tool.function.name === "get_assets").function.parameters;
      assert.equal(detailsTool.properties.ids.maxItems, 5);
      if (rounds === 1) return response([call("search-expanded", "search_assets", { query: "爆炸" })]);
      return response(null, { answer: "找到这些爆炸特效。", matches: items.map(item => ({ resourceId: item.resourceId, reason: "爆炸名称匹配", matchType: "feature" })) });
    });
    assert.equal(result.rounds, 2);
    assert.deepEqual(result.result.matches.map(item => item.resourceId), items.map(item => item.resourceId));
  }
});

test("expanded results keep the detail call at five resources and expose its safe error to the model", async () => {
  const req = { ...request(), resultLimit: 20 }, cfg = config();
  const items = Array.from({ length: 20 }, (_, index) => ({ ...asset, resourceId: `effect:${400 + index}` }));
  let rounds = 0, detailReads = 0;
  const result = await runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {
    search: async args => { assert.equal(args.limit, 30); return { items }; },
    assets: async () => { detailReads += 1; throw new Error("Must not execute a six-resource detail read"); },
  }, validateModelResult, async (_url, options) => {
    rounds += 1; const sent = JSON.parse(options.body);
    if (rounds === 1) return response([call("search-twenty", "search_assets", { query: "爆炸", limit: 30 })]);
    if (rounds === 2) return response([call("details-too-many", "get_assets", { ids: items.slice(0, 6).map(item => item.resourceId) })]);
    assert.equal(sent.tool_choice, "none");
    assert.equal(JSON.parse(sent.messages.find(message => message.tool_call_id === "details-too-many").content).error.code, "INVALID_REQUEST");
    return response(null, { answer: "依据名称找到这些特效。", matches: items.map(item => ({ resourceId: item.resourceId, reason: "爆炸名称匹配", matchType: "feature" })) });
  });
  assert.equal(result.result.matches.length, 20);
  assert.equal(detailReads, 0); assert.equal(result.rounds, 3);
});


test('fifty audio matches retain every trusted ID and normal audio summaries beyond 30 KB', async () => {
  const req = { ...request('effect'), resultLimit: 50, matchOn: 'audio' }, cfg = config();
  const items = Array.from({ length: 50 }, (_, index) => ({ resourceId: `effect:${700 + index}`, kind: 'effect',
    title: '蓝色光圈'.repeat(40), hasAudio: true, audioMatch: true, matchType: 'feature',
    description: '沉重爆炸音轨'.repeat(100), shortDescription: '沉重爆炸音轨'.repeat(100),
    keywords: Array.from({ length: 10 }, () => '真实低频音轨'.repeat(13)),
    suggestedUses: Array.from({ length: 3 }, () => '仅为用途建议'.repeat(25)),
  }));
  let rounds = 0;
  const result = await runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {
    search: async args => { assert.equal(args.limit, 50); return { items, mode: 'keyword', total: 50 }; },
  }, validateModelResult, async (_url, options) => {
    rounds += 1; const sent = JSON.parse(options.body); assert.equal(sent.max_tokens, 5400);
    assert.equal(sent.tools.find(item => item.function.name === 'get_assets').function.parameters.properties.ids.maxItems, 5);
    if (rounds === 1) return response([call('search-fifty', 'search_assets', { query: '爆炸' })]);
    assert.ok(new TextEncoder().encode(JSON.stringify({ messages: sent.messages, tools: sent.tools })).byteLength > 30000);
    const summary = JSON.parse(sent.messages.find(item => item.role === 'tool').content);
    assert.equal(summary.items.length, 50); assert.equal(summary.summariesShortened, undefined);
    assert.deepEqual(summary.items.map(item => item.resourceId), items.map(item => item.resourceId));
    assert.ok(summary.items.every(item => item.audioMatch === true && item.description.startsWith('沉重爆炸音轨') && item.matchType === 'feature'));
    assert.ok(summary.items.every(item => item.description.length === 260 && item.keywords.length === 10));
    assert.ok(summary.items.every(item => item.suggestedUses.every(use => use.startsWith('仅为用途建议'))));
    return response(null, { answer: '找到这些带爆炸音轨的特效。', matches: items.map(item => ({ resourceId: item.resourceId, reason: '音轨描述支持', matchType: 'feature' })) });
  });
  assert.equal(result.rounds, 2); assert.equal(result.result.matches.length, 50);
});

test("explicit first-turn clarification completes one model round without any catalogue tool", async () => {
  const req = { ...request(), query: "帮我给传送门找点声音", messages: [], previousIds: [] }, cfg = config();
  const question = "你希望传送门偏神秘、科技感还是自然魔法？也可以先说进入时还是持续待机的声音。";
  let modelRequests = 0, toolCalls = 0;
  const noTool = async () => { toolCalls += 1; throw new Error("Clarification must not read the catalogue"); };
  const result = await runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {
    search: noTool, assets: noTool, catalog: noTool,
  }, validateModelResult, async (_url, options) => {
    modelRequests += 1; const sent = JSON.parse(options.body);
    assert.equal(sent.tool_choice, "auto");
    assert.equal(Object.hasOwn(sent, "response_format"), false);
    return response(null, { answer: question, matches: [], clarification: true });
  });
  assert.equal(modelRequests, 1); assert.equal(toolCalls, 0); assert.equal(result.rounds, 1);
  assert.equal(result.records.size, 0); assert.deepEqual(result.steps, []);
  assert.deepEqual(result.result, { answer: question, matches: [] });
  assert.equal(Object.hasOwn(result.result, "clarification"), false);
  assert.equal(result.retrievalMode, undefined);
  assert.deepEqual(result.usage, { prompt_tokens: 100, completion_tokens: 40 });
});

test("first-turn answers without the explicit marker still require catalogue tools", async t => {
  for (const [name, result] of [
    ["empty results", { answer: "你想要哪种感觉？", matches: [] }],
    ["invented results", { answer: "这个资源适合传送门。", matches: [{ resourceId: "effect:101", reason: "猜测匹配", matchType: "feature" }] }],
  ]) {
    await t.test(name, async () => {
      const req = request(), cfg = config(); let modelRequests = 0, toolCalls = 0;
      await assert.rejects(runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {
        search: async () => { toolCalls += 1; return { items: [asset] }; },
      }, validateModelResult, async () => { modelRequests += 1; return response(null, result); }),
      error => error.code === "TOOLS_UNSUPPORTED");
      assert.equal(modelRequests, 1); assert.equal(toolCalls, 0);
    });
  }
});

test("clarification cannot carry prior or invented matches, invalid markers, empty text or unsafe text", async t => {
  const valid = { answer: "你偏好哪种传送门声音？", matches: [], clarification: true };
  const match = resourceId => ({ resourceId, reason: "猜测用途", matchType: "suggestion" });
  for (const [name, result] of [
    ["prior resource ID", { ...valid, matches: [match("effect:100")] }],
    ["invented resource ID", { ...valid, matches: [match("effect:999")] }],
    ["false marker", { ...valid, clarification: false }],
    ["string marker", { ...valid, clarification: "true" }],
    ["number marker", { ...valid, clarification: 1 }],
    ["null marker", { ...valid, clarification: null }],
    ["missing matches", { ...valid, matches: undefined }],
    ["non-array matches", { ...valid, matches: {} }],
    ["blank answer", { ...valid, answer: "  \n " }],
    ["non-string answer", { ...valid, answer: 42 }],
    ["overlong answer", { ...valid, answer: "问".repeat(1801) }],
    ["unsupported answer link", { ...valid, answer: "哪种方向？https://example.test" }],
  ]) {
    await t.test(name, async () => {
      const req = request(), cfg = config(); let modelRequests = 0;
      await assert.rejects(runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {}, validateModelResult,
        async () => { modelRequests += 1; return response(null, result); }),
      error => error.code === "UPSTREAM_RESPONSE_INVALID");
      assert.equal(modelRequests, 1);
    });
  }
});

test("clarification consumes only its marker and leaves unknown fields for the result validator", async () => {
  const req = request(), cfg = config(); let validations = 0;
  await assert.rejects(runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {}, (value, candidates, limit) => {
    validations += 1;
    assert.deepEqual(value, { answer: "你偏好哪种声音？", matches: [], unexpected: "must stay visible to validation" });
    assert.deepEqual(candidates, []); assert.equal(limit, 10);
    throw new AgentError(502, "UPSTREAM_RESPONSE_INVALID", "Unexpected field");
  }, async () => response(null, { answer: "你偏好哪种声音？", matches: [], clarification: true,
    unexpected: "must stay visible to validation" })), error => error.code === "UPSTREAM_RESPONSE_INVALID");
  assert.equal(validations, 1);
});

test("repaired first-round clarification keeps the existing marker and result validation rules", async () => {
  const req = request(), cfg = config();
  const modelResponse = source => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: source } }],
    usage: { prompt_tokens: 100, completion_tokens: 20 } }));
  const valid = "```json\n{answer:'你偏好哪种声音？',matches:[],clarification:true,}\n```";
  const answer = await runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {}, validateModelResult, async () => modelResponse(valid));
  assert.deepEqual(answer.result, { answer: "你偏好哪种声音？", matches: [] }); assert.equal(answer.rounds, 1);
  assert.equal(Object.hasOwn(answer.result, "clarification"), false);
  for (const source of [
    "{answer:'你偏好哪种声音？',matches:[],clarification:'true',}",
    "{answer:'你偏好哪种声音？',matches:[],clarification:true,unexpected:'不能去掉',}",
    "{answer:'你偏好哪种声音？',matches:[{resourceId:'effect:101',reason:'猜测',matchType:'feature'}],clarification:true,}",
  ]) {
    await assert.rejects(runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {}, validateModelResult, async () => modelResponse(source)),
      error => error.code === "UPSTREAM_RESPONSE_INVALID" && error.rawResponse === source);
  }
});

test("clarification after retrieval also requires empty matches and a true marker", async t => {
  const cfg = config(), req = request();
  for (const [name, finalResult, rejected] of [
    ["valid follow-up question", { answer: "想更偏低沉还是明亮？", matches: [], clarification: true }, false],
    ["false marker", { answer: "想更偏低沉还是明亮？", matches: [], clarification: false }, true],
    ["string marker", { answer: "想更偏低沉还是明亮？", matches: [], clarification: "true" }, true],
    ["question mixed with observed matches", { answer: "想选这个吗？", matches: [{ resourceId: asset.resourceId, reason: "名称匹配", matchType: "feature" }], clarification: true }, true],
  ]) {
    await t.test(name, async () => {
      let modelRequests = 0, searchCalls = 0;
      const run = runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {
        search: async () => { searchCalls += 1; return { items: [asset] }; },
      }, validateModelResult, async () => ++modelRequests === 1
        ? response([call("clarification-search", "search_assets", { query: "爆炸" })])
        : response(null, finalResult));
      if (rejected) await assert.rejects(run, error => error.code === "UPSTREAM_RESPONSE_INVALID");
      else {
        const result = await run;
        assert.deepEqual(result.result, { answer: finalResult.answer, matches: [] });
        assert.equal(result.records.size, 1); assert.equal(result.rounds, 2);
      }
      assert.equal(modelRequests, 2); assert.equal(searchCalls, 1);
    });
  }
});

test("the user's direction after clarification reaches normal bounded tool search", async () => {
  const cfg = config(), originalQuery = "帮我给传送门找点声音";
  const initial = { ...request("sound"), query: originalQuery, messages: [], previousIds: [], matchOn: "audio" };
  const clarification = await runAssetAgent(initial, buildAgentPrompt(initial, cfg), cfg, {}, {}, validateModelResult,
    async () => response(null, { answer: "偏神秘、科技感还是自然魔法？想要开启声还是持续声？", matches: [], clarification: true }));
  const followup = { ...initial, query: "神秘的开启声，短促能量呼啸", messages: [
    { role: "user", content: originalQuery }, { role: "assistant", content: clarification.result.answer },
  ] };
  const sound = { resourceId: "sound:123", kind: "sound", title: "能量呼啸", description: "短促的能量呼啸声", keywords: ["呼啸"], suggestedUses: [] };
  let modelRequests = 0, searchCalls = 0;
  const result = await runAssetAgent(followup, buildAgentPrompt(followup, cfg), cfg, {}, {
    search: async args => {
      searchCalls += 1;
      assert.equal(args.query, "短促 能量 呼啸"); assert.equal(args.scope, "sound");
      assert.equal(args.matchOn, "audio"); assert.equal(args.searchType, "feature"); assert.equal(args.limit, 10);
      return { items: [sound], mode: "keyword" };
    },
  }, validateModelResult, async (_url, options) => {
    const sent = JSON.parse(options.body); modelRequests += 1;
    assert.equal(sent.tool_choice, "auto");
    assert.ok(sent.messages.some(message => message.role === "assistant" && message.content === clarification.result.answer));
    assert.match(sent.messages.findLast(message => message.role === "user").content, /神秘的开启声/);
    if (modelRequests === 1) return response([call("directed-search", "search_assets", {
      query: "短促 能量 呼啸", scope: "sound", matchOn: "audio", searchType: "feature",
    })]);
    return response(null, { answer: "这个短促呼啸声可作为神秘传送门开启声的候选。", matches: [
      { resourceId: "sound:123", reason: "声学描述包含短促能量呼啸，可尝试用于开启时的瞬间", matchType: "feature" },
    ] });
  });
  assert.equal(modelRequests, 2); assert.equal(searchCalls, 1); assert.equal(result.rounds, 2);
  assert.deepEqual(result.result.matches.map(match => match.resourceId), ["sound:123"]);
  assert.equal(result.records.size, 1); assert.equal(Object.hasOwn(result.result, "clarification"), false);
});

test("added game uses reach search and detail summaries after legacy uses, including the final budget round", async () => {
  const req = { ...request("sound"), query: "更短", messages: [
    { role: "user", content: "适合升级的尖锐音效" }, { role: "assistant", content: "可尝试尖锐的强化确认。" },
  ], previousIds: [], matchOn: "audio" }, cfg = config();
  const gameUse = "升级完成反馈：短促尖锐起音可用于有穿透力的强化确认";
  const sound = { resourceId: "sound:50941", kind: "sound", title: "短音", description: "短促尖锐电子音", keywords: ["短促", "尖锐"],
    suggestedUses: ["影视转场：短促尖锐电子音", "消息通知：短促尖锐电子音", "视频剪辑点缀：短促尖锐电子音", gameUse] };
  let rounds = 0;
  const result = await runAssetAgent(req, buildAgentPrompt(req, cfg), cfg, {}, {
    search: async () => ({ items: [sound], mode: "keyword", total: 1 }),
    assets: async () => ({ items: [sound] }),
  }, validateModelResult, async (_url, options) => {
    const sent = JSON.parse(options.body); rounds++;
    if (rounds === 1) return response([
      call("game-use-search", "search_assets", { query: "升级", scope: "sound", matchOn: "audio", searchType: "both" }),
      call("game-sound-search", "search_assets", { query: "短促尖锐", scope: "sound", matchOn: "audio", searchType: "feature" }),
    ]);
    const summary = JSON.parse(sent.messages.filter(message => message.role === "tool").at(-1).content).items[0];
    assert.equal(summary.suggestedUses[0], gameUse, "A fourth use remains visible in detail reads when a refinement inherits its game event from this turn's search");
    assert.equal(summary.description, sound.description, "Use suggestions never replace acoustic evidence");
    if (rounds === 2) return response([call("game-detail", "get_assets", { ids: [sound.resourceId] })]);
    assert.equal(sent.tool_choice, "none");
    assert.match(sent.messages.at(-1).content, /候选少也照常展示/);
    assert.doesNotMatch(sent.messages.at(-1).content, /返回空 matches 并说明资料不足/);
    return response(null, { answer: "先试这个尖锐短音，你希望升级反馈更轻巧还是更有力度？", matches: [
      { resourceId: sound.resourceId, reason: "用途建议：描述中的短促尖锐起音可尝试用于强化确认。", matchType: "suggestion" },
    ] });
  });
  assert.equal(rounds, 3); assert.equal(result.result.matches[0].resourceId, sound.resourceId);
  assert.equal(result.records.get(sound.resourceId).suggestedUses.length, 4, "Stored legacy and new uses stay intact");
});
