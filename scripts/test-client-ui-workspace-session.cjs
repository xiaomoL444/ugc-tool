/* Run with: node scripts/test-client-ui-workspace-session.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");
const { ref, watch } = require("vue");
const previousExtension = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
  });
  module._compile(result.outputText, filename);
};
const { useClientUIWorkspace } = require("../src/views/ClientUIAnimationEditor/useClientUIWorkspace.ts");
const data = (name, value = 0) => JSON.stringify({ name, value });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

class MemoryRepository {
  constructor() { this.workspaces = new Map(); this.writes = []; this.recycled = new Map(); this.selection = null; this.hook = null; }
  async before(method, workspace, document, serialized) { await this.hook?.(method, workspace, document, serialized); }
  directory(workspace) { const result = this.workspaces.get(workspace); if (!result) throw new Error("Missing workspace"); return result; }
  file(workspace, document) { const result = this.directory(workspace).get(document); if (result === undefined) throw new Error("Missing document"); return result; }
  async listWorkspaces() { await this.before("listWorkspaces"); return [...this.workspaces.keys()].sort(); }
  async createWorkspace(workspace) { await this.before("createWorkspace", workspace); if (this.workspaces.has(workspace)) throw new Error("Duplicate workspace"); this.workspaces.set(workspace, new Map()); }
  async renameWorkspace(oldName, name) { await this.before("renameWorkspace", oldName, name); if (this.workspaces.has(name)) throw new Error("Duplicate workspace"); this.workspaces.set(name, this.directory(oldName)); this.workspaces.delete(oldName); }
  async listDocuments(workspace) { await this.before("listDocuments", workspace); return [...this.directory(workspace).keys()].sort(); }
  async readDocument(workspace, document) { await this.before("readDocument", workspace, document); return this.file(workspace, document); }
  async createDocument(workspace, name, serialized) {
    await this.before("createDocument", workspace, name, serialized);
    const documents = this.directory(workspace); let unique = name; let suffix = 2;
    while (documents.has(unique)) unique = `${name} (${suffix++})`;
    documents.set(unique, serialized); return unique;
  }
  async writeDocument(workspace, document, serialized) { await this.before("writeDocument", workspace, document, serialized); this.file(workspace, document); this.directory(workspace).set(document, serialized); this.writes.push({ workspace, document, serialized }); }
  async renameDocument(workspace, oldName, name) { await this.before("renameDocument", workspace, oldName); const documents = this.directory(workspace); if (documents.has(name)) throw new Error("Duplicate document"); documents.set(name, this.file(workspace, oldName)); documents.delete(oldName); }
  async trashDocument(workspace, document) { await this.before("trashDocument", workspace, document); const trash = `/RecyleBin/${this.recycled.size + 1}/`; this.recycled.set(trash, { serialized: this.file(workspace, document) }); this.directory(workspace).delete(document); return trash; }
  async trashWorkspace(workspace) { await this.before("trashWorkspace", workspace); const trash = `/RecyleBin/${this.recycled.size + 1}/`; this.recycled.set(trash, { documents: this.directory(workspace) }); this.workspaces.delete(workspace); return trash; }
  async restore(trash, original) {
    await this.before("restore", original); const item = this.recycled.get(trash); if (!item) throw new Error("Missing recycle item");
    const parts = original.slice(1).split("/");
    if (item.documents) { if (this.workspaces.has(parts[0])) throw new Error("Restore collision"); this.workspaces.set(parts[0], item.documents); }
    else { const document = parts[1].slice(0, -5); const directory = this.directory(parts[0]); if (directory.has(document)) throw new Error("Restore collision"); directory.set(document, item.serialized); }
    this.recycled.delete(trash);
  }
  async readSelection() { await this.before("readSelection"); return this.selection; }
  async writeSelection(selection) { await this.before("writeSelection"); this.selection = { ...selection }; }
}

const fixtures = [];
function fixture(repository = new MemoryRepository()) {
  const state = ref(JSON.parse(data("Initial")));
  const calls = [];
  const session = useClientUIWorkspace(repository, {
    capture: () => JSON.stringify(state.value),
    apply: serialized => {
      const parsed = JSON.parse(serialized); calls.push(parsed.name);
      state.value = parsed;
      if (parsed.invalid) throw new Error("Invalid editor payload");
    },
    createBlank: name => data(name),
  });
  const stop = watch(() => JSON.stringify(state.value), snapshot => session.queueSave(snapshot), { flush: "sync" });
  const result = { session, state, repository, calls, stop }; fixtures.push(result); return result;
}
const tests = [];
function test(name, run) { tests.push({ name, run }); }

test("首次启动创建默认工作区和新建动画文件", async () => {
  const { session, repository, state } = fixture(); await session.initialize();
  assert.equal(session.ready.value, true); assert.equal(session.selectedWorkspace.value, "默认工作区");
  assert.equal(session.selectedDocument.value, "新建动画"); assert.equal(state.value.name, "新建动画");
  assert.deepEqual(repository.selection, { workspace: "默认工作区", document: "新建动画" });
});

test("修改会自动写入已有存档，切换前 flush 固定旧文件路径", async () => {
  const { session, repository, state } = fixture(); await session.initialize();
  state.value.value = 17; assert.equal(session.dirty.value, true);
  await new Promise(resolve => setTimeout(resolve, 540));
  assert.equal(JSON.parse(repository.file("默认工作区", "新建动画")).value, 17); assert.equal(session.dirty.value, false);
  state.value.value = 18; await session.createDocument("Second");
  assert.equal(JSON.parse(repository.file("默认工作区", "新建动画")).value, 18);
  state.value.value = 29; await session.createWorkspace("Other");
  assert.equal(JSON.parse(repository.file("默认工作区", "Second")).value, 29);
  assert.equal(session.selectedDocument.value, ""); assert.equal(repository.directory("Other").size, 0);
  assert(repository.writes.some(item => item.workspace === "默认工作区" && item.document === "Second"));
});

test("保存失败保留脏快照和当前文件；重试成功再切换", async () => {
  const { session, repository, state } = fixture(); await session.initialize(); await session.createDocument("B");
  state.value.value = 42;
  repository.hook = async method => { if (method === "writeDocument") throw new Error("Disk full"); };
  await assert.rejects(session.switchDocument("新建动画"), /Disk full/);
  assert.equal(session.selectedDocument.value, "B"); assert.equal(state.value.value, 42); assert.equal(session.dirty.value, true);
  repository.hook = null; await session.switchDocument("新建动画");
  assert.equal(JSON.parse(repository.file("默认工作区", "B")).value, 42); assert.equal(session.dirty.value, false);
});

test("撤回到原值会替换旧待存快照，不会被延迟保存覆盖", async () => {
  const { session, repository, state } = fixture(); await session.initialize();
  state.value.value = 77; state.value.value = 0; await session.save();
  assert.equal(JSON.parse(repository.file("默认工作区", "新建动画")).value, 0);
});

test("GIA factory 失败、业务 JSON 校验失败均保留旧编辑内容", async () => {
  const { session, repository, state } = fixture(); await session.initialize(); state.value.value = 12;
  await assert.rejects(session.createDocument("Import", async () => { throw new Error("Bad GIA"); }), /Bad GIA/);
  assert.equal(session.selectedDocument.value, "新建动画"); assert.equal(state.value.value, 12);
  await assert.rejects(session.createDocument("Invalid", '{"name":"x","invalid":true}'), /Invalid editor payload/);
  assert.equal(state.value.value, 12); assert.equal(repository.directory("默认工作区").size, 1);
  assert.equal(session.loading.value, false);
});

test("GIA 异步导入期间忽略并发操作，同名导入创建独立新文件", async () => {
  const { session, repository, state } = fixture(); await session.initialize();
  const writesBeforeImport = repository.writes.length;
  const started = deferred(); const finish = deferred();
  const importing = session.createDocument("新建动画", async () => { started.resolve(); await finish.promise; return data("Source name", 36); });
  await started.promise; assert.equal(session.busy.value, true);
  await session.createWorkspace("Ignored"); assert.equal(repository.workspaces.has("Ignored"), false);
  finish.resolve(); await importing;
  assert.equal(session.selectedDocument.value, "新建动画 (2)"); assert.equal(state.value.name, "新建动画 (2)");
  assert.equal(JSON.parse(repository.file("默认工作区", "新建动画 (2)")).value, 36);
  assert.equal(JSON.parse(repository.file("默认工作区", "新建动画")).value, 0);
  assert.equal(repository.writes.length, writesBeforeImport, "Collision suffix must not require a fallible second write");
});

test("读取坏文件时事务回滚 editor 和 selection", async () => {
  const { session, repository, state } = fixture(); await session.initialize(); state.value.value = 9; await session.save();
  repository.directory("默认工作区").set("Bad", '{"invalid":true}');
  await assert.rejects(session.switchDocument("Bad"), /Invalid editor payload/);
  assert.equal(session.selectedDocument.value, "新建动画"); assert.equal(state.value.value, 9);
});

test("文件与工作区重命名后所有保存都写入新位置", async () => {
  const { session, repository, state } = fixture(); await session.initialize(); state.value.value = 51;
  await session.renameDocument("Renamed"); assert.equal(state.value.name, "Renamed");
  assert.equal(JSON.parse(repository.file("默认工作区", "Renamed")).name, "Renamed");
  await session.renameWorkspace("Moved"); state.value.value = 52; await session.save();
  assert.equal(repository.workspaces.has("默认工作区"), false); assert.equal(repository.directory("Moved").has("新建动画"), false);
  assert.equal(JSON.parse(repository.file("Moved", "Renamed")).value, 52);
});

test("重命名标题写入失败会恢复原文件名与选择", async () => {
  const { session, repository, state } = fixture(); await session.initialize();
  let fail = true; repository.hook = async (method, workspace, document) => {
    if (method === "writeDocument" && document === "Renamed" && fail) { fail = false; throw new Error("Rename title failure"); }
  };
  await assert.rejects(session.renameDocument("Renamed"), /Rename title failure/);
  assert.equal(session.selectedDocument.value, "新建动画"); assert.equal(state.value.name, "新建动画");
  assert.equal(repository.directory("默认工作区").has("Renamed"), false);
});

test("删除与恢复文件/工作区，待存快照不会复活已删路径", async () => {
  const { session, repository, state } = fixture(); await session.initialize(); state.value.value = 66;
  await session.deleteDocument(); assert.equal(session.selectedDocument.value, ""); assert.equal(session.canUndoDelete.value, true);
  await session.save(); assert.equal(repository.directory("默认工作区").size, 0);
  await session.undoDelete(); assert.equal(state.value.value, 66); assert.equal(session.canUndoDelete.value, false);
  await session.deleteWorkspace(); assert.deepEqual(session.workspaceIds.value, []); assert.equal(session.selectedWorkspace.value, "");
  await session.save(); assert.equal(repository.workspaces.size, 0);
  await session.undoDelete(); assert.equal(state.value.value, 66); assert.equal(session.selectedDocument.value, "新建动画");
});

test("恢复最近工作区/编辑文件并强制使用逻辑文件名；空工作区不凭空建文件", async () => {
  const repository = new MemoryRepository(); await repository.createWorkspace("Saved");
  await repository.createDocument("Saved", "Actual", data("Stale title", 90)); repository.selection = { workspace: "Saved", document: "Actual" };
  const first = fixture(repository); await first.session.initialize(); assert.equal(first.state.value.name, "Actual"); assert.equal(first.state.value.value, 90);
  await first.session.createWorkspace("Empty"); await first.session.dispose();
  const second = fixture(repository); await second.session.initialize();
  assert.equal(second.session.selectedWorkspace.value, "Empty"); assert.equal(second.session.selectedDocument.value, "");
  assert.equal(repository.directory("Empty").size, 0);
});

test("删文件后重命名工作区，恢复仍回到同一个工作区", async () => {
  const { session, repository, state } = fixture(); await session.initialize(); state.value.value = 88;
  await session.deleteDocument(); await session.renameWorkspace("Renamed workspace"); await session.undoDelete();
  assert.equal(session.selectedWorkspace.value, "Renamed workspace"); assert.equal(state.value.value, 88);
  assert.equal(repository.workspaces.has("默认工作区"), false);
});

test("卸载保留最终快照，异步 factory 完成后不会再创建/加载文件", async () => {
  const { session, repository, state, calls } = fixture(); await session.initialize(); state.value.value = 99;
  const started = deferred(); const finish = deferred();
  const importing = session.createDocument("Late", async () => { started.resolve(); await finish.promise; return data("Late"); });
  await started.promise;
  await assert.rejects(session.prepareToLeave(), /正在读写/);
  await session.dispose(); const applyCount = calls.length; finish.resolve(); await importing;
  assert.equal(calls.length, applyCount); assert.equal(repository.directory("默认工作区").has("Late"), false);
  assert.equal(JSON.parse(repository.file("默认工作区", "新建动画")).value, 99);
});

(async () => {
  try {
    for (const { name, run } of tests) { await run(); console.log(`PASS ${name}`); }
    console.log(`${tests.length} workspace session regressions passed.`);
  } finally {
    for (const item of fixtures) { item.stop(); item.repository.hook = null; await item.session.dispose().catch(() => undefined); }
    if (previousExtension) Module._extensions[".ts"] = previousExtension; else delete Module._extensions[".ts"];
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
