import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// These values define one vector space. Query embeddings must use the same values.
export const EMBEDDING_CONFIG = Object.freeze({ provider: "dashscope-cn-beijing", model: "text-embedding-v4", dimensions: 1024, textRecipe: "generated-facet-texts-v1" });
export const LIMITS = Object.freeze({ batchSize: 10, textBytes: 8192, requestBytes: 60000, responseBytes: 1024 * 1024, catalogBytes: 32 * 1024 * 1024, vectorsPerFile: 1000 });
const DEFAULT_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding";
const EMBEDDING_PATH = "/api/v1/services/embeddings/text-embedding/text-embedding";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export class SeedError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = (code) => { throw new SeedError(code); };

export function validateEndpoint(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { fail("INVALID_ENDPOINT"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port
      || url.pathname !== EMBEDDING_PATH
      || !(url.hostname === "dashscope.aliyuncs.com" || /^[a-z0-9-]+\.cn-beijing\.maas\.aliyuncs\.com$/i.test(url.hostname))) fail("INVALID_ENDPOINT");
  return url.href;
}

export function buildVectorDocuments(catalog) {
  if (catalog?.schemaVersion !== 1 || !/^[a-f0-9]{64}$/i.test(catalog.indexVersion ?? "") || !Array.isArray(catalog.assets) || catalog.assets.length > 25000) fail("INVALID_CATALOG");
  const ids = new Set();
  const documents = [];
  for (const asset of catalog.assets) {
    if (!/^(sound|effect|bgm):\d+$/.test(asset?.resourceId ?? "") || asset.kind !== asset.resourceId.split(":")[0] || ids.has(asset.resourceId)) fail("INVALID_ASSET_ID");
    ids.add(asset.resourceId);
    for (const facet of ["feature", "audio"]) {
      // Audio descriptions for effects are separate from their visual descriptions.
      if (facet === "audio" && (asset.kind !== "effect" || asset.hasAudio !== true)) continue;
      const rawText = asset.facetTexts?.[facet];
      if (rawText !== undefined && rawText !== null && typeof rawText !== "string") fail("INVALID_FACET_TEXT");
      const text = rawText?.trim();
      if (!text) continue;
      if (typeof text !== "string" || Buffer.byteLength(text) > LIMITS.textBytes) fail("TEXT_TOO_LARGE");
      const textSha256 = sha256(text);
      // Different index versions have different IDs as well as namespaces. Upserting a
      // new version must not move an old deployment's vector into a new namespace.
      const id = sha256(JSON.stringify([catalog.indexVersion, asset.resourceId, facet]));
      documents.push({ id, namespace: catalog.indexVersion, text, cacheKey: sha256(JSON.stringify([EMBEDDING_CONFIG, textSha256])), metadata: {
        resourceId: asset.resourceId, kind: asset.kind, facet, hasAudio: asset.hasAudio === true, indexVersion: catalog.indexVersion,
        textSha256, provider: EMBEDDING_CONFIG.provider, model: EMBEDDING_CONFIG.model, dimensions: EMBEDDING_CONFIG.dimensions,
      } });
    }
  }
  return documents;
}

const payloadFor = (documents) => ({ model: EMBEDDING_CONFIG.model, input: { texts: documents.map((item) => item.text) }, parameters: { dimension: EMBEDDING_CONFIG.dimensions, text_type: "document", output_type: "dense" } });
export function makeEmbeddingBatches(documents, batchSize = LIMITS.batchSize) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > LIMITS.batchSize) fail("INVALID_BATCH_SIZE");
  const batches = [];
  let current = [];
  for (const document of documents) {
    if (Buffer.byteLength(JSON.stringify(payloadFor([document]))) > LIMITS.requestBytes) fail("REQUEST_TOO_LARGE");
    if (current.length && (current.length >= batchSize || Buffer.byteLength(JSON.stringify(payloadFor([...current, document]))) > LIMITS.requestBytes)) {
      batches.push(current); current = [];
    }
    current.push(document);
  }
  if (current.length) batches.push(current);
  return batches;
}

