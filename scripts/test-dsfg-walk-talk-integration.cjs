/* Run with: node scripts/test-dsfg-walk-talk-integration.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const ts = require("typescript");
const vue = require("vue");
const { parse, compileScript, compileTemplate, compileStyle } = require("@vue/compiler-sfc");
const plain = value => JSON.parse(JSON.stringify(value));
const root = path.resolve(__dirname, "..");
const directory = path.join(root, "src/views/DSFGStudio/components/WalkTalkEditor");
const filename = path.join(directory, "WalkTalkEditor.vue");
const descriptor = parse(fs.readFileSync(filename, "utf8"), { filename }).descriptor;
const ast = ts.createSourceFile(`${filename}.ts`, descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const script = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function main() {
  const library = await import("miliastra-variable");
  const originalLoad = Module._load, originalTs = Module._extensions[".ts"];
  Module._load = function (name, parent, isMain) {
    if (name === "miliastra-variable") return library;
    return originalLoad.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, isMain);
  };
  Module._extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
  const harnesses = [];
  try {
    const model = require(path.join(directory, "walkTalkProject.ts"));
    const exporter = require(path.join(directory, "walkTalkExporter.ts"));
    const { createWorkspaceSaveQueue } = require(path.join(directory, "../QuestEditor/workspaceSaveQueue.ts"));
    function harness(options = {}) {
      const data = new Map(options.data ?? []), calls = [], errors = [], downloads = [], exposed = {}, stops = [];
      const workspace = vue.ref("original");
      const active = vue.ref(true);
      let mounted, unmounted, saves;
      const storage = {
        setProject(id) { calls.push(["scope", id]); return this; },
        async exists(file) { calls.push(["exists", file]); return data.has(file) || [...data.keys()].some(key => key.startsWith(`${file}/`)); },
        async getFiles(dir) { calls.push(["list", dir]); return [...data.keys()].filter(key => key.startsWith(`${dir}/`)).map(key => key.slice(dir.length + 1)); },
        async readFile(file) { calls.push(["read", file]); if (!data.has(file)) throw new Error("missing"); return data.get(file); },
        async writeFile(file, raw) { calls.push(["write", file]); data.set(file, raw); },
        async trash(file) { calls.push(["trash", file]); data.delete(file); },
        ...options.storage,
      };
      const bindings = {
        ...model, ...exporter, Error, console: { error() {} },
        useWorkspaceStructIds: () => ({ walkTalk: project => project }),
        // History gestures are covered separately; this harness isolates file I/O.
        useStudioDocumentHistory: () => ({}),
        ref: vue.ref, watch: (...args) => { const stop = vue.watch(...args); stops.push(stop); return stop; },
        studioEditorActiveKey: Symbol('studioEditorActive'),
        inject: key => key === "storage" ? storage : key === "selectedWorkspaceId" ? workspace : () => active.value,
        onMounted: callback => { mounted = callback; }, onBeforeUnmount: callback => { unmounted = callback; },
        defineProps: () => ({}), withDefaults: (props, defaults) => ({ ...defaults, ...props }), defineEmits: () => () => {},
        defineExpose: api => Object.assign(exposed, api),
        createWorkspaceSaveQueue: (...args) => { saves = createWorkspaceSaveQueue(...args); return saves; },
        ProjectID: "DSFGStudio", confirm: () => true,
        toast: { error: message => errors.push(message), warning() {}, success() {} },
        downloadTextFile: (...args) => downloads.push(args),
        window: { addEventListener: (...args) => calls.push(["listen", ...args]), removeEventListener: (...args) => calls.push(["unlisten", ...args]) },
        ...options.bindings,
      };
      const context = vm.createContext(bindings);
      vm.runInContext(`${script}\nglobalThis.api = { project, files, selectedFile, creating, newName, busy, saveStatus, fileError, refreshFiles, selectFile, createFile, deleteFile, exportVariables, saveShortcut };`, context, { filename, timeout: 2000 });
      const result = { ...context.api, data, storage, workspace, active, calls, errors, downloads, exposed, mount: () => mounted(), unmount: () => unmounted(), flush: () => saves.flush(), close: async () => { stops.forEach(stop => stop()); unmounted(); try { await saves.flush(); } catch { saves.discard(); } } };
      harnesses.push(result);
      return result;
    }
    const doc = title => { const project = model.createWalkTalkProject(); const entry = model.addWalkTalkEntry(project); entry.content = title; return model.encodeWalkTalkProject(project); };
    const aPath = "/original/WalkTalkEditor/a.json", bPath = "/original/WalkTalkEditor/b.json";
    const open = async (options = {}) => { const h = harness({ data: [[aPath, doc("original A")], [bPath, doc("original B")]], ...options }); await h.selectFile("a.json"); return h; };
    let passed = 0;
    async function test(name, check) { await check(); passed++; console.log(`PASS ${name}`); }

    await test("editor and panel compile with their actual Vue templates", () => {
      for (const name of ["WalkTalkEditor.vue", "WalkTalkPanel.vue", "AutoGrowTextarea.vue"]) {
        const filename = path.join(directory, name), result = parse(fs.readFileSync(filename, "utf8"), { filename });
        assert.deepEqual(result.errors, []);
        const script = compileScript(result.descriptor, { id: name });
        assert.deepEqual(compileTemplate({ source: result.descriptor.template.content, filename, id: name, compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
        for (const style of result.descriptor.styles) assert.deepEqual(compileStyle({ source: style.content, filename, id: name, scoped: true }).errors, []);
      }
    });
    await test("compact rows retain editable fields, automatic text height and grouped actions", () => {
      const file = path.join(directory, "WalkTalkPanel.vue");
      const panel = parse(fs.readFileSync(file, "utf8")).descriptor;
      const css = compileStyle({ source: panel.styles[0].content, filename: file, id: 'walk-talk-appearance' });
      function declarations(selector) {
        const result = {};
        css.rawResult.root.walkRules(rule => {
          if (rule.selectors.includes(selector) && rule.parent.type === 'root') rule.walkDecls(decl => { result[decl.prop] = decl.value; });
        });
        return result;
      }
      assert.equal(declarations('.walk-talk-panel')['text-align'], 'left');
      assert.equal(declarations('label')['text-align'], 'left');
      assert.equal(declarations('.dialogue-row').display, 'grid');
      assert.equal(declarations('.delay-input input').width, '58px');
      assert.ok(panel.template.content.includes('<AutoGrowTextarea v-model="entry.content"'));
      assert.ok(panel.template.content.includes('@pointerdown="start($event, entry.id)"'));
      assert.ok(panel.template.content.includes('v-model="entry.continueDelay"'));
      assert.ok(panel.template.content.includes('v-model="entry.params"'));
      assert.ok(panel.template.content.includes('class="card-actions" role="group"'));
      assert.ok(panel.styles[0].content.includes('@container (max-width: 540px)'));
    });
    await test("style is a bound dropdown with registered choices and a read-only legacy fallback", () => {
      const panel = parse(fs.readFileSync(path.join(directory, "WalkTalkPanel.vue"), "utf8")).descriptor;
      const nodes = [];
      function visit(node) { if (node.type === 1) nodes.push(node); for (const child of node.children ?? []) visit(child); }
      visit(panel.template.ast);
      const binding = (node, name) => node.props.find(prop => prop.type === 7 && prop.name === name);
      const styleFields = nodes.filter(node => binding(node, "model")?.exp?.content === "entry.style");
      assert.equal(styleFields.length, 1); assert.equal(styleFields[0].tag, "StudioSelectField");
      const options = styleFields[0].children.filter(node => node.type === 1 && node.tag === "option");
      assert.equal(binding(options[1], "for").exp.content, "option in WALK_TALK_STYLE_OPTIONS");
      assert.ok(options[0].props.some(prop => prop.type === 6 && prop.name === "disabled"));
      assert.ok(binding(options[0], "if").exp.content.includes("option.value === entry.style"));
    });
    function dragHarness() {
      const file = path.join(directory, "useWalkTalkReorder.ts");
      const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const code = ts.transpileModule(source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source)).join("\n").replace("export function", "function"), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
      }).outputText;
      const project = vue.ref(model.createWalkTalkProject());
      for (const content of ["A", "B", "C"]) model.addWalkTalkEntry(project.value).content = content;
      const originals = [...project.value.entries], listeners = new Map(), frames = new Map();
      const active = vue.ref(true), stops = [];
      let serial = 0, unmount;
      const list = { scrollTop: 0, getBoundingClientRect: () => ({ left: 0, right: 800, top: 0, bottom: 300, height: 300 }),
        querySelectorAll: () => project.value.entries.map((entry, i) => ({ dataset: { entryId: entry.id }, getBoundingClientRect: () => ({ top: i * 80 - list.scrollTop, height: 70 }) })) };
      const context = vm.createContext({ ref: vue.ref, watch: (...args) => { stops.push(vue.watch(...args)); }, onBeforeUnmount: fn => { unmount = fn; },
        studioEditorActiveKey: Symbol('studioEditorActive'), inject: () => () => active.value,
        moveWalkTalkEntry: model.moveWalkTalkEntry, project, list: { value: list },
        window: { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) },
        requestAnimationFrame: fn => { frames.set(++serial, fn); return serial; }, cancelAnimationFrame: id => frames.delete(id),
      });
      vm.runInContext(`${code}\nglobalThis.api = useWalkTalkReorder(() => project.value, list);`, context);
      const event = (x, y, extra = {}) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, isPrimary: true, preventDefault() {}, ...extra });
      return { api: context.api, project, originals, list, listeners, frames, active,
        start(index) { context.api.start(event(15, index * 80 + 20, { currentTarget: { focus() {}, closest: () => ({ getBoundingClientRect: () => ({ left: 0, top: index * 80, width: 800 }) }) } }), project.value.entries[index].id); },
        fire(type, x, y, extra) { listeners.get(type)?.(event(x, y, extra)); },
        tick() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); },
        order: () => project.value.entries.map(entry => entry.content).join(""),
        close() { unmount(); stops.forEach(stop => stop()); },
      };
    }
    await test("drag previews without mutating drafts, then moves original entries in both directions", () => {
      const h = dragHarness();
      h.originals[0].continueDelay = "-"; h.originals[0].params = "2, 3";
      h.start(0); h.fire("pointermove", 20, 270);
      assert.equal(h.order(), "ABC"); assert.equal(h.api.draggingId.value, h.originals[0].id);
      h.fire("pointerup", 20, 270);
      assert.equal(h.order(), "BCA"); assert.equal(h.project.value.entries[2], h.originals[0]);
      assert.equal(h.project.value.entries[2].continueDelay, "-"); assert.equal(h.project.value.entries[2].params, "2, 3");
      h.start(2); h.fire("pointermove", 20, 5); h.fire("pointerup", 20, 5);
      assert.equal(h.order(), "ABC"); assert.equal(h.listeners.size, 0); assert.equal(h.frames.size, 0);
      h.close();
    });
    await test("same-slot drops, handle clicks, cancelled gestures and drops outside preserve order", () => {
      const h = dragHarness();
      h.start(1); h.fire("pointerup", 15, 100); assert.equal(h.order(), "ABC");
      h.start(1); h.fire("pointermove", 20, 102); h.fire("pointerup", 20, 102); assert.equal(h.order(), "ABC");
      for (const cancel of ["keydown", "pointercancel", "blur", "pointerup"]) {
        h.start(0); h.fire("pointermove", 20, 270);
        h.fire(cancel, 900, 270, { key: "Escape" });
        assert.equal(h.order(), "ABC"); assert.equal(h.api.draggingId.value, "");
        assert.equal(h.listeners.size, 0); assert.equal(h.frames.size, 0);
      }
      h.close();
    });
    await test("drag scrolls near list edges and cancels cleanly when the document changes or unmounts", async () => {
      const h = dragHarness();
      h.start(0); h.fire("pointermove", 20, 290); h.tick(); assert.ok(h.list.scrollTop > 0);
      h.fire("pointerup", 20, 290, { pointerId: 2 }); assert.notEqual(h.api.draggingId.value, "");
      h.project.value = model.createWalkTalkProject(); await vue.nextTick();
      assert.equal(h.api.draggingId.value, ""); assert.equal(h.listeners.size, 0); assert.equal(h.frames.size, 0);
      model.addWalkTalkEntry(h.project.value); model.addWalkTalkEntry(h.project.value);
      h.start(0); h.fire("pointermove", 20, 120); h.close();
      assert.equal(h.listeners.size, 0); assert.equal(h.frames.size, 0);
    });
    await test("Hiding the module cancels drag listeners and disables reorder shortcuts", () => {
      const h = dragHarness();
      h.start(0); h.fire("pointermove", 20, 270);
      h.active.value = false;
      assert.equal(h.order(), "ABC"); assert.equal(h.api.draggingId.value, "");
      assert.equal(h.listeners.size, 0); assert.equal(h.frames.size, 0);
      let prevented = 0;
      h.api.keyboardMove({ key: "ArrowDown", altKey: true, preventDefault() { prevented++; } }, h.originals[0].id);
      h.start(0);
      assert.equal(prevented, 0); assert.equal(h.order(), "ABC"); assert.equal(h.listeners.size, 0);
      h.active.value = true;
      h.start(0); assert.ok(h.listeners.size > 0);
      h.close();
    });
    await test("keyboard reorder moves the focused entry and respects first and last boundaries", () => {
      const h = dragHarness(), id = h.originals[0].id;
      const event = key => ({ key, altKey: true, preventDefault() {} });
      h.api.keyboardMove(event("ArrowUp"), id); assert.equal(h.order(), "ABC");
      h.api.keyboardMove(event("ArrowDown"), id); assert.equal(h.order(), "BAC");
      h.api.keyboardMove(event("ArrowDown"), id); assert.equal(h.order(), "BCA");
      h.api.keyboardMove(event("ArrowDown"), id); assert.equal(h.order(), "BCA");
      h.close();
    });
    await test("textarea grows and shrinks for input, restored content and width changes, then releases its observer", async () => {
      const panel = parse(fs.readFileSync(path.join(directory, "AutoGrowTextarea.vue"), "utf8")).descriptor;
      const source = ts.createSourceFile("textarea.ts", panel.scriptSetup.content, ts.ScriptTarget.Latest, true);
      const code = ts.transpileModule(source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
      const props = vue.reactive({ modelValue: "short" }), emitted = [];
      const element = { clientWidth: 400, offsetHeight: 36, clientHeight: 34, scrollHeight: 34, style: {} };
      let mount, unmount, callback, disconnected = false, stop;
      const context = vm.createContext({ defineProps: () => props, defineEmits: () => (...args) => emitted.push(args),
        ref: () => ({ value: element }), nextTick: vue.nextTick, watch: (...args) => { stop = vue.watch(...args); },
        onMounted: fn => { mount = fn; }, onBeforeUnmount: fn => { unmount = fn; },
        ResizeObserver: class { constructor(fn) { callback = fn; } observe() {} disconnect() { disconnected = true; } },
      });
      vm.runInContext(`${code}\nglobalThis.inputText = input;`, context);
      mount(); assert.equal(element.style.height, "36px");
      element.scrollHeight = 100; context.inputText({ target: { value: "long text" } });
      assert.deepEqual(emitted, [["update:modelValue", "long text"]]); assert.equal(element.style.height, "102px");
      element.scrollHeight = 34; props.modelValue = "shorter"; await vue.nextTick(); await vue.nextTick();
      assert.equal(element.style.height, "36px");
      element.scrollHeight = 78; callback([{ contentRect: { width: 150 } }]); assert.equal(element.style.height, "80px");
      unmount(); stop(); assert.equal(disconnected, true);
    });
    await test("missing directory is empty, not a failing storage-provider retry", async () => {
      const h = harness(); await h.refreshFiles();
      assert.deepEqual(plain(h.files.value), []); assert.equal(h.calls.some(call => call[0] === "list"), false);
      assert.equal(h.data.size, 0); assert.deepEqual(h.errors, []);
    });
    await test("create opens an independent empty file in the captured workspace directory", async () => {
      const h = harness(); h.newName.value = "路边闲聊";
      await h.createFile();
      assert.equal(h.selectedFile.value, "路边闲聊.json"); assert.equal(h.project.value.entries.length, 0);
      assert.ok(h.data.has("/original/WalkTalkEditor/路边闲聊.json"));
      assert.deepEqual(plain(h.files.value), ["路边闲聊.json"]);
    });
    await test("create rejects duplicates and unsafe filenames without overwriting", async () => {
      const h = await open(), before = [...h.data];
      for (const name of ["a", "../escape", "..", "", "x/y", "x\\y", "bad:name"]) { h.newName.value = name; await h.createFile(); }
      assert.deepEqual([...h.data], before); assert.equal(h.selectedFile.value, "a.json");
    });
    await test("deep edits auto-save the full draft, including unfinished continueDelay input", async () => {
      const h = await open(); h.project.value.entries[0].continueDelay = "-";
      await h.flush();
      assert.equal(model.decodeWalkTalkProject(h.data.get(aPath)).entries[0].continueDelay, "-");
      assert.equal(h.saveStatus.value, "已自动保存");
    });
    await test("switch flushes old content before reading new file and retains immutable workspace paths", async () => {
      const h = await open(); h.project.value.entries[0].content = "edited A";
      h.workspace.value = "other"; await h.selectFile("b.json");
      assert.equal(h.project.value.entries[0].content, "original B");
      assert.equal(model.decodeWalkTalkProject(h.data.get(aPath)).entries[0].content, "edited A");
      assert.ok(h.calls.findIndex(call => call[0] === "write" && call[1] === aPath) < h.calls.findIndex(call => call[0] === "read" && call[1] === bPath));
      assert.ok(h.calls.filter(call => call[0] === "write").every(call => call[1].startsWith("/original/")));
    });
    await test("save failure prevents switching, creating, deleting and leaving without losing edits", async () => {
      const h = await open(); h.storage.writeFile = async () => { throw new Error("disk full"); };
      h.project.value.entries[0].content = "unsaved";
      await h.selectFile("b.json"); h.newName.value = "new"; await h.createFile(); await h.deleteFile();
      await assert.rejects(h.exposed.prepareToLeave(), /disk full/);
      assert.equal(h.selectedFile.value, "a.json"); assert.equal(h.project.value.entries[0].content, "unsaved");
      assert.equal(h.data.size, 2); assert.ok(!h.calls.some(call => call[0] === "trash"));
      h.storage.writeFile = async (file, raw) => h.data.set(file, raw); await h.flush();
      assert.equal(model.decodeWalkTalkProject(h.data.get(aPath)).entries[0].content, "unsaved");
    });
    await test("corrupt file read retains the open document instead of overwriting with a blank", async () => {
      const h = await open(); h.data.set(bPath, "{broken");
      await h.selectFile("b.json");
      assert.equal(h.selectedFile.value, "a.json"); assert.equal(h.project.value.entries[0].content, "original A");
      assert.equal(h.data.get(bPath), "{broken"); assert.ok(h.fileError.value.includes("JSON"));
    });
    await test("delete flushes the current draft and uses trash before clearing selection", async () => {
      const h = await open(); h.project.value.entries[0].content = "last edit";
      let trashed; h.storage.trash = async file => { trashed = [file, h.data.get(file)]; h.data.delete(file); };
      await h.deleteFile();
      assert.equal(trashed[0], aPath); assert.equal(model.decodeWalkTalkProject(trashed[1]).entries[0].content, "last edit");
      assert.equal(h.selectedFile.value, ""); assert.equal(h.project.value, undefined); assert.equal(h.data.size, 1);
      await h.flush(); assert.equal(h.data.has(aPath), false);
    });
    await test("cancelled or failed trash preserves document and selection", async () => {
      const cancelled = await open({ bindings: { confirm: () => false } }); await cancelled.deleteFile(); assert.equal(cancelled.selectedFile.value, "a.json");
      const failed = await open({ storage: { async trash() { throw new Error("trash failed"); } } }); await failed.deleteFile();
      assert.equal(failed.selectedFile.value, "a.json"); assert.equal(failed.data.size, 2); assert.equal(failed.project.value.entries[0].content, "original A");
    });
    await test("workspace IDs govern exports without overwriting the file's legacy metadata", async () => {
      const h = await open({ bindings: { useWorkspaceStructIds: () => ({ walkTalk: project => ({ ...project, structIds: { sequence: "9", dialogue: "10" } }) }) } });
      h.exportVariables();
      const variable = JSON.parse(h.downloads[0][0]);
      assert.equal(variable.structId, "9");
      assert.equal(variable.value[0].value.structId, "10");
      assert.equal(h.project.value.structIds.sequence, "1077936171");
      assert.ok(!descriptor.template.content.includes('openSettings'));
    });
    await test("Ctrl+S saves to the workspace without downloading; runtime export remains available", async () => {
      const h = await open(); h.project.value.entries[0].continueDelay = "7.25";
      let prevented = 0;
      const event = { ctrlKey: true, metaKey: false, key: "s", repeat: false, preventDefault: () => prevented++ };
      h.active.value = false;
      await h.saveShortcut(event); assert.equal(prevented, 0);
      assert.equal(JSON.parse(h.data.get(aPath)).entries[0].continueDelay, "0.00");
      h.active.value = true;
      await h.saveShortcut(event); assert.equal(prevented, 1); assert.equal(h.downloads.length, 0);
      assert.equal(JSON.parse(h.data.get(aPath)).entries[0].continueDelay, "7.25");
      assert.ok(!descriptor.template.content.includes("downloadProject"));
      h.exportVariables(); assert.equal(h.downloads[0][1], "a-边走边说.json");
      const variable = JSON.parse(h.downloads[0][0]);
      assert.equal(variable.value[0].value.value[0].value.value[4].value, "7.25");
      await h.saveShortcut({ ...event, repeat: true }); await h.saveShortcut({ ...event, ctrlKey: false }); assert.equal(h.downloads.length, 1);
      h.project.value.entries[0].continueDelay = "bad"; h.exportVariables(); assert.equal(h.downloads.length, 1); assert.ok(h.errors.at(-1).includes("continueDelay"));
    });
    await test("busy operations block leave and stale unmounted reads cannot replace the document", async () => {
      const gate = deferred(); const h = harness({ storage: { async readFile() { return gate.promise; } } });
      const pending = h.selectFile("a.json"); await Promise.resolve();
      assert.equal(h.busy.value, true); await assert.rejects(h.exposed.prepareToLeave(), /正在读写/);
      h.unmount(); gate.resolve(doc("late")); await pending;
      assert.equal(h.project.value, undefined); assert.equal(h.selectedFile.value, "");
    });
    await test("older file-list responses cannot replace a newer refresh", async () => {
      const gate = deferred(); let count = 0;
      const h = harness({ storage: { async exists() { return true; }, async getFiles() { return ++count === 1 ? gate.promise : ["new.json"]; } } });
      const first = h.refreshFiles(); await new Promise(setImmediate); await h.refreshFiles(); gate.resolve(["old.json"]); await first;
      assert.deepEqual(plain(h.files.value), ["new.json"]);
    });
    await test("keyboard listener is removed and edits flushed on unmount", async () => {
      const h = await open(); h.mount(); h.project.value.entries[0].content = "unmount edit"; h.unmount(); await h.flush();
      const added = h.calls.find(call => call[0] === "listen"), removed = h.calls.find(call => call[0] === "unlisten");
      assert.equal(added[2], removed[2]); assert.equal(model.decodeWalkTalkProject(h.data.get(aPath)).entries[0].content, "unmount edit");
    });
    console.log(`\n${passed} walk-talk integration tests passed.`);
  } finally {
    for (const h of harnesses) await h.close();
    Module._load = originalLoad;
    if (originalTs) Module._extensions[".ts"] = originalTs; else delete Module._extensions[".ts"];
  }
}
let completed = false;
process.once("beforeExit", () => { if (!completed) { console.error("Integration tests ended with an unresolved operation"); process.exitCode = 1; } });
main().then(() => { completed = true; }).catch(error => { completed = true; console.error(error); process.exitCode = 1; });
