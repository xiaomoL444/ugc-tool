/* Run: node scripts/test-client-ui-keyframe-model.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const originalTsExtension = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);

try {
  const editor = path.resolve(__dirname, "../src/views/ClientUIAnimationEditor");
  const model = require(path.join(editor, "keyframeTimeline.ts"));
  const { applyTweenEase, tweenEaseOptions } = require(path.join(editor, "tweenRegistry.ts"));
  const { createControlProperties } = require(path.join(editor, "controlRegistry.ts"));
  const { sortKeyframes, resolveKeyframeTrack, evaluateKeyframeTrack, upsertKeyframe,
    normalizeKeyframeTracks, migrateTweenClipsToKeyframes, compileKeyframesToTweenClips, KEYFRAME_TIME_EPSILON } = model;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const near = (actual, expected, message = "value") => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
  let serial = 0;
  const key = (time, value, extras = {}) => ({ id: `key${++serial}`, time, value, easeType: "Linear", interpolation: "tween", ...extras });
  const lane = (keys, extras = {}) => ({ id: `lane${++serial}`, nodeId: "root", fieldKey: "anchoredPositionX", keyframes: keys, ...extras });
  const clip = (startTime, initialValue, endValue, extras = {}) => ({ id: `clip${++serial}`, nodeId: "root", fieldKey: "anchoredPositionX",
    startTime, duration: 1, initialValue, endValue, easeType: "Linear", ...extras });
  const nodes = [
    { id: "root", type: "container", name: "根", parentId: null, properties: createControlProperties("container") },
    { id: "image", type: "image", name: "图片", parentId: "root", properties: createControlProperties("image") },
    { id: "text", type: "text", name: "文本", parentId: "image", properties: createControlProperties("text") },
  ];
  let passed = 0;
  function test(name, check) { check(); passed += 1; console.log(`PASS ${name}`); }

  test("Sort is stable and never mutates the caller's keyframes", () => {
    const a = key(2, 1), b = key(1, 2), c = key(2, 3);
    const keys = [a, b, c];
    assert.deepEqual(sortKeyframes(keys), [b, a, c]);
    assert.deepEqual(keys, [a, b, c]);
    assert.equal(KEYFRAME_TIME_EPSILON, 0.000001);
  });

  test("Empty, lone and final keys hold real values without a fabricated transition", () => {
    assert.equal(evaluateKeyframeTrack(lane([]), 10, 100), 100);
    const track = lane([key(2, 40)]);
    for (const time of [-1, 0, 1.99, 2, 2.00001, 20, Infinity]) assert.equal(evaluateKeyframeTrack(track, time, 100), 40);
    const pair = lane([key(0, 10), key(1, 20)]);
    assert.equal(evaluateKeyframeTrack(pair, 1, 100), 20);
    assert.equal(evaluateKeyframeTrack(pair, 10, 100), 20);
  });

  test("The current key, not the destination key, owns easing", () => {
    const track = lane([key(0, 0, { easeType: "InQuad" }), key(1, 100, { easeType: "OutQuad" })]);
    assert.equal(evaluateKeyframeTrack(track, 0.5, 0), 25);
    for (const { value: easeType } of tweenEaseOptions) {
      track.keyframes[0].easeType = easeType;
      near(evaluateKeyframeTrack(track, 0.37, 0), applyTweenEase(easeType, 0.37) * 100, easeType);
    }
  });

  test("Step holds until the exact next time and switches without interpolation", () => {
    const track = lane([key(0, 10, { interpolation: "step" }), key(2, 90)]);
    assert.equal(evaluateKeyframeTrack(track, 1.9999999, 0), 10);
    assert.equal(evaluateKeyframeTrack(track, 2, 0), 90);
    assert.equal(evaluateKeyframeTrack(track, 4, 0), 90);
  });

  test("Relative values accumulate from the previous right value and expose their baselines", () => {
    const track = lane([key(2, -90, { relative: true }), key(0, 0, { relative: true }), key(1, 40, { relative: true })]);
    const before = clone(track);
    const resolved = resolveKeyframeTrack(track, 100);
    assert.deepEqual(resolved.map((item) => item.value), [100, 140, 50]);
    assert.deepEqual(resolved.map((item) => item.baseline), [100, 100, 140]);
    for (const time of [0, 0.5, 1, 1.5, 2, 1, 0, 2]) {
      near(evaluateKeyframeTrack(track, time, 100), time <= 1 ? 100 + 40 * time : 140 - 90 * (time - 1));
    }
    assert.deepEqual(track, before);
    assert.deepEqual(resolveKeyframeTrack(track, 200).map((item) => item.value), [200, 240, 150]);
  });

  test("Absolute keys reset the chain while position, size and scale retain additive deltas", () => {
    for (const fieldKey of ["anchoredPositionX", "anchoredPositionY", "sizeDeltaX", "sizeDeltaY", "localScaleX", "localScaleY", "localScaleZ"]) {
      const track = lane([key(0, 2, { relative: true }), key(1, 10), key(2, -4, { relative: true })], { fieldKey });
      assert.deepEqual(resolveKeyframeTrack(track, -5).map((item) => item.value), [-3, 10, 6]);
    }
  });

  test("Incoming values preserve a discontinuity with only one key at the boundary", () => {
    const track = lane([key(0, 10), key(1, 200, { incomingValue: 40 }), key(2, 210)]);
    near(evaluateKeyframeTrack(track, 0.5, 0), 25);
    near(evaluateKeyframeTrack(track, 1 - 1e-8, 0), 40 - 30e-8);
    assert.equal(evaluateKeyframeTrack(track, 1, 0), 200);
    assert.equal(evaluateKeyframeTrack(track, 1.5, 0), 205);
  });

  test("Incoming and outgoing relative values use the same prior-key baseline", () => {
    const track = lane([key(0, 10, { relative: true }), key(1, 35, { relative: true, incomingValue: 20, incomingRelative: true }), key(2, -5, { relative: true })]);
    const resolved = resolveKeyframeTrack(track, 100);
    assert.deepEqual(resolved.map((item) => item.value), [110, 145, 140]);
    assert.deepEqual(resolved.map((item) => item.incomingValue), [110, 130, 140]);
    assert.equal(evaluateKeyframeTrack(track, 0.5, 100), 120);
    assert.equal(evaluateKeyframeTrack(track, 1, 100), 145);
  });

  test("Color interpolation preserves fractional alpha, clamps overshoot, and owns its objects", () => {
    const first = { r: 0, g: 20, b: 255, a: 0 }, last = { r: 100, g: 40, b: 55, a: 1 };
    const track = lane([key(0, first), key(1, last)], { nodeId: "image", fieldKey: "imageColor" });
    assert.deepEqual(evaluateKeyframeTrack(track, 0.5, null), { r: 50, g: 30, b: 155, a: 0.5 });
    const held = evaluateKeyframeTrack(track, 5, null); held.a = 0;
    assert.equal(last.a, 1);
    track.keyframes[0].easeType = "OutBack";
    const overshoot = evaluateKeyframeTrack(track, 0.7, null);
    assert.equal(overshoot.a, 1);
    assert.ok(overshoot.r > 100 && overshoot.r <= 255);
    assert.deepEqual(first, { r: 0, g: 20, b: 255, a: 0 });
  });

  test("Null placeholders remain editable and invalid relative resolutions never become NaN", () => {
    const track = lane([key(0, null), key(1, 5, { relative: true })]);
    assert.equal(evaluateKeyframeTrack(track, 0, 100), null);
    assert.equal(evaluateKeyframeTrack(track, 1, 100), 105);
    assert.equal(resolveKeyframeTrack(lane([key(0, 5, { relative: true })]), null)[0].value, null);
    assert.equal(resolveKeyframeTrack(lane([key(0, Number.MAX_VALUE, { relative: true })]), Number.MAX_VALUE)[0].value, null);
    assert.equal(resolveKeyframeTrack(lane([key(0, 5, { relative: true })], { fieldKey: "fontSize" }), 10)[0].value, null);
  });

  test("Upsert uses epsilon equality, retains the original ID and left limit, and copies colors", () => {
    const original = key(1, { r: 0, g: 0, b: 0, a: 1 }, { incomingValue: { r: 10, g: 10, b: 10, a: 0 } });
    const track = lane([original], { fieldKey: "imageColor", nodeId: "image" });
    const updated = upsertKeyframe(track, key(1 + KEYFRAME_TIME_EPSILON / 2, { r: 100, g: 0, b: 0, a: 1 }));
    assert.equal(updated.keyframes.length, 1);
    assert.equal(updated.keyframes[0].id, original.id);
    assert.equal(updated.keyframes[0].time, 1);
    assert.deepEqual(updated.keyframes[0].incomingValue, original.incomingValue);
    updated.keyframes[0].incomingValue.a = 1;
    assert.equal(original.incomingValue.a, 0);
    assert.equal(original.value.r, 0);
    const inserted = upsertKeyframe(lane([key(2, 10)]), key(0, 5));
    assert.deepEqual(inserted.keyframes.map((item) => item.time), [0, 2]);
    const moved = upsertKeyframe(inserted, { ...inserted.keyframes[0], time: 1 });
    assert.deepEqual(moved.keyframes.map((item) => item.time), [1, 2]);
    assert.throws(() => upsertKeyframe(moved, { ...moved.keyframes[0], time: 2 }), /已有/);
  });

  test("Normalization clones valid tracks and rejects duplicate IDs, lanes and epsilon times", () => {
    const raw = [lane([key(2, 20), key(0, 0)])];
    const normalized = normalizeKeyframeTracks(raw, nodes);
    assert.deepEqual(normalized[0].keyframes.map((item) => item.time), [0, 2]);
    normalized[0].keyframes[0].value = 99;
    assert.equal(raw[0].keyframes[1].value, 0);
    assert.throws(() => normalizeKeyframeTracks([raw[0], raw[0]], nodes), /ID.*重复/);
    assert.throws(() => normalizeKeyframeTracks([raw[0], { ...raw[0], id: "other" }], nodes), /轨道重复/);
    assert.throws(() => normalizeKeyframeTracks([lane([key(0, 0), key(KEYFRAME_TIME_EPSILON, 1)])], nodes), /重复关键帧/);
    const duplicate = key(0, 0);
    assert.throws(() => normalizeKeyframeTracks([lane([duplicate]), lane([{ ...duplicate }], { fieldKey: "sizeDeltaX" })], nodes), /ID.*重复/);
  });

  test("Normalization rejects unsupported fields, missing nodes, invalid values and flags explicitly", () => {
    const valid = lane([key(0, 1)]);
    assert.throws(() => normalizeKeyframeTracks(null, nodes), /数组/);
    assert.throws(() => normalizeKeyframeTracks([null], nodes), /格式/);
    assert.throws(() => normalizeKeyframeTracks([{ ...valid, nodeId: "missing" }], nodes), /找不到控件/);
    assert.throws(() => normalizeKeyframeTracks([{ ...valid, fieldKey: "notTweenable" }], nodes), /不支持/);
    for (const changes of [{ id: "" }, { time: -1 }, { time: NaN }, { time: Infinity }, { easeType: "unknown" },
      { interpolation: "bezier" }, { value: Infinity }, { value: undefined }, { value: "1" }, { relative: "true" }, { incomingRelative: true }]) {
      assert.throws(() => normalizeKeyframeTracks([{ ...valid, keyframes: [{ ...valid.keyframes[0], ...changes }] }], nodes));
    }
    assert.throws(() => normalizeKeyframeTracks([lane([key(0, 1, { relative: true })], { nodeId: "text", fieldKey: "fontSize" })], nodes), /不支持增量/);
    assert.throws(() => normalizeKeyframeTracks([lane([key(0, 300)], { fieldKey: "groupAlpha" })], nodes), /0–255/);
    const colorLane = lane([key(0, { r: 255, g: 0, b: 0, a: 2 })], { nodeId: "image", fieldKey: "imageColor" });
    assert.throws(() => normalizeKeyframeTracks([colorLane], nodes), /ColorRGBA/);
    assert.doesNotThrow(() => normalizeKeyframeTracks([lane([key(0, null)])], nodes));
  });

  test("Normalization prevents group-alpha and descendant color lanes from competing", () => {
    const group = lane([key(0, 255)], { fieldKey: "groupAlpha" });
    const color = lane([key(0, { r: 1, g: 2, b: 3, a: 1 })], { nodeId: "text", fieldKey: "fontColor" });
    assert.throws(() => normalizeKeyframeTracks([group, color], nodes), /同一颜色/);
    assert.throws(() => normalizeKeyframeTracks([color, group], nodes), /同一颜色/);
    assert.doesNotThrow(() => normalizeKeyframeTracks([group, lane([key(0, 5)])], nodes));
  });

  test("Legacy gap migration holds old ends and applies the next start only at its key", () => {
    const clips = [clip(3, 200, 210), clip(1, 10, 40)];
    const before = clone(clips);
    const track = migrateTweenClipsToKeyframes(clips)[0];
    assert.deepEqual(track.keyframes.map((item) => [item.time, item.interpolation]), [[1, "tween"], [2, "step"], [3, "tween"], [4, "step"]]);
    for (const [time, expected] of [[0, 10], [1.5, 25], [2, 40], [2.5, 40], [3, 200], [3.5, 205], [4, 210], [6, 210]]) {
      near(evaluateKeyframeTrack(track, time, 500), expected);
    }
    assert.deepEqual(clips, before);
    assert.doesNotThrow(() => normalizeKeyframeTracks([track], nodes));
  });

  test("Legacy touching absolute clips retain both boundary limits at one timestamp", () => {
    const track = migrateTweenClipsToKeyframes([clip(0, 10, 40), clip(1, 200, 210)])[0];
    assert.equal(track.keyframes.length, 3);
    assert.equal(track.keyframes[1].value, 200);
    assert.equal(track.keyframes[1].incomingValue, 40);
    near(evaluateKeyframeTrack(track, 0.5, 0), 25);
    assert.equal(evaluateKeyframeTrack(track, 1, 0), 200);
    assert.equal(evaluateKeyframeTrack(track, 1.5, 0), 205);
  });

  test("Legacy relative Clip endpoints become adjacent-key increments, not double-applied offsets", () => {
    const track = migrateTweenClipsToKeyframes([clip(0, -20, 40, { relative: true }), clip(3, -10, -70, { relative: true })])[0];
    assert.deepEqual(track.keyframes.map((item) => item.value), [-20, 60, -10, -60]);
    assert.deepEqual(resolveKeyframeTrack(track, 200).map((item) => item.value), [180, 240, 230, 170]);
    assert.equal(evaluateKeyframeTrack(track, 2, 200), 240);
    assert.equal(evaluateKeyframeTrack(track, 3, 200), 230);
    assert.equal(evaluateKeyframeTrack(track, 3.5, 200), 200);
    assert.deepEqual(resolveKeyframeTrack(track, 500).map((item) => item.value), [480, 540, 530, 470]);
  });

  test("Relative/absolute combinations preserve discontinuous touching boundaries at any setup value", () => {
    const cases = [
      [clip(0, 5, 20, { relative: true }), clip(1, 7, -10, { relative: true })],
      [clip(0, 5, 20), clip(1, 7, -10, { relative: true })],
      [clip(0, 5, 20, { relative: true }), clip(1, 70, 90)],
      [clip(0, 5, 20), clip(1, 70, 90)],
    ];
    for (const clips of cases) for (const base of [-100, 0, 200]) {
      const track = migrateTweenClipsToKeyframes(clips)[0];
      const firstFrom = clips[0].initialValue + (clips[0].relative ? base : 0);
      const firstEnd = clips[0].endValue + (clips[0].relative ? base : 0);
      const secondFrom = clips[1].initialValue + (clips[1].relative ? firstEnd : 0);
      const secondEnd = clips[1].endValue + (clips[1].relative ? firstEnd : 0);
      near(evaluateKeyframeTrack(track, 0.5, base), (firstFrom + firstEnd) / 2);
      near(evaluateKeyframeTrack(track, 1, base), secondFrom);
      near(evaluateKeyframeTrack(track, 1.5, base), (secondFrom + secondEnd) / 2);
      near(evaluateKeyframeTrack(track, 3, base), secondEnd);
      assert.doesNotThrow(() => normalizeKeyframeTracks([track], nodes));
    }
  });

  test("Migrated colors and group-alpha preserve source easing and discontinuities", () => {
    const color = (v) => ({ r: v, g: v, b: v, a: v / 255 });
    const colors = migrateTweenClipsToKeyframes([clip(0, color(0), color(100), { nodeId: "image", fieldKey: "imageColor", easeType: "InQuad" }),
      clip(1, color(200), color(250), { nodeId: "image", fieldKey: "imageColor" })])[0];
    near(evaluateKeyframeTrack(colors, 0.5, null).r, 25);
    assert.equal(evaluateKeyframeTrack(colors, 1, null).r, 200);
    const alpha = migrateTweenClipsToKeyframes([clip(0.25, 255, 0, { fieldKey: "groupAlpha" }), clip(2, 128, 255, { fieldKey: "groupAlpha" })])[0];
    assert.equal(evaluateKeyframeTrack(alpha, 0, 255), 255);
    assert.equal(evaluateKeyframeTrack(alpha, 1.5, 255), 0);
    assert.equal(evaluateKeyframeTrack(alpha, 2, 255), 128);
    assert.doesNotThrow(() => normalizeKeyframeTracks([colors], nodes));
  });

  test("Legacy migration is deterministic, separates lanes and repairs reused legacy IDs", () => {
    const clips = [clip(0, 0, 1, { id: "same" }), clip(0, 10, 20, { id: "same", fieldKey: "sizeDeltaX" })];
    const migrated = migrateTweenClipsToKeyframes(clips);
    assert.deepEqual(migrated, migrateTweenClipsToKeyframes(clips));
    assert.equal(migrated.length, 2);
    const ids = migrated.flatMap((track) => [track.id, ...track.keyframes.map((item) => item.id)]);
    assert.equal(new Set(ids).size, ids.length);
    assert.doesNotThrow(() => normalizeKeyframeTracks(migrated, nodes));
    assert.deepEqual(migrateTweenClipsToKeyframes([]), []);
  });

  test("Malformed legacy Clips fail explicitly instead of losing animation data silently", () => {
    for (const changes of [{ duration: 0 }, { startTime: -1 }, { endValue: Infinity }, { easeType: "Invalid" }]) {
      assert.throws(() => migrateTweenClipsToKeyframes([clip(0, 0, 1, changes)]));
    }
    assert.throws(() => migrateTweenClipsToKeyframes([clip(0, 0, 1), clip(0.5, 1, 2)]), /重叠/);
    assert.throws(() => migrateTweenClipsToKeyframes([clip(0, 0, 1, { fieldKey: "fontSize", relative: true })]), /不支持/);
    assert.throws(() => migrateTweenClipsToKeyframes([clip(0, -Number.MAX_VALUE, Number.MAX_VALUE, { relative: true })]), /溢出/);
  });

  test("Legacy unset endpoints survive migration and normalization as null key placeholders", () => {
    for (const relative of [false, true]) {
      for (const values of [[null, null], [null, 40], [10, null]]) {
        const migrated = migrateTweenClipsToKeyframes([clip(0, values[0], values[1], { relative })]);
        assert.deepEqual(migrated[0].keyframes.map((item) => item.value), values);
        assert.doesNotThrow(() => normalizeKeyframeTracks(migrated, nodes));
        assert.equal(evaluateKeyframeTrack(migrated[0], values[0] === null ? 0 : 1, 100), null);
      }
    }
    const touching = migrateTweenClipsToKeyframes([clip(0, 10, null), clip(1, 5, 20, { relative: true })])[0];
    assert.equal(touching.keyframes[1].incomingValue, null);
    assert.equal(touching.keyframes[1].value, 5);
    assert.equal(touching.keyframes[1].relative, true);
    assert.doesNotThrow(() => normalizeKeyframeTracks([touching], nodes));
  });

  test("Legacy adapter emits real segments and zero-duration constant endpoint records", () => {
    const single = lane([key(2, 40)]);
    const points = compileKeyframesToTweenClips([single], () => 100);
    assert.equal(points.length, 1);
    assert.equal(points[0].duration, 0);
    assert.equal(points[0].startTime, 2);
    assert.equal(points[0].initialValue, 40);
    assert.equal(points[0].endValue, 40);
    const track = lane([key(0, 0, { relative: true, interpolation: "step" }), key(1, 40, { relative: true }), key(2, -90, { relative: true })]);
    const compiled = compileKeyframesToTweenClips([track], () => 100);
    assert.deepEqual(compiled.map((item) => [item.startTime, item.duration, item.initialValue, item.endValue]), [[0, 1, 100, 100], [1, 1, 140, 50], [2, 0, 50, 50]]);
    assert.ok(compiled.every((item) => item.relative === false));
    const discontinuous = lane([key(0, 10), key(1, 200, { incomingValue: 40 }), key(2, 210)]);
    assert.deepEqual(compileKeyframesToTweenClips([discontinuous], () => 0).map((item) => [item.initialValue, item.endValue]), [[10, 40], [200, 210], [210, 210]]);
  });

  console.log(`\n${passed} keyframe model tests passed.`);
} finally {
  if (originalTsExtension) Module._extensions[".ts"] = originalTsExtension;
  else delete Module._extensions[".ts"];
}
