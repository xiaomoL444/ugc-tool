// Run with: node scripts/test-animation-viewer-data.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../src/views/AnimationViewer/animationData.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: filename,
});
const loaded = new Module(filename, module);
loaded._compile(compiled.outputText, filename);
const { normalizeAnimationData } = loaded.exports;

const category = [1, 2, 3, 4, 5].map((id) => ({ id, nameI18nKey: `animationViewer.category.${id}` }));
const part = (name, extras = {}) => ({
  type: "single", path: `${name}.mp4`, ...extras,
});
const single = (name, extras = {}) => ({
  type: "single", category: 1, nameI18nKey: `animationViewer.skills.${name}`,
  parts: [part(name)], ...extras,
});
const stagedCombo = (name, stages) => ({
  type: "combo", category: 2, nameI18nKey: `animationViewer.skills.${name}`,
  parts: stages.map((stage) => part(`${name}/${stage}`, {
    type: stage === "loop" ? "continuous" : "single",
    nameI18nKey: `animationViewer.parts.${name}_${stage}`,
  })),
});
const combo = {
  type: "combo", category: 5, nameI18nKey: "animationViewer.skills.swordCombo",
  parts: [1, 2].map((number) => part(`sword-combo/${number}`, {
    nameI18nKey: `animationViewer.parts.swordAttack${number}`,
  })),
};
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const input = freeze({ data: [
  single("slash", { order: 2, giVersion: "6.1" }),
  single("sweep", { order: 1, parts: [part("单段/横扫", { duration: 2.5 })] }),
  stagedCombo("channelA", ["start", "loop", "end"]),
  stagedCombo("channelB", ["loop"]),
  combo,
  { ...combo, nameI18nKey: "animationViewer.skills.mixedCombo", parts: [
    combo.parts[0],
    part("mixed/charge", { nameI18nKey: "animationViewer.parts.charge", duration: 0.4 }),
    part("mixed/loop-1", { type: "continuous", nameI18nKey: "animationViewer.parts.firstLoop", duration: 4.2 }),
    part("mixed/loop-2", { type: "continuous", nameI18nKey: "animationViewer.parts.secondLoop" }),
    combo.parts[1],
  ] },
  single("sustain", { parts: [part("sustain", { type: "continuous" })] }),
], category });
const parsed = normalizeAnimationData(input);
assert.deepEqual(parsed, input, "Preserve source order and explicit parts without needing skill IDs");
assert.notEqual(parsed, input);
assert.notEqual(parsed.data[0].parts, input.data[0].parts, "Normalization never mutates the downloaded index");
assert.ok(parsed.data.every((skill) => !Object.hasOwn(skill, "id")), "Skill grouping is not based on invented IDs");
assert.ok(parsed.data.every((skill) => !Object.hasOwn(skill, "duration")), "Actual duration belongs only to a part");
assert.equal(parsed.data[1].parts[0].duration, 2.5, "A part preserves its configured actual duration in seconds");
assert.equal(parsed.data[0].giVersion, "6.1", "A configured version belongs to the whole skill");
assert.equal(Object.hasOwn(parsed.data[1], "giVersion"), false, "Missing versions are not invented");
assert.equal(Object.hasOwn(parsed.data[0].parts[0], "duration"), false, "Missing actual durations are not inferred");
assert.equal(parsed.data[5].parts[2].duration, 4.2, "Continuous parts preserve their actual duration too");
assert.equal(Object.hasOwn(parsed.data[5].parts[3], "duration"), false, "Continuous does not imply a known duration");
assert.deepEqual(parsed.data[2].parts.map(({ type }) => type), ["single", "continuous", "single"]);
assert.equal(parsed.data[3].parts.length, 1, "Missing combination parts are not fabricated");
assert.deepEqual(parsed.data[5].parts.map(({ nameI18nKey }) => nameI18nKey), [
  "animationViewer.parts.swordAttack1", "animationViewer.parts.charge", "animationViewer.parts.firstLoop",
  "animationViewer.parts.secondLoop", "animationViewer.parts.swordAttack2",
], "Named parts retain array order, including multiple continuous parts");
assert.equal(parsed.data[6].type, "single");
assert.equal(parsed.data[6].parts[0].type, "continuous", "Skill structure and individual part behavior are independent");
assert.deepEqual([...new Set(parsed.data.map(({ type }) => type))], ["single", "combo"], "Only two skill structures are needed");
assert.deepEqual(normalizeAnimationData(parsed), parsed, "Normalized indexes round trip");
assert.deepEqual(normalizeAnimationData({ data: [], category: [] }), { data: [], category: [] });
assert.deepEqual(normalizeAnimationData({ data: [], category }).category, category, "Categories may exist before any media is published");
assert.equal(normalizeAnimationData({ data: [single("trimmedVersion", { giVersion: " 6.2 " })], category }).data[0].giVersion,
  "6.2", "Version filters use trimmed version strings");
