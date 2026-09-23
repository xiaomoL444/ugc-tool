/* node scripts/migrate-bgm-i18n.cjs <legacy-data.json> <new-output-directory>
 * Writes a standard index, the existing Chinese labels, and null placeholders
 * for the other languages. Does not publish files or invent translations.
 */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const ts = require("typescript");

require.extensions[".ts"] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const { normalizeBgmData } = require("../src/views/BgmPlayer/utils/bgmData.ts");

function migrateBgmData(source) {
  assert.ok(Array.isArray(source.musicData), "Expected legacy musicData");
  const data = normalizeBgmData(source);
  const chinese = {};
  const add = (key, value) => {
    assert.equal(typeof value, "string", `Missing source label: ${key}`);
    assert.ok(value.trim(), `Empty source label: ${key}`);
    assert.ok(chinese[key] === undefined || chinese[key] === value, `Conflicting source labels: ${key}`);
    chinese[key] = value;
  };
  const songs = new Map(source.musicData.map(item => [item.id, item]));
  const categories = new Set(data.category.map(item => item.id));
  for (const item of data.data) {
    assert.ok(categories.has(item.category), `Undefined category: ${item.category}`);
    const original = songs.get(item.id);
    add(item.nameI18nKey, original.name);
    add(item.albumI18nKey, original.album);
  }
  for (const item of data.category) add(item.nameI18nKey, source.categoryData[item.id]);
  const catalogs = { "zh-cn": chinese };
  for (const locale of ["zh-tw", "en-us", "ja-jp", "ru-ru"]) {
    catalogs[locale] = Object.fromEntries(Object.keys(chinese).map(key => [key, null]));
  }
  return { data, catalogs };
}

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  assert.ok(input && output, "Usage: node scripts/migrate-bgm-i18n.cjs <legacy-data.json> <new-output-directory>");
  assert.ok(!fs.existsSync(output), "Output directory must be new to preserve existing translations");
  const result = migrateBgmData(JSON.parse(fs.readFileSync(input, "utf8").replace(/^\uFEFF/, "")));
  fs.mkdirSync(path.join(output, "i18n"), { recursive: true });
  const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  write(path.join(output, "data.json"), result.data);
  for (const [locale, catalog] of Object.entries(result.catalogs)) write(path.join(output, "i18n", `${locale}.json`), catalog);
  console.log(`Prepared ${result.data.data.length} songs. Translate null entries before publishing language files.`);
}

module.exports = { migrateBgmData };
