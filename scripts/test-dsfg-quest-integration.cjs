/* Run with: node scripts/test-dsfg-quest-integration.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const JSZip = require("jszip");
const { parse, compileScript, compileTemplate } = require("@vue/compiler-sfc");

function readSfc(relative) {
  const filename = path.resolve(__dirname, "../src/views/DSFGStudio", relative);
  const parsed = parse(fs.readFileSync(filename, "utf8"), { filename });
  const script = parsed.descriptor.scriptSetup.content;
  const ast = ts.createSourceFile(`${filename}.ts`, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return { filename, parsed, descriptor: parsed.descriptor, ast };
}
const quest = readSfc("components/QuestEditor/QuestEditor.vue");
const dialogue = readSfc("components/DialogueEditor/DialogueEditor.vue");
const studio = readSfc("DSFGStudio.vue");
const kindSelect = readSfc("components/EditorKindSelect.vue");
const ref = (value) => ({ value });
const plain = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const quiet = { error() {}, warn() {}, info() {}, debug() {}, trace() {} };
function functionText(sfc, name) {
  const found = sfc.ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(found, `Missing actual handler ${name}`);
  return found.getText(sfc.ast);
}
function variableText(sfc, name) {
  const found = sfc.ast.statements.filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((declaration) => declaration.name.getText(sfc.ast) === name);
  assert.ok(found, `Missing actual variable ${name}`);
  return `const ${found.getText(sfc.ast)};`;
}
function callsText(sfc, name) {
  return sfc.ast.statements.filter((node) => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression) && node.expression.expression.getText(sfc.ast) === name)
    .map((node) => node.getText(sfc.ast)).join("\n");
}
function execute(sfc, names, bindings, extra = []) {
  const context = vm.createContext(bindings);
  const source = [...extra, ...names.map((name) => functionText(sfc, name))].join("\n");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  });
  vm.runInContext(compiled.outputText, context, { filename: sfc.filename, timeout: 1000 });
  return context;
}
function findElement(node, tag, ancestors = []) {
  if (node.type === 1 && node.tag === tag) return { node, ancestors };
  for (const child of node.children ?? []) {
    const result = findElement(child, tag, [...ancestors, node]);
    if (result) return result;
  }
}
function directive(node, name, argument) {
  return node.props?.find((property) => property.type === 7 && property.name === name && property.arg?.content === argument);
}
function attr(node, name) {
  return node.props?.find((property) => property.type === 6 && property.name === name)?.value?.content;
}
function editorHarness(sfc, names, options = {}) {
  const isQuest = sfc === quest;
  const calls = [], errors = [], scheduled = [], exposed = {};
  const storage = {
    setProject(id) { calls.push(["project", id]); return this; },
    async readFile(file) { calls.push(["read", file]); return '{"title":"loaded"}'; },
    async getFiles(directory) { calls.push(["list", directory]); return ["a.json"]; },
    async exists(file) { calls.push(["exists", file]); return false; },
    async writeFile(file, data) { calls.push(["write", file, data]); },
    async trash(file) { calls.push(["trash", file]); },
    ...options.storage,
  };
  const saveQueue = {
    async flush() { calls.push(["flush"]); },
    schedule(...args) { scheduled.push(args); },
    discard(...args) { calls.push(["discard", ...args]); },
    ...options.saveQueue,
  };
  const bindings = {
    storage, saveQueue, calls, errors, scheduled, exposed, Error,
    ProjectID: "DSFGStudio", DialogueEditorID: "DialogueEditor",
    workspace: ref("original"), workspaceId: ref("original"), disposed: false,
    busy: ref(false), fileBusy: ref(false), loading: false, loadingFile: false,
    requestId: 0, fileRequest: 0, listRequestId: 0, listRequest: 0, revision: 0,
    project: ref({ title: "original" }), dialogueProject: ref({ title: "original" }),
    files: ref([]), dialogueFiles: ref([]), selectedFile: ref("a.json"), selectedDialogueFile: ref("a.json"),
    selectedGroupNodeId: ref("group"), settingsOpen: ref(false), structIdSettingsOpen: ref(false),
    newName: ref("new"), creating: ref(false), saveStatus: ref("old"), exporting: ref(false),
    legacyFiles: ref([]), legacySelection: ref(""), loadError: ref(""),
    toast: { error: (...args) => errors.push(args), warning() {}, success() {} },
    showError: (...args) => errors.push(args), console: quiet, consola: quiet,
    crypto: { randomUUID: () => "test-uuid" }, confirm: () => true, prompt: () => "new",
    decodeQuestProject: JSON.parse, decodeDialogueProject: JSON.parse,
    encodeQuestProject: JSON.stringify, encodeDialogueProject: JSON.stringify,
    createQuestProject: () => ({ title: "new" }), createEmptyDialogueProject: () => ({ title: "new" }),
    defineExpose: (api) => Object.assign(exposed, api), nextTick: async () => undefined,
    ...options.bindings,
  };
  const extras = [
    ...(isQuest ? ["workspaceId", "documentPath", "legacyDirectory", "downloadBaseName"] : ["documentWorkspaceId"]).map((name) => variableText(sfc, name)),
    ...(options.extra ?? []),
  ];
  if (!isQuest && !names.includes("AssemblyPath")) names = ["AssemblyPath", ...names];
  return execute(sfc, names, bindings, extras);
}
function parentHarness(options = {}) {
  const events = [], errors = [];
  const context = execute(studio, ["ChangeWorkspace", "ChangeEditorKind", "DelectWorkspace"], {
    switchingEditor: ref(false), selectedWorkspaceId: ref("original"), selectedFunction: ref("Dialogue"),
    editorRef: ref({ prepareToLeave: async () => { events.push("flush"); } }),
    crypto: { randomUUID: () => "test-uuid" }, consola: quiet, ProjectID: "DSFGStudio", confirm: () => true,
    toast: { error: (...args) => errors.push(args), warning() {} },
    storage: { setProject() { return this; }, async trash(file) { events.push(["trash", file]); } },
    async RefreshWorkspace() { events.push("refresh"); },
    ...options,
  });
  return { context, events, errors };
}

function questLoadHarness(initial = [], options = {}) {
  const persisted = new Map(initial), io = [];
  const memory = {
    async exists(file) { io.push(["exists", file]); return persisted.has(file) || [...persisted.keys()].some((key) => key.startsWith(`${file}/`)); },
    async getFiles(directory) { io.push(["list", directory]); return [...persisted.keys()].filter((key) => key.startsWith(`${directory}/`)).map((key) => key.slice(directory.length + 1)); },
    async readFile(file) { io.push(["read", file]); if (!persisted.has(file)) throw new Error("Missing file"); return persisted.get(file); },
    async writeFile(file, data) { io.push(["write", file, data]); persisted.set(file, data); },
    ...options.storage,
  };
  const state = editorHarness(quest, ["loadProject"], {
    storage: memory, bindings: { project: ref(undefined), ...options.bindings },
  });
  return { state, persisted, io };
}

async function main() {
  let passed = 0;
  const test = async (name, check) => { await check(); passed++; console.log(`PASS ${name}`); };
  await test("Studio, QuestEditor and DialogueEditor scripts/templates compile as actual Vue SFCs", () => {
    for (const sfc of [studio, quest, dialogue, kindSelect]) {
      assert.deepEqual(sfc.parsed.errors, []);
      const script = compileScript(sfc.descriptor, { id: `integration-${path.basename(sfc.filename)}` });
      const template = compileTemplate({ filename: sfc.filename, id: "integration", source: sfc.descriptor.template.content,
        compilerOptions: { bindingMetadata: script.bindings } });
      assert.deepEqual(template.errors, []);
    }
  });

  await test("Both editor selectors remain available above the single Quest panel or Dialogue file list", () => {
    for (const sfc of [quest, dialogue]) {
      const select = findElement(sfc.descriptor.template.ast, "EditorKindSelect");
      assert.ok(select);
      const siblings = select.ancestors.at(-1).children;
      const sectionIndex = siblings.findIndex((node) => node.type === 1 && node.tag === "SectionLayout");
      assert.ok(sectionIndex > siblings.indexOf(select.node));
      assert.equal(attr(siblings[sectionIndex], "title"), sfc === quest ? "任务编辑区" : "对话文件");
    }
    const select = findElement(kindSelect.descriptor.template.ast, "select").node;
    assert.deepEqual(select.children.filter((node) => node.type === 1).map((node) => attr(node, "value")), ["Dialogue", "Quest", "WalkTalk"]);
    const emitted = [];
    const handler = execute(kindSelect, ["change"], { props: { modelValue: "Dialogue" }, emit: (...args) => emitted.push(args) });
    const event = { target: { value: "Quest" } };
    handler.change(event);
    assert.deepEqual(emitted, [["update:modelValue", "Quest"]]);
    assert.equal(event.target.value, "Dialogue", "Selection stays on the saved editor until its parent approves the switch");
    handler.change({ target: { value: "WalkTalk" } });
    assert.deepEqual(emitted.at(-1), ["update:modelValue", "WalkTalk"]);
  });

  await test("Parent component key recreates the editor for either workspace or editor kind changes", () => {
    const component = findElement(studio.descriptor.template.ast, "component").node;
    const key = directive(component, "bind", "key").exp.content;
    const evaluate = (workspace, kind) => vm.runInNewContext(`(${key})`, { selectedWorkspaceId: workspace, selectedFunction: kind });
    assert.notEqual(evaluate("a", "Dialogue"), evaluate("b", "Dialogue"));
    assert.notEqual(evaluate("a", "Dialogue"), evaluate("a", "Quest"));
    assert.equal(attr(component, "ref"), "editorRef");
    assert.equal(directive(component, "on", "update:editor-kind").exp.content, "ChangeEditorKind");
    assert.equal(directive(findElement(studio.descriptor.template.ast, "Splitter").node, "bind", "inert").exp.content, "switchingEditor");
  });

  await test("Dialogue and Quest save handlers capture immutable paths and serialized snapshots", () => {
    let changed;
    const actual = editorHarness(quest, [], { extra: [callsText(quest, "watch")], bindings: { watch(_source, callback) { changed = callback; } } });
    changed();
    actual.workspace.value = "different";
    actual.project.value.title = "new edit";
    changed();
    assert.deepEqual(actual.scheduled, [["/original/QuestEditor.json", '{"title":"original"}'], ["/original/QuestEditor.json", '{"title":"new edit"}']]);
    actual.loading = true; changed();
    actual.loading = false; actual.disposed = true; changed();
    assert.equal(actual.scheduled.length, 2);
    const d = editorHarness(dialogue, ["scheduleSave"]);
    d.scheduleSave();
    d.workspaceId.value = "different";
    d.dialogueProject.value.title = "new edit";
    d.selectedDialogueFile.value = "b.json";
    d.scheduleSave();
    assert.deepEqual(d.scheduled, [["/original/DialogueEditor/a.json", '{"title":"original"}'], ["/original/DialogueEditor/b.json", '{"title":"new edit"}']]);
    d.loadingFile = true; d.scheduleSave();
    d.loadingFile = false; d.disposed = true; d.scheduleSave();
    assert.equal(d.scheduled.length, 2);
  });

  for (const sfc of [quest, dialogue]) {
    const label = sfc === quest ? "Quest" : "Dialogue";
    const busyName = sfc === quest ? "busy" : "fileBusy";
    const select = sfc === quest ? "selectFile" : "SelectDialogueFile";
    const create = sfc === quest ? "createFile" : "AddDialogueFile";
    const remove = sfc === quest ? "deleteFile" : "DeleteDialogueFile";
    const refresh = sfc === quest ? "refreshFiles" : "RefreshDialogueFile";
    const selectionName = sfc === quest ? "selectedFile" : "selectedDialogueFile";
    const dataName = sfc === quest ? "project" : "dialogueProject";
    await test(`${label} prepareToLeave rejects busy or failed saving and otherwise awaits flush`, async () => {
      const gate = deferred();
      const state = editorHarness(sfc, [], { extra: [callsText(sfc, "defineExpose")], saveQueue: { flush: () => gate.promise } });
      state[busyName].value = true;
      await assert.rejects(state.exposed.prepareToLeave(), /正在读写/);
      state[busyName].value = false;
      state.settingsOpen.value = true;
      state.structIdSettingsOpen.value = true;
      let finished = false;
      const pending = state.exposed.prepareToLeave().then(() => { finished = true; });
      await Promise.resolve(); assert.equal(finished, false);
      assert.equal(state[sfc === quest ? "settingsOpen" : "structIdSettingsOpen"].value, false, "Teleported settings close before leaving");
      if (sfc === dialogue) assert.equal(state.selectedGroupNodeId.value, "", "Timeline popovers close before leaving");
      gate.resolve(); await pending; assert.equal(finished, true);
      state.saveQueue.flush = async () => { throw new Error("storage failed"); };
      await assert.rejects(state.exposed.prepareToLeave(), /storage failed/);
    });

    // Quest no longer has file CRUD; its single-document lifecycle is tested below.
    if (sfc === quest) continue;

    await test(`${label} concurrent file commands are blocked while switching files`, async () => {
      const gate = deferred();
      const state = editorHarness(sfc, [select, create, remove], { saveQueue: { flush: () => gate.promise } });
      const pending = state[select]("new.json");
      assert.equal(state[busyName].value, true);
      await state[select]("ignored.json"); await state[create](); await state[remove]();
      assert.deepEqual(state.calls, []);
      assert.equal(state[selectionName].value, "a.json");
      gate.resolve(); await pending;
      assert.equal(state[selectionName].value, "new.json");
      assert.equal(state[busyName].value, false);
      assert.deepEqual(state.calls.filter((entry) => entry[0] === "read"), [["read", `/original/${label === "Quest" ? "QuestEditor" : "DialogueEditor"}/new.json`]]);
      assert.equal(directive(findElement(sfc.descriptor.template.ast, "Splitter").node, "bind", "inert").exp.content, busyName);
    });

    await test(`${label} file selection keeps current model on a save failure`, async () => {
      const state = editorHarness(sfc, [select], { saveQueue: { async flush() { throw new Error("write failure"); } } });
      const original = state[dataName].value;
      await state[select]("new.json");
      assert.equal(state[selectionName].value, "a.json");
      assert.equal(state[dataName].value, original);
      assert.equal(state.calls.some((entry) => entry[0] === "read"), false);
      assert.equal(state[busyName].value, false);
      assert.ok(state.errors.length > 0);
    });

    await test(`${label} stale list responses cannot replace a newer file list`, async () => {
      const first = deferred(), second = deferred();
      let requests = 0;
      const state = editorHarness(sfc, [refresh], { storage: { getFiles: () => (++requests === 1 ? first.promise : second.promise) } });
      const older = state[refresh](), newer = state[refresh]();
      second.resolve(["new.json"]); await newer;
      first.resolve(["stale.json"]); await older;
      assert.deepEqual(plain(state[sfc === quest ? "files" : "dialogueFiles"].value), ["new.json"]);
    });

    await test(`${label} pending read response is ignored after disposal`, async () => {
      const read = deferred(), started = deferred();
      const state = editorHarness(sfc, [select], { storage: { readFile() { started.resolve(); return read.promise; } } });
      const original = state[dataName].value;
      const pending = state[select]("later.json");
      await started.promise;
      state.disposed = true;
      read.resolve('{"title":"obsolete"}'); await pending;
      assert.equal(state[dataName].value, original);
      assert.equal(state[selectionName].value, "a.json");
    });

    await test(`${label} an invalidated file request cannot install its stale response`, async () => {
      const read = deferred(), started = deferred();
      const state = editorHarness(sfc, [select], { storage: { readFile() { started.resolve(); return read.promise; } } });
      const original = state[dataName].value;
      const pending = state[select]("superseded.json");
      await started.promise;
      state[sfc === quest ? "requestId" : "fileRequest"]++;
      read.resolve('{"title":"stale"}'); await pending;
      assert.equal(state[dataName].value, original);
      assert.equal(state[selectionName].value, "a.json");
    });

    await test(`${label} deletion flushes before trash and preserves the document on save failure`, async () => {
      const state = editorHarness(sfc, [remove, refresh]);
      await state[remove]();
      const sequence = state.calls.filter((entry) => ["flush", "trash", "discard"].includes(entry[0]));
      assert.equal(sequence[0][0], "flush"); assert.equal(sequence[1][0], "trash"); assert.equal(sequence[2][0], "discard");
      assert.equal(sequence[1][1], sequence[2][1]);
      assert.equal(state[selectionName].value, "");
      const failed = editorHarness(sfc, [remove], { saveQueue: { async flush() { throw new Error("write failure"); } } });
      await failed[remove]();
      assert.equal(failed[selectionName].value, "a.json");
      assert.equal(failed.calls.some((entry) => entry[0] === "trash"), false);
    });
  }

  await test("Quest has no file management sidebar or file CRUD handlers", () => {
    assert.equal(findElement(quest.descriptor.template.ast, "SelectableList"), undefined);
    assert.equal(findElement(quest.descriptor.template.ast, "Splitter"), undefined);
    for (const name of ["selectFile", "createFile", "deleteFile", "refreshFiles"]) {
      assert.equal(quest.ast.statements.some((node) => ts.isFunctionDeclaration(node) && node.name?.text === name), false);
    }
    const root = quest.descriptor.template.ast.children.find((node) => node.type === 1 && attr(node, "class") === "quest-editor");
    assert.equal(directive(root, "bind", "inert").exp.content, "busy");
  });

  await test("A new workspace automatically persists exactly one task document and reopens it", async () => {
    const { state, persisted, io } = questLoadHarness();
    await state.loadProject();
    assert.deepEqual([...persisted.keys()], ["/original/QuestEditor.json"]);
    assert.deepEqual(plain(state.project.value), { title: "new" });
    assert.equal(io.some(([op]) => op === "list"), false, "Never list a missing legacy directory");
    assert.equal(state.busy.value, false);
    const reopened = questLoadHarness([...persisted]);
    await reopened.state.loadProject();
    assert.deepEqual(plain(reopened.state.project.value), { title: "new" });
    assert.equal(reopened.io.some(([op]) => op === "write"), false);
  });

  await test("A sole legacy file is copied intact, without renumbering or deleting the original", async () => {
    const data = { mainQuests: [{ id: 7, style: "Custom" }], subQuests: [{ id: 100, nextQuestIds: [null, 199, 0] }] };
    const original = JSON.stringify(data);
    const legacyPath = "/original/QuestEditor/story.json";
    const { state, persisted } = questLoadHarness([[legacyPath, original]]);
    await state.loadProject();
    assert.deepEqual(plain(state.project.value), data);
    assert.equal(persisted.get(legacyPath), original);
    assert.deepEqual(JSON.parse(persisted.get("/original/QuestEditor.json")), data);
    assert.equal(persisted.size, 2);
    assert.deepEqual(plain(state.legacyFiles.value), []);
  });

  await test("Multiple legacy files require explicit selection and only the chosen file is copied", async () => {
    const initial = [
      ["/original/QuestEditor/a.json", '{"title":"A"}'],
      ["/original/QuestEditor/b.json", '{"title":"B"}'],
      ["/original/QuestEditor/readme.txt", "backup note"],
    ];
    const { state, persisted, io } = questLoadHarness(initial);
    await state.loadProject();
    assert.equal(state.project.value, undefined);
    assert.equal(state.busy.value, false);
    assert.deepEqual(plain(state.legacyFiles.value), ["a.json", "b.json"]);
    assert.equal(io.some(([op]) => op === "read" || op === "write"), false);
    assert.deepEqual([...persisted], initial);
    await state.loadProject("b.json");
    assert.deepEqual(plain(state.project.value), { title: "B" });
    assert.equal(persisted.get("/original/QuestEditor.json"), '{"title":"B"}');
    for (const [file, data] of initial) assert.equal(persisted.get(file), data);
  });

  await test("Existing fixed document wins over backups, even during a legacy selection", async () => {
    const { state, persisted, io } = questLoadHarness([
      ["/original/QuestEditor/a.json", '{"title":"A"}'],
      ["/original/QuestEditor/b.json", '{"title":"B"}'],
    ]);
    await state.loadProject();
    persisted.set("/original/QuestEditor.json", '{"title":"already chosen"}');
    await state.loadProject("a.json");
    assert.deepEqual(plain(state.project.value), { title: "already chosen" });
    assert.equal(io.some(([op]) => op === "write"), false);
  });

  await test("Corrupt fixed data or a failed read never falls back to a blank document or backup", async () => {
    for (const readFails of [false, true]) {
      const initial = [["/original/QuestEditor.json", "broken json"], ["/original/QuestEditor/backup.json", '{"title":"backup"}']];
      const { state, persisted, io } = questLoadHarness(initial, readFails ? { storage: { async readFile() { throw new Error("Read failed"); } } } : {});
      await state.loadProject();
      assert.equal(state.project.value, undefined);
      assert.ok(state.loadError.value);
      assert.equal(state.busy.value, false);
      assert.deepEqual([...persisted], initial);
      assert.equal(io.some(([op]) => op === "list" || op === "write"), false);
    }
  });

  await test("Corrupt legacy data is retained without creating an empty fixed document", async () => {
    const original = [["/original/QuestEditor/a.json", "invalid"]];
    const { state, persisted, io } = questLoadHarness(original);
    await state.loadProject();
    assert.equal(state.project.value, undefined);
    assert.ok(state.loadError.value);
    assert.deepEqual([...persisted], original);
    assert.equal(io.some(([op]) => op === "write"), false);
  });

  await test("Invalid legacy choices, including path traversal, do not copy or delete any data", async () => {
    for (const choice of ["", "../other.json", "missing.json"]) {
      const initial = [["/original/QuestEditor/a.json", '{"title":"A"}']];
      const { state, persisted, io } = questLoadHarness(initial);
      await state.loadProject(choice);
      assert.equal(state.project.value, undefined);
      assert.deepEqual([...persisted], initial);
      assert.equal(io.some(([op]) => op === "read" || op === "write"), false);
      assert.ok(state.loadError.value);
    }
  });

  await test("Failed initialization writes keep the panel closed and allow a safe retry", async () => {
    const { state, persisted, io } = questLoadHarness([], { storage: { async writeFile() { throw new Error("Disk full"); } } });
    await state.loadProject();
    assert.equal(state.project.value, undefined);
    assert.equal(persisted.size, 0);
    assert.match(state.loadError.value, /Disk full/);
    state.storage.writeFile = async (file, data) => { io.push(["write", file, data]); persisted.set(file, data); };
    await state.loadProject();
    assert.deepEqual(plain(state.project.value), { title: "new" });
    assert.equal(state.loadError.value, "");
    assert.equal(persisted.size, 1);
  });

  await test("Concurrent initializations are ignored and loading cannot replace an edited project", async () => {
    const gate = deferred();
    const { state, persisted } = questLoadHarness([], { storage: { exists: () => gate.promise } });
    const pending = state.loadProject();
    assert.equal(state.busy.value, true);
    await state.loadProject();
    gate.resolve(false); await pending;
    assert.equal(persisted.size, 1);
    state.project.value.title = "unsaved edit";
    await state.loadProject();
    assert.equal(state.project.value.title, "unsaved edit");
  });

  await test("Late legacy reads cannot install or write after unmount or request invalidation", async () => {
    for (const invalidate of [state => { state.disposed = true; }, state => { state.requestId++; }]) {
      const started = deferred(), read = deferred();
      const { state, persisted, io } = questLoadHarness([["/original/QuestEditor/a.json", "old"]], {
        storage: { readFile() { started.resolve(); return read.promise; } },
      });
      const pending = state.loadProject();
      await started.promise; invalidate(state);
      read.resolve('{"title":"late"}'); await pending;
      assert.equal(state.project.value, undefined);
      assert.equal(io.some(([op]) => op === "write"), false);
      assert.equal(persisted.size, 1);
    }
  });

  await test("A disposed existence check does not continue creating a task", async () => {
    const gate = deferred();
    const { state, io } = questLoadHarness([], { storage: { exists: () => gate.promise } });
    const pending = state.loadProject();
    state.disposed = true; gate.resolve(false); await pending;
    assert.equal(state.project.value, undefined);
    assert.deepEqual(io, []);
  });

  await test("Pending initialization writes stay in their original workspace and cannot install after unmount", async () => {
    const started = deferred(), written = deferred(), writes = [];
    const { state } = questLoadHarness([], { storage: { async writeFile(file, data) { writes.push([file, data]); started.resolve(); await written.promise; } } });
    const pending = state.loadProject();
    await started.promise;
    state.workspace.value = "another"; state.disposed = true;
    written.resolve(); await pending;
    assert.deepEqual(writes, [["/original/QuestEditor.json", '{"title":"new"}']]);
    assert.equal(state.project.value, undefined);
  });

  await test("Separate workspaces resolve to separate task documents", async () => {
    const first = questLoadHarness([], { bindings: { workspace: ref("First") } });
    const second = questLoadHarness([], { bindings: { workspace: ref("Second") } });
    await Promise.all([first.state.loadProject(), second.state.loadProject()]);
    assert.deepEqual([...first.persisted.keys()], ["/First/QuestEditor.json"]);
    assert.deepEqual([...second.persisted.keys()], ["/Second/QuestEditor.json"]);
  });

  await test("Local JSON download contains the current workspace data and a stable filename", () => {
    const downloads = [];
    const state = editorHarness(quest, ["downloadProject"], { bindings: { downloadTextFile: (...args) => downloads.push(args) } });
    state.workspace.value = "changed";
    state.project.value.title = "latest";
    state.downloadProject();
    assert.deepEqual(downloads, [['{"title":"latest"}', "original-任务.json", "application/json"]]);
  });

  await test("Parent waits for saving before switching and blocks overlapping switches", async () => {
    const gate = deferred();
    const { context: state } = parentHarness({ editorRef: ref({ prepareToLeave: () => gate.promise }) });
    const pending = state.ChangeWorkspace("next");
    assert.equal(state.selectedWorkspaceId.value, "original");
    assert.equal(state.switchingEditor.value, true);
    await state.ChangeEditorKind("Quest");
    assert.equal(state.selectedFunction.value, "Dialogue");
    gate.resolve(); await pending;
    assert.equal(state.selectedWorkspaceId.value, "next");
    assert.equal(state.switchingEditor.value, false);
    await state.ChangeEditorKind("Quest");
    assert.equal(state.selectedFunction.value, "Quest");
  });

  await test("Parent save failures keep the old workspace/editor and prevent workspace deletion", async () => {
    const { context: state, events, errors } = parentHarness({ editorRef: ref({ prepareToLeave: async () => { throw new Error("offline"); } }) });
    await state.ChangeWorkspace("new"); await state.ChangeEditorKind("Quest"); await state.DelectWorkspace();
    assert.equal(state.selectedWorkspaceId.value, "original");
    assert.equal(state.selectedFunction.value, "Dialogue");
    assert.equal(state.switchingEditor.value, false);
    assert.deepEqual(events, []);
    assert.equal(errors.length, 3);
  });

  await test("Parent workspace deletion saves before trashing and unmounting its editor", async () => {
    const gate = deferred();
    const { context: state, events } = parentHarness({ editorRef: ref({ prepareToLeave: () => gate.promise }) });
    const pending = state.DelectWorkspace();
    assert.deepEqual(events, []);
    assert.equal(state.selectedWorkspaceId.value, "original");
    gate.resolve(); await pending;
    assert.deepEqual(events, [["trash", "/original"], "refresh"]);
    assert.equal(state.selectedWorkspaceId.value, "");
  });

  await test("Quest exports three real ZIP entries using its captured workspace name", async () => {
    const gate = deferred(), createdUrls = [], downloaded = [], revoked = [], timers = [];
    const files = ["NOLOC_章节配置.json", "NOLOC_主任务配置.json", "NOLOC_子任务.json"].map((filename, index) => ({ filename, json: JSON.stringify({ variable: index }) }));
    let exportedProject;
    class DelayedZip extends JSZip {
      async generateAsync(options) {
        assert.equal(options.type, "blob");
        await gate.promise;
        return super.generateAsync({ type: "nodebuffer" });
      }
    }
    const state = editorHarness(quest, ["exportVariables"], { bindings: {
      JSZip: DelayedZip,
      exportQuestVariables(project) { exportedProject = project; return { files, warnings: [] }; },
      URL: { createObjectURL(blob) { createdUrls.push(blob); return "blob:test"; }, revokeObjectURL(url) { revoked.push(url); } },
      document: { body: { appendChild() {} }, createElement(tag) {
        assert.equal(tag, "a");
        return { click() { downloaded.push({ name: this.download, url: this.href }); }, remove() {} };
      } },
      window: { setTimeout(callback) { timers.push(callback); } },
    } });
    const original = state.project.value;
    const pending = state.exportVariables();
    assert.equal(state.exporting.value, true);
    state.workspace.value = "different"; state.project.value = { title: "different" };
    gate.resolve(); await pending;
    assert.equal(exportedProject, original);
    assert.deepEqual(downloaded, [{ name: "original-千星任务.zip", url: "blob:test" }]);
    const archive = await JSZip.loadAsync(createdUrls[0]);
    assert.deepEqual(Object.keys(archive.files).sort(), files.map((file) => file.filename).sort());
    for (const file of files) assert.equal(await archive.file(file.filename).async("string"), file.json);
    assert.equal(state.exporting.value, false);
    timers.forEach((callback) => callback());
    assert.deepEqual(revoked, ["blob:test"]);
  });

  await test("Quest export surfaces empty-reference warnings and still downloads the variables", async () => {
    const warnings = [
      "子任务 0「起始任务」的后续任务：第 2 项为空，将按 -1 导出。",
      "子任务 100「调查」的后续任务：第 1 项（ID 199）在当前文件中不存在，仍保留原 ID，请确认。",
    ];
    const notices = [], logged = [];
    let downloads = 0;
    const state = editorHarness(quest, ["exportVariables"], { bindings: {
      JSZip: class { file() {} async generateAsync() { return {}; } },
      exportQuestVariables: () => ({ files: [], warnings }),
      URL: { createObjectURL: () => "blob:warnings", revokeObjectURL() {} },
      document: { body: { appendChild() {} }, createElement() {
        return { click() { downloads++; }, remove() {} };
      } },
      window: { setTimeout(callback) { callback(); } },
      console: { ...quiet, warn: (value) => logged.push(value) },
      toast: { warning: (message) => notices.push(message), success() { assert.fail("Warnings cannot be reported as a clean export"); } },
    } });
    await state.exportVariables();
    assert.equal(downloads, 1);
    assert.deepEqual(notices, [warnings.join("；")]);
    assert.deepEqual(logged, [warnings]);
    assert.deepEqual(state.errors, []);
    assert.equal(state.exporting.value, false);
  });

  await test("Unmounted Quest export does not initiate a stale browser download", async () => {
    const gate = deferred(); let downloads = 0;
    const state = editorHarness(quest, ["exportVariables"], { bindings: {
      JSZip: class { file() {} generateAsync() { return gate.promise; } },
      exportQuestVariables: () => ({ files: [], warnings: [] }),
      URL: { createObjectURL() { downloads++; } },
    } });
    const pending = state.exportVariables(); state.disposed = true;
    gate.resolve({}); await pending;
    assert.equal(downloads, 0);
    assert.equal(state.exporting.value, false);
  });

  for (const sfc of [quest, dialogue]) {
    const label = sfc === quest ? "Quest" : "Dialogue";
    await test(`${label} Ctrl+S downloads locally and teardown removes exactly the registered shortcut`, async () => {
      const mounted = [], unmount = [], added = [], removed = [];
      let downloads = 0, prevented = 0, flushes = 0;
      const shortcut = sfc === quest ? "saveShortcut" : "HandleSaveShortcut";
      const state = editorHarness(sfc, [shortcut], {
        saveQueue: { async flush() { flushes++; } },
        extra: [callsText(sfc, "onMounted"), callsText(sfc, "onBeforeUnmount")],
        bindings: {
          onMounted(callback) { mounted.push(callback); }, onBeforeUnmount(callback) { unmount.push(callback); },
          loadProject: async () => undefined,
          downloadProject() { downloads++; }, DownloadDialogueFile() { downloads++; },
          window: { addEventListener: (...args) => added.push(args), removeEventListener: (...args) => removed.push(args) },
        },
      });
      mounted.forEach((callback) => callback());
      assert.equal(added.length, 1); assert.equal(added[0][0], "keydown");
      const send = (options) => added[0][1]({ key: "s", repeat: false, ctrlKey: false, metaKey: false, preventDefault() { prevented++; }, ...options });
      send({ ctrlKey: true }); send({ key: "S", metaKey: true }); send({}); send({ ctrlKey: true, repeat: true });
      assert.equal(downloads, 2); assert.equal(prevented, 2);
      unmount.forEach((callback) => callback());
      assert.equal(removed.length, 1); assert.equal(removed[0][0], "keydown");
      assert.equal(removed[0][1], added[0][1]);
      assert.equal(state.disposed, true); assert.equal(flushes, 1);
      await Promise.resolve();
    });
  }
  console.log(`\n${passed} DSFG Quest integration tests passed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
