/* Run: node scripts/test-client-ui-timeline-data-import.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
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
  const { buildTweenTimelineDataLua } = require(path.join(editor, "luaTweenExporter.ts"));
  const { prepareTweenTimelineImport } = require(path.join(editor, "luaTweenImporter.ts"));
  const schema = (version) => `ClientUIAnimationEditor.TweenTimeline@${version}`;
  const columns = ["path", "field", "start", "duration", "ease", "from", "to", "relative"];
  let passed = 0;
  let serial = 0;
  function test(name, check) { check(); passed += 1; console.log(`PASS ${name}`); }
  function node(id, type = "container", parentId = null, name = id) {
    return { id, name, type, parentId, anchorOffsetX: 100, anchorOffsetY: 200,
      scaleX: 2, scaleY: 3, scaleZ: 1, properties: createControlProperties(type) };
  }
  function fixture() {
    return [node("world"), node("root", "container", "world"), node("icon", "image", "root"),
      node("panel", "container", "root"), node("caption", "text", "panel"),
      node("window", "textWindow", "root"), node("scroller", "gridScroller", "root"),
      node("outside", "image", "world")];
  }
  function clip(startTime = 0, overrides = {}) {
    return { id: `source-${++serial}`, nodeId: "root", fieldKey: "anchoredPositionX", startTime,
      duration: 1, initialValue: 0, endValue: 40, easeType: "Linear", ...overrides };
  }
  function row(overrides = {}) {
    const value = { path: "", field: "anchoredPositionX", start: 0, duration: 1,
      ease: "Linear", from: 0, to: 40, ...overrides };
    return columns.slice(0, "relative" in value ? 8 : 7).map((column) => value[column]);
  }
  function lua(value) {
    if (value === null || value === undefined) return "nil";
    if (typeof value === "string") return JSON.stringify(value);
    if (Array.isArray(value)) return `{ ${value.map(lua).join(", ")} }`;
    if (typeof value === "object") return `{ ${Object.entries(value).map(([key, item]) => `${key} = ${lua(item)}`).join(", ")} }`;
    return String(value);
  }
  function source(rows = [row()], metadata = {}) {
    return `return ${lua({ schema: schema(7), duration: 4, tracks: rows, ...metadata })}`;
  }
  function exportData(tracks, nodes = fixture(), sequenceDuration = 4, rootNodeId = "root") {
    const result = buildTweenTimelineDataLua({ projectName: "Timeline Import", rootNodeId, nodes, tracks, sequenceDuration });
    assert.deepEqual(result.warnings, []);
    assert.equal(result.trackCount, tracks.length);
    return result.code;
  }
  function importData(code, overrides = {}) {
    return prepareTweenTimelineImport({ source: code, nodes: fixture(), rootNodeId: "root",
      existingTracks: [], mode: "append", sequenceDuration: 1, ...overrides });
  }
  function successful(result, count) {
    assert.deepEqual(result.errors, []);
    assert.equal(result.importedTracks.length, count);
    assert.ok(result.importedTracks.every((track) => typeof track.id === "string" && track.id.length > 0));
    assert.equal(new Set(result.tracks.map((track) => track.id)).size, result.tracks.length);
    return result.importedTracks;
  }
  function values(track) {
    const { id, relative, ...rest } = track;
    return { ...rest, relative: relative === true };
  }
  function freeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  function rejects(code, overrides = {}) {
    for (const mode of ["append", "replace"]) {
      const options = { source: code, nodes: fixture(), rootNodeId: "root", sequenceDuration: 20,
        existingTracks: [clip(5), clip(7, { nodeId: "outside" })], mode, ...overrides };
      const before = JSON.stringify(options);
      freeze(options);
      const result = prepareTweenTimelineImport(options);
      assert.ok(result.errors.length > 0, `Expected rejection for ${code}`);
      assert.deepEqual(result.tracks, options.existingTracks);
      result.tracks.forEach((track, index) => assert.equal(track, options.existingTracks[index]));
      assert.deepEqual(result.importedTracks, []);
      assert.equal(result.replacedCount, 0);
      assert.equal(result.duration, options.sequenceDuration);
      assert.equal(JSON.stringify(options), before);
    }
  }
  function invalidRow(overrides) {
    rejects(source([row({ field: "anchoredPositionY" }), row(overrides)]));
  }

  test("Actual Data export roundtrips the selected root and nested named paths", () => {
    const nodes = fixture();
    nodes.find((item) => item.id === "root").name = "Selected Root";
    nodes.find((item) => item.id === "panel").name = '面板 "A"';
    nodes.find((item) => item.id === "caption").name = "标签\\caption";
    const tracks = [clip(), clip(0.5, { nodeId: "caption", fieldKey: "fontSize", initialValue: 18, endValue: 30 })];
    const code = exportData(tracks, nodes, 8.25);
    const result = importData(code, { nodes });
    assert.deepEqual(successful(result, 2).map(values), tracks.map(values));
    assert.equal(result.duration, 8.25);
    assert.equal(result.schema, schema(3));
    assert.deepEqual(result.warnings, []);
    assert.equal(result.replacedCount, 0);
  });

  test("Multi-Clip export preserves chronological order, gaps, and negative additive endpoints", () => {
    const tracks = [clip(4, { relative: true, initialValue: -10, endValue: -90 }),
      clip(0, { relative: true }), clip(1, { initialValue: 40, endValue: 70 })];
    const result = importData(exportData(tracks, fixture(), 7));
    const restored = successful(result, 3);
    assert.deepEqual(restored.map(values), [tracks[1], tracks[2], tracks[0]].map(values));
    assert.equal(result.duration, 7);
    assert.equal(result.schema, schema(7));
  });

  test("Position, size, scale deltas and numeric groupAlpha retain their own semantics", () => {
    const fields = ["anchoredPositionX", "anchoredPositionY", "sizeDeltaX", "sizeDeltaY", "localScaleX", "localScaleY", "localScaleZ"];
    const tracks = fields.map((fieldKey) => clip(0, { fieldKey, relative: true, initialValue: -2, endValue: -10 }));
    tracks.push(clip(0, { fieldKey: "groupAlpha", initialValue: 255, endValue: 64 }));
    const restored = successful(importData(exportData(tracks)), tracks.length);
    for (const original of tracks) assert.deepEqual(values(restored.find((item) => item.fieldKey === original.fieldKey)), values(original));
    assert.equal(restored.find((item) => item.fieldKey === "groupAlpha").endValue, 64);
  });

  test("Byte colors roundtrip to RGB bytes and normalized editor alpha without recoloring nodes", () => {
    const nodes = fixture();
    const tracks = [["icon", "imageColor"], ["caption", "fontColor"], ["caption", "bgColor"],
      ["caption", "outlineColor"], ["window", "fontColor"]].map(([nodeId, fieldKey]) => clip(0, {
      nodeId, fieldKey, initialValue: { r: 12, g: 34, b: 56, a: 0.5 }, endValue: { r: 200, g: 100, b: 0, a: 0 },
    }));
    const before = JSON.stringify(nodes);
    const restored = successful(importData(exportData(tracks, nodes), { nodes }), tracks.length);
    for (const item of restored) {
      assert.deepEqual(item.initialValue, { r: 12, g: 34, b: 56, a: 128 / 255 });
      assert.deepEqual(item.endValue, { r: 200, g: 100, b: 0, a: 0 });
    }
    assert.equal(JSON.stringify(nodes), before);
    assert.deepEqual(successful(importData(exportData(restored, nodes)), tracks.length).map(values), restored.map(values));
  });

  test("Every supported easing survives a real multi-Clip Data export", () => {
    const tracks = tweenEaseOptions.map(({ value }, index) => clip(index, { easeType: value }));
    const restored = successful(importData(exportData(tracks)), tracks.length);
    assert.deepEqual(restored.map((item) => item.easeType), tracks.map((item) => item.easeType));
  });

  test("All existing schema versions @3 through @7 accept their standard positional columns", () => {
    for (let version = 3; version <= 7; version += 1) {
      const result = importData(source([row()], { schema: schema(version) }));
      assert.deepEqual(values(successful(result, 1)[0]), values(clip()));
      assert.equal(result.schema, schema(version));
    }
    const relative = successful(importData(source([row({ field: "localScaleX", from: 0, to: -0.5, relative: true })], { schema: schema(5) })), 1)[0];
    assert.equal(relative.relative, true);
    assert.equal(relative.endValue, -0.5);
    for (const [version, track] of [[4, clip(0, { fieldKey: "groupAlpha", initialValue: 255, endValue: 0 })],
      [5, clip(0, { fieldKey: "localScaleX", initialValue: 0, endValue: -0.5, relative: true })]]) {
      const result = importData(exportData([track]));
      assert.deepEqual(values(successful(result, 1)[0]), values(track));
      assert.equal(result.schema, schema(version));
    }
  });

  test("Explicit columns can be reordered, and omitted relative entries stay absolute", () => {
    const reordered = ["relative", "to", "field", "from", "ease", "duration", "path", "start"];
    const data = { path: "panel/caption", field: "sizeDeltaX", start: 2, duration: 0.5,
      ease: "OutBack", from: -10, to: -30, relative: true };
    const restored = successful(importData(source([reordered.map((key) => data[key])], { columns: reordered })), 1)[0];
    assert.deepEqual(values(restored), values(clip(2, { nodeId: "caption", fieldKey: "sizeDeltaX",
      duration: 0.5, easeType: "OutBack", initialValue: -10, endValue: -30, relative: true })));
    assert.equal(successful(importData(source([row()], { columns })), 1)[0].relative === true, false);
  });

  test("Control-specific numeric Tween fields import only onto capable control types", () => {
    const tracks = [clip(0, { nodeId: "icon", fieldKey: "fillAmount", initialValue: 0, endValue: 1 }),
      clip(0, { nodeId: "caption", fieldKey: "fontSize", initialValue: 12, endValue: 28 }),
      clip(0, { nodeId: "scroller", fieldKey: "scrollProgress", initialValue: 0, endValue: 1 })];
    const restored = successful(importData(exportData(tracks)), tracks.length);
    for (const original of tracks) assert.deepEqual(values(restored.find((item) => item.nodeId === original.nodeId)), values(original));
  });

  test("Append preserves existing objects, never mutates frozen input, and creates fresh unique IDs", () => {
    const nodes = freeze(fixture());
    const tracks = freeze([clip(0), clip(2)]);
    const existingTracks = freeze([clip(6), clip(9, { nodeId: "outside" })]);
    const sourceCode = exportData(tracks, nodes);
    const options = freeze({ nodes, existingTracks, sequenceDuration: 30 });
    const before = JSON.stringify({ nodes, tracks, existingTracks });
    const first = importData(sourceCode, options);
    const second = importData(exportData([clip(3), clip(4)], nodes), { ...options, existingTracks: first.tracks });
    successful(first, 2);
    successful(second, 2);
    assert.deepEqual(first.tracks.slice(0, existingTracks.length), existingTracks);
    first.tracks.slice(0, existingTracks.length).forEach((item, index) => assert.equal(item, existingTracks[index]));
    assert.equal(first.duration, 30);
    assert.equal(first.replacedCount, 0);
    const priorIds = new Set([...tracks, ...existingTracks, ...first.importedTracks].map((item) => item.id));
    assert.ok(first.importedTracks.every((item) => !tracks.some((original) => original.id === item.id)));
    assert.ok(second.importedTracks.every((item) => !priorIds.has(item.id)));
    assert.equal(JSON.stringify({ nodes, tracks, existingTracks }), before);
  });

  test("Append rejects existing overlaps but accepts touching endpoints and the shared seam tolerance", () => {
    const existingTracks = [clip(0)];
    rejects(source([row({ start: 0.5 })]), { existingTracks, mode: "append" });
    for (const start of [1, 1 - 0.0000005]) {
      const result = importData(source([row({ start })]), { existingTracks });
      successful(result, 1);
      assert.equal(result.tracks.length, 2);
    }
  });

  test("Replace affects only the selected subtree and keeps enough duration for retained external Clips", () => {
    const existingTracks = [clip(3), clip(4, { nodeId: "caption" }),
      clip(9, { nodeId: "outside", duration: 3 }), clip(2, { nodeId: "world" })];
    const result = importData(exportData([clip()], fixture(), 5), { existingTracks, mode: "replace", sequenceDuration: 2 });
    successful(result, 1);
    assert.equal(result.replacedCount, 2);
    assert.equal(result.tracks.length, 3);
    assert.equal(result.tracks.find((item) => item.nodeId === "outside"), existingTracks[2]);
    assert.equal(result.tracks.find((item) => item.nodeId === "world"), existingTracks[3]);
    assert.equal(result.duration, 12);
    assert.equal(result.tracks.some((item) => item.nodeId === "caption"), false);
  });

  test("Unsupported or absent schema, malformed tables, empty tracks and invalid columns reject atomically", () => {
    for (const invalid of [schema(2), schema(8), "TweenTimeline@7", null, 7]) rejects(source([row()], { schema: invalid }));
    rejects("return {}");
    rejects(source([]));
    rejects(source([row()], { tracks: "bad" }));
    for (const invalid of [["path", "field"], [...columns, "path"], [...columns.slice(0, 6), "unknown"], "path,field"]) {
      rejects(source([row()], { columns: invalid }));
    }
  });

  test("Paths must resolve unambiguously inside the selected root, including each ancestor", () => {
    for (const path of ["missing", "outside", "root/icon", "panel/missing", "/icon", "panel//caption", "icon/", "../outside", 0, null]) invalidRow({ path });
    rejects(source([row()]), { rootNodeId: "missing" });
    const nodes = [...fixture(), node("second-icon", "image", "root", "icon")];
    rejects(source([row({ path: "icon" })]), { nodes });
    const duplicateParents = [...fixture(), node("other-panel", "container", "root", "panel")];
    rejects(source([row({ path: "panel/caption" })]), { nodes: duplicateParents });
    const separateParents = [...fixture(), node("other-icon", "image", "panel", "icon")];
    const restored = successful(importData(source([row({ path: "icon" }), row({ path: "panel/icon" })]), { nodes: separateParents }), 2);
    assert.deepEqual(restored.map((item) => item.nodeId), ["icon", "other-icon"]);
  });

  test("Unknown, non-Tweenable, and wrong-control fields reject the complete import", () => {
    for (const field of ["unknown", "x", "text", "active", "imageColor", "fontSize", "sizeDeltaZ", 0, null]) invalidRow({ field });
    invalidRow({ path: "icon", field: "fontColor", from: [1, 2, 3, 255], to: [1, 2, 3, 0] });
  });

  test("Invalid ease names and numeric endpoint types cannot silently fall back or partially commit", () => {
    for (const ease of ["linear", "Unknown", "Enum.EaseType.Linear", 0, null]) invalidRow({ ease });
    for (const value of ["10", true, null, [1, 2, 3, 255]]) {
      invalidRow({ from: value });
      invalidRow({ to: value });
    }
    invalidRow({ path: "icon", field: "imageColor", from: 0, to: 255 });
  });

  test("Invalid start, duration, and declared duration reject while valid totals expand to the last Clip", () => {
    for (const start of [-1, "0", null]) invalidRow({ start });
    for (const duration of [-1, 0, 0.009, "1", null]) invalidRow({ duration });
    for (const duration of [-1, "4", null]) rejects(source([row()], { duration }));
    invalidRow({ start: 1e308, duration: 1e308 });
    rejects(source([row()]).replace('"Linear", 0, 40', '"Linear", 1e999, 40'));
    const result = importData(source([row({ start: 9, duration: 3 })], { duration: 2 }));
    successful(result, 1);
    assert.equal(result.duration, 12);
    successful(importData(source([row({ duration: 0.01 })])), 1);
  });

  test("Relative accepts booleans and documented additive fields only", () => {
    for (const relative of [1, "true", {}, []]) invalidRow({ relative });
    for (const field of ["localRotationZ", "pivotX", "groupAlpha"]) invalidRow({ field, relative: true });
    invalidRow({ path: "icon", field: "imageColor", from: [1, 2, 3, 255], to: [1, 2, 3, 0], relative: true });
    assert.equal(successful(importData(source([row({ relative: false })])), 1)[0].relative === true, false);
  });

  test("Malformed or out-of-range RGBA and groupAlpha values reject without clamping", () => {
    for (const value of [[1, 2, 3], [1, 2, 3, 255, 0], [-1, 2, 3, 255], [1, 256, 3, 255],
      [1, 2, 3, 256], [1, 2, 3, -1], [1, 2, 3, 0.5], [1.5, 2, 3, 255], [1, 2, 3, "255"], { r: 1, g: 2, b: 3, a: 255 }]) {
      invalidRow({ path: "icon", field: "imageColor", from: value, to: [1, 2, 3, 0] });
    }
    for (const value of [-1, 256]) {
      invalidRow({ field: "groupAlpha", from: value });
      invalidRow({ field: "groupAlpha", to: value });
    }
  });

  test("Within-import overlapping Clips and group/color ownership conflicts reject atomically", () => {
    rejects(source([row({ duration: 2 }), row({ start: 1 })]));
    rejects(source([row(), row()]));
    rejects(source([row({ field: "groupAlpha", from: 255, to: 0 }),
      row({ path: "icon", field: "imageColor", start: 2, from: [1, 2, 3, 255], to: [1, 2, 3, 0] })]));
    rejects(source([row({ field: "groupAlpha", from: 255, to: 0 }),
      row({ path: "icon", field: "groupAlpha", start: 2, from: 255, to: 0 })]));
    rejects(source([row({ path: "icon", field: "imageColor", from: [1, 2, 3, 255], to: [1, 2, 3, 0] })]), {
      existingTracks: [clip(10, { nodeId: "world", fieldKey: "groupAlpha", initialValue: 255, endValue: 0 })],
    });
  });

  test("Only Lua data is accepted; calls, executable code, and trailing content cannot reach commit", () => {
    const code = source([row()]);
    for (const unsafe of ["return require('other')", "return os.execute('echo bad')", `${code}\nos.execute('echo bad')`,
      `${code}\nreturn {}`, `${code}; arbitrary`, "local Data = {}; Data.tracks = {}; return Data",
      code.replace('"Linear"', "(function() return 'Linear' end)()")]) rejects(unsafe);
  });

  console.log(`${passed} Timeline Data import checks passed.`);
} finally {
  if (originalTsExtension) Module._extensions[".ts"] = originalTsExtension;
  else delete Module._extensions[".ts"];
}