for (const giVersion of [undefined, "", " \t\n "]) {
  const unversioned = normalizeAnimationData({ data: [single("unversioned", { giVersion })], category }).data[0];
  assert.equal(Object.hasOwn(unversioned, "giVersion"), false, "Empty versions normalize to an omitted optional field");
}

for (const invalid of [null, undefined, "{}", [], {}, { data: [] }, { data: {}, category }, { data: [], category: {} }]) {
  assert.throws(() => normalizeAnimationData(invalid), /Invalid AnimationViewer/);
}
const rejects = (skill) => assert.throws(() => normalizeAnimationData({ data: [skill], category }), /Invalid AnimationViewer/);
for (const value of [undefined, "unknown", "continuous", null, 1, { toString: () => "single" }]) rejects(single("slash", { type: value }));
for (const value of [undefined, "unknown", "combo", "start", "loop", "end", null, 1, { toString: () => "single" }]) {
  rejects(single("slash", { parts: [part("slash", { type: value })] }));
  rejects({ ...combo, parts: [part("slash", { type: value, nameI18nKey: "animationViewer.parts.slash" })] });
}
rejects(single("slash", { parts: [{ path: "slash.mp4" }] }));
for (const value of [undefined, 9, "1", NaN]) rejects(single("slash", { category: value }));
for (const parts of [undefined, null, [], {}, [part("a"), part("b")]]) rejects(single("slash", { parts }));
for (const order of ["1", null, NaN, Infinity]) rejects(single("slash", { order }));
for (const giVersion of [null, 6.2, false, [], {}, { toString: () => "6.2" }]) rejects(single("slash", { giVersion }));
for (const duration of [undefined, 0, 1.25, -1, "1", null, NaN, Infinity, -Infinity]) {
  rejects(single("slash", { duration }));
  rejects({ ...combo, duration });
}
for (const duration of [0, -1, "1", null, NaN, Infinity, -Infinity]) {
  rejects(single("slash", { parts: [part("slash", { duration })] }));
  rejects({ ...combo, parts: [part("sustain", { type: "continuous", duration, nameI18nKey: "animationViewer.parts.sustain" })] });
}
for (const phase of [undefined, "single", "start", "loop", "end", "action", null]) {
  rejects(single("slash", { parts: [part("slash", { phase })] }));
  rejects({ ...combo, parts: [part("slash", { phase, nameI18nKey: "animationViewer.parts.slash" })] });
}
for (const nameI18nKey of [undefined, "slash", "other.skills.slash", "animationViewer.", "animationViewer.skills.__proto__", "animationViewer.constructor.slash"]) {
  rejects(single("slash", { nameI18nKey }));
  rejects(single("slash", { parts: [part("slash", { nameI18nKey: nameI18nKey === undefined ? null : nameI18nKey })] }));
}
for (const mediaPath of [undefined, "", "/slash.mp4", "//host/slash.mp4", "https://host/slash.mp4", "C:/slash.mp4", "folder\\slash.mp4", "../slash.mp4", "a/../slash.mp4", "a/./slash.mp4", "a//slash.mp4", "a/slash.mp4/", "%2e%2e/slash.mp4", "slash.mp4?x=1", "slash.mp4#x", " slash.mp4", "a/ slash.mp4", "slash\n.mp4"]) {
  rejects(single("slash", { parts: [part("slash", { path: mediaPath })] }));
}
rejects({ ...combo, parts: [part("attack")] });
rejects({ ...combo, parts: [part("sustain", { type: "continuous" })] });
assert.equal(normalizeAnimationData({ data: [single("unnamedPart")], category }).data[0].parts[0].nameI18nKey, undefined,
  "A single skill may use its parent name when the one part has no name");
assert.equal(normalizeAnimationData({ data: [single("namedPart", { parts: [part("named", { nameI18nKey: "animationViewer.parts.custom" })] })], category })
  .data[0].parts[0].nameI18nKey, "animationViewer.parts.custom", "A single part may override its name");
assert.throws(() => normalizeAnimationData({ data: [], category: [...category, category[0]] }), /duplicate category ID/);
for (const id of [undefined, "1", 1.5, NaN, Infinity]) {
  assert.throws(() => normalizeAnimationData({ data: [], category: [{ id, nameI18nKey: "animationViewer.category.test" }] }));
}
assert.throws(() => normalizeAnimationData({ data: [], category: [{ id: 1, nameI18nKey: "other.category.1" }] }));

console.log("PASS AnimationViewer single/combo structures, independent required single/continuous part types, optional actual part durations and skill versions, explicitly named combo parts, rejected legacy skill durations/phases, empty indexes, input preservation, and invalid schema/media paths");
