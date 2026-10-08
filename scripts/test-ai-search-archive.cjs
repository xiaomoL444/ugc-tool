/* Run: node scripts/test-ai-search-archive.cjs. No network requests or model calls. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { AISearchArchiveRepository, serializeAISearchArchive, MAX_AI_SEARCH_ARCHIVE_LENGTH } = require("../src/views/AISearch/archiveStorage.ts");

const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};

/** Captures paths synchronously, then changes the singleton's project after every call. */
class MemoryStorage {
  constructor(serialized) {
    this.projectId = "AnotherEditor";
    this.files = new Map(serialized === undefined ? [] : [["/AISearch/archive.json", serialized]]);
    this.calls = [];
    this.beforeOperation = undefined;
  }
  setProject(projectId) { this.projectId = projectId; return this; }
  operation(method, relativePath, callback) {
    const absolutePath = `/${this.projectId}${relativePath}`;
    this.calls.push({ method, projectId: this.projectId, path: absolutePath });
    const gate = this.beforeOperation?.(method, absolutePath);
    this.projectId = "AnotherEditor";
    return Promise.resolve(gate).then(() => callback(absolutePath));
  }
  exists(value) { return this.operation("exists", value, absolute => this.files.has(absolute)); }
  mkdir(value) { return this.operation("mkdir", value, () => undefined); }
  readFile(value) { return this.operation("readFile", value, absolute => {
    if (!this.files.has(absolute)) throw new Error("ENOENT");
    return this.files.get(absolute);
  }); }
  writeFile(value, data) { return this.operation("writeFile", value, absolute => { this.files.set(absolute, data); }); }
}

const message = (id, extra = {}) => ({ id, role: "assistant", content: `answer-${id}`, status: "complete", mode: "custom", source: "custom", model: "fixture-model", cards: [], ...extra });
const conversation = (id, extra = {}) => ({ id, title: id, updatedAt: 123, messages: [message("m1")], contextStart: 0, ...extra });
const state = (title, extra = {}) => ({ conversations: [conversation("c1", { title })], activeConversationId: "c1", selectedMode: "custom", ...extra });

