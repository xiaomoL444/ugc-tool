/* Run: node scripts/test-client-ui-multi-clip-export.cjs
 * Optional: LUA_BIN points to a local Lua 5.3 executable for generated-runtime tests.
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
  const { isRelativeTweenField, getTweenTrackConflict } = require(path.join(editor, "tweenRegistry.ts"));
  const { buildTweenTimelineDataLua, buildTweenTimelineLibLua } = require(path.join(editor, "luaTweenExporter.ts"));
  let passed = 0;
  function test(name, check) { check(); passed += 1; console.log(`PASS ${name}`); }
  function node(id, type = "container", parentId = null) {
    return { id, name: id, type, parentId, anchorOffsetX: 100, anchorOffsetY: 200,
      scaleX: 2, scaleY: 3, scaleZ: 1, properties: createControlProperties(type) };
  }
  function clip(startTime, initialValue = 0, endValue = 40, overrides = {}) {
    return { id: `clip-${startTime}`, nodeId: "root", fieldKey: "anchoredPositionX", startTime,
      duration: 1, initialValue, endValue, easeType: "Linear", ...overrides };
  }
  function exportData(tracks, nodes = [node("root")]) {
    return buildTweenTimelineDataLua({ projectName: "Multi Clip Test", rootNodeId: "root", nodes, tracks });
  }
  function rows(code) {
    return code.split("\n").filter((line) => line.startsWith("        { "))
      .map((line) => JSON.parse(line.trim().replace(/,$/, "").replace(/\{/g, "[").replace(/\}/g, "]")));
  }

  test("Only documented position, size, and scale fields allow additive offsets", () => {
    for (const key of ["anchoredPositionX", "anchoredPositionY", "sizeDeltaX", "sizeDeltaY", "localScaleX", "localScaleY", "localScaleZ"]) {
      assert.equal(isRelativeTweenField(key), true);
    }
    for (const key of ["x", "scaleX", "sizeDeltaZ", "width", "height", "localRotationZ", "imageColor", "groupAlpha"]) {
      assert.equal(isRelativeTweenField(key), false);
    }
  });
  test("Unsorted Clips on one property remain separate rows sorted by time", () => {
    const result = exportData([clip(2, 40, -50), clip(0)]);
    assert.equal(result.trackCount, 2);
    assert.equal(result.tweenCount, 2);
    assert.equal(result.targetCount, 1);
    assert.deepEqual(result.warnings, []);
    assert.match(result.code, /TweenTimeline@7/);
    assert.deepEqual(rows(result.code).map((row) => row.slice(2)), [
      [0, 1, "Linear", 0, 40], [2, 1, "Linear", 40, -50],
    ]);
  });
  test("Position deltas retain zero and negative offsets rather than baking the editor baseline", () => {
    const tracks = [clip(2, 0, -90, { relative: true }), clip(0, 0, 40, { relative: true })];
    const nodes = [node("root")];
    const original = JSON.stringify({ tracks, nodes });
    const result = exportData(tracks, nodes);
    assert.match(result.code, /TweenTimeline@7/);
    assert.deepEqual(rows(result.code).map((row) => row.slice(5)), [[0, 40, true], [0, -90, true]]);
    assert.equal(JSON.stringify({ tracks, nodes }), original);
    nodes[0].anchorOffsetX = -900;
    assert.equal(exportData(tracks, nodes).code, result.code);
  });
  test("Touching endpoints are valid and no gap is silently inserted", () => {
    const result = exportData([clip(0), clip(1, 40, 0), clip(2, 0, -90)]);
    assert.equal(result.trackCount, 3);
    assert.deepEqual(rows(result.code).map((row) => row[2]), [0, 1, 2]);
    assert.deepEqual(result.warnings, []);
  });
  test("Each size axis exports raw additive offsets in @7, independent of the editor dimensions", () => {
    for (const fieldKey of ["sizeDeltaX", "sizeDeltaY"]) {
      const tracks = [clip(0, -10, 40, { fieldKey, relative: true })];
      const nodes = [{ ...node("root"), width: 150, height: 300 }];
      const original = JSON.stringify({ tracks, nodes });
      const result = exportData(tracks, nodes);
      assert.match(result.code, /TweenTimeline@7/);
      assert.match(result.code, /位置\/大小\/缩放增量/);
      assert.deepEqual(rows(result.code), [["", fieldKey, 0, 1, "Linear", -10, 40, true]]);
      assert.equal(result.trackCount, 1);
      assert.equal(result.tweenCount, 1);
      assert.deepEqual(result.warnings, []);
      assert.equal(JSON.stringify({ tracks, nodes }), original);
      nodes[0].width = 900;
      nodes[0].height = 800;
      assert.equal(exportData(tracks, nodes).code, result.code);
    }
  });
  test("Absolute size Clips retain seven columns and @3 with false or omitted relative", () => {
    const result = exportData([clip(0, 150, 300, { fieldKey: "sizeDeltaX", relative: false }),
      clip(0, 200, 400, { fieldKey: "sizeDeltaY" })]);
    assert.match(result.code, /TweenTimeline@3/);
    assert.doesNotMatch(result.code, /relative/);
    assert.deepEqual(rows(result.code), [
      ["", "sizeDeltaX", 0, 1, "Linear", 150, 300],
      ["", "sizeDeltaY", 0, 1, "Linear", 200, 400],
    ]);
    assert.deepEqual(result.warnings, []);
  });
  test("Mixed absolute and additive size Clips keep separate sorted rows and selected-root child paths", () => {
    const result = exportData([
      clip(3, 0, -40, { nodeId: "icon", fieldKey: "sizeDeltaX", relative: true }),
      clip(0, 150, 300, { nodeId: "icon", fieldKey: "sizeDeltaX" }),
      clip(1, -10, 20, { nodeId: "icon", fieldKey: "sizeDeltaX", relative: true }),
    ], [node("root"), node("panel", "container", "root"), node("icon", "image", "panel")]);
    assert.match(result.code, /TweenTimeline@7/);
    assert.deepEqual(rows(result.code), [
      ["panel/icon", "sizeDeltaX", 0, 1, "Linear", 150, 300],
      ["panel/icon", "sizeDeltaX", 1, 1, "Linear", -10, 20, true],
      ["panel/icon", "sizeDeltaX", 3, 1, "Linear", 0, -40, true],
    ]);
    assert.deepEqual(result.warnings, []);
  });
  test("Invalid size offsets do not activate @7 or reserve their property lane", () => {
    const result = exportData([clip(0, NaN, 40, { fieldKey: "sizeDeltaX", relative: true }),
      clip(0, 0, Infinity, { fieldKey: "sizeDeltaY", relative: true }),
      clip(0, 150, 300, { fieldKey: "sizeDeltaX" })]);
    assert.match(result.code, /TweenTimeline@3/);
    assert.equal(result.trackCount, 1);
    assert.equal(result.warnings.length, 2);
    assert.deepEqual(rows(result.code)[0], ["", "sizeDeltaX", 0, 1, "Linear", 150, 300]);
  });
  test("Exporter and Lua use the editor's one-microsecond seam tolerance", () => {
    const result = exportData([clip(0), clip(1 - 0.0000005, 40, 0)]);
    assert.equal(result.trackCount, 2);
    assert.deepEqual(result.warnings, []);
    assert.match(buildTweenTimelineLibLua().code, /math\.min\(track\[3\] \+ track\[4\], other\[3\] \+ other\[4\]\) - math\.max\(track\[3\], other\[3\]\) > 0\.000001/);
  });
  test("Overlap priority preserves the first input Clip, not the earliest start", () => {
    const result = exportData([clip(1, 10, 20, { duration: 2 }), clip(0, 0, 1, { duration: 2 }), clip(3, 20, 40)]);
    assert.deepEqual(rows(result.code).map((row) => row[2]), [1, 3]);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /时间重叠/);
  });
  test("Identical and nested intervals are rejected without removing adjacent Clips", () => {
    const result = exportData([clip(0, 0, 40, { duration: 3 }), clip(0), clip(1), clip(3)]);
    assert.equal(result.trackCount, 2);
    assert.equal(result.warnings.length, 2);
    assert.deepEqual(rows(result.code).map((row) => row[2]), [0, 3]);
  });
  test("Different property lanes and different controls may overlap in time", () => {
    const result = exportData([clip(0), clip(0, 0, 20, { fieldKey: "anchoredPositionY" }),
      clip(0, 0, -40, { nodeId: "icon" })], [node("root"), node("icon", "image", "root")]);
    assert.equal(result.trackCount, 3);
    assert.deepEqual(result.warnings, []);
  });
  test("Invalid timing and values do not claim a lane or block a subsequent valid Clip", () => {
    const result = exportData([clip(-1), clip(NaN), clip(Infinity), clip(0, 0, 40, { duration: 0 }),
      clip(0, 0, 40, { duration: Infinity }), clip(1e308, 0, 40, { duration: 1e308 }),
      clip(0, null), clip(0, 0, Infinity), clip(0)]);
    assert.equal(result.trackCount, 1);
    assert.equal(result.warnings.length, 8);
  });
  test("Colors can have multiple sequential Clips without losing RGBA values", () => {
    const color = (alpha) => ({ r: 12, g: 34, b: 56, a: alpha });
    const result = exportData([clip(0, color(1), color(0.5), { nodeId: "icon", fieldKey: "imageColor" }),
      clip(2, color(0.5), color(0), { nodeId: "icon", fieldKey: "imageColor" })],
    [node("root"), node("icon", "image", "root")]);
    assert.equal(result.trackCount, 2);
    assert.match(result.code, /TweenTimeline@7/);
    assert.deepEqual(rows(result.code).map((row) => row.slice(5)), [
      [[12, 34, 56, 255], [12, 34, 56, 128]], [[12, 34, 56, 128], [12, 34, 56, 0]],
    ]);
  });
  test("Sequential group-alpha Clips retain original-alpha factors and expand each Clip", () => {
    const nodes = [node("root"), node("icon", "image", "root"), node("label", "text", "icon")];
    const first = clip(0, 255, 128, { fieldKey: "groupAlpha" });
    const second = clip(2, 128, 0, { fieldKey: "groupAlpha" });
    assert.equal(getTweenTrackConflict("root", "groupAlpha", nodes, [first]), null);
    const result = exportData([first, second], nodes);
    assert.equal(result.trackCount, 2);
    assert.equal(result.tweenCount, 8);
    assert.equal(result.targetCount, 2);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(rows(result.code).map((row) => row.slice(5)), [[255, 128], [128, 0]]);
  });
  test("Distinct group/color writers remain conflicting even when their time intervals do not overlap", () => {
    const nodes = [node("root"), node("icon", "image", "root")];
    const color = { r: 1, g: 2, b: 3, a: 1 };
    const result = exportData([clip(0, 255, 128, { fieldKey: "groupAlpha" }),
      clip(2, color, color, { fieldKey: "imageColor", nodeId: "icon" }),
      clip(4, 255, 0, { fieldKey: "groupAlpha", nodeId: "icon" })], nodes);
    assert.equal(result.trackCount, 1);
    assert.equal(result.warnings.length, 2);
    assert.ok(result.warnings.every((warning) => warning.includes("控制同一颜色")));
  });
  test("Legacy single-Clip formats stay @3 absolute, @4 alpha, @5 scale; position relative uses @7", () => {
    assert.match(exportData([clip(0)]).code, /TweenTimeline@3/);
    assert.match(exportData([clip(0, 255, 0, { fieldKey: "groupAlpha" })]).code, /TweenTimeline@4/);
    assert.match(exportData([clip(0, 0, 1, { fieldKey: "localScaleX", relative: true })]).code, /TweenTimeline@5/);
    assert.match(exportData([clip(0, 0, 40, { relative: true })]).code, /TweenTimeline@7/);
  });

  const library = buildTweenTimelineLibLua().code;
  test("Runtime uses documented callbacks and restores each lane's first initial after construction", () => {
    for (const schema of [3, 4, 5, 6, 7]) assert.ok(library.includes(`TweenTimeline@${schema}`));
    assert.match(library, /or field == "sizeDeltaX" or field == "sizeDeltaY"/);
    assert.match(library, /table\.sort\(lane\.clips/);
    assert.match(library, /local previousEnd, initials = lane\.baseline, \{\}/);
    assert.match(library, /previousEnd \+ fromValue, previousEnd \+ toValue/);
    assert.match(library, /previousEnd = toValue/);
    assert.match(library, /if IsNumber\(previousEnd\) then fromValue, toValue/);
    assert.match(library, /sequence:InsertCallback\(track\[3\], function\(\) target\[1\]\[target\[2\]\] = from end\)/);
    assert.match(library, /target\[1\]\[target\[2\]\] = initials\[index\]/);
    assert.ok(library.indexOf("sequence:InsertCallback(track[3]") < library.indexOf("sequence:Insert(track[3], tween)"));
    assert.doesNotMatch(library, /:From\(|:SetRelative\(true\)|require\s*\(|ControlAlphaGroup/);
  });
  test("Runtime rejects malformed times and permits multiple Clips owned by the same field lane", () => {
    assert.match(library, /IsNumber\(track\[3\]\) and track\[3\] >= 0/);
    assert.match(library, /IsNumber\(track\[3\] \+ track\[4\]\)/);
    assert.match(library, /owner ~= nil and owner ~= lane/);
    assert.match(library, /for _, entry in ipairs\(lane\.clips\) do/);
    assert.match(library, /claimed\[target\[1\]\]\[target\[2\]\] = lane/);
  });

  const candidates = process.env.LUA_BIN ? [process.env.LUA_BIN] : ["lua", "lua53", "luajit"];
  const lua = candidates.find((candidate) => {
    const result = spawnSync(candidate, ["-v"], { encoding: "utf8", timeout: 5000, windowsHide: true });
    return !result.error && result.status === 0;
  });
  if (process.env.LUA_BIN && !lua) throw new Error("LUA_BIN does not name a runnable Lua executable");
  if (lua) {
    test("Generated Lua chains deltas, keeps gap values, resets at Clip starts, and preserves color baselines", () => {
      const script = `
local logs = {}
function printerr(value) logs[#logs + 1] = value end
function typeof(control) return control.kind end
Enum = { EaseType = { Linear = "Linear" } }
Color = {}
function Color.FromRGBA(r, g, b, a) return { r, g, b, a, color = true } end
function Color.ToRGBA(value) assert(value.color); return value[1], value[2], value[3], value[4] end
game = {}
function game.Tween(control, values, duration)
    local tween = { control = control, values = values, duration = duration, from = {} }
    for field in pairs(values) do tween.from[field] = control[field] end
    function tween:SetEase(ease) self.ease = ease; return self end
    function tween:SetRelative(relative) self.relative = relative; return self end
    return tween
end
function game.TweenSequence()
    local sequence = { items = {}, callbacks = {}, events = {} }
    function sequence:Insert(time, tween)
        self.items[#self.items + 1] = { time, tween }
        self.events[#self.events + 1] = { time, "tween" }
        return self
    end
    function sequence:InsertCallback(time, callback)
        self.callbacks[#self.callbacks + 1] = { time, callback }
        self.events[#self.events + 1] = { time, "callback" }
        return self
    end
    return sequence
end
local Lib = (function()
${library}
end)()
local function make(kind, name, children)
    local control = { kind = kind, name = name, children = children or {} }
    function control:GetChildren() return self.children end
    function control:FindChild(path)
        for _, child in ipairs(self.children) do if child.name == path then return child end end
    end
    return control
end
local root = make("ClientUIContainerControl", "root")
root.anchoredPositionX, root.localScaleX = 100, 2
local data = { schema = Lib.Schema, tracks = {
    { "", "anchoredPositionX", 2, 1, "Linear", 0, -90, true },
    { "", "anchoredPositionX", 0, 1, "Linear", 0, 40, true },
} }
local sequence = Lib.Create(root, data)
assert(#sequence.items == 2 and #sequence.callbacks == 2 and #logs == 0)
assert(sequence.items[1][1] == 0 and sequence.items[2][1] == 2)
local first, second = sequence.items[1][2], sequence.items[2][2]
assert(first.from.anchoredPositionX == 100 and first.values.anchoredPositionX == 140)
assert(second.from.anchoredPositionX == 140 and second.values.anchoredPositionX == 50)
assert(root.anchoredPositionX == 100)
assert(sequence.events[1][2] == "callback" and sequence.events[2][2] == "tween")
root.anchoredPositionX = first.values.anchoredPositionX
assert(root.anchoredPositionX == 140) -- one-second gap holds the previous end
sequence.callbacks[2][2]()
assert(root.anchoredPositionX == 140)
root.anchoredPositionX = second.values.anchoredPositionX
sequence.callbacks[1][2]() -- restart uses the captured start, not the current endpoint
assert(root.anchoredPositionX == 100)
assert(data.tracks[1][6] == 0 and data.tracks[1][7] == -90)

local absolute = Lib.Create(root, { schema = Lib.Schema, tracks = {
    { "", "anchoredPositionX", 0, 1, "Linear", 10, 40 },
    { "", "anchoredPositionX", 2, 1, "Linear", 200, 210 },
    { "", "anchoredPositionX", 3, 1, "Linear", 0, -90, true },
} })
assert(root.anchoredPositionX == 10)
assert(absolute.items[3][2].from.anchoredPositionX == 210 and absolute.items[3][2].values.anchoredPositionX == 120)
root.anchoredPositionX = 40
absolute.callbacks[2][2]()
assert(root.anchoredPositionX == 200)

local scale = Lib.Create(root, { schema = Lib.Schema, tracks = {
    { "", "localScaleX", 0, 1, "Linear", 0, 1, true },
    { "", "localScaleX", 1, 1, "Linear", 0, -0.5, true },
} })
assert(root.localScaleX == 2)
assert(scale.items[1][2].values.localScaleX == 3)
assert(scale.items[2][2].from.localScaleX == 3 and scale.items[2][2].values.localScaleX == 2.5)

local sizeValues = { sizeDeltaX = 200, sizeDeltaY = -50 }
local sizeRoot = setmetatable({}, {
    __index = sizeValues,
    __newindex = function(_, field, value)
        sizeValues[field] = value
        if field == "sizeDeltaX" then sizeValues.sizeDeltaY = 999 end
    end,
})
local sizeData = { schema = Lib.Schema, tracks = {
    { "", "sizeDeltaX", 3, 1, "Linear", -10, -70, true },
    { "", "sizeDeltaX", 0, 1, "Linear", -20, 40, true },
    { "", "sizeDeltaY", 0, 1, "Linear", 0, 10, true },
    { "", "sizeDeltaY", 3, 1, "Linear", 0, -10, true },
    { "", "sizeDeltaX", 5, 1, "Linear", 300, 400 },
    { "", "sizeDeltaX", 6, 1, "Linear", 0, -50, true },
} }
local size = Lib.Create(sizeRoot, sizeData)
assert(#size.items == 6 and #logs == 0)
assert(size.items[1][2].from.sizeDeltaX == 180 and size.items[1][2].values.sizeDeltaX == 240)
assert(size.items[2][2].from.sizeDeltaX == 230 and size.items[2][2].values.sizeDeltaX == 170)
assert(size.items[3][2].from.sizeDeltaX == 300 and size.items[3][2].values.sizeDeltaX == 400)
assert(size.items[4][2].from.sizeDeltaX == 400 and size.items[4][2].values.sizeDeltaX == 350)
assert(size.items[5][2].from.sizeDeltaY == -50 and size.items[5][2].values.sizeDeltaY == -40)
assert(size.items[6][2].from.sizeDeltaY == -40 and size.items[6][2].values.sizeDeltaY == -50)
assert(sizeRoot.sizeDeltaX == 180 and sizeRoot.sizeDeltaY == -50) -- both baselines captured before any assignment
for _, item in ipairs(size.items) do assert(item[2].relative == false) end
sizeRoot.sizeDeltaX = size.items[1][2].values.sizeDeltaX
assert(sizeRoot.sizeDeltaX == 240) -- gap retains the previous endpoint
size.callbacks[2][2]()
assert(sizeRoot.sizeDeltaX == 230) -- the next Clip adds its own nonzero initial offset
sizeRoot.sizeDeltaX = size.items[4][2].values.sizeDeltaX
size.callbacks[1][2]()
assert(sizeRoot.sizeDeltaX == 180) -- restart reuses the captured initial size
assert(sizeData.tracks[1][6] == -10 and sizeData.tracks[1][7] == -70 and sizeData.tracks[1][8] == true)
sizeValues.sizeDeltaX = 500
local resized = Lib.Create(sizeRoot, { schema = Lib.Schema, tracks = { sizeData.tracks[2] } })
assert(resized.items[1][2].from.sizeDeltaX == 480 and resized.items[1][2].values.sizeDeltaX == 540)

local image = make("ClientUIImageControl", "icon")
image.imageColor = Color.FromRGBA(12, 34, 56, 128)
root.children = { image }
local alphaData = { schema = Lib.Schema, tracks = {
    { "", "groupAlpha", 0, 1, "Linear", 255, 128 },
    { "", "groupAlpha", 2, 1, "Linear", 128, 255 },
} }
local alpha = Lib.Create(root, alphaData)
assert(#alpha.items == 2 and image.imageColor[4] == 128)
assert(alpha.items[1][2].values.imageColor[4] == 64)
assert(alpha.items[2][2].from.imageColor[4] == 64 and alpha.items[2][2].values.imageColor[4] == 128)
assert(root.groupAlpha == nil and root.imageColor == nil)
image.imageColor = alpha.items[1][2].values.imageColor
alpha.callbacks[2][2]()
assert(image.imageColor[4] == 64)
local again = Lib.Create(root, alphaData)
assert(again.items[2][2].values.imageColor[4] == 128) -- not cumulatively multiplied

local colors = Lib.Create(root, { schema = Lib.Schema, tracks = {
    { "icon", "imageColor", 0, 1, "Linear", {1,2,3,255}, {4,5,6,128} },
    { "icon", "imageColor", 2, 1, "Linear", {7,8,9,64}, {10,11,12,0} },
} })
assert(#colors.items == 2 and image.imageColor[1] == 1)
colors.callbacks[2][2]()
assert(image.imageColor[1] == 7 and image.imageColor[4] == 64)

local invalid = Lib.Create(root, { schema = Lib.Schema, tracks = {
    { "", "anchoredPositionX", -1, 1, "Linear", 0, 1 },
    { "", "anchoredPositionX", 0/0, 1, "Linear", 0, 1 },
    { "", "anchoredPositionX", 0, math.huge, "Linear", 0, 1 },
    { "", "anchoredPositionX", 1, 2, "Linear", 10, 20 },
    { "", "anchoredPositionX", 0, 2, "Linear", 30, 40 },
    { "", "anchoredPositionX", 3, 1, "Linear", 20, 30 },
} })
assert(#invalid.items == 2 and #logs == 4)
assert(invalid.items[1][1] == 1 and invalid.items[2][1] == 3)
root.anchoredPositionX = 100
local mixedTypes = Lib.Create(root, { schema = Lib.Schema, tracks = {
    { "", "anchoredPositionX", 0, 1, "Linear", {1,2,3,4}, {4,3,2,1} },
    { "", "anchoredPositionX", 2, 1, "Linear", 0, 40, true },
} })
assert(#mixedTypes.items == 1 and #logs == 5) -- malformed external data must not add a table to a number
for _, version in ipairs({3, 4, 5, 6}) do
    local legacy = Lib.Create(root, { schema = "ClientUIAnimationEditor.TweenTimeline@" .. version,
        tracks = {
            { "", "localScaleX", 0, 1, "Linear", 1, 2 },
            { "", "sizeDeltaX", 0, 1, "Linear", 150, 300 },
            { "", "sizeDeltaY", 0, 1, "Linear", 200, 400 },
        } })
    assert(#legacy.items == 3)
    assert(legacy.items[1][2].from.localScaleX == 1 and legacy.items[1][2].values.localScaleX == 2)
    assert(legacy.items[2][2].from.sizeDeltaX == 150 and legacy.items[2][2].values.sizeDeltaX == 300)
    assert(legacy.items[3][2].from.sizeDeltaY == 200 and legacy.items[3][2].values.sizeDeltaY == 400)
end
print("PASS emitted Lua multi-clip native-API mocks")
`;
      const result = spawnSync(lua, ["-"], { input: script, encoding: "utf8", timeout: 10000, windowsHide: true });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /PASS emitted Lua multi-clip/);
    });
  } else {
    console.log("SKIP emitted Lua execution: no local Lua executable (set LUA_BIN to enable)");
  }
  console.log(`${passed} multi-clip export checks passed.`);
} finally {
  if (originalTsExtension) Module._extensions[".ts"] = originalTsExtension;
  else delete Module._extensions[".ts"];
}
