/* Run: node scripts/test-ai-search-result-limits.cjs. All requests are fixtures; no network or model calls. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
global.fetch = async () => { throw new Error("Unexpected network request in result-limit test"); };

const { buildSearchPayload, buildServerChatPayload, parseServerCatalog, parseServerResources, requestSearch: requestSearchActual, requestServerSearchBatch, requestServerAssets, validateSearchAnswer } = require("../src/views/AISearch/aiSearchService.ts");
const { buildAgentSearchPayload, requestAgentSearch: requestAgentSearchActual } = require("../src/views/AISearch/agentSearchService.ts");
const promptFixture = '# External prompt fixture\nReturn at most RESULT\\_LIMIT resources.\n';
function withPromptFixture(actualRequest) {
  return (payload, candidatesOrOptions, maybeOptions) => {
    const options = maybeOptions ?? candidatesOrOptions;
    const fetcher = options.fetcher;
    const wrapped = { ...options, fetcher: async (url, input) => {
      if (String(url).split('?')[0].endsWith('/AISearch/SystemPrompt.md')) {
        assert.equal(options.mode, 'custom', 'Free AI does not download its prompt in the browser');
        assert.equal(input.headers?.Authorization, undefined);
        return new Response(promptFixture, { headers: { 'Content-Type': 'text/markdown' } });
      }
      if (String(url).endsWith('/chat/completions')) {
        const system = JSON.parse(input.body).messages[0].content;
        assert.ok(system.includes('External prompt fixture'));
        assert.ok(system.includes(`at most ${payload.resultLimit} resources`));
      }
      return fetcher(url, input);
    } };
    return maybeOptions ? actualRequest(payload, candidatesOrOptions, wrapped) : actualRequest(payload, wrapped);
  };
}
const requestSearch = withPromptFixture(requestSearchActual);
const requestAgentSearch = withPromptFixture(requestAgentSearchActual);
const { restoreConversations } = require("../src/views/AISearch/useAISearch.ts");
const { DEFAULT_SEARCH_RESULTS, MAX_SEARCH_RESULTS, SEARCH_RESULT_LIMITS, normalizeResultLimit } = require("../src/views/AISearch/resultLimits.ts");

const version = "result-limit-fixture-v1";
const summaries = Array.from({ length: 51 }, (_, index) => ({
  resourceId: `sound:${9001 + index}`, kind: "sound", title: `碰撞音效 ${index + 1}`,
  description: "短促的碰撞音", keywords: ["碰撞", "短促"], suggestedUses: [], duration: 1 + index / 10,
}));
const resources = [...parseServerResources(summaries.slice(0, 50), "zh-CN"), ...parseServerResources(summaries.slice(50), "zh-CN")];
const answer = count => ({ answer: "找到匹配的碰撞音效", matches: resources.slice(0, count).map(item => ({ resourceId: item.resourceId, reason: "碰撞音效", matchType: "feature" })) });
const response = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const signal = () => new AbortController().signal;
const question = (content = "碰撞音效") => ({ id: "question", role: "user", status: "complete", content, cards: [], mode: "custom", source: "custom" });
const reply = (cards = resources.slice(0, 20), content = "找到碰撞音效") => ({ id: "reply", role: "assistant", status: "complete", content, cards, mode: "custom", source: "custom" });
const errorCode = expected => error => error.code === expected;
const customOptions = { mode: "custom", config: { baseUrl: "https://example.invalid/v1", model: "fixture-model", apiKey: "fixture-key-only", rememberKey: false }, freeBase: "/api/ai-search", signal: signal() };

(async () => {
  assert.equal(DEFAULT_SEARCH_RESULTS, 10);
  assert.equal(MAX_SEARCH_RESULTS, 50);
  assert.deepEqual([...SEARCH_RESULT_LIMITS], [5, 10, 20, 50]);
  for (const count of [1, 5, 10, 20, 25, 37, 50]) assert.equal(normalizeResultLimit(count), count);
  for (const value of [undefined, null, 0, -1, 1.5, 51, Infinity, NaN, "20", {}, [20]]) assert.equal(normalizeResultLimit(value), 10);

  assert.equal(validateSearchAnswer(answer(10), resources, 10).matches.length, 10);
  assert.equal(validateSearchAnswer(answer(20), resources, 20).matches.length, 20);
  assert.equal(validateSearchAnswer(answer(20), resources).matches.length, 20, "The validator accepts the new overall maximum when no round-specific cap is supplied");
  assert.throws(() => validateSearchAnswer(answer(11), resources, 10), errorCode("RESPONSE_FORMAT"), "A model cannot exceed the user's selected count");
  assert.equal(validateSearchAnswer(answer(50), resources).matches.length, 50);
  assert.throws(() => validateSearchAnswer(answer(51), resources), errorCode("RESPONSE_FORMAT"));
  const duplicate = answer(20);
  duplicate.matches[19] = { ...duplicate.matches[0] };
  assert.throws(() => validateSearchAnswer(duplicate, resources, 20), errorCode("RESPONSE_ASSET_ID"));
  const invented = answer(20);
  invented.matches[19].resourceId = "sound:999999";
  assert.throws(() => validateSearchAnswer(invented, resources, 20), errorCode("RESPONSE_ASSET_ID"));

  const defaultPayload = buildSearchPayload("碰撞音效", "zh-CN", "sound", [], resources, "default-limit");
  assert.equal(defaultPayload.resultLimit, 10);
  for (const count of [5, 10, 20]) {
    const payload = buildSearchPayload("碰撞音效", "zh-CN", "sound", [], resources.slice(0, 20), `limit-${count}`, count);
    assert.equal(payload.resultLimit, count);
    const serverPayload = buildServerChatPayload(payload, resources.slice(0, 20), version, true);
    assert.equal(serverPayload.resultLimit, count, "The IDs-only server protocol carries the selected count");
    assert.equal(buildAgentSearchPayload("碰撞音效", "zh-CN", "sound", [], true, `agent-${count}`, count).resultLimit, count);
  }
  const twentyPayload = buildSearchPayload("碰撞音效", "zh-CN", "sound", [], resources.slice(0, 20), "twenty-results", 20);
  assert.equal(twentyPayload.candidates.length, 20, "Requesting 20 results must make at least 20 compact candidates available to the legacy model");
  let modelCalls = 0;
  const twentyReply = await requestSearch(twentyPayload, resources.slice(0, 20), { ...customOptions, fetcher: async (url, options) => {
    modelCalls++;
    assert.equal(url, "https://example.invalid/v1/chat/completions");
    const body = JSON.parse(options.body);
    assert.ok(!options.body.includes("fixture-key-only"), "Credentials never enter model context");
    assert.ok(body.messages.some(message => message.content.includes('"resultLimit":20')), "The model receives the selected count");
    return response({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answer(20)) } }] });
  } });
  assert.equal(twentyReply.matches.length, 20);
  assert.equal(modelCalls, 1);
  const tenPayload = buildSearchPayload("碰撞音效", "zh-CN", "sound", [], resources.slice(0, 20), "ten-results", 10);
  await assert.rejects(() => requestSearch(tenPayload, resources.slice(0, 20), { ...customOptions, fetcher: async () => response({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answer(11)) } }] }) }), errorCode("RESPONSE_FORMAT"), "Actual custom-model requests enforce the selected limit");

  const twentyIds = resources.slice(0, 20).map(item => item.resourceId);
  const batches = [];
  const detailed = await requestServerAssets("/api/ai-search", twentyIds, "zh-CN", version, signal(), new Set(), async (url, options) => {
    assert.equal(url, "/api/ai-search/assets");
    const ids = JSON.parse(options.body).ids;
    batches.push(ids);
    assert.ok(ids.length <= 10, "Old deployed asset-detail endpoints accept at most 10 IDs per request");
    return response({ catalogVersion: version, missingIds: [], items: ids.slice().reverse().map(id => summaries.find(item => item.resourceId === id)) });
  });
  assert.equal(batches.length, 2, "20 cards load in exactly two compatible detail batches");
  assert.deepEqual(batches.flat(), twentyIds);
  assert.deepEqual(detailed.map(item => item.resourceId), twentyIds, "Reversed responses cannot change display order");

  let detailCalls = 0, failedBatchReads = 0, activeSingleReads = 0, maxActiveSingleReads = 0;
  const detailUrls = [], singleIds = [];
  const splitDetailed = await requestServerAssets("/api/ai-search", twentyIds, "zh-CN", version, signal(), new Set(), async (url, options) => {
    detailUrls.push(url);
    detailCalls++;
    const ids = JSON.parse(options.body).ids;
    if (ids.length > 1) {
      failedBatchReads++;
      assert.ok(ids.length <= 10);
      return new Response(JSON.stringify({ error: { code: "DETAILS_TOO_LARGE" } }), { status: 413 });
    }
    singleIds.push(ids[0]);
    activeSingleReads++;
    maxActiveSingleReads = Math.max(maxActiveSingleReads, activeSingleReads);
    await new Promise(resolve => setTimeout(resolve, Number(ids[0].split(":")[1]) % 3 ? 2 : 12));
    activeSingleReads--;
    return response({ catalogVersion: version, missingIds: [], items: [summaries.find(item => item.resourceId === ids[0])] });
  });
  assert.ok(failedBatchReads >= 1 && failedBatchReads <= 2, "Only compatible batches precede the size fallback");
  assert.equal(detailCalls, 20 + failedBatchReads, "Size fallback reads each asset once without repeating failed batches");
  assert.deepEqual(singleIds.slice().sort(), twentyIds.slice().sort());
  assert.ok(maxActiveSingleReads > 1 && maxActiveSingleReads <= 3, "Oversized 20-card details use at most three concurrent single-ID reads overall");
  assert.ok(detailUrls.every(url => url === "/api/ai-search/assets"), "Oversized details never repeat a paid chat request");
  assert.deepEqual(splitDetailed.map(item => item.resourceId), twentyIds);
  let invalidDetailReads = 0;
  for (const ids of [resources.map(item => item.resourceId), [...twentyIds.slice(0, 19), twentyIds[0]], [...twentyIds.slice(0, 19), "sound:../1"]]) {
    await assert.rejects(() => requestServerAssets("/api/ai-search", ids, "zh-CN", version, signal(), new Set(), async () => { invalidDetailReads++; throw new Error("Invalid IDs must fail before fetching"); }), errorCode("ASSET_DETAILS"));
  }
  assert.equal(invalidDetailReads, 0);

  const restored = restoreConversations([{ id: "conversation", title: "Twenty results", contextStart: 0, messages: [question(), reply(resources.slice(0, 20).map(item => ({ ...item, href: "javascript:alert(1)" })))] }]);
  assert.deepEqual(restored[0].messages[1].cards.map(item => item.resourceId), twentyIds, "Restoring history retains cards 6 through 20");
  assert.ok(restored[0].messages[1].cards.every(item => item.href === `/SoundEffectPlayer?id=${item.id}`), "Expanding history never restores an untrusted route");
  const restoredOverLimit = restoreConversations([{ id: "extra-card", messages: [reply(resources)] }]);
  assert.equal(restoredOverLimit[0].messages[0].cards.length, 50);

  const verboseCards = resources.slice(0, 20).map(item => ({ ...item, title: "碰撞音效".repeat(50) }));
  const longHistory = Array.from({ length: 4 }, (_, index) => [question(index ? "更短一点" : "碰撞音效"), reply(verboseCards, "声音匹配说明".repeat(250))]).flat();
  const agentPayload = buildAgentSearchPayload("再来点", "zh-CN", "sound", longHistory, true, "all-history-ids", 20);
  assert.equal(agentPayload.resultLimit, 20);
  assert.deepEqual(agentPayload.previousIds, twentyIds, "More alternatives exclude all previously displayed cards");
  const lastAnswer = agentPayload.messages.filter(message => message.role === "assistant").at(-1);
  for (const id of twentyIds) assert.ok(lastAnswer.content.includes(JSON.stringify(id)), `The latest model context retains ${id} despite verbose titles`);
  assert.ok(agentPayload.messages.every(message => message.content.length <= 1900), "History stays within the per-message protocol boundary");
  assert.ok(new TextEncoder().encode(JSON.stringify(agentPayload)).length <= 21000, "Twenty-card context remains within the complete request byte budget");
  assert.equal(buildAgentSearchPayload("碰撞音效", "zh-CN", "sound", [], true, "default-agent").resultLimit, 10);

  let freeCalls = 0;
  const freeAgent = buildAgentSearchPayload("碰撞音效", "zh-CN", "sound", [], true, "free-twenty", 20);
  const freeAnswer = await requestAgentSearch(freeAgent, { ...customOptions, mode: "free", fetcher: async (url, options) => {
    freeCalls++;
    assert.equal(url, "/api/ai-search/chat");
    assert.equal(JSON.parse(options.body).resultLimit, 20);
    assert.equal(options.headers.Authorization, undefined);
    return response({ ...answer(20), catalogVersion: version, resources: summaries.slice(0, 20), model: "fixture-free-model" });
  } });
  assert.equal(freeAnswer.matches.length, 20);
  assert.equal(freeAnswer.resources.length, 20);
  assert.equal(freeCalls, 1);
  const freeTen = buildAgentSearchPayload("碰撞音效", "zh-CN", "sound", [], true, "free-ten", 10);
  await assert.rejects(() => requestAgentSearch(freeTen, { ...customOptions, mode: "free", fetcher: async () => response({ ...answer(11), catalogVersion: version, resources: summaries.slice(0, 11) }) }), errorCode("RESPONSE_FORMAT"), "Free-agent replies also enforce the user's selected count");

  const verifyCustomAgentTwenty = async (payload, chosen, expectedExcluded) => {
    let models = 0, searches = 0, details = 0;
    const chosenIds = chosen.map(item => item.resourceId);
    const result = await requestAgentSearch(payload, { ...customOptions, fetcher: async (url, options) => {
      const body = JSON.parse(options.body);
      if (url === "https://example.invalid/v1/chat/completions") {
        models++;
        assert.ok(body.messages.some(message => message.role === "user" && message.content?.includes('"resultLimit":20')), "The planning model receives the selected count");
        if (models === 1) return response({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "search-twenty", type: "function", function: { name: "search_assets", arguments: JSON.stringify({ query: "碰撞", scope: "sound", limit: 20 }) } }] } }] });
        assert.equal(models, 2, "One successful search requires only a planning and a final model reply");
        return response({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer: "匹配的碰撞音效", matches: chosenIds.map(resourceId => ({ resourceId, reason: "碰撞音效", matchType: "feature" })) }) } }] });
      }
      if (url === "/api/ai-search/search") {
        searches++;
        assert.equal(body.limit, 20);
        assert.ok(!("previousIds" in body), "Planning searches do not send the old five-ID refinement protocol");
        if (expectedExcluded) assert.deepEqual(body.excludeIds, expectedExcluded, "More alternatives exclude all 20 old cards even against an old service");
        return response({ catalogVersion: version, mode: "keyword", counts: { total: 100 }, coverage: 1, total: 20, hasMore: false, items: chosen });
      }
      assert.equal(url, "/api/ai-search/assets", "The agent only reads asset details after its final reply");
      details++;
      assert.ok(body.ids.length <= 10);
      return response({ catalogVersion: version, missingIds: [], items: body.ids.slice().reverse().map(id => chosen.find(item => item.resourceId === id)) });
    } });
    assert.equal(result.matches.length, 20);
    assert.deepEqual(result.resources.map(item => item.resourceId), chosenIds);
    assert.equal(models, 2);
    assert.equal(searches, 1);
    assert.equal(details, 2);
  };
  await verifyCustomAgentTwenty(buildAgentSearchPayload("碰撞音效", "zh-CN", "sound", [], true, "custom-twenty", 20), summaries.slice(0, 20));
  const moreSummaries = summaries.slice(0, 20).map((item, index) => ({ ...item, resourceId: `sound:${9201 + index}`, title: `另一种碰撞音效 ${index + 1}` }));
  await verifyCustomAgentTwenty(agentPayload, moreSummaries, twentyIds);

  const fiftyIds = resources.slice(0, 50).map(item => item.resourceId);
  const fiftyHistory = [question(), reply(resources.slice(0, 50).map(item => ({ ...item, title: "碰撞音效".repeat(50) })), "说明".repeat(1000))];
  const fiftyAgent = buildAgentSearchPayload("再来点", "zh-CN", "sound", fiftyHistory, true, "fifty-history", 50);
  assert.deepEqual(fiftyAgent.previousIds, fiftyIds, "All 50 previously shown resources can be excluded");
  const latestFifty = fiftyAgent.messages.at(-1).content;
  for (const id of fiftyIds) assert.ok(latestFifty.includes(JSON.stringify(id)), `The bounded history retains ${id}`);
  assert.ok(latestFifty.length <= 1900);

  const verboseFifty = resources.slice(0, 50).map(item => ({ ...item, title: "碰撞音效".repeat(50), description: "短促金属碰撞".repeat(300), keywords: ["金属碰撞".repeat(10)], suggestedUses: ["战斗反馈".repeat(30)] }));
  const compactFifty = buildSearchPayload("碰撞音效", "zh-CN", "sound", fiftyHistory, verboseFifty, "fifty-compact", 50);
  assert.deepEqual(compactFifty.candidates.map(item => item.resourceId), fiftyIds, "Byte limits compress prose before dropping required candidate IDs");
  assert.ok(Buffer.byteLength(JSON.stringify(compactFifty)) <= 21000);
  const boundedFiftyContext = buildSearchPayload(`第50个${"更低沉".repeat(400)}`, "zh-CN", "sound", fiftyHistory, verboseFifty, "fifty-refinement", 50);
  for (const id of fiftyIds) assert.ok(boundedFiftyContext.messages.at(-1).content.includes(JSON.stringify(id)), "Even a large legacy request preserves all previous displayed IDs");
  assert.equal(boundedFiftyContext.candidates.length, 50);
  assert.ok(Buffer.byteLength(JSON.stringify(boundedFiftyContext)) <= 21000);
  const customFifty = await requestSearch(compactFifty, resources.slice(0, 50), { ...customOptions, fetcher: async (url, input) => {
    const body = JSON.parse(input.body);
    assert.equal(body.max_tokens, 5400);
    assert.equal(body.messages.length > 0, true);
    return response({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answer(50)) } }] });
  } });
  assert.equal(customFifty.matches.length, 50);
  await assert.rejects(() => requestSearch(buildSearchPayload("碰撞音效", "zh-CN", "sound", [], resources.slice(0, 50), "custom-37", 37), resources.slice(0, 50),
    { ...customOptions, fetcher: async () => response({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answer(38)) } }] }) }), errorCode("RESPONSE_FORMAT"));

  const legacyInfo = parseServerCatalog({ catalogVersion: version, mode: "keyword", total: 100 });
  assert.equal(legacyInfo.maxSearchLimit, 30);
  assert.equal(legacyInfo.maxAssetIds, 10);
  assert.equal(legacyInfo.maxExcludeIds, 30, "A service without exclusion capabilities retains the legacy 30-ID bound");
  const oldAdvertised = parseServerCatalog({ catalogVersion: version, mode: "keyword", total: 120, limits: { maxResults: 20, maxPreviousIds: 20 } });
  assert.equal(oldAdvertised.maxPreviousIds, 20);
  assert.equal(oldAdvertised.maxExcludeIds, 30);
  const pageCalls = [];
  const pagedFifty = await requestServerSearchBatch("/api/ai-search", { query: "碰撞", scope: "sound", locale: "zh-CN", includeEffectAudio: true, limit: 50 }, signal(), async (url, input) => {
    assert.equal(url, "/api/ai-search/search");
    const body = JSON.parse(input.body); pageCalls.push(body);
    const start = body.cursor ? 30 : 0;
    return response({ catalogVersion: version, mode: "keyword", total: 50, hasMore: start === 0, ...(start === 0 ? { nextCursor: "page-2" } : {}), items: summaries.slice(start, start + body.limit) });
  }, legacyInfo.maxSearchLimit);
  assert.deepEqual(pageCalls.map(body => body.limit), [30, 20], "Older search deployments are paged within their advertised fallback capability");
  assert.deepEqual(pagedFifty.items.map(item => item.resourceId), fiftyIds);
  const compatiblePool = Array.from({ length: 120 }, (_, index) => ({ ...summaries[0], resourceId: `sound:${9001 + index}`, title: `碰撞音效 ${index + 1}` }));
  const excludedSearchInput = { query: "碰撞", scope: "sound", locale: "zh-CN", includeEffectAudio: true, limit: 50, previousIds: fiftyIds,
    previousQuery: "碰撞音效", excludeIds: fiftyIds, searchType: "feature", filters: { minDuration: 0.1, excludeTerms: ["杂音"] } };
  function compatibleSearch(pool, { previousLimit = 20, excludeLimit = 30, searchLimit = 30, previousIds = fiftyIds, changedVersion = false, advertisedExclude = false } = {}) {
    const calls = [];
    return { calls, fetcher: async (url, input) => {
      assert.equal(url, "/api/ai-search/search");
      const body = JSON.parse(input.body); calls.push(body);
      assert.ok(body.limit <= searchLimit);
      assert.deepEqual(body.excludeIds, fiftyIds.slice(0, excludeLimit), "Exclusion transport stays within the old service's capability");
      if (previousIds === null) assert.equal(body.previousIds, undefined, "Agent rewrites keep the IDs in model context rather than reviving the legacy refinement protocol");
      else assert.deepEqual(body.previousIds, previousIds.slice(0, previousLimit));
      const wirePool = pool.filter(item => !body.excludeIds.includes(item.resourceId));
      const start = body.cursor ? Number(body.cursor.split(":")[1]) : 0;
      const end = Math.min(wirePool.length, start + body.limit);
      const hasMore = end < wirePool.length;
      return response({ catalogVersion: changedVersion && body.cursor ? "changed-compatible-version" : version, mode: "keyword", total: wirePool.length,
        limits: { maxResults: excludeLimit === 50 ? 50 : 20, maxPreviousIds: previousLimit, ...(advertisedExclude ? { maxExcludeIds: excludeLimit, maxSearchLimit: searchLimit } : {}) },
        hasMore, ...(hasMore ? { nextCursor: `offset:${end}` } : {}), items: wirePool.slice(start, end) });
    } };
  }
  const oldExclusions = compatibleSearch(compatiblePool);
  const unseenFifty = await requestServerSearchBatch("/api/ai-search", excludedSearchInput, signal(), oldExclusions.fetcher, 30, oldAdvertised);
  assert.equal(oldExclusions.calls.length, 3, "Locally excluded results trigger further evidence pages without another model call");
  assert.deepEqual(unseenFifty.items.map(item => item.resourceId), compatiblePool.slice(50, 100).map(item => item.resourceId));
  assert.equal(unseenFifty.omittedExcluded, 20, "The full exclusion semantics survive truncating the wire list");
  assert.equal(unseenFifty.hasMore, true);
  assert.equal(unseenFifty.nextCursor, "offset:70", "Cursor continues immediately after the fetched results, without skipping the unrequested final-page tail");
  const { cursor: firstCursor, limit: firstLimit, ...firstFilters } = oldExclusions.calls[0];
  for (const { cursor, limit, ...filters } of oldExclusions.calls) assert.deepEqual(filters, firstFilters, "All cursor-bound filters and ID prefixes stay frozen throughout a batch");

  for (const [count, expected] of [[50, 0], [55, 5]]) {
    const scarce = compatibleSearch(compatiblePool.slice(0, count));
    const scarceResult = await requestServerSearchBatch("/api/ai-search", excludedSearchInput, signal(), scarce.fetcher, 30, oldAdvertised);
    assert.equal(scarceResult.items.length, expected, "Exhausted matching pools return fewer results instead of repeating prior assets");
    assert.equal(scarceResult.hasMore, false);
    assert.ok(scarceResult.items.every(item => !fiftyIds.includes(item.resourceId)));
  }
  const oneItemPages = compatibleSearch(compatiblePool, { searchLimit: 1 });
  const slowUnseen = await requestServerSearchBatch("/api/ai-search", excludedSearchInput, signal(), oneItemPages.fetcher, 1, oldAdvertised);
  assert.equal(oneItemPages.calls.length, 70, "Small compatible pages can advance past all locally excluded items and still fill the requested result count");
  assert.equal(slowUnseen.items.length, 50);
  assert.ok(slowUnseen.items.every(item => !fiftyIds.includes(item.resourceId)));
  const changedExclusions = compatibleSearch(compatiblePool, { changedVersion: true });
  await assert.rejects(() => requestServerSearchBatch("/api/ai-search", excludedSearchInput, signal(), changedExclusions.fetcher, 30, oldAdvertised), errorCode("CATALOG_CHANGED"));
  assert.equal(changedExclusions.calls.length, 2);

  const newExclusions = compatibleSearch(compatiblePool, { previousLimit: 50, excludeLimit: 50, searchLimit: 50, advertisedExclude: true });
  const newUnseen = await requestServerSearchBatch("/api/ai-search", excludedSearchInput, signal(), newExclusions.fetcher, 50, { maxPreviousIds: 50, maxExcludeIds: 50 });
  assert.equal(newExclusions.calls.length, 1);
  assert.equal(newUnseen.items.length, 50);
  assert.equal(newUnseen.maxExcludeIds, 50);
  assert.ok(newUnseen.items.every(item => !fiftyIds.includes(item.resourceId)));

  const agentExclusions = compatibleSearch(compatiblePool, { previousIds: null });
  const unseenMatches = compatiblePool.slice(50, 100).map(item => ({ resourceId: item.resourceId, reason: "新的碰撞音效", matchType: "feature" }));
  let compatibleModels = 0;
  const compatibleAgent = await requestAgentSearch(fiftyAgent, { ...customOptions, maxSearchLimit: 30, maxPreviousIds: 20, maxExcludeIds: 30, fetcher: async (url, input) => {
    const body = JSON.parse(input.body);
    if (url.endsWith("/chat/completions")) {
      assert.equal(body.messages.filter(message => message.role === "user").at(-1).content.includes('"previousIds"'), true);
      if (++compatibleModels === 1) return response({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "compatible-more", type: "function", function: { name: "search_assets", arguments: JSON.stringify({ query: "碰撞", scope: "sound", limit: 50 }) } }] } }] });
      const evidence = JSON.parse(body.messages.find(message => message.role === "tool").content);
      assert.equal(evidence.items.length, 50);
      assert.equal(evidence.omittedPrevious, 20);
      assert.ok(evidence.items.every(item => !fiftyIds.includes(item.resourceId)));
      return response({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer: "新的候选", matches: unseenMatches }) } }] });
    }
    if (url.endsWith("/search")) return agentExclusions.fetcher(url, input);
    assert.equal(url, "/api/ai-search/assets");
    assert.ok(body.ids.length <= 10);
    return response({ catalogVersion: version, missingIds: [], items: body.ids.map(id => compatiblePool.find(item => item.resourceId === id)) });
  } });
  assert.equal(compatibleModels, 2, "Compatibility retries evidence HTTP pages only, never a model request");
  assert.equal(agentExclusions.calls.length, 3);
  assert.equal(compatibleAgent.matches.length, 50);
  assert.ok(compatibleAgent.resources.every(item => !fiftyIds.includes(item.resourceId)));
  await assert.rejects(() => requestServerSearchBatch("/api/ai-search", { query: "碰撞", scope: "sound", locale: "zh-CN", includeEffectAudio: true, limit: 50 }, signal(), async (url, input) => {
    const body = JSON.parse(input.body);
    return response({ catalogVersion: body.cursor ? "changed-version" : version, mode: "keyword", total: 50, hasMore: !body.cursor, ...(!body.cursor ? { nextCursor: "page-2" } : {}), items: summaries.slice(body.cursor ? 30 : 0, body.cursor ? 50 : 30) });
  }, 30), errorCode("CATALOG_CHANGED"), "Different catalogue versions cannot be combined into one result list");

  let fiftyModels = 0, fiftySearches = 0, fiftyDetails = 0;
  const fullFifty = await requestAgentSearch(buildAgentSearchPayload("碰撞音效", "zh-CN", "sound", [], true, "custom-fifty", 50), { ...customOptions, maxSearchLimit: 50, maxAssetIds: 10, fetcher: async (url, input) => {
    const body = JSON.parse(input.body);
    if (url.endsWith("/chat/completions")) {
      assert.equal(body.max_tokens, 5400);
      if (++fiftyModels === 1) return response({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "search-fifty", type: "function", function: { name: "search_assets", arguments: JSON.stringify({ query: "碰撞", scope: "sound", limit: 50 }) } }] } }] });
      const evidence = JSON.parse(body.messages.find(message => message.role === "tool").content);
      assert.deepEqual(evidence.items.map(item => item.resourceId), fiftyIds, "The final model receives all searched IDs after adaptive text compression");
      assert.ok(Buffer.byteLength(JSON.stringify(evidence)) <= 16000);
      return response({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answer(50)) } }] });
    }
    if (url.endsWith("/search")) {
      fiftySearches++;
      assert.equal(body.limit, 50);
      return response({ catalogVersion: version, mode: "keyword", total: 50, limits: { maxSearchLimit: 50, maxAssetIds: 10, maxPreviousIds: 50 }, hasMore: false,
        items: summaries.slice(0, 50).map(item => ({ ...item, description: "短促金属碰撞".repeat(100), keywords: ["碰撞".repeat(50)], suggestedUses: ["碰撞反馈".repeat(50)] })) });
    }
    assert.equal(url, "/api/ai-search/assets");
    fiftyDetails++;
    assert.ok(body.ids.length <= 10);
    return response({ catalogVersion: version, missingIds: [], items: body.ids.slice().reverse().map(id => summaries.find(item => item.resourceId === id)) });
  } });
  assert.deepEqual(fullFifty.resources.map(item => item.resourceId), fiftyIds);
  assert.equal(fiftyModels, 2, "Returning 50 results adds no model rounds");
  assert.equal(fiftySearches, 1, "A new service supplies 50 summaries in one evidence tool call");
  assert.equal(fiftyDetails, 5, "Card previews read trusted details in ten-ID HTTP batches");

  const freeFifty = await requestAgentSearch(buildAgentSearchPayload("碰撞音效", "zh-CN", "sound", [], true, "free-fifty", 50), { ...customOptions, mode: "free", fetcher: async (url, input) => {
    assert.equal(url, "/api/ai-search/chat");
    assert.equal(JSON.parse(input.body).resultLimit, 50);
    return response({ ...answer(50), catalogVersion: version, resources: summaries.slice(0, 50) });
  } });
  assert.equal(freeFifty.matches.length, 50);

  const effectsFifty = summaries.slice(0, 50).map((item, index) => ({ ...item, resourceId: `effect:${10007150 + index}`, kind: "effect", title: "爆裂效果".repeat(30), hasAudio: true, audioMatch: true,
    description: "低沉爆裂回响".repeat(60), visualDescription: "红色火焰粒子扩散".repeat(50), audioDescription: "低沉爆裂回响".repeat(60), audioKeywords: ["爆裂", "回响"],
    suggestedUses: ["机关触发提示"], matchType: index === 0 ? "suggestion" : "feature" }));
  let effectRounds = 0;
  const effectMatches = effectsFifty.map(item => ({ resourceId: item.resourceId, reason: "描述支持低沉爆裂声", matchType: item.matchType }));
  await requestAgentSearch(buildAgentSearchPayload("有爆裂音的特效", "zh-CN", "all", [], true, "fifty-effect-audio", 50, "audio"), { ...customOptions, maxSearchLimit: 50, fetcher: async (url, input) => {
    const body = JSON.parse(input.body);
    if (url.endsWith("/chat/completions")) {
      if (++effectRounds === 1) return response({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "audio-fifty", type: "function", function: { name: "search_assets", arguments: JSON.stringify({ query: "爆裂", scope: "effect", matchOn: "audio", limit: 50 }) } }] } }] });
      const evidence = JSON.parse(body.messages.find(message => message.role === "tool").content);
      assert.equal(evidence.items.length, 50);
      assert.ok(Buffer.byteLength(JSON.stringify(evidence)) <= 16000);
      assert.ok(evidence.items.every(item => item.audioMatch === true && item.audioDescription && item.visualDescription), "Compressed effect summaries keep both independent evidence channels");
      assert.equal(evidence.items[0].matchType, "suggestion");
      assert.ok(evidence.items[0].suggestedUses.length, "Use advice remains separately labelled when its prose is compacted");
      return response({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer: "音轨候选", matches: effectMatches }) } }] });
    }
    if (url.endsWith("/search")) return response({ catalogVersion: version, mode: "keyword", total: 50, limits: { maxSearchLimit: 50, maxAssetIds: 10 }, hasMore: false, items: effectsFifty });
    assert.equal(url, "/api/ai-search/assets");
    return response({ catalogVersion: version, missingIds: [], items: body.ids.map(id => effectsFifty.find(item => item.resourceId === id)) });
  } });
  assert.equal(effectRounds, 2);

  console.log("PASS AI result limits: custom 1–50, bounded trusted candidates/history, old-service pagination, consistent versions, ordered detail batches, selected-count enforcement, and 50-result custom/free workflows without added model rounds");
})().catch(error => { console.error(error); process.exitCode = 1; });
