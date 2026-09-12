/* node scripts/test-effect-i18n-migration.cjs [prepared-directory] */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { convertEffectData } = require("./migrate-effect-i18n.cjs");
const table = (locale, translations) => ({ version: 1, namespace: "effectPlayer", locale, format: "text", translations });
const source = {
  revision: 7,
  effectData: { 2: { id: "2", title: "白色烟尘", name: "WhiteDustSource", tagList: [8], icon: "2.png", standPath: "2.mp4", duration: 1.37, isLoop: false } },
  TagData: { 8: "物理" }, category: { 属性: [8] },
};
const originals = structuredClone(source);
const catalogs = { "zh-cn": table("zh-CN", { "names.2": "用户中文译名" }), "en-us": table("en-US", { "names.2": "User supplied English" }) };
const { data, tables } = convertEffectData(source, catalogs, { "en-us": { "category.属性": "Attribute" } });
assert.deepEqual(source, originals, "Conversion never mutates its input");
assert.equal(data.effectData[2].title, "effectPlayer.names.2");
assert.equal(data.effectData[2].name, "effectPlayer.names.2");
assert.equal(data.effectData[2].sourceTitle, "白色烟尘");
assert.equal(data.effectData[2].sourceName, "WhiteDustSource");
assert.equal(data.TagData[8], "effectPlayer.tags.8");
assert.equal(data.sourceTagData[8], "物理");
assert.deepEqual(data.category, { "effectPlayer.category.1": [8] });
assert.deepEqual(data.sourceCategoryData, { 1: "属性" });
assert.equal(tables["en-us"].translations["names.2"], "User supplied English");
assert.equal(tables["zh-cn"].translations["names.2"], "用户中文译名");
assert.equal(tables["zh-cn"].translations["tags.8"], "物理");
assert.equal(tables["en-us"].translations["category.1"], "Attribute");
assert.deepEqual(convertEffectData(data, tables).data, data, "Repeated conversions do not add prefixes twice");
assert.deepEqual(convertEffectData(data, tables).tables, tables, "Repeated conversions preserve translations");
assert.equal(data.effectData[2].standPath, source.effectData[2].standPath);
assert.equal(data.revision, 7);
assert.deepEqual(catalogs["zh-cn"].translations, { "names.2": "用户中文译名" });
assert.throws(() => convertEffectData({ ...source, category: { 属性: [8], "effectPlayer.category.属性": [8] } }, catalogs), /collision/);

const reordered = convertEffectData({ ...data, sourceCategoryData: { 1: "属性", 2: "类型" }, category: { 类型: [25], 属性: [8], 新类别: [99] } }, tables);
assert.deepEqual(reordered.data.category, { "effectPlayer.category.2": [25], "effectPlayer.category.1": [8], "effectPlayer.category.3": [99] }, "Reordering categories preserves existing IDs and appends new ones");
const legacyTables = { "zh-cn": table("zh-CN", { "category.属性": "用户分类译文" }), "en-us": table("en-US", { "category.属性": "User category wording" }) };
const legacyConversion = convertEffectData(source, legacyTables);
assert.equal(legacyConversion.tables["en-us"].translations["category.1"], "User category wording");
assert.equal(legacyConversion.tables["zh-cn"].translations["category.1"], "用户分类译文");
assert.equal(legacyConversion.tables["zh-cn"].translations["category.属性"], undefined);
assert.deepEqual(legacyConversion.data.sourceCategoryData, { 1: "属性" }, "Metadata retains original names independently of translated labels");

if (process.argv[2]) {
  const dir = process.argv[2];
  const read = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const report = read(path.join(dir, "migration-report.json"));
  const before = read(path.join(report.sourceDir, "data.json"));
  const after = read(path.join(dir, "data.json"));
  assert.deepEqual(Object.keys(after.effectData), Object.keys(before.effectData));
  for (const [id, original] of Object.entries(before.effectData)) {
    const converted = after.effectData[id];
    const expected = { ...original, title: `effectPlayer.names.${id}`, sourceTitle: original.sourceTitle ?? original.title };
    if (original.name !== undefined) { expected.sourceName = original.sourceName ?? original.name; expected.name = expected.title; }
    assert.deepEqual(converted, expected, `Effect ${id} preserves every media/ID/filter field`);
  }
  assert.deepEqual(after.sourceTagData, before.sourceTagData ?? before.TagData);
  assert.deepEqual(after.TagData, Object.fromEntries(Object.keys(before.TagData).map((id) => [id, `effectPlayer.tags.${id}`])));
  for (const [key, ids] of Object.entries(before.category)) {
    const oldName = key.replace(/^effectPlayer\.category\./, "");
    const newId = /^\d+$/.test(oldName) ? oldName : Object.keys(after.sourceCategoryData).find((id) => after.sourceCategoryData[id] === oldName);
    assert.deepEqual(after.category[`effectPlayer.category.${newId}`], ids, `Preserve category membership: ${key}`);
  }
  for (const locale of ["zh-cn", "en-us"]) {
    const currentFile = path.join(report.sourceDir, "i18n", `${locale}.json`);
    const existing = read(fs.existsSync(currentFile) ? currentFile : path.join(report.sourceDir, `${locale}.json`));
    const generated = read(path.join(dir, "i18n", `${locale}.json`));
    for (const [key, value] of Object.entries(existing.translations)) {
      const categoryName = key.startsWith("category.") ? key.slice("category.".length) : null;
      const newId = categoryName && Object.keys(after.sourceCategoryData).find((id) => after.sourceCategoryData[id] === categoryName);
      assert.equal(generated.translations[newId ? `category.${newId}` : key], value, `Preserve supplied ${locale}/${key}`);
    }
    const keys = [...Object.values(after.effectData).map((effect) => effect.title), ...Object.values(after.TagData), ...Object.keys(after.category)];
    for (const fullKey of keys) assert.equal(typeof generated.translations[fullKey.slice("effectPlayer.".length)], "string", `${locale} must resolve ${fullKey}`);
  }
  // Re-recording keyword behavior must remain based on the original Chinese title.
  const config = read(path.join(report.sourceDir, "特效重录关键词.json"));
  const words = Object.keys(config).filter((word) => config[word]);
  assert.deepEqual(Object.values(after.effectData).filter((effect) => words.some((word) => effect.sourceTitle.includes(word))).map((effect) => effect.id),
    Object.values(before.effectData).filter((effect) => words.some((word) => (effect.sourceTitle ?? effect.title).includes(word))).map((effect) => effect.id));
  console.log(`PASS real migration: ${Object.keys(after.effectData).length} effects, unchanged media/IDs/filter arrays, complete bilingual keys and preserved supplied translations`);
}
console.log("PASS effect i18n migration: explicit keys, source text, existing translations, idempotence and collision checks");
