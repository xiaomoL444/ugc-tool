/* Run with: node scripts/test-bgm-data.cjs [optional-data-file.json] */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../src/views/BgmPlayer/utils/bgmData.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: filename,
});
const loaded = new Module(filename, module);
loaded._compile(compiled.outputText, filename);
const { normalizeBgmData } = loaded.exports;

function song(id, extras = {}) {
  return { id, name: `音乐 ${id}`, song_id: id, album_id: 1, album: "原神", time: 71, minute: 1, second: 11, category: 101, order: id, ...extras };
}

const input = Object.freeze({
  musicData: Object.freeze([
    Object.freeze(song(10002, { category: 101, order: 2 })),
    Object.freeze(song(10001, { category: 104, order: 1, giVersion: "7.1" })),
  ]),
  categoryData: Object.freeze({ 101: "探索音乐", 102: "战斗音乐", 103: "任务音乐", 104: "其他需求" }),
});
const parsed = normalizeBgmData(input);
assert.deepEqual(parsed.data.map(({ id }) => id), [10001, 10002]);
assert.equal(parsed.data[0].giVersion, "7.1", "Keep the version through normalization and migration");
assert.equal(parsed.data[1].giVersion, undefined, "Older indexes may omit versions");
assert.equal(parsed.data[0].nameI18nKey, "bgmPlayer.data.10001");
assert.equal(parsed.data[0].albumI18nKey, "bgmPlayer.album.1");
assert.equal(parsed.category[0].nameI18nKey, "bgmPlayer.category.101");
assert.equal(parsed.data[0].name, undefined, "Legacy text must not be a display fallback");
assert.deepEqual(input.musicData.map(({ id }) => id), [10002, 10001]);
assert.deepEqual(normalizeBgmData(parsed), parsed, "Standard indexes round trip");
assert.deepEqual(normalizeBgmData({ data: [], category: [] }), { data: [], category: [] });
assert.deepEqual(normalizeBgmData({ musicData: [], categoryData: {} }), { data: [], category: [] });
assert.deepEqual(normalizeBgmData({
  musicData: [song(1, { order: 1 }), song(2, { order: 1 })], categoryData: {},
}).data.map(({ id }) => id), [1, 2]);
for (const invalid of [null, undefined, "[]", {}, [], [song(1)], { musicData: {} }]) {
  assert.throws(() => normalizeBgmData(invalid));
}
for (const musicData of [[null], [{}], [song(1, { order: "2" })], [song(1, { category: NaN })], [song(1, { category: undefined })], [song(1, { order: undefined })], [song(1), song(1)]]) {
  assert.throws(() => normalizeBgmData({ musicData, categoryData: {} }));
}
for (const categoryData of [undefined, [], null, { 101: 123 }, { invalid: "name" }]) {
  assert.throws(() => normalizeBgmData({ musicData: [], categoryData }));
}
for (const nameI18nKey of [undefined, "中文", "other.data.1", "bgmPlayer.data.__proto__", "bgmPlayer.data."]) {
  assert.throws(() => normalizeBgmData({ ...parsed, data: [{ ...parsed.data[0], nameI18nKey }] }));
}
assert.throws(() => normalizeBgmData({ ...parsed, category: [parsed.category[0], parsed.category[0]] }));

// Resource labels and search react to both language switches and arriving remote catalogs.
require.extensions[".ts"] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file,
}).outputText, file);
global.window = {};
const { computed, ref } = require("vue");
const { createAppI18n } = require("../src/i18n/index.ts");
const { createCachedText } = require("../src/i18n/cachedText.ts");
const composer = createAppI18n("zh-CN").global;
const text = createCachedText(composer);
const selected = ref(parsed.data[0]);
const label = computed(() => text(selected.value.nameI18nKey));
assert.equal(label.value, "bgmPlayer.data.10001");
composer.setLocaleMessage("zh-CN", { bgmPlayer: { data: { 10001: "音乐" } } });
assert.equal(label.value, "音乐");
composer.locale.value = "en-US";
assert.equal(label.value, "bgmPlayer.data.10001", "No cross-language fallback");
composer.setLocaleMessage("en-US", { bgmPlayer: { data: { 10001: "Music" } } });
assert.equal(label.value, "Music");
const matches = computed(() => parsed.data.filter(item => text(item.nameI18nKey).toLowerCase().includes("music")));
assert.equal(matches.value.length, 1);
composer.locale.value = "zh-CN";
assert.equal(matches.value.length, 0);
assert.equal(selected.value.id, 10001);
assert.equal(selected.value.song_id, 10001);

const { migrateBgmData } = require("./migrate-bgm-i18n.cjs");
const migrated = migrateBgmData(input);
assert.deepEqual(migrated.data, parsed);
assert.equal(migrated.catalogs["zh-cn"]["bgmPlayer.data.10001"], "音乐 10001");
assert.equal(migrated.catalogs["en-us"]["bgmPlayer.data.10001"], null);
assert.throws(() => migrateBgmData({ ...input, musicData: [song(1), song(2, { album: "Different" })] }), /Conflicting/);

if (process.argv[2]) {
  const actual = normalizeBgmData(JSON.parse(fs.readFileSync(process.argv[2], "utf8")));
  assert.ok(actual.data.length > 0);
  console.log(`PASS reference data: ${actual.data.length} songs, ${actual.category.length} categories`);
}
console.log("PASS BGM data parsing, ordering, required schema, empty data, validation, and input preservation");
