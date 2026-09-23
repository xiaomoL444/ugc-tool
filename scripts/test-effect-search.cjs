/* Run with: node scripts/test-effect-search.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
require.extensions[".ts"] = (loaded, filename) => {
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
};
// Vue I18n uses shallow message refs during SSR; exercise its browser reactivity here.
global.window = {};
const { computed, ref } = require("vue");
const { createI18n } = require("vue-i18n");

const filename = path.resolve(__dirname, "../src/views/EffectPlayer/searchIndex.ts");
const { buildEffectSearchIndex } = require(filename);
const { effectNameKey, effectTagKey } = require("../src/views/EffectPlayer/resourceKeys.ts");

const items = ref([
  { id: "10001", title: "冰元素受击", name: "CryoHitSource", tagList: [4, 39] },
  { id: "20002", title: "火元素护盾", tagList: [2, 23] },
  { id: "30003", title: "新特效原名", tagList: [999] },
]);
const sourceTags = { 4: "冰元素", 39: "受击", 2: "火元素", 23: "护盾", 999: "新标签原文" };
const messages = {
  "zh-CN": { effectPlayer: {
    data: { 10001: "冰霜冲击", 20002: "烈焰护盾" },
    tags: { 4: "冰元素", 39: "受击", 2: "火元素", 23: "护盾" },
  } },
  "en-US": { effectPlayer: {
    data: { 10001: "Frost Impact", 20002: "Flame Shield" },
    tags: { 4: "Cryo", 39: "Hit", 2: "Pyro", 23: "Shield" },
  } },
};
const i18n = createI18n({ legacy: false, locale: "zh-CN", fallbackLocale: false, messages });
let builds = 0;
const index = computed(() => {
  builds++;
  return buildEffectSearchIndex(items.value, sourceTags, Object.values(i18n.global.messages.value));
});
const search = (query) => {
  const q = query.trim().toLowerCase();
  return items.value.filter((item) => !q || index.value.get(item.id)?.includes(q)).map(({ id }) => id);
};

for (const locale of ["zh-CN", "en-US", "zh-CN"]) {
  i18n.global.locale.value = locale;
  assert.deepEqual(search("  CRYO  "), ["10001"], "English tags remain searchable in either display language");
  assert.deepEqual(search("冰元素"), ["10001"], "Source tags remain searchable in either display language");
  assert.deepEqual(search("Frost Impact"), ["10001"], "English names remain searchable in either display language");
  assert.deepEqual(search("冰霜冲击"), ["10001"], "Chinese translations remain searchable in either display language");
  assert.deepEqual(search("冰元素受击"), ["10001"], "Original titles remain searchable alongside translations");
  assert.deepEqual(search("CryoHitSource"), ["10001"], "Original internal names are also indexed");
  assert.deepEqual(search("20002"), ["20002"], "IDs remain searchable");
  assert.deepEqual(search("新特效原名"), ["30003"], "Effects without translations remain searchable by source name");
  assert.deepEqual(search("新标签原文"), ["30003"], "Tags without translations remain searchable by source text");
  assert.deepEqual(search("not a match"), []);
  assert.deepEqual(search(" "), ["10001", "20002", "30003"]);
}
assert.equal(builds, 1, "Typing and display language changes do not rebuild the index");
i18n.global.setLocaleMessage("fr-FR", { effectPlayer: { data: { 10001: "Impact de givre" } } });
assert.deepEqual(search("givre"), ["10001"], "Newly loaded locales are indexed automatically");
assert.equal(builds, 2);
items.value.push({ id: "40004", title: "新增原始特效", tagList: [] });
assert.deepEqual(search("新增原始特效"), ["40004"], "Source data changes refresh the index");
assert.equal(builds, 3);

// New data embeds full resource keys and keeps source text in separate fields.
const migratedItems = items.value.map((item) => ({
  ...item,
  title: `effectPlayer.names.${item.id}`,
  sourceTitle: item.title,
  ...(item.name ? { name: `effectPlayer.names.${item.id}`, sourceName: item.name } : {}),
}));
const tagKeys = Object.fromEntries(Object.keys(sourceTags).map((id) => [id, `effectPlayer.tags.${id}`]));
const migratedIndex = buildEffectSearchIndex(migratedItems, tagKeys, Object.values(i18n.global.messages.value), sourceTags);
for (const [id, text] of index.value) {
  for (const term of text.split("\n")) {
    assert.ok(migratedIndex.get(id).includes(term), `Migrated data retains search term ${term}`);
  }
}
assert.equal(effectNameKey(items.value[0]), "effectPlayer.data.10001");
assert.equal(effectNameKey(migratedItems[0]), "effectPlayer.data.10001");
assert.equal(effectTagKey(4, "冰元素"), "effectPlayer.tags.4");
assert.equal(effectTagKey(4, tagKeys[4]), "effectPlayer.tags.4");

// Full keys from the data take precedence over ID-derived names in display and search.
const customItem = {
  id: "5", title: "effectPlayer.names.custom", name: "effectPlayer.aliases.internal",
  sourceTitle: "白色烟尘", sourceName: "DustSource", tagList: [7],
};
const customMessages = {
  "zh-CN": { effectPlayer: { data: { custom: "白色烟尘" }, aliases: { internal: "别名" },
    tags: { custom: "烟雾" }, category: { 属性: "属性" } } },
  "en-US": { effectPlayer: { data: { custom: "Dust Cloud", 5: "Unrelated ID entry" }, aliases: { internal: "Dust Alias" },
    tags: { custom: "Smoke", 7: "Unrelated tag entry" }, category: { 属性: "Attribute" } } },
};
const customI18n = createI18n({ legacy: false, locale: "en-US", fallbackLocale: false, messages: customMessages });
assert.equal(customI18n.global.t(effectNameKey(customItem)), "Dust Cloud");
assert.equal(effectNameKey({ id: "5", title: "旧标题", name: customItem.name }), customItem.name, "Explicit name keys take precedence over legacy titles");
assert.equal(customI18n.global.t(effectTagKey(7, "effectPlayer.tags.custom")), "Smoke");
const customIndex = buildEffectSearchIndex([customItem], { 7: "effectPlayer.tags.custom" }, Object.values(customMessages), { 7: "原始烟雾" }).get("5");
for (const term of ["dust cloud", "dust alias", "smoke", "白色烟尘", "dustsource", "原始烟雾", "5"]) {
  assert.ok(customIndex.includes(term), `Actual resource keys and original text are searchable: ${term}`);
}
assert.ok(!customIndex.includes("unrelated"), "Searching follows the data's actual key instead of stale ID-derived translations");
// Standard nameI18nKey takes priority, including when old index fields remain.
const standardItem = { ...customItem, nameI18nKey: "effectPlayer.data.canonical" };
assert.equal(effectNameKey(standardItem), "effectPlayer.data.canonical");
assert.equal(effectNameKey({ id: "8", name: "effectPlayer.names.8" }), "effectPlayer.data.8");
const standardIndex = buildEffectSearchIndex([standardItem], {}, [
  { effectPlayer: { data: { canonical: "標準名" } } },
  { effectPlayer: { data: { canonical: "標準エフェクト" } } },
  { effectPlayer: { data: { canonical: "Стандартный эффект" } } },
]);
for (const term of ["標準名", "標準エフェクト", "стандартный эффект"]) {
  assert.ok(standardIndex.get("5").includes(term), "Standard names in every loaded language are searchable");
}
console.log("PASS multilingual effect search, legacy/keyed data, custom resource keys, source names/tags, IDs, and reactive index updates");
