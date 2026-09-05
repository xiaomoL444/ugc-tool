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
    Object.freeze(song(10001, { category: 104, order: 1 })),
  ]),
  categoryData: Object.freeze({ 101: "探索音乐", 102: "战斗音乐", 103: "任务音乐", 104: "其他需求" }),
});
const parsed = normalizeBgmData(input);
assert.deepEqual(parsed.musicData.map(({ id }) => id), [10001, 10002]);
assert.deepEqual(parsed.categoryData, input.categoryData);
assert.deepEqual(input.musicData.map(({ id }) => id), [10002, 10001]);
assert.notEqual(parsed.musicData, input.musicData);
assert.notEqual(parsed.categoryData, input.categoryData);

assert.deepEqual(normalizeBgmData({ musicData: [], categoryData: {} }), { musicData: [], categoryData: {} });
assert.deepEqual(normalizeBgmData({
  musicData: [song(1, { order: 1 }), song(2, { order: 1 })], categoryData: {},
}).musicData.map(({ id }) => id), [1, 2]);

for (const invalid of [null, undefined, "[]", {}, [], [song(1)], { musicData: {} }]) {
  assert.throws(() => normalizeBgmData(invalid), /musicData 必须是音乐数组/);
}
for (const musicData of [[null], [{}], [song(1, { order: "2" })], [song(1, { category: NaN })], [song(1, { category: undefined })], [song(1, { order: undefined })]]) {
  assert.throws(() => normalizeBgmData({ musicData, categoryData: {} }), /第 1 首音乐的信息无效/);
}
for (const categoryData of [undefined, [], null, { 101: 123 }]) {
  assert.throws(() => normalizeBgmData({ musicData: [], categoryData }), /categoryData 必须是分类名称字典/);
}

if (process.argv[2]) {
  const actual = normalizeBgmData(JSON.parse(fs.readFileSync(process.argv[2], "utf8")));
  assert.ok(actual.musicData.length > 0);
  console.log(`PASS reference data: ${actual.musicData.length} songs, ${Object.keys(actual.categoryData).length} categories`);
}
console.log("PASS BGM data parsing, ordering, required schema, empty data, validation, and input preservation");
