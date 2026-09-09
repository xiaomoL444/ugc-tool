/* Run: node scripts/test-client-ui-clip-clipboard.cjs
 * Executes the editor's real Vue setup declarations, including clipboard,
 * keyboard, preview, and project persistence logic.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const ts = require("typescript");
const vue = require("vue");
const { parse } = require("@vue/compiler-sfc");

async function main() {
  const editor = path.resolve(__dirname, "../src/views/ClientUIAnimationEditor");
  const filename = path.join(editor, "ClientUIAnimationEditor.vue");
  const source = fs.readFileSync(filename, "utf8");
  const parsed = parse(source, { filename });
  assert.deepEqual(parsed.errors, []);
  const ast = ts.createSourceFile(filename + ".ts", parsed.descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = ast.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) ||
    (ts.isVariableStatement(statement) && !statement.declarationList.declarations.some((declaration) =>
      declaration.initializer && ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(ast) === "defineComponent")),
  ).map((statement) => statement.getText(ast)).join("\n");
  const exposed = [
    "nodes", "duration", "currentTime", "playing", "selectedId", "tweenTracks", "selectedTweenTrackId",
    "makeNode", "getHierarchyOrder", "applyNodeLayout", "buildTweenPreviewNodes", "serializeProject", "applyProjectData",
    "tweenClipClipboard", "copySelectedTweenClip", "pasteTweenClipAtPlayhead", "timelineEditNotice", "stopDocumentInteraction",
    "handleTimelineClipClipboardShortcut", "editorElement", "timelineContextMenu", "workspacePanelOpen", "archiveAction",
    "tweenFieldPickerNodeId", "luaExportMenuOpen", "addMenuOpen", "anchorMenuOpen", "draggingTweenTrackId", "timelineScrubbing", "timelineDataImportOpen",
  ];
  const script = ts.transpileModule(`${declarations}\nglobalThis.editorApi = { ${exposed.join(", ")} };`, {
    fileName: filename + ".ts", compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const converter = await import("genshin-impact-ugc-file-converter-web");
  const originalLoad = Module._load;
  const originalTsExtension = Module._extensions[".ts"];
  Module._load = function (request, parent, isMain) {
    if (request === "genshin-impact-ugc-file-converter-web") return converter;
    return originalLoad.call(this, request, parent, isMain);
  };
  Module._extensions[".ts"] = (module, sourcePath) => module._compile(ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    fileName: sourcePath, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, sourcePath);
  const plain = (value) => JSON.parse(JSON.stringify(value));
  let passed = 0;
  const failures = [];
  async function test(name, check) {
    try { await check(); passed += 1; console.log(`PASS ${name}`); }
    catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}\n${error.stack}`); }
  }
  try {
    const imports = {};
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
      const source = statement.moduleSpecifier.text;
      if (!source.startsWith("./") || source.endsWith(".vue") || source === "./imageAssets") continue;
      const sourcePath = path.resolve(editor, `${source}.ts`);
      if (fs.existsSync(sourcePath)) Object.assign(imports, require(sourcePath));
    }
    class Element {
      constructor(tag = "div", extras = {}) {
        this.tagName = tag.toUpperCase(); this.type = "text"; this.readOnly = false;
        this.disabled = false; this.isConnected = true; this.inert = false;
        this.parentElement = null; Object.assign(this, extras);
      }
      get isContentEditable() { return this.editable ?? this.parentElement?.isContentEditable ?? false; }
      set isContentEditable(value) { this.editable = value; }
      getClientRects() { return this.visible === false ? [] : [{}]; }
      contains(target) { return target === this || Boolean(target && this.contains(target.parentElement)); }
      closest(selector) {
        const matches = selector.split(",").some((part) => {
          part = part.trim();
          return part === this.tagName.toLowerCase() ||
            (part.startsWith("[contenteditable") && this.isContentEditable) ||
            (part.replaceAll("'", '"') === '[role="textbox"]' && this.role === "textbox") ||
            (part.replaceAll("'", '"') === '[role="dialog"]' && this.role === "dialog");
        });
        return matches ? this : this.parentElement?.closest(selector) || null;
      }
      getAttribute(name) { return name === "role" ? this.role ?? null : null; }
      setAttribute(name, value) { this[name] = value; }
    }
    function fixture() {
      const selection = { isCollapsed: true, text: "", toString() { return this.text; } };
      const root = new Element("div");
      const doc = { activeElement: root, body: new Element("body"), getSelection: () => selection, querySelector: () => null };
      const context = vm.createContext({
        ...vue, ...imports, inject: () => null, nextTick: () => Promise.resolve(),
        HTMLElement: Element, Element, HTMLInputElement: Element, HTMLTextAreaElement: Element,
        window: { innerWidth: 1200, innerHeight: 900, addEventListener() {}, removeEventListener() {}, getSelection: () => selection },
        document: doc,
      });
      vm.runInContext(script, context, { filename, timeout: 2000 });
      const api = context.editorApi;
      api.nodes.value = [
        api.makeNode("container", "Root", { id: "root", scaleX: 1, scaleY: 1, anchorOffsetX: 0, anchorOffsetY: 0, sizeDeltaX: 1600, sizeDeltaY: 900 }),
        api.makeNode("container", "Group", { id: "group", parentId: "root", scaleX: 2, scaleY: 3, anchorOffsetX: 100, anchorOffsetY: 50, sizeDeltaX: 200, sizeDeltaY: 100 }),
        api.makeNode("image", "Image", { id: "image", parentId: "group", anchorOffsetX: 20, anchorOffsetY: 10, sizeDeltaX: 30, sizeDeltaY: 30 }),
      ];
      api.getHierarchyOrder().forEach(api.applyNodeLayout);
      api.duration.value = 10; api.tweenTracks.value = []; api.selectedId.value = "group";
      api.editorElement.value = root;
      return { api, root, doc, selection };
    }
    let id = 0;
    function clip(extras = {}) {
      return { id: `clip-${++id}`, nodeId: "group", fieldKey: "anchoredPositionX", startTime: 0, duration: 1,
        initialValue: 100, endValue: 140, easeType: "InCirc", ...extras };
    }
    function selectedFixture(extras = {}) {
      const result = fixture();
      result.api.tweenTracks.value = [clip(extras)];
      result.original = result.api.tweenTracks.value[0];
      result.api.selectedId.value = result.original.nodeId;
      result.api.selectedTweenTrackId.value = result.original.id;
      return result;
    }
    function shortcut(code, target, extras = {}) {
      return { code, key: code === "KeyC" ? "c" : "v", target, ctrlKey: true, metaKey: false,
        shiftKey: false, altKey: false, isComposing: false, repeat: false, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; },
        ...extras };
    }
    function assertRefused(api, time) {
      const before = plain(api.tweenTracks.value);
      const selection = api.selectedTweenTrackId.value;
      api.currentTime.value = time;
      assert.equal(api.pasteTweenClipAtPlayhead(), null);
      assert.deepEqual(plain(api.tweenTracks.value), before);
      assert.equal(api.selectedTweenTrackId.value, selection);
      assert.ok(api.timelineEditNotice.value, "Rejected paste must explain the failure");
    }

    await test("Copy snapshots the selected Clip without changing timeline or playback", () => {
      const { api, original } = selectedFixture();
      api.playing.value = true;
      const before = plain(api.tweenTracks.value);
      const copied = api.copySelectedTweenClip();
      assert.deepEqual(plain(copied), plain(original));
      assert.deepEqual(plain(api.tweenClipClipboard.value), plain(original));
      assert.notEqual(api.tweenClipClipboard.value, original);
      assert.deepEqual(plain(api.tweenTracks.value), before);
      assert.equal(api.playing.value, true);
    });
    await test("Copying no Clip has no side effects", () => {
      const { api } = fixture();
      assert.equal(api.copySelectedTweenClip(), null);
      assert.equal(api.tweenClipClipboard.value, null);
      assert.equal(api.tweenTracks.value.length, 0);
    });
    await test("Paste creates a fresh ID on the source property lane at the playhead", () => {
      const { api, original } = selectedFixture({ duration: 1.75, initialValue: 0, endValue: -90, relative: true });
      api.copySelectedTweenClip(); api.currentTime.value = 3; api.playing.value = true;
      const pasted = api.pasteTweenClipAtPlayhead();
      assert.ok(pasted);
      assert.notEqual(pasted.id, original.id);
      assert.deepEqual(plain(pasted), { ...plain(original), id: pasted.id, startTime: 3 });
      assert.equal(api.tweenTracks.value.length, 2);
      assert.equal(api.selectedTweenTrackId.value, pasted.id);
      assert.equal(api.selectedId.value, original.nodeId);
      assert.equal(api.playing.value, false);
      assert.equal(original.startTime, 0);
    });
    await test("Pasting preserves the source lane even if another hierarchy node is selected", () => {
      const { api } = selectedFixture();
      api.copySelectedTweenClip(); api.selectedId.value = "image"; api.selectedTweenTrackId.value = null; api.currentTime.value = 2;
      const pasted = api.pasteTweenClipAtPlayhead();
      assert.ok(pasted); assert.equal(pasted.nodeId, "group"); assert.equal(pasted.fieldKey, "anchoredPositionX");
    });
    await test("Color snapshots and each paste own independent initial and end values", () => {
      const { api, original } = selectedFixture({ nodeId: "image", fieldKey: "imageColor",
        initialValue: { r: 20, g: 40, b: 60, a: 0.5 }, endValue: { r: 180, g: 160, b: 140, a: 0.25 } });
      const expected = plain(original);
      api.copySelectedTweenClip(); original.initialValue.r = 99; original.endValue.a = 0.9;
      api.currentTime.value = 2; const first = api.pasteTweenClipAtPlayhead();
      assert.deepEqual(plain(first.initialValue), expected.initialValue);
      assert.deepEqual(plain(first.endValue), expected.endValue);
      first.initialValue.g = 77; first.endValue.b = 88;
      api.currentTime.value = 4; const second = api.pasteTweenClipAtPlayhead();
      assert.deepEqual(plain(second.initialValue), expected.initialValue);
      assert.deepEqual(plain(second.endValue), expected.endValue);
      assert.notEqual(first.initialValue, second.initialValue);
      assert.notEqual(first.endValue, second.endValue);
      assert.notEqual(second.initialValue, api.tweenClipClipboard.value.initialValue);
    });
    await test("Repeated paste keeps the original snapshot and creates unique Clip IDs", () => {
      const { api, original } = selectedFixture();
      api.copySelectedTweenClip(); const snapshot = plain(api.tweenClipClipboard.value);
      for (const time of [2, 4, 6]) { api.currentTime.value = time; assert.ok(api.pasteTweenClipAtPlayhead()); }
      assert.equal(api.tweenTracks.value.length, 4);
      assert.equal(new Set(api.tweenTracks.value.map((value) => value.id)).size, 4);
      assert.deepEqual(plain(api.tweenClipClipboard.value), snapshot);
      assert.equal(original.startTime, 0);
      assertRefused(api, 6);
    });
    await test("Occupied time and partial overlap are rejected without moving or cropping the paste", () => {
      const { api } = selectedFixture({ duration: 2 });
      api.tweenTracks.value.push(clip({ startTime: 3, duration: 1 }));
      api.copySelectedTweenClip();
      for (const time of [0, 0.5, 2, 3, 3.5]) assertRefused(api, time);
    });
    await test("Touching both neighbors is allowed when the full copied Clip exactly fits the gap", () => {
      const { api } = selectedFixture();
      api.tweenTracks.value.push(clip({ startTime: 2 }));
      api.copySelectedTweenClip(); api.currentTime.value = 1;
      const pasted = api.pasteTweenClipAtPlayhead();
      assert.ok(pasted); assert.equal(pasted.startTime, 1); assert.equal(pasted.duration, 1);
    });
    await test("Sequence end accepts an exact fit but rejects overflow and the endpoint itself", () => {
      const { api } = selectedFixture({ duration: 1.25 });
      api.copySelectedTweenClip(); assertRefused(api, 9); assertRefused(api, 10);
      api.currentTime.value = 8.75;
      const pasted = api.pasteTweenClipAtPlayhead();
      assert.ok(pasted); assert.equal(pasted.duration, 1.25); assert.equal(pasted.startTime + pasted.duration, 10);
    });
    await test("Six-decimal playhead precision preserves a touching edge without false overlap", () => {
      const { api } = selectedFixture({ duration: 0.25 });
      api.tweenTracks.value.push(clip({ startTime: 1, duration: 1.123456 }));
      api.copySelectedTweenClip(); api.currentTime.value = 2.123456;
      const pasted = api.pasteTweenClipAtPlayhead();
      assert.ok(pasted); assert.equal(pasted.startTime, 2.123456); assert.equal(pasted.duration, 0.25);
      assert.equal(api.currentTime.value, 2.123456);
    });
    await test("Other fields and nodes can occupy the same time without blocking paste", () => {
      const { api } = selectedFixture();
      api.tweenTracks.value.push(clip({ fieldKey: "anchoredPositionY", startTime: 2 }), clip({ nodeId: "image", startTime: 2 }));
      api.copySelectedTweenClip(); api.currentTime.value = 2;
      assert.ok(api.pasteTweenClipAtPlayhead()); assert.equal(api.tweenTracks.value.length, 4);
    });
    await test("Deleted source controls and absent clipboard are rejected safely", () => {
      const { api } = selectedFixture();
      assert.equal(api.pasteTweenClipAtPlayhead(), null);
      assert.equal(api.tweenTracks.value.length, 1);
      api.copySelectedTweenClip(); api.nodes.value = api.nodes.value.filter((node) => node.id !== "group");
      assertRefused(api, 2);
    });
    await test("Copied relative Clips chain from the previous endpoint and survive project JSON", () => {
      const { api } = selectedFixture({ initialValue: 0, endValue: 40, relative: true, easeType: "Linear" });
      api.copySelectedTweenClip(); api.currentTime.value = 2; const pasted = api.pasteTweenClipAtPlayhead();
      assert.ok(pasted); assert.equal(pasted.initialValue, 0); assert.equal(pasted.endValue, 40); assert.equal(pasted.relative, true);
      assert.equal(api.buildTweenPreviewNodes(1)[1].anchorOffsetX, 140);
      assert.equal(api.buildTweenPreviewNodes(3)[1].anchorOffsetX, 180);
      const saved = api.serializeProject();
      api.applyProjectData(saved);
      assert.equal(api.tweenTracks.value.length, 2);
      assert.equal(api.tweenTracks.value[1].relative, true);
      assert.equal(api.buildTweenPreviewNodes(3)[1].anchorOffsetX, 180);
      assert.equal(api.tweenClipClipboard.value, null);
      assert.equal(Object.hasOwn(JSON.parse(saved), "tweenClipClipboard"), false);
    });
    await test("Document switching clears the in-memory clipboard", () => {
      const { api } = selectedFixture();
      api.copySelectedTweenClip(); assert.ok(api.tweenClipClipboard.value);
      api.stopDocumentInteraction(); assert.equal(api.tweenClipClipboard.value, null);
    });
    await test("Ctrl+C and Ctrl+V work from Timeline buttons and consume their browser shortcuts", () => {
      const { api } = selectedFixture();
      const button = new Element("button");
      const copy = shortcut("KeyC", button); api.handleTimelineClipClipboardShortcut(copy);
      assert.ok(api.tweenClipClipboard.value); assert.equal(copy.prevented, true); assert.equal(copy.stopped, true);
      api.currentTime.value = 2;
      const paste = shortcut("KeyV", button); api.handleTimelineClipClipboardShortcut(paste);
      assert.equal(api.tweenTracks.value.length, 2); assert.equal(paste.prevented, true); assert.equal(paste.stopped, true);
    });
    await test("Meta+C and Meta+V also work without Ctrl", () => {
      const { api, root } = selectedFixture();
      api.handleTimelineClipClipboardShortcut(shortcut("KeyC", root, { ctrlKey: false, metaKey: true }));
      api.currentTime.value = 2;
      api.handleTimelineClipClipboardShortcut(shortcut("KeyV", root, { ctrlKey: false, metaKey: true }));
      assert.equal(api.tweenTracks.value.length, 2);
    });
    await test("Key repeat cannot copy or paste repeatedly", () => {
      const { api, root } = selectedFixture();
      api.handleTimelineClipClipboardShortcut(shortcut("KeyC", root, { repeat: true }));
      assert.equal(api.tweenClipClipboard.value, null);
      api.copySelectedTweenClip(); api.currentTime.value = 2;
      api.handleTimelineClipClipboardShortcut(shortcut("KeyV", root, { repeat: true }));
      assert.equal(api.tweenTracks.value.length, 1);
    });
    await test("Copy cannot target a stale Clip selection from a different hierarchy control", () => {
      const { api, root } = selectedFixture(); api.selectedId.value = "image";
      assert.equal(api.copySelectedTweenClip(), null);
      const event = shortcut("KeyC", root); api.handleTimelineClipClipboardShortcut(event);
      assert.equal(event.prevented, false); assert.equal(api.tweenClipClipboard.value, null);
    });
    await test("Dragging or scrubbing cannot paste a Clip while timing is being changed", () => {
      for (const [name, value] of [["draggingTweenTrackId", "clip"], ["timelineScrubbing", true]]) {
        const { api, root } = selectedFixture(); api.copySelectedTweenClip(); api.currentTime.value = 2; api[name].value = value;
        api.handleTimelineClipClipboardShortcut(shortcut("KeyV", root));
        assert.equal(api.tweenTracks.value.length, 1, name);
      }
    });
    await test("Input, readonly numeric input, textarea and editable descendants keep native text copy/paste", () => {
      const { api } = selectedFixture();
      api.copySelectedTweenClip(); api.currentTime.value = 2;
      const targets = [new Element("input"), new Element("input", { type: "number", readOnly: true }),
        new Element("textarea"), new Element("div", { isContentEditable: true }),
        new Element("span", { parentElement: new Element("div", { isContentEditable: true }) }),
        new Element("select"), new Element("div", { role: "textbox" }),
        new Element("button", { parentElement: new Element("div", { role: "dialog" }) })];
      for (const target of targets) for (const code of ["KeyC", "KeyV"]) {
        const event = shortcut(code, target); api.handleTimelineClipClipboardShortcut(event);
        assert.equal(event.prevented, false, `${target.tagName} ${code}`);
      }
      assert.equal(api.tweenTracks.value.length, 1);
    });
    await test("Existing selected text keeps the native clipboard even outside an input", () => {
      const { api, root, selection } = selectedFixture();
      api.copySelectedTweenClip(); api.currentTime.value = 2;
      selection.isCollapsed = false; selection.text = "anchoredPositionX";
      for (const code of ["KeyC", "KeyV"]) {
        const event = shortcut(code, root); api.handleTimelineClipClipboardShortcut(event); assert.equal(event.prevented, false);
      }
      assert.equal(api.tweenTracks.value.length, 1);
    });
    await test("IME, Alt, Shift, unmodified and unrelated key events are left untouched", () => {
      const { api, root } = selectedFixture(); api.copySelectedTweenClip(); api.currentTime.value = 2;
      for (const extras of [{ isComposing: true }, { altKey: true }, { shiftKey: true }, { ctrlKey: false }, { defaultPrevented: true }, { code: "KeyX", key: "x" }]) {
        const event = shortcut("KeyV", root, extras); api.handleTimelineClipClipboardShortcut(event); assert.equal(event.prevented, false);
      }
      assert.equal(api.tweenTracks.value.length, 1);
    });
    await test("Hidden, inert or disconnected editors do not capture copy/paste", () => {
      for (const flags of [{ visible: false }, { inert: true }, { isConnected: false }]) {
        const { api, root } = selectedFixture(); Object.assign(root, flags);
        const event = shortcut("KeyC", root); api.handleTimelineClipClipboardShortcut(event);
        assert.equal(event.prevented, false); assert.equal(api.tweenClipClipboard.value, null);
      }
    });
    await test("Workspace, archive, parameter and context popups block Clip shortcuts", () => {
      for (const [name, value] of [["workspacePanelOpen", true], ["archiveAction", { kind: "createDocument" }],
        ["tweenFieldPickerNodeId", "group"], ["timelineContextMenu", { trackId: "clip" }], ["timelineDataImportOpen", true]]) {
        const { api, root } = selectedFixture(); api[name].value = value;
        const event = shortcut("KeyC", root); api.handleTimelineClipClipboardShortcut(event);
        assert.equal(event.prevented, false, name); assert.equal(api.tweenClipClipboard.value, null, name);
      }
    });
    await test("Clipboard key handler is registered and cleaned up in capture phase", () => {
      assert.match(source, /window\.addEventListener\("keydown",\s*handleTimelineClipClipboardShortcut,\s*true\)/);
      assert.match(source, /window\.removeEventListener\("keydown",\s*handleTimelineClipClipboardShortcut,\s*true\)/);
    });
  } finally {
    Module._load = originalLoad;
    if (originalTsExtension) Module._extensions[".ts"] = originalTsExtension;
    else delete Module._extensions[".ts"];
  }
  console.log(`\n${passed} client UI Clip clipboard checks passed; ${failures.length} failed.`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
