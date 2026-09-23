/* Run: node scripts/test-client-ui-multi-clip-layout.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../src/views/ClientUIAnimationEditor/timelineClipLayout.ts");
const moduleInstance = new Module(filename, module);
moduleInstance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  fileName: filename,
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { getTweenClipGap, getTweenClipBounds, tweenClipsOverlap, orderTweenClips } = moduleInstance.exports;

const clip = (id, startTime, duration, changes = {}) => ({
  id, nodeId: "node", fieldKey: "anchoredPositionX", startTime, duration, ...changes,
});
const gap = (clips = [], time = 0, duration = 10, minimum = 0.01) =>
  getTweenClipGap(clips, "node", "anchoredPositionX", time, duration, minimum);
let passed = 0;
function test(name, check) { check(); passed++; console.log(`PASS ${name}`); }

test("An empty lane creates a one-second clip at the requested time", () => {
  assert.deepEqual(gap([], 2.1234564), { startTime: 2.123456, duration: 1 });
});

test("Creation never silently skips an occupied part of the lane", () => {
  const clips = [clip("a", 2, 1), clip("b", 4, 1)];
  for (const time of [2, 2.00001, 2.5, 2.99999, 4, 4.5]) assert.equal(gap(clips, time), null);
});

test("A new clip can start at another clip's end and finish at the next start", () => {
  const clips = [clip("b", 4, 1), clip("a", 2, 1)];
  assert.deepEqual(gap(clips, 3), { startTime: 3, duration: 1 });
  assert.equal(gap([...clips, clip("seam", 3, 1)], 3), null);
});

test("Creation truncates duration at the closest next clip", () => {
  const clips = [clip("far", 8, 1), clip("near", 2.25, 1)];
  assert.deepEqual(gap(clips, 2), { startTime: 2, duration: 0.25 });
});

test("Creation truncates duration at the sequence end", () => {
  assert.deepEqual(gap([], 9.9), { startTime: 9.9, duration: 0.1 });
  assert.deepEqual(gap([], 9.99), { startTime: 9.99, duration: 0.01 });
  assert.equal(gap([], 9.999), null);
  assert.equal(gap([], 10), null);
  assert.equal(gap([], 11), null);
});

test("The minimum creation gap is inclusive and subminimum holes are rejected", () => {
  assert.deepEqual(gap([clip("next", 1.01, 1)], 1), { startTime: 1, duration: 0.01 });
  assert.equal(gap([clip("next", 1.009, 1)], 1), null);
  assert.deepEqual(gap([clip("next", 1.25, 1)], 1, 10, 0.25), { startTime: 1, duration: 0.25 });
  assert.equal(gap([clip("next", 1.249, 1)], 1, 10, 0.25), null);
});

test("Short sequences reject clips smaller than the configured minimum", () => {
  assert.equal(gap([], 0, 0.005), null);
  assert.deepEqual(gap([], 0, 0.01), { startTime: 0, duration: 0.01 });
  assert.deepEqual(gap([], 0, 0.005, 0.001), { startTime: 0, duration: 0.005 });
});

test("Different nodes and different fields have independent lanes", () => {
  const clips = [clip("other-node", 0, 10, { nodeId: "another" }), clip("other-field", 0, 10, { fieldKey: "anchoredPositionY" })];
  assert.deepEqual(gap(clips, 4), { startTime: 4, duration: 1 });
  assert.deepEqual(getTweenClipBounds(clip("target", 4, 1), clips, 10), { minStart: 0, maxEnd: 10 });
});

test("Click positions clamp to sequence boundaries and invalid inputs fail safely", () => {
  assert.deepEqual(gap([], -5), { startTime: 0, duration: 1 });
  for (const time of [NaN, Infinity, -Infinity]) assert.equal(gap([], time), null);
  for (const duration of [NaN, Infinity, -1, 0]) assert.equal(gap([], 0, duration), null);
  for (const minimum of [NaN, Infinity, 0, -1]) assert.deepEqual(gap([], 9.99, 10, minimum), { startTime: 9.99, duration: 0.01 });
});

test("The nearest neighbors bound movement and both resize directions", () => {
  const target = clip("target", 4, 1);
  const clips = [clip("next-far", 8, 1), clip("previous-far", 0, 1), clip("next", 6, 1), target, clip("previous", 2, 1)];
  assert.deepEqual(getTweenClipBounds(target, clips, 10), { minStart: 3, maxEnd: 6 });
  const { minStart, maxEnd } = getTweenClipBounds(target, clips, 10);
  assert.equal(Math.min(maxEnd - target.duration, Math.max(minStart, target.startTime - 100)), 3);
  assert.equal(Math.min(maxEnd - target.duration, Math.max(minStart, target.startTime + 100)), 5);
});

test("Touching neighbors leave a clip immovable without changing duration", () => {
  const target = clip("target", 3, 1);
  assert.deepEqual(getTweenClipBounds(target, [clip("previous", 2, 1), target, clip("next", 4, 1)], 10), { minStart: 3, maxEnd: 4 });
});

test("A clip with no neighbors can use the complete sequence", () => {
  const target = clip("target", 4, 1);
  assert.deepEqual(getTweenClipBounds(target, [target], 10), { minStart: 0, maxEnd: 10 });
  assert.deepEqual(getTweenClipBounds(target, [{ ...target, startTime: 0, duration: 10 }], 10), { minStart: 0, maxEnd: 10 });
});

test("Only actual overlap conflicts; touching endpoints and different lanes are valid", () => {
  const a = clip("a", 1, 1);
  assert.equal(tweenClipsOverlap(a, clip("b", 1.5, 1)), true);
  assert.equal(tweenClipsOverlap(a, clip("b", 0, 3)), true);
  assert.equal(tweenClipsOverlap(a, clip("b", 2, 1)), false);
  assert.equal(tweenClipsOverlap(a, clip("b", 0, 1)), false);
  assert.equal(tweenClipsOverlap(a, clip("b", 1.5, 1, { nodeId: "other" })), false);
  assert.equal(tweenClipsOverlap(a, clip("b", 1.5, 1, { fieldKey: "anchoredPositionY" })), false);
});

test("Floating-point seams remain valid while real microsecond overlaps are rejected", () => {
  assert.equal(tweenClipsOverlap(clip("a", 0.1, 0.2), clip("b", 0.3, 0.5)), false);
  assert.equal(tweenClipsOverlap(clip("a", 0.1, 0.2), clip("b", 0.299998, 0.5)), true);
  assert.deepEqual(gap([clip("a", 0.1, 0.2)], 0.3), { startTime: 0.3, duration: 1 });
});

test("Already-invalid overlapping data cannot expand its occupied area by dragging", () => {
  const target = clip("target", 2, 1);
  assert.deepEqual(getTweenClipBounds(target, [clip("overlap", 2.5, 1), target], 10), { minStart: 2, maxEnd: 3 });
});

test("Stable ordering preserves equal-time order and does not mutate source arrays", () => {
  const clips = [clip("late", 5, 1), clip("first", 1, 1), clip("second", 1, 1), clip("early", 0, 1)];
  const ordered = orderTweenClips(clips);
  assert.deepEqual(ordered.map(({ id }) => id), ["early", "first", "second", "late"]);
  assert.deepEqual(clips.map(({ id }) => id), ["late", "first", "second", "early"]);
  assert.equal(ordered[1], clips[1]);
});

test("Invalid durations and start times do not create phantom occupied intervals", () => {
  for (const invalid of [clip("bad", NaN, 1), clip("bad", 0, NaN), clip("bad", 0, -1), clip("bad", 0, 0)]) {
    assert.deepEqual(gap([invalid], 0), { startTime: 0, duration: 1 });
    assert.equal(tweenClipsOverlap(clip("valid", 0, 1), invalid), false);
  }
});

test("A minimum greater than one second is respected when enough room exists", () => {
  assert.deepEqual(gap([], 1, 10, 2), { startTime: 1, duration: 2 });
  assert.equal(gap([], 9, 10, 2), null);
});

console.log(`\n${passed} multi-clip layout tests passed.`);
