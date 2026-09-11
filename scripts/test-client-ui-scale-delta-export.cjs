/* Run: node scripts/test-client-ui-scale-delta-export.cjs
 * Optional: set LUA_BIN to execute the generated Lib against native-API mocks.
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
  const { isScaleTweenField, tweenEaseOptions } = require(path.join(editor, "tweenRegistry.ts"));
  const { buildTweenTimelineDataLua, buildTweenTimelineLibLua } = require(path.join(editor, "luaTweenExporter.ts"));
  let passed = 0;
  function test(name, check) { check(); passed += 1; console.log(`PASS ${name}`); }
  function node(id, type = "container", parentId = null) {
    return { id, name: id, type, parentId, scaleX: 2, scaleY: 3, scaleZ: 4, properties: createControlProperties(type) };
  }
  function track(fieldKey, initialValue = 0, endValue = 0.5, relative = true, nodeId = "root") {
    return { id: `${nodeId}:${fieldKey}`, nodeId, fieldKey, startTime: 0, duration: 1, initialValue, endValue, easeType: "Linear", relative };
  }
  function exportData(tracks, nodes = [node("root")]) {
    return buildTweenTimelineDataLua({ projectName: "Scale Test", rootNodeId: "root", nodes, tracks, sequenceDuration: 3 });
  }
  function rows(code) {
    return code.split("\n").filter((line) => line.startsWith("        { "))
      .map((line) => JSON.parse(line.trim().replace(/,$/, "").replace(/\{/g, "[").replace(/\}/g, "]")));
  }

  test("Only the three native localScale fields allow scale deltas", () => {
    for (const axis of ["X", "Y", "Z"]) assert.equal(isScaleTweenField(`localScale${axis}`), true);
    for (const field of ["scaleX", "localScale", "localScaleW", "sizeDeltaX", "groupAlpha", "fontColor", "localRotationZ"]) {
      assert.equal(isScaleTweenField(field), false);
    }
  });
  test("A relative scale row keeps zero initial and negative final offsets with slot eight true", () => {
    const result = exportData([track("localScaleX", 0, -0.5)]);
    assert.match(result.code, /TweenTimeline@5/);
    assert.match(result.code, /"from", "to", "relative"/);
    assert.deepEqual(rows(result.code), [["", "localScaleX", 0, 1, "Linear", 0, -0.5, true]]);
    assert.equal(result.trackCount, 1);
    assert.equal(result.tweenCount, 1);
    assert.deepEqual(result.warnings, []);
  });
  test("All three axes preserve nonzero initial offsets without baking the editor baseline", () => {
    const tracks = [track("localScaleX", 0.25, 1), track("localScaleY", -2, -1), track("localScaleZ", 0, 2)];
    const nodes = [node("root")];
    const before = JSON.stringify({ tracks, nodes });
    const result = exportData(tracks, nodes);
    assert.deepEqual(rows(result.code).map((row) => row.slice(5)), [[0.25, 1, true], [-2, -1, true], [0, 2, true]]);
    assert.equal(JSON.stringify({ tracks, nodes }), before);
    nodes[0].scaleX = 200;
    nodes[0].scaleY = 300;
    assert.equal(exportData(tracks, nodes).code, result.code);
  });
  test("Absolute scale tracks keep the old seven columns and @3 schema", () => {
    const absolute = track("localScaleX", 2, 0.5, false);
    const unspecified = track("localScaleY", 3, 1);
    delete unspecified.relative;
    const result = exportData([absolute, unspecified]);
    assert.match(result.code, /TweenTimeline@3/);
    assert.doesNotMatch(result.code, /relative/);
    assert.deepEqual(rows(result.code), [["", "localScaleX", 0, 1, "Linear", 2, 0.5], ["", "localScaleY", 0, 1, "Linear", 3, 1]]);
  });
  test("Only relative rows gain an eighth value in a mixed @5 table", () => {
    const result = exportData([track("localScaleX"), track("localScaleY", 1, 2, false), track("sizeDeltaX", 150, 300, false)]);
    assert.deepEqual(rows(result.code).map((row) => row.length), [8, 7, 7]);
  });
  test("Group alpha retains its previous format and can coexist with a relative scale", () => {
    const nodes = [node("root"), node("icon", "image", "root")];
    const group = track("groupAlpha", 255, 0, false);
    assert.match(exportData([group], nodes).code, /TweenTimeline@4/);
    const combined = exportData([group, track("localScaleX")], nodes);
    assert.match(combined.code, /TweenTimeline@5/);
    assert.deepEqual(rows(combined.code).find((row) => row[1] === "groupAlpha"), ["", "groupAlpha", 0, 1, "Linear", 255, 0]);
    assert.equal(combined.tweenCount, 2);
    assert.deepEqual(combined.warnings, []);
  });
  test("Unexpected relative flags on other fields warn and remain absolute", () => {
    const result = exportData([track("localRotationZ", 150, 300)]);
    assert.match(result.code, /TweenTimeline@3/);
    assert.deepEqual(rows(result.code)[0], ["", "localRotationZ", 0, 1, "Linear", 150, 300]);
    assert.match(result.warnings[0], /不支持位置\/大小\/缩放增量/);
  });
  test("Invalid values do not activate @5 or prevent a later valid scale row", () => {
    const result = exportData([track("localScaleX", null, 2), track("localScaleX", 2, 4, false), track("localScaleY", 0, Infinity)]);
    assert.match(result.code, /TweenTimeline@3/);
    assert.equal(result.trackCount, 1);
    assert.equal(result.warnings.length, 2);
    assert.deepEqual(rows(result.code)[0].slice(5), [2, 4]);
  });
  test("Relative rows still use the selected root's child path", () => {
    const nodes = [node("root"), node("panel", "container", "root"), node("icon", "image", "panel")];
    const result = exportData([track("localScaleX", 0, 0.25, true, "icon")], nodes);
    assert.equal(rows(result.code)[0][0], "panel/icon");
  });

  const library = buildTweenTimelineLibLua().code;
  test("The Lib supports @3/@4/@5/@6 and snapshots scaling before any initial assignment", () => {
    for (const schema of [3, 4, 5, 6]) assert.ok(library.includes(`TweenTimeline@${schema}`));
    assert.match(library, /if track\[8\] == true then/);
    assert.match(library, /IsRelativeField\(track\[2\]\) and IsNumber\(track\[6\]\)/);
    assert.match(library, /pcall\(function\(\) return control\[track\[2\]\] end\)/);
    const legacy = library.slice(library.indexOf("function TweenTimelineLib.Create(root, data)"));
    assert.ok(legacy.indexOf("baseline = ok and baseline or nil") < legacy.indexOf("for _, lane in ipairs(lanes) do"));
    assert.ok(legacy.indexOf("for _, lane in ipairs(lanes) do") < legacy.indexOf("target[1][target[2]] = from"));
    assert.match(library, /fromValue, toValue = previousEnd \+ fromValue, previousEnd \+ toValue/);
    assert.match(library, /:SetRelative\(false\)/);
    assert.doesNotMatch(library, /:SetRelative\(true\)|track\[[678]\]\s*=(?!=)/);
  });

  const candidates = process.env.LUA_BIN ? [process.env.LUA_BIN] : ["lua", "lua53", "luajit"];
  const lua = candidates.find((candidate) => {
    const result = spawnSync(candidate, ["-v"], { encoding: "utf8", timeout: 5000, windowsHide: true });
    return !result.error && result.status === 0;
  });
  if (process.env.LUA_BIN && !lua) throw new Error("LUA_BIN does not name a runnable Lua executable");
  if (lua) {
    test("Generated Lua resolves additive endpoints once and snapshots all axes before assignments", () => {
      const script = `
local logs = {}
function printerr(value) logs[#logs + 1] = value end
Enum = { EaseType = {} }
${tweenEaseOptions.map(({ value }) => `Enum.EaseType.${value} = "${value}"`).join("\n")}
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
local values = { localScaleX = 2, localScaleY = 3, localScaleZ = 0 }
local root = setmetatable({}, {
    __index = values,
    __newindex = function(_, key, value)
        values[key] = value
        if key == "localScaleX" then values.localScaleY = 999 end
    end,
})
local data = { schema = Lib.Schema, tracks = {
    { "", "localScaleX", 0.5, 1, "OutQuad", 0.5, -0.25, true },
    { "", "localScaleY", 0, 1, "Linear", 0, 1, true },
    { "", "localScaleZ", 0, 1, "Linear", -0.5, -1, true },
} }
local sequence = Lib.Create(root, data)
assert(#sequence.items == 3 and #logs == 0)
local x, y, z = sequence.items[1][2], sequence.items[2][2], sequence.items[3][2]
assert(x.from.localScaleX == 2.5 and x.values.localScaleX == 1.75)
assert(y.from.localScaleY == 3 and y.values.localScaleY == 4)
assert(z.from.localScaleZ == -0.5 and z.values.localScaleZ == -1)
assert(sequence.items[1][1] == 0.5 and x.duration == 1 and x.ease == "OutQuad")
for _, item in ipairs(sequence.items) do assert(item[2].relative == false) end
assert(data.tracks[1][6] == 0.5 and data.tracks[1][7] == -0.25 and data.tracks[1][8] == true)
values.localScaleX = 10
local nextSequence = Lib.Create(root, { schema = Lib.Schema, tracks = { data.tracks[1] } })
assert(nextSequence.items[1][2].from.localScaleX == 10.5)
assert(nextSequence.items[1][2].values.localScaleX == 9.75)
for _, version in ipairs({3, 4, 5}) do
    local legacy = Lib.Create(root, { schema = "ClientUIAnimationEditor.TweenTimeline@" .. version,
        tracks = {{ "", "localScaleX", 0, 1, "Linear", 1, 2 }} })
    assert(legacy.items[1][2].from.localScaleX == 1 and legacy.items[1][2].values.localScaleX == 2)
end
local invalid = Lib.Create(root, { schema = Lib.Schema, tracks = {
    { "", "localScaleZ", 0, 1, "Linear", 0, math.huge, true },
    { "", "localRotationZ", 0, 1, "Linear", 0, 1, true },
    { "", "localScaleZ", 0, 1, "Linear", 0, 1, false },
} })
assert(#invalid.items == 1 and #logs == 2)
assert(invalid.items[1][2].from.localScaleZ == 0 and invalid.items[1][2].values.localScaleZ == 1)
print("PASS emitted Lua additive scaling native-API mocks")
`;
      const result = spawnSync(lua, ["-"], { input: script, encoding: "utf8", timeout: 10000, windowsHide: true });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /PASS emitted Lua additive scaling/);
    });
  } else {
    console.log("SKIP emitted Lua execution: no local Lua executable (set LUA_BIN to enable)");
  }
  console.log(`${passed} scale-delta export checks passed.`);
} finally {
  if (originalTsExtension) Module._extensions[".ts"] = originalTsExtension;
  else delete Module._extensions[".ts"];
}
