// Run with: node scripts/test-animation-viewer-rows.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../src/views/AnimationViewer/animationRows.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: filename,
});
const loaded = new Module(filename, module);
loaded._compile(compiled.outputText, filename);
const { buildAnimationRows } = loaded.exports;

const entry = (key, type = "single", count = type === "single" ? 1 : 3, category = 1) => ({
  key,
  skill: {
    type,
    category,
    nameI18nKey: `animationViewer.skills.${key}`,
    parts: Array.from({ length: count }, (_, index) => ({
      type: index === 1 ? "continuous" : "single",
      nameI18nKey: `animationViewer.parts.${key}_${index}`,
      path: `video/${key}/${index}.mp4`,
      duration: index + 0.5,
    })),
  },
});
const group = (id, skills) => ({
  category: { id, nameI18nKey: `animationViewer.category.${id}` },
  skills,
  partCount: skills.reduce((count, item) => count + item.skill.parts.length, 0),
});
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const keys = (rows) => rows.map((row) => row.skills.map((item) => item.key));
const sequence = (rows) => rows.flatMap((row) => row.skills.map((item) => item.key));

// These boundary expectations follow the existing viewport CSS breakpoints.
for (const [width, singlesPerRow, combosPerRow] of [
  [1800, 6, 3], [1500, 6, 3], [1499, 4, 2], [951, 4, 2],
  [950, 3, 1], [601, 3, 1], [600, 2, 1], [320, 2, 1],
]) {
  const singles = Array.from({ length: 13 }, (_, index) => entry(`single${index}`));
  const singleRows = buildAnimationRows([group(1, singles)], width);
  assert.equal(singleRows.length, Math.ceil(singles.length / singlesPerRow), `${width}px single row count`);
  assert.deepEqual(singleRows.map((row) => row.skills.length), [
    ...Array(Math.floor(singles.length / singlesPerRow)).fill(singlesPerRow),
    ...(singles.length % singlesPerRow ? [singles.length % singlesPerRow] : []),
  ], `${width}px keeps the existing single-card columns`);
  assert.deepEqual(sequence(singleRows), singles.map((item) => item.key));

  const combos = Array.from({ length: 7 }, (_, index) => entry(`combo${index}`, "combo"));
  const comboRows = buildAnimationRows([group(1, combos)], width);
  assert.equal(comboRows.length, Math.ceil(combos.length / combosPerRow), `${width}px combo row count`);
  assert.ok(comboRows.every((row) => row.skills.length <= combosPerRow));
  assert.deepEqual(sequence(comboRows), combos.map((item) => item.key));
  assert.ok(comboRows.flatMap((row) => row.skills).every((item) => item.skill.parts.length === 3),
    "A combination remains a complete skill rather than splitting into independent parts");
}

const mixed = freeze([group(1, [
  entry("a"), entry("b", "combo"), entry("c"), entry("d", "combo"),
  entry("e"), entry("f"), entry("wide", "combo", 5), entry("g"),
])]);
const mixedSnapshot = JSON.stringify(mixed);
assert.deepEqual(keys(buildAnimationRows(mixed, 1600)), [
  ["a", "b", "c", "d"], ["e", "f"], ["wide"], ["g"],
]);
assert.deepEqual(keys(buildAnimationRows(mixed, 1200)), [
  ["a", "b", "c"], ["d", "e", "f"], ["wide"], ["g"],
]);
for (const width of [800, 320]) {
  assert.deepEqual(keys(buildAnimationRows(mixed, width)), [
    ["a"], ["b"], ["c"], ["d"], ["e", "f"], ["wide"], ["g"],
  ]);
}
assert.equal(JSON.stringify(mixed), mixedSnapshot, "Row building never changes the source groups or skills");

assert.deepEqual(keys(buildAnimationRows([group(1, [
  entry("first"), entry("middle", "combo"), entry("next", "combo"), entry("last"),
])], 1200)), [["first", "middle"], ["next", "last"]],
"Preserve CSS row auto-placement: later small cards must not backfill an earlier row's gap");

for (const width of [1800, 1200, 800, 320]) {
  assert.deepEqual(keys(buildAnimationRows([group(1, [
    entry("before"), entry("fourParts", "combo", 4), entry("after"),
  ])], width)), [["before"], ["fourParts"], ["after"]],
  `${width}px: more than three parts always starts and occupies a full row`);
}

const categories = freeze([
  group(1, [entry("sameKey", "single", 1, 1)]),
  group(2, []),
  group(3, [entry("sameKey", "single", 1, 3), entry("another", "combo", 4, 3)]),
]);
const categoryRows = buildAnimationRows(categories, 1800);
assert.deepEqual(categoryRows.map((row) => row.category.id), [1, 3, 3], "Empty categories produce no rows");
assert.deepEqual(categoryRows.map((row) => [row.isFirst, row.isLast]), [
  [true, true], [true, false], [false, true],
], "The first and last row flags preserve the category outline and spacing");
assert.equal(new Set(categoryRows.map((row) => row.id)).size, categoryRows.length,
  "A row key includes its category, even when category-local skill keys overlap");
assert.ok(categoryRows.every((row) => row.skills.every((item) => item.skill.category === row.category.id)),
  "A rendered row never combines skills from different categories");
assert.deepEqual(sequence(categoryRows), ["sameKey", "sameKey", "another"]);
assert.deepEqual(buildAnimationRows([], 1200), []);
assert.deepEqual(buildAnimationRows([group(1, [])], 1200), []);

const original = [group(1, [entry("left"), entry("right")]), group(2, [entry("other", "combo", 2, 2)])];
const renamed = JSON.parse(JSON.stringify(original));
for (const item of renamed) {
  item.category.nameI18nKey += "_translated";
  for (const { skill } of item.skills) {
    skill.nameI18nKey += "_translated";
    for (const part of skill.parts) {
      part.nameI18nKey += "_translated";
      part.duration += 100;
    }
  }
}
assert.deepEqual(buildAnimationRows(original, 1200).map((row) => row.id),
  buildAnimationRows(renamed, 1200).map((row) => row.id),
  "Translations and displayed actual durations do not recreate otherwise unchanged virtual rows");
assert.deepEqual(buildAnimationRows(original, 1200).map((row) => row.id),
  buildAnimationRows(original, 1200).map((row) => row.id), "Identical input produces deterministic row keys");

console.log("PASS AnimationViewer responsive virtual rows, mixed grid order, complete combination groups, full-width multi-part skills, category outlines, stable keys, empty groups, and input preservation");
