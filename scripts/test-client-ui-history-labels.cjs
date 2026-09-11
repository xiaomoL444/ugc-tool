/* Run: node scripts/test-client-ui-history-labels.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { parse, compileScript, compileTemplate } = require("@vue/compiler-sfc");
const originalTsExtension = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  });
  module._compile(result.outputText, filename);
};

try {
  const directory = path.resolve(__dirname, "../src/views/ClientUIAnimationEditor");
  const { describeHistoryChange } = require(path.join(directory, "historyChangeLabel.ts"));
  const { createControlProperties } = require(path.join(directory, "controlRegistry.ts"));
  const node = (id, type = "container", parentId = null) => ({
    id, name: id, type, parentId, x: 300, y: 200, width: 100, height: 100,
    anchorOffsetX: 0, anchorOffsetY: 0, sizeDeltaX: 100, sizeDeltaY: 100,
    scaleX: 1, scaleY: 1, scaleZ: 1, rotation: 0, rotationX: 0, rotationY: 0,
    anchorMinX: 0.5, anchorMaxX: 0.5, anchorMinY: 0.5, anchorMaxY: 0.5,
    pivotX: 0.5, pivotY: 0.5, active: true, visible: true, locked: false,
    properties: createControlProperties(type), editor: { directionArrowLength: 160 },
  });
  const clip = (id = "clip") => ({ id, nodeId: "Text", fieldKey: "anchoredPositionX", startTime: 1,
    duration: 1, initialValue: 0, endValue: 40, relative: false, easeType: "Linear" });
  const original = () => ({ nodes: [node("Root"), node("Text", "text", "Root"), node("Image", "image", "Root")],
    tweenTracks: [clip()], duration: 5, deviceMode: "pc", previewPresetId: "pc-16-9",
    canvasWidth: 1600, canvasHeight: 900, timelineSnapEnabled: true, showContainerBones: true });
  function change(mutator, source = original()) {
    const before = JSON.stringify(source);
    const after = JSON.parse(before);
    mutator(after);
    const result = describeHistoryChange(before, JSON.stringify(after));
    assert.equal(JSON.stringify(source), before, "Description must not mutate its source");
    return result;
  }
  let passed = 0;
  function test(name, run) { run(); passed++; console.log(`PASS ${name}`); }

  test("Added controls use their registered Chinese type and name", () => {
    assert.equal(change((state) => state.nodes.push(node("NewText", "text", "Root"))), "新增文本框「NewText」");
    assert.equal(change((state) => state.nodes.push(node("One"), node("Two"))), "新增 2 个控件");
  });
  test("Node deletion also removing its animation is a single node operation", () => {
    assert.equal(change((state) => { state.nodes.splice(1, 1); state.tweenTracks = []; }), "删除控件「Text」");
    assert.equal(change((state) => { state.nodes = []; state.tweenTracks = []; }), "删除 3 个控件");
  });
  test("Replacing a hierarchy is named before derived preview dimension changes", () => {
    assert.equal(change((state) => { state.nodes = [node("NewRoot")]; state.canvasWidth = 2100; }), "替换控件层级");
  });
  test("Reparenting wins over derived positions and sibling ordering", () => {
    assert.equal(change((state) => { state.nodes[1].parentId = "Image"; state.nodes[1].anchorOffsetX += 10; }), "将「Text」移入「Image」");
  });
  test("Reordering controls is described as hierarchy order", () => {
    assert.equal(change((state) => { [state.nodes[1], state.nodes[2]] = [state.nodes[2], state.nodes[1]]; }), "调整「Image」的层级顺序");
  });
  test("Renames include original and new names", () => {
    assert.equal(change((state) => { state.nodes[1].name = "对话文本"; }), "重命名「Text」为「对话文本」");
  });
  test("Anchored offsets are position changes, never anchor changes", () => {
    assert.equal(change((state) => { state.nodes[1].anchorOffsetX = 40; state.nodes[1].x += 40; }), "移动「Text」");
    assert.equal(change((state) => { state.nodes[1].anchorOffsetY = -10; }), "移动「Text」");
  });
  test("Anchor and pivot actions take priority over recalculated offsets or dimensions", () => {
    assert.equal(change((state) => { Object.assign(state.nodes[1], { anchorMinX: 0, anchorOffsetX: 40, width: 150 }); }), "修改「Text」的锚点");
    assert.equal(change((state) => { Object.assign(state.nodes[1], { pivotX: 0, x: 0, anchorOffsetX: -50 }); }), "修改「Text」的中心点");
  });
  test("Parent size, scale and rotation take priority over descendant world motion", () => {
    assert.equal(change((state) => { state.nodes[0].scaleX = 2; state.nodes[1].x = 600; }), "缩放「Root」");
    assert.equal(change((state) => { state.nodes[0].width = 200; state.nodes[1].x = 350; }), "调整「Root」的大小");
    assert.equal(change((state) => { state.nodes[0].rotation = 30; state.nodes[1].x = 350; }), "旋转「Root」");
  });
  test("The actual highest changed ancestor wins even if nodes are in child-first order", () => {
    const state = original();
    state.nodes.reverse();
    assert.equal(change((next) => { next.nodes[2].rotation = 20; next.nodes[1].x = 250; }, state), "旋转「Root」");
  });
  test("Real API sizeDelta changes are named as size edits", () => {
    assert.equal(change((state) => { state.nodes[1].sizeDeltaY = 150; }), "调整「Text」的大小");
  });
  test("Active, visibility, locks and direction arrow changes have action labels", () => {
    assert.equal(change((state) => { state.nodes[1].active = false; }), "停用「Text」");
    assert.equal(change((state) => { state.nodes[1].visible = false; }), "隐藏「Text」");
    assert.equal(change((state) => { state.nodes[1].locked = true; }), "锁定「Text」");
    assert.equal(change((state) => { state.nodes[0].editor.directionArrowLength = 250; }), "修改「Root」的方向标识");
  });
  test("Text, colors and arbitrary registry properties use the registered Chinese field", () => {
    assert.equal(change((state) => { state.nodes[1].properties.text = "内容"; }), "修改「Text」的文本内容");
    assert.equal(change((state) => { state.nodes[1].properties.fontColor.a = 0.25; }), "修改「Text」的文本颜色");
    assert.equal(change((state) => { state.nodes[2].properties.fillAmount = 0.5; }), "修改「Image」的填充量");
    assert.equal(change((state) => { state.nodes[1].properties.fontColor.a = 0.25; state.nodes[1].properties.bgColor.a = 0.5; }), "修改「Text」的颜色");
  });
  test("Device preview changes do not appear as many node movements", () => {
    assert.equal(change((state) => { state.previewPresetId = "pc-21-9"; state.canvasWidth = 2100; state.nodes[0].width = 2100; state.nodes[1].x = 350; }), "切换画布预览设备或尺寸");
  });
  test("Single and multiple added or removed clips are described correctly", () => {
    assert.equal(change((state) => { state.tweenTracks.push(clip("clip2")); state.duration = 10; }), "新增 「Text · 位置 X」 Clip");
    assert.equal(change((state) => { state.tweenTracks.push(clip("clip2"), clip("clip3")); }), "新增 2 个 Clip");
    assert.equal(change((state) => { state.tweenTracks = []; }), "删除 「Text · 位置 X」 Clip");
    assert.equal(change((state) => { state.tweenTracks = [clip("replacement")]; }), "替换 Timeline 动画");
  });
  test("Clip move and edge trimming are distinguished", () => {
    assert.equal(change((state) => { state.tweenTracks[0].startTime = 2; }), "移动 「Text · 位置 X」 Clip");
    assert.equal(change((state) => { state.tweenTracks[0].startTime = 0; state.tweenTracks[0].duration = 2; }), "调整 「Text · 位置 X」 Clip 时长");
  });
  test("Clip ease, both endpoints and relative mode are distinguished", () => {
    assert.equal(change((state) => { state.tweenTracks[0].easeType = "OutQuad"; }), "修改 「Text · 位置 X」 Clip 缓动");
    assert.equal(change((state) => { state.tweenTracks[0].initialValue = 10; }), "修改 「Text · 位置 X」 Clip 初始值");
    assert.equal(change((state) => { state.tweenTracks[0].endValue = 70; }), "修改 「Text · 位置 X」 Clip 结束值");
    assert.equal(change((state) => { state.tweenTracks[0].initialValue = 10; state.tweenTracks[0].endValue = 70; }), "修改 「Text · 位置 X」 Clip 起止值");
    assert.equal(change((state) => { state.tweenTracks[0].relative = true; state.tweenTracks[0].initialValue = 0; }), "启用 「Text · 位置 X」 Clip 增量");
  });
  test("Color clips and group alpha use their actual registry names", () => {
    const state = original();
    state.tweenTracks[0].fieldKey = "fontColor";
    state.tweenTracks[0].initialValue = { r: 255, g: 255, b: 255, a: 1 };
    assert.equal(change((next) => { next.tweenTracks[0].initialValue.a = 0; }, state), "修改 「Text · 文本颜色」 Clip 初始值");
    state.tweenTracks[0].fieldKey = "groupAlpha";
    assert.equal(change((next) => { next.tweenTracks[0].endValue = 0; }, state), "修改 「Text · 自身及子级透明度」 Clip 结束值");
  });
  test("Duration, snap and skeleton toggles have concise action labels", () => {
    assert.equal(change((state) => { state.duration = 8; }), "调整序列时长");
    assert.equal(change((state) => { state.timelineSnapEnabled = false; }), "关闭时间轴吸附");
    assert.equal(change((state) => { state.showContainerBones = false; }), "隐藏容器骨骼");
  });
  test("Malformed and unknown data falls back safely without crashes", () => {
    assert.equal(describeHistoryChange("malformed", "{}"), "修改编辑内容");
    assert.equal(describeHistoryChange("[]", "null"), "修改编辑内容");
    assert.equal(describeHistoryChange("{}", "{}"), "修改编辑内容");
    assert.equal(change((state) => { state.nodes[1].properties.futureField = 1; }), "修改「Text」的控件属性");
    const state = original();
    state.nodes[1].parentId = "Image";
    state.nodes[2].parentId = "Text";
    assert.equal(change((next) => { next.nodes[1].x += 1; next.nodes[2].x += 1; }, state), "移动「Text」");
  });
  test("History popover script and template compile without errors", () => {
    const filename = path.join(directory, "EditorHistoryPanel.vue");
    const { descriptor, errors } = parse(fs.readFileSync(filename, "utf8"), { filename });
    assert.deepEqual(errors, []);
    const script = compileScript(descriptor, { id: "history-panel" });
    const template = compileTemplate({ source: descriptor.template.content, filename, id: "history-panel", compilerOptions: { bindingMetadata: script.bindings } });
    assert.deepEqual(template.errors, []);
    assert.match(descriptor.template.content, /role="dialog" aria-label="操作记录"/);
    assert.doesNotMatch(descriptor.template.content, /@click="[^\"]*(?:entry|position|jump)/);
    assert.match(descriptor.template.content, /pointerdown\.stop/);
  });
  console.log(`${passed} history label and panel checks passed.`);
} finally {
  if (originalTsExtension) Module._extensions[".ts"] = originalTsExtension;
  else delete Module._extensions[".ts"];
}