function validVector(values) {
  return Array.isArray(values) && values.length === EMBEDDING_CONFIG.dimensions && values.every((value) => typeof value === "number" && Number.isFinite(value)) && values.some((value) => value !== 0);
}
async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) fail("INVALID_EMBEDDING_RESPONSE");
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > LIMITS.responseBytes) { await reader.cancel(); fail("RESPONSE_TOO_LARGE"); }
      chunks.push(value);
    }
  } catch (error) { if (error instanceof SeedError) throw error; fail("INVALID_EMBEDDING_RESPONSE"); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { fail("INVALID_EMBEDDING_RESPONSE"); }
}
export async function requestEmbeddingBatch(documents, { env = {}, endpoint = DEFAULT_ENDPOINT, fetchImpl = globalThis.fetch } = {}) {
  const url = validateEndpoint(endpoint);
  const body = JSON.stringify(payloadFor(documents));
  if (!documents.length || documents.length > LIMITS.batchSize || Buffer.byteLength(body) > LIMITS.requestBytes) fail("INVALID_BATCH_SIZE");
  // No DeepSeek/chat key is accepted, and no .env file or registry is inspected.
  const key = env.EMBEDDING_API_KEY || env.DASHSCOPE_API_KEY;
  if (typeof key !== "string" || !key.trim()) fail("EMBEDDING_KEY_REQUIRED");
  let response;
  try { response = await fetchImpl(url, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(30000), redirect: "error" }); }
  catch { fail("EMBEDDING_NETWORK_ERROR"); }
  if (!response.ok) fail(`EMBEDDING_HTTP_${response.status}`);
  const data = await boundedJson(response);
  const rows = data?.output?.embeddings;
  if (!Array.isArray(rows) || rows.length !== documents.length) fail("INVALID_EMBEDDING_RESPONSE");
  const byIndex = new Map();
  for (const row of rows) {
    if (!Number.isInteger(row?.text_index) || row.text_index < 0 || row.text_index >= documents.length || byIndex.has(row.text_index) || !validVector(row.embedding)) fail("INVALID_EMBEDDING_RESPONSE");
    byIndex.set(row.text_index, row.embedding);
  }
  return { vectors: documents.map((document, index) => ({ id: document.id, namespace: document.namespace, values: byIndex.get(index), metadata: document.metadata })),
    tokens: Number.isSafeInteger(data?.usage?.total_tokens) && data.usage.total_tokens >= 0 ? data.usage.total_tokens : null };
}

export async function seedVectors(documents, { execute = false, env = {}, endpoint = DEFAULT_ENDPOINT, fetchImpl = globalThis.fetch, batchSize = LIMITS.batchSize, readCache = async () => undefined, writeCache = async () => undefined } = {}) {
  const batches = makeEmbeddingBatches(documents, batchSize);
  const summary = { ...EMBEDDING_CONFIG, documentCount: documents.length, inputBytes: documents.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0), plannedRequests: batches.length, executedRequests: 0, reusedVectors: 0, successfulInputTokens: 0 };
  // Dry-run does not inspect keys, read caches, write outputs or make network calls.
  if (!execute) return { dryRun: true, summary, vectors: [] };
  validateEndpoint(endpoint);
  const vectors = new Map();
  const pending = [];
  for (const document of documents) {
    const cached = await readCache(document.cacheKey);
    if (cached === undefined) { pending.push(document); continue; }
    if (cached.cacheKey !== document.cacheKey || !validVector(cached.values)) fail("INVALID_VECTOR_CACHE");
    vectors.set(document.id, { id: document.id, namespace: document.namespace, values: cached.values, metadata: document.metadata });
    summary.reusedVectors += 1;
  }
  for (const batch of makeEmbeddingBatches(pending, batchSize)) {
    const result = await requestEmbeddingBatch(batch, { env, endpoint, fetchImpl });
    summary.executedRequests += 1;
    summary.successfulInputTokens = result.tokens === null || summary.successfulInputTokens === null ? null : summary.successfulInputTokens + result.tokens;
    for (let index = 0; index < result.vectors.length; index++) {
      const vector = result.vectors[index];
      await writeCache(batch[index].cacheKey, { cacheKey: batch[index].cacheKey, values: vector.values });
      vectors.set(vector.id, vector);
    }
  }
  return { dryRun: false, summary, vectors: documents.map((document) => vectors.get(document.id)) };
}