(async () => {
  const missingStorage = new MemoryStorage();
  const repository = new AISearchArchiveRepository(missingStorage);
  assert.equal(await repository.read(), null, "Only a missing archive produces null");
  await repository.write(state("saved"));
  await repository.flush();
  assert.equal((await repository.read()).conversations[0].title, "saved");
  assert.ok(missingStorage.calls.every(call => call.projectId === "AISearch"), "Namespace must be reset after every await");

  const unsafe = {
    apiKey: "fixture-only-secret", endpoint: "https://secret-endpoint.invalid", config: { apiKey: "fixture-config-secret" },
  };
  const card = {
    resourceId: "effect:123", id: "tampered", kind: "sound", title: "音轨", description: "短促受击声", keywords: ["受击"],
    suggestedUses: ["危险提示"], matchReason: "闷响", matchType: "suggestion", duration: 1.5, hasAudio: true, audioMatch: true,
    href: "https://secret-endpoint.invalid", ...unsafe,
  };
  const sanitized = JSON.parse(serializeAISearchArchive({
    ...state("whitelist"), ...unsafe,
    conversations: [conversation("c1", { ...unsafe, messages: [message("m1", { ...unsafe, cards: [card] })] })],
  }));
  const serialized = JSON.stringify(sanitized);
  for (const value of Object.values(unsafe).filter(value => typeof value === "string")) assert.ok(!serialized.includes(value));
  assert.ok(!serialized.includes("fixture-config-secret"));
  assert.ok(!serialized.includes("apiKey") && !serialized.includes("endpoint") && !serialized.includes("config"));
  assert.equal(sanitized.selectedMode, "custom");
  assert.equal(sanitized.activeConversationId, "c1");
  assert.equal(sanitized.resultLimit, 10, "Existing callers without a selection default to 10 results");
  assert.deepEqual(sanitized.conversations[0].messages[0].cards[0], {
    resourceId: "effect:123", id: "123", kind: "effect", title: "音轨", description: "短促受击声", keywords: ["受击"],
    suggestedUses: ["危险提示"], href: "/EffectPlayer?id=123", matchReason: "闷响", matchType: "suggestion",
    duration: 1.5, hasAudio: true, audioMatch: true,
  }, "Safe card details survive without copying arbitrary configuration or routes");

  const longMessages = Array.from({ length: 140 }, (_, index) => message(`m${index}`));
  const bounded = JSON.parse(serializeAISearchArchive(state("bounded", {
    conversations: Array.from({ length: 35 }, (_, index) => conversation(`c${index}`, { messages: longMessages, contextStart: 70 })),
  })));
  assert.equal(bounded.conversations.length, 30);
  assert.equal(bounded.conversations[0].messages.length, 100);
  assert.equal(bounded.conversations[0].messages[0].id, "m40");
  assert.equal(bounded.conversations[0].contextStart, 30, "Context reset shifts when old messages are removed");
  assert.equal(JSON.parse(serializeAISearchArchive(state("old reset", { conversations: [conversation("c1", { messages: longMessages, contextStart: 5 })] }))).conversations[0].contextStart, 0);
  assert.equal(JSON.parse(serializeAISearchArchive(state("full reset", { conversations: [conversation("c1", { messages: longMessages, contextStart: 140 })] }))).conversations[0].contextStart, 100);
  assert.equal(JSON.parse(serializeAISearchArchive(state("malformed", { conversations: [conversation("c1", { messages: [message("a"), { role: "tool" }, message("b")], contextStart: 2 })] }))).conversations[0].contextStart, 1);
  const twentyCards = Array.from({ length: 20 }, (_, index) => ({ ...card, resourceId: `effect:${123 + index}`, title: `effect-${index}` }));
  const cardStorage = new MemoryStorage();
  const cardRepository = new AISearchArchiveRepository(cardStorage);
  await cardRepository.write(state("twenty cards", { resultLimit: 20, conversations: [conversation("c1", { messages: [message("m", { cards: twentyCards })] })] }));
  const restoredCards = await cardRepository.read();
  assert.equal(restoredCards.resultLimit, 20);
  assert.deepEqual(restoredCards.conversations[0].messages[0].cards.map(value => value.resourceId), twentyCards.map(value => value.resourceId), "All 20 results survive saving and reopening the conversation");
  const fiftyCards = Array.from({ length: 50 }, (_, index) => ({ ...card, resourceId: `effect:${123 + index}`, title: `effect-${index}` }));
  await cardRepository.write(state("fifty cards", { resultLimit: 37, conversations: [conversation("c1", { messages: [message("m", { cards: fiftyCards })] })] }));
  const restoredFifty = await cardRepository.read();
  assert.equal(restoredFifty.resultLimit, 37, "A custom count is stored independently of the previous result count");
  assert.deepEqual(restoredFifty.conversations[0].messages[0].cards.map(value => value.resourceId), fiftyCards.map(value => value.resourceId));
  const clippedCards = JSON.parse(serializeAISearchArchive(state("cards", { conversations: [conversation("c1", { messages: [message("m", { cards: [...fiftyCards, { ...card, resourceId: "effect:999" }] })] })] })));
  assert.equal(clippedCards.conversations[0].messages[0].cards.length, 50);
  assert.equal(clippedCards.conversations[0].messages[0].cards.at(-1).resourceId, "effect:172", "Results beyond the supported maximum are removed in order");

  const oldEnvelope = { version: 1, conversations: [conversation("old")], activeConversationId: "old", selectedMode: "custom" };
  const oldArchive = await new AISearchArchiveRepository(new MemoryStorage(JSON.stringify(oldEnvelope))).read();
  assert.equal(oldArchive.resultLimit, 10, "Version 1 archives without the new preference remain readable");
  assert.equal(oldArchive.conversations[0].id, "old");
  for (const resultLimit of [1, 5, 10, 20, 25, 37, 50]) {
    const savedPreference = serializeAISearchArchive(state("selected count", { resultLimit }));
    assert.equal(JSON.parse(savedPreference).resultLimit, resultLimit);
    const restoredPreference = await new AISearchArchiveRepository(new MemoryStorage(savedPreference)).read();
    assert.equal(restoredPreference.resultLimit, resultLimit, `The ${resultLimit}-result preference survives a reload`);
  }
  for (const resultLimit of [undefined, null, 0, -5, 1.5, 51, 1000, "20", {}, [20]]) {
    assert.equal(JSON.parse(serializeAISearchArchive(state("invalid selection", { resultLimit }))).resultLimit, 10);
    const restoredPreference = await new AISearchArchiveRepository(new MemoryStorage(JSON.stringify({ ...oldEnvelope, resultLimit }))).read();
    assert.equal(restoredPreference.resultLimit, 10, "Invalid stored preferences do not invalidate otherwise intact history");
  }

  const firstWrite = deferred();
  let writes = 0;
  const orderedStorage = new MemoryStorage();
  orderedStorage.beforeOperation = method => method === "writeFile" && ++writes === 1 ? firstWrite.promise : undefined;
  const orderedRepository = new AISearchArchiveRepository(orderedStorage);
  const first = orderedRepository.write(state("first"));
  const mutableInput = state("second");
  const second = orderedRepository.write(mutableInput);
  mutableInput.conversations[0].title = "changed after enqueue";
  const third = orderedRepository.write(state("third"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 1, "A later save cannot start while an earlier save is unresolved");
  firstWrite.resolve();
  await Promise.all([first, second, third]);
  await orderedRepository.flush();
  assert.equal(JSON.parse(orderedStorage.files.get("/AISearch/archive.json")).conversations[0].title, "third");
  assert.equal(writes, 3);
  assert.ok(orderedStorage.calls.every(call => call.projectId === "AISearch"));

  const snapshotStorage = new MemoryStorage();
  const snapshotRepository = new AISearchArchiveRepository(snapshotStorage);
  const snapshotInput = state("snapshot", { resultLimit: 20 });
  const snapshotWrite = snapshotRepository.write(snapshotInput);
  snapshotInput.conversations[0].title = "later edit";
  snapshotInput.resultLimit = 5;
  await snapshotWrite;
  assert.equal(JSON.parse(snapshotStorage.files.get("/AISearch/archive.json")).conversations[0].title, "snapshot", "Queued writes snapshot their input immediately");
  assert.equal(JSON.parse(snapshotStorage.files.get("/AISearch/archive.json")).resultLimit, 20, "The result selection is captured with the rest of the queued snapshot");

  const failureStorage = new MemoryStorage();
  const failureRepository = new AISearchArchiveRepository(failureStorage);
  const failure = new Error("fixture write failed");
  failureStorage.beforeOperation = method => { if (method === "writeFile") throw failure; };
  await assert.rejects(failureRepository.write(state("failed")), error => error === failure);
  await assert.rejects(failureRepository.flush(), error => error === failure);
  failureStorage.beforeOperation = undefined;
  await failureRepository.write(state("recovered"));
  await failureRepository.flush();
  assert.equal((await failureRepository.read()).conversations[0].title, "recovered", "Write failure does not poison later saves");

  for (const damaged of ["{", "[]", JSON.stringify({ version: 2, conversations: [], activeConversationId: "", selectedMode: "basic" }), JSON.stringify({ version: 1, conversations: [], activeConversationId: "", selectedMode: "bad" })]) {
    const damagedStorage = new MemoryStorage(damaged);
    const damagedRepository = new AISearchArchiveRepository(damagedStorage);
    await assert.rejects(damagedRepository.read());
    await assert.rejects(damagedRepository.write(state("must not replace")));
    await assert.rejects(damagedRepository.flush());
    assert.equal(damagedStorage.files.get("/AISearch/archive.json"), damaged, "A damaged existing archive must never become an empty save");
    assert.equal(damagedStorage.calls.some(call => call.method === "writeFile"), false);
  }
  const corruptWithoutRead = new MemoryStorage("{");
  await assert.rejects(new AISearchArchiveRepository(corruptWithoutRead).write(state("must inspect")));
  assert.equal(corruptWithoutRead.files.get("/AISearch/archive.json"), "{");
  const corruptedAfterRead = new MemoryStorage(serializeAISearchArchive(state("before corruption")));
  const rereadRepository = new AISearchArchiveRepository(corruptedAfterRead);
  await rereadRepository.read();
  corruptedAfterRead.files.set("/AISearch/archive.json", "{");
  await assert.rejects(rereadRepository.read());
  await assert.rejects(rereadRepository.write(state("must not replace after failed reread")));
  assert.equal(corruptedAfterRead.files.get("/AISearch/archive.json"), "{");

  const unreadableStorage = new MemoryStorage(serializeAISearchArchive(state("existing")));
  unreadableStorage.beforeOperation = method => { if (method === "readFile") throw new Error("storage offline"); };
  await assert.rejects(new AISearchArchiveRepository(unreadableStorage).read(), /storage offline/, "Read failure is not a missing archive and cannot trigger migration");
  const racedStorage = new MemoryStorage("{}");
  racedStorage.beforeOperation = method => { if (method === "readFile") racedStorage.files.clear(); };
  await assert.rejects(new AISearchArchiveRepository(racedStorage).read(), /ENOENT/, "A file disappearing after exists() must report a read failure");

  const existingData = serializeAISearchArchive(state("keep last save"));
  const oversizedStorage = new MemoryStorage(existingData);
  const oversizedRepository = new AISearchArchiveRepository(oversizedStorage);
  const oversized = state("oversized", { conversations: Array.from({ length: 30 }, (_, index) => conversation(`c${index}`, {
    messages: Array.from({ length: 100 }, (_, index) => message(`m${index}`, { content: "x".repeat(4000) })),
  })) });
  await assert.rejects(oversizedRepository.write(oversized), /AI_SEARCH_ARCHIVE_TOO_LARGE/);
  await assert.rejects(oversizedRepository.flush(), /AI_SEARCH_ARCHIVE_TOO_LARGE/);
  assert.equal(oversizedStorage.files.get("/AISearch/archive.json"), existingData);
  const savingGate = deferred();
  const errorOrderStorage = new MemoryStorage();
  errorOrderStorage.beforeOperation = method => method === "writeFile" ? savingGate.promise : undefined;
  const errorOrderRepository = new AISearchArchiveRepository(errorOrderStorage);
  const saving = errorOrderRepository.write(state("earlier valid request"));
  const invalidSave = errorOrderRepository.write(oversized);
  // Attach the rejection handler before allowing the earlier save to finish.
  const invalidAssertion = assert.rejects(invalidSave, /AI_SEARCH_ARCHIVE_TOO_LARGE/);
  savingGate.resolve();
  await saving;
  await invalidAssertion;
  await assert.rejects(errorOrderRepository.flush(), /AI_SEARCH_ARCHIVE_TOO_LARGE/, "An older successful save cannot clear a newer validation failure");
  await assert.rejects(new AISearchArchiveRepository(new MemoryStorage(" ".repeat(MAX_AI_SEARCH_ARCHIVE_LENGTH + 1))).read(), /AI_SEARCH_ARCHIVE_TOO_LARGE/);
  console.log("PASS AI search archive: 20/50-result roundtrip, custom 1–50 preferences and legacy defaults, provider namespace, bounded whitelist, context reset, sequential snapshots, write recovery, corruption protection, and size limits");
})().catch(error => { console.error(error); process.exitCode = 1; });
