/* Run: node scripts/test-client-ui-keyframe-history-labels.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const oldTs = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, filename);

try {
  const { describeHistoryChange } = require(path.resolve(__dirname, "../src/views/ClientUIAnimationEditor/historyChangeLabel.ts"));
  const frame = (id, time = 0) => ({ id, time, value: 20, relative: false, easeType: "Linear", interpolation: "tween" });
  const track = (id = "track", fieldKey = "fontSize") => ({ id, nodeId: "text", fieldKey, keyframes: [frame("first"), frame("last", 1)] });
  const original = () => ({ nodes: [{ id: "text", name: "对话文本", type: "text", parentId: null }], tweenTracks: [], keyframeTracks: [track()], duration: 5 });
  function change(mutator, source = original()) {
    const before = JSON.stringify(source);
    const after = JSON.parse(before);
    mutator(after);
    const label = describeHistoryChange(before, JSON.stringify(after));
    assert.equal(JSON.stringify(source), before);
    return label;
  }
  let passed = 0;
  function test(name, check) { check(); passed++; console.log(`PASS ${name}`); }
  test("Add, delete and replace keyframe tracks remain distinct", () => {
    assert.equal(change((state) => state.keyframeTracks.push(track("color", "fontColor"))), "新增 「对话文本 · 文本颜色」 关键帧轨道");
    assert.equal(change((state) => { state.keyframeTracks = []; }), "删除 「对话文本 · 字号」 关键帧轨道");
    assert.equal(change((state) => { state.keyframeTracks = [track("replacement")]; }), "替换关键帧动画");
    assert.equal(change((state) => state.keyframeTracks.push(track("a"), track("b"))), "新增 2 条关键帧轨道");
  });
  test("Adding and deleting individual and multiple frames labels the affected property", () => {
    assert.equal(change((state) => state.keyframeTracks[0].keyframes.push(frame("middle", 0.5))), "新增 「对话文本 · 字号」 关键帧");
    assert.equal(change((state) => state.keyframeTracks[0].keyframes.push(frame("a", 0.2), frame("b", 0.5))), "新增 「对话文本 · 字号」 的 2 个关键帧");
    assert.equal(change((state) => state.keyframeTracks[0].keyframes.pop()), "删除 「对话文本 · 字号」 关键帧");
    assert.equal(change((state) => { state.keyframeTracks[0].keyframes = []; }), "删除 「对话文本 · 字号」 的 2 个关键帧");
  });
  test("Dragging a frame and re-sorting the array still describes a move", () => {
    assert.equal(change((state) => { state.keyframeTracks[0].keyframes[0].time = 2; state.keyframeTracks[0].keyframes.reverse(); }), "移动 「对话文本 · 字号」 关键帧");
  });
  test("Numeric and ColorRGBA values are handled without mutating snapshots", () => {
    assert.equal(change((state) => { state.keyframeTracks[0].keyframes[0].value = 40; }), "修改 「对话文本 · 字号」 关键帧值");
    const state = original();
    state.keyframeTracks[0].fieldKey = "fontColor";
    state.keyframeTracks[0].keyframes[0].value = { r: 255, g: 255, b: 255, a: 1 };
    assert.equal(change((next) => { next.keyframeTracks[0].keyframes[0].value.a = 0.5; }, state), "修改 「对话文本 · 文本颜色」 关键帧值");
  });
  test("Easing, interpolation and additive modes have their own behavior labels", () => {
    assert.equal(change((state) => { state.keyframeTracks[0].keyframes[0].easeType = "OutQuad"; }), "修改 「对话文本 · 字号」 关键帧缓动");
    assert.equal(change((state) => { state.keyframeTracks[0].keyframes[0].interpolation = "hold"; }), "修改 「对话文本 · 字号」 关键帧插值方式");
    assert.equal(change((state) => { state.keyframeTracks[0].keyframes[0].relative = true; }), "启用 「对话文本 · 字号」 关键帧增量");
    const state = original();
    state.keyframeTracks[0].keyframes[0].relative = true;
    assert.equal(change((next) => { next.keyframeTracks[0].keyframes[0].relative = false; }, state), "关闭 「对话文本 · 字号」 关键帧增量");
  });
  test("Legacy snapshots with no keyframeTracks can add their first track", () => {
    const state = original();
    delete state.keyframeTracks;
    assert.equal(change((next) => { next.keyframeTracks = [track()]; }, state), "新增 「对话文本 · 字号」 关键帧轨道");
  });
  test("Keyframe changes win over duration extension or derived legacy Clip changes", () => {
    assert.equal(change((state) => { state.keyframeTracks[0].keyframes[0].time = 7; state.duration = 8; state.tweenTracks.push({ id: "derived", nodeId: "text", fieldKey: "fontSize" }); }), "移动 「对话文本 · 字号」 关键帧");
  });
  test("Unknown track details use safe labels, while node deletion remains the principal action", () => {
    assert.equal(change((state) => { state.nodes = []; state.keyframeTracks = []; }), "删除控件「对话文本」");
    assert.equal(change((state) => { state.keyframeTracks[0].fieldKey = "futureField"; }), "修改 「对话文本 · futureField」 关键帧轨道");
    assert.equal(change((state) => { state.keyframeTracks[0].keyframes = [frame("replacement")]; }), "替换 「对话文本 · 字号」 关键帧");
  });
  console.log(`${passed} keyframe history label checks passed.`);
} finally {
  if (oldTs) Module._extensions[".ts"] = oldTs; else delete Module._extensions[".ts"];
}
