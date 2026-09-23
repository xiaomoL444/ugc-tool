/* Run: node scripts/test-client-ui-editor-history.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const originalTsExtension = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  module._compile(result.outputText, filename);
};

const { createEditorHistory } = require(path.resolve(__dirname, "../src/views/ClientUIAnimationEditor/editorHistory.ts"));
let passed = 0;
const tick = () => Promise.resolve();

function fixture(options = {}) {
  let state = "0";
  let captureCount = 0;
  const restored = [];
  let history;
  history = createEditorHistory({
    capture: () => { captureCount += 1; return state; },
    restore: (snapshot) => {
      restored.push(snapshot);
      state = snapshot;
      if (options.restore) options.restore(snapshot);
      history.observe(state);
    },
    describe: (before, after) => `修改 ${before} → ${after}`,
    ...("limit" in options ? { limit: options.limit } : {}),
  });
  return {
    history,
    restored,
    get state() { return state; },
    get captureCount() { return captureCount; },
    set(value, observe = true) { state = String(value); if (observe) history.observe(state); },
    commit(value) { this.set(value); history.flush(); },
  };
}

async function test(name, check) {
  await check();
  passed += 1;
  console.log(`PASS ${name}`);
}

(async () => {
  await test("Initial state has no undo or redo entries", () => {
    const { history } = fixture();
    assert.deepEqual(history.entries.value, []);
    assert.equal(history.index.value, -1);
    assert.equal(history.canUndo.value, false);
    assert.equal(history.canRedo.value, false);
    assert.equal(history.busy.value, false);
  });

  await test("Synchronous multi-property changes coalesce at the microtask boundary", async () => {
    const f = fixture();
    f.set("x=4;y=0");
    f.set("x=4;y=8");
    assert.equal(f.history.canUndo.value, true);
    assert.equal(f.history.entries.value.length, 0);
    await tick();
    assert.deepEqual(f.history.entries.value.map((entry) => entry.label), ["修改 0 → x=4;y=8"]);
    await f.history.undo();
    assert.equal(f.state, "0");
    await f.history.redo();
    assert.equal(f.state, "x=4;y=8");
  });

  await test("An entire drag is one command even across microtasks", async () => {
    const f = fixture();
    f.history.begin("pointer");
    for (let value = 1; value <= 10; value += 1) { f.set(value); await tick(); }
    assert.equal(f.history.entries.value.length, 0);
    assert.equal(f.history.canUndo.value, true);
    f.history.end("pointer");
    assert.equal(f.history.entries.value.length, 1);
    await f.history.undo();
    assert.equal(f.state, "0");
    await f.history.redo();
    assert.equal(f.state, "10");
  });

  await test("Text editing is one action and undo works before blur", async () => {
    const f = fixture();
    f.history.begin("input");
    for (const text of ["文", "文本", "文本内容"]) { f.set(text); await tick(); }
    assert.equal(f.history.canUndo.value, true);
    await f.history.undo();
    assert.equal(f.state, "0");
    assert.equal(f.history.entries.value.length, 1);
    f.history.end("input");
    assert.equal(f.history.entries.value.length, 1);
    await f.history.redo();
    assert.equal(f.state, "文本内容");
  });

  await test("Overlapping pointer and input sources commit only when both end", async () => {
    const f = fixture();
    f.history.begin("pointer");
    f.history.begin("pointer");
    f.set(1);
    f.history.begin("input");
    f.set(2);
    f.history.end("pointer");
    f.history.end("unknown");
    await tick();
    assert.equal(f.history.entries.value.length, 0);
    f.set(3);
    f.history.end("input");
    assert.equal(f.history.entries.value.length, 1);
    await f.history.undo();
    assert.equal(f.state, "0");
  });

  await test("A newly started gesture flushes the preceding discrete edit", async () => {
    const f = fixture();
    f.set(1);
    f.history.begin("pointer");
    assert.equal(f.history.entries.value.length, 1);
    f.set(2);
    await tick();
    assert.equal(f.history.entries.value.length, 1);
    f.history.end("pointer");
    assert.equal(f.history.entries.value.length, 2);
    assert.notEqual(f.history.entries.value[0].id, f.history.entries.value[1].id);
    await f.history.undo();
    assert.equal(f.state, "1");
  });

  await test("Net-zero edits neither create commands nor discard a redo branch", async () => {
    const f = fixture();
    f.commit(1);
    await f.history.undo();
    f.history.begin("pointer");
    f.set(5);
    assert.equal(f.history.canRedo.value, false);
    f.set(0);
    assert.equal(f.history.canUndo.value, false);
    assert.equal(f.history.canRedo.value, true);
    f.history.end("pointer");
    await tick();
    assert.equal(f.history.entries.value.length, 1);
    await f.history.redo();
    assert.equal(f.state, "1");
  });

  await test("New edits after undo truncate redo and retain the correct snapshot", async () => {
    const f = fixture();
    f.commit(1); f.commit(2); f.commit(3);
    await f.history.undo(); await f.history.undo();
    assert.equal(f.history.index.value, 0);
    assert.equal(f.history.canRedo.value, true);
    f.set(9);
    assert.equal(f.history.canRedo.value, false);
    await tick();
    assert.equal(f.history.entries.value.length, 2);
    assert.equal(f.history.canRedo.value, false);
    await f.history.undo();
    assert.equal(f.state, "1");
    await f.history.redo();
    assert.equal(f.state, "9");
  });

  await test("Flush captures changes that have not reached an observer yet", async () => {
    const f = fixture();
    f.set(7, false);
    await f.history.undo();
    assert.equal(f.state, "0");
    assert.equal(f.history.entries.value.length, 1);
    await f.history.redo();
    assert.equal(f.state, "7");
  });

  await test("History limit trims the oldest actions but keeps a usable boundary", async () => {
    const f = fixture({ limit: 3 });
    for (let value = 1; value <= 5; value += 1) f.commit(value);
    assert.equal(f.history.entries.value.length, 3);
    assert.equal(f.history.index.value, 2);
    assert.equal(f.history.entries.value[0].label, "修改 2 → 3");
    await f.history.undo(); await f.history.undo(); await f.history.undo(); await f.history.undo();
    assert.equal(f.state, "2");
    assert.equal(f.history.canUndo.value, false);
    await f.history.redo(); await f.history.redo(); await f.history.redo();
    assert.equal(f.state, "5");
  });

  await test("Default history limit is 100", () => {
    const f = fixture();
    for (let value = 1; value <= 104; value += 1) f.commit(value);
    assert.equal(f.history.entries.value.length, 100);
    assert.equal(f.history.entries.value[0].label, "修改 4 → 5");
  });

  await test("Reset clears gestures and pending tasks without leaking across files", async () => {
    const f = fixture();
    f.set(1);
    f.set(100, false);
    f.history.reset();
    await tick();
    assert.deepEqual(f.history.entries.value, []);
    assert.equal(f.history.canUndo.value, false);
    f.history.begin("input");
    f.set(101);
    f.set(200, false);
    f.history.reset("200");
    f.set(201);
    await tick();
    assert.equal(f.history.entries.value.length, 1);
    await f.history.undo();
    assert.equal(f.state, "200");
  });

  await test("Old scheduled flush cannot consume a new gesture's pending action", async () => {
    const f = fixture();
    f.set(1);
    f.history.flush();
    f.history.begin("pointer");
    f.set(2);
    await tick();
    assert.equal(f.history.entries.value.length, 1);
    f.history.end("pointer");
    assert.equal(f.history.entries.value.length, 2);
  });

  await test("Concurrent undo and redo attempts cannot race an executing cursor", async () => {
    const f = fixture();
    f.commit(1); f.commit(2);
    const operation = f.history.undo();
    assert.equal(f.history.busy.value, true);
    assert.equal(f.history.canUndo.value, false);
    assert.equal(f.history.canRedo.value, false);
    await Promise.all([operation, f.history.undo(), f.history.redo()]);
    assert.equal(f.state, "1");
    assert.equal(f.history.index.value, 0);
    assert.equal(f.history.busy.value, false);
    assert.equal(f.history.entries.value.length, 2);
  });

  await test("Restore observer callbacks do not create replay commands", async () => {
    const f = fixture();
    f.commit(1);
    await f.history.undo(); await tick();
    await f.history.redo(); await tick();
    assert.equal(f.history.entries.value.length, 1);
    assert.deepEqual(f.restored, ["0", "1"]);
    assert.equal(f.history.index.value, 0);
  });

  await test("Reset while undo is yielding cannot update the new document history", async () => {
    const f = fixture();
    f.commit(1); f.commit(2);
    const operation = f.history.undo();
    f.set(100, false);
    f.history.reset();
    f.commit(101);
    await operation;
    assert.equal(f.state, "101");
    assert.equal(f.history.index.value, 0);
    assert.deepEqual(f.history.entries.value.map((entry) => entry.label), ["修改 100 → 101"]);
    await f.history.undo();
    assert.equal(f.state, "100");
  });

  await test("Dispose cancels stale tasks and does not capture or replay afterward", async () => {
    const f = fixture();
    f.commit(1);
    const operation = f.history.undo();
    f.history.dispose();
    const captureCount = f.captureCount;
    f.history.observe("bad");
    f.history.begin("pointer"); f.history.end("pointer");
    f.history.flush(); f.history.reset(); f.history.dispose();
    await Promise.all([operation, f.history.undo(), f.history.redo(), tick()]);
    assert.equal(f.captureCount, captureCount);
    assert.deepEqual(f.history.entries.value, []);
    assert.equal(f.history.index.value, -1);
    assert.equal(f.history.busy.value, false);
    assert.equal(f.history.canUndo.value, false);
    assert.equal(f.history.canRedo.value, false);
    const pending = fixture();
    pending.set(1);
    pending.history.dispose();
    await tick();
    assert.deepEqual(pending.history.entries.value, []);
  });

  await test("Failed restore rejects, rolls back partial changes, and repairs undo cursor", async () => {
    let shouldFail = true;
    const f = fixture({ restore(snapshot) { if (snapshot === "0" && shouldFail) throw new Error("bad restore"); } });
    f.commit(1);
    await assert.rejects(f.history.undo(), /bad restore/);
    assert.equal(f.state, "1");
    assert.equal(f.history.index.value, 0);
    assert.equal(f.history.busy.value, false);
    assert.equal(f.history.canUndo.value, true);
    assert.equal(f.history.canRedo.value, false);
    shouldFail = false;
    await f.history.undo();
    assert.equal(f.state, "0");
    await f.history.redo();
    assert.equal(f.state, "1");
    f.commit(2);
    assert.equal(f.history.entries.value.length, 2);
  });

  await test("Failed redo repairs its cursor and permits a later successful retry", async () => {
    let shouldFail = false;
    const f = fixture({ restore(snapshot) { if (snapshot === "1" && shouldFail) throw new Error("bad redo"); } });
    f.commit(1);
    await f.history.undo();
    shouldFail = true;
    await assert.rejects(f.history.redo(), /bad redo/);
    assert.equal(f.state, "0");
    assert.equal(f.history.index.value, -1);
    assert.equal(f.history.canRedo.value, true);
    shouldFail = false;
    await f.history.redo();
    assert.equal(f.state, "1");
  });

  await test("If restoration and rollback both fail, unsafe history is discarded", async () => {
    const f = fixture({ restore() { throw new Error("restore unavailable"); } });
    f.commit(1);
    await assert.rejects(f.history.undo(), /回滚也失败/);
    assert.deepEqual(f.history.entries.value, []);
    assert.equal(f.history.busy.value, false);
    assert.equal(f.history.canUndo.value, false);
    f.commit(2);
    assert.equal(f.history.entries.value.length, 1);
  });

  console.log(`\n${passed} editor history tests passed.`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (originalTsExtension) Module._extensions[".ts"] = originalTsExtension;
  else delete Module._extensions[".ts"];
});
