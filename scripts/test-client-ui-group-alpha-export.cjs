/* Run: node scripts/test-client-ui-group-alpha-export.cjs
 * Optional: set LUA_BIN to a Lua 5.3 executable to run the emitted library
 * against documented-API mocks as well as the always-on exporter checks.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");

const originalTsExtension = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  });
  module._compile(compiled.outputText, filename);
};

try {
  const editor = path.resolve(__dirname, "../src/views/ClientUIAnimationEditor");
  const { createControlProperties } = require(path.join(editor, "controlRegistry.ts"));
  const { tweenEaseOptions } = require(path.join(editor, "tweenRegistry.ts"));
  const { buildTweenTimelineDataLua, buildTweenTimelineLibLua } = require(path.join(editor, "luaTweenExporter.ts"));
  let passed = 0;
  function test(name, check) { check(); passed += 1; console.log(`PASS ${name}`); }
  function node(id, type, parentId = null) {
    return { id, name: id, type, parentId, properties: createControlProperties(type) };
  }
  function track(nodeId, fieldKey = "groupAlpha", from = 255, to = 0, startTime = 0) {
    return { id: `${nodeId}:${fieldKey}`, nodeId, fieldKey, startTime, duration: 1, initialValue: from, endValue: to, easeType: "Linear" };
  }
  function fixture() {
    return [node("root", "container"), node("icon", "image", "root"), node("caption", "text", "icon"),
      node("panel", "container", "root"), node("window", "textWindow", "panel"),
      node("button", "presetButton", "root"), node("badge", "image", "button"), node("outside", "image")];
  }
  function exportData(nodes, tracks, rootNodeId = "root") {
    return buildTweenTimelineDataLua({ projectName: "Alpha Test", rootNodeId, nodes, tracks, sequenceDuration: 3 });
  }
  function rows(code) {
    return code.split("\n").filter((line) => line.startsWith("        { "))
      .map((line) => JSON.parse(line.trim().replace(/,$/, "").replace(/\{/g, "[").replace(/\}/g, "]")));
  }

  test("A group remains one reversible numeric Data row but counts expanded color Tweens", () => {
    const result = exportData(fixture(), [track("root")]);
    assert.match(result.code, /TweenTimeline@4/);
    assert.deepEqual(rows(result.code), [["", "groupAlpha", 0, 1, "Linear", 255, 0]]);
    assert.equal(result.trackCount, 1);
    assert.equal(result.tweenCount, 8);
    assert.equal(result.targetCount, 4);
    assert.deepEqual(result.warnings, []);
    assert.doesNotMatch(result.code, /\broot\s*=\s*\{/);
  });
  test("Exporting an image as root includes itself and text descendants only", () => {
    const result = exportData(fixture(), [track("icon"), track("outside")], "icon");
    assert.equal(result.tweenCount, 4);
    assert.equal(result.targetCount, 2);
    assert.deepEqual(rows(result.code)[0].slice(0, 2), ["", "groupAlpha"]);
  });
  test("Group export never fabricates Color on an empty control or modifies base colors", () => {
    const nodes = fixture();
    const before = JSON.stringify(nodes);
    exportData(nodes, [track("root", "groupAlpha", 96, 192)]);
    assert.equal(JSON.stringify(nodes), before);
    assert.equal(nodes[0].properties.imageColor, undefined);
  });
  test("Legacy numeric and color-only Data retains @3 and compact byte colors", () => {
    const result = exportData(fixture(), [track("root", "sizeDeltaX", 1600, 2000),
      track("icon", "imageColor", { r: 12, g: 34, b: 56, a: 0.5 }, { r: 12, g: 34, b: 56, a: 0 })]);
    assert.match(result.code, /TweenTimeline@3/);
    assert.doesNotMatch(result.code, /groupAlpha/);
    assert.deepEqual(rows(result.code)[1].slice(5), [[12, 34, 56, 128], [12, 34, 56, 0]]);
    assert.equal(result.tweenCount, 2);
  });
  test("Disjoint groups and transform tracks can coexist", () => {
    const result = exportData(fixture(), [track("icon"), track("panel"), track("root", "localScaleX", 1, 2)]);
    assert.equal(result.trackCount, 3);
    assert.equal(result.tweenCount, 8);
    assert.equal(result.targetCount, 4);
    assert.deepEqual(result.warnings, []);
  });
  test("An accepted group prevents competing descendant Color and nested-group writes", () => {
    const result = exportData(fixture(), [track("root"), track("icon"),
      track("caption", "bgColor", { r: 0, g: 0, b: 0, a: 0 }, { r: 0, g: 0, b: 0, a: 1 })]);
    assert.equal(result.trackCount, 1);
    assert.equal(result.warnings.length, 2);
    assert.ok(result.warnings.every((warning) => warning.includes("控制同一颜色")));
  });
  test("Conflict priority is input order, not Timeline sorting", () => {
    const result = exportData(fixture(), [track("icon", "imageColor", { r: 1, g: 2, b: 3, a: 1 }, { r: 4, g: 5, b: 6, a: 0 }, 2), track("root")]);
    assert.equal(result.trackCount, 1);
    assert.equal(rows(result.code)[0][1], "imageColor");
    assert.equal(result.warnings.length, 1);
  });
  test("Invalid tracks do not claim a Color or suppress later valid groups", () => {
    const result = exportData(fixture(), [track("icon", "imageColor", null, null), track("root")]);
    assert.equal(result.trackCount, 1);
    assert.equal(rows(result.code)[0][1], "groupAlpha");
    assert.equal(result.warnings.length, 1);
  });
  test("Null colors are excluded from estimates, and empty groups remain reversible with a warning", () => {
    const nodes = [node("root", "container"), node("icon", "image", "root")];
    nodes[1].properties.imageColor = null;
    const result = exportData(nodes, [track("root")]);
    assert.equal(result.trackCount, 1);
    assert.equal(result.tweenCount, 0);
    assert.equal(result.targetCount, 0);
    assert.match(result.warnings[0], /没有可控制的颜色/);
  });
  test("Group endpoints are clamped, and self-containing malformed hierarchies terminate", () => {
    const nodes = fixture();
    nodes[0].parentId = "caption";
    const result = exportData(nodes, [track("root", "groupAlpha", -12, 900)]);
    assert.deepEqual(rows(result.code)[0].slice(5), [0, 255]);
    assert.equal(result.tweenCount, 8);
  });
  test("Unsafe paths and duplicate rows warn without exporting impossible FindChild targets", () => {
    const nodes = fixture();
    nodes[1].name = "bad/path";
    const result = exportData(nodes, [track("icon"), track("root"), track("root")]);
    assert.equal(result.trackCount, 1);
    assert.equal(result.warnings.length, 2);
    assert.deepEqual(rows(result.code)[0].slice(0, 2), ["", "groupAlpha"]);
  });

  const library = buildTweenTimelineLibLua().code;
  test("The standalone Lib supports legacy Data and scans exactly documented Color fields", () => {
    assert.match(library, /TweenTimeline@4/);
    assert.match(library, /TweenTimeline@3/);
    assert.doesNotMatch(library, /require\s*\(|ControlAlphaGroup|SetOnUpdate/);
    for (const field of ["imageColor", "fontColor", "bgColor", "outlineColor"]) assert.ok(library.includes(`"${field}"`));
    assert.match(library, /pcall\(typeof, control\)/);
    assert.match(library, /control:GetChildren\(\)/);
    assert.match(library, /local BaseAlphas = setmetatable\(\{\}, \{ __mode = "k" \}\)/);
    assert.match(library, /if alphas\[field\] == nil then alphas\[field\] = a or 255 end/);
    assert.doesNotMatch(library, /alphas\[[^\]]+\]\s*=\s*(?:control|target|\{)/);
    assert.match(library, /function TweenTimelineLib\.ResetBaseColors\(root\)/);
    assert.match(library, /BaseAlphas\[control\] = nil/);
    assert.match(library, /ResetBaseColors\(child, visited\)/);
    assert.match(library, /math\.floor\(target\[6\] \* alpha \/ 255 \+ 0\.5\)/);
    assert.ok(library.indexOf("CollectColors(control, targets, {})") < library.indexOf("target[1][target[2]] = from"));
    assert.match(library, /local tween = game\.Tween\(target\[1\], \{ \[target\[2\]\] = rotation and \(to - from\) or to \}, track\[4\]\)/);
    assert.match(library, /local rotation = IsRotationField\(target\[2\]\)/);
    assert.match(library, /:SetRelative\(rotation\)/);
    assert.match(library, /sequence:Insert\(track\[3\], tween\)/);
  });

  const candidates = process.env.LUA_BIN ? [process.env.LUA_BIN] : ["lua", "lua53", "luajit"];
  const lua = candidates.find((candidate) => {
    const result = spawnSync(candidate, ["-v"], { encoding: "utf8", timeout: 5000, windowsHide: true });
    return !result.error && result.status === 0;
  });
  if (process.env.LUA_BIN && !lua) throw new Error("LUA_BIN does not name a runnable Lua executable");
  if (lua) {
    test("Emitted Lua executes baseline-preserving group and legacy Tweens against API mocks", () => {
      const script = `
local logs = {}
function printerr(value) logs[#logs + 1] = value end
function typeof(control) return control.kind end
Enum = { EaseType = {} }
${tweenEaseOptions.map(({ value }) => `Enum.EaseType.${value} = "${value}"`).join("\n")}
Color = {}
function Color.FromRGBA(r, g, b, a) return { r, g, b, a, color = true } end
function Color.ToRGBA(value) assert(value and value.color); return value[1], value[2], value[3], value[4] end
game = {}
function game.Tween(control, values, duration)
    local tween = { control = control, values = values, duration = duration, from = {} }
    for field in pairs(values) do tween.from[field] = control[field] end
    function tween:SetEase(ease) self.ease = ease; return self end
    function tween:SetRelative(relative) self.relative = relative; return self end
    return tween
end
function game.TweenSequence()
    local sequence = { items = {}, callbacks = {} }
    function sequence:Insert(time, tween) self.items[#self.items + 1] = { time, tween }; return self end
    function sequence:InsertCallback(time, callback) self.callbacks[#self.callbacks + 1] = { time, callback }; return self end
    return sequence
end
local Lib = (function()
${library}
end)()
local function make(kind, name, children)
    local control = { kind = kind, name = name, children = children or {} }
    function control:GetChildren() return self.children end
    function control:FindChild(path)
        local current = self
        for name in string.gmatch(path, "[^/]+") do
            local found = nil
            for _, child in ipairs(current.children) do if child.name == name then found = child end end
            if found == nil then return nil end
            current = found
        end
        return current
    end
    return control
end
local text = make("ClientUITextBoxControl", "text")
text.fontColor = Color.FromRGBA(10, 20, 30, 128)
text.bgColor = Color.FromRGBA(40, 50, 60, 0)
text.outlineColor = Color.FromRGBA(70, 80, 90, 51)
local emptyImage = make("ClientUIImageControl", "empty")
local image = make("ClientUIImageControl", "image", { text, emptyImage })
image.imageColor = Color.FromRGBA(100, 110, 120, 204)
local root = make("ClientUIContainerControl", "root", { image })
local data = { schema = Lib.Schema, tracks = {{ "", "groupAlpha", 0.25, 0.5, "OutQuad", 128, 0 }} }
local sequence = Lib.Create(root, data)
assert(#sequence.items == 4)
assert(root.imageColor == nil and emptyImage.imageColor == nil)
for _, item in ipairs(sequence.items) do
    assert(item[1] == 0.25 and item[2].duration == 0.5 and item[2].ease == "OutQuad" and item[2].relative == false)
    for field, color in pairs(item[2].values) do assert(field ~= "groupAlpha" and color[4] == 0) end
end
assert(image.imageColor[4] == 102 and text.fontColor[4] == 64)
assert(text.bgColor[4] == 0 and text.outlineColor[4] == 26)
assert(image.imageColor[1] == 100 and text.fontColor[2] == 20 and text.bgColor[3] == 60)
assert(sequence.items[1][2].from.imageColor[4] == 102)
local repeated = Lib.Create(root, data)
assert(image.imageColor[4] == 102 and text.fontColor[4] == 64)
for _, item in ipairs(sequence.items) do
    for field, color in pairs(item[2].values) do item[2].control[field] = color end
end
assert(image.imageColor[4] == 0 and text.fontColor[4] == 0)
image.imageColor = Color.FromRGBA(1, 2, 3, 0)
local fadeIn = Lib.Create(root, { schema = Lib.Schema, tracks = {{ "", "groupAlpha", 0, 1, "Linear", 0, 255 }} })
assert(#fadeIn.items == 4 and image.imageColor[4] == 0)
assert(fadeIn.items[1][2].values.imageColor[4] == 204)
assert(fadeIn.items[1][2].values.imageColor[1] == 1)
assert(fadeIn.items[2][2].values.fontColor[4] == 128)
assert(fadeIn.items[3][2].values.bgColor[4] == 0)
assert(fadeIn.items[4][2].values.outlineColor[4] == 51)
for _, item in ipairs(fadeIn.items) do
    for field, color in pairs(item[2].values) do item[2].control[field] = color end
end
image.imageColor = Color.FromRGBA(1, 2, 3, 100)
text.fontColor = Color.FromRGBA(10, 20, 30, 60)
Lib.ResetBaseColors(text)
assert(image.imageColor[4] == 100 and text.fontColor[4] == 60)
local resetText = Lib.Create(root, data)
assert(image.imageColor[4] == 102 and text.fontColor[4] == 30)
image.imageColor = Color.FromRGBA(1, 2, 3, 100)
text.fontColor = Color.FromRGBA(10, 20, 30, 60)
Lib.ResetBaseColors(root)
assert(image.imageColor[4] == 100 and text.fontColor[4] == 60)
local resetAll = Lib.Create(root, data)
assert(image.imageColor[4] == 50 and text.fontColor[4] == 30)
assert(text.bgColor[4] == 0)
local legacy = Lib.Create(root, { schema = "ClientUIAnimationEditor.TweenTimeline@3", tracks = {{ "image", "sizeDeltaX", 0, 1, "Linear", 150, 300 }} })
assert(#legacy.items == 1 and image.sizeDeltaX == 150 and legacy.items[1][2].values.sizeDeltaX == 300)
local missing = Lib.Create(root, { schema = Lib.Schema, tracks = {{ "missing", "groupAlpha", 0, 1, "Linear", 255, 0 }} })
assert(#missing.items == 0)
local conflict = Lib.Create(root, { schema = Lib.Schema, tracks = {
    { "", "groupAlpha", 0, 1, "Linear", 255, 0 },
    { "image", "imageColor", 0, 1, "Linear", {1,2,3,255}, {1,2,3,0} },
} })
assert(#conflict.items == 4)
assert(#logs == 2)
print("PASS emitted Lua native-API mocks")
`;
      const result = spawnSync(lua, ["-"], { input: script, encoding: "utf8", timeout: 10000, windowsHide: true });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /PASS emitted Lua/);
    });
  } else {
    console.log("SKIP emitted Lua execution: no local Lua executable (set LUA_BIN to enable)");
  }
  console.log(`${passed} group-alpha export checks passed.`);
} finally {
  if (originalTsExtension) Module._extensions[".ts"] = originalTsExtension;
  else delete Module._extensions[".ts"];
}