function parseArguments(args) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const options = { catalog: resolve(root, "tools/ai-search-service/generated/asset-catalog.json"), outputDir: resolve(root, "tools/ai-search-service/.vector-seed"), endpoint: DEFAULT_ENDPOINT, execute: false, batchSize: LIMITS.batchSize, maxVectors: 50000 };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--execute") options.execute = true;
    else if (["--catalog", "--output-dir", "--endpoint", "--batch-size", "--max-vectors"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) fail("INVALID_ARGUMENTS");
      const field = { "--catalog": "catalog", "--output-dir": "outputDir", "--endpoint": "endpoint", "--batch-size": "batchSize", "--max-vectors": "maxVectors" }[arg];
      options[field] = ["batchSize", "maxVectors"].includes(field) ? Number(value) : ["catalog", "outputDir"].includes(field) ? resolve(value) : value;
    } else fail("INVALID_ARGUMENTS");
  }
  if (!Number.isInteger(options.maxVectors) || options.maxVectors < 1 || options.maxVectors > 50000) fail("INVALID_MAX_VECTORS");
  return options;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if ((await stat(options.catalog)).size > LIMITS.catalogBytes) fail("CATALOG_TOO_LARGE");
  let catalog;
  try { catalog = JSON.parse(await readFile(options.catalog, "utf8")); } catch { fail("INVALID_CATALOG"); }
  const documents = buildVectorDocuments(catalog);
  if (documents.length > options.maxVectors) fail("VECTOR_COUNT_LIMIT");
  const cacheDir = resolve(options.outputDir, "cache");
  const result = await seedVectors(documents, { ...options, env: options.execute ? process.env : {},
    readCache: async (key) => { try { return JSON.parse(await readFile(resolve(cacheDir, `${key}.json`), "utf8")); } catch (error) { if (error.code === "ENOENT") return undefined; fail("INVALID_VECTOR_CACHE"); } },
    writeCache: async (key, value) => { await mkdir(cacheDir, { recursive: true }); const path = resolve(cacheDir, `${key}.json`); await writeFile(`${path}.tmp`, JSON.stringify(value)); await rename(`${path}.tmp`, path); },
  });
  if (!result.dryRun) {
    const outputDir = resolve(options.outputDir, catalog.indexVersion);
    await mkdir(outputDir, { recursive: true });
    const files = [];
    for (let index = 0; index < result.vectors.length; index += LIMITS.vectorsPerFile) {
      const name = `vectors-${String(files.length + 1).padStart(4, "0")}.ndjson`;
      await writeFile(resolve(outputDir, name), result.vectors.slice(index, index + LIMITS.vectorsPerFile).map((vector) => JSON.stringify(vector)).join("\n") + "\n");
      files.push(name);
    }
    await writeFile(resolve(outputDir, "manifest.json"), JSON.stringify({ indexVersion: catalog.indexVersion, namespace: catalog.indexVersion, ...result.summary, files, billing: "Embedding usage is billed separately by its provider. No total currency cost is inferred." }, null, 2) + "\n");
  }
  console.log(JSON.stringify({ dryRun: result.dryRun, indexVersion: catalog.indexVersion, ...result.summary }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`Vector seed failed: ${error instanceof SeedError ? error.code : "LOCAL_IO_ERROR"}`); process.exitCode = 1; });
}
