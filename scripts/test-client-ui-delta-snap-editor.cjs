/* Run: node scripts/test-client-ui-delta-snap-editor.cjs
 * Exercises real editor setup, Vue refs, preview/layout, project JSON and pointer
 * handlers. Only browser lifecycle and download effects are replaced.
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
  const declarations = ast.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) ||
    (ts.isVariableStatement(statement) && !statement.declarationList.declarations.some((declaration) =>
      declaration.initializer && ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(ast) === "defineComponent")),
  ).map((statement) => statement.getText(ast)).join("\n");
  const exposed = [
    "nodes", "duration", "currentTime", "playing", "selectedId", "tweenTracks", "selectedTweenTrackId",
    "keyframeTracks", "buildKeyframePreviewNodes",
    "makeNode", "getHierarchyOrder", "applyNodeLayout", "buildTweenPreviewNodes", "calculateWorldTransforms",
    "addTweenTrack", "updateTweenRelative", "normalizeTweenTracks", "serializeProject", "loadProject",
    "timelineSnapEnabled", "timelineSnapTime", "toggleTimelineSnapping", "timelineContent",
    "startTweenClipDrag", "startTweenEdgeDrag", "draggingTweenTrackId", "resizingTweenEdge",
    "stopDocumentInteraction", "removeTweenTrack",
  ];
  const script = ts.transpileModule(`${declarations}\nglobalThis.editorApi = { ${exposed.join(", ")} };`, {
    fileName: filename + ".ts",
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const converter = await import("genshin-impact-ugc-file-converter-web");
  const originalLoad = Module._load;
  const originalTsExtension = Module._extensions[".ts"];
  Module._load = function (request, parent, isMain) {
    if (request === "genshin-impact-ugc-file-converter-web") return converter;
    return originalLoad.call(this, request, parent, isMain);
  };
  Module._extensions[".ts"] = (module, sourcePath) => {
    const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
      fileName: sourcePath,
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    });
    module._compile(compiled.outputText, sourcePath);
  };
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message || "Value"}: ${actual} != ${expected}`);
  let passed = 0;
  async function test(name, check) { await check(); passed += 1; console.log(`PASS ${name}`); }
  try {
    const imports = Object.assign({}, ...["controlRegistry", "tweenRegistry", "giaImporter", "luaTweenExporter", "propertyGroupActions", "timelineSnapping", "timelineClipLayout", "containerDirectionGuide", "editorHistory", "historyChangeLabel", "keyframeTimeline", "keyframeLua", "animationCollection"]
      .map((name) => require(path.join(editor, `${name}.ts`))));
    function createEditor() {
      const listeners = new Map();
      const context = vm.createContext({
        ...vue, ...imports,
        inject: () => null,
        nextTick: () => Promise.resolve(),
        window: {
          alert(message) { assert.fail(message); },
          addEventListener(type, callback) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(callback);
          },
          removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
        },
        document: { createElement: () => ({ click() {} }) },
        Blob: class { constructor(parts) { this.text = parts.join(""); } },
        URL: { createObjectURL() { return "blob:test"; }, revokeObjectURL() {} },
      });
      vm.runInContext(script, context, { filename, timeout: 2000 });
      const api = context.editorApi;
      api.dispatch = (type, event) => [...(listeners.get(type) || [])].forEach((callback) => callback(event));
      api.listenerCount = () => [...listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0);
      return api;
    }
    function fixture() {
      const api = createEditor();
      api.nodes.value = [
        api.makeNode("container", "Root", { id: "root", scaleX: 1, scaleY: 1, anchorOffsetX: 0, anchorOffsetY: 0, sizeDeltaX: 1600, sizeDeltaY: 900 }),
        api.makeNode("container", "Group", { id: "group", parentId: "root", scaleX: 2, scaleY: 3, scaleZ: 4, anchorOffsetX: 0, anchorOffsetY: 0, sizeDeltaX: 200, sizeDeltaY: 100 }),
        api.makeNode("image", "Image", { id: "image", parentId: "group", scaleX: 0.5, scaleY: 0.25, anchorOffsetX: 20, anchorOffsetY: 10, sizeDeltaX: 30, sizeDeltaY: 30 }),
      ];
      api.getHierarchyOrder().forEach(api.applyNodeLayout);
      api.tweenTracks.value = [];
      api.selectedId.value = "group";
      return { api, group: api.nodes.value[1], child: api.nodes.value[2] };
    }
    function track(nodeId, fieldKey, initialValue = 0, endValue = 1, extras = {}) {
      return { id: `${nodeId}:${fieldKey}`, nodeId, fieldKey, initialValue, endValue, startTime: 0, duration: 1, easeType: "Linear", ...extras };
    }
    function selectTrack(api, value) {
      api.tweenTracks.value = [value];
      api.selectedId.value = value.nodeId;
      api.selectedTweenTrackId.value = value.id;
      return api.tweenTracks.value[0];
    }
    function pointer(clientX, extras = {}) {
      return { button: 0, pointerId: 17, clientX, preventDefault() {}, stopPropagation() {}, ...extras };
    }
    function dragFixture(other = true) {
      const { api, group } = fixture();
      api.duration.value = 10;
      api.timelineContent.value = { clientWidth: 1000 };
      api.tweenTracks.value = [track("group", "localScaleX", 2, 3, { startTime: 1, duration: 1 })];
      if (other) api.tweenTracks.value.push(track("image", "localScaleX", 0.5, 1, { startTime: 5, duration: 2 }));
      const dragged = api.tweenTracks.value[0];
      const row = { key: dragged.id, kind: "tween", node: group, track: dragged, field: imports.getTweenableField(group.type, dragged.fieldKey) };
      return { api, dragged, row };
    }
    await test("Scale mode conversion preserves visual endpoints and does not accumulate on repeated toggles", () => {
      const { api, group } = fixture();
      const value = selectTrack(api, track("group", "localScaleX", 2, 2.5));
      const originalNodes = plain(api.nodes.value);
      const before = plain(api.buildTweenPreviewNodes(0.5));
      for (let repeat = 0; repeat < 3; repeat += 1) {
        api.updateTweenRelative(true);
        assert.equal(value.relative, true);
        assert.equal(value.initialValue, 0);
        assert.equal(value.endValue, 0.5);
        assert.deepEqual(plain(api.buildTweenPreviewNodes(0.5)), before);
        api.updateTweenRelative(true);
        assert.equal(value.endValue, 0.5, "Enabling an already enabled mode must be idempotent");
        api.updateTweenRelative(false);
        assert.notEqual(value.relative, true);
        assert.equal(value.initialValue, 2);
        assert.equal(value.endValue, 2.5);
      }
      assert.equal(group.scaleX, 2);
      assert.deepEqual(plain(api.nodes.value), originalNodes);
    });
    await test("Relative X/Y/Z scales use additive deltas and remain stable while scrubbing back and forth", () => {
      const { api } = fixture();
      api.tweenTracks.value = [
        track("group", "localScaleX", 0, 0.5, { relative: true }),
        track("group", "localScaleY", -1, 0, { relative: true }),
        track("group", "localScaleZ", -4, 2, { relative: true }),
      ];
      const original = plain(api.nodes.value);
      for (const time of [0, 0.5, 1, 0.25, 1, 0.5, 0]) {
        const preview = api.buildTweenPreviewNodes(time).find((node) => node.id === "group");
        near(preview.scaleX, 2 + 0.5 * time);
        near(preview.scaleY, 2 + time);
        near(preview.scaleZ, 6 * time);
      }
      assert.deepEqual(plain(api.nodes.value), original, "Preview must never rewrite the base scale");
    });
    await test("Relative scaling applies each easing curve against the unanimated base", () => {
      const { api } = fixture();
      for (const { value: easeType } of imports.tweenEaseOptions) {
        api.tweenTracks.value = [track("group", "localScaleX", -0.5, 0.5, { relative: true, startTime: 1, duration: 2, easeType })];
        for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
          near(api.buildTweenPreviewNodes(1 + 2 * progress)[1].scaleX, 1.5 + imports.applyTweenEase(easeType, progress), `${easeType} at ${progress}`);
        }
      }
    });
    await test("Parent relative scale changes child world position and scale without changing child local size", () => {
      const { api, child } = fixture();
      api.tweenTracks.value = [track("group", "localScaleX", 0, 1, { relative: true }), track("group", "localScaleY", 0, -1, { relative: true })];
      const previews = api.buildTweenPreviewNodes(1);
      const world = api.calculateWorldTransforms(previews);
      const parentWorld = world.get("group");
      const childWorld = world.get("image");
      near(childWorld.x - parentWorld.x, 60);
      near(childWorld.y - parentWorld.y, 20);
      near(childWorld.matrix.a, 1.5);
      near(childWorld.matrix.d, 0.5);
      assert.equal(previews[2].width, child.width);
      assert.equal(previews[2].height, child.height);
      assert.equal(previews[2].scaleX, 0.5);
    });
    await test("Zero and negative base scales work and future base edits are reflected once", () => {
      const { api, group } = fixture();
      group.scaleX = 0;
      group.scaleY = -2;
      api.tweenTracks.value = [track("group", "localScaleX", 0, 0.5, { relative: true }), track("group", "localScaleY", 0, 0.5, { relative: true })];
      assert.equal(api.buildTweenPreviewNodes(1)[1].scaleX, 0.5);
      assert.equal(api.buildTweenPreviewNodes(1)[1].scaleY, -1.5);
      group.scaleX = 3;
      assert.equal(api.buildTweenPreviewNodes(1)[1].scaleX, 3.5);
      assert.equal(group.scaleX, 3);
    });
    await test("Mode conversion preserves empty endpoints instead of converting them to zero", () => {
      const { api } = fixture();
      for (const [from, to] of [[null, 2.5], [2, null], [null, null]]) {
        const value = selectTrack(api, track("group", "localScaleX", from, to));
        api.updateTweenRelative(true);
        assert.equal(value.initialValue, from === null ? null : 0);
        assert.equal(value.endValue, to === null ? null : 0.5);
        api.updateTweenRelative(false);
        assert.equal(value.initialValue, from);
        assert.equal(value.endValue, to);
      }
    });
    await test("Incomplete relative scales never partially animate or overwrite the base", () => {
      const { api } = fixture();
      const original = plain(api.nodes.value);
      for (const [from, to] of [[null, 0.5], [0, null], [null, null]]) {
        api.tweenTracks.value = [track("group", "localScaleX", from, to, { relative: true })];
        for (const time of [0, 0.5, 1]) assert.deepEqual(plain(api.buildTweenPreviewNodes(time)), original);
      }
    });
    await test("Position, size and scale fields accept relative mode; other fields and invalid flags remain absolute", () => {
      const { api } = fixture();
      for (const fieldKey of ["anchorMinY", "localRotationZ", "groupAlpha"]) {
        const value = selectTrack(api, track("group", fieldKey, 0, 1));
        api.updateTweenRelative(true);
        assert.notEqual(value.relative, true, fieldKey);
        const normalized = api.normalizeTweenTracks([{ ...value, relative: true }], 7)[0];
        assert.notEqual(normalized.relative, true, `Import must not enable relative ${fieldKey}`);
      }
      for (const fieldKey of ["anchoredPositionX", "anchoredPositionY", "sizeDeltaX", "sizeDeltaY"]) {
        const value = selectTrack(api, track("group", fieldKey, 0, 40));
        api.updateTweenRelative(true);
        assert.equal(value.relative, true, fieldKey);
        assert.equal(api.normalizeTweenTracks([value], 7)[0].relative, true);
      }
      for (const relative of [undefined, false, "true", 1, null]) {
        const normalized = api.normalizeTweenTracks([track("group", "localScaleX", 2, 2.5, { relative })], 7)[0];
        assert.notEqual(normalized.relative, true);
        assert.equal(normalized.initialValue, 2);
        assert.equal(normalized.endValue, 2.5);
      }
    });
    await test("Missing or invalid relative endpoints default to zero while explicit null remains empty", () => {
      const { api } = fixture();
      for (const from of [undefined, "", "invalid", Number.NaN, Infinity]) {
        const raw = track("group", "localScaleX", 0, 0.5, { relative: true });
        if (from === undefined) delete raw.initialValue;
        else raw.initialValue = from;
        const normalized = api.normalizeTweenTracks([raw], 7)[0];
        assert.equal(normalized.relative, true);
        assert.equal(normalized.initialValue, 0);
        assert.equal(normalized.endValue, 0.5);
      }
      const empty = api.normalizeTweenTracks([track("group", "localScaleX", null, null, { relative: true })], 7)[0];
      assert.equal(empty.initialValue, null);
      assert.equal(empty.endValue, null);
    });
    await test("Project JSON retains raw deltas and mode, with identical preview after save/import", async () => {
      const { api } = fixture();
      api.tweenTracks.value = [track("group", "localScaleX", 0, 0.5, { relative: true }), track("image", "localScaleY", 0.25, 1)];
      const before = plain(api.buildTweenPreviewNodes(0.5));
      const serialized = api.serializeProject();
      const saved = JSON.parse(serialized);
      assert.equal(saved.tweenTracks[0].relative, true);
      assert.equal(saved.tweenTracks[0].initialValue, 0);
      assert.equal(saved.tweenTracks[0].endValue, 0.5);
      delete saved.keyframeTracks; delete saved.animations; // This fixture models a pre-keyframe project.
      await api.loadProject({ target: { files: [{ text: async () => JSON.stringify(saved) }] } });
      assert.equal(api.keyframeTracks.value[0].keyframes[0].relative, true);
      assert.equal(api.keyframeTracks.value[0].keyframes[1].relative, true);
      assert.deepEqual(plain(api.buildKeyframePreviewNodes(0.5)), before);
      assert.equal(JSON.parse(api.serializeProject()).keyframeTracks[0].keyframes[1].value, 0.5);
    });
    await test("Project JSON restores its snap preference and older projects default to enabled", async () => {
      const { api } = fixture();
      api.toggleTimelineSnapping();
      const serialized = api.serializeProject();
      assert.equal(JSON.parse(serialized).timelineSnapEnabled, false);
      api.toggleTimelineSnapping();
      await api.loadProject({ target: { files: [{ text: async () => serialized }] } });
      assert.equal(api.timelineSnapEnabled.value, false);
      const old = JSON.parse(serialized);
      delete old.timelineSnapEnabled;
      await api.loadProject({ target: { files: [{ text: async () => JSON.stringify(old) }] } });
      assert.equal(api.timelineSnapEnabled.value, true);
    });
    await test("Clip body snaps either endpoint to other Clip edges while preserving its duration", () => {
      for (const [deltaPixels, expectedStart] of [[395, 5], [295, 4], [595, 7], [495, 6]]) {
        const { api, dragged, row } = dragFixture();
        assert.equal(api.timelineSnapEnabled.value, true);
        api.startTweenClipDrag(pointer(100), row);
        api.dispatch("pointermove", pointer(100 + deltaPixels));
        assert.equal(dragged.startTime, expectedStart);
        assert.equal(dragged.duration, 1);
        assert.equal(api.timelineSnapTime.value, expectedStart === 4 || expectedStart === 6 ? expectedStart + 1 : expectedStart);
        api.dispatch("pointerup", pointer(100 + deltaPixels));
        assert.equal(api.draggingTweenTrackId.value, null);
        assert.equal(api.timelineSnapTime.value, null);
        assert.equal(api.listenerCount(), 0);
      }
    });
    await test("Start/end resize snap independently and preserve the opposite edge", () => {
      const start = dragFixture();
      start.dragged.startTime = 3;
      start.dragged.duration = 5;
      start.api.startTweenEdgeDrag(pointer(100), start.row, "start");
      start.api.dispatch("pointermove", pointer(295));
      assert.equal(start.dragged.startTime, 5);
      assert.equal(start.dragged.duration, 3);
      assert.equal(start.api.timelineSnapTime.value, 5);
      start.api.dispatch("pointerup", pointer(295));
      const end = dragFixture();
      end.api.startTweenEdgeDrag(pointer(100), end.row, "end");
      end.api.dispatch("pointermove", pointer(395));
      assert.equal(end.dragged.startTime, 1);
      assert.equal(end.dragged.duration, 4);
      assert.equal(end.api.timelineSnapTime.value, 5);
      end.api.dispatch("pointercancel", pointer(395));
      assert.equal(end.api.resizingTweenEdge.value, null);
      assert.equal(end.api.timelineSnapTime.value, null);
      assert.equal(end.api.listenerCount(), 0);
    });
    await test("Playhead and sequence boundaries are snap targets, but a Clip cannot snap to itself", () => {
      const playhead = dragFixture(false);
      playhead.api.currentTime.value = 6.25;
      playhead.api.startTweenClipDrag(pointer(100), playhead.row);
      playhead.api.dispatch("pointermove", pointer(620));
      assert.equal(playhead.dragged.startTime, 6.25);
      assert.equal(playhead.api.timelineSnapTime.value, 6.25);
      playhead.api.dispatch("pointerup", pointer(620));
      for (const [delta, expected] of [[-95, 0], [795, 9], [3, 1.03]]) {
        const { api, row, dragged } = dragFixture(false);
        api.startTweenClipDrag(pointer(100), row);
        api.dispatch("pointermove", pointer(100 + delta));
        assert.equal(dragged.startTime, expected);
        assert.equal(dragged.duration, 1);
        if (delta === 3) assert.equal(api.timelineSnapTime.value, null, "Exclude both original edges of the dragged Clip");
        api.dispatch("pointerup", pointer(100 + delta));
      }
    });
    await test("Snap button can disable attraction during an active drag without changing clip length", () => {
      const { api, dragged, row } = dragFixture();
      api.startTweenClipDrag(pointer(100), row);
      api.dispatch("pointermove", pointer(495));
      assert.equal(dragged.startTime, 5);
      api.toggleTimelineSnapping();
      assert.equal(api.timelineSnapEnabled.value, false);
      assert.equal(api.timelineSnapTime.value, null);
      api.dispatch("pointermove", pointer(495));
      assert.equal(dragged.startTime, 4.95);
      assert.equal(dragged.duration, 1);
      api.toggleTimelineSnapping();
      api.dispatch("pointermove", pointer(495));
      assert.equal(dragged.startTime, 5);
      api.dispatch("pointerup", pointer(495));
    });
    await test("Dragging clamps to sequence bounds, preserves minimum length and ignores other pointer IDs", () => {
      for (const edge of ["start", "end"]) {
        const { api, dragged, row } = dragFixture(false);
        api.toggleTimelineSnapping();
        api.startTweenEdgeDrag(pointer(100), row, edge);
        api.dispatch("pointermove", pointer(150, { pointerId: 99 }));
        assert.equal(dragged.startTime, 1);
        assert.equal(dragged.duration, 1);
        api.dispatch("pointerup", pointer(150, { pointerId: 99 }));
        assert.equal(api.draggingTweenTrackId.value, dragged.id);
        api.dispatch("pointermove", pointer(edge === "start" ? 10000 : -10000));
        assert.equal(dragged.duration, 0.01);
        if (edge === "start") near(dragged.startTime + dragged.duration, 2);
        else assert.equal(dragged.startTime, 1);
        api.dispatch("pointermove", pointer(edge === "start" ? -10000 : 10000));
        if (edge === "start") { assert.equal(dragged.startTime, 0); assert.equal(dragged.duration, 2); }
        else { assert.equal(dragged.startTime, 1); assert.equal(dragged.duration, 9); }
        api.dispatch("pointerup", pointer(100));
        assert.equal(api.listenerCount(), 0);
      }
      const { api, dragged, row } = dragFixture(false);
      api.startTweenClipDrag(pointer(100), row);
      api.dispatch("pointermove", pointer(-10000));
      assert.equal(dragged.startTime, 0);
      api.dispatch("pointermove", pointer(10000));
      assert.equal(dragged.startTime, 9);
      assert.equal(dragged.duration, 1);
      api.dispatch("pointerup", pointer(10000));
    });
    await test("Changing documents or deleting a dragged track cleans up listeners and snap guides", () => {
      for (const stop of [(api) => api.stopDocumentInteraction(), (api, id) => api.removeTweenTrack(id)]) {
        const { api, dragged, row } = dragFixture();
        api.startTweenClipDrag(pointer(100), row);
        api.dispatch("pointermove", pointer(495));
        assert.equal(api.timelineSnapTime.value, 5);
        stop(api, dragged.id);
        assert.equal(api.draggingTweenTrackId.value, null);
        assert.equal(api.resizingTweenEdge.value, null);
        assert.equal(api.timelineSnapTime.value, null);
        assert.equal(api.listenerCount(), 0);
        const lastStart = dragged.startTime;
        api.dispatch("pointermove", pointer(700));
        assert.equal(dragged.startTime, lastStart);
      }
    });
    await test("Editing a Clip pauses playback and window blur releases its active drag", () => {
      const { api, dragged, row } = dragFixture();
      api.playing.value = true;
      api.startTweenClipDrag(pointer(100), row);
      assert.equal(api.playing.value, false);
      api.dispatch("pointermove", pointer(495));
      assert.equal(api.timelineSnapTime.value, 5);
      api.dispatch("blur", {});
      assert.equal(api.listenerCount(), 0);
      assert.equal(api.timelineSnapTime.value, null);
      assert.equal(api.draggingTweenTrackId.value, null);
      const lastStart = dragged.startTime;
      api.dispatch("pointermove", pointer(700));
      assert.equal(dragged.startTime, lastStart);
    });
  } finally {
    Module._load = originalLoad;
    if (originalTsExtension) Module._extensions[".ts"] = originalTsExtension;
    else delete Module._extensions[".ts"];
  }
  console.log(`\n${passed} client UI scale-delta / Clip-snap editor checks passed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
