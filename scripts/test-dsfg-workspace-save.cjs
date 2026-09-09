/* Run with: node scripts/test-dsfg-workspace-save.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const previousExtension = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  });
  module._compile(result.outputText, filename);
};

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { createWorkspaceSaveQueue } = require(path.resolve(__dirname, "../src/views/DSFGStudio/components/QuestEditor/workspaceSaveQueue.ts"));
  let passed = 0;
  const test = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`); };
  const unexpectedError = (error) => { throw error; };

  await test("Debounce keeps the latest snapshot of each file without dropping other files", async () => {
    const writes = [];
    const queue = createWorkspaceSaveQueue(async (...args) => { writes.push(args); }, unexpectedError, 10000);
    queue.schedule("workspace/a.json", "a1");
    queue.schedule("workspace/b.json", "b1");
    queue.schedule("workspace/a.json", "a2");
    assert.deepEqual(writes, []);
    await queue.flush();
    assert.deepEqual(writes, [["workspace/a.json", "a2"], ["workspace/b.json", "b1"]]);
  });

  await test("Switching file and workspace cannot redirect captured paths or data", async () => {
    const writes = [];
    const queue = createWorkspaceSaveQueue(async (...args) => { writes.push(args); }, unexpectedError, 10000);
    let workspace = "first", filename = "dialogue.json";
    const model = { title: "original" };
    queue.schedule(`${workspace}/${filename}`, JSON.stringify(model));
    workspace = "second";
    filename = "quest.json";
    model.title = "changed";
    queue.schedule(`${workspace}/${filename}`, JSON.stringify(model));
    await queue.flush();
    assert.deepEqual(writes, [["first/dialogue.json", '{"title":"original"}'], ["second/quest.json", '{"title":"changed"}']]);
  });

  await test("Concurrent flush calls and scheduled writes share a single serial writer", async () => {
    const gate = deferred(), started = deferred(), writes = [];
    let active = 0, maxActive = 0;
    const queue = createWorkspaceSaveQueue(async (file, data) => {
      active++;
      maxActive = Math.max(maxActive, active);
      writes.push([file, data]);
      if (file === "a") { started.resolve(); await gate.promise; }
      active--;
    }, unexpectedError, 10000);
    queue.schedule("a", "first");
    const firstFlush = queue.flush();
    await started.promise;
    queue.schedule("b", "second");
    const secondFlush = queue.flush();
    assert.deepEqual(writes, [["a", "first"]]);
    gate.resolve();
    await Promise.all([firstFlush, secondFlush]);
    assert.equal(maxActive, 1);
    assert.deepEqual(writes, [["a", "first"], ["b", "second"]]);
  });

  await test("Flush on unmount saves immediately and cancels the delayed duplicate", async () => {
    const writes = [];
    const queue = createWorkspaceSaveQueue(async (...args) => { writes.push(args); }, unexpectedError, 5);
    queue.schedule("a", "last edit");
    await queue.flush();
    assert.deepEqual(writes, [["a", "last edit"]]);
    await wait(20);
    assert.equal(writes.length, 1);
    await queue.flush();
    assert.equal(writes.length, 1);
  });

  await test("A newer snapshot scheduled during a write is saved after the old snapshot", async () => {
    const gate = deferred(), started = deferred(), writes = [];
    const queue = createWorkspaceSaveQueue(async (...args) => {
      writes.push(args);
      if (writes.length === 1) { started.resolve(); await gate.promise; }
    }, unexpectedError, 10000);
    queue.schedule("a", "old");
    const flush = queue.flush();
    await started.promise;
    queue.schedule("a", "new");
    gate.resolve();
    await flush;
    assert.deepEqual(writes, [["a", "old"], ["a", "new"]]);
  });

  await test("A failed snapshot is retained for explicit retry and flush rejects", async () => {
    const failure = new Error("disk failure"), errors = [], writes = [];
    const queue = createWorkspaceSaveQueue(async (...args) => {
      writes.push(args);
      if (writes.length === 1) throw failure;
    }, (error) => errors.push(error), 10000);
    queue.schedule("a", "data");
    await assert.rejects(queue.flush(), (error) => error === failure);
    assert.deepEqual(errors, [failure]);
    await queue.flush();
    assert.deepEqual(writes, [["a", "data"], ["a", "data"]]);
  });

  await test("Failure never replaces a newer pending snapshot with stale data", async () => {
    const gate = deferred(), started = deferred(), errors = [], writes = [];
    const failure = new Error("offline");
    const queue = createWorkspaceSaveQueue(async (...args) => {
      writes.push(args);
      if (writes.length === 1) { started.resolve(); await gate.promise; }
    }, (error) => errors.push(error), 10000);
    queue.schedule("a", "old");
    const flush = queue.flush();
    const rejected = assert.rejects(flush, (error) => error === failure);
    await started.promise;
    queue.schedule("a", "new");
    queue.schedule("b", "other file");
    gate.reject(failure);
    await rejected;
    queue.schedule("a", "newest");
    await queue.flush();
    assert.deepEqual(errors, [failure]);
    assert.deepEqual(writes, [["a", "old"], ["a", "newest"], ["b", "other file"]]);
  });

  await test("Discard can remove one pending file or all pending files", async () => {
    const writes = [];
    const queue = createWorkspaceSaveQueue(async (...args) => { writes.push(args); }, unexpectedError, 10000);
    queue.schedule("a", "a");
    queue.schedule("b", "b");
    queue.discard("a");
    await queue.flush();
    assert.deepEqual(writes, [["b", "b"]]);
    queue.schedule("a", "again");
    queue.schedule("b", "again");
    queue.discard();
    await queue.flush();
    assert.deepEqual(writes, [["b", "b"]]);
  });

  await test("Discard does not cancel an in-flight write but removes its queued replacement", async () => {
    const gate = deferred(), started = deferred(), writes = [];
    const queue = createWorkspaceSaveQueue(async (...args) => {
      writes.push(args);
      started.resolve();
      await gate.promise;
    }, unexpectedError, 10000);
    queue.schedule("a", "started");
    const flush = queue.flush();
    await started.promise;
    queue.schedule("a", "not started");
    queue.discard("a");
    gate.resolve();
    await flush;
    assert.deepEqual(writes, [["a", "started"]]);
  });

  await test("Timer-triggered failure is reported without an unhandled rejection or retry loop", async () => {
    const failure = new Error("timer failure"), errors = [], unhandled = [];
    let attempts = 0;
    const queue = createWorkspaceSaveQueue(async () => {
      attempts++;
      if (attempts === 1) throw failure;
    }, (error) => errors.push(error), 5);
    const recordUnhandled = (error) => unhandled.push(error);
    process.on("unhandledRejection", recordUnhandled);
    try {
      queue.schedule("a", "data");
      await wait(30);
      assert.equal(attempts, 1);
      assert.deepEqual(errors, [failure]);
      assert.deepEqual(unhandled, []);
      await queue.flush();
      assert.equal(attempts, 2);
    } finally {
      queue.discard();
      process.off("unhandledRejection", recordUnhandled);
    }
  });

  await test("An error callback failure cannot hide the write error or lose retry data", async () => {
    const failure = new Error("write failed");
    let attempts = 0;
    const queue = createWorkspaceSaveQueue(async () => {
      if (++attempts === 1) throw failure;
    }, () => { throw new Error("reporting failed"); }, 10000);
    queue.schedule("a", "data");
    await assert.rejects(queue.flush(), (error) => error === failure);
    await queue.flush();
    assert.equal(attempts, 2);
  });

  console.log(`\n${passed} workspace save queue tests passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousExtension) Module._extensions[".ts"] = previousExtension;
  else delete Module._extensions[".ts"];
});
