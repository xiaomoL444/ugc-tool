import test from "node:test";
import assert from "node:assert/strict";
import { EMBEDDING_CONFIG, LIMITS, SeedError, buildVectorDocuments, makeEmbeddingBatches, requestEmbeddingBatch, seedVectors, validateEndpoint } from "./seed-ai-asset-vectors.mjs";

const version = "a".repeat(64);
const catalog = (assets, indexVersion = version) => ({ schemaVersion: 1, indexVersion, assets });
const asset = (resourceId, feature = "short metal impact", extras = {}) => ({ resourceId, kind: resourceId.split(":")[0], facetTexts: { feature, audio: "", suggestion: "do not embed this recommendation" }, ...extras });
const vector = (first = 1) => Array.from({ length: EMBEDDING_CONFIG.dimensions }, (_, index) => index ? 0 : first);
const response = (rows, total_tokens = 20) => new Response(JSON.stringify({ output: { embeddings: rows }, usage: { total_tokens } }), { headers: { "Content-Type": "application/json" } });
const assertCode = (code) => (error) => error instanceof SeedError && error.code === code && error.message === code;

test("visual and sound facets stay separate, audio requires an explicit effect track", () => {
  const docs = buildVectorDocuments(catalog([
    asset("sound:1"),
    asset("effect:2", "blue visual ring", { hasAudio: true, facetTexts: { feature: "blue visual ring", audio: "crisp chime", suggestion: "magic", audioSuggestion: "UI" } }),
    asset("effect:3", "red sparks", { hasAudio: false, facetTexts: { feature: "red sparks", audio: "untrusted track" } }),
    asset("effect:4", "silent effect", { hasAudio: true }),
    asset("bgm:5", "album title", { hasAudio: true, facetTexts: { feature: "album title", audio: "not an effect sound" } }),
  ]));
  assert.deepEqual(docs.map((doc) => [doc.metadata.resourceId, doc.metadata.facet, doc.text]), [
    ["sound:1", "feature", "short metal impact"], ["effect:2", "feature", "blue visual ring"], ["effect:2", "audio", "crisp chime"],
    ["effect:3", "feature", "red sparks"], ["effect:4", "feature", "silent effect"], ["bgm:5", "feature", "album title"],
  ]);
  assert.ok(docs.every((doc) => doc.namespace === version && /^[a-f0-9]{64}$/.test(doc.id)));
  assert.equal(docs[2].metadata.hasAudio, true);
  assert.equal(docs[0].metadata.model, "text-embedding-v4");
  assert.equal(docs[0].metadata.dimensions, 1024);
  const next = buildVectorDocuments(catalog([asset("sound:1")], "b".repeat(64)))[0];
  assert.notEqual(next.id, docs[0].id);
  assert.equal(next.cacheKey, docs[0].cacheKey);
});

test("malformed catalog, repeated IDs, non-string facets and oversized text fail before network", () => {
  assert.throws(() => buildVectorDocuments(catalog([asset("sound:1"), asset("sound:1")])), assertCode("INVALID_ASSET_ID"));
  assert.throws(() => buildVectorDocuments(catalog([asset("effect:1", "x", { kind: "sound" })])), assertCode("INVALID_ASSET_ID"));
  assert.throws(() => buildVectorDocuments(catalog([asset("sound:1", {})])), assertCode("INVALID_FACET_TEXT"));
  assert.throws(() => buildVectorDocuments(catalog([asset("sound:1", "中".repeat(3000))])), assertCode("TEXT_TOO_LARGE"));
  assert.throws(() => buildVectorDocuments({ schemaVersion: 1, indexVersion: "bad", assets: [] }), assertCode("INVALID_CATALOG"));
});

test("batches respect both ten-text cap and actual UTF-8 request bytes", () => {
  const docs = buildVectorDocuments(catalog(Array.from({ length: 21 }, (_, index) => asset(`sound:${index}`, "中".repeat(2000)))));
  const batches = makeEmbeddingBatches(docs);
  assert.deepEqual(batches.map((batch) => batch.length), [9, 9, 3]);
  assert.ok(batches.every((batch) => Buffer.byteLength(JSON.stringify({ model: EMBEDDING_CONFIG.model, input: { texts: batch.map((doc) => doc.text) }, parameters: { dimension: 1024, text_type: "document", output_type: "dense" } })) <= LIMITS.requestBytes));
  assert.throws(() => makeEmbeddingBatches(docs, 11), assertCode("INVALID_BATCH_SIZE"));
});

test("dry-run never reads keys, caches or network", async () => {
  const docs = buildVectorDocuments(catalog([asset("sound:1")]));
  const forbidden = () => assert.fail("dry-run attempted an external action");
  const env = new Proxy({}, { get: forbidden });
  const result = await seedVectors(docs, { env, fetchImpl: forbidden, readCache: forbidden, writeCache: forbidden });
  assert.equal(result.dryRun, true);
  assert.equal(result.summary.plannedRequests, 1);
  assert.equal(result.summary.executedRequests, 0);
  assert.deepEqual(result.vectors, []);
});

