/* Real editor Vue setup + property computed setter + deferred undo watch. */
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
  const { descriptor, errors } = parse(fs.readFileSync(filename, "utf8"), { filename });
  assert.deepEqual(errors, []);
  const ast = ts.createSourceFile(filename + ".ts", descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = ast.statements.filter((statement) => ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement) &&
    !statement.declarationList.declarations.some((declaration) => declaration.initializer && ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(ast) === "defineComponent"))
    .map((statement) => statement.getText(ast)).join("\n");
  const watches = ast.statements.filter((statement) => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) &&
    statement.expression.expression.getText(ast) === "watch" && statement.expression.arguments[0]?.getText(ast) === "observeUndoSnapshot").map((statement) => statement.getText(ast));
  assert.equal(watches.length, 1);
  const exposed = ["updateTimelineEvents", "advanceTimelinePlayback", "eventPreviewLog", "rewindPlayback", "togglePlayback", "updateKeyframeDuration", "nodes", "selectedId", "selectedNode", "selectedKeyframeId", "selectedProperties", "inspectorNode", "animatedPropertyFields",
    "toggleAnchorPopover", "closeAnchorPopover", "anchorPopoverStyle", "anchorMenuOpen", "timelineTrackValues", "editTimelineTrackValue", "frameRate", "currentTime", "playing", "zoom", "duration", "canvasWidth", "canvasHeight", "selectedWorldPosition", "selectedRuntimeLayoutValues", "previewWorldTransforms",
    "tweenTracks", "keyframeTracks", "makeNode", "getHierarchyOrder", "applyNodeLayout", "getRuntimeLayoutValues", "readTweenFieldValue",
    "selectKeyframeTrack", "addKeyframeTrackPair", "tweenFieldPickerCombos", "tweenFieldPickerNodeId", "tweenFieldSearch", "addKeyframeTrack", "insertKeyframeAtTime", "selectKeyframe", "moveKeyframe", "updateKeyframe", "removeKeyframe", "removeKeyframeTrack", "removeSelected",
    "normalizeRotationAngle", "hasAnimatedField", "writeAnimatedValue", "updateAnimatedBaseValue", "updateGeometry", "updateRuntimeLayoutValue", "seekKeyframeTime",
    "buildKeyframePreviewNodes", "buildTweenPreviewNodes", "startMove", "startResize", "keyframePreviousValue",
    "canvasTool", "selectCanvasTool", "startCanvasTransform", "startCanvasRotation", "startCanvasScale", "canvasClientPoint", "viewportElement", "panX", "panY", "transformGizmo",
    "startCanvasPress", "canvasNodesAtPoint", "renderNodes", "isVisibleInHierarchy",
    "boneLengthHandle", "startBoneLengthDrag", "selectedDirectionArrowLength", "showContainerBones",
    "boneHoverTarget", "updateBoneHover", "updateBoneHoverKey", "clearBoneHover", "boneAttachTargetAtPoint", "boneCreateMode", "toggleBoneCreateMode", "boneParent", "boneParentId", "boneDraft", "boneRootPoint", "boneAtPoint", "createBoneFromDrag", "attachControlToBone", "handleBoneCreateKey", "selectHierarchyNode",
    "applyAnchorPreset", "currentAnchorPresetId", "propertyClipboard", "copySelectedPropertyGroup", "resetSelectedPropertyGroup", "pasteSelectedPropertyGroup",
    "beginEditorHistoryPointer", "endEditorHistoryPointer", "editorHistory", "captureUndoState", "undoEditorOperation", "redoEditorOperation",
    "serializeProject", "applyProjectData", "loadProject", "createBlankProject", "timelineEditNotice",
    "controlTemplates", "saveControlTemplate", "selectControlTemplate", "selectedControlTemplate", "templateLibraryOpen", "primitiveResourceById",
    "createGiaProject", "giaSource", "attachGiaSource", "giaExportOpen", "giaExportError",
    "animations", "activeAnimationId", "activeAnimation", "animationNotice", "animationsPanelCollapsed", "selectAnimation", "createAnimation", "duplicateAnimation", "renameAnimation", "removeAnimation",
    "openTimelineDataImport", "timelineDataImportMode", "timelineDataSource", "confirmTimelineDataImport", "exportSelectedNodeKeyframeData"];
  const script = ts.transpileModule(`${declarations}\n${watches.join("\n")}\nglobalThis.api={${exposed.join(",")}};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const converter = await import("genshin-impact-ugc-file-converter-web");
  const originalLoad = Module._load; const originalTs = Module._extensions[".ts"];
  Module._load = function (request, parent, isMain) { return request === "genshin-impact-ugc-file-converter-web" ? converter : originalLoad.call(this, request, parent, isMain); };
  Module._extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, file);
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const near = (actual, expected, label = "value") => assert.ok(Math.abs(actual - expected) < 0.00001, `${label}: ${actual} != ${expected}`);
  const tick = async () => { await vue.nextTick(); await new Promise((resolve) => setImmediate(resolve)); };
  const instances = []; let passed = 0; const failures = [];
  async function test(name, run) { try { await run(); passed++; console.log(`PASS ${name}`); } catch (error) { failures.push(error); console.error(`FAIL ${name}\n${error.stack}`); } }
  try {
    const imports = {};
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
      const source = statement.moduleSpecifier.text;
      if (!source.startsWith("./") || source.endsWith(".vue") || source === "./imageAssets") continue;
      const file = path.resolve(editor, `${source}.ts`); if (fs.existsSync(file)) Object.assign(imports, require(file));
    }
    function fixture() {
      const listeners = new Map(); const alerts = [];
      const context = vm.createContext({ ...vue, ...imports, inject: () => null, nextTick: vue.nextTick, queueMicrotask,
        toast: { info() {}, warning(message) { alerts.push(message); } }, setTimeout, clearTimeout,
        window: { innerWidth: 1200, innerHeight: 900, alert: (message) => alerts.push(message),
          addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
          removeEventListener(type, callback) { listeners.get(type)?.delete(callback); } },
        document: { createElement: () => ({ click() {} }), body: { style: {} } },
        Blob: class { constructor(parts) { this.text = parts.join(""); } }, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
      });
      const scope = vue.effectScope(); scope.run(() => vm.runInContext(script, context, { filename, timeout: 2000 }));
      const api = context.api;
      api.viewportElement.value = vue.markRaw({ clientLeft: 0, clientTop: 0, clientWidth: 1200, clientHeight: 700, getBoundingClientRect: () => ({ left: 40, top: 80, width: 1200, height: 700 }) });
      api.downloads = [];
      context.downloadLuaFile = (code, fileName) => api.downloads.push({ code, fileName });
      api.nodes.value = [
        api.makeNode("container", "Root", { id: "root", scaleX: 1, scaleY: 1, anchorOffsetX: 0, anchorOffsetY: 0, sizeDeltaX: 1600, sizeDeltaY: 900 }),
        api.makeNode("container", "Group", { id: "group", parentId: "root", scaleX: 2, scaleY: 3, scaleZ: 2, anchorOffsetX: 100, anchorOffsetY: 50, sizeDeltaX: 200, sizeDeltaY: 100 }),
        api.makeNode("image", "Image", { id: "image", parentId: "group", anchorOffsetX: 20, anchorOffsetY: 10, sizeDeltaX: 30, sizeDeltaY: 30,
          properties: { imageColor: { r: 200, g: 100, b: 0, a: 0.8 } } }),
      ];
      api.getHierarchyOrder().forEach(api.applyNodeLayout); api.keyframeTracks.value = []; api.tweenTracks.value = [];
      api.selectedId.value = "group"; api.currentTime.value = 0; api.duration.value = 5; api.zoom.value = 1;
      api.editorHistory.reset(api.captureUndoState());
      Object.assign(api, { alerts, dispatch(type, event) { for (const callback of [...listeners.get(type) ?? []]) callback(event); },
        close() { api.editorHistory.dispose(); scope.stop(); } });
      instances.push(api); return api;
    }
    const node = (api, id = "group") => api.nodes.value.find((item) => item.id === id);
    function addTrack(api, fieldKey, nodeId = "group") {
      api.addKeyframeTrack(node(api, nodeId), fieldKey);
      return api.keyframeTracks.value.find((track) => track.nodeId === nodeId && track.fieldKey === fieldKey);
    }
    const preview = (api, time, id = "group") => api.buildKeyframePreviewNodes(time).find((item) => item.id === id);
    function worldCorners(api, id = "group") {
      const pose = preview(api, api.currentTime.value, id);
      const world = api.previewWorldTransforms.value.get(id);
      const point = (x, y) => ({ x: world.x + world.matrix.a * x + world.matrix.c * y, y: world.y + world.matrix.b * x + world.matrix.d * y });
      return {
        topLeft: point(-pose.pivotX * pose.width, (1 - pose.pivotY) * pose.height),
        topRight: point((1 - pose.pivotX) * pose.width, (1 - pose.pivotY) * pose.height),
        bottomLeft: point(-pose.pivotX * pose.width, -pose.pivotY * pose.height),
        bottomRight: point((1 - pose.pivotX) * pose.width, -pose.pivotY * pose.height),
      };
    }
    function nearPoint(actual, expected, label, tolerance = 0.00001) {
      for (const axis of ["x", "y"]) assert.ok(Math.abs(actual[axis] - expected[axis]) < tolerance, `${label}.${axis}: ${actual[axis]} != ${expected[axis]}`);
    }
    const history = (api) => plain(api.editorHistory.entries.value);
    function pointer(x = 100, extras = {}) { return { button: 0, pointerId: 9, clientX: x, clientY: 20, target: { closest: () => null }, preventDefault() {}, ...extras }; }
    async function gesture(api, work) { const event = pointer(); api.beginEditorHistoryPointer(event); work(event); api.endEditorHistoryPointer(event); await tick(); }

    await test("Selecting a property row chooses its preceding key without moving the playhead or editing data", () => {
      const api = fixture(); const x = addTrack(api,'anchoredPositionX');
      x.keyframes.push({id:'later',time:2,value:120,easeType:'Linear',interpolation:'tween'});
      addTrack(api,'anchoredPositionY','image'); api.currentTime.value=3;
      const before=plain(api.keyframeTracks.value);
      api.selectKeyframeTrack(x.id);
      assert.equal(api.selectedId.value,'group'); assert.equal(api.selectedKeyframeId.value,'later');
      assert.equal(api.currentTime.value,3); assert.deepEqual(plain(api.keyframeTracks.value),before);
      api.currentTime.value=1; api.selectKeyframeTrack(x.id);
      assert.equal(api.selectedKeyframeId.value,x.keyframes[0].id); assert.equal(api.currentTime.value,1);
    });
    await test("Anchor popover opens leftward and clamps all viewport edges", () => {
      const api = fixture();
      for (const [left, top] of [[1100,800],[10,5],[1190,890]]) {
        api.closeAnchorPopover();
        api.toggleAnchorPopover({currentTarget:{getBoundingClientRect:()=>({left,top,height:52})}});
        const s = api.anchorPopoverStyle.value;
        const x = parseFloat(s.left), y = parseFloat(s.top), w = parseFloat(s.width), h = parseFloat(s.height);
        assert.ok(x >= 8 && y >= 8 && x+w <=1192 && y+h <=892);
        if(left===1100) assert.ok(x+w<left);
        assert.equal(api.anchorMenuOpen.value,true);
      }
      api.closeAnchorPopover(); assert.equal(api.anchorMenuOpen.value,false);
    });
    await test("Inline track values follow playback and write actual values as relative keys with undo", async () => {
      const api = fixture(); const track = addTrack(api, 'anchoredPositionX');
      track.keyframes[0].value = 100;
      track.keyframes.push({id:'end',time:2,value:40,relative:true,easeType:'Linear',interpolation:'tween'});
      api.currentTime.value = 1; near(api.timelineTrackValues.value[track.id], 120);
      api.currentTime.value = 3; near(api.timelineTrackValues.value[track.id], 140);
      api.editorHistory.reset(api.captureUndoState());
      await gesture(api, () => api.editTimelineTrackValue(track.id, 180));
      assert.equal(track.keyframes.length, 3); assert.equal(track.keyframes[2].relative,true);
      near(track.keyframes[2].value, 40); near(api.timelineTrackValues.value[track.id],180);
      near(node(api).anchorOffsetX,100);
      await api.editorHistory.undo(); assert.equal(api.keyframeTracks.value[0].keyframes.length,2);
      await api.editorHistory.redo(); near(api.timelineTrackValues.value[track.id],180);
      api.editTimelineTrackValue(track.id,190); assert.equal(api.keyframeTracks.value[0].keyframes.length,3);
      near(api.timelineTrackValues.value[track.id],190);
    });
    await test("Project frame rate defaults to 30 and round trips custom FPS without moving keys", () => {
      const api = fixture(); assert.equal(api.frameRate.value, 30);
      addTrack(api, 'sizeDeltaX'); const before = plain(api.keyframeTracks.value);
      api.frameRate.value = 24;
      const saved = JSON.parse(api.serializeProject());
      api.frameRate.value = 60; api.applyProjectData(JSON.stringify(saved));
      assert.equal(api.frameRate.value, 24); assert.deepEqual(plain(api.keyframeTracks.value), before);
      delete saved.frameRate; api.applyProjectData(JSON.stringify(saved)); assert.equal(api.frameRate.value, 30);
    });
    await test("XY shortcuts create independent tracks atomically, preserve existing keys and support search", async () => {
      const api = fixture(); api.currentTime.value = 1.25;
      api.tweenFieldPickerNodeId.value = 'group';
      assert.equal(api.tweenFieldPickerCombos.value.length, 2);
      api.tweenFieldSearch.value = 'sizeDelta';
      assert.equal(api.tweenFieldPickerCombos.value[0].label, '大小 XY');
      await gesture(api, () => api.addKeyframeTrackPair(node(api), ['sizeDeltaX', 'sizeDeltaY']));
      assert.equal(api.keyframeTracks.value.length, 2);
      assert.deepEqual(plain(api.keyframeTracks.value.map(t => t.keyframes[0].time)), [1.25, 1.25]);
      api.undoEditorOperation(); await tick(); assert.equal(api.keyframeTracks.value.length, 0);
      api.redoEditorOperation(); await tick(); assert.equal(api.keyframeTracks.value.length, 2);
      const first = addTrack(api, 'anchoredPositionX'); const original = plain(first);
      await gesture(api, () => api.addKeyframeTrackPair(node(api), ['anchoredPositionX', 'anchoredPositionY']));
      assert.equal(api.keyframeTracks.value.length, 4); assert.deepEqual(plain(first), original);
      api.addKeyframeTrackPair(node(api), ['anchoredPositionX', 'anchoredPositionY']);
      assert.equal(api.keyframeTracks.value.length, 4);
      api.tweenFieldSearch.value = ''; api.tweenFieldPickerNodeId.value = 'group';
      assert.equal(api.tweenFieldPickerCombos.value.length, 0);
    });
    await test("Event editing persists, undoes, duplicates independently and clears deleted targets", async () => {
      const api = fixture();
      const event = {id:'event1',time:2,name:'音效',nodeId:'image',params:'12'};
      api.editorHistory.reset(api.captureUndoState());
      await gesture(api, () => api.updateTimelineEvents([event]));
      assert.equal(api.activeAnimation.value.events.length, 1);
      await api.undoEditorOperation(); assert.equal(api.activeAnimation.value.events?.length ?? 0, 0);
      await api.redoEditorOperation(); assert.equal(api.activeAnimation.value.events[0].name, '音效');
      const saved = api.serializeProject(); api.applyProjectData(saved);
      assert.deepEqual(plain(api.activeAnimation.value.events), [event]);
      api.duplicateAnimation(); assert.notEqual(api.activeAnimation.value.events[0].id, event.id);
      api.activeAnimation.value.events[0].params = '44';
      assert.equal(api.animations.value[0].events[0].params, '12');
      api.selectedId.value = 'group'; api.removeSelected();
      assert.ok(api.animations.value.every(a => a.events.length === 0));
    });
    await test("Events fire over crossed playback intervals, preserve ties and restart at zero; seeking never fires", () => {
      const api = fixture();
      api.updateTimelineEvents([0,2,2,5].map((time,i) => ({id:'e'+i,time,name:'E'+i,nodeId:null,params:''})));
      const snapshot = api.captureUndoState();
      api.advanceTimelinePlayback(0); assert.equal(api.eventPreviewLog.value.length,1);
      api.advanceTimelinePlayback(2.5); assert.equal(api.eventPreviewLog.value.length,3);
      assert.ok(api.eventPreviewLog.value[1].includes('E1')); assert.ok(api.eventPreviewLog.value[2].includes('E2'));
      api.seekKeyframeTime(4); assert.equal(api.eventPreviewLog.value.length,3);
      api.advanceTimelinePlayback(1); assert.equal(api.eventPreviewLog.value.length,5); assert.equal(api.currentTime.value,0);
      api.advanceTimelinePlayback(0); assert.equal(api.eventPreviewLog.value.length,5);
      assert.equal(api.captureUndoState(), snapshot);
      api.updateKeyframeDuration(1); assert.equal(api.duration.value,5);
      api.rewindPlayback(); api.advanceTimelinePlayback(0); assert.equal(api.eventPreviewLog.value.length,1);
    });
    await test("Event-only Lua exports and imports through the actual editor entry points", () => {
      const api = fixture(); api.selectedId.value = 'root';
      api.updateTimelineEvents([{id:'e1',time:1,name:'Event',nodeId:'image',params:''}]);
      api.exportSelectedNodeKeyframeData(); assert.equal(api.downloads.length,1);
      const source = api.downloads[0].code;
      api.updateTimelineEvents([]); api.openTimelineDataImport(); api.timelineDataSource.value = source;
      api.confirmTimelineDataImport(); assert.equal(api.activeAnimation.value.events.length,1);
      assert.equal(api.activeAnimation.value.events[0].nodeId,'image'); assert.equal(api.keyframeTracks.value.length,0);
    });
    await test("Loading retired scale lanes keeps static scale, other animations and reports the migration", () => {
      const api = fixture(); addTrack(api, "sizeDeltaX");
      const data = JSON.parse(api.serializeProject());
      for (const fieldKey of ["localScaleX", "localScaleY"]) data.animations[0].keyframeTracks.push({
        id: fieldKey, nodeId: "group", fieldKey, keyframes: [{ id: fieldKey + "-key", time: 0, value: 8, easeType: "Linear", interpolation: "tween" }],
      });
      const source = JSON.stringify(data);
      api.applyProjectData(source);
      assert.equal(api.keyframeTracks.value.length, 1);
      assert.equal(api.keyframeTracks.value[0].fieldKey, "sizeDeltaX");
      near(node(api).scaleX, 2); near(node(api).scaleY, 3);
      assert.match(api.timelineEditNotice.value, /已移除 2 条/);
      assert.ok(api.alerts.some(message => message.includes("已移除 2 条")));
      api.selectedId.value = "group";
      api.updateAnimatedBaseValue("localScaleX", -1.5); api.updateAnimatedBaseValue("localScaleY", 0);
      near(node(api).scaleX, -1.5); near(node(api).scaleY, 0);
      assert.equal(api.keyframeTracks.value.length, 1, "Static edits cannot add keys");
      assert.equal(JSON.stringify(data), source, "Original imported project stays recoverable");
    });
    await test("Bone mode starts at root, previews without mutations, creates a chain and supports undo and JSON", async () => {
      const api = fixture(); api.toggleBoneCreateMode();
      assert.equal(api.boneParent.value.id, "root"); assert.ok(api.boneRootPoint.value);
      assert.equal(api.transformGizmo.value, null); assert.equal(api.boneLengthHandle.value, null);
      const begin = { x: 700, y: 400 }, end = { x: 820, y: 490 };
      const press = (p, extra = {}) => { const screen = api.canvasClientPoint(p.x, p.y); return pointer(screen.x, { clientY: screen.y, ...extra }); };
      await gesture(api, () => {
        api.startCanvasPress(press(begin)); api.dispatch("pointermove", press(end));
        assert.equal(api.nodes.value.length, 3); assert.ok(api.boneDraft.value);
        api.dispatch("pointerup", press(end));
      });
      const first = api.selectedNode.value;
      assert.equal(first.type, "container"); assert.equal(first.parentId, "root");
      near(first.width, 150); near(first.height, 25); near(first.editor.directionArrowLength, 150);
      assert.equal(first.pivotX, 0); assert.equal(first.pivotY, .5);
      const world = api.previewWorldTransforms.value.get(first.id);
      nearPoint(world, begin, "Bone pivot");
      nearPoint({ x: world.x + world.matrix.a * first.width, y: world.y + world.matrix.b * first.width }, end, "Bone tip");
      assert.equal(api.boneDraft.value, null); assert.equal(history(api).length, 1);
      const tip = { x: end.x - 60, y: end.y + 80 };
      await gesture(api, () => { api.startCanvasPress(press(end)); api.dispatch("pointerup", press(tip)); });
      const secondId = api.selectedNode.value.id;
      assert.equal(api.selectedNode.value.parentId, first.id); near(api.selectedNode.value.width, 100);
      await api.editorHistory.undo(); assert.equal(api.nodes.value.some(n => n.id === secondId), false);
      await api.editorHistory.redo(); assert.equal(api.nodes.value.find(n => n.id === secondId).parentId, first.id);
      const saved = api.serializeProject(); api.applyProjectData(saved);
      assert.equal(api.boneCreateMode.value, false); near(api.nodes.value.find(n => n.id === secondId).editor.directionArrowLength, 100);
    });
    await test("Bone Ctrl hover previews the same target as clicking and clears on release, leave and mode exit", async () => {
      const api = fixture(); api.toggleBoneCreateMode(); await tick();
      api.selectHierarchyNode(node(api));
      const image = node(api, 'image');
      const world = api.previewWorldTransforms.value.get(image.id);
      const screen = api.canvasClientPoint(world.x, world.y);
      const saved = api.serializeProject();
      api.updateBoneHover({clientX:screen.x,clientY:screen.y,ctrlKey:false});
      assert.equal(api.boneHoverTarget.value, null);
      api.updateBoneHoverKey({ctrlKey:true});
      assert.equal(api.boneHoverTarget.value.id, image.id);
      assert.equal(api.boneAttachTargetAtPoint(screen.x, screen.y).id, image.id);
      assert.equal(api.serializeProject(), saved);
      api.updateBoneHoverKey({ctrlKey:false}); assert.equal(api.boneHoverTarget.value,null);
      api.updateBoneHoverKey({ctrlKey:true}); api.clearBoneHover(); assert.equal(api.boneHoverTarget.value,null);
      api.updateBoneHover({clientX:screen.x,clientY:screen.y,ctrlKey:true});
      api.toggleBoneCreateMode(); assert.equal(api.boneHoverTarget.value,null);
    });
    await test("Bone clicks change parent, Ctrl-click attaches a control without changing its world transform, and undo restores it", async () => {
      const api = fixture(); api.toggleBoneCreateMode();
      const bone = api.createBoneFromDrag(node(api, "root"), {x:600,y:300}, {x:700,y:400});
      api.createBoneFromDrag(bone, {x:700,y:400}, {x:800,y:400});
      const press = (p, extra = {}) => { const screen = api.canvasClientPoint(p.x, p.y); return pointer(screen.x, { clientY: screen.y, ...extra }); };
      api.startCanvasPress(press({x:650,y:350})); api.dispatch("pointerup", press({x:650,y:350}));
      assert.equal(api.boneParent.value.id, bone.id);
      const image = node(api, "image"), before = plain(api.previewWorldTransforms.value.get(image.id));
      api.editorHistory.reset(api.captureUndoState());
      await gesture(api, () => { api.startCanvasPress(press(before, {ctrlKey:true})); api.dispatch("pointerup", press(before, {ctrlKey:true})); });
      assert.equal(image.parentId, bone.id); assert.equal(api.boneParent.value.id, bone.id);
      const after = api.previewWorldTransforms.value.get(image.id);
      nearPoint(after, before, "Attached pivot", .02);
      for (const field of ["a", "b", "c", "d"]) near(after.matrix[field], before.matrix[field]);
      await api.editorHistory.undo(); assert.equal(node(api,"image").parentId, "group");
      await api.editorHistory.redo(); assert.equal(node(api,"image").parentId, bone.id);
      assert.equal(api.attachControlToBone(node(api,"root")), false);
      assert.equal(api.attachControlToBone(bone), false);
      api.selectHierarchyNode(api.nodes.value.find(n => n.parentId === bone.id && n.type === "container"));
      assert.equal(api.attachControlToBone(bone), false, "Cannot form a cycle");
      api.selectHierarchyNode(bone);
      node(api, bone.id).scaleX = 2;
      const shearBefore = api.serializeProject();
      assert.equal(api.attachControlToBone(node(api,"group")), false, "Cannot discard shear while reparenting");
      assert.equal(api.serializeProject(), shearBefore);
      node(api, bone.id).scaleX = 1;
      api.selectHierarchyNode(node(api,"group")); assert.equal(api.boneParent.value.id,"group");
    });
    await test("Bone creation handles transformed parents, zoom, cancellation, lock and singular scale", () => {
      const api = fixture(); api.zoom.value = .4; api.panX.value = 70; api.panY.value = -40;
      node(api).rotation = 35; node(api).scaleX = -2;
      api.toggleBoneCreateMode(); api.selectHierarchyNode(node(api));
      const begin = {x:710,y:410}, end = {x:850,y:540};
      const press = (p, extra = {}) => { const screen = api.canvasClientPoint(p.x,p.y); return pointer(screen.x,{clientY:screen.y,...extra}); };
      api.startCanvasPress(press(begin)); api.dispatch("pointermove",press(end,{pointerId:99})); assert.equal(api.boneDraft.value,null);
      api.dispatch("pointermove",press(end)); assert.ok(api.boneDraft.value);
      api.dispatch("pointercancel",press(end)); assert.equal(api.nodes.value.length,3); assert.equal(api.boneDraft.value,null);
      api.startCanvasPress(press(begin)); api.dispatch("pointermove",press(end)); api.dispatch("blur",{});
      api.dispatch("pointerup",press(end)); assert.equal(api.nodes.value.length,3);
      api.startCanvasPress(press(begin)); api.dispatch("pointermove",press(end)); api.handleBoneCreateKey({key:"Escape"});
      api.dispatch("pointerup",press(end)); assert.equal(api.nodes.value.length,3); assert.equal(api.boneCreateMode.value,false);
      api.toggleBoneCreateMode(); api.selectHierarchyNode(node(api));
      const bone = api.createBoneFromDrag(node(api),begin,end), world = api.previewWorldTransforms.value.get(bone.id);
      nearPoint(world,begin,"Transformed start",.02);
      nearPoint({x:world.x+world.matrix.a*bone.width,y:world.y+world.matrix.b*bone.width},end,"Transformed end",.02);
      node(api).locked = true; assert.equal(api.createBoneFromDrag(node(api),begin,end),null);
      node(api).locked = false; node(api).scaleX = 0; assert.equal(api.createBoneFromDrag(node(api),begin,end),null);
    });

    await test("Visibility keyframes persist false, undo edits and scrub parent/child visibility without mutating setup", async () => {
      const api = fixture(); api.currentTime.value = 2;
      const track = addTrack(api, "visible");
      const hide = track.keyframes[0];
      assert.equal(hide.value, true); assert.equal(hide.interpolation, "step");
      api.editorHistory.reset(api.captureUndoState());
      api.updateKeyframe(track.id, hide.id, { value: false, interpolation: "tween" }); await tick();
      assert.equal(hide.value, false); assert.equal(hide.interpolation, "step");
      assert.equal(api.renderNodes.value.some(item => item.id === "group" || item.id === "image"), false);
      assert.equal(node(api).visible, true); assert.equal(node(api, "image").visible, true);
      await api.editorHistory.undo(); assert.equal(api.keyframeTracks.value[0].keyframes[0].value, true);
      await api.editorHistory.redo(); assert.equal(api.keyframeTracks.value[0].keyframes[0].value, false);
      const active = api.keyframeTracks.value[0];
      api.insertKeyframeAtTime(active.id, 4);
      const show = active.keyframes.find(item => item.time === 4);
      assert.equal(show.value, false); assert.equal(show.interpolation, "step");
      api.updateKeyframe(active.id, show.id, { value: true });
      for (const [time, visible] of [[0, true], [1.99999, true], [2, false], [3.99999, false], [4, true], [1, true]]) {
        api.seekKeyframeTime(time);
        assert.equal(api.isVisibleInHierarchy(node(api, "image")), visible);
        assert.equal(api.renderNodes.value.some(item => item.id === "group"), visible);
      }
      node(api, "image").visible = false;
      api.seekKeyframeTime(4); assert.equal(api.isVisibleInHierarchy(node(api, "image")), false);
      const saved = api.serializeProject();
      api.applyProjectData(api.createBlankProject("Empty")); api.applyProjectData(saved);
      assert.equal(api.keyframeTracks.value[0].keyframes[0].value, false);
      assert.equal(api.keyframeTracks.value[0].keyframes[1].value, true);
      api.selectedId.value = "root"; api.exportSelectedNodeKeyframeData();
      assert.match(api.downloads[0].code, /"visible"/);
      assert.match(api.downloads[0].code, /2, false, false, "Linear", "step"/);
    });

    const templateAsset = () => ({ id: "template-test", index: 7, name: "任务图标", sourceName: "task.gia", warnings: [], devices: [0, 1, 2, 3].map(() => [{
      sourceNodeIndex: 1, parentSourceNodeIndex: null, childSourceNodeIndices: [], name: "Root", type: "container", properties: {},
      layout: { active: true, scaleX: .25, scaleY: .25, scaleZ: 1, rotationX: 0, rotationY: 0, rotationZ: 0,
        anchorMinX: .5, anchorMinY: .5, anchorMaxX: .5, anchorMaxY: .5, anchoredPositionX: 0, anchoredPositionY: 0,
        sizeDeltaX: 150, sizeDeltaY: 150, pivotX: .5, pivotY: .5 },
    }]) });
    await test("Control templates import, select at native size, serialize and reopen with all device layouts", async () => {
      const api = fixture(); const asset = templateAsset();
      api.saveControlTemplate(asset); await tick();
      assert.equal(api.controlTemplates.value.length, 1);
      await api.editorHistory.undo(); assert.equal(api.controlTemplates.value.length, 0);
      await api.editorHistory.redo(); assert.equal(api.controlTemplates.value[0].index, 7);
      const reference = api.makeNode("reference", "引用", { id: "reference", parentId: "root" });
      api.nodes.value.push(reference); api.selectedId.value = reference.id;
      api.editorHistory.reset(api.captureUndoState());
      api.selectControlTemplate(7); await tick();
      assert.equal(api.selectedNode.value.properties.referencedPrefabIndex, 7);
      near(api.selectedNode.value.width, 37.5); near(api.selectedNode.value.height, 37.5);
      assert.equal(history(api).length, 1, "Reference and initial dimensions form one undo operation");
      await api.editorHistory.undo(); assert.equal(api.selectedNode.value.properties.referencedPrefabIndex, null);
      await api.editorHistory.redo(); assert.equal(api.selectedControlTemplate.value.name, asset.name);
      const serialized = api.serializeProject();
      api.applyProjectData(api.createBlankProject("Empty")); assert.equal(api.controlTemplates.value.length, 0);
      api.applyProjectData(serialized); api.selectedId.value = "reference";
      assert.deepEqual(plain(api.controlTemplates.value), [asset]);
      assert.equal(api.selectedControlTemplate.value.name, asset.name);
    });
    await test("Changing a template index updates its references atomically and duplicate indices cannot overwrite resources", async () => {
      const api = fixture(); const asset = templateAsset(); api.saveControlTemplate(asset);
      api.nodes.value.push(api.makeNode("reference", "引用", { id: "reference", properties: { referencedPrefabIndex: 7 } }));
      api.editorHistory.reset(api.captureUndoState());
      api.saveControlTemplate({ ...asset, index: 12 }); await tick();
      assert.equal(node(api, "reference").properties.referencedPrefabIndex, 12);
      await api.editorHistory.undo(); assert.equal(node(api, "reference").properties.referencedPrefabIndex, 7);
      assert.equal(api.controlTemplates.value[0].index, 7);
      await api.editorHistory.redo(); assert.equal(api.controlTemplates.value[0].index, 12);
      const before = api.serializeProject(); api.saveControlTemplate({ ...asset, id: "duplicate", index: 12 });
      assert.equal(api.serializeProject(), before); assert.match(api.alerts.at(-1), /已被其他模板使用/);
    });
    await test("Invalid template libraries reject before mutating the current project; older files clear the library", () => {
      const api = fixture(); api.saveControlTemplate(templateAsset());
      const before = api.serializeProject(), invalid = JSON.parse(before);
      invalid.controlTemplates[0].devices[0][0].parentSourceNodeIndex = 1;
      assert.throws(() => api.applyProjectData(JSON.stringify(invalid)), /循环/);
      assert.equal(api.serializeProject(), before);
      const legacy = JSON.parse(before); delete legacy.controlTemplates;
      api.applyProjectData(JSON.stringify(legacy)); assert.equal(api.controlTemplates.value.length, 0);
    });
    for (const sample of process.argv.slice(2)) await test(`Native GIA source survives the real editor's import, rebase, JSON reload and animation preview: ${path.basename(sample)}`, async () => {
      const api = fixture(), bytes = fs.readFileSync(sample), arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const file = { name: path.basename(sample), arrayBuffer: async () => arrayBuffer };
      const project = await api.createGiaProject(file); api.applyProjectData(project);
      const source = plain(api.giaSource.value), loadedNodes = plain(api.nodes.value), original = imports.importGiaControls(arrayBuffer);
      const runExport = () => imports.exportGiaUI({ name: original.projectName, uiIndex: imports.originalGiaUIIndex(api.giaSource.value), deviceIndex: 0, source: api.giaSource.value, nodes: api.nodes.value });
      let exported = runExport();
      assert.deepEqual(imports.importGiaControls(exported.bytes.buffer).controls, original.controls, "Initial editor rounding must not rewrite unchanged original floats");
      const serialized = api.serializeProject(); api.applyProjectData(api.createBlankProject("Empty")); api.applyProjectData(serialized);
      assert.deepEqual(plain(api.giaSource.value), source);
      assert.deepEqual(plain(api.nodes.value), loadedNodes);
      exported = runExport(); assert.deepEqual(imports.importGiaControls(exported.bytes.buffer).controls, original.controls);
      const image = api.nodes.value.find(node => node.type === "image");
      api.selectedId.value = image.id; addTrack(api, "localEulerAnglesZ", image.id);
      api.currentTime.value = 2; api.updateAnimatedBaseValue("localEulerAnglesZ", 90);
      exported = runExport(); assert.deepEqual(imports.importGiaControls(exported.bytes.buffer).controls, original.controls, "Export uses setup, not animation preview");
      const legacy = JSON.parse(serialized); delete legacy.giaSource; api.applyProjectData(JSON.stringify(legacy));
      api.giaExportOpen.value = true; await api.attachGiaSource(file);
      assert.equal(api.giaExportError.value, "");
      assert.deepEqual(plain(api.nodes.value), loadedNodes, "Attaching provenance cannot overwrite live edits");
      exported = runExport(); assert.deepEqual(imports.importGiaControls(exported.bytes.buffer).controls, original.controls);
    });

    await test("Custom primitive image references survive JSON, history and animation without being converted into native images", async () => {
      const api = fixture();
      const primitive = api.makeNode("primitive", "图元", { id: "primitive", parentId: "root" });
      api.nodes.value.push(primitive); api.selectedId.value = primitive.id; api.editorHistory.reset(api.captureUndoState());
      const source = "data:image/png;base64,iVBORw0KGgo=";
      api.selectedProperties.value = { imageUrl: source }; await tick();
      assert.equal(api.selectedNode.value.type, "primitive"); assert.equal(api.selectedNode.value.properties.imageUrl, source);
      await api.editorHistory.undo(); assert.equal(api.selectedNode.value.properties.imageUrl, "");
      await api.editorHistory.redo(); assert.equal(api.selectedNode.value.properties.imageUrl, source);
      const saved = api.serializeProject(); api.applyProjectData(api.createBlankProject("Empty")); api.applyProjectData(saved); api.selectedId.value = "primitive";
      assert.equal(api.selectedNode.value.type, "primitive"); assert.equal(api.primitiveResourceById.value.get(api.selectedNode.value.properties.imageResourceId).imageUrl, source);
      addTrack(api, "localScaleX", "primitive"); api.currentTime.value = 2; api.updateAnimatedBaseValue("localScaleX", 2);
      near(preview(api, 2, "primitive").scaleX, 2);
      assert.equal(api.primitiveResourceById.value.get(preview(api, 2, "primitive").properties.imageResourceId).imageUrl, source);
    });
    await test("New property tracks seed a real current-time key and mark only that property as animated", () => {
      const api = fixture(); const before = plain(api.nodes.value); api.currentTime.value = 1.25;
      const track = addTrack(api, "localScaleZ");
      assert.ok(track); assert.equal(track.keyframes.length, 1); assert.equal(track.keyframes[0].time, 1.25); assert.equal(track.keyframes[0].value, 2);
      assert.equal(api.hasAnimatedField("localScaleZ"), true); assert.equal(api.hasAnimatedField("localScaleY"), false);
      api.addKeyframeTrack(node(api), "localScaleZ"); assert.equal(api.keyframeTracks.value.length, 1);
      assert.deepEqual(plain(api.nodes.value), before);
      assert.equal(api.selectedKeyframeId.value, track.keyframes[0].id);
    });
    for (const sample of [
      { field: "fillAmount", kind: "numeric", first: 0.1, later: 0.75, revised: 0.8, midpoint: 0.45 },
      { field: "imageColor", kind: "color", first: { r: 200, g: 100, b: 20, a: 0.8 }, later: { r: 0, g: 50, b: 100, a: 0.25 }, revised: { r: 20, g: 40, b: 100, a: 0.2 }, midpoint: { r: 110, g: 70, b: 60, a: 0.5 } },
    ]) {
      await test(`Unset ${sample.kind} tracks retain null keys and accept later property input without overwriting setup`, () => {
        const api = fixture(); const image = node(api, "image"); image.properties[sample.field] = null;
        const setup = plain(api.nodes.value); const track = addTrack(api, sample.field, "image");
        assert.equal(track.keyframes.length, 1); assert.equal(track.keyframes[0].time, 0);
        assert.equal(track.keyframes[0].value, null, "An unset field must not be replaced by numeric zero or a fabricated color");
        assert.equal(api.selectedProperties.value[sample.field], null);
        assert.deepEqual(plain(api.nodes.value), setup);
        const originalId = track.keyframes[0].id;

        // Exercise the real inspector setter: inserting after a null first key
        // must still create a writable key at the current playhead.
        api.currentTime.value = 2;
        api.selectedProperties.value = { ...api.selectedProperties.value, [sample.field]: sample.later };
        assert.equal(track.keyframes.length, 2); assert.equal(track.keyframes[1].time, 2);
        assert.equal(track.keyframes[0].value, null); assert.equal(track.keyframes[0].id, originalId);
        assert.deepEqual(plain(track.keyframes[1].value), sample.later);
        assert.deepEqual(plain(api.selectedProperties.value[sample.field]), sample.later);
        const laterId = track.keyframes[1].id;
        api.selectedProperties.value = { ...api.selectedProperties.value, [sample.field]: sample.revised };
        assert.equal(track.keyframes.length, 2); assert.equal(track.keyframes[1].id, laterId);
        assert.deepEqual(plain(track.keyframes[1].value), sample.revised);
        assert.equal(JSON.parse(api.serializeProject()).keyframeTracks[0].keyframes[0].value, null, "Saving must preserve the still-unset first key");
        api.currentTime.value = 1;
        assert.equal(api.selectedProperties.value[sample.field], null, "An incomplete segment must not invent an interpolated value");
        assert.deepEqual(plain(api.nodes.value), setup);

        // Filling the original placeholder reuses its identity and unlocks
        // interpolation; it never turns the keyed value into a setup write.
        api.currentTime.value = 0;
        api.selectedProperties.value = { ...api.selectedProperties.value, [sample.field]: sample.first };
        assert.equal(track.keyframes.length, 2); assert.equal(track.keyframes[0].id, originalId);
        assert.deepEqual(plain(track.keyframes[0].value), sample.first);
        api.currentTime.value = 1;
        const displayed = api.selectedProperties.value[sample.field];
        if (sample.kind === "numeric") near(displayed, sample.midpoint);
        else for (const channel of ["r", "g", "b", "a"]) near(displayed[channel], sample.midpoint[channel], channel);
        assert.deepEqual(plain(api.nodes.value), setup, "Completing and editing keyframes cannot fill the original null setup field");
      });
    }
    await test("Empty animated lanes auto-key inspector edits without changing setup or duplicating lanes", async () => {
      const api = fixture(); api.selectedId.value = 'image';
      const track = addTrack(api, 'imageColor', 'image'); track.keyframes = [];
      const setup = plain(node(api, 'image').properties.imageColor);
      api.currentTime.value = 2.25;
      assert.ok(api.hasAnimatedField('imageColor'));
      assert.ok(api.animatedPropertyFields.value.includes('imageColor'));
      api.editorHistory.reset(api.captureUndoState());
      await gesture(api, () => { api.selectedProperties.value = {...api.selectedProperties.value, imageColor:{r:1,g:2,b:3,a:0.5}}; });
      assert.equal(track.keyframes.length, 1); assert.equal(track.keyframes[0].time, 2.25);
      assert.deepEqual(plain(node(api, 'image').properties.imageColor), setup);
      assert.match(api.timelineEditNotice.value, /2.25.*自动添加关键帧/);
      await api.editorHistory.undo(); assert.equal(api.keyframeTracks.value[0].keyframes.length, 0);
      await api.editorHistory.redo(); assert.equal(api.keyframeTracks.value[0].keyframes.length, 1);
    });
    await test("Editing an animated parameter creates one key at the playhead and updates that key on repeated edits", () => {
      const api = fixture(); const track = addTrack(api, "localScaleZ"); const before = plain(api.nodes.value);
      api.currentTime.value = 2; api.updateAnimatedBaseValue("localScaleZ", 3);
      assert.equal(track.keyframes.length, 2); const id = track.keyframes[1].id;
      api.updateAnimatedBaseValue("localScaleZ", 4);
      assert.equal(track.keyframes.length, 2); assert.equal(track.keyframes[1].id, id); assert.equal(track.keyframes[1].value, 4);
      near(preview(api, 1).scaleZ, 3); near(preview(api, 2).scaleZ, 4);
      assert.deepEqual(plain(api.nodes.value), before);
    });
    await test("Switching relative mode preserves the pose and later increments resolve from the preceding key", () => {
      const api = fixture(); const track = addTrack(api, "localScaleZ");
      api.currentTime.value = 1; api.updateAnimatedBaseValue("localScaleZ", 3);
      api.currentTime.value = 2; api.updateAnimatedBaseValue("localScaleZ", 5);
      const before = [0, 0.5, 1, 1.5, 2].map((time) => preview(api, time).scaleZ);
      api.updateKeyframe(track.id, track.keyframes[1].id, { relative: true });
      api.updateKeyframe(track.id, track.keyframes[2].id, { relative: true });
      assert.equal(track.keyframes[1].value, 1); assert.equal(track.keyframes[2].value, 2);
      assert.deepEqual([0, 0.5, 1, 1.5, 2].map((time) => preview(api, time).scaleZ), before);
      api.currentTime.value = 3; api.updateAnimatedBaseValue("localScaleZ", 6);
      const last = track.keyframes.at(-1); assert.equal(last.relative, true); assert.equal(last.value, 1);
      api.updateKeyframe(track.id, track.keyframes[1].id, { value: 2 });
      near(preview(api, 1).scaleZ, 4); near(preview(api, 2).scaleZ, 6); near(preview(api, 3).scaleZ, 7);
      assert.equal(node(api).scaleZ, 2);
    });
    await test("Seek and playback expose animated inspector values without mutating bases or creating undo records", async () => {
      const api = fixture(); addTrack(api, "localScaleZ"); api.currentTime.value = 2; api.updateAnimatedBaseValue("localScaleZ", 4);
      api.editorHistory.reset(api.captureUndoState()); const before = api.captureUndoState();
      for (const [time, value] of [[0, 2], [1, 3], [2, 4], [4, 4], [0.5, 2.5]]) {
        api.seekKeyframeTime(time); api.playing.value = true; api.zoom.value = 0.7; await tick();
        near(api.inspectorNode.value.scaleZ, value); assert.equal(api.captureUndoState(), before); assert.equal(history(api).length, 0);
      }
    });
    await test("The actual selectedProperties setter keys color while keeping non-animated fields on the base model", () => {
      const api = fixture(); addTrack(api, "imageColor", "image"); const baseColor = plain(node(api, "image").properties.imageColor);
      api.currentTime.value = 2;
      api.selectedProperties.value = { ...api.selectedProperties.value, imageColor: { r: 0, g: 50, b: 100, a: 0.2 } };
      assert.equal(api.keyframeTracks.value[0].keyframes.length, 2);
      assert.deepEqual(plain(node(api, "image").properties.imageColor), baseColor);
      api.currentTime.value = 1;
      const color = api.selectedProperties.value.imageColor;
      near(color.r, 100); near(color.g, 75); near(color.b, 50); near(color.a, 0.5);
      api.selectedProperties.value = { ...api.selectedProperties.value, imageType: "stretch" };
      assert.equal(node(api, "image").properties.imageType, "stretch");
      assert.equal(api.keyframeTracks.value[0].keyframes.length, 2, "Writing another property must not capture a displayed color midpoint");
      assert.deepEqual(plain(api.animatedPropertyFields.value), ["imageColor"]);
    });
    await test("World-position and runtime edits write the proper parent-relative keyed coordinates", () => {
      const api = fixture(); addTrack(api, "anchoredPositionX", "image"); addTrack(api, "anchoredPositionY", "image");
      const base = plain(node(api, "image")); api.currentTime.value = 2;
      api.updateGeometry("x", 1000); api.updateRuntimeLayoutValue("anchoredPositionY", -15);
      const x = api.keyframeTracks.value.find((track) => track.fieldKey === "anchoredPositionX");
      const y = api.keyframeTracks.value.find((track) => track.fieldKey === "anchoredPositionY");
      near(x.keyframes.at(-1).value, 50); near(y.keyframes.at(-1).value, -15);
      near(api.selectedWorldPosition.value.x, 1000); near(api.selectedWorldPosition.value.y, 455);
      near(api.selectedRuntimeLayoutValues.value.anchoredPositionX, 50); near(api.selectedRuntimeLayoutValues.value.anchoredPositionY, -15);
      assert.deepEqual(plain(node(api, "image")), base);
    });
    await test("Animated stretched size fields convert displayed width to true sizeDelta without modifying base anchors", () => {
      const api = fixture(); const image = node(api, "image"); Object.assign(image, { anchorMinX: 0, anchorMaxX: 1 }); api.applyNodeLayout(image);
      addTrack(api, "sizeDeltaX", "image"); const before = plain(api.nodes.value);
      api.currentTime.value = 2; api.updateGeometry("width", 280);
      assert.equal(api.keyframeTracks.value[0].keyframes.at(-1).value, 80);
      near(preview(api, 2, "image").width, 280); assert.deepEqual(plain(api.nodes.value), before);
    });
    await test("Dragging an animated canvas node makes one key and one undo command across all move events", async () => {
      const api = fixture(); addTrack(api, "anchoredPositionX"); addTrack(api, "anchoredPositionY"); api.currentTime.value = 2;
      api.editorHistory.reset(api.captureUndoState()); const before = api.captureUndoState(); const beforeNodes = plain(api.nodes.value);
      const event = pointer(); api.beginEditorHistoryPointer(event); api.startMove(event, node(api));
      for (const x of [120, 150, 180]) { api.dispatch("pointermove", pointer(x)); await tick(); assert.equal(history(api).length, 0); }
      api.dispatch("pointerup", pointer(180)); api.endEditorHistoryPointer(pointer(180)); await tick();
      const after = api.captureUndoState(); assert.equal(history(api).length, 1);
      const x = api.keyframeTracks.value.find((track) => track.fieldKey === "anchoredPositionX");
      assert.equal(x.keyframes.length, 2); assert.equal(x.keyframes.at(-1).time, 2); near(x.keyframes.at(-1).value, 180);
      assert.deepEqual(plain(api.nodes.value), beforeNodes);
      await api.undoEditorOperation(); assert.equal(api.captureUndoState(), before);
      await api.redoEditorOperation(); assert.equal(api.captureUndoState(), after);
    });
    await test("Deleting keys, entire tracks and containers preserves the correct remaining animation and undo snapshot", async () => {
      const api = fixture(); const groupTrack = addTrack(api, "localScaleZ"); addTrack(api, "sizeDeltaX", "image");
      api.currentTime.value = 1; api.writeAnimatedValue(node(api), "localScaleZ", 3);
      api.editorHistory.reset(api.captureUndoState()); const before = api.captureUndoState();
      await gesture(api, () => api.removeKeyframe(groupTrack.id, groupTrack.keyframes[1].id));
      assert.equal(api.keyframeTracks.value.find((track) => track.id === groupTrack.id).keyframes.length, 1);
      await api.undoEditorOperation(); assert.equal(api.captureUndoState(), before);
      await gesture(api, () => api.removeKeyframeTrack(groupTrack.id)); assert.equal(api.hasAnimatedField("localScaleZ", "group"), false);
      await api.undoEditorOperation(); assert.equal(api.captureUndoState(), before);
      api.selectedId.value = "group"; await gesture(api, () => api.removeSelected());
      assert.equal(api.keyframeTracks.value.length, 0); assert.equal(api.nodes.value.length, 1);
      await api.undoEditorOperation(); assert.equal(api.captureUndoState(), before);
    });
    await test("Current keyframe projects round-trip raw values, relative modes, interpolation and setup nodes", async () => {
      const api = fixture(); const track = addTrack(api, "sizeDeltaX"); api.currentTime.value = 2; api.updateAnimatedBaseValue("sizeDeltaX", 260);
      api.updateKeyframe(track.id, track.keyframes[0].id, { interpolation: "step", easeType: "OutQuad" });
      api.updateKeyframe(track.id, track.keyframes[1].id, { relative: true });
      const saved = api.serializeProject(); const before = plain(api.keyframeTracks.value); const base = plain(api.nodes.value);
      const values = [0, 1, 2, 4].map((time) => preview(api, time).sizeDeltaX);
      await api.loadProject({ target: { files: [{ name: "keyframes.json", text: async () => saved }] } });
      assert.equal(api.alerts.length, 0); assert.deepEqual(plain(api.keyframeTracks.value), before); assert.deepEqual(plain(api.nodes.value), base);
      assert.deepEqual([0, 1, 2, 4].map((time) => preview(api, time).sizeDeltaX), values); assert.equal(api.tweenTracks.value.length, 0);
    });
    await test("Inserting inside a relative segment compensates the next delta and incoming delta without changing later poses", () => {
      for (const withIncoming of [false, true]) {
        const api = fixture(); const track = addTrack(api, "anchoredPositionX");
        api.updateKeyframe(track.id, track.keyframes[0].id, { relative: true });
        api.currentTime.value = 1; api.writeAnimatedValue(node(api), "anchoredPositionX", 140);
        const next = track.keyframes[1];
        assert.equal(track.keyframes[0].value, 0); assert.equal(next.value, 40); assert.equal(next.relative, true);
        if (withIncoming) { next.value = 60; next.incomingValue = 40; next.incomingRelative = true; }
        const times = [0, 0.25, 0.5, 0.75, 0.999, 1, 2, 4];
        const before = times.map((time) => preview(api, time).anchorOffsetX);
        api.insertKeyframeAtTime(track.id, 0.5);
        assert.equal(track.keyframes.length, 3);
        assert.equal(track.keyframes[1].relative, true); near(track.keyframes[1].value, 20);
        near(next.value, withIncoming ? 40 : 20);
        if (withIncoming) near(next.incomingValue, 20);
        const after = times.map((time) => preview(api, time).anchorOffsetX);
        after.forEach((value, index) => near(value, before[index], `Relative insertion at ${times[index]}`));
        near(preview(api, 1).anchorOffsetX, withIncoming ? 160 : 140);
        assert.equal(node(api).anchorOffsetX, 100);
      }
    });
    await test("Animated canvas movement and resize return to the initial pose when the pointer returns to its starting point", async () => {
      for (const action of ["startMove", "startResize"]) {
        const api = fixture();
        const fields = action === "startMove" ? ["anchoredPositionX", "anchoredPositionY"] : ["sizeDeltaX", "sizeDeltaY"];
        fields.forEach((field) => addTrack(api, field)); api.currentTime.value = 2;
        const originalPose = preview(api, 2); const base = plain(api.nodes.value);
        const event = pointer(100, { clientY: 20 }); api.beginEditorHistoryPointer(event); api[action](event, node(api));
        api.dispatch("pointermove", pointer(180, { clientY: -40 }));
        const moved = preview(api, 2);
        assert.ok(fields.some((field) => {
          const modelKey = field === "anchoredPositionX" ? "anchorOffsetX" : field === "anchoredPositionY" ? "anchorOffsetY" : field;
          return moved[modelKey] !== originalPose[modelKey];
        }), "The outward movement must produce an actual pose change");
        api.dispatch("pointermove", pointer(100, { clientY: 20 }));
        for (const field of fields) {
          const modelKey = field === "anchoredPositionX" ? "anchorOffsetX" : field === "anchoredPositionY" ? "anchorOffsetY" : field;
          near(preview(api, 2)[modelKey], originalPose[modelKey], `${action} returning ${field}`);
        }
        api.dispatch("pointerup", pointer(100)); api.endEditorHistoryPointer(pointer(100)); await tick();
        assert.deepEqual(plain(api.nodes.value), base);
      }
    });
    await test("All four resize handles preserve the opposite corner through transformed resizing, clamping and undo", async () => {
      for (const animated of [false, true]) {
        for (const [corner, dragged, fixed, signX, signY] of [
          ["tl", "topLeft", "bottomRight", -1, 1], ["tr", "topRight", "bottomLeft", 1, 1],
          ["bl", "bottomLeft", "topRight", -1, -1], ["br", "bottomRight", "topLeft", 1, -1],
        ]) {
          const api = fixture(); node(api).rotation = 37;
          Object.assign(node(api, "image"), { pivotX: 0.2, pivotY: 0.8, rotation: -23, scaleX: 1.5, scaleY: 0.75, sizeDeltaX: 120, sizeDeltaY: 80 });
          api.getHierarchyOrder().forEach(api.applyNodeLayout);
          api.selectedId.value = "image";
          if (animated) for (const field of ["sizeDeltaX", "sizeDeltaY", "anchoredPositionX", "anchoredPositionY"]) addTrack(api, field, "image");
          api.currentTime.value = 2; api.zoom.value = 0.5;
          api.editorHistory.reset(api.captureUndoState());
          const initialState = api.captureUndoState(); const before = worldCorners(api, "image");
          const matrix = plain(api.previewWorldTransforms.value.get("image").matrix);
          await gesture(api, (event) => {
            api.startResize(event, node(api, "image"), corner);
            for (const factor of [1, -10, 0, 0.6]) {
              const localX = signX * 40 * factor, localY = signY * 30 * factor;
              const dx = matrix.a * localX + matrix.c * localY, dy = matrix.b * localX + matrix.d * localY;
              api.dispatch("pointermove", pointer(100 + dx * api.zoom.value, { clientY: 20 - dy * api.zoom.value }));
              const after = worldCorners(api, "image");
              nearPoint(after[fixed], before[fixed], `${corner} fixed corner`, 0.03);
              near(preview(api, 2, "image").width, Math.max(20, 120 + 40 * factor));
              near(preview(api, 2, "image").height, Math.max(20, 80 + 30 * factor));
              if (factor >= 0) nearPoint(after[dragged], { x: before[dragged].x + dx, y: before[dragged].y + dy }, `${corner} dragged corner`, 0.03);
            }
            api.dispatch("pointerup", event);
          });
          assert.equal(history(api).length, 1);
          const resizedState = api.captureUndoState();
          await api.undoEditorOperation(); assert.equal(api.captureUndoState(), initialState);
          await api.redoEditorOperation(); assert.equal(api.captureUndoState(), resizedState);
        }
      }
    });
    await test("Canvas clicks select on release and cycle front-to-back through overlapping controls without transforming or pausing", async () => {
      const api = fixture(); api.selectedId.value = null; api.playing.value = true;
      const world = api.previewWorldTransforms.value.get("image"), point = api.canvasClientPoint(world.x, world.y);
      assert.deepEqual(plain(api.canvasNodesAtPoint(point.x, point.y).map(item => item.id)), ["image", "group", "root"]);
      const before = api.captureUndoState();
      for (const id of ["image", "group", "root", "image"]) {
        const previous = api.selectedId.value;
        const event = pointer(point.x, { clientY: point.y }); api.startCanvasPress(event);
        assert.equal(api.selectedId.value, previous, "Press does not change selection");
        api.dispatch("pointermove", pointer(point.x + 1, { clientY: point.y + 1 }));
        api.dispatch("pointerup", event);
        assert.equal(api.selectedId.value, id);
        assert.equal(api.captureUndoState(), before);
        assert.equal(api.playing.value, true);
      }
      const empty = api.canvasClientPoint(-50, -50), event = pointer(empty.x, { clientY: empty.y });
      api.startCanvasPress(event); assert.equal(api.selectedId.value, "image");
      api.dispatch("pointerup", event); assert.equal(api.selectedId.value, null);
    });
    await test("Dragging over an overlapping child transforms the selected parent in every tool and never cycles selection", async () => {
      for (const tool of ["combined", "move", "rotate", "scale"]) {
        const api = fixture(); api.selectCanvasTool(tool);
        const world = api.previewWorldTransforms.value.get("image"), point = api.canvasClientPoint(world.x, world.y);
        const child = plain(node(api, "image")), before = plain(node(api));
        const initialState = api.captureUndoState();
        const event = pointer(point.x, { clientY: point.y }); api.beginEditorHistoryPointer(event); api.startCanvasPress(event);
        api.dispatch("pointermove", pointer(point.x + 30, { clientY: point.y + 15 }));
        assert.equal(api.selectedId.value, "group");
        if (tool === "combined" || tool === "move") { near(node(api).x, before.x + 30); near(node(api).y, before.y - 15); }
        else if (tool === "rotate") assert.notEqual(node(api).rotation, before.rotation);
        else assert.notEqual(node(api).scaleX, before.scaleX);
        api.dispatch("pointerup", event); api.endEditorHistoryPointer(event); await tick();
        assert.equal(api.selectedId.value, "group"); assert.deepEqual(plain(node(api, "image")), child);
        assert.equal(history(api).length, 1);
        await api.undoEditorOperation(); assert.equal(api.captureUndoState(), initialState);
      }
    });
    await test("Dragging outside the selection, cancelled presses and unrelated pointers never select or mutate another control", () => {
      const api = fixture(); api.selectedId.value = "image";
      const point = api.canvasClientPoint(750, 500), event = pointer(point.x, { clientY: point.y });
      const before = api.captureUndoState();
      api.startCanvasPress(event);
      api.dispatch("pointermove", pointer(point.x + 30, { clientY: point.y }));
      api.dispatch("pointermove", event); api.dispatch("pointerup", event);
      assert.equal(api.selectedId.value, "image"); assert.equal(api.captureUndoState(), before);
      for (const cancel of ["pointercancel", "blur"]) {
        api.startCanvasPress(event); api.dispatch(cancel, event); api.dispatch("pointerup", event);
        assert.equal(api.selectedId.value, "image");
      }
      api.startCanvasPress(event); api.dispatch("pointerup", { ...event, pointerId: 10 });
      assert.equal(api.selectedId.value, "image"); api.dispatch("pointerup", event);
      assert.equal(api.selectedId.value, "group");
      assert.equal(api.captureUndoState(), before);
    });
    await test("Picking follows animated, rotated and mirrored bounds and excludes hidden controls", () => {
      const api = fixture();
      Object.assign(node(api), { rotation: 37, scaleX: -2 });
      Object.assign(node(api, "image"), { rotation: -23, pivotX: 0.2, pivotY: 0.8 });
      api.getHierarchyOrder().forEach(api.applyNodeLayout);
      addTrack(api, "anchoredPositionX", "image"); api.currentTime.value = 2; api.writeAnimatedValue(node(api, "image"), "anchoredPositionX", 60);
      api.zoom.value = 0.55; api.panX.value = 30; api.panY.value = -40;
      const world = api.previewWorldTransforms.value.get("image");
      const hitAt = (x, y) => { const point = api.canvasClientPoint(world.x + world.matrix.a * x + world.matrix.c * y, world.y + world.matrix.b * x + world.matrix.d * y); return api.canvasNodesAtPoint(point.x, point.y).some(item => item.id === "image"); };
      assert.equal(hitAt(10, -10), true); assert.equal(hitAt(25, -10), false);
      node(api).visible = false; assert.equal(hitAt(10, -10), false);
    });
    await test("Bone-tip dragging adjusts only guide length under animated mirrored transforms, clamps, and undoes as one gesture", async () => {
      const api = fixture();
      Object.assign(node(api, "root"), { rotation: 37, scaleX: -2, scaleY: 0.75 });
      node(api).rotation = -23; api.getHierarchyOrder().forEach(api.applyNodeLayout);
      addTrack(api, "localScaleX"); api.currentTime.value = 2; api.writeAnimatedValue(node(api), "localScaleX", 1.5);
      api.zoom.value = 0.4; api.editorHistory.reset(api.captureUndoState());
      const before = api.captureUndoState(), nodesBefore = plain(api.nodes.value), tracksBefore = plain(api.keyframeTracks.value);
      const world = api.previewWorldTransforms.value.get("group"), { a, b } = world.matrix;
      const initial = api.selectedDirectionArrowLength.value;
      const tip = api.canvasClientPoint(world.x + a * initial, world.y + b * initial);
      const event = pointer(tip.x, { clientY: tip.y }); api.beginEditorHistoryPointer(event); api.startBoneLengthDrag(event);
      for (const [delta, expected] of [[80, initial + 80], [-500, 0], [3000, 2000], [0, initial], [50, initial + 50]]) {
        // Add perpendicular movement to verify it cannot change the length.
        api.dispatch("pointermove", pointer(tip.x + (a * delta - b * 20) * api.zoom.value, { clientY: tip.y - (b * delta + a * 20) * api.zoom.value }));
        near(api.selectedDirectionArrowLength.value, expected);
      }
      api.dispatch("pointerup", event); api.endEditorHistoryPointer(event); await tick();
      const expectedNodes = plain(nodesBefore); expectedNodes.find(item => item.id === "group").editor.directionArrowLength = initial + 50;
      assert.deepEqual(plain(api.nodes.value), expectedNodes);
      assert.deepEqual(plain(api.keyframeTracks.value), tracksBefore);
      assert.equal(history(api).length, 1);
      const after = api.captureUndoState(); await api.undoEditorOperation(); assert.equal(api.captureUndoState(), before);
      await api.redoEditorOperation(); assert.equal(api.captureUndoState(), after);
    });
    await test("Bone-length handles appear only on visible unlocked container guides", () => {
      const api = fixture(); assert.ok(api.boneLengthHandle.value);
      node(api).locked = true; assert.equal(api.boneLengthHandle.value, null);
      const before = api.captureUndoState(); api.startBoneLengthDrag(pointer()); api.dispatch("pointermove", pointer(200)); api.dispatch("pointerup", pointer(200));
      assert.equal(api.captureUndoState(), before); node(api).locked = false;
      api.showContainerBones.value = false; assert.equal(api.boneLengthHandle.value, null); api.showContainerBones.value = true;
      node(api, "root").visible = false; assert.equal(api.boneLengthHandle.value, null); node(api, "root").visible = true;
      node(api).editor.directionArrowLength = 0; assert.equal(api.boneLengthHandle.value, null);
      api.selectedId.value = "image"; assert.equal(api.boneLengthHandle.value, null);
    });
    await test("Combined and move tools move only position; locked controls ignore every transform tool", async () => {
      for (const tool of ["combined", "move", "rotate", "scale"]) {
        const api = fixture(); api.selectCanvasTool(tool);
        const item = node(api); item.locked = true;
        const lockedState = api.captureUndoState();
        api.startCanvasTransform(pointer(), item); api.dispatch("pointermove", pointer(180)); api.dispatch("pointerup", pointer(180));
        assert.equal(api.captureUndoState(), lockedState);
        assert.equal(api.transformGizmo.value, null);
        if (tool !== "combined" && tool !== "move") continue;
        item.locked = false;
        const before = plain(item); const world = plain(api.selectedWorldPosition.value);
        await gesture(api, event => {
          api.startCanvasTransform(event, item); api.dispatch("pointermove", pointer(180, { clientY: 80 })); api.dispatch("pointerup", event);
        });
        nearPoint(api.selectedWorldPosition.value, { x: world.x + 80, y: world.y - 60 }, `${tool} move`);
        for (const key of ["width", "height", "scaleX", "scaleY", "rotation"]) near(item[key], before[key], `${tool} unchanged ${key}`);
      }
    });
    await test("Rotation inputs constrain all axes to -180..180 and preserve both endpoints", () => {
      for (const [input, expected] of [[-720,0],[-361,-1],[-360,0],[-181,179],[-180,-180],[-1,-1],[0,0],[180,180],[181,-179],[359,-1],[360,0],[361,1],[720,0]]) {
        assert.equal(fixture().normalizeRotationAngle(input), expected);
      }
      for (const animated of [false, true]) for (const [field, model] of [["localRotationX","rotationX"],["localRotationY","rotationY"],["localRotationZ","rotation"]]) {
        const api = fixture();
        if (animated) { addTrack(api, field); api.currentTime.value = 2; }
        for (const [input, expected] of [[-400,-180],[-180,-180],[-25,-25],[0,0],[90,90],[180,180],[400,180]]) {
          api.updateAnimatedBaseValue(field, input);
          near((animated ? preview(api, 2) : node(api))[model], expected);
        }
      }
    });
    await test("Rotation follows the mouse under a reflected nonuniform parent, wraps into -180..180 degrees, and supports undo", async () => {
      for (const animated of [false, true]) {
        const api = fixture();
        Object.assign(node(api), { rotation: 37, scaleX: -2 });
        Object.assign(node(api, "image"), { rotation: -23, pivotX: 0.2, pivotY: 0.8 });
        api.getHierarchyOrder().forEach(api.applyNodeLayout);
        api.selectedId.value = "image"; api.selectCanvasTool("rotate"); api.zoom.value = 0.55; api.panX.value = 35; api.panY.value = -20;
        if (animated) addTrack(api, "localRotationZ", "image");
        api.currentTime.value = 2; api.editorHistory.reset(api.captureUndoState());
        const beforeState = api.captureUndoState(); const base = plain(node(api, "image"));
        const world = plain(api.selectedWorldPosition.value), pivot = api.canvasClientPoint(world.x, world.y);
        const parent = api.previewWorldTransforms.value.get("group").matrix;
        const at = degrees => {
          const radians = degrees * Math.PI / 180, x = Math.cos(radians) * 100, y = Math.sin(radians) * 100;
          return pointer(pivot.x + (parent.a * x + parent.c * y) * api.zoom.value, { clientY: pivot.y - (parent.b * x + parent.d * y) * api.zoom.value });
        };
        const event = at(179); api.beginEditorHistoryPointer(event); api.startCanvasTransform(event, node(api, "image"));
        for (const degrees of [181, 270, 359, 449, 539, 629, 719, 809, 719, 629, 539, 449, 359, 270, 181, 179, 89, -1]) {
          api.dispatch("pointermove", at(degrees));
          near(preview(api, 2, "image").rotation, ((-23 + degrees - 179 + 180) % 360 + 360) % 360 - 180);
          nearPoint(api.selectedWorldPosition.value, world, "Rotation keeps pivot fixed");
        }
        api.dispatch("pointerup", event); api.endEditorHistoryPointer(event); await tick();
        assert.equal(history(api).length, 1);
        if (animated) { assert.deepEqual(plain(node(api, "image")), base); assert.equal(api.keyframeTracks.value[0].keyframes.length, 2); }
        const afterState = api.captureUndoState(); await api.undoEditorOperation(); assert.equal(api.captureUndoState(), beforeState);
        await api.redoEditorOperation(); assert.equal(api.captureUndoState(), afterState);
      }
    });
    await test("Uniform and axis scale tools edit scale around the pivot, preserve dimensions, and record a single undo gesture", async () => {
      for (const animated of [false, true]) for (const axis of ["uniform", "x", "y"]) {
        const api = fixture(); node(api).rotation = 37;
        Object.assign(node(api, "image"), { scaleX: -1.5, scaleY: 0.75, rotation: -23, pivotX: 0.2, pivotY: 0.8 });
        api.getHierarchyOrder().forEach(api.applyNodeLayout);
        api.selectedId.value = "image"; api.selectCanvasTool("scale"); api.zoom.value = 0.55;
        if (animated) for (const field of ["localScaleX", "localScaleY"]) assert.equal(addTrack(api, field, "image"), undefined);
        api.currentTime.value = 2; api.editorHistory.reset(api.captureUndoState());
        const beforeState = api.captureUndoState(), base = plain(node(api, "image"));
        const world = plain(api.selectedWorldPosition.value), pivot = api.canvasClientPoint(world.x, world.y);
        const matrix = api.previewWorldTransforms.value.get("image").matrix;
        const vector = axis === "y" ? { x: matrix.c, y: -matrix.d } : { x: matrix.a, y: -matrix.b };
        const length = Math.hypot(vector.x, vector.y); vector.x /= length; vector.y /= length;
        const start = axis === "uniform" ? { x: pivot.x + 40, y: pivot.y } : { x: pivot.x + vector.x * 58, y: pivot.y + vector.y * 58 };
        const event = pointer(start.x, { clientY: start.y }); api.beginEditorHistoryPointer(event);
        if (axis === "uniform") api.startCanvasTransform(event, node(api, "image")); else api.startCanvasScale(event, node(api, "image"), axis);
        for (const factor of [1.5, 0, 1, 1.25]) {
          const next = axis === "uniform" ? pointer(pivot.x + 40 * factor, { clientY: pivot.y })
            : pointer(start.x + vector.x * (factor - 1) * 100, { clientY: start.y + vector.y * (factor - 1) * 100 });
          api.dispatch("pointermove", next);
          const pose = preview(api, 2, "image"), clamped = Math.max(0.01, factor);
          near(pose.scaleX, base.scaleX * (axis === "y" ? 1 : clamped)); near(pose.scaleY, base.scaleY * (axis === "x" ? 1 : clamped));
          for (const key of ["width", "height", "rotation"]) near(pose[key], base[key]);
          nearPoint(api.selectedWorldPosition.value, world, "Scaling keeps pivot fixed");
        }
        api.dispatch("pointerup", event); api.endEditorHistoryPointer(event); await tick();
        assert.equal(history(api).length, 1);
        assert.equal(api.keyframeTracks.value.length, 0, "X/Y scaling remains a static edit, never a Tween");
        const afterState = api.captureUndoState(); await api.undoEditorOperation(); assert.equal(api.captureUndoState(), beforeState);
        await api.redoEditorOperation(); assert.equal(api.captureUndoState(), afterState);
      }
    });
    await test("Animated bottom-right resizing preserves the opposite world corner at the default pivot", async () => {
      const api = fixture();
      for (const field of ["sizeDeltaX", "sizeDeltaY", "anchoredPositionX", "anchoredPositionY"]) addTrack(api, field);
      api.currentTime.value = 2; const base = plain(api.nodes.value); const before = worldCorners(api);
      await gesture(api, (event) => {
        api.startResize(event, node(api)); api.dispatch("pointermove", pointer(180, { clientY: 80 }));
        const after = worldCorners(api);
        nearPoint(after.topLeft, before.topLeft, "Fixed opposite corner");
        nearPoint(after.bottomRight, { x: before.bottomRight.x + 80, y: before.bottomRight.y - 60 }, "Dragged corner");
        near(preview(api, 2).width, 240); near(preview(api, 2).height, 120);
        nearPoint(api.selectedWorldPosition.value, { x: 940, y: 470 }, "Compensated pivot");
        api.dispatch("pointerup", pointer(180, { clientY: 80 }));
      });
      assert.deepEqual(plain(api.nodes.value), base);
      for (const track of api.keyframeTracks.value) assert.equal(track.keyframes.length, 2);
    });
    await test("Resizing under rotated nonuniform parent and child transforms keeps a custom-pivot opposite corner fixed", async () => {
      const api = fixture(); node(api).rotation = 37;
      Object.assign(node(api, "image"), { pivotX: 0.2, pivotY: 0.8, rotation: -23, scaleX: 1.5, scaleY: 0.75, sizeDeltaX: 120, sizeDeltaY: 80 });
      api.getHierarchyOrder().forEach(api.applyNodeLayout);
      for (const field of ["sizeDeltaX", "sizeDeltaY", "anchoredPositionX", "anchoredPositionY"]) addTrack(api, field, "image");
      api.currentTime.value = 2; const before = worldCorners(api, "image");
      const matrix = plain(api.previewWorldTransforms.value.get("image").matrix);
      const worldDelta = { x: matrix.a * 40 - matrix.c * 30, y: matrix.b * 40 - matrix.d * 30 };
      const base = plain(api.nodes.value);
      await gesture(api, (event) => {
        api.startResize(event, node(api, "image"));
        for (const factor of [0.4, 1, 0.6]) {
          api.dispatch("pointermove", pointer(100 + worldDelta.x * factor, { clientY: 20 - worldDelta.y * factor }));
          const after = worldCorners(api, "image");
          // Layout storage rounds each local coordinate to .01; composed scale
          // can amplify that sub-pixel quantization, but not move the fixed edge.
          nearPoint(after.topLeft, before.topLeft, "Rotated fixed corner", 0.03);
          nearPoint(after.bottomRight, { x: before.bottomRight.x + worldDelta.x * factor, y: before.bottomRight.y + worldDelta.y * factor }, "Rotated dragged corner", 0.03);
          near(preview(api, 2, "image").width, 120 + 40 * factor);
          near(preview(api, 2, "image").height, 80 + 30 * factor);
        }
        api.dispatch("pointerup", event);
      });
      assert.deepEqual(plain(api.nodes.value), base);
    });
    await test("Minimum-size clamping and returning to the resize origin keep the opposite corner fixed in one undo command", async () => {
      const api = fixture();
      for (const field of ["sizeDeltaX", "sizeDeltaY", "anchoredPositionX", "anchoredPositionY"]) addTrack(api, field);
      api.currentTime.value = 2; api.editorHistory.reset(api.captureUndoState());
      const beforeState = api.captureUndoState(); const beforePose = plain(preview(api, 2)); const beforeCorner = worldCorners(api);
      const event = pointer(); api.beginEditorHistoryPointer(event); api.startResize(event, node(api));
      for (const [x, y] of [[-900, -980], [-1900, -1980]]) {
        api.dispatch("pointermove", pointer(x, { clientY: y }));
        near(preview(api, 2).width, 20); near(preview(api, 2).height, 20);
        nearPoint(worldCorners(api).topLeft, beforeCorner.topLeft, "Clamped opposite corner");
        await tick(); assert.equal(history(api).length, 0);
      }
      api.dispatch("pointermove", event);
      for (const field of ["width", "height", "anchorOffsetX", "anchorOffsetY"]) near(preview(api, 2)[field], beforePose[field], `Restored ${field}`);
      nearPoint(worldCorners(api).topLeft, beforeCorner.topLeft, "Restored opposite corner");
      nearPoint(worldCorners(api).bottomRight, beforeCorner.bottomRight, "Restored dragged corner");
      api.dispatch("pointerup", event); api.endEditorHistoryPointer(event); await tick();
      assert.equal(history(api).length, 1, "All inserted/updated size and position keys belong to one resize gesture");
      const afterState = api.captureUndoState(); await api.undoEditorOperation(); assert.equal(api.captureUndoState(), beforeState);
      await api.redoEditorOperation(); assert.equal(api.captureUndoState(), afterState);
    });
    await test("An animation on another node does not change unanimated resize behavior or move the opposite corner", async () => {
      const results = [];
      for (const unrelatedAnimation of [false, true]) {
        const api = fixture(); if (unrelatedAnimation) addTrack(api, "imageColor", "image");
        api.selectedId.value = "group"; api.currentTime.value = 2;
        const initialTracks = plain(api.keyframeTracks.value); const before = worldCorners(api);
        await gesture(api, (event) => {
          api.startResize(event, node(api));
          for (const [x, y] of [[120, 35], [180, 80]]) api.dispatch("pointermove", pointer(x, { clientY: y }));
          api.dispatch("pointerup", pointer(180, { clientY: 80 }));
        });
        nearPoint(worldCorners(api).topLeft, before.topLeft, "Unanimated opposite corner");
        assert.deepEqual(plain(api.keyframeTracks.value), initialTracks);
        results.push(plain(api.nodes.value));
      }
      assert.deepEqual(results[1], results[0], "The legacy and animated-layout branches must yield the same setup nodes");
    });
    await test("World-axis edits under a 90-degree parent write both inverse-transformed local coordinate fields", () => {
      const api = fixture(); node(api).rotation = 90;
      addTrack(api, "anchoredPositionX", "image"); addTrack(api, "anchoredPositionY", "image");
      const before = plain(api.nodes.value); api.currentTime.value = 2;
      near(api.selectedWorldPosition.value.x, 870); near(api.selectedWorldPosition.value.y, 540);
      api.updateGeometry("x", 930);
      near(api.selectedWorldPosition.value.x, 930); near(api.selectedWorldPosition.value.y, 540);
      near(api.selectedRuntimeLayoutValues.value.anchoredPositionX, 20);
      near(api.selectedRuntimeLayoutValues.value.anchoredPositionY, -10, "World +X corresponds to local -Y under parent rotation");
      api.updateGeometry("y", 600);
      near(api.selectedWorldPosition.value.x, 930); near(api.selectedWorldPosition.value.y, 600);
      near(api.selectedRuntimeLayoutValues.value.anchoredPositionX, 50);
      near(api.selectedRuntimeLayoutValues.value.anchoredPositionY, -10);
      assert.deepEqual(plain(api.nodes.value), before);
    });
    await test("Relative writes skip null preceding key values and preserve the last valid baseline", () => {
      const api = fixture(); const track = addTrack(api, "anchoredPositionX");
      api.currentTime.value = 1; api.writeAnimatedValue(node(api), "anchoredPositionX", 140);
      track.keyframes.push({ id: "null-middle", time: 2, value: null, easeType: "Linear", interpolation: "tween" },
        { id: "after-null", time: 3, value: 10, relative: true, easeType: "Linear", interpolation: "tween" });
      near(api.keyframePreviousValue(track, 3), 140, "A null key cannot replace a previously valid baseline");
      api.currentTime.value = 3; api.writeAnimatedValue(node(api), "anchoredPositionX", 170);
      near(track.keyframes[3].value, 30); near(preview(api, 3).anchorOffsetX, 170);
      assert.equal(node(api).anchorOffsetX, 100);
    });
    await test("Unkeyed child world-position edits use the animated parent's current translation, scale and rotation", () => {
      for (const rotated of [false, true]) {
        const api = fixture();
        addTrack(api, "anchoredPositionX"); addTrack(api, "localScaleX");
        if (rotated) addTrack(api, "localRotationZ");
        api.currentTime.value = 2;
        api.writeAnimatedValue(node(api), "anchoredPositionX", 300);
        api.writeAnimatedValue(node(api), "localScaleX", 4);
        if (rotated) api.writeAnimatedValue(node(api), "localRotationZ", 90);
        api.selectedId.value = "image";
        const baseParent = plain(node(api)); const tracks = plain(api.keyframeTracks.value);
        near(api.selectedWorldPosition.value.x, rotated ? 1070 : 1180);
        near(api.selectedWorldPosition.value.y, rotated ? 580 : 530);
        api.updateGeometry("x", 1130);
        near(api.selectedWorldPosition.value.x, 1130, "An unkeyed child must reach the requested visible world X");
        near(api.selectedWorldPosition.value.y, rotated ? 580 : 530, "Editing world X must preserve visible world Y");
        near(node(api, "image").anchorOffsetX, rotated ? 20 : 7.5);
        near(node(api, "image").anchorOffsetY, rotated ? -10 : 10);
        assert.equal(api.hasAnimatedField("anchoredPositionX", "image"), false);
        assert.equal(api.hasAnimatedField("anchoredPositionY", "image"), false);
        assert.deepEqual(plain(node(api)), baseParent, "Editing the child cannot rewrite its animated parent's setup");
        assert.deepEqual(plain(api.keyframeTracks.value), tracks, "Unkeyed geometry edits cannot create or alter animation tracks");
      }
    });
    await test("Unkeyed width edits subtract the current animated parent span and the child's animated anchors", () => {
      for (const animateAnchor of [false, true]) {
        const api = fixture(); const image = node(api, "image");
        Object.assign(image, { anchorMinX: 0, anchorMaxX: 1 }); api.applyNodeLayout(image);
        addTrack(api, "sizeDeltaX");
        if (animateAnchor) addTrack(api, "anchorMaxX", "image");
        api.currentTime.value = 2;
        api.writeAnimatedValue(node(api), "sizeDeltaX", 400);
        if (animateAnchor) api.writeAnimatedValue(image, "anchorMaxX", 0.75);
        api.selectedId.value = "image";
        const tracks = plain(api.keyframeTracks.value); const parent = plain(node(api));
        near(api.inspectorNode.value.width, animateAnchor ? 330 : 430);
        api.updateGeometry("width", 510);
        near(api.inspectorNode.value.width, 510, "Displayed width must match the exact input while the parent is animated");
        near(image.sizeDeltaX, animateAnchor ? 210 : 110, "sizeDelta must subtract the preview anchor span rather than the setup span");
        near(image.anchorMinX, 0); near(image.anchorMaxX, 1);
        near(image.anchorOffsetX, 20); near(image.anchorOffsetY, 10);
        assert.equal(api.hasAnimatedField("sizeDeltaX", "image"), false);
        assert.deepEqual(plain(api.keyframeTracks.value), tracks);
        assert.deepEqual(plain(node(api)), parent);
      }
    });
    await test("Anchor presets key the animated anchors and compensation values without changing setup or the displayed rectangle", async () => {
      const api = fixture();
      const fields = ["anchorMinX", "anchorMinY", "anchorMaxX", "anchorMaxY", "anchoredPositionX", "anchoredPositionY", "sizeDeltaX", "sizeDeltaY"];
      fields.forEach((field) => addTrack(api, field, "image"));
      api.currentTime.value = 2;
      api.writeAnimatedValue(node(api, "image"), "anchoredPositionX", 45);
      api.writeAnimatedValue(node(api, "image"), "sizeDeltaX", 80);
      const before = plain(api.nodes.value); const pose = plain(api.inspectorNode.value);
      const firstKeys = plain(api.keyframeTracks.value.map((track) => track.keyframes[0]));
      api.editorHistory.reset(api.captureUndoState()); const undoBefore = api.captureUndoState();
      await gesture(api, () => api.applyAnchorPreset("stretch-stretch"));
      assert.deepEqual(plain(api.nodes.value), before, "An animated anchor preset cannot write anchors, offsets or sizes into setup");
      const expected = { anchorMinX: 0, anchorMinY: 0, anchorMaxX: 1, anchorMaxY: 1, anchoredPositionX: 45, anchoredPositionY: 10, sizeDeltaX: -120, sizeDeltaY: -70 };
      for (const [field, value] of Object.entries(expected)) {
        const track = api.keyframeTracks.value.find((item) => item.fieldKey === field);
        near(api.readTweenFieldValue(api.inspectorNode.value, imports.getTweenableField("image", field)), value, field);
        if (field.startsWith("anchorM") || field.startsWith("sizeDelta")) {
          const key = track.keyframes.find((item) => item.time === 2);
          assert.ok(key, `${field} must record the current preset at the playhead`); near(key.value, value);
        }
      }
      for (const field of ["x", "y", "width", "height"]) near(api.inspectorNode.value[field], pose[field], `Preset preserves visible ${field}`);
      assert.equal(api.currentAnchorPresetId.value, "stretch-stretch", "The preset indicator must reflect the animated inspector pose");
      assert.deepEqual(plain(api.keyframeTracks.value.map((track) => track.keyframes[0])), firstKeys);
      assert.equal(history(api).length, 1, "A preset and all compensation writes form one undo operation");
      const undoAfter = api.captureUndoState(); await api.undoEditorOperation(); assert.equal(api.captureUndoState(), undoBefore);
      await api.redoEditorOperation(); assert.equal(api.captureUndoState(), undoAfter);
    });
    await test("Transform copy samples the preview; animated fields key while retired X/Y scales remain static", async () => {
      for (const action of ["reset", "paste"]) {
        const api = fixture();
        imports.baseTweenableFields.forEach((field) => addTrack(api, field.fieldKey));
        api.currentTime.value = 2;
        api.writeAnimatedValue(node(api), "localScaleX", 4);
        api.writeAnimatedValue(node(api), "anchoredPositionX", 180);
        api.writeAnimatedValue(node(api), "sizeDeltaX", 260);
        api.currentTime.value = 1;
        const copiedPose = plain(api.inspectorNode.value); const setup = plain(api.nodes.value);
        api.copySelectedPropertyGroup("transform");
        const copied = plain(api.propertyClipboard.value.values);
        near(copied.scaleX, 4); near(copied.anchorOffsetX, 140); near(copied.sizeDeltaX, 230);
        for (const field of imports.baseTweenableFields) near(copied[field.modelKey], copiedPose[field.modelKey], `Copy ${field.fieldKey} from preview`);
        assert.deepEqual(plain(api.nodes.value), setup);
        api.currentTime.value = 3; const beforePose = plain(api.inspectorNode.value);
        const previousKeys = plain(api.keyframeTracks.value.map((track) => ({ id: track.id, keys: track.keyframes.filter((key) => key.time < 3) })));
        const definition = imports.getControlDefinition("container");
        const expected = action === "paste" ? copied : {
          anchorMinX: 0.5, anchorMinY: 0.5, anchorMaxX: 0.5, anchorMaxY: 0.5, pivotX: 0.5, pivotY: 0.5,
          anchorOffsetX: 0, anchorOffsetY: 0, sizeDeltaX: definition.defaultWidth, sizeDeltaY: definition.defaultHeight,
          scaleX: 1, scaleY: 1, scaleZ: 1, rotationX: 0, rotationY: 0, rotation: 0,
        };
        api.editorHistory.reset(api.captureUndoState()); const undoBefore = api.captureUndoState();
        await gesture(api, () => api[action === "reset" ? "resetSelectedPropertyGroup" : "pasteSelectedPropertyGroup"]("transform"));
        const expectedSetup = plain(setup);
        if (action === "reset") Object.assign(expectedSetup.find(item => item.id === "group"), { scaleX: 1, scaleY: 1 });
        assert.deepEqual(plain(api.nodes.value), expectedSetup, `${action} changes only static X/Y scales, not animated setup or descendants`);
        for (const field of imports.baseTweenableFields) {
          const wanted = expected[field.modelKey]; near(api.inspectorNode.value[field.modelKey], wanted, `${action} ${field.fieldKey}`);
          if (wanted !== beforePose[field.modelKey]) {
            const track = api.keyframeTracks.value.find((item) => item.fieldKey === field.fieldKey);
            const key = track.keyframes.find((item) => item.time === 3);
            assert.ok(key, `${action} ${field.fieldKey} must record a current-time key`); near(key.value, wanted);
          }
        }
        assert.deepEqual(plain(api.keyframeTracks.value.map((track) => ({ id: track.id, keys: track.keyframes.filter((key) => key.time < 3) }))), previousKeys);
        assert.equal(history(api).length, 1);
        const undoAfter = api.captureUndoState(); await api.undoEditorOperation(); assert.equal(api.captureUndoState(), undoBefore);
        await api.redoEditorOperation(); assert.equal(api.captureUndoState(), undoAfter);
      }
    });
    await test("Control-group copy reads the interpolated color and owns a stable snapshot without creating keys", () => {
      const api = fixture(); const track = addTrack(api, "imageColor", "image");
      api.currentTime.value = 2; api.writeAnimatedValue(node(api, "image"), "imageColor", { r: 0, g: 50, b: 100, a: 0.2 });
      api.currentTime.value = 1; const setup = plain(api.nodes.value); const tracks = plain(api.keyframeTracks.value);
      api.copySelectedPropertyGroup("control");
      assert.deepEqual(plain(api.propertyClipboard.value.values.imageColor), { r: 100, g: 75, b: 50, a: 0.5 });
      assert.deepEqual(plain(api.nodes.value), setup); assert.deepEqual(plain(api.keyframeTracks.value), tracks);
      api.currentTime.value = 2; track.keyframes[1].value.r = 250;
      assert.deepEqual(plain(api.propertyClipboard.value.values.imageColor), { r: 100, g: 75, b: 50, a: 0.5 }, "Later edits cannot mutate the copied preview color");
    });
    await test("Control-group reset and paste key animated colors, edit unanimated settings normally, and undo as one operation", async () => {
      for (const action of ["reset", "paste"]) {
        const api = fixture(); const image = node(api, "image"); const track = addTrack(api, "imageColor", "image");
        image.properties.imageType = "stretch";
        api.currentTime.value = 2; api.writeAnimatedValue(image, "imageColor", { r: 0, g: 50, b: 100, a: 0.2 });
        api.currentTime.value = 1; api.copySelectedPropertyGroup("control");
        const copied = plain(api.propertyClipboard.value.values); const setupColor = plain(image.properties.imageColor);
        if (action === "paste") image.properties.imageType = "basic";
        api.currentTime.value = 3; const initialKeys = plain(track.keyframes);
        api.editorHistory.reset(api.captureUndoState()); const undoBefore = api.captureUndoState();
        await gesture(api, () => api[action === "reset" ? "resetSelectedPropertyGroup" : "pasteSelectedPropertyGroup"]("control"));
        assert.deepEqual(plain(image.properties.imageColor), setupColor, `${action} must retain the original animated color baseline`);
        const expected = action === "reset" ? imports.getControlDefinition("image").createProperties() : copied;
        assert.deepEqual(plain(api.inspectorNode.value.properties), plain(expected));
        assert.equal(image.properties.imageType, action === "reset" ? "basic" : "stretch");
        const key = track.keyframes.find((item) => item.time === 3);
        assert.ok(key, `${action} must create the current color key`); assert.deepEqual(plain(key.value), plain(expected.imageColor));
        assert.deepEqual(plain(track.keyframes.filter((item) => item.time < 3)), initialKeys);
        assert.equal(history(api).length, 1);
        const undoAfter = api.captureUndoState(); await api.undoEditorOperation(); assert.equal(api.captureUndoState(), undoBefore);
        await api.redoEditorOperation(); assert.equal(api.captureUndoState(), undoAfter);
      }
    });
    await test("Collapsing the animation panel only changes layout, not playback, selection, save data or undo history", async () => {
      const api = fixture(); const track = addTrack(api, "localScaleZ"); api.currentTime.value = 2; api.playing.value = true;
      await tick(); api.editorHistory.flush(); const saved = api.serializeProject(); const snapshot = api.captureUndoState(); const count = history(api).length;
      for (const collapsed of [true, false, true]) {
        api.animationsPanelCollapsed.value = collapsed; await tick(); api.editorHistory.flush();
        assert.equal(api.serializeProject(), saved); assert.equal(api.captureUndoState(), snapshot); assert.equal(history(api).length, count);
        assert.equal(api.currentTime.value, 2); assert.equal(api.playing.value, true); assert.equal(api.selectedKeyframeId.value, track.keyframes[0].id);
      }
    });
    await test("Animations share setup but isolate same-property keys and durations; switching is not an undo action", async () => {
      const api = fixture(); const setup = plain(api.nodes.value); const firstId = api.activeAnimationId.value;
      addTrack(api, "localScaleZ"); api.updateAnimatedBaseValue("localScaleZ", 3); api.duration.value = 4;
      api.createAnimation(); const secondId = api.activeAnimationId.value;
      assert.notEqual(secondId, firstId); assert.equal(api.keyframeTracks.value.length, 0); near(api.inspectorNode.value.scaleZ, 2);
      addTrack(api, "localScaleZ"); api.updateAnimatedBaseValue("localScaleZ", 7); api.duration.value = 9;
      await tick(); api.editorHistory.flush(); const snapshot = api.captureUndoState(); const count = history(api).length;
      api.currentTime.value = 2; api.playing.value = true; api.selectAnimation(firstId);
      assert.equal(api.playing.value, false); assert.equal(api.currentTime.value, 0); assert.equal(api.selectedKeyframeId.value, null);
      near(api.inspectorNode.value.scaleZ, 3); assert.equal(api.duration.value, 4);
      api.selectAnimation(secondId); near(api.inspectorNode.value.scaleZ, 7); assert.equal(api.duration.value, 9);
      await tick(); api.editorHistory.flush(); assert.equal(api.captureUndoState(), snapshot); assert.equal(history(api).length, count);
      assert.deepEqual(plain(api.nodes.value), setup);
    });
    await test("Animation duplication deeply clones colors and keys with unique IDs and keeps the source unchanged", () => {
      const api = fixture(); api.selectedId.value = "image"; addTrack(api, "imageColor", "image"); api.duration.value = 8;
      const original = plain(api.activeAnimation.value); api.duplicateAnimation();
      assert.equal(api.duration.value, 8); assert.notEqual(api.activeAnimationId.value, original.id);
      const copy = api.keyframeTracks.value[0]; assert.notEqual(copy.id, original.keyframeTracks[0].id); assert.notEqual(copy.keyframes[0].id, original.keyframeTracks[0].keyframes[0].id);
      copy.keyframes[0].value.a = 0.1;
      assert.deepEqual(plain(api.animations.value[0]), original);
    });
    await test("Animation names reject blank, duplicate and control-character names without changing data", () => {
      const api = fixture(); api.renameAnimation("待机"); api.createAnimation(); api.renameAnimation("入场");
      for (const name of [" ", "待机", "bad\nname", "a".repeat(81)]) { api.renameAnimation(name); assert.equal(api.activeAnimation.value.name, "入场"); assert.ok(api.animationNotice.value); }
      api.renameAnimation("  退场  "); assert.equal(api.activeAnimation.value.name, "退场"); assert.equal(api.animationNotice.value, "");
    });
    await test("Animation create, rename, and delete are undoable and the final animation cannot be removed", async () => {
      const api = fixture(); const original = api.captureUndoState();
      await gesture(api, () => api.createAnimation()); assert.equal(history(api).length, 1); assert.match(history(api)[0].label, /新增动画/);
      const created = api.captureUndoState(); await api.undoEditorOperation(); assert.equal(api.captureUndoState(), original);
      await api.redoEditorOperation(); assert.equal(api.captureUndoState(), created);
      const added = api.animations.value[1]; api.selectAnimation(added.id);
      await gesture(api, () => api.renameAnimation("人物 · 入场")); assert.match(history(api).at(-1).label, /重命名动画/);
      const beforeRemove = api.captureUndoState(); await gesture(api, () => api.removeAnimation(added.id));
      assert.equal(api.animations.value.length, 1); assert.match(history(api).at(-1).label, /删除动画/);
      await api.undoEditorOperation(); assert.equal(api.captureUndoState(), beforeRemove);
      await api.redoEditorOperation(); const only = api.captureUndoState(); api.removeAnimation(api.activeAnimationId.value); assert.equal(api.captureUndoState(), only);
    });
    await test("JSON saves every animation and restores selection, while legacy single-track projects become one default animation", () => {
      const api = fixture(); addTrack(api, "sizeDeltaX"); api.updateAnimatedBaseValue("sizeDeltaX", 250); api.duration.value = 7;
      api.createAnimation(); api.renameAnimation("第二动画"); addTrack(api, "localScaleY"); api.updateAnimatedBaseValue("localScaleY", 6); api.duration.value = 10;
      const saved = api.serializeProject(); const data = JSON.parse(saved); const expected = plain(api.animations.value);
      api.applyProjectData(api.createBlankProject("other")); api.applyProjectData(saved);
      assert.deepEqual(plain(api.animations.value), expected); assert.equal(api.activeAnimationId.value, data.activeAnimationId); near(api.inspectorNode.value.scaleY, 1);
      api.selectedId.value = "group"; near(api.inspectorNode.value.scaleY, 6); assert.equal(api.duration.value, 10);
      delete data.animations; delete data.activeAnimationId; api.applyProjectData(JSON.stringify(data));
      assert.equal(api.animations.value.length, 1); assert.equal(api.activeAnimation.value.name, "默认动画"); assert.deepEqual(plain(api.keyframeTracks.value), data.keyframeTracks);
    });
    await test("Invalid animation collections reject duplicate identities, names and broken inactive tracks", () => {
      const api = fixture(); addTrack(api, "localScaleZ"); const original = plain(api.animations.value);
      for (const mutate of [list => list.push(plain(list[0])), list => list[0].duration = NaN, list => list[0].name = "", list => list[0].keyframeTracks[0].nodeId = "missing"]) {
        const data = plain(original); mutate(data); assert.throws(() => imports.normalizeAnimationCollection(data, api.nodes.value));
      }
      assert.throws(() => imports.normalizeAnimationCollection([], api.nodes.value)); assert.deepEqual(plain(api.animations.value), original);
    });
    await test("Deleting a shared control removes its tracks in every animation and one undo restores all", async () => {
      const api = fixture(); addTrack(api, "localScaleX", "image"); api.createAnimation(); addTrack(api, "localScaleY", "image");
      api.editorHistory.reset(api.captureUndoState()); const original = api.captureUndoState(); api.selectedId.value = "image";
      await gesture(api, () => api.removeSelected()); assert.ok(api.animations.value.every(animation => animation.keyframeTracks.length === 0));
      assert.equal(history(api).length, 1); await api.undoEditorOperation(); assert.equal(api.captureUndoState(), original);
    });
    await test("Lua Data import modifies only the current animation", () => {
      const api = fixture(); addTrack(api, "sizeDeltaX"); const original = plain(api.activeAnimation.value); api.createAnimation();
      api.openTimelineDataImport(); api.timelineDataImportMode.value = "replace";
      api.timelineDataSource.value = 'return {schema="ClientUIAnimationEditor.TweenTimeline@7",duration=8,tracks={{"","localScaleZ",0,1,"Linear",1,2}}}';
      api.confirmTimelineDataImport(); assert.equal(api.keyframeTracks.value.length, 1); assert.equal(api.keyframeTracks.value[0].fieldKey, "localScaleZ"); assert.equal(api.duration.value, 8);
      assert.deepEqual(plain(api.animations.value[0]), original);
    });
    await test("Actual Lua Data export uses only the selected animation and includes its name in the filename", () => {
      const api = fixture(); addTrack(api, "sizeDeltaX"); api.renameAnimation("待机");
      const first = api.activeAnimationId.value; api.createAnimation(); api.renameAnimation("入场"); addTrack(api, "localScaleZ");
      api.exportSelectedNodeKeyframeData(); assert.equal(api.downloads.length, 1);
      assert.match(api.downloads[0].fileName, /入场/); assert.match(api.downloads[0].code, /"localScaleZ"/); assert.doesNotMatch(api.downloads[0].code, /"sizeDeltaX"/);
      api.selectAnimation(first); api.exportSelectedNodeKeyframeData();
      assert.match(api.downloads[1].fileName, /待机/); assert.match(api.downloads[1].code, /"sizeDeltaX"/); assert.doesNotMatch(api.downloads[1].code, /"localScaleZ"/);
    });
    await test("Legacy Clip-only files migrate into keyframes without changing preview during gaps and relative chains", async () => {
      const api = fixture();
      api.tweenTracks.value = [
        { id: "old-a", nodeId: "group", fieldKey: "anchoredPositionX", startTime: 0, duration: 1, initialValue: 0, endValue: 40, relative: true, easeType: "Linear" },
        { id: "old-b", nodeId: "group", fieldKey: "anchoredPositionX", startTime: 2, duration: 1, initialValue: 0, endValue: -90, relative: true, easeType: "OutQuad" },
      ];
      const samples = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4]; const before = samples.map((time) => api.buildTweenPreviewNodes(time).find((node) => node.id === "group").anchorOffsetX);
      const legacy = JSON.parse(api.serializeProject()); delete legacy.keyframeTracks; delete legacy.animations;
      api.applyProjectData(JSON.stringify(legacy));
      assert.equal(api.tweenTracks.value.length, 0); assert.equal(api.keyframeTracks.value.length, 1);
      assert.deepEqual(samples.map((time) => preview(api, time).anchorOffsetX), before);
    });
  } finally {
    instances.forEach((api) => api.close()); Module._load = originalLoad;
    if (originalTs) Module._extensions[".ts"] = originalTs; else delete Module._extensions[".ts"];
  }
  console.log(`\n${passed} keyframe editor integration checks passed; ${failures.length} failed.`);
  if (failures.length) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
