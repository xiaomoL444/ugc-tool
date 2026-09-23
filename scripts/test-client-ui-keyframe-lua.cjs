/* Run: node scripts/test-client-ui-keyframe-lua.cjs
 * Set LUA_BIN, or PYTHON_BIN + LUPA_PATH (lupa.lua53), to execute API mocks.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");
const previousTs = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, filename);

try {
  const editor = path.resolve(__dirname, "../src/views/ClientUIAnimationEditor");
  const { buildKeyframeTimelineDataLua, prepareKeyframeTimelineImport, KEYFRAME_TIMELINE_SCHEMA } = require(path.join(editor, "keyframeLua.ts"));
  const { buildTweenTimelineDataLua, buildTweenTimelineLibLua, TWEEN_TIMELINE_LIB_VERSION } = require(path.join(editor, "luaTweenExporter.ts"));
  const { parseLuaData } = require(path.join(editor, "luaDataParser.ts"));
  const { createControlProperties } = require(path.join(editor, "controlRegistry.ts"));
  const { evaluateKeyframeTrack, migrateTweenClipsToKeyframes } = require(path.join(editor, "keyframeTimeline.ts"));
  const node = (id, type = "container", parentId = null, name = id) => ({ id, name, type, parentId,
    anchorOffsetX: 100, anchorOffsetY: 200, sizeDeltaX: 150, sizeDeltaY: 100, scaleX: 1, scaleY: 1, scaleZ: 1,
    properties: createControlProperties(type) });
  const nodes = [node("root"), node("group", "container", "root", "容器"), node("text", "text", "group", "文本"), node("image", "image", "group", "图片"), node("external", "image", "root", "外部")];
  const key = (id, time, value, extra = {}) => ({ id, time, value, easeType: "Linear", interpolation: "tween", ...extra });
  const track = (id, nodeId = "text", fieldKey = "anchoredPositionX", keyframes = [key(id + "0", 0, 20), key(id + "1", 1, 40)]) => ({ id, nodeId, fieldKey, keyframes });
  const exportData = (tracks, extra = {}) => buildKeyframeTimelineDataLua({ projectName: "验证项目", rootNodeId: "root", nodes, tracks, sequenceDuration: 5, ...extra });
  const importData = (source, extra = {}) => prepareKeyframeTimelineImport({ source, rootNodeId: "root", nodes, existingTracks: [], mode: "append", sequenceDuration: 5, ...extra });
  const lua = (value) => value === null || value === undefined ? "nil" : typeof value === "string" ? JSON.stringify(value)
    : Array.isArray(value) ? "{ " + value.map(lua).join(", ") + " }"
    : typeof value === "object" ? "{ " + Object.entries(value).map(([name, item]) => name + " = " + lua(item)).join(", ") + " }" : String(value);
  const dataSource = (rows, extra = {}) => "return " + lua({ schema: KEYFRAME_TIMELINE_SCHEMA, duration: 5, tracks: rows, ...extra });
  const row = (path = "容器/文本", field = "anchoredPositionX", values = [[0, 20, false, "Linear", "tween"], [1, 40, false, "Linear", "step"]]) => [path, field, values];
  const withoutIds = (tracks) => tracks.map(({ nodeId, fieldKey, keyframes }) => ({ nodeId, fieldKey, keyframes: keyframes.map(({ id, relative, incomingRelative, ...rest }) => ({ ...rest, relative: Boolean(relative), ...(rest.incomingValue === undefined ? {} : { incomingRelative: Boolean(incomingRelative) }) })) }));
  let passed = 0;
  function test(name, check) { check(); passed++; console.log(`PASS ${name}`); }
  test("Events-only Data round trips parameters, scoped targets and stable same-time order", () => {
    const events = [
      { id: "e1", time: 0, name: "Start", nodeId: null, params: "" },
      { id: "e2", time: 1, name: "音效", nodeId: "text", params: '引号"和\\换行\n' },
      { id: "e3", time: 1, name: "Next", nodeId: "text", params: "" },
      { id: "e4", time: 2, name: "Outside", nodeId: "external", params: "" },
    ];
    const output = exportData([], { rootNodeId: "group", events });
    assert.equal(output.eventCount, 3); assert.equal(output.trackCount, 0);
    const data = parseLuaData(output.code);
    assert.deepEqual(data.events.map(e => e.target), ["", "文本", "文本"]);
    const imported = importData(output.code, { rootNodeId: "group" });
    assert.deepEqual(imported.errors, []);
    assert.deepEqual(imported.events.map(e => e.name), ['Start', '音效', 'Next']);
    assert.equal(imported.events[0].nodeId, 'group');
    assert.deepEqual(imported.events[1].params, events[1].params);
    assert.equal(imported.events[1].time, imported.events[2].time);
    const replaced = importData(output.code, { rootNodeId: "group", mode: "replace", existingEvents: events });
    assert.deepEqual(replaced.errors, []);
    assert.ok(replaced.events.some(e => e.id === "e4"));
    assert.ok(!replaced.events.some(e => e.id === "e2"));
    const invalid = importData(dataSource([], { events: [{time: 1, name: 'Bad', target: 'missing', params: ""}] }));
    assert.ok(invalid.errors.length); assert.deepEqual(invalid.events, []);
  });
  test("Data records required Lib version and runtime checks it before keyframe or Clip creation", () => {
    const data = parseLuaData(exportData([track("version")]).code);
    assert.equal(data.libVersion, TWEEN_TIMELINE_LIB_VERSION);
    const runtime = buildTweenTimelineLibLua().code;
    assert.ok(runtime.includes(`TweenTimelineLib.Version = "${TWEEN_TIMELINE_LIB_VERSION}"`));
    const create = runtime.slice(runtime.indexOf('function TweenTimelineLib.Create(root, data, options)'));
    assert.ok(create.indexOf('CheckDataVersion(data)') < create.indexOf('CreateKeyframes(root, data, options)'));
    assert.ok(create.indexOf('CheckDataVersion(data)') < create.indexOf('local sequence = game.TweenSequence()'));
    assert.match(runtime, /data\.libVersion ~= nil/);
    assert.match(runtime, /required\[index\] or 0, installed\[index\] or 0/);
    assert.match(runtime, /版本不匹配/);
    assert.match(runtime, /重新下载并导入\/替换 Lib\/TweenTimelineLib\.lua/);
  });
  test("@8 exports nested reversible keyframes without legacy Clip columns", () => {
    const result = exportData([track("a")]);
    const data = parseLuaData(result.code);
    assert.equal(data.schema, "ClientUIAnimationEditor.TweenTimeline@8");
    assert.equal(data.duration, 5);
    assert.equal(data.columns, undefined);
    assert.equal(data.tracks[0][0], "容器/文本");
    assert.equal(data.tracks[0][1], "anchoredPositionX");
    assert.equal(data.tracks[0][2].length, 2);
    assert.equal(result.fileName, "验证项目-root-TweenTimelineData.lua");
    assert.equal(result.trackCount, 1);
    assert.equal(result.targetCount, 1);
    assert.equal(result.tweenCount, 1);
  });
  test("Round trips numeric precision, outgoing ease, relative and incoming values", () => {
    const original = [track("size", "text", "sizeDeltaX", [key("a", 0.00000123456789, -20, { relative: true, easeType: "OutQuad" }),
      key("b", 1.234567891, 50.123456789, { relative: true, incomingValue: 10, incomingRelative: true, interpolation: "step" })])];
    const imported = importData(exportData(original).code);
    assert.deepEqual(imported.errors, []);
    assert.deepEqual(withoutIds(imported.tracks), withoutIds(original));
  });
  test("Color and its incoming left limit use byte RGBA, never 0-1 Data alpha", () => {
    const color = { r: 12, g: 34, b: 56, a: 0.5 };
    const result = exportData([track("color", "text", "fontColor", [key("first", 0, color), key("last", 1, { ...color, a: 0 }, { incomingValue: { ...color, a: 1 } })])]);
    const data = parseLuaData(result.code);
    assert.deepEqual(data.tracks[0][2][0][1], [12, 34, 56, 128]);
    assert.deepEqual(data.tracks[0][2][1][5], [12, 34, 56, 255]);
    const imported = importData(result.code);
    assert.equal(imported.tracks[0].keyframes[0].value.a, 128 / 255);
    assert.equal(imported.tracks[0].keyframes[1].incomingValue.a, 1);
  });
  test("Lone keys, step segments and terminal keys survive without fake Tween durations", () => {
    const original = [track("lone", "text", "fontSize", [key("point", 2, 30, { interpolation: "step" })]),
      track("step", "image", "anchoredPositionX", [key("a", 0, 5, { interpolation: "step" }), key("b", 3, 15, { interpolation: "step" })])];
    const result = exportData(original);
    assert.equal(result.tweenCount, 0);
    assert.equal(result.trackCount, 2);
    assert.deepEqual(withoutIds(importData(result.code).tracks), withoutIds(original));
  });
  test("Group alpha counts real color targets and never adds a fake container color", () => {
    const result = exportData([track("alpha", "group", "groupAlpha", [key("a", 0, 255), key("b", 1, 0)])]);
    assert.equal(result.targetCount, 2);
    assert.equal(result.tweenCount, 4);
    assert.equal(parseLuaData(result.code).tracks[0][1], "groupAlpha");
    assert.deepEqual(importData(result.code).errors, []);
  });
  test("Selected root and child paths scope export while external tracks stay outside", () => {
    const result = exportData([track("own", "group"), track("child"), track("outside", "external")], { rootNodeId: "group" });
    assert.equal(result.trackCount, 2);
    assert.deepEqual(parseLuaData(result.code).tracks.map((item) => item[0]), ["", "文本"]);
    const imported = importData(result.code, { rootNodeId: "group" });
    assert.deepEqual(imported.tracks.map((item) => item.nodeId), ["group", "text"]);
  });
  test("Lua quoting preserves Chinese, quotes, backslashes, tabs and control bytes", () => {
    const name = '文本"\\\t\n\u0001A';
    const renamed = nodes.map((item) => item.id === "text" ? { ...item, name } : item);
    const result = exportData([track("escaped")], { nodes: renamed });
    assert.equal(parseLuaData(result.code).tracks[0][0], "容器/" + name);
    assert.deepEqual(importData(result.code, { nodes: renamed }).errors, []);
  });
  test("Export refuses ambiguous paths even when only one of the same-named siblings is animated", () => {
    const duplicate = [...nodes, node("duplicate", "text", "group", "文本")];
    assert.throws(() => exportData([track("a")], { nodes: duplicate }), /同名/);
    const unsafe = nodes.map((item) => item.id === "group" ? { ...item, name: "不/安全" } : item);
    assert.throws(() => exportData([track("a")], { nodes: unsafe }), /FindChild/);
  });
  test("Incomplete or unsupported export data is rejected, not silently dropped", () => {
    assert.throws(() => exportData([track("a", "text", "unknown")]), /不支持/);
    assert.throws(() => exportData([track("a", "missing")]), /找不到/);
    assert.throws(() => exportData([track("a", "text", "fontSize", [key("null", 0, null)])]), /有效值/);
    assert.throws(() => exportData([track("a", "text", "fontSize", [])]), /尚未设置/);
    assert.throws(() => exportData([track("a", "text", "fontSize", [key("a", 0, 1), key("b", 0, 2)])]), /重复关键帧/);
  });
  test("Export duration expands to retain the last key and keeps longer requested duration", () => {
    const tracks = [track("a", "text", "fontSize", [key("late", 20, 30)])];
    assert.equal(parseLuaData(exportData(tracks, { sequenceDuration: 2 }).code).duration, 20);
    assert.equal(parseLuaData(exportData(tracks, { sequenceDuration: 30 }).code).duration, 30);
  });
  test("Append merges same-field distinct times while preserving existing lane ID and source objects", () => {
    const existingTracks = [track("existing", "text", "anchoredPositionX", [key("existing-key", 3, 300)])];
    const before = JSON.stringify(existingTracks);
    const result = importData(dataSource([row()]), { existingTracks });
    assert.deepEqual(result.errors, []);
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].id, "existing");
    assert.deepEqual(result.tracks[0].keyframes.map((frame) => frame.time), [0, 1, 3]);
    assert.equal(result.importedTracks[0].id, "existing");
    assert.equal(result.importedTracks[0].keyframes.length, 2);
    assert.equal(JSON.stringify(existingTracks), before);
  });
  test("Duplicate times and one-microsecond collisions fail atomically without clearing the original", () => {
    const existingTracks = [track("existing")];
    for (const time of [0, 0.0000005]) {
      const result = importData(dataSource([row("容器/文本", "anchoredPositionX", [[time, 20, false, "Linear", "tween"]])]), { existingTracks });
      assert.equal(result.tracks, existingTracks);
      assert.equal(result.importedTracks.length, 0);
      assert.equal(result.replacedCount, 0);
      assert.match(result.errors.join(), /已有关键帧/);
    }
  });
  test("Replace deletes only the selected root subtree and retains other animation duration", () => {
    const external = track("outside", "external", "anchoredPositionY", [key("last", 12, 200)]);
    const existingTracks = [track("root-own", "group"), track("old-child"), external];
    const result = importData(dataSource([row("文本")], { duration: 2 }), { rootNodeId: "group", existingTracks, mode: "replace" });
    assert.deepEqual(result.errors, []);
    assert.equal(result.replacedCount, 2);
    assert.equal(result.tracks.length, 2);
    assert.equal(result.tracks[0].id, "outside");
    assert.equal(result.duration, 12);
  });
  test("Data rows for the same lane merge only when all frame times remain unique", () => {
    const result = importData(dataSource([row("容器/文本", "fontSize", [[1, 20, false, "Linear", "tween"]]), row("容器/文本", "fontSize", [[2, 40, false, "Linear", "step"]])]));
    assert.deepEqual(result.errors, []);
    assert.equal(result.tracks.length, 1);
    assert.equal(result.importedTracks.length, 1);
    assert.equal(result.importedTracks[0].keyframes.length, 2);
  });
  test("All-or-nothing validation rejects mixed valid and invalid rows in both modes", () => {
    const existingTracks = [track("old")];
    for (const mode of ["append", "replace"]) {
      const result = importData(dataSource([row(), row("找不到")]), { existingTracks, mode });
      assert.equal(result.tracks, existingTracks);
      assert.equal(result.importedTracks.length, 0);
      assert.equal(result.duration, 5);
      assert.match(result.errors.join(), /找不到路径/);
    }
  });
  test("Malformed frame shape, time, values, easing, interpolation and relative fields are rejected", () => {
    const invalid = [
      [-1, 20, false, "Linear", "tween"], [0, null, false, "Linear", "tween"],
      [0, 20, "yes", "Linear", "tween"], [0, 20, false, "Unknown", "tween"],
      [0, 20, false, "Linear", "hold"], [0, 20, false, "Linear", "tween", null, true],
      [0, 20, false, "Linear", "tween", 20, "yes"], [0, 20, false, "Linear", "tween", 20, false, 123],
    ];
    for (const entry of invalid) assert.ok(importData(dataSource([row("容器/文本", "anchoredPositionX", [entry])])).errors.length, lua(entry));
    assert.ok(importData(dataSource([row("容器/文本", "fontSize", [[0, 20, true, "Linear", "tween"]])])).errors.length);
    assert.ok(importData(dataSource([row("容器/文本", "fontColor", [[0, [255, 0, 0, 256], false, "Linear", "tween"]])])).errors.length);
    assert.ok(importData(dataSource([row("容器", "groupAlpha", [[0, -1, false, "Linear", "tween"]])])).errors.length);
  });
  test("Unknown schema, runtime source, executable Lua and empty tracks never execute or clear anything", () => {
    for (const source of [dataSource([], { schema: "wrong" }), dataSource([]), buildTweenTimelineLibLua().code, 'return game.TweenSequence()', 'return {schema="ClientUIAnimationEditor.TweenTimeline@8", duration=1, tracks={}}; printerr("run")']) {
      const existingTracks = [track("old")];
      const result = importData(source, { existingTracks, mode: "replace" });
      assert.ok(result.errors.length);
      assert.equal(result.tracks, existingTracks);
    }
  });
  test("Unknown controls and duplicate child names block import without inventing nodes", () => {
    const source = dataSource([row()]);
    assert.match(importData(source, { rootNodeId: "missing" }).errors.join(), /根控件/);
    assert.match(importData(source, { nodes: [...nodes, node("duplicate", "text", "group", "文本")] }).errors.join(), /同名/);
    assert.match(importData(dataSource([row("容器/文本", "alive")])).errors.join(), /不支持/);
  });
  test("Group alpha cannot overlap another writer, including retained outside-scope ancestors", () => {
    const conflict = dataSource([row("容器", "groupAlpha", [[0, 255, false, "Linear", "step"]]), row("容器/文本", "fontColor", [[1, [255, 255, 255, 255], false, "Linear", "step"]])]);
    assert.ok(importData(conflict).errors.length);
    const existingTracks = [track("ancestor", "root", "groupAlpha", [key("all", 0, 255)])];
    const result = importData(dataSource([row("文本", "fontColor", [[1, [255, 255, 255, 0], false, "Linear", "step"]])]), { rootNodeId: "group", existingTracks, mode: "replace" });
    assert.equal(result.tracks, existingTracks);
    assert.ok(result.errors.length);
  });
  test("Every legacy @3-7 Data form migrates using the exact shared migration logic", () => {
    const clip = { id: "old", nodeId: "text", fieldKey: "anchoredPositionX", startTime: 0, duration: 1, initialValue: 20, endValue: 40, easeType: "OutQuad" };
    for (let version = 3; version <= 7; version++) {
      const source = "return " + lua({ schema: "ClientUIAnimationEditor.TweenTimeline@" + version, duration: 5, tracks: [["容器/文本", "anchoredPositionX", 0, 1, "OutQuad", 20, 40]] });
      const result = importData(source);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(withoutIds(result.tracks), withoutIds(migrateTweenClipsToKeyframes([clip])));
    }
  });
  test("Legacy touching discontinuities, gap holds and relative endpoints survive @8 round trip", () => {
    const clips = [
      { id: "a", nodeId: "text", fieldKey: "anchoredPositionX", startTime: 0, duration: 1, initialValue: 0, endValue: 40, relative: true, easeType: "Linear" },
      { id: "b", nodeId: "text", fieldKey: "anchoredPositionX", startTime: 1, duration: 1, initialValue: 20, endValue: -90, relative: true, easeType: "OutQuad" },
      { id: "c", nodeId: "text", fieldKey: "anchoredPositionX", startTime: 3, duration: 1, initialValue: 200, endValue: 250, easeType: "Linear" },
    ];
    const legacy = buildTweenTimelineDataLua({ projectName: "Old", rootNodeId: "root", nodes, tracks: clips });
    assert.equal(parseLuaData(legacy.code).schema, "ClientUIAnimationEditor.TweenTimeline@7");
    const first = importData(legacy.code);
    assert.deepEqual(first.errors, []);
    const second = importData(exportData(first.tracks).code);
    assert.deepEqual(second.errors, []);
    assert.deepEqual(withoutIds(first.tracks), withoutIds(second.tracks));
    const lane = second.tracks[0];
    assert.equal(evaluateKeyframeTrack(lane, 0.5, 100), 120);
    assert.equal(evaluateKeyframeTrack(lane, 1, 100), 160);
    assert.equal(evaluateKeyframeTrack(lane, 2.5, 100), 50);
    assert.equal(evaluateKeyframeTrack(lane, 3, 100), 200);
  });
  test("Old Clip exports retain @3/5/7 while the shared runtime advertises @8", () => {
    assert.equal(TWEEN_TIMELINE_LIB_VERSION, "8.3");
    const runtime = buildTweenTimelineLibLua().code;
    assert.match(runtime, /TweenTimelineLib.Schema = "ClientUIAnimationEditor.TweenTimeline@8"/);
    for (let version = 3; version <= 8; version++) assert.ok(runtime.includes("ClientUIAnimationEditor.TweenTimeline@" + version));
    assert.match(runtime, /if type\(data\) == "table" and data.schema == "ClientUIAnimationEditor.TweenTimeline@8" then return CreateKeyframes\(root, data, options\) end/);
  });
  test("@8 runtime snapshots before constructing Tweens, handles step/last keys, and registers cleanup", () => {
    const runtime = buildTweenTimelineLibLua().code;
    const branch = runtime.slice(runtime.indexOf("local function CreateKeyframes"), runtime.indexOf("function TweenTimelineLib.Create"));
    assert.ok(branch.indexOf("baseline = control[field]") < branch.indexOf("game.Tween(target"));
    assert.match(branch, /sequence:InsertCallback\(0, RestoreInitials\)/);
    assert.match(branch, /sequence:InsertCallback\(key.time, function\(\) SetKeyframeField\(target\[1\], target\[2\], value\) end\)/);
    assert.match(branch, /nextKey ~= nil and key.interpolation == "tween"/);
    assert.match(branch, /sequence:InsertCallback\(lastTime, function\(\) end\)/);
    assert.match(branch, /createdTweens\[#createdTweens \+ 1\] = tween\s+tween:SetEase/);
    assert.match(branch, /createdTweens\[index\]:Kill\(false\)/);
    assert.match(branch, /待游戏内验证/);
    assert.doesNotMatch(branch, /require\(|ControlAlphaGroup|SetFrom|:From\(/);
  });

  test("Visibility round trips booleans, switches exactly at keys and retains its setup state before them", () => {
    const visibility = track("visibility", "group", "visible", [key("hide", 2, false, { interpolation: "step" }), key("show", 4, true, { interpolation: "step" })]);
    const result = exportData([visibility]);
    assert.equal(result.tweenCount, 0);
    assert.match(result.code, /v8\.2\+/);
    assert.deepEqual(withoutIds(importData(result.code).tracks), withoutIds([visibility]));
    for (const [time, value] of [[0, true], [1.999999, true], [2, false], [3.999999, false], [4, true], [9, true], [1, true]]) {
      assert.equal(evaluateKeyframeTrack(visibility, time, true), value);
    }
    assert.equal(evaluateKeyframeTrack(visibility, 1, false), false);
    for (const values of [[2, 0, false, "Linear", "step"], [2, "false", false, "Linear", "step"], [2, false, true, "Linear", "step"],
      [2, false, false, "Linear", "tween"], [2, false, false, "Linear", "step", true]]) {
      assert.ok(importData(dataSource([row("容器", "visible", [values])])).errors.length);
    }
    assert.throws(() => exportData([{ ...visibility, keyframes: [key("bad", 2, false)] }]), /显隐/);
  });

  const library = buildTweenTimelineLibLua().code;
  const candidates = process.env.LUA_BIN ? [process.env.LUA_BIN] : ["lua", "lua53", "luajit"];
  const executable = candidates.find((candidate) => { const result = spawnSync(candidate, ["-v"], { encoding: "utf8", timeout: 5000, windowsHide: true }); return !result.error && result.status === 0; });
  if (process.env.LUA_BIN && !executable) throw new Error("LUA_BIN does not name a runnable Lua executable");
  const useLupa = !executable && process.env.PYTHON_BIN && process.env.LUPA_PATH;
  if (executable || useLupa) {
    test("Generated @8 Lua executes against native-API mocks: relative, jump, step, singleton, replay and legacy", () => {
      const script = `
local logs = {}
function printerr(message) logs[#logs + 1] = message end
function typeof(control) return control.kind end
Enum = { EaseType = { Linear = "Linear", OutQuad = "OutQuad" } }
Color = {}
function Color.FromRGBA(r,g,b,a) return { r,g,b,a, color = true } end
function Color.ToRGBA(value) assert(value.color); return value[1],value[2],value[3],value[4] end
game = {}
function game.Tween(control, values, duration)
    local tween = { control = control, values = values, duration = duration, from = {} }
    for field in pairs(values) do tween.from[field] = control[field] end
    function tween:SetEase(ease) self.ease = ease; return self end
    function tween:SetRelative(relative) self.relative = relative; return self end
    function tween:Kill() self.killed = true end
    return tween
end
function game.TweenSequence()
    local sequence = { items = {}, callbacks = {} }
    function sequence:Insert(time, tween) self.items[#self.items+1] = {time,tween}; return self end
    function sequence:InsertCallback(time, callback) self.callbacks[#self.callbacks+1] = {time,callback}; return self end
    function sequence:Kill() self.killed = true end
    return sequence
end
local Lib = (function()
${library}
end)()
local root = { kind = "ClientUIContainerControl", anchoredPositionX = 100, sizeDeltaX = 150 }
function root:GetChildren() return self.children or {} end
function root:FindChild(path) for _, child in ipairs(self:GetChildren()) do if child.name == path then return child end end end
local data = { schema = Lib.Schema, duration = 8, tracks = {
    { "", "anchoredPositionX", {
        {2, 0, true, "OutQuad", "tween"},
        {3, 60, true, "Linear", "step", 40, true},
        {5, -90, true, "Linear", "tween"},
        {6, 200, false, "Linear", "step"},
    } },
    { "", "sizeDeltaX", { {4, 75, false, "Linear", "step"} } },
} }
local sequence = Lib.Create(root, data)
assert(#logs == 0 and #sequence.items == 2)
assert(root.anchoredPositionX == 100 and root.sizeDeltaX == 75)
assert(sequence.items[1][1] == 2 and sequence.items[1][2].duration == 1)
assert(sequence.items[1][2].from.anchoredPositionX == 100 and sequence.items[1][2].values.anchoredPositionX == 140)
assert(sequence.items[1][2].ease == "OutQuad" and sequence.items[1][2].relative == false)
assert(sequence.items[2][1] == 5 and sequence.items[2][2].from.anchoredPositionX == 70 and sequence.items[2][2].values.anchoredPositionX == 200)
for _, callback in ipairs(sequence.callbacks) do if callback[1] == 3 then callback[2]() end end
assert(root.anchoredPositionX == 160)
for _, callback in ipairs(sequence.callbacks) do if callback[1] == 6 then callback[2]() end end
assert(root.anchoredPositionX == 200)
root.sizeDeltaX = 999
sequence.callbacks[1][2]()
assert(root.anchoredPositionX == 100 and root.sizeDeltaX == 75)
assert(sequence.callbacks[#sequence.callbacks][1] == 8)
assert(data.tracks[1][3][2][2] == 60 and data.tracks[1][3][2][6] == 40)
local image = { kind = "ClientUIImageControl", name = "Image", imageColor = Color.FromRGBA(10,20,30,128) }
function image:GetChildren() return {} end
root.children = { image }
local alphaData = { schema = Lib.Schema, duration = 2, tracks = { { "", "groupAlpha", { {0,255,false,"Linear","tween"},{1,0,false,"Linear","step"} } } } }
local alpha = Lib.Create(root, alphaData)
assert(#alpha.items == 1 and image.imageColor[4] == 128 and root.groupAlpha == nil)
assert(alpha.items[1][2].values.imageColor[4] == 0)
assert(alpha.items[1][2].relative == false)
image.imageColor = Color.FromRGBA(10,20,30,0)
local again = Lib.Create(root, alphaData)
assert(image.imageColor[4] == 128 and again.items[1][2].from.imageColor[4] == 128)
for version = 3,7 do
    local old = Lib.Create(root, { schema = "ClientUIAnimationEditor.TweenTimeline@" .. version, tracks = { { "", "anchoredPositionX", 0,1,"Linear",20,40 } } })
    assert(#old.items == 1 and root.anchoredPositionX == 20)
    assert(old.items[1][2].relative == false and old.items[1][2].values.anchoredPositionX == 40)
end
${fs.readFileSync(path.join(__dirname, "fixtures/timeline-rotation-runtime.lua"), "utf8")}
${fs.readFileSync(path.join(__dirname, "fixtures/timeline-visibility-runtime.lua"), "utf8")}
${fs.readFileSync(path.join(__dirname, "fixtures/timeline-events-runtime.lua"), "utf8")}
local count = #logs
local before = root.anchoredPositionX
local invalid = Lib.Create(root, {schema=Lib.Schema,duration=2,tracks={ {"","anchoredPositionX",{{0,10,false,"Linear","tween"},{0,20,false,"Linear","step"}}} }})
assert(#invalid.items == 0 and #logs == count + 1 and root.anchoredPositionX == before)
print("PASS emitted Lua keyframe mocks")
`;
      const result = useLupa
        ? spawnSync(process.env.PYTHON_BIN, ["-c", 'import sys; sys.path.insert(0, sys.argv[1]); from lupa.lua53 import LuaRuntime; LuaRuntime().execute(sys.stdin.read())', process.env.LUPA_PATH], { input: script, encoding: "utf8", timeout: 10000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } })
        : spawnSync(executable, ["-"], { input: script, encoding: "utf8", timeout: 10000, windowsHide: true });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /PASS emitted Lua keyframe mocks/);
      assert.match(result.stdout, /PASS rotation interpolation: 504 cases/);
      process.stdout.write(result.stdout);
    });
  } else console.log("SKIP emitted Lua execution: set LUA_BIN or PYTHON_BIN + LUPA_PATH; game callback ordering remains pending.");
  console.log(`${passed} keyframe Lua export/import checks passed.`);
} finally {
  if (previousTs) Module._extensions[".ts"] = previousTs; else delete Module._extensions[".ts"];
}
