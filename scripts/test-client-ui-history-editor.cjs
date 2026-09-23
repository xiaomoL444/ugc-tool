/* Run: node scripts/test-client-ui-history-editor.cjs
 * Exercises the real Vue setup, deferred snapshot watches, layout, Clip handlers
 * and Data import. Only browser lifecycle, DOM and archive injection are replaced.
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
  const parsed = parse(fs.readFileSync(filename, "utf8"), { filename });
  assert.deepEqual(parsed.errors, []);
  const ast = ts.createSourceFile(filename + ".ts", parsed.descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = ast.statements.filter((statement) => ts.isFunctionDeclaration(statement) ||
    (ts.isVariableStatement(statement) && !statement.declarationList.declarations.some((declaration) =>
      declaration.initializer && ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(ast) === "defineComponent")),
  ).map((statement) => statement.getText(ast)).join("\n");
  const historyWatch = ast.statements.filter((statement) => ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === "watch" &&
    statement.expression.arguments[0]?.getText(ast) === "observeUndoSnapshot").map((statement) => statement.getText(ast));
  assert.equal(historyWatch.length, 1, "The fixture must execute the editor's actual undo observer");
  const saveWatch = ast.statements.filter((statement) => ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === "watch" &&
    statement.expression.arguments[0]?.getText(ast) === "observeProjectSnapshot").map((statement) => statement.getText(ast));
  assert.equal(saveWatch.length, 1, "The fixture must execute the editor's actual save observer");
  const documentWatch = ast.statements.filter((statement) => ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === "watch" &&
    statement.expression.arguments[1]?.getText(ast) === "syncEditorHistoryDocument").map((statement) => statement.getText(ast));
  assert.equal(documentWatch.length, 1, "The fixture must execute the real settled-document history boundary observer");
  const exposed = [
    "nodes", "duration", "frameRate", "currentTime", "playing", "selectedId", "tweenTracks", "selectedTweenTrackId",
    "keyframeTracks", "buildKeyframePreviewNodes",
    "zoom", "panX", "panY", "projectName", "deviceMode", "previewPresetId", "canvasWidth", "canvasHeight",
    "showContainerBones", "timelineSnapEnabled", "giaImportStatus", "editorElement", "timelineContent",
    "primitiveResources", "handleArchiveBeforeUnload",
    "makeNode", "getHierarchyOrder", "applyNodeLayout", "captureUndoState", "restoreUndoState", "editorHistory",
    "undoEditorOperation", "redoEditorOperation", "handleEditorHistoryKeyboard", "handleEditorHistoryChange",
    "beginEditorHistoryPointer", "endEditorHistoryPointer", "beginEditorHistoryInput", "endEditorHistoryInput", "finishEditorHistoryInteraction",
    "syncEditorHistoryDocument", "applyProjectData", "serializeProject", "loadProject", "createBlankProject",
    "addNode", "removeSelected", "startMove", "startResize", "updateGeometry", "updatePivot", "updateAnchor",
    "addTweenClip", "removeTweenTrack", "removeTweenLane", "updateTweenTiming", "updateTweenNumberValue", "updateTweenColorValue",
    "startTweenClipDrag", "startTweenEdgeDrag", "timelineRows", "buildTweenPreviewNodes",
    "copySelectedTweenClip", "pasteTweenClipAtPlayhead", "tweenClipClipboard",
    "openTimelineDataImport", "confirmTimelineDataImport", "timelineDataImportOpen", "timelineDataSource", "timelineDataImportMode",
    "timelineContextMenu", "workspacePanelOpen", "archiveAction", "luaExportMenuOpen", "tweenFieldPickerNodeId", "timelineEditNotice",
  ];
  const script = ts.transpileModule(`${declarations}\n${historyWatch.join("\n")}\n${saveWatch.join("\n")}\n${documentWatch.join("\n")}\nglobalThis.editorApi = { ${exposed.join(", ")} };`, {
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
    fileName: sourcePath, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, sourcePath);
  const plain = (value) => JSON.parse(JSON.stringify(value));
  // Let fire-and-forget keyboard handlers finish the shared UndoManager promise
  // chain before checking notifications emitted after the completed restore.
  const tick = async () => { await vue.nextTick(); await new Promise((resolve) => setImmediate(resolve)); };
  const entries = (api) => vue.unref(api.editorHistory.entries).length;
  const value = (api) => JSON.parse(api.captureUndoState());
  let nextClip = 0;
  const clip = (fieldKey, startTime, initialValue, endValue, extras = {}) => ({ id: `history-clip-${++nextClip}`, nodeId: "group", fieldKey,
    startTime, duration: 1, initialValue, endValue, easeType: "Linear", ...extras });
  const fixtures = [];
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
        Object.assign(this, { tagName: tag.toUpperCase(), type: "text", readOnly: false, disabled: false, isConnected: true,
          inert: false, parentElement: null, dataset: {}, style: {}, classList: { contains: () => false } }, extras);
      }
      get isContentEditable() { return this.editable ?? this.parentElement?.isContentEditable ?? false; }
      set isContentEditable(value) { this.editable = value; }
      getClientRects() { return this.visible === false ? [] : [{}]; }
      contains(target) { return target === this || Boolean(target && this.contains(target.parentElement)); }
      matches(selector) {
        return selector.split(",").some((raw) => {
          const part = raw.trim().replaceAll("'", '"');
          if (part === this.tagName.toLowerCase()) return true;
          if (/^(input|textarea)\[readonly\]$/.test(part)) return part.startsWith(this.tagName.toLowerCase()) && this.readOnly;
          const type = part.match(/^input\[type="([^"]+)"\]$/)?.[1];
          return Boolean(type && this.tagName === "INPUT" && type === this.type);
        });
      }
      closest(selector) {
        const matches = selector.split(",").some((raw) => {
          const part = raw.trim().replaceAll("'", '"');
          return part === this.tagName.toLowerCase() || (part.startsWith("[contenteditable") && this.isContentEditable) ||
            (part === '[role="textbox"]' && this.role === "textbox") || (part === '[role="dialog"]' && this.role === "dialog") ||
            (part === "[inert]" && this.inert) || (part.startsWith(".") && this.classList.contains(part.slice(1)));
        });
        return matches ? this : this.parentElement?.closest(selector) || null;
      }
      getAttribute(name) { return name === "role" ? this.role ?? null : null; }
      blur() { this.blurred = true; }
      focus() { this.focused = true; }
    }
    function fixture({ archived = false } = {}) {
      let serializationCount = 0;
      const listeners = new Map();
      const alerts = [];
      const toastMessages = [];
      const root = new Element();
      const archiveMock = archived ? {
        ready: vue.ref(true), busy: vue.ref(false), loading: vue.ref(false), dirty: vue.ref(false),
        selectedWorkspace: vue.ref("Workspace A"), selectedDocument: vue.ref("Document A"),
        snapshots: [], queueSave(snapshot) { this.snapshots.push(snapshot); },
      } : null;
      const document = { activeElement: root, body: new Element("body"), querySelector: () => null,
        createElement: () => ({ click() {} }), getSelection: () => ({ isCollapsed: true, toString: () => "" }),
        addEventListener() {}, removeEventListener() {} };
      const context = vm.createContext({ ...vue, ...imports, inject: () => archived ? {} : null,
        JSON: { parse: JSON.parse, stringify(value, ...args) { if (value?.nodes && value?.primitiveResources) serializationCount++; return JSON.stringify(value, ...args); } },
        toast: { info(message) { toastMessages.push(message); } },
        useClientUIWorkspace: archived ? () => archiveMock : imports.useClientUIWorkspace,
        nextTick: vue.nextTick, queueMicrotask, setTimeout, clearTimeout, performance,
        HTMLElement: Element, Element, HTMLInputElement: Element, HTMLTextAreaElement: Element,
        window: { innerWidth: 1200, innerHeight: 900, setTimeout, clearTimeout,
          alert(message) { alerts.push(message); },
          addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
          removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
        }, document,
        Blob: class { constructor(parts) { this.text = parts.join(""); } },
        URL: { createObjectURL() { return "blob:test"; }, revokeObjectURL() {} },
      });
      const scope = vue.effectScope();
      scope.run(() => vm.runInContext(script, context, { filename, timeout: 2000 }));
      const api = context.editorApi;
      api.editorElement.value = root;
      api.nodes.value = [
        api.makeNode("container", "Root", { id: "root", scaleX: 1, scaleY: 1, anchorOffsetX: 0, anchorOffsetY: 0, sizeDeltaX: 1600, sizeDeltaY: 900 }),
        api.makeNode("container", "Group", { id: "group", parentId: "root", scaleX: 2, scaleY: 3, anchorOffsetX: 100, anchorOffsetY: 50, sizeDeltaX: 200, sizeDeltaY: 100 }),
        api.makeNode("image", "Image", { id: "image", parentId: "group", anchorOffsetX: 20, anchorOffsetY: 10, sizeDeltaX: 30, sizeDeltaY: 30 }),
        api.makeNode("text", "Label", { id: "label", parentId: "group", anchorOffsetX: -20, anchorOffsetY: -10, sizeDeltaX: 130, sizeDeltaY: 30 }),
      ];
      api.getHierarchyOrder().forEach(api.applyNodeLayout);
      api.tweenTracks.value = [];
      api.selectedId.value = "group";
      api.duration.value = 10;
      api.zoom.value = 1;
      api.timelineSnapEnabled.value = false;
      api.currentTime.value = 0;
      api.editorHistory.reset(api.captureUndoState());
      if (archived) api.syncEditorHistoryDocument();
      const lane = new Element("div", { clientWidth: 1000, scrollLeft: 0,
        getBoundingClientRect() { return { left: 100, top: 0, bottom: 33, width: 1000, height: 33 }; },
        querySelector() { return null; }, closest(selector) { return selector.split(",").some((part) => part.trim() === ".track-lane") ? this : root.closest(selector); }, contains() { return true; },
        classList: { contains: (name) => name === "track-lane" }, parentElement: root });
      api.timelineContent.value = lane;
      Object.assign(api, { alerts, toastMessages, root, document, lane, archiveMock,
        serializationCount: () => serializationCount,
        dispatch: (type, event) => [...(listeners.get(type) || [])].forEach((callback) => callback(event)),
        dispose() { api.editorHistory.dispose?.(); api.editorHistory.reset(api.captureUndoState()); scope.stop(); },
      });
      fixtures.push(api);
      return api;
    }
    function pointer(api, clientX = 100, extras = {}) {
      return { button: 0, pointerId: 17, clientX, clientY: 20, target: api.lane, currentTarget: api.lane,
        preventDefault() {}, stopPropagation() {}, ...extras };
    }
    async function gesture(api, change) {
      const event = pointer(api);
      api.beginEditorHistoryPointer(event);
      change(event);
      api.endEditorHistoryPointer(event);
      await tick();
      api.editorHistory.flush();
    }
    function keyboard(api, key, extras = {}) {
      return { key, code: key.toLowerCase() === "z" ? "KeyZ" : "KeyY", target: api.root,
        ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, repeat: false, isComposing: false,
        defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; },
        stopPropagation() { this.stopped = true; }, ...extras };
    }
    function selectClip(api, track) { api.selectedId.value = track.nodeId; api.selectedTweenTrackId.value = track.id; }
    function rowFor(api, track) { return api.timelineRows.value.find((row) => row.kind === "tween" && row.tracks.some((item) => item.id === track.id)); }

    await test("History snapshots track document state but ignore playback, view, selection and project naming", async () => {
      const api = fixture();
      const before = api.captureUndoState();
      assert.deepEqual(Object.keys(value(api)).sort(), ["nodes", "controlTemplates", "primitiveResources", "giaSource", "tweenTracks", "animations", "frameRate", "deviceMode", "previewPresetId", "canvasWidth", "canvasHeight", "timelineSnapEnabled", "showContainerBones", "giaImportStatus"].sort());
      const count = entries(api);
      api.currentTime.value = 3.75; api.playing.value = true; api.zoom.value = 0.6;
      api.panX.value = 75; api.panY.value = -40; api.selectedId.value = "image"; api.projectName.value = "Rename only";
      await tick(); api.editorHistory.flush();
      assert.equal(api.captureUndoState(), before);
      assert.equal(entries(api), count);
      assert.equal(vue.unref(api.editorHistory.canUndo), false);
    });
    await test("Adding a control is one undoable operation and redo restores its exact ID and properties", async () => {
      const api = fixture();
      const before = value(api); const count = entries(api);
      await gesture(api, () => api.addNode("text"));
      const added = value(api);
      assert.equal(added.nodes.length, before.nodes.length + 1);
      const newNode = added.nodes.find((node) => !before.nodes.some((old) => old.id === node.id));
      assert.equal(newNode.parentId, "group");
      assert.equal(entries(api), count + 1);
      await api.undoEditorOperation();
      assert.deepEqual(value(api), before);
      assert.ok(api.nodes.value.some((node) => node.id === api.selectedId.value), "Undo cannot leave a deleted control selected");
      await api.redoEditorOperation();
      assert.deepEqual(value(api), added);
      assert.equal(entries(api), count + 1, "Restoring snapshots must not recursively record history");
    });
    await test("Deleting a container and descendants restores all nodes and their Clips in one undo", async () => {
      const api = fixture();
      api.tweenTracks.value = [clip("anchoredPositionX", 0, 100, 150), clip("sizeDeltaY", 2, 30, 90, { nodeId: "image" }),
        clip("fontSize", 0, 20, 28, { nodeId: "label" }), clip("localScaleX", 1, 1, 2, { nodeId: "root" })];
      api.editorHistory.reset(api.captureUndoState());
      const before = value(api); const count = entries(api);
      await gesture(api, () => api.removeSelected());
      const removed = value(api);
      assert.deepEqual(removed.nodes.map((node) => node.id), ["root"]);
      assert.deepEqual(removed.tweenTracks.map((track) => track.nodeId), ["root"]);
      assert.equal(entries(api), count + 1);
      await api.undoEditorOperation(); assert.deepEqual(value(api), before);
      await api.redoEditorOperation(); assert.deepEqual(value(api), removed);
    });
    await test("A multi-move canvas drag remains one history entry across separate reactive move events", async () => {
      const api = fixture(); const before = value(api); const count = entries(api);
      const event = pointer(api);
      api.beginEditorHistoryPointer(event);
      api.startMove(event, api.nodes.value.find((node) => node.id === "group"));
      for (const x of [120, 135, 160, 210]) {
        api.dispatch("pointermove", pointer(api, x));
        await tick();
        assert.equal(entries(api), count, "Pointer capture must keep the transaction open across move events");
      }
      api.dispatch("pointerup", pointer(api, 210));
      api.endEditorHistoryPointer(pointer(api, 210));
      await tick(); api.editorHistory.flush();
      const dragged = value(api);
      assert.notDeepEqual(dragged.nodes, before.nodes);
      assert.equal(entries(api), count + 1);
      await api.undoEditorOperation(); assert.deepEqual(value(api), before);
      await api.redoEditorOperation(); assert.deepEqual(value(api), dragged);
    });
    await test("Image-only dragging never serializes heavy resources between pointerdown and pointerup", async () => {
      const api = fixture({ archived: true });
      const fit = { version: 1, width: 200, height: 100, elements: Array.from({ length: 400 }, () => ({ type: 'ellipse', imageId: 100002, x: 1, y: 2, width: 8, height: 9, rotation: 0, color: { r: 255, g: 128, b: 0, a: 1 } })) };
      api.primitiveResources.value = [{ id: 'heavy', name: 'image', imageUrl: 'data:image/png;base64,' + 'A'.repeat(1024 * 1024), fitData: fit }];
      const image = api.nodes.value.find(node => node.id === 'image');
      image.type = 'primitive'; image.properties = { imageResourceId: 'heavy', imageUrl: '', previewMode: 'image' };
      await tick();
      api.editorHistory.reset(api.captureUndoState());
      const before = value(api), resourceBefore = JSON.stringify(api.primitiveResources.value);
      const event = pointer(api);
      api.beginEditorHistoryPointer(event); api.startMove(event, image); await tick();
      const captures = api.serializationCount(), saves = api.archiveMock.snapshots.length;
      const started = performance.now();
      for (let frame = 1; frame <= 60; frame++) {
        api.dispatch('pointermove', pointer(api, 100 + frame)); await tick();
      }
      const elapsed = performance.now() - started;
      assert.equal(api.serializationCount(), captures, 'no full JSON snapshots during 60 reactive drag frames');
      assert.equal(api.archiveMock.snapshots.length, saves, 'no repeated save scheduling while dragging');
      assert.equal(JSON.stringify(api.primitiveResources.value), resourceBefore, 'drag must not translate or mutate fitted elements');
      api.dispatch('pointerup', pointer(api, 160)); api.endEditorHistoryPointer(pointer(api, 160)); await tick();
      const after = value(api);
      assert.notDeepEqual(after.nodes, before.nodes);
      assert.equal(entries(api), 1);
      assert.equal(api.archiveMock.snapshots.length, saves + 1, 'one latest project snapshot after release');
      const saved = JSON.parse(api.archiveMock.snapshots.at(-1));
      assert.deepEqual(saved.nodes, after.nodes); assert.deepEqual(saved.primitiveResources, after.primitiveResources);
      await api.undoEditorOperation(); assert.deepEqual(value(api), before);
      await api.redoEditorOperation(); assert.deepEqual(value(api), after);
      console.log(`INFO 60 synthetic drag frames: ${elapsed.toFixed(1)} ms; 0 document serializations during movement`);
    });
    await test("Closing during a deferred drag captures the latest state before checking unsaved changes", async () => {
      const api = fixture({ archived: true }); await tick();
      const originalQueueSave = api.archiveMock.queueSave;
      api.archiveMock.queueSave = function(snapshot) { originalQueueSave.call(this, snapshot); this.dirty.value = true; };
      api.archiveMock.dirty.value = false;
      const event = pointer(api);
      api.beginEditorHistoryPointer(event);
      api.startMove(event, api.nodes.value.find(node => node.id === 'group'));
      api.dispatch('pointermove', pointer(api, 180)); await tick();
      assert.equal(api.archiveMock.dirty.value, false, 'snapshot is still deferred');
      const closing = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } };
      api.handleArchiveBeforeUnload(closing);
      assert.equal(closing.prevented, true);
      assert.equal(closing.returnValue, '');
      assert.equal(api.editorHistory.interacting.value, false);
      assert.deepEqual(JSON.parse(api.archiveMock.snapshots.at(-1)).nodes, value(api).nodes);
      api.dispatch('pointerup', pointer(api, 180)); await tick();
    });
    await test("Canvas move and resize end on blur or pointercancel, ignore other pointers, and cannot leak later moves into history", async () => {
      for (const drag of ["startMove", "startResize"]) for (const ending of ["blur", "pointercancel"]) {
        const api = fixture(); const before = value(api); const count = entries(api);
        const event = pointer(api, 100);
        api.beginEditorHistoryPointer(event);
        api[drag](event, api.nodes.value.find((node) => node.id === "group"));
        api.dispatch("pointermove", pointer(api, 900, { pointerId: 99 }));
        assert.deepEqual(value(api), before, "A separate pointer cannot move or resize the active node");
        api.dispatch("pointercancel", pointer(api, 900, { pointerId: 99 }));
        api.endEditorHistoryPointer(pointer(api, 900, { pointerId: 99 }));
        await tick();
        assert.equal(entries(api), count);
        api.dispatch("pointermove", pointer(api, 140));
        api.dispatch("pointermove", pointer(api, 170));
        const dragged = value(api);
        assert.notDeepEqual(dragged, before, "A separate pointer cancel cannot end the actual drag");
        if (ending === "blur") {
          api.dispatch("blur", {});
          api.finishEditorHistoryInteraction();
        } else {
          api.dispatch("pointercancel", pointer(api, 170));
          api.endEditorHistoryPointer(pointer(api, 170));
        }
        await tick();
        assert.equal(entries(api), count + 1, `${drag}/${ending} must finish exactly one history operation`);
        api.dispatch("pointermove", pointer(api, 900));
        api.dispatch("pointerup", pointer(api, 900));
        await tick();
        assert.deepEqual(value(api), dragged, "A completed drag must remove its remaining move listener");
        assert.equal(entries(api), count + 1);
        await api.undoEditorOperation(); assert.deepEqual(value(api), before);
        await api.redoEditorOperation(); assert.deepEqual(value(api), dragged);
      }
    });
    await test("Text input and color picker sessions each group all intermediate values into one operation", async () => {
      const api = fixture(); api.selectedId.value = "label";
      const before = value(api); const count = entries(api);
      const input = new Element("textarea", { parentElement: api.root });
      api.document.activeElement = input;
      api.beginEditorHistoryInput({ target: input });
      for (const text of ["你", "你好", "你好，千星奇域"]) {
        api.nodes.value.find((node) => node.id === "label").properties.text = text;
        await tick();
        assert.equal(entries(api), count);
      }
      api.endEditorHistoryInput({ target: input, relatedTarget: api.root });
      api.document.activeElement = api.root;
      await tick(); api.editorHistory.flush();
      const textEdited = value(api);
      assert.equal(entries(api), count + 1);
      const colorInput = new Element("input", { type: "color", parentElement: api.root });
      api.beginEditorHistoryInput({ target: colorInput });
      for (const color of [{ r: 10, g: 20, b: 30, a: 0.5 }, { r: 120, g: 160, b: 200, a: 0.75 }]) {
        api.nodes.value.find((node) => node.id === "label").properties.fontColor = color;
      }
      api.endEditorHistoryInput({ target: colorInput, relatedTarget: api.root });
      await tick(); api.editorHistory.flush();
      const colorEdited = value(api);
      assert.equal(entries(api), count + 2);
      await api.undoEditorOperation(); assert.deepEqual(value(api), textEdited);
      await api.undoEditorOperation(); assert.deepEqual(value(api), before);
      await api.redoEditorOperation(); await api.redoEditorOperation(); assert.deepEqual(value(api), colorEdited);
    });
    await test("Readonly numeric scrubbing does not create a lingering input source or merge successive pointer drags", async () => {
      const api = fixture(); const before = value(api); const count = entries(api);
      const input = new Element("input", { type: "number", readOnly: true, parentElement: api.root });
      const outcomes = [];
      for (const width of [240, 280]) {
        const event = pointer(api, 100, { target: input });
        api.beginEditorHistoryPointer(event);
        api.beginEditorHistoryInput({ target: input });
        api.updateGeometry("width", width - 10); await tick();
        api.updateGeometry("width", width); await tick();
        api.endEditorHistoryPointer(event); await tick();
        outcomes.push(value(api));
        assert.equal(entries(api), count + outcomes.length);
      }
      await api.undoEditorOperation(); assert.deepEqual(value(api), outcomes[0]);
      await api.undoEditorOperation(); assert.deepEqual(value(api), before);
    });
    await test("A text-focus transaction closes before a different pointer target starts a canvas drag", async () => {
      const api = fixture(); const before = value(api); const count = entries(api);
      const input = new Element("input", { parentElement: api.root });
      const focusPointer = pointer(api, 100, { target: input });
      api.beginEditorHistoryPointer(focusPointer); api.beginEditorHistoryInput({ target: input });
      api.nodes.value.find((node) => node.id === "group").name = "First name";
      api.endEditorHistoryPointer(focusPointer); await tick();
      assert.equal(entries(api), count, "Pointer-up cannot prematurely commit an input that still has focus");
      api.nodes.value.find((node) => node.id === "group").name = "Final name";
      await tick(); const named = value(api);
      const move = pointer(api, 100);
      api.beginEditorHistoryPointer(move);
      assert.equal(entries(api), count + 1, "A distinct target must commit the preceding input before beginning a new pointer transaction");
      api.endEditorHistoryInput({ target: input, relatedTarget: api.lane });
      api.startMove(move, api.nodes.value.find((node) => node.id === "group"));
      api.dispatch("pointermove", pointer(api, 170)); await tick();
      assert.equal(entries(api), count + 1, "The late blur event cannot terminate the new pointer transaction");
      api.dispatch("pointerup", pointer(api, 170)); api.endEditorHistoryPointer(pointer(api, 170)); await tick();
      assert.equal(entries(api), count + 2);
      await api.undoEditorOperation(); assert.deepEqual(value(api), named);
      await api.undoEditorOperation(); assert.deepEqual(value(api), before);
    });
    await test("Clip creation, timing edits and removal remain independently undoable", async () => {
      const api = fixture(); const baseline = value(api);
      await gesture(api, () => api.addTweenClip(api.nodes.value.find((node) => node.id === "group"), "sizeDeltaX", 0));
      assert.equal(api.tweenTracks.value.length, 1);
      const track = api.tweenTracks.value[0]; selectClip(api, track);
      const created = value(api);
      await gesture(api, () => { api.updateTweenTiming("startTime", 2); api.updateTweenTiming("duration", 1.5); });
      const edited = value(api);
      assert.equal(edited.tweenTracks[0].startTime, 2); assert.equal(edited.tweenTracks[0].duration, 1.5);
      await gesture(api, () => api.removeTweenTrack(track.id));
      assert.equal(api.tweenTracks.value.length, 0);
      await api.undoEditorOperation(); assert.deepEqual(value(api), edited);
      await api.undoEditorOperation(); assert.deepEqual(value(api), created);
      await api.undoEditorOperation(); assert.deepEqual(value(api), baseline);
    });
    await test("Clip body and edge drags save their final timing once and restore exact preceding snapshots", async () => {
      const api = fixture(); api.tweenTracks.value = [clip("sizeDeltaX", 2, 200, 240)];
      api.editorHistory.reset(api.captureUndoState());
      const before = value(api); const count = entries(api);
      const track = api.tweenTracks.value[0]; selectClip(api, track);
      const event = pointer(api, 300);
      api.beginEditorHistoryPointer(event); api.startTweenClipDrag(event, rowFor(api, track));
      api.dispatch("pointermove", pointer(api, 350)); api.dispatch("pointermove", pointer(api, 400));
      api.dispatch("pointerup", pointer(api, 400)); api.endEditorHistoryPointer(pointer(api, 400));
      await tick(); api.editorHistory.flush();
      const moved = value(api);
      assert.equal(moved.tweenTracks[0].startTime, 3);
      assert.equal(entries(api), count + 1);
      const edge = pointer(api, 500);
      api.beginEditorHistoryPointer(edge); api.startTweenEdgeDrag(edge, rowFor(api, track), "end");
      api.dispatch("pointermove", pointer(api, 530)); api.dispatch("pointermove", pointer(api, 550));
      api.dispatch("pointerup", pointer(api, 550)); api.endEditorHistoryPointer(pointer(api, 550));
      await tick(); api.editorHistory.flush();
      assert.equal(api.tweenTracks.value[0].duration, 1.5);
      assert.equal(entries(api), count + 2);
      await api.undoEditorOperation(); assert.deepEqual(value(api), moved);
      await api.undoEditorOperation(); assert.deepEqual(value(api), before);
    });
    await test("Data replacement imports multiple Clips as one action and undo restores the previous subtree animation", async () => {
      const api = fixture();
      api.keyframeTracks.value = imports.migrateTweenClipsToKeyframes([clip("anchoredPositionX", 0, 100, 140), clip("sizeDeltaY", 1, 30, 60, { nodeId: "image" })]);
      api.editorHistory.reset(api.captureUndoState()); const before = value(api); const count = entries(api);
      api.openTimelineDataImport(); api.timelineDataImportMode.value = "replace";
      api.timelineDataSource.value = 'return {schema="ClientUIAnimationEditor.TweenTimeline@7",duration=5,tracks={{"","sizeDeltaX",0,1,"Linear",0,40,true},{"","sizeDeltaX",2,1,"OutQuad",0,-90,true}}}';
      api.editorHistory.flush(); assert.equal(entries(api), count, "The import dialog and source draft are not document history");
      await gesture(api, () => api.confirmTimelineDataImport());
      const imported = value(api);
      assert.equal(imported.animations[0].keyframeTracks.length, 1);
      assert.equal(imported.animations[0].keyframeTracks[0].fieldKey, "sizeDeltaX");
      assert.deepEqual(imported.animations[0].keyframeTracks[0].keyframes.map(key => [key.time, key.value, key.relative]), [[0, 0, true], [1, 40, true], [2, 0, true], [3, -90, true]]);
      assert.equal(entries(api), count + 1);
      await api.undoEditorOperation(); assert.deepEqual(value(api), before);
      await api.redoEditorOperation(); assert.deepEqual(value(api), imported);
    });
    await test("Undo and redo do not recursively record, and a new edit discards only the redo branch", async () => {
      const api = fixture(); const baseline = value(api); const count = entries(api);
      await gesture(api, () => api.updateGeometry("width", 240)); const first = value(api);
      await gesture(api, () => api.updateGeometry("height", 150)); const second = value(api);
      for (let repeat = 0; repeat < 3; repeat += 1) {
        await api.undoEditorOperation(); assert.deepEqual(value(api), first);
        await api.undoEditorOperation(); assert.deepEqual(value(api), baseline);
        await api.redoEditorOperation(); assert.deepEqual(value(api), first);
        await api.redoEditorOperation(); assert.deepEqual(value(api), second);
        await tick(); api.editorHistory.flush(); assert.equal(entries(api), count + 2);
      }
      await api.undoEditorOperation();
      await gesture(api, () => api.updateGeometry("width", 280));
      assert.equal(vue.unref(api.editorHistory.canRedo), false);
      await api.undoEditorOperation(); assert.deepEqual(value(api), first);
      await api.undoEditorOperation(); assert.deepEqual(value(api), baseline);
    });
    await test("Loading another standalone document resets history and cannot undo into the previous document", async () => {
      const api = fixture(); await gesture(api, () => api.addNode("image"));
      assert.equal(vue.unref(api.editorHistory.canUndo), true);
      api.applyProjectData(api.createBlankProject("Another document"));
      await tick(); api.editorHistory.flush(); const loaded = value(api);
      assert.equal(vue.unref(api.editorHistory.canUndo), false);
      assert.equal(vue.unref(api.editorHistory.canRedo), false);
      await api.undoEditorOperation(); assert.deepEqual(value(api), loaded);
    });
    await test("A failed overlapping-Clip file import rolls back document changes while preserving prior undo and redo commands", async () => {
      const api = fixture();
      const invalidClips = [clip("sizeDeltaX", 0, 200, 240), clip("sizeDeltaX", 2, 240, 280)];
      api.keyframeTracks.value = imports.migrateTweenClipsToKeyframes(invalidClips);
      api.editorHistory.reset(api.captureUndoState()); const before = value(api);
      await gesture(api, () => api.updateGeometry("width", 260)); const edited = value(api);
      const historyBefore = plain(vue.unref(api.editorHistory.entries));
      const invalid = JSON.parse(api.serializeProject());
      invalid.name = "Must not replace this document";
      invalid.nodes.find((node) => node.id === "group").name = "Invalid imported group";
      delete invalid.keyframeTracks; delete invalid.animations;
      invalid.tweenTracks = invalidClips;
      invalid.tweenTracks[1].startTime = 0.5;
      await api.loadProject({ target: { files: [{ name: "overlap.json", text: async () => JSON.stringify(invalid) }] } });
      await tick();
      assert.equal(api.alerts.length, 1); assert.match(api.alerts[0], /保留|重叠|交叉/);
      assert.deepEqual(value(api), edited);
      assert.deepEqual(plain(vue.unref(api.editorHistory.entries)), historyBefore);
      assert.equal(vue.unref(api.editorHistory.canUndo), true);
      await api.undoEditorOperation(); assert.deepEqual(value(api), before);
      await api.redoEditorOperation(); assert.deepEqual(value(api), edited);
    });
    await test("Workspace history survives same-file saves, ignores in-flight staging, and resets only on a settled new document key", async () => {
      const api = fixture({ archived: true }); const archive = api.archiveMock;
      await gesture(api, () => api.updateGeometry("width", 240));
      const initialHistory = plain(vue.unref(api.editorHistory.entries));
      assert.equal(initialHistory.length, 1);
      archive.busy.value = true; await tick(); archive.busy.value = false; await tick();
      assert.deepEqual(plain(vue.unref(api.editorHistory.entries)), initialHistory, "Same-key save completion must not reset history");
      archive.busy.value = true; archive.loading.value = true;
      api.applyProjectData(api.createBlankProject("Document B"));
      archive.selectedDocument.value = "Document B";
      await tick();
      assert.deepEqual(plain(vue.unref(api.editorHistory.entries)), initialHistory, "Loading and key changes cannot reset before the new file is settled");
      archive.busy.value = false; await tick();
      assert.deepEqual(plain(vue.unref(api.editorHistory.entries)), initialHistory, "Loading is an independent boundary guard");
      archive.ready.value = false; archive.loading.value = false; await tick();
      assert.deepEqual(plain(vue.unref(api.editorHistory.entries)), initialHistory, "Initialization is an independent boundary guard");
      archive.ready.value = true; await tick();
      const loaded = value(api);
      assert.equal(entries(api), 0); assert.equal(vue.unref(api.editorHistory.canUndo), false); assert.equal(vue.unref(api.editorHistory.canRedo), false);
      await api.undoEditorOperation(); assert.deepEqual(value(api), loaded);
      await gesture(api, () => api.addNode("image"));
      const afterNewEdit = value(api);
      archive.busy.value = true; archive.busy.value = false; await tick();
      assert.equal(entries(api), 1, "Subsequent saves in the new document keep its new history");
      await api.undoEditorOperation(); assert.deepEqual(value(api), loaded);
      assert.deepEqual(JSON.parse(archive.snapshots.at(-1)).nodes, loaded.nodes, "Undo must enqueue the restored document, not an intermediate snapshot");
      await api.redoEditorOperation(); assert.deepEqual(value(api), afterNewEdit);
    });
    await test("Ctrl/Meta undo and redo shortcuts act on the editor and consume their browser defaults", async () => {
      for (const modifiers of [{ ctrlKey: true, metaKey: false }, { ctrlKey: false, metaKey: true }]) {
        const api = fixture(); const before = value(api);
        await gesture(api, () => api.updateGeometry("width", 240)); const after = value(api);
        const label = vue.unref(api.editorHistory.entries)[0].label;
        const undo = keyboard(api, "z", modifiers); api.handleEditorHistoryKeyboard(undo); await tick();
        assert.equal(undo.defaultPrevented, true); assert.equal(undo.stopped, true); assert.deepEqual(value(api), before);
        assert.deepEqual(api.toastMessages, [`撤回:【${label}】还可撤回0步`]);
        const redo = keyboard(api, "z", { ...modifiers, shiftKey: true }); api.handleEditorHistoryKeyboard(redo); await tick();
        assert.equal(redo.defaultPrevented, true); assert.deepEqual(value(api), after);
        assert.deepEqual(api.toastMessages, [`撤回:【${label}】还可撤回0步`, `重做【${label}】还可重做0步`]);
      }
    });
    await test("Toolbar undo and redo report the completed action label and the remaining step count exactly once", async () => {
      const api = fixture();
      await gesture(api, () => api.updateGeometry("width", 240));
      await gesture(api, () => { api.nodes.value.find((node) => node.id === "group").name = "Toast label"; });
      const [first, second] = plain(vue.unref(api.editorHistory.entries));
      assert.equal(api.toastMessages.length, 0, "Editing cannot emit a successful undo notification");
      await api.undoEditorOperation();
      assert.deepEqual(api.toastMessages, [`撤回:【${second.label}】还可撤回1步`]);
      await api.undoEditorOperation();
      assert.equal(api.toastMessages.at(-1), `撤回:【${first.label}】还可撤回0步`);
      await api.undoEditorOperation();
      assert.equal(api.toastMessages.length, 2, "Exhausted undo cannot report another successful action");
      await api.redoEditorOperation();
      assert.equal(api.toastMessages.at(-1), `重做【${first.label}】还可重做1步`);
      await api.redoEditorOperation();
      assert.equal(api.toastMessages.at(-1), `重做【${second.label}】还可重做0步`);
      await api.redoEditorOperation();
      assert.equal(api.toastMessages.length, 4, "Exhausted redo cannot report another successful action");
      const template = parsed.descriptor.template.content;
      assert.match(template, /<button\b[^>]*aria-label="撤销"[^>]*@click\.stop="undoEditorOperation"/);
      assert.match(template, /<button\b[^>]*aria-label="重做"[^>]*@click\.stop="redoEditorOperation"/);
    });
    await test("Undo commits an active input session first, then reports the actual committed action", async () => {
      const api = fixture(); const before = value(api);
      const input = new Element("input", { parentElement: api.root });
      api.beginEditorHistoryInput({ target: input });
      api.nodes.value.find((node) => node.id === "group").name = "Uncommitted input";
      await tick();
      assert.equal(entries(api), 0);
      await api.undoEditorOperation();
      const entry = vue.unref(api.editorHistory.entries)[0];
      assert.ok(entry);
      assert.deepEqual(value(api), before);
      assert.deepEqual(api.toastMessages, [`撤回:【${entry.label}】还可撤回0步`]);
    });
    await test("Empty history and guarded busy, modal or pointer interactions never emit a success toast", async () => {
      const empty = fixture();
      await empty.undoEditorOperation(); await empty.redoEditorOperation();
      empty.handleEditorHistoryKeyboard(keyboard(empty, "z")); await tick();
      empty.handleEditorHistoryKeyboard(keyboard(empty, "z", { shiftKey: true })); await tick();
      assert.deepEqual(empty.toastMessages, []);
      for (const action of ["undoEditorOperation", "redoEditorOperation"]) for (const blocker of ["historyBusy", "archiveBusy", "workspace", "dataDialog", "pointer"]) {
        const api = fixture({ archived: blocker === "archiveBusy" });
        await gesture(api, () => api.updateGeometry("width", 240));
        if (action === "redoEditorOperation") await api.undoEditorOperation();
        api.toastMessages.length = 0;
        const before = value(api); const index = vue.unref(api.editorHistory.index);
        if (blocker === "historyBusy") api.editorHistory.busy.value = true;
        else if (blocker === "archiveBusy") api.archiveMock.busy.value = true;
        else if (blocker === "workspace") api.workspacePanelOpen.value = true;
        else if (blocker === "dataDialog") api.timelineDataImportOpen.value = true;
        else api.beginEditorHistoryPointer(pointer(api));
        await api[action](); await tick();
        assert.deepEqual(api.toastMessages, [], `${action}/${blocker} must not announce an action it never completed`);
        assert.deepEqual(value(api), before);
        assert.equal(vue.unref(api.editorHistory.index), index);
        if (blocker === "historyBusy") api.editorHistory.busy.value = false;
        if (blocker === "pointer") { api.endEditorHistoryPointer(pointer(api)); await tick(); }
      }
    });
    await test("Failed undo and redo preserve their existing inline error notice without emitting success toasts", async () => {
      for (const [handler, method, message] of [["undoEditorOperation", "undo", "撤销失败"], ["redoEditorOperation", "redo", "重做失败"]]) {
        const api = fixture();
        await gesture(api, () => api.updateGeometry("width", 240));
        if (method === "redo") await api.undoEditorOperation();
        api.toastMessages.length = 0;
        const original = api.editorHistory[method];
        api.editorHistory[method] = async () => { throw new Error("Injected restore failure"); };
        try {
          await api[handler]();
          assert.deepEqual(api.toastMessages, []);
          assert.ok(api.timelineEditNotice.value.startsWith(message));
          assert.match(api.timelineEditNotice.value, /Injected restore failure/);
        } finally { api.editorHistory[method] = original; }
      }
    });
    await test("Resetting history while an undo or redo is finishing suppresses stale success notifications", async () => {
      for (const handler of ["undoEditorOperation", "redoEditorOperation"]) {
        const api = fixture();
        await gesture(api, () => api.updateGeometry("width", 240));
        if (handler === "redoEditorOperation") await api.undoEditorOperation();
        api.toastMessages.length = 0;
        const operation = api[handler]();
        api.editorHistory.reset(api.captureUndoState());
        await operation; await tick();
        assert.equal(entries(api), 0);
        assert.equal(vue.unref(api.editorHistory.index), -1);
        assert.deepEqual(api.toastMessages, [], "A notification from the old history cannot appear after its document boundary was reset");
      }
    });
    await test("Text editing, unrelated keys, IME and open dialogs retain their native undo behavior", async () => {
      const api = fixture(); await gesture(api, () => api.updateGeometry("width", 240)); const after = value(api);
      const targets = [new Element("input", { parentElement: api.root }), new Element("textarea", { parentElement: api.root }),
        new Element("input", { type: "number", parentElement: api.root }), new Element("div", { editable: true, parentElement: api.root })];
      for (const target of targets) {
        api.document.activeElement = target;
        const event = keyboard(api, "z", { target }); api.handleEditorHistoryKeyboard(event); await tick();
        assert.equal(event.defaultPrevented, false); assert.deepEqual(value(api), after);
      }
      api.document.activeElement = api.root;
      for (const extras of [{ ctrlKey: false }, { altKey: true }, { isComposing: true }, { key: "x", code: "KeyX" }]) {
        const event = keyboard(api, "z", extras); api.handleEditorHistoryKeyboard(event); await tick();
        assert.equal(event.defaultPrevented, false); assert.deepEqual(value(api), after);
      }
      const repeat = keyboard(api, "z", { repeat: true }); api.handleEditorHistoryKeyboard(repeat); await tick();
      assert.equal(repeat.defaultPrevented, true, "Held undo is consumed without repeating the operation");
      assert.deepEqual(value(api), after);
      api.timelineDataImportOpen.value = true;
      const event = keyboard(api, "z"); api.handleEditorHistoryKeyboard(event); await tick();
      assert.equal(event.defaultPrevented, false); assert.deepEqual(value(api), after);
    });
  } finally {
    for (const fixture of fixtures) fixture.dispose();
    Module._load = originalLoad;
    if (originalTsExtension) Module._extensions[".ts"] = originalTsExtension;
    else delete Module._extensions[".ts"];
  }
  console.log(`\n${passed} client UI history editor checks passed; ${failures.length} failed.`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
