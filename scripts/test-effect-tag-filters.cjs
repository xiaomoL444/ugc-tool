/* Run with: node scripts/test-effect-tag-filters.cjs [optional-data-file.json] */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../src/views/EffectPlayer/tagFilters.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: filename,
});
const loaded = new Module(filename, module);
loaded._compile(compiled.outputText, filename);
const { buildEffectTagGroups, matchesEffectTagGroups, countEffectTags } = loaded.exports;

const tagData = Object.freeze({ 1: "火元素", 2: "水元素", 3: "烟尘", 4: "光柱", 5: "未分类" });
const category = Object.freeze({
  属性: Object.freeze([2, 1, 2]),
  类型: Object.freeze([3, 4, 1]),
});
const groups = buildEffectTagGroups(tagData, category);
assert.deepEqual(groups, [
  { id: "category:属性", name: "属性", tags: [{ id: 2, name: "水元素" }, { id: 1, name: "火元素" }] },
  { id: "category:类型", name: "类型", tags: [{ id: 3, name: "烟尘" }, { id: 4, name: "光柱" }] },
  { id: "uncategorized", name: "无分类", tags: [{ id: 5, name: "未分类" }] },
]);

const effect = (...tagList) => ({ tagList });
const match = (tags, selected) => matchesEffectTagGroups(effect(...tags), selected, groups);
assert.equal(match([], []), true, "No selection must include untagged effects");
assert.equal(match([1], [1, 2]), true, "Alternatives in one group use OR");
assert.equal(match([2], [1, 2]), true);
assert.equal(match([3], [1, 2]), false);
assert.equal(match([2, 4], [1, 2, 3, 4]), true, "Multiple groups use AND");
assert.equal(match([1], [1, 2, 3, 4]), false);
assert.equal(match([3], [1, 3]), false);
assert.equal(match([1, 3, 5], [1, 3, 5]), true, "Uncategorized tags form a selectable group");
assert.equal(match([1, 3], [1, 3, 5]), false);
assert.equal(match([1, 3], [1, 1, 3, 3]), true, "Repeated selections do not change matching");

assert.equal(match([1], [1, 99]), false, "Unknown selected IDs must not be ignored");
assert.equal(match([1, 99], [1, 99]), true);
assert.equal(match([99], [99, 100]), false, "Each unknown selection remains effective");
assert.equal(matchesEffectTagGroups(effect(99), [99], []), true);
assert.equal(matchesEffectTagGroups(effect(), [99], []), false);
assert.deepEqual(buildEffectTagGroups({ 1: "火元素" }, { 属性: [1, 99] })[0].tags, [
  { id: 1, name: "火元素" }, { id: 99, name: "标签 99" },
]);

for (const missingCategory of [undefined, null, {}]) {
  const unclassified = buildEffectTagGroups(tagData, missingCategory);
  assert.equal(unclassified.length, 1);
  assert.equal(unclassified[0].name, "无分类");
  assert.deepEqual(unclassified[0].tags.map(({ id }) => id), [1, 2, 3, 4, 5]);
  assert.equal(matchesEffectTagGroups(effect(1), [1, 2], unclassified), true);
  assert.equal(matchesEffectTagGroups(effect(3), [1, 2], unclassified), false);
}
assert.deepEqual(buildEffectTagGroups({}), []);
assert.deepEqual(buildEffectTagGroups({}, {}), []);
assert.deepEqual(buildEffectTagGroups({ invalid: "Invalid", 1: "Valid" }, { 属性: [NaN, 1, 1] }), [
  { id: "category:属性", name: "属性", tags: [{ id: 1, name: "Valid" }] },
]);

const counts = countEffectTags([
  effect(1, 1, 2, 3), effect(2, 4, 4), effect(3, 5, 99, 99), effect(),
], groups);
assert.deepEqual(Object.fromEntries(counts.tagCounts), { 1: 1, 2: 2, 3: 2, 4: 1, 5: 1, 99: 1 });
assert.deepEqual(Object.fromEntries(counts.groupCounts), {
  "category:属性": 2, "category:类型": 3, uncategorized: 1,
});
const emptyCounts = countEffectTags([], groups);
assert.ok([...emptyCounts.tagCounts.values(), ...emptyCounts.groupCounts.values()].every((n) => n === 0));

if (process.argv[2]) {
  const actual = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const actualGroups = buildEffectTagGroups(actual.TagData, actual.category);
  const actualItems = Object.values(actual.effectData);
  const actualCounts = countEffectTags(actualItems, actualGroups);
  assert.deepEqual(actualGroups.map(({ name }) => name), Object.keys(actual.category));
  assert.equal(new Set(actualGroups.flatMap(({ tags }) => tags.map(({ id }) => id))).size, Object.keys(actual.TagData).length);
  for (const group of actualGroups) {
    const ids = group.tags.map(({ id }) => id);
    const expected = actualItems.filter((item) => item.tagList.some((id) => ids.includes(id))).length;
    assert.equal(actualCounts.groupCounts.get(group.id), expected);
    assert.equal(actualItems.filter((item) => matchesEffectTagGroups(item, ids, actualGroups)).length, expected);
  }
  console.log(`PASS reference data: ${actualItems.length} effects, ${actualGroups.length} groups`);
}
console.log("PASS effect tag grouping, combination filters, uncategorized fallback, unknown tags, and unique counts");