test("native document request uses fixed model/dimensions and maps response text_index", async () => {
  const docs = buildVectorDocuments(catalog([asset("sound:1"), asset("sound:2", "rain") ]));
  let calls = 0;
  const result = await requestEmbeddingBatch(docs, { env: { EMBEDDING_API_KEY: "mock-key" }, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, "https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding");
    assert.equal(options.headers.Authorization, "Bearer mock-key");
    assert.equal(options.redirect, "error");
    assert.deepEqual(JSON.parse(options.body), { model: "text-embedding-v4", input: { texts: ["short metal impact", "rain"] }, parameters: { dimension: 1024, text_type: "document", output_type: "dense" } });
    return response([{ text_index: 1, embedding: vector(2) }, { text_index: 0, embedding: vector(1) }]);
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result.vectors.map((item) => item.values[0]), [1, 2]);
  assert.ok(result.vectors.every((item) => item.namespace === version));
  assert.equal(result.tokens, 20);
});

test("DeepSeek chat credentials are never used for embeddings; unsupported endpoints fail", async () => {
  const docs = buildVectorDocuments(catalog([asset("sound:1")]));
  await assert.rejects(() => requestEmbeddingBatch(docs, { env: { UPSTREAM_API_KEY: "mock-chat-key" }, fetchImpl: () => assert.fail("must not fetch") }), assertCode("EMBEDDING_KEY_REQUIRED"));
  for (const url of ["https://api.deepseek.com/v1/embeddings", "http://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding", "https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding?key=mock"]) {
    assert.throws(() => validateEndpoint(url), assertCode("INVALID_ENDPOINT"));
  }
  assert.equal(validateEndpoint("https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding"), "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding");
});

test("upstream errors and malformed vectors return safe codes without leaked messages", async () => {
  const docs = buildVectorDocuments(catalog([asset("sound:1")]));
  const options = { env: { DASHSCOPE_API_KEY: "mock-sensitive-key" } };
  await assert.rejects(() => requestEmbeddingBatch(docs, { ...options, fetchImpl: async () => { throw new Error("mock-sensitive-key"); } }), assertCode("EMBEDDING_NETWORK_ERROR"));
  await assert.rejects(() => requestEmbeddingBatch(docs, { ...options, fetchImpl: async () => new Response("mock-sensitive-key", { status: 401 }) }), assertCode("EMBEDDING_HTTP_401"));
  for (const rows of [[{ text_index: 0, embedding: [1] }], [{ text_index: 1, embedding: vector() }], [{ text_index: 0, embedding: vector(0) }]]) {
    await assert.rejects(() => requestEmbeddingBatch(docs, { ...options, fetchImpl: async () => response(rows) }), assertCode("INVALID_EMBEDDING_RESPONSE"));
  }
  await assert.rejects(() => requestEmbeddingBatch(docs, { ...options, fetchImpl: async () => new Response("x".repeat(LIMITS.responseBytes + 1)) }), assertCode("RESPONSE_TOO_LARGE"));
});

test("cache reuses values while rebasing vector ID and namespace to current catalog", async () => {
  const first = buildVectorDocuments(catalog([asset("sound:1")]));
  const docs = buildVectorDocuments(catalog([asset("sound:1")], "b".repeat(64)));
  const result = await seedVectors(docs, { execute: true, env: {}, fetchImpl: () => assert.fail("cache hit must not fetch"), readCache: async (cacheKey) => ({ cacheKey, values: vector(4) }) });
  assert.equal(result.summary.executedRequests, 0);
  assert.equal(result.summary.reusedVectors, 1);
  assert.notEqual(first[0].id, result.vectors[0].id);
  assert.equal(result.vectors[0].namespace, "b".repeat(64));
  assert.equal(result.vectors[0].metadata.indexVersion, "b".repeat(64));
  await assert.rejects(() => seedVectors(docs, { execute: true, readCache: async () => ({ cacheKey: "wrong", values: vector() }) }), assertCode("INVALID_VECTOR_CACHE"));
});

test("successful batches checkpoint cache, while a failed batch is not retried", async () => {
  const docs = buildVectorDocuments(catalog([asset("sound:1"), asset("sound:2", "rain")]));
  const cached = new Map();
  let calls = 0;
  await assert.rejects(() => seedVectors(docs, { execute: true, batchSize: 1, env: { EMBEDDING_API_KEY: "mock-key" }, writeCache: async (key, value) => cached.set(key, value), fetchImpl: async () => {
    calls++;
    return calls === 1 ? response([{ text_index: 0, embedding: vector() }]) : new Response("failure", { status: 503 });
  } }), assertCode("EMBEDDING_HTTP_503"));
  assert.equal(calls, 2);
  assert.equal(cached.size, 1);
  const result = await seedVectors(docs, { execute: true, env: { EMBEDDING_API_KEY: "mock-key" }, readCache: async (key) => cached.get(key), fetchImpl: async () => response([{ text_index: 0, embedding: vector(2) }], 7) });
  assert.equal(result.summary.executedRequests, 1);
  assert.equal(result.summary.reusedVectors, 1);
  assert.equal(result.summary.successfulInputTokens, 7);
});
