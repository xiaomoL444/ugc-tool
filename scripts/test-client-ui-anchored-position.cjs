/* Run: node scripts/test-client-ui-anchored-position.cjs [path/to/测试任务View.gia]
 * Executes the editor's real setup declarations with Vue reactivity. Only DOM
 * lifecycle and file-download effects are replaced; layout/Tween code is not.
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
  const root = path.resolve(__dirname, "..");
  const editor = path.join(root, "src/views/ClientUIAnimationEditor");
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
    "nodes", "canvasWidth", "canvasHeight", "duration", "deviceMode", "previewPresetId", "previewPresets",
    "selectedId", "tweenTracks", "giaImportStatus", "worldTransforms", "makeNode", "getHierarchyOrder",
    "keyframeTracks", "buildKeyframePreviewNodes", "currentTime", "propertyClipboard", "previewWorldTransforms",
    "getRuntimeLayoutValues", "updateRuntimeLayoutValue", "applyNodeLayout", "applyDescendantLayouts",
    "getAnchorReference", "readTweenFieldValue", "addTweenTrack", "buildTweenPreviewNodes",
    "normalizeTweenTracks", "loadGiaFile", "loadProject", "saveProject", "switchDevice", "applyPreviewPreset",
    "selectPreviewPreset", "copySelectedPropertyGroup", "resetSelectedPropertyGroup", "pasteSelectedPropertyGroup", "canPasteSelectedPropertyGroup",
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
  let passed = 0;
  async function test(name, check) { await check(); passed += 1; console.log(`PASS ${name}`); }
  const plain = (value) => JSON.parse(JSON.stringify(value));
  try {
    const registry = require(path.join(editor, "controlRegistry.ts"));
    const tweenRegistry = require(path.join(editor, "tweenRegistry.ts"));
    const importer = require(path.join(editor, "giaImporter.ts"));
    const exporter = require(path.join(editor, "luaTweenExporter.ts"));
    const propertyActions = require(path.join(editor, "propertyGroupActions.ts"));
    const clipLayout = require(path.join(editor, "timelineClipLayout.ts"));
    const directionGuide = require(path.join(editor, "containerDirectionGuide.ts"));
    const editorHistory = require(path.join(editor, "editorHistory.ts"));
    const historyChangeLabel = require(path.join(editor, "historyChangeLabel.ts"));
    const keyframeTimeline = { ...require(path.join(editor, "keyframeTimeline.ts")), ...require(path.join(editor, "animationCollection.ts")) };
    const keyframeLua = require(path.join(editor, "keyframeLua.ts"));
    function createEditor() {
      let savedProject;
      const context = vm.createContext({
        ...vue, ...registry, ...tweenRegistry, ...importer, ...exporter, ...propertyActions, ...clipLayout, ...directionGuide, ...editorHistory, ...historyChangeLabel, ...keyframeTimeline, ...keyframeLua,
        inject: () => null,
        nextTick: () => Promise.resolve(),
        window: { alert(message) { assert.fail(message); } },
        document: { createElement: () => ({ click() {} }) },
        Blob: class { constructor(parts) { this.text = parts.join(""); } },
        URL: { createObjectURL(blob) { savedProject = JSON.parse(blob.text); return "blob:test"; }, revokeObjectURL() {} },
      });
      vm.runInContext(script, context, { filename, timeout: 2000 });
      return Object.assign(context.editorApi, { getSavedProject: () => savedProject });
    }
    function fixture() {
      const api = createEditor();
      api.nodes.value = [
        api.makeNode("container", "Root", { id: "root", anchorMinX: 0, anchorMinY: 0, anchorMaxX: 1, anchorMaxY: 1, anchorOffsetX: 0, anchorOffsetY: 0, sizeDeltaX: 0, sizeDeltaY: 0 }),
        api.makeNode("container", "Topbar", { id: "top", parentId: "root", anchorMinX: 0, anchorMaxX: 1, anchorMinY: 1, anchorMaxY: 1, pivotY: 1, anchorOffsetX: 0, anchorOffsetY: 0, sizeDeltaX: 0, sizeDeltaY: 100 }),
        api.makeNode("text", "Label", { id: "label", parentId: "top", anchorMinX: 0, anchorMaxX: 1, anchorMinY: 0.5, anchorMaxY: 0.5, anchorOffsetX: 0, anchorOffsetY: 0, sizeDeltaX: -20, sizeDeltaY: 20 }),
      ];
      api.getHierarchyOrder().forEach(api.applyNodeLayout);
      api.tweenTracks.value = [];
      api.selectedId.value = "top";
      const [rootNode, top, label] = api.nodes.value;
      return { api, rootNode, top, label };
    }
    function track(nodeId, fieldKey, from, to) {
      return { id: `${nodeId}:${fieldKey}`, nodeId, fieldKey, startTime: 0, duration: 1, initialValue: from, endValue: to, easeType: "Linear" };
    }
    function opacityFixture() {
      const api = createEditor();
      const color = (a, r = 21, g = 86, b = 143) => ({ r, g, b, a });
      api.nodes.value = [
        api.makeNode("container", "Root", { id: "root" }),
        api.makeNode("container", "Group", { id: "group", parentId: "root" }),
        api.makeNode("image", "Picture", { id: "picture", parentId: "group", properties: { imageColor: color(0.4) } }),
        api.makeNode("text", "Caption", { id: "caption", parentId: "picture", properties: { fontColor: color(0.5, 228, 33, 54), bgColor: color(0), outlineColor: color(0.2) } }),
        api.makeNode("container", "Empty", { id: "empty", parentId: "caption" }),
        api.makeNode("textWindow", "ScrollText", { id: "scrollText", parentId: "empty", properties: { fontColor: color(0.6), bgColor: color(0.8), outlineColor: color(1) } }),
        api.makeNode("image", "Sibling", { id: "sibling", parentId: "root", properties: { imageColor: color(0.7) } }),
      ];
      api.getHierarchyOrder().forEach(api.applyNodeLayout);
      api.tweenTracks.value = [];
      api.selectedId.value = "group";
      return { api, byId: Object.fromEntries(api.nodes.value.map((node) => [node.id, node])) };
    }
    // Native Color endpoints are byte-rounded before Tween interpolates them.
    function expectedGroupAlpha(baseAlpha, from, to, progress) {
      const baseByte = Math.round(Math.max(0, Math.min(1, baseAlpha)) * 255);
      const endpoint = (value) => Math.round(baseByte * Math.max(0, Math.min(255, value)) / 255);
      return Math.max(0, Math.min(1, (endpoint(from) + (endpoint(to) - endpoint(from)) * progress) / 255));
    }
    function checkGroupColor(actual, original, from, to, progress, label) {
      assert.deepEqual([actual.r, actual.g, actual.b], [original.r, original.g, original.b], `${label} preserves its own RGB`);
      const expected = expectedGroupAlpha(original.a, from, to, progress);
      assert.ok(Math.abs(actual.a - expected) < 1e-10, `${label}: alpha ${actual.a} should equal ${expected}`);
    }
    await test("Top-edge and root anchored positions use their own anchor reference", () => {
      const { api, rootNode, top } = fixture();
      assert.equal(top.y, 900);
      assert.equal(api.getRuntimeLayoutValues(top).anchoredPositionY, 0);
      assert.equal(api.getRuntimeLayoutValues(rootNode).anchoredPositionY, 0);
      top.anchorMinY = 0.2; top.anchorMaxY = 0.8; top.pivotY = 0.25; top.anchorOffsetY = 17;
      api.applyNodeLayout(top);
      assert.equal(top.y, 332);
      assert.equal(api.getRuntimeLayoutValues(top).anchoredPositionY, 17);
    });
    await test("Runtime parameter writes round-trip and propagate parent size/position to children", () => {
      const { api, top, label } = fixture();
      const beforeLabelWorld = api.worldTransforms.value.get(label.id).y;
      api.updateRuntimeLayoutValue("anchoredPositionY", -80);
      assert.equal(top.y, 820);
      assert.equal(api.getRuntimeLayoutValues(top).anchoredPositionY, -80);
      assert.equal(api.worldTransforms.value.get(label.id).y, beforeLabelWorld - 80);
      api.updateRuntimeLayoutValue("anchoredPositionX", 25);
      assert.equal(api.getRuntimeLayoutValues(top).anchoredPositionX, 25);
      api.updateRuntimeLayoutValue("sizeDeltaY", 200);
      assert.equal(label.y, 100);
      assert.equal(api.getRuntimeLayoutValues(top).anchoredPositionY, -80);
      api.updateRuntimeLayoutValue("sizeDeltaX", -100);
      assert.equal(top.width, 1500);
      assert.equal(label.width, 1480);
      assert.equal(api.getRuntimeLayoutValues(top).sizeDeltaX, -100);
    });
    await test("New Tween starts at zero and previews 0 → -80 below the top edge", () => {
      const { api, top } = fixture();
      api.addTweenTrack(top, "anchoredPositionY");
      assert.equal(api.tweenTracks.value[0].initialValue, 0);
      api.tweenTracks.value[0].endValue = -80;
      const savedNodes = plain(api.nodes.value);
      for (const [time, expectedY, expectedOffset] of [[0, 900, 0], [0.5, 860, -40], [1, 820, -80]]) {
        const preview = api.buildTweenPreviewNodes(time).find((node) => node.id === "top");
        assert.equal(preview.y, expectedY);
        assert.equal(preview.anchorOffsetY, expectedOffset);
      }
      assert.deepEqual(plain(api.nodes.value), savedNodes, "Preview must not modify the saved layout");
    });
    await test("Tween offsets remain anchored during parent resize and animated anchor changes", () => {
      const { api } = fixture();
      api.tweenTracks.value = [track("top", "anchoredPositionY", 0, -80), track("root", "sizeDeltaY", 0, 200)];
      let preview = api.buildTweenPreviewNodes(0.5);
      assert.equal(preview.find((node) => node.id === "root").height, 1000);
      assert.equal(preview.find((node) => node.id === "top").y, 960);
      api.tweenTracks.value.push(track("top", "anchorMinY", 1, 0.5), track("top", "anchorMaxY", 1, 0.5));
      preview = api.buildTweenPreviewNodes(0.5);
      assert.equal(preview.find((node) => node.id === "top").y, 710);
      assert.equal(preview.find((node) => node.id === "top").anchorOffsetY, -40);
    });
    await test("All device presets keep a zero-offset Topbar attached to the top", () => {
      const { api, top, rootNode } = fixture();
      for (const [mode, presets] of Object.entries(api.previewPresets)) {
        api.switchDevice(mode);
        for (const preset of presets) {
          api.previewPresetId.value = preset.id;
          api.applyPreviewPreset();
          assert.equal(rootNode.height, preset.height);
          assert.equal(top.y, preset.height);
          assert.equal(api.getRuntimeLayoutValues(top).anchoredPositionY, 0);
        }
      }
    });
    await test("Combined preview selection switches all 10 device presets and updates stretched descendants", () => {
      const { api, rootNode, top, label } = fixture();
      let selectedCount = 0;
      for (const [mode, presets] of Object.entries(api.previewPresets)) {
        for (const preset of presets) {
          api.selectPreviewPreset(preset.id);
          assert.equal(api.deviceMode.value, mode, preset.id);
          assert.equal(api.previewPresetId.value, preset.id);
          assert.equal(api.canvasWidth.value, preset.width);
          assert.equal(api.canvasHeight.value, preset.height);
          assert.equal(rootNode.width, preset.width);
          assert.equal(rootNode.height, preset.height);
          assert.equal(top.width, preset.width);
          assert.equal(top.y, preset.height);
          assert.equal(label.width, Number((preset.width - 20).toFixed(2)));
          assert.equal(api.getRuntimeLayoutValues(top).anchoredPositionY, 0);
          assert.equal(api.getRuntimeLayoutValues(label).sizeDeltaX, -20);
          selectedCount += 1;
        }
      }
      assert.equal(selectedCount, 10);
    });
    await test("Transform copy samples the current pose and reset/paste restore layouts while preserving identity, setup animation bases and existing keys", () => {
      const { api, top, label } = fixture();
      Object.assign(top, {
        anchorOffsetX: 35, anchorOffsetY: -30, sizeDeltaX: -120, sizeDeltaY: 145,
        scaleX: 0.85, scaleY: 1.1, scaleZ: 1.3, rotationX: 8, rotationY: -9, rotation: 15,
      });
      api.applyNodeLayout(top);
      api.applyDescendantLayouts(top.id);
      api.keyframeTracks.value = keyframeTimeline.migrateTweenClipsToKeyframes([
        track("top", "anchoredPositionY", -30, -80), track("label", "sizeDeltaX", -20, -50),
      ]);
      api.currentTime.value = 0.5;
      const savedNodes = plain(api.nodes.value);
      const savedTracks = plain(api.keyframeTracks.value);
      const savedWorld = plain(Object.fromEntries(api.worldTransforms.value));
      const savedPreview = plain(api.buildKeyframePreviewNodes(0.5));
      const savedPreviewWorld = plain(Object.fromEntries(api.previewWorldTransforms.value));
      const identity = () => plain(api.nodes.value.map(({ id, parentId, name }) => ({ id, parentId, name })));
      const existingKeys = () => plain(api.keyframeTracks.value.map((lane) => ({ ...lane, keyframes: lane.keyframes.filter((key) => key.time !== 0.5) })));
      const currentPositionKey = () => api.keyframeTracks.value.find((lane) => lane.nodeId === "top").keyframes.find((key) => key.time === 0.5);
      const savedIdentity = identity();
      api.copySelectedPropertyGroup("transform");
      assert.equal(api.canPasteSelectedPropertyGroup("transform"), true);
      assert.equal(api.propertyClipboard.value.values.anchorOffsetY, -55, "Copy captures the visible interpolated position, not setup -30");
      assert.deepEqual(plain(api.nodes.value), savedNodes, "Copy does not mutate the source");
      assert.deepEqual(plain(api.keyframeTracks.value), savedTracks, "Copy does not insert keys");
      api.resetSelectedPropertyGroup("transform");
      assert.notEqual(top.width, savedNodes[1].width, "Reset applies the default parent size");
      assert.notEqual(label.width, savedNodes[2].width, "Reset recalculates stretched descendants");
      assert.notDeepEqual(plain(Object.fromEntries(api.worldTransforms.value)), savedWorld);
      assert.deepEqual(identity(), savedIdentity, "Reset preserves IDs, hierarchy and names");
      assert.equal(top.anchorOffsetY, -30, "Reset leaves the animated setup baseline untouched");
      assert.equal(currentPositionKey().value, 0, "Reset writes the default position at the current playhead");
      assert.deepEqual(existingKeys(), savedTracks, "Reset preserves both original endpoints and the descendant lane");
      api.pasteSelectedPropertyGroup("transform");
      assert.deepEqual(plain(api.nodes.value), savedNodes, "Paste restores all original parent and child layout values");
      assert.deepEqual(plain(Object.fromEntries(api.worldTransforms.value)), savedWorld, "Paste restores child world transforms");
      assert.equal(currentPositionKey().value, -55, "Paste restores the copied preview into the current key instead of overwriting setup");
      assert.deepEqual(existingKeys(), savedTracks, "Paste preserves the existing animation outside the current key");
      assert.deepEqual(plain(api.buildKeyframePreviewNodes(0.5)), savedPreview, "Paste restores the copied parent pose and animated descendant layout");
      assert.deepEqual(plain(Object.fromEntries(api.previewWorldTransforms.value)), savedPreviewWorld, "Paste restores the visible world transforms");
      assert.equal(api.nodes.value[1], top);
      assert.equal(api.nodes.value[2], label);
    });
    await test("Editor paste is disabled without a compatible clipboard and leaves the document unchanged", () => {
      const { api } = fixture();
      const savedNodes = plain(api.nodes.value);
      assert.equal(api.canPasteSelectedPropertyGroup("transform"), false);
      api.pasteSelectedPropertyGroup("transform");
      assert.deepEqual(plain(api.nodes.value), savedNodes);
      api.copySelectedPropertyGroup("transform");
      assert.equal(api.canPasteSelectedPropertyGroup("creation"), false);
      api.pasteSelectedPropertyGroup("creation");
      assert.deepEqual(plain(api.nodes.value), savedNodes);
      api.copySelectedPropertyGroup("control");
      api.selectedId.value = "label";
      assert.equal(api.canPasteSelectedPropertyGroup("control"), false, "Container parameters cannot be pasted onto text");
      api.pasteSelectedPropertyGroup("control");
      assert.deepEqual(plain(api.nodes.value), savedNodes);
      api.selectedId.value = null;
      assert.equal(api.canPasteSelectedPropertyGroup("control"), false);
    });
    await test("Version 6 parent-centered values migrate once; v4 world and v5 anchored values remain correct", async () => {
      for (const [version, from, to] of [[6, 450, 370], [4, 900, 820], [5, 0, -80], [7, 0, -80]]) {
        const { api } = fixture();
        const project = { hierarchyLayoutVersion: 2, timelineModelVersion: version, canvasWidth: 1600, canvasHeight: 900, duration: 5, nodes: plain(api.nodes.value), tweenTracks: [track("top", "anchoredPositionY", from, to)] };
        await api.loadProject({ target: { files: [{ text: async () => JSON.stringify(project) }] } });
        assert.equal(api.keyframeTracks.value[0].keyframes[0].value, 0, `v${version} initial`);
        assert.equal(api.keyframeTracks.value[0].keyframes[1].value, -80, `v${version} end`);
        assert.equal(api.buildKeyframePreviewNodes(0)[1].anchorOffsetY, 0);
        assert.equal(api.buildKeyframePreviewNodes(1)[1].anchorOffsetY, -80);
        api.saveProject();
        const saved = api.getSavedProject();
        assert.equal(saved.timelineModelVersion, 10);
        await api.loadProject({ target: { files: [{ text: async () => JSON.stringify(saved) }] } });
        assert.deepEqual(plain(api.keyframeTracks.value), saved.keyframeTracks, `v${version} save/reload must be idempotent`);
      }
    });
    await test("Missing or invalid legacy endpoints use the current anchored value without a second conversion", () => {
      const { api } = fixture();
      const saved = track("top", "anchoredPositionY", 450, 370);
      delete saved.initialValue;
      const normalized = api.normalizeTweenTracks([saved], 6);
      assert.equal(normalized[0].initialValue, 0);
      assert.equal(normalized[0].endValue, -80);
      for (const invalid of [undefined, "", "invalid", Number.NaN, Infinity]) {
        saved.initialValue = invalid;
        assert.equal(api.normalizeTweenTracks([saved], 6)[0].initialValue, 0);
      }
      saved.initialValue = null;
      assert.equal(api.normalizeTweenTracks([saved], 6)[0].initialValue, null);
    });
    await test("Legacy migration respects scaled parents, noncentral pivots and root canvas anchors", () => {
      const { api, rootNode, top } = fixture();
      rootNode.pivotX = 0.2; rootNode.pivotY = 0.7; rootNode.scaleY = 1.5;
      api.getHierarchyOrder().forEach(api.applyNodeLayout);
      const topWorldY = api.worldTransforms.value.get(top.id).y;
      assert.equal(topWorldY, 1035);
      const worldTrack = api.normalizeTweenTracks([track("top", "anchoredPositionY", topWorldY, topWorldY - 120)], 4)[0];
      assert.equal(worldTrack.initialValue, 0);
      assert.equal(worldTrack.endValue, -80);
      for (const version of [4, 6]) {
        const rootTrack = api.normalizeTweenTracks([track("root", "anchoredPositionY", 630, 550)], version)[0];
        assert.equal(rootTrack.initialValue, 0);
        assert.equal(rootTrack.endValue, -80);
      }
    });
    await test("Lua Data exports real 0 → -80 values under either root selection", () => {
      const { api, top } = fixture();
      api.addTweenTrack(top, "anchoredPositionY");
      api.tweenTracks.value[0].endValue = -80;
      for (const [rootNodeId, targetPath] of [["root", "Topbar"], ["top", ""]]) {
        const result = exporter.buildTweenTimelineDataLua({ rootNodeId, projectName: "Anchors", nodes: api.nodes.value, tracks: api.tweenTracks.value, sequenceDuration: 5 });
        assert.deepEqual(result.warnings, []);
        assert.equal(result.trackCount, 1);
        assert.ok(result.code.includes(`{ "${targetPath}", "anchoredPositionY", 0, 1, "Linear", 0, -80 }`), result.code);
      }
    });
    await test("Every control exposes a virtual groupAlpha field with a 255 default and no fake native properties", () => {
      const { api } = opacityFixture();
      for (const type of Object.keys(registry.controlRegistry)) {
        const node = api.makeNode(type, type);
        const original = plain(node);
        const field = tweenRegistry.getTweenableField(type, "groupAlpha");
        assert.ok(field, type);
        assert.equal(field.source, "group");
        assert.equal(field.valueKind, "number");
        assert.equal(field.min, 0);
        assert.equal(field.max, 255);
        assert.equal(api.readTweenFieldValue(node, field), 255);
        assert.deepEqual(plain(node), original);
        assert.equal(Object.hasOwn(node, "groupAlpha"), false);
        assert.equal(Object.hasOwn(node.properties, "groupAlpha"), false);
      }
      const group = api.nodes.value.find((node) => node.id === "group");
      api.addTweenTrack(group, "groupAlpha");
      assert.equal(api.tweenTracks.value.length, 1);
      assert.equal(api.tweenTracks.value[0].initialValue, 255);
      assert.equal(api.tweenTracks.value[0].endValue, 255);
      assert.deepEqual(tweenRegistry.getGroupAlphaColorFields("container"), []);
      assert.deepEqual(tweenRegistry.getGroupAlphaColorFields("image"), ["imageColor"]);
      assert.deepEqual(tweenRegistry.getGroupAlphaColorFields("text"), ["fontColor", "bgColor", "outlineColor"]);
    });
    await test("A group fade multiplies original alpha at every depth while preserving RGB, empty containers and unrelated siblings", () => {
      const { api } = opacityFixture();
      const saved = plain(api.nodes.value);
      api.tweenTracks.value = [{ ...track("group", "groupAlpha", 255, 0), startTime: 2, duration: 2 }];
      for (const [time, progress] of [[0, 0], [2, 0], [3, 0.5], [4, 1], [5, 1]]) {
        const previews = api.buildTweenPreviewNodes(time);
        for (const preview of previews) {
          const original = saved.find((node) => node.id === preview.id);
          if (["root", "group", "empty", "sibling"].includes(preview.id)) {
            assert.deepEqual(plain(preview.properties), original.properties, `${preview.id} has no unintended color/property writes`);
          } else {
            for (const field of tweenRegistry.getGroupAlphaColorFields(preview.type)) {
              checkGroupColor(preview.properties[field], original.properties[field], 255, 0, progress, `${preview.id}.${field} at ${time}`);
            }
          }
        }
      }
      assert.deepEqual(plain(api.nodes.value), saved);
    });
    await test("An image group's fade includes its own color and text children, but not its parent or siblings", () => {
      const { api, byId } = opacityFixture();
      const saved = plain(api.nodes.value);
      api.tweenTracks.value = [track("picture", "groupAlpha", 128, 64)];
      const preview = api.buildTweenPreviewNodes(0.5);
      for (const id of ["picture", "caption", "scrollText"]) {
        const node = preview.find((item) => item.id === id);
        for (const field of tweenRegistry.getGroupAlphaColorFields(node.type)) {
          checkGroupColor(node.properties[field], byId[id].properties[field], 128, 64, 0.5, `${id}.${field}`);
        }
      }
      for (const id of ["root", "group", "empty", "sibling"]) {
        assert.deepEqual(plain(preview.find((node) => node.id === id).properties), plain(byId[id].properties));
      }
      assert.deepEqual(plain(api.nodes.value), saved);
    });
    await test("Root group fades cover the entire scene and scrub repeatedly from original colors without cumulative dimming", () => {
      const { api } = opacityFixture();
      const saved = plain(api.nodes.value);
      api.tweenTracks.value = [track("root", "groupAlpha", 255, 0)];
      let firstHalf;
      for (const time of [0.5, 1, 0, 0.5, 0.75, 0.5]) {
        const preview = plain(api.buildTweenPreviewNodes(time));
        for (const node of preview) {
          const original = saved.find((item) => item.id === node.id);
          for (const field of tweenRegistry.getGroupAlphaColorFields(node.type)) {
            checkGroupColor(node.properties[field], original.properties[field], 255, 0, time, `${node.id}.${field}`);
          }
        }
        if (time === 0.5) {
          if (firstHalf) assert.deepEqual(preview, firstHalf);
          else firstHalf = preview;
        }
      }
      assert.deepEqual(plain(api.nodes.value), saved, "Scrubbing must never overwrite baseline colors");
    });
    await test("Group alpha uses each supported easing curve and clamps color alpha after overshoot", () => {
      const { api, byId } = opacityFixture();
      for (const { value: easeType } of tweenRegistry.tweenEaseOptions) {
        api.tweenTracks.value = [{ ...track("picture", "groupAlpha", 300, -12), startTime: 1, duration: 2, easeType }];
        for (const progress of [0, 0.15, 0.5, 0.85, 1]) {
          const preview = api.buildTweenPreviewNodes(1 + progress * 2).find((node) => node.id === "picture");
          checkGroupColor(preview.properties.imageColor, byId.picture.properties.imageColor, 300, -12, tweenRegistry.applyTweenEase(easeType, progress), `${easeType} at ${progress}`);
        }
      }
    });
    await test("Incomplete group alpha tracks preserve baseline colors instead of partially applying an invalid fade", () => {
      const { api } = opacityFixture();
      const saved = plain(api.nodes.value);
      for (const [from, to] of [[null, 0], [255, null], [null, null]]) {
        api.tweenTracks.value = [track("root", "groupAlpha", from, to)];
        for (const time of [0, 0.5, 1]) {
          assert.deepEqual(plain(api.buildTweenPreviewNodes(time)), saved, `Missing endpoint ${from} → ${to} at ${time}`);
        }
      }
    });
    await test("Group fades leave null native colors untouched and use newly edited baseline colors on the next preview", () => {
      const { api, byId } = opacityFixture();
      byId.picture.properties.imageColor = null;
      byId.caption.properties.bgColor = null;
      byId.empty.properties.unregisteredColor = { r: 1, g: 2, b: 3, a: 0.8 };
      api.tweenTracks.value = [track("group", "groupAlpha", 255, 0)];
      let preview = api.buildTweenPreviewNodes(0.5);
      assert.equal(preview.find((node) => node.id === "picture").properties.imageColor, null);
      assert.equal(preview.find((node) => node.id === "caption").properties.bgColor, null);
      assert.deepEqual(plain(preview.find((node) => node.id === "empty").properties), plain(byId.empty.properties), "Only registered native Color fields are affected");
      byId.picture.properties.imageColor = { r: 205, g: 19, b: 67, a: 0.8 };
      preview = api.buildTweenPreviewNodes(0.5);
      checkGroupColor(preview.find((node) => node.id === "picture").properties.imageColor, byId.picture.properties.imageColor, 255, 0, 0.5, "Edited image baseline");
      assert.equal(byId.picture.properties.imageColor.a, 0.8);
      byId.sibling.parentId = "group";
      preview = api.buildTweenPreviewNodes(0.5);
      checkGroupColor(preview.find((node) => node.id === "sibling").properties.imageColor, byId.sibling.properties.imageColor, 255, 0, 0.5, "Reparented image joins its new group's fade");
      byId.sibling.parentId = "root";
      preview = api.buildTweenPreviewNodes(0.5);
      assert.deepEqual(plain(preview.find((node) => node.id === "sibling").properties), plain(byId.sibling.properties), "Moving out of the group restores the original color");
    });
    await test("Group/color conflicts are detected in either insertion order without blocking geometry or independent sibling fades", () => {
      const { api } = opacityFixture();
      const conflict = (nodeId, fieldKey, otherNodeId, otherFieldKey) => tweenRegistry.getTweenTrackConflict(nodeId, fieldKey, api.nodes.value, [track(otherNodeId, otherFieldKey, 255, 0)]);
      for (const [nodeId, fieldKey] of [["picture", "imageColor"], ["caption", "fontColor"], ["caption", "bgColor"], ["caption", "outlineColor"], ["scrollText", "fontColor"], ["picture", "groupAlpha"], ["empty", "groupAlpha"]]) {
        assert.equal(typeof conflict("group", "groupAlpha", nodeId, fieldKey), "string", `New group conflicts with ${nodeId}.${fieldKey}`);
        assert.equal(typeof conflict(nodeId, fieldKey, "group", "groupAlpha"), "string", `${nodeId}.${fieldKey} conflicts with existing group`);
      }
      for (const [nodeId, fieldKey] of [["picture", "sizeDeltaX"], ["caption", "fontSize"], ["sibling", "imageColor"], ["sibling", "groupAlpha"]]) {
        assert.equal(conflict("group", "groupAlpha", nodeId, fieldKey), null, `${nodeId}.${fieldKey} is independent`);
        assert.equal(conflict(nodeId, fieldKey, "group", "groupAlpha"), null);
      }
      assert.equal(conflict("picture", "imageColor", "caption", "fontColor"), null, "Ordinary independent color tracks remain available");
      assert.equal(tweenRegistry.getTweenTrackConflict("missing", "groupAlpha", api.nodes.value, []), null);
      api.addTweenTrack(api.nodes.value.find((node) => node.id === "group"), "groupAlpha");
      const first = plain(api.tweenTracks.value);
      api.addTweenTrack(api.nodes.value.find((node) => node.id === "picture"), "imageColor");
      assert.deepEqual(plain(api.tweenTracks.value), first, "The editor cannot create a conflicting direct color track");
      api.addTweenTrack(api.nodes.value.find((node) => node.id === "sibling"), "groupAlpha");
      assert.equal(api.tweenTracks.value.length, 2, "Independent sibling group tracks can coexist");
    });
    await test("Group alpha survives project save/reload and missing values fall back to 255 without legacy layout conversion", async () => {
      const { api } = opacityFixture();
      api.tweenTracks.value = [{ ...track("group", "groupAlpha", 255, 96), startTime: 0.5, duration: 2, easeType: "OutQuad" }];
      const before = plain(api.buildTweenPreviewNodes(1.5));
      api.saveProject();
      const saved = api.getSavedProject();
      assert.equal(saved.timelineModelVersion, 10);
      assert.equal(saved.tweenTracks[0].fieldKey, "groupAlpha");
      assert.equal(saved.tweenTracks[0].initialValue, 255);
      assert.equal(saved.tweenTracks[0].endValue, 96);
      assert.equal(saved.nodes.some((node) => Object.hasOwn(node.properties, "groupAlpha")), false);
      delete saved.keyframeTracks; delete saved.animations;
      await api.loadProject({ target: { files: [{ text: async () => JSON.stringify(saved) }] } });
      assert.deepEqual(plain(api.keyframeTracks.value), keyframeTimeline.migrateTweenClipsToKeyframes(saved.tweenTracks));
      const after = plain(api.buildKeyframePreviewNodes(1.5));
      // The two samplers perform equivalent byte-alpha interpolation in a
      // different floating-point order. Compare only alpha within roundoff;
      // keep every other node field and color channel strictly identical.
      for (let index = 0; index < after.length; index += 1) {
        for (const [field, value] of Object.entries(after[index].properties)) {
          if (!value || typeof value !== "object" || !Object.hasOwn(value, "a")) continue;
          const previous = before[index].properties[field];
          assert.ok(Math.abs(value.a - previous.a) < 1e-12, `${after[index].id}.${field}.a must preserve the legacy preview`);
          value.a = previous.a;
        }
      }
      assert.deepEqual(after, before);
      for (const version of [4, 6, 7]) {
        const partial = track("group", "groupAlpha", 255, 64);
        delete partial.initialValue;
        const normalized = api.normalizeTweenTracks([partial], version);
        assert.equal(normalized[0].initialValue, 255);
        assert.equal(normalized[0].endValue, 64);
      }
    });
    const sample = process.argv[2];
    if (sample && fs.existsSync(sample)) {
      const buffer = fs.readFileSync(sample);
      const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      for (const mode of ["pc", "mobile", "controllerDesktop", "controllerMobile"]) {
        await test(`Actual GIA Topbar has anchoredPositionY = 0 on ${mode}`, async () => {
          const api = createEditor();
          api.switchDevice(mode);
          await api.loadGiaFile({ target: { files: [{ name: path.basename(sample), arrayBuffer: async () => bytes }] } });
          const top = api.nodes.value.find((node) => node.name.toLowerCase() === "topbar");
          assert.ok(top, `Topbar not found: ${api.giaImportStatus.value}`);
          assert.equal(top.anchorOffsetY, 0);
          assert.equal(api.getRuntimeLayoutValues(top).anchoredPositionY, 0);
          api.addTweenTrack(top, "anchoredPositionY");
          assert.equal(api.tweenTracks.value[0].initialValue, 0);
        });
      }
    } else {
      console.log(`SKIP actual GIA sample (${sample ? "file not found" : "pass a sample path to enable"}); synthetic regressions completed.`);
    }
  } finally {
    Module._load = originalLoad;
    if (originalTsExtension) Module._extensions[".ts"] = originalTsExtension;
    else delete Module._extensions[".ts"];
  }
  console.log(`\n${passed} client UI anchored-position checks passed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
