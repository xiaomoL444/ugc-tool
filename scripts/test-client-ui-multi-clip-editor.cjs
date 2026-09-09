/* Run: node scripts/test-client-ui-multi-clip-editor.cjs
 * Exercises the real Vue setup declarations, timing handlers, preview resolver
 * and project import/export. No reimplementation of editor logic is used.
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
    "makeNode", "getHierarchyOrder", "applyNodeLayout", "buildTweenPreviewNodes", "readTweenFieldValue",
    "addTweenTrack", "addTweenClip", "updateTweenRelative", "getTweenRelativeBaseline", "resolveTweenClipEndpoints",
    "normalizeTweenTracks", "serializeProject", "loadProject", "timelineRows", "timelineContent",
    "openTimelineContextMenu", "closeTimelineContextMenu", "createTimelineContextClip", "timelineContextMenu",
    "deleteTimelineContextClip", "deleteTimelineContextTrack",
    "removeTweenTrack", "removeTweenLane", "updateTweenTiming", "updateSequenceDuration",
    "timelineSnapEnabled", "timelineSnapTime", "toggleTimelineSnapping", "startTweenClipDrag", "startTweenEdgeDrag",
    "draggingTweenTrackId", "resizingTweenEdge", "stopDocumentInteraction",
    "openTimelineDataImport", "confirmTimelineDataImport", "timelineDataImportOpen", "timelineDataSource",
    "timelineDataRootId", "timelineDataImportMode", "timelineDataImportSummary", "timelineDataImportPreview", "applyProjectData",
  ];
  const script = ts.transpileModule(`${declarations}\nglobalThis.editorApi = { ${exposed.join(", ")} };`, {
    fileName: filename + ".ts",
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
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
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    });
    module._compile(compiled.outputText, sourcePath);
  };
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message || "Value"}: ${actual} != ${expected}`);
  let passed = 0;
  const failures = [];
  async function test(name, check) {
    try { await check(); passed += 1; console.log(`PASS ${name}`); }
    catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}\n${error.stack}`); }
  }
  try {
    // Discover the editor's actual local helper modules, including newly added
    // lane/timing helpers, without executing SFCs or browser-only asset imports.
    const imports = {};
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
      const source = statement.moduleSpecifier.text;
      if (!source.startsWith("./") || source.endsWith(".vue") || source === "./imageAssets") continue;
      const sourcePath = path.resolve(editor, `${source}.ts`);
      if (fs.existsSync(sourcePath)) Object.assign(imports, require(sourcePath));
    }
    function createEditor() {
      const listeners = new Map();
      const alerts = [];
      const context = vm.createContext({
        ...vue, ...imports,
        inject: () => null,
        nextTick: () => Promise.resolve(),
        window: {
          innerWidth: 1200, innerHeight: 900,
          alert(message) { alerts.push(message); },
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
      api.alerts = alerts;
      api.dispatch = (type, event) => [...(listeners.get(type) || [])].forEach((callback) => callback(event));
      api.listenerCount = () => [...listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0);
      return api;
    }
    function fixture() {
      const api = createEditor();
      api.nodes.value = [
        api.makeNode("container", "Root", { id: "root", scaleX: 1, scaleY: 1, anchorOffsetX: 0, anchorOffsetY: 0, sizeDeltaX: 1600, sizeDeltaY: 900 }),
        api.makeNode("container", "Group", { id: "group", parentId: "root", scaleX: 2, scaleY: 3, scaleZ: 4, anchorOffsetX: 100, anchorOffsetY: 50, sizeDeltaX: 200, sizeDeltaY: 100 }),
        api.makeNode("image", "Image", { id: "image", parentId: "group", scaleX: 0.5, scaleY: 0.25, anchorOffsetX: 20, anchorOffsetY: 10, sizeDeltaX: 30, sizeDeltaY: 30 }),
      ];
      api.getHierarchyOrder().forEach(api.applyNodeLayout);
      api.tweenTracks.value = [];
      api.selectedId.value = "group";
      api.duration.value = 10;
      const lane = {
        clientWidth: 1000, scrollLeft: 0,
        getBoundingClientRect() { return { left: 100, top: 0, bottom: 33, width: 1000, height: 33 }; },
        querySelector() { return null; },
        closest() { return this; },
        contains() { return true; },
        classList: { contains: (name) => name === "track-lane" },
      };
      api.timelineContent.value = lane;
      return { api, lane, group: api.nodes.value[1], image: api.nodes.value[2] };
    }
    let nextId = 0;
    function clip(fieldKey, startTime, duration, initialValue, endValue, extras = {}) {
      return { id: `clip-${++nextId}`, nodeId: "group", fieldKey, startTime, duration, initialValue, endValue, easeType: "Linear", ...extras };
    }
    function select(api, id) {
      const value = api.tweenTracks.value.find((track) => track.id === id);
      assert.ok(value);
      api.selectedId.value = value.nodeId;
      api.selectedTweenTrackId.value = value.id;
      return value;
    }
    function tweenRow(api, id) {
      return api.timelineRows.value.find((row) => row.kind === "tween" && row.tracks.some((track) => track.id === id));
    }
    function pointer(clientX, extras = {}) {
      return { button: 0, pointerId: 17, clientX, clientY: 20, preventDefault() {}, stopPropagation() {}, ...extras };
    }
    function noOverlap(api) {
      const groups = new Map();
      for (const track of api.tweenTracks.value) {
        const key = `${track.nodeId}:${track.fieldKey}`;
        groups.set(key, [...(groups.get(key) || []), track]);
      }
      for (const tracks of groups.values()) {
        tracks.sort((left, right) => left.startTime - right.startTime);
        for (let index = 1; index < tracks.length; index += 1) assert.ok(
          tracks[index - 1].startTime + tracks[index - 1].duration <= tracks[index].startTime + 1e-8,
          `Overlapping Clips ${tracks[index - 1].id} and ${tracks[index].id}`,
        );
      }
    }
    function multiFixture() {
      const result = fixture();
      const { api } = result;
      api.tweenTracks.value = [
        clip("anchoredPositionX", 0, 1, 0, 40, { relative: true }),
        clip("anchoredPositionX", 2, 1, 0, -90, { relative: true }),
      ];
      return { ...result, first: api.tweenTracks.value[0], second: api.tweenTracks.value[1] };
    }

    await test("Two position Clips share one lane while different fields retain separate lanes", () => {
      const { api, first, second } = multiFixture();
      const other = clip("anchoredPositionY", 0, 1, 50, 70);
      api.tweenTracks.value.push(other);
      const rows = api.timelineRows.value.filter((row) => row.kind === "tween");
      assert.equal(rows.length, 2);
      assert.deepEqual(plain(tweenRow(api, first.id).tracks.map((track) => track.id)), [first.id, second.id]);
      assert.equal(tweenRow(api, first.id).track.id, first.id);
      assert.equal(tweenRow(api, other.id).tracks.length, 1);
      const nodeRow = api.timelineRows.value.find((row) => row.kind === "node" && row.node.id === "group");
      assert.ok(nodeRow);
    });
    await test("Relative position +40, one-second hold, then -90 uses each preceding endpoint", () => {
      const { api, first, second, group } = multiFixture();
      const original = plain(api.nodes.value);
      const endpoints = api.resolveTweenClipEndpoints();
      assert.equal(api.getTweenRelativeBaseline(first), 100);
      assert.equal(api.getTweenRelativeBaseline(second), 140);
      assert.equal(endpoints.get(first.id).initialValue, 100);
      assert.equal(endpoints.get(first.id).endValue, 140);
      assert.equal(endpoints.get(second.id).initialValue, 140);
      assert.equal(endpoints.get(second.id).endValue, 50);
      assert.notEqual(endpoints.get(second.id).relative, true);
      for (const [time, x] of [[0, 100], [0.5, 120], [1, 140], [1.5, 140], [2, 140], [2.5, 95], [3, 50], [8, 50]]) {
        near(api.buildTweenPreviewNodes(time)[1].anchorOffsetX, x, `X at ${time}`);
      }
      assert.equal(group.anchorOffsetX, 100);
      assert.deepEqual(plain(api.nodes.value), original);
    });
    await test("Resolving and backwards scrubbing remain chronological even when saved Clip order is reversed", () => {
      const { api } = multiFixture();
      api.tweenTracks.value.reverse();
      for (const [time, x] of [[3, 50], [1.5, 140], [0.5, 120], [2.5, 95], [0, 100], [3, 50]]) {
        near(api.buildTweenPreviewNodes(time)[1].anchorOffsetX, x, `X at ${time}`);
      }
      const lane = api.timelineRows.value.find((row) => row.kind === "tween");
      assert.deepEqual(plain(lane.tracks.map((track) => track.startTime)), [0, 2]);
    });
    await test("A future absolute Clip cannot overwrite earlier animation or the gap before its own start", () => {
      const { api } = fixture();
      api.tweenTracks.value = [clip("anchoredPositionX", 1, 1, 20, 60), clip("anchoredPositionX", 4, 1, 200, 300)];
      for (const [time, x] of [[0, 20], [1, 20], [1.5, 40], [2, 60], [3.99, 60], [4, 200], [4.5, 250], [5, 300]]) {
        near(api.buildTweenPreviewNodes(time)[1].anchorOffsetX, x, `Absolute X at ${time}`);
      }
    });
    await test("Back-to-back Clips allow touching edges and choose the new Clip at the shared boundary", () => {
      const { api } = fixture();
      api.tweenTracks.value = [clip("anchoredPositionX", 0, 1, 20, 60), clip("anchoredPositionX", 1, 1, 200, 300)];
      near(api.buildTweenPreviewNodes(0.999)[1].anchorOffsetX, 59.96);
      near(api.buildTweenPreviewNodes(1)[1].anchorOffsetX, 200);
      noOverlap(api);
      assert.equal(api.normalizeTweenTracks(plain(api.tweenTracks.value), 7).length, 2);
    });
    await test("Scaling increments also chain from preceding resolved endpoints on every axis", () => {
      const { api } = fixture();
      for (const [fieldKey, modelKey, base] of [["localScaleX", "scaleX", 2], ["localScaleY", "scaleY", 3], ["localScaleZ", "scaleZ", 4]]) {
        api.tweenTracks.value = [clip(fieldKey, 0, 1, 0, 0.5, { relative: true }), clip(fieldKey, 2, 1, 0, -1, { relative: true })];
        near(api.buildTweenPreviewNodes(1)[1][modelKey], base + 0.5);
        near(api.buildTweenPreviewNodes(2.5)[1][modelKey], base);
        near(api.buildTweenPreviewNodes(3)[1][modelKey], base - 0.5);
      }
    });
    await test("Size X and Y increments animate from the node size without mutating its base values", () => {
      const { api } = fixture();
      const original = plain(api.nodes.value);
      for (const [fieldKey, dimension, base] of [["sizeDeltaX", "width", 200], ["sizeDeltaY", "height", 100]]) {
        api.tweenTracks.value = [clip(fieldKey, 0, 1, 0, 40, { relative: true })];
        for (const [time, delta] of [[0, 0], [0.5, 20], [1, 40]]) {
          const preview = api.buildTweenPreviewNodes(time)[1];
          near(preview[fieldKey], base + delta, `${fieldKey} at ${time}`);
          near(preview[dimension], base + delta, `${dimension} at ${time}`);
        }
        assert.deepEqual(plain(api.nodes.value), original);
      }
    });
    await test("Size Clips chain +40 then -90 from previousEnd through gaps and backwards scrubbing", () => {
      const { api } = fixture();
      const original = plain(api.nodes.value);
      for (const [fieldKey, base] of [["sizeDeltaX", 200], ["sizeDeltaY", 100]]) {
        const first = clip(fieldKey, 0, 1, 0, 40, { relative: true });
        const second = clip(fieldKey, 2, 1, 0, -90, { relative: true });
        api.tweenTracks.value = [second, first];
        const endpoints = api.resolveTweenClipEndpoints();
        assert.equal(api.getTweenRelativeBaseline(first), base);
        assert.equal(api.getTweenRelativeBaseline(second), base + 40);
        assert.equal(endpoints.get(first.id).initialValue, base);
        assert.equal(endpoints.get(first.id).endValue, base + 40);
        assert.equal(endpoints.get(second.id).initialValue, base + 40);
        assert.equal(endpoints.get(second.id).endValue, base - 50);
        for (const [time, delta] of [[0, 0], [0.5, 20], [1, 40], [1.5, 40], [2, 40], [2.5, -5], [3, -50], [8, -50], [1.5, 40], [0.5, 20], [3, -50]]) {
          near(api.buildTweenPreviewNodes(time)[1][fieldKey], base + delta, `${fieldKey} at ${time}`);
        }
        assert.deepEqual(plain(api.nodes.value), original);
      }
    });
    await test("Size mode switches convert exact endpoints independently for each Clip and axis", () => {
      const { api } = fixture();
      api.tweenTracks.value = ["sizeDeltaX", "sizeDeltaY"].flatMap((fieldKey) => [
        clip(fieldKey, 0, 1, 0, 40, { relative: true }),
        clip(fieldKey, 2, 1, 0, -90, { relative: true }),
      ]);
      const originalNodes = plain(api.nodes.value);
      const samples = [0, 0.5, 1.5, 2.5, 3];
      const expected = samples.map((time) => plain(api.buildTweenPreviewNodes(time)));
      for (const track of api.tweenTracks.value) {
        select(api, track.id);
        const original = plain(track);
        const siblings = () => plain(api.tweenTracks.value.filter((other) => other.id !== track.id));
        const originalSiblings = siblings();
        const base = (track.fieldKey === "sizeDeltaX" ? 200 : 100) + (track.startTime === 2 ? 40 : 0);
        api.updateTweenRelative(false);
        assert.equal(track.relative, false);
        assert.equal(track.initialValue, base);
        assert.equal(track.endValue, base + original.endValue);
        assert.deepEqual(siblings(), originalSiblings);
        assert.deepEqual(samples.map((time) => plain(api.buildTweenPreviewNodes(time))), expected);
        api.updateTweenRelative(true);
        assert.deepEqual(plain(track), original);
        assert.deepEqual(siblings(), originalSiblings);
        assert.deepEqual(samples.map((time) => plain(api.buildTweenPreviewNodes(time))), expected);
      }
      assert.deepEqual(plain(api.nodes.value), originalNodes);
    });
    await test("Size relative modes and endpoints survive normalization and project JSON round-trip", async () => {
      const { api } = fixture();
      api.tweenTracks.value = [
        clip("sizeDeltaX", 0, 1, 0, 40, { relative: true }),
        clip("sizeDeltaX", 2, 1, 0, -90, { relative: true }),
        clip("sizeDeltaY", 0, 1, 100, 140),
        clip("sizeDeltaY", 2, 1, 0, -90, { relative: true }),
      ];
      const originalTracks = plain(api.tweenTracks.value);
      assert.deepEqual(plain(api.normalizeTweenTracks(originalTracks, 7)), originalTracks);
      const serialized = api.serializeProject();
      assert.deepEqual(JSON.parse(serialized).tweenTracks, originalTracks);
      const before = plain(api.buildTweenPreviewNodes(2.5));
      await api.loadProject({ target: { files: [{ name: "size-increments.json", text: async () => serialized }] } });
      assert.equal(api.alerts.length, 0);
      assert.deepEqual(plain(api.tweenTracks.value), originalTracks);
      assert.deepEqual(plain(api.buildTweenPreviewNodes(2.5)), before);
      near(api.buildTweenPreviewNodes(3)[1].sizeDeltaX, 150);
      near(api.buildTweenPreviewNodes(3)[1].sizeDeltaY, 50);
    });
    await test("Parent size increments update child stretch layout without changing local scales", () => {
      const { api, image } = fixture();
      Object.assign(image, { anchorMinX: 0.25, anchorMaxX: 0.75, anchorMinY: 0, anchorMaxY: 1 });
      api.getHierarchyOrder().forEach(api.applyNodeLayout);
      const original = plain(api.nodes.value);
      api.tweenTracks.value = ["sizeDeltaX", "sizeDeltaY"].map((fieldKey) => clip(fieldKey, 0, 1, 0, 40, { relative: true }));
      for (const [time, delta] of [[0, 0], [0.5, 20], [1, 40], [0, 0]]) {
        const preview = api.buildTweenPreviewNodes(time);
        near(preview[1].width, 200 + delta);
        near(preview[1].height, 100 + delta);
        near(preview[2].width, 130 + delta / 2);
        near(preview[2].height, 130 + delta);
        near(preview[2].x, 120 + delta / 2);
        near(preview[2].y, 60 + delta / 2);
        assert.equal(preview[2].sizeDeltaX, 30);
        assert.equal(preview[2].sizeDeltaY, 30);
        for (let index = 0; index < preview.length; index += 1) {
          for (const scale of ["scaleX", "scaleY", "scaleZ"]) assert.equal(preview[index][scale], original[index][scale]);
        }
      }
      assert.deepEqual(plain(api.nodes.value), original);
    });
    await test("Position Y supports incremental chains without introducing an inverted coordinate sign", () => {
      const { api } = fixture();
      api.tweenTracks.value = [clip("anchoredPositionY", 0, 1, 0, 40, { relative: true }), clip("anchoredPositionY", 2, 1, 0, -90, { relative: true })];
      near(api.buildTweenPreviewNodes(1)[1].anchorOffsetY, 90);
      near(api.buildTweenPreviewNodes(3)[1].anchorOffsetY, 0);
    });
    await test("Changing a later Clip between absolute and incremental modes uses its preceding endpoint", () => {
      const { api, second } = multiFixture();
      const value = select(api, second.id);
      const expected = plain(api.buildTweenPreviewNodes(2.5));
      api.updateTweenRelative(false);
      assert.equal(value.initialValue, 140);
      assert.equal(value.endValue, 50);
      assert.deepEqual(plain(api.buildTweenPreviewNodes(2.5)), expected);
      api.updateTweenRelative(true);
      assert.equal(value.initialValue, 0);
      assert.equal(value.endValue, -90);
      assert.deepEqual(plain(api.buildTweenPreviewNodes(2.5)), expected);
    });
    await test("A later relative Clip chains from an absolute predecessor rather than the original node value", () => {
      const { api } = fixture();
      api.tweenTracks.value = [clip("anchoredPositionX", 0, 1, 10, 70), clip("anchoredPositionX", 2, 1, -10, 30, { relative: true })];
      near(api.buildTweenPreviewNodes(1)[1].anchorOffsetX, 70);
      near(api.buildTweenPreviewNodes(2)[1].anchorOffsetX, 60);
      near(api.buildTweenPreviewNodes(3)[1].anchorOffsetX, 100);
    });
    await test("Incomplete Clips do not animate or become baselines for later valid Clips", () => {
      const { api } = fixture();
      api.tweenTracks.value = [clip("anchoredPositionX", 0, 1, null, 999), clip("anchoredPositionX", 2, 1, 0, 40, { relative: true })];
      near(api.buildTweenPreviewNodes(0.5)[1].anchorOffsetX, 100);
      near(api.buildTweenPreviewNodes(3)[1].anchorOffsetX, 140);
      assert.equal(api.getTweenRelativeBaseline(api.tweenTracks.value[1]), 100);
    });
    await test("Color Clips share one lane and preserve previous color through gaps without future-from writes", () => {
      const { api } = fixture();
      const red = { r: 255, g: 0, b: 0, a: 1 };
      const green = { r: 0, g: 255, b: 0, a: 0.5 };
      const blue = { r: 0, g: 0, b: 255, a: 0.25 };
      const white = { r: 255, g: 255, b: 255, a: 1 };
      api.tweenTracks.value = [clip("imageColor", 0, 1, red, green, { nodeId: "image" }), clip("imageColor", 3, 1, blue, white, { nodeId: "image" })];
      assert.equal(tweenRow(api, api.tweenTracks.value[0].id).tracks.length, 2);
      assert.deepEqual(plain(api.buildTweenPreviewNodes(2)[2].properties.imageColor), green);
      assert.deepEqual(plain(api.buildTweenPreviewNodes(3)[2].properties.imageColor), blue);
      assert.deepEqual(plain(api.buildTweenPreviewNodes(4)[2].properties.imageColor), white);
    });
    await test("Group alpha accepts multiple Clips without treating its own lane as a color conflict", () => {
      const { api, group, image } = fixture();
      image.properties.imageColor = { r: 180, g: 90, b: 45, a: 0.4 };
      api.addTweenTrack(group, "groupAlpha");
      const first = api.tweenTracks.value[0];
      first.startTime = 0; first.duration = 1; first.initialValue = 255; first.endValue = 128;
      const second = api.addTweenClip(group, "groupAlpha", 2);
      assert.ok(second, "Adding a Clip on the same group-alpha lane must not self-conflict");
      second.duration = 1; second.initialValue = 128; second.endValue = 0;
      assert.equal(tweenRow(api, first.id).tracks.length, 2);
      near(api.buildTweenPreviewNodes(1.5)[2].properties.imageColor.a, Math.round(102 * 128 / 255) / 255);
      near(api.buildTweenPreviewNodes(3)[2].properties.imageColor.a, 0);
      assert.deepEqual(plain(image.properties.imageColor), { r: 180, g: 90, b: 45, a: 0.4 });
    });
    await test("New Clips receive distinct IDs and fit within the clicked gap", () => {
      const { api, group } = fixture();
      api.addTweenTrack(group, "anchoredPositionX");
      const first = api.tweenTracks.value[0];
      first.startTime = 0; first.duration = 1;
      api.tweenTracks.value.push(clip("anchoredPositionX", 4, 1, 100, 120));
      const second = api.addTweenClip(group, "anchoredPositionX", 2);
      assert.ok(second);
      assert.equal(second.startTime, 2);
      assert.ok(second.duration >= 0.01 && second.startTime + second.duration <= 4);
      assert.equal(new Set(api.tweenTracks.value.map((track) => track.id)).size, 3);
      assert.equal(api.selectedTweenTrackId.value, second.id);
      noOverlap(api);
    });
    await test("Creating on an occupied interval is rejected, while a free touching endpoint is allowed", () => {
      const { api, group } = fixture();
      api.tweenTracks.value = [clip("anchoredPositionX", 0, 1, 100, 140), clip("anchoredPositionX", 2, 1, 140, 50)];
      for (const start of [0, 0.5, 2, 2.5]) assert.equal(api.addTweenClip(group, "anchoredPositionX", start), null);
      assert.equal(api.tweenTracks.value.length, 2);
      const touching = api.addTweenClip(group, "anchoredPositionX", 1);
      assert.ok(touching);
      assert.equal(touching.startTime, 1);
      noOverlap(api);
    });
    await test("Deleting one Clip preserves its lane siblings; deleting a lane leaves other fields untouched", () => {
      const { api, first, second } = multiFixture();
      const other = clip("anchoredPositionY", 0, 1, 50, 70);
      api.tweenTracks.value.push(other);
      api.removeTweenTrack(first.id);
      assert.deepEqual(plain(api.tweenTracks.value.map((track) => track.id)), [second.id, other.id]);
      assert.equal(tweenRow(api, second.id).tracks.length, 1);
      api.removeTweenLane(second.id);
      assert.deepEqual(plain(api.tweenTracks.value.map((track) => track.id)), [other.id]);
      assert.equal(api.timelineRows.value.filter((row) => row.kind === "tween").length, 1);
    });
    await test("Numeric start and duration editing cannot cross adjacent Clips", () => {
      const { api } = fixture();
      api.tweenTracks.value = [clip("localScaleX", 0, 1, 2, 3), clip("localScaleX", 2, 1, 3, 4), clip("localScaleX", 4, 1, 4, 5)];
      const middle = select(api, api.tweenTracks.value[1].id);
      api.updateTweenTiming("startTime", 100);
      assert.equal(middle.startTime, 3); assert.equal(middle.duration, 1); noOverlap(api);
      api.updateTweenTiming("startTime", -100);
      assert.equal(middle.startTime, 1); assert.equal(middle.duration, 1); noOverlap(api);
      api.updateTweenTiming("startTime", 2);
      api.updateTweenTiming("duration", 100);
      assert.equal(middle.startTime, 2); assert.equal(middle.duration, 2); noOverlap(api);
      api.updateTweenTiming("duration", -100);
      assert.equal(middle.duration, 0.01); noOverlap(api);
    });
    await test("Body dragging cannot pass through same-lane neighbors and preserves Clip length", () => {
      const { api } = fixture();
      api.timelineSnapEnabled.value = false;
      api.tweenTracks.value = [clip("localScaleX", 0, 1, 2, 3), clip("localScaleX", 2, 1, 3, 4), clip("localScaleX", 4, 1, 4, 5)];
      const middle = select(api, api.tweenTracks.value[1].id);
      const row = tweenRow(api, middle.id);
      api.startTweenClipDrag(pointer(300), { ...row, track: middle });
      api.dispatch("pointermove", pointer(10000));
      assert.equal(middle.startTime, 3); assert.equal(middle.duration, 1); noOverlap(api);
      api.dispatch("pointermove", pointer(-10000));
      assert.equal(middle.startTime, 1); assert.equal(middle.duration, 1); noOverlap(api);
      api.dispatch("pointerup", pointer(100));
      assert.equal(api.listenerCount(), 0);
    });
    await test("Both resize edges stop at adjacent Clips without changing the opposite edge", () => {
      for (const edge of ["start", "end"]) {
        const { api } = fixture();
        api.timelineSnapEnabled.value = false;
        api.tweenTracks.value = [clip("localScaleX", 0, 1, 2, 3), clip("localScaleX", 2, 1, 3, 4), clip("localScaleX", 4, 1, 4, 5)];
        const middle = select(api, api.tweenTracks.value[1].id);
        const row = tweenRow(api, middle.id);
        api.startTweenEdgeDrag(pointer(300), { ...row, track: middle }, edge);
        api.dispatch("pointermove", pointer(edge === "start" ? -10000 : 10000));
        assert.equal(middle.startTime, edge === "start" ? 1 : 2);
        assert.equal(middle.duration, 2);
        noOverlap(api);
        api.dispatch("pointerup", pointer(300));
        assert.equal(api.listenerCount(), 0);
      }
    });
    await test("Snap attraction cannot pull a Clip outside its free same-lane interval", () => {
      const { api } = fixture();
      api.tweenTracks.value = [clip("localScaleX", 0, 1, 2, 3), clip("localScaleX", 2, 1, 3, 4), clip("localScaleX", 4, 1, 4, 5), clip("localScaleY", 4.02, 1, 3, 4)];
      const middle = select(api, api.tweenTracks.value[1].id);
      const row = tweenRow(api, middle.id);
      api.startTweenClipDrag(pointer(300), { ...row, track: middle });
      api.dispatch("pointermove", pointer(401));
      assert.equal(middle.startTime, 3);
      assert.equal(middle.duration, 1);
      assert.ok(api.timelineSnapTime.value === null || api.timelineSnapTime.value === 4);
      noOverlap(api);
      api.dispatch("pointerup", pointer(401));
    });
    await test("Shortening the sequence preserves existing timing and cannot create overlaps", () => {
      const { api } = fixture();
      api.tweenTracks.value = [clip("localScaleX", 2, 1, 2, 3), clip("localScaleX", 7, 2, 3, 4)];
      const original = plain(api.tweenTracks.value);
      api.updateSequenceDuration(4);
      assert.ok(api.duration.value >= 9);
      assert.deepEqual(plain(api.tweenTracks.value), original);
      noOverlap(api);
    });
    await test("Normalization retains all same-field Clips and repairs duplicated IDs", () => {
      const { api, first, second } = multiFixture();
      const normalized = api.normalizeTweenTracks([{ ...plain(first), id: "duplicate" }, { ...plain(second), id: "duplicate" }], 7);
      assert.equal(normalized.length, 2);
      assert.equal(new Set(normalized.map((track) => track.id)).size, 2);
      assert.deepEqual(plain(normalized.map((track) => track.startTime)), [0, 2]);
      assert.equal(normalized[1].relative, true);
      assert.equal(normalized[1].endValue, -90);
    });
    await test("Overlapping imported Clips are rejected explicitly instead of silently dropping or shifting one", () => {
      const { api } = fixture();
      assert.throws(() => api.normalizeTweenTracks([clip("anchoredPositionX", 0, 2, 100, 140), clip("anchoredPositionX", 1, 2, 140, 50)], 7), /重叠|交叉|overlap/i);
    });
    await test("Project JSON round-trips multiple Clips, modes, IDs and preview values", async () => {
      const { api } = multiFixture();
      const serialized = api.serializeProject();
      const saved = JSON.parse(serialized);
      assert.equal(saved.tweenTracks.length, 2);
      assert.equal(saved.tweenTracks[1].endValue, -90);
      const originalIds = api.tweenTracks.value.map((track) => track.id);
      const before = plain(api.buildTweenPreviewNodes(2.5));
      await api.loadProject({ target: { files: [{ name: "multi.json", text: async () => serialized }] } });
      assert.equal(api.alerts.length, 0);
      assert.deepEqual(plain(api.tweenTracks.value.map((track) => track.id)), originalIds);
      assert.equal(api.timelineRows.value.filter((row) => row.kind === "tween").length, 1);
      assert.deepEqual(plain(api.buildTweenPreviewNodes(2.5)), before);
    });
    await test("A rejected overlapping project import restores the previous active document", async () => {
      const { api } = multiFixture();
      const before = JSON.parse(api.serializeProject());
      const invalid = plain(before);
      invalid.name = "Must not replace current document";
      invalid.tweenTracks[1].startTime = 0.5;
      await api.loadProject({ target: { files: [{ name: "bad.json", text: async () => JSON.stringify(invalid) }] } });
      assert.equal(api.alerts.length, 1);
      assert.match(api.alerts[0], /保留|重叠|交叉/);
      assert.deepEqual(JSON.parse(api.serializeProject()), before);
      near(api.buildTweenPreviewNodes(3)[1].anchorOffsetX, 50);
    });
    await test("Right-clicking an empty lane creates a Clip at the pointer's timeline time", () => {
      const { api, first, lane } = multiFixture();
      const row = tweenRow(api, first.id);
      api.openTimelineContextMenu(pointer(450, { button: 2, currentTarget: lane }), row);
      assert.ok(api.timelineContextMenu.value);
      api.createTimelineContextClip(first.id);
      assert.equal(api.tweenTracks.value.length, 3);
      const created = api.tweenTracks.value.find((track) => track.id === api.selectedTweenTrackId.value);
      assert.equal(created.startTime, 3.5);
      assert.equal(api.timelineContextMenu.value, null);
      noOverlap(api);
    });
    await test("Context creation cannot add a Clip inside an occupied interval or use a stale target", () => {
      const { api, first, lane } = multiFixture();
      let row = tweenRow(api, first.id);
      api.openTimelineContextMenu(pointer(150, { button: 2, currentTarget: lane }), row, first);
      api.createTimelineContextClip(first.id);
      assert.equal(api.tweenTracks.value.length, 2);
      row = tweenRow(api, first.id);
      api.openTimelineContextMenu(pointer(450, { button: 2, currentTarget: lane }), row);
      api.createTimelineContextClip("not-the-context-target");
      assert.equal(api.tweenTracks.value.length, 2);
      api.removeTweenLane(first.id);
      api.createTimelineContextClip(first.id);
      assert.equal(api.tweenTracks.value.length, 0);
    });
    await test("Context deletion distinguishes one clicked Clip from its complete property lane", () => {
      const { api, first, second, lane } = multiFixture();
      const other = clip("anchoredPositionY", 0, 1, 50, 70);
      api.tweenTracks.value.push(other);
      api.openTimelineContextMenu(pointer(350, { button: 2, currentTarget: lane }), tweenRow(api, second.id), second);
      assert.equal(api.timelineContextMenu.value.clipId, second.id);
      api.deleteTimelineContextClip(first.id);
      assert.equal(api.tweenTracks.value.length, 3, "The Clip action must stay bound to the right-clicked Clip");
      api.deleteTimelineContextClip(second.id);
      assert.deepEqual(plain(api.tweenTracks.value.map((track) => track.id)), [first.id, other.id]);
      api.openTimelineContextMenu(pointer(450, { button: 2, currentTarget: lane }), tweenRow(api, first.id));
      assert.equal(api.timelineContextMenu.value.clipId, null);
      api.deleteTimelineContextTrack(first.id);
      assert.deepEqual(plain(api.tweenTracks.value.map((track) => track.id)), [other.id]);
    });
    await test("Keyboard context creation uses the current playhead and creation availability reflects collisions", () => {
      const { api, first, lane } = multiFixture();
      api.currentTime.value = 3.25;
      api.openTimelineContextMenu({ key: "F10", currentTarget: lane, preventDefault() {}, stopPropagation() {} }, tweenRow(api, first.id));
      assert.equal(api.timelineContextMenu.value.time, 3.25);
      assert.equal(api.timelineContextMenu.value.canCreate, true);
      api.createTimelineContextClip(first.id);
      assert.equal(api.tweenTracks.value.find((track) => track.id === api.selectedTweenTrackId.value).startTime, 3.25);
      api.currentTime.value = 0.5;
      api.openTimelineContextMenu({ key: "F10", currentTarget: lane, preventDefault() {}, stopPropagation() {} }, tweenRow(api, first.id));
      assert.equal(api.timelineContextMenu.value.canCreate, false);
      assert.ok(api.timelineContextMenu.value.createHint);
      noOverlap(api);
    });
    await test("Removing a dragged lane releases the pointer handlers and all its Clips", () => {
      const { api, second } = multiFixture();
      const row = tweenRow(api, second.id);
      api.startTweenClipDrag(pointer(300), { ...row, track: second });
      assert.ok(api.listenerCount() > 0);
      api.removeTweenLane(second.id);
      assert.equal(api.tweenTracks.value.length, 0);
      assert.equal(api.listenerCount(), 0);
      assert.equal(api.draggingTweenTrackId.value, null);
      assert.equal(api.timelineSnapTime.value, null);
    });
    await test("Opening Timeline Data import selects the current root, resets to append, and pauses playback", () => {
      const { api } = multiFixture();
      api.playing.value = true;
      api.currentTime.value = 2.5;
      api.timelineDataSource.value = "old draft";
      api.timelineDataImportMode.value = "replace";
      const before = api.serializeProject();
      api.openTimelineDataImport();
      assert.equal(api.timelineDataImportOpen.value, true);
      assert.equal(api.timelineDataRootId.value, "group");
      assert.equal(api.timelineDataImportMode.value, "append");
      assert.equal(api.timelineDataSource.value, "");
      assert.equal(api.timelineDataImportPreview.value, null);
      assert.equal(api.timelineDataImportSummary.value, null);
      assert.equal(api.playing.value, false);
      assert.equal(api.currentTime.value, 2.5);
      assert.equal(api.serializeProject(), before);
    });
    await test("Confirming Timeline Data restores multiple delta Clips and saves them without changing base nodes", () => {
      const { api } = fixture();
      api.duration.value = 2;
      api.currentTime.value = 1.5;
      api.tweenTracks.value = [clip("anchoredPositionX", 0, 1, 100, 120)];
      const existing = api.tweenTracks.value[0];
      const originalNodes = plain(api.nodes.value);
      const nodesReference = api.nodes.value;
      api.openTimelineDataImport();
      api.timelineDataSource.value = `return {schema="ClientUIAnimationEditor.TweenTimeline@7",duration=5,tracks={
        {"","sizeDeltaX",2,1,"OutQuad",0,-90,true},
        {"","sizeDeltaX",0,1,"Linear",0,40,true}
      }}`;
      assert.deepEqual(plain(api.timelineDataImportSummary.value), {
        schema: "ClientUIAnimationEditor.TweenTimeline@7", importedCount: 2, replacedCount: 0,
        duration: 5, errors: [], warnings: [],
      });
      assert.equal(api.tweenTracks.value.length, 1, "Preview must not commit imported Clips");
      api.confirmTimelineDataImport();
      assert.equal(api.timelineDataImportOpen.value, false);
      assert.equal(api.timelineDataSource.value, "");
      assert.equal(api.timelineDataImportPreview.value, null);
      assert.equal(api.tweenTracks.value[0], existing);
      const restored = api.tweenTracks.value.filter((track) => track.fieldKey === "sizeDeltaX");
      assert.deepEqual(plain(restored.map((track) => [track.startTime, track.initialValue, track.endValue, track.relative, track.easeType])),
        [[0, 0, 40, true, "Linear"], [2, 0, -90, true, "OutQuad"]]);
      assert.equal(api.duration.value, 5);
      assert.equal(api.currentTime.value, 0);
      assert.equal(api.playing.value, false);
      assert.equal(api.selectedId.value, "group");
      assert.equal(api.selectedTweenTrackId.value, restored[0].id);
      assert.equal(api.nodes.value, nodesReference);
      assert.deepEqual(plain(api.nodes.value), originalNodes);
      near(api.buildTweenPreviewNodes(3)[1].sizeDeltaX, 150);
      const saved = JSON.parse(api.serializeProject());
      assert.equal(saved.duration, 5);
      assert.deepEqual(saved.tweenTracks, plain(api.tweenTracks.value));
      assert.deepEqual(saved.nodes, originalNodes);
      noOverlap(api);
    });
    await test("Invalid Timeline Data confirmation leaves the entire timeline unchanged and keeps the dialog open", () => {
      for (const mode of ["append", "replace"]) {
        const { api, second } = multiFixture();
        select(api, second.id);
        api.currentTime.value = 2.5;
        api.openTimelineDataImport();
        api.timelineDataImportMode.value = mode;
        api.timelineDataSource.value = `return {schema="ClientUIAnimationEditor.TweenTimeline@7",duration=5,tracks={
          {"","sizeDeltaX",0,1,"Linear",0,40,true},
          {"Missing","sizeDeltaX",2,1,"Linear",0,-90,true}
        }}`;
        const before = api.serializeProject();
        const tracksReference = api.tweenTracks.value;
        const nodesReference = api.nodes.value;
        const sourceText = api.timelineDataSource.value;
        assert.ok(api.timelineDataImportSummary.value.errors.length > 0);
        assert.equal(api.timelineDataImportSummary.value.importedCount, 0);
        api.confirmTimelineDataImport();
        assert.equal(api.serializeProject(), before);
        assert.equal(api.tweenTracks.value, tracksReference);
        assert.equal(api.nodes.value, nodesReference);
        assert.equal(api.selectedTweenTrackId.value, second.id);
        assert.equal(api.selectedId.value, "group");
        assert.equal(api.currentTime.value, 2.5);
        assert.equal(api.timelineDataImportOpen.value, true);
        assert.equal(api.timelineDataSource.value, sourceText);
        assert.equal(api.alerts.length, 0);
      }
    });
    await test("Timeline Data replace removes selected subtree Clips while preserving external tracks and duration", () => {
      const { api } = fixture();
      api.tweenTracks.value = [clip("anchoredPositionX", 0, 1, 100, 140),
        clip("sizeDeltaY", 1, 1, 30, 50, { nodeId: "image" }),
        clip("localScaleX", 6, 2, 1, 2, { nodeId: "root" })];
      const outside = api.tweenTracks.value[2];
      const originalNodes = plain(api.nodes.value);
      api.openTimelineDataImport();
      api.timelineDataImportMode.value = "replace";
      api.timelineDataSource.value = 'return {schema="ClientUIAnimationEditor.TweenTimeline@7",duration=5,tracks={{"","sizeDeltaX",0,1,"Linear",0,40,true}}}';
      assert.equal(api.timelineDataImportSummary.value.replacedCount, 2);
      assert.equal(api.timelineDataImportSummary.value.duration, 8);
      api.confirmTimelineDataImport();
      assert.equal(api.tweenTracks.value.length, 2);
      assert.equal(api.tweenTracks.value.find((track) => track.nodeId === "root"), outside);
      const restored = api.tweenTracks.value.find((track) => track.nodeId === "group");
      assert.equal(restored.fieldKey, "sizeDeltaX");
      assert.equal(restored.relative, true);
      assert.equal(api.selectedTweenTrackId.value, restored.id);
      assert.equal(api.tweenTracks.value.some((track) => track.nodeId === "image"), false);
      assert.equal(api.duration.value, 8);
      assert.equal(api.currentTime.value, 0);
      assert.equal(api.timelineDataImportOpen.value, false);
      assert.deepEqual(plain(api.nodes.value), originalNodes);
    });
    await test("Stopping document interaction or applying another project closes pending Timeline Data import", () => {
      const { api } = multiFixture();
      const saved = api.serializeProject();
      for (const close of [() => api.stopDocumentInteraction(), () => api.applyProjectData(saved)]) {
        api.openTimelineDataImport();
        api.timelineDataSource.value = 'return {schema="ClientUIAnimationEditor.TweenTimeline@7",duration=5,tracks={{"","sizeDeltaX",0,1,"Linear",0,40,true}}}';
        assert.equal(api.timelineDataImportSummary.value.importedCount, 1);
        close();
        assert.equal(api.timelineDataImportOpen.value, false);
        assert.equal(api.timelineDataImportPreview.value, null);
        assert.equal(api.timelineDataImportSummary.value, null);
        const afterClose = api.serializeProject();
        api.confirmTimelineDataImport();
        assert.equal(api.serializeProject(), afterClose, "A stale dialog must never import into another document");
      }
    });
  } finally {
    Module._load = originalLoad;
    if (originalTsExtension) Module._extensions[".ts"] = originalTsExtension;
    else delete Module._extensions[".ts"];
  }
  console.log(`\n${passed} client UI multi-Clip editor checks passed; ${failures.length} failed.`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
