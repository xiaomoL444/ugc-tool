/* Run: node scripts/test-client-ui-timeline-snapping.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../src/views/ClientUIAnimationEditor/timelineSnapping.ts");
const moduleInstance = new Module(filename, module);
moduleInstance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  fileName: filename,
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { snapTweenClip } = moduleInstance.exports;
const snap = (options = {}) => snapTweenClip({
  mode: "move", startTime: 1, duration: 2, deltaTime: 0,
  sequenceDuration: 10, laneWidth: 1000, enabled: true, targets: [], ...options,
});
let passed = 0;
function test(name, check) { check(); passed++; console.log(`PASS ${name}`); }

test("Moving either edge onto a target preserves the entire duration", () => {
  assert.deepEqual(snap({ deltaTime: 1.94, targets: [3] }), { startTime: 3, duration: 2, snapTime: 3 });
  assert.deepEqual(snap({ deltaTime: 0.94, targets: [4] }), { startTime: 2, duration: 2, snapTime: 4 });
});

test("Leading-edge resize fixes the end and trailing-edge resize fixes the start", () => {
  assert.deepEqual(snap({ mode: "start", deltaTime: 0.96, targets: [2] }), { startTime: 2, duration: 1, snapTime: 2 });
  assert.deepEqual(snap({ mode: "end", deltaTime: 0.96, targets: [4] }), { startTime: 1, duration: 3, snapTime: 4 });
});

test("Disabled snapping neither quantizes timing nor returns a guide", () => {
  assert.deepEqual(snap({ deltaTime: 0.943217, targets: [4], enabled: false }), { startTime: 1.943217, duration: 2, snapTime: null });
  assert.deepEqual(snap({ mode: "end", deltaTime: 0.943217, targets: [4], enabled: false }), { startTime: 1, duration: 2.943217, snapTime: null });
});

test("Targets outside eight CSS pixels are ignored", () => {
  assert.deepEqual(snap({ deltaTime: 0.919, targets: [4] }), { startTime: 1.919, duration: 2, snapTime: null });
  assert.deepEqual(snap({ deltaTime: 0.92, targets: [4] }), { startTime: 2, duration: 2, snapTime: 4 });
});

test("Threshold tracks the actual lane width and sequence duration", () => {
  assert.equal(snap({ deltaTime: 0.85, laneWidth: 500, targets: [4] }).snapTime, 4);
  assert.equal(snap({ deltaTime: 0.85, laneWidth: 1000, targets: [4] }).snapTime, null);
  assert.equal(snap({ deltaTime: 0.85, sequenceDuration: 20, targets: [4] }).snapTime, 4);
});

test("Move clamps to both sequence boundaries without changing duration", () => {
  assert.deepEqual(snap({ deltaTime: -100, targets: [0] }), { startTime: 0, duration: 2, snapTime: 0 });
  assert.deepEqual(snap({ deltaTime: 100, targets: [10] }), { startTime: 8, duration: 2, snapTime: 10 });
  assert.deepEqual(snap({ deltaTime: 100, targets: [10], enabled: false }), { startTime: 8, duration: 2, snapTime: null });
});

test("An unreachable moved-edge target cannot compress a clip or show a guide", () => {
  assert.deepEqual(snap({ deltaTime: -1, targets: [1.98] }), { startTime: 0, duration: 2, snapTime: null });
  assert.deepEqual(snap({ deltaTime: 7, targets: [8.02] }), { startTime: 8, duration: 2, snapTime: null });
});

test("Resize enforces a minimum duration and ignores targets that cross the fixed endpoint", () => {
  assert.deepEqual(snap({ mode: "start", deltaTime: 100, targets: [3], minDuration: 0.1 }), { startTime: 2.9, duration: 0.1, snapTime: null });
  assert.deepEqual(snap({ mode: "end", deltaTime: -100, targets: [1], minDuration: 0.1 }), { startTime: 1, duration: 0.1, snapTime: null });
  assert.deepEqual(snap({ mode: "start", deltaTime: 100, targets: [3] }), { startTime: 2.99, duration: 0.01, snapTime: null });
  assert.deepEqual(snap({ mode: "end", deltaTime: -100, targets: [1] }), { startTime: 1, duration: 0.01, snapTime: null });
});

test("Resize reaches sequence boundaries without moving the opposite endpoint", () => {
  assert.deepEqual(snap({ mode: "start", deltaTime: -100, targets: [0] }), { startTime: 0, duration: 3, snapTime: 0 });
  assert.deepEqual(snap({ mode: "end", deltaTime: 100, targets: [10] }), { startTime: 1, duration: 9, snapTime: 10 });
});

test("The nearest reachable candidate wins even if an invalid target is closer", () => {
  assert.deepEqual(snap({ mode: "end", deltaTime: -1.98, targets: [1, 1.005, 1.05] }), { startTime: 1, duration: 0.05, snapTime: 1.05 });
  assert.deepEqual(snap({ deltaTime: 0.95, targets: [3.89, 4] }), { startTime: 2, duration: 2, snapTime: 4 });
});

test("Equal-distance targets are deterministic regardless of input order", () => {
  const expected = { startTime: 1.95, duration: 2, snapTime: 1.95 };
  assert.deepEqual(snap({ deltaTime: 1, targets: [2.05, 1.95] }), expected);
  assert.deepEqual(snap({ deltaTime: 1, targets: [1.95, 2.05] }), expected);
});

test("Unsorted duplicate targets and invalid target numbers are harmless", () => {
  assert.deepEqual(snap({ deltaTime: 0.94, targets: [Infinity, NaN, -1, 11, 4, 4, 2] }), { startTime: 2, duration: 2, snapTime: 2 });
});

test("Empty targets and invalid lane widths disable snapping safely", () => {
  for (const laneWidth of [0, -1, NaN, Infinity]) {
    assert.deepEqual(snap({ deltaTime: 0.94, targets: [4], laneWidth }), { startTime: 1.94, duration: 2, snapTime: null });
  }
  assert.deepEqual(snap({ deltaTime: 0.94 }), { startTime: 1.94, duration: 2, snapTime: null });
});

test("Invalid times are sanitized and a sequence shorter than the minimum remains valid", () => {
  assert.deepEqual(snap({ sequenceDuration: NaN }), { startTime: 0, duration: 0, snapTime: null });
  assert.deepEqual(snap({ sequenceDuration: -3 }), { startTime: 0, duration: 0, snapTime: null });
  assert.deepEqual(snap({ sequenceDuration: 0.005 }), { startTime: 0, duration: 0.005, snapTime: null });
  assert.deepEqual(snap({ startTime: NaN, duration: Infinity, deltaTime: NaN }), { startTime: 0, duration: 0.01, snapTime: null });
});

test("High precision timing survives repeated drags without cumulative length changes", () => {
  const original = { startTime: 0.123456, duration: 1.234567 };
  const moved = snap({ ...original, deltaTime: 1, targets: [2.36] });
  assert.equal(moved.duration, original.duration);
  assert.equal(moved.snapTime, 2.36);
  assert.equal(Number((moved.startTime + moved.duration).toFixed(6)), 2.36);
  const resized = snap({ ...original, mode: "start", deltaTime: 0.2, targets: [0.3] });
  assert.equal(Number((resized.startTime + resized.duration).toFixed(6)), 1.358023);
  assert.deepEqual(snap({ ...original, deltaTime: 0.222222, enabled: false }), { startTime: 0.345678, duration: 1.234567, snapTime: null });
});

console.log(`\n${passed} timeline snapping tests passed.`);
