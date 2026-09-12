/* Prepare converted files without overwriting the source:
 * node scripts/migrate-effect-i18n.cjs <effect-directory> [output-directory]
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");

const namespace = "effectPlayer";
const locales = ["zh-cn", "en-us"];
const isKey = (value) => typeof value === "string" && value.startsWith(`${namespace}.`);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function convertEffectData(source, catalogs, categoryDefaults = {}) {
  assert.ok(record(source.effectData) && record(source.TagData), "Expected effectData and TagData objects");
  assert.ok(source.category === undefined || record(source.category), "Expected a category object");
  const data = structuredClone(source);
  const tables = structuredClone(catalogs);
  for (const locale of locales) {
    const table = tables[locale];
    assert.equal(table?.version, 1);
    assert.equal(table?.namespace, namespace);
    assert.equal(table?.locale?.toLowerCase(), locale);
    assert.ok(table.format === undefined || table.format === "text", "Resource migration expects literal text catalogs");
    assert.ok(record(table.translations));
  }
  const addChinese = (key, text) => {
    if (typeof text === "string" && !isKey(text) && !Object.hasOwn(tables["zh-cn"].translations, key)) {
      tables["zh-cn"].translations[key] = text;
    }
  };
  let titles = 0;
  for (const [id, item] of Object.entries(data.effectData)) {
    assert.equal(String(item.id), id, `Effect ID mismatch: ${id}`);
    assert.match(id, /^\d+$/);
    const titleKey = isKey(item.title) ? item.title : isKey(item.name) ? item.name : `${namespace}.names.${id}`;
    for (const field of ["title", "name"]) {
      if (field === "name" && item.name === undefined) continue;
      assert.ok(item[field] === undefined || typeof item[field] === "string", `Expected text ${id}/${field}`);
      const sourceField = field === "title" ? "sourceTitle" : "sourceName";
      if (!isKey(item[field]) && item[field] !== undefined) item[sourceField] = item[field];
      const key = isKey(item[field]) ? item[field] : titleKey;
      addChinese(key.slice(namespace.length + 1), item[sourceField]);
      item[field] = key;
    }
    titles++;
  }
  data.sourceTagData = { ...(data.sourceTagData ?? {}) };
  for (const [id, text] of Object.entries(data.TagData)) {
    assert.match(id, /^\d+$/);
    assert.equal(typeof text, "string");
    const key = isKey(text) ? text : `${namespace}.tags.${id}`;
    if (!isKey(text)) data.sourceTagData[id] = text;
    addChinese(key.slice(namespace.length + 1), data.sourceTagData[id]);
    data.TagData[id] = key;
  }
  const category = {};
  const sourceCategoryData = { ...(data.sourceCategoryData ?? {}) };
  const prefix = `${namespace}.category.`;
  const suffixOf = (key) => {
    assert.ok(!isKey(key) || key.startsWith(prefix), `Unexpected category key: ${key}`);
    return key.startsWith(prefix) ? key.slice(prefix.length) : key;
  };
  const numericId = (value) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
  const idsByName = new Map();
  for (const [id, name] of Object.entries(sourceCategoryData)) {
    assert.ok(numericId(id) && typeof name === "string", "Expected category ID → original name metadata");
    assert.ok(!idsByName.has(name), `Category name collision: ${name}`);
    idsByName.set(name, id);
  }
  const reservedIds = [...Object.keys(sourceCategoryData), ...Object.keys(data.category ?? {}).map(suffixOf).filter(numericId)];
  let nextId = Math.max(0, ...reservedIds.map(Number)) + 1;
  for (const [name, ids] of Object.entries(data.category ?? {})) {
    assert.ok(Array.isArray(ids) && ids.every(Number.isInteger));
    const suffix = suffixOf(name);
    const id = numericId(suffix) ? suffix : idsByName.get(suffix) ?? String(nextId++);
    const originalName = numericId(suffix)
      ? sourceCategoryData[id] ?? tables["zh-cn"].translations[`category.${id}`] ?? suffix
      : suffix;
    assert.equal(typeof originalName, "string");
    assert.ok(!idsByName.has(originalName) || idsByName.get(originalName) === id, `Category name collision: ${originalName}`);
    sourceCategoryData[id] = originalName;
    idsByName.set(originalName, id);
    const key = `${prefix}${id}`;
    assert.ok(!Object.hasOwn(category, key), `Category key collision: ${key}`);
    category[key] = ids;
    const oldRelative = `category.${suffix}`;
    const relative = `category.${id}`;
    const defaultKey = Object.keys(categoryDefaults["zh-cn"] ?? {}).find((key) =>
      key.startsWith("category.") && categoryDefaults["zh-cn"][key] === originalName);
    for (const locale of locales) {
      if (oldRelative !== relative && Object.hasOwn(tables[locale].translations, oldRelative)) {
        if (Object.hasOwn(tables[locale].translations, relative)) {
          assert.deepEqual(tables[locale].translations[relative], tables[locale].translations[oldRelative], `Translation collision: ${locale}/${relative}`);
        }
        tables[locale].translations[relative] = tables[locale].translations[oldRelative];
        delete tables[locale].translations[oldRelative];
      }
      if (Object.hasOwn(tables[locale].translations, relative)) continue;
      const translated = locale === "zh-cn" ? originalName : categoryDefaults[locale]?.[oldRelative] ?? (defaultKey && categoryDefaults[locale]?.[defaultKey]);
      tables[locale].translations[relative] = typeof translated === "string" ? translated : null;
    }
  }
  if (data.category !== undefined) {
    data.category = category;
    data.sourceCategoryData = sourceCategoryData;
  }
  return { data, tables, counts: { effects: titles, tags: Object.keys(data.TagData).length, categories: Object.keys(category).length } };
}

function prepare(sourceDirectory, outputDirectory) {
  const sourceDir = fs.realpathSync(sourceDirectory);
  const outputDir = outputDirectory ? path.resolve(outputDirectory) : fs.mkdtempSync(path.join(os.tmpdir(), "ugc-effect-i18n-"));
  assert.notEqual(outputDir.toLowerCase(), sourceDir.toLowerCase(), "Output must be separate from the source directory");
  const inputs = {};
  const readInput = (file) => {
    const fullPath = path.join(sourceDir, file);
    const bytes = fs.readFileSync(fullPath);
    inputs[file] = sha256(bytes);
    return JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  };
  const source = readInput("data.json");
  const catalogs = Object.fromEntries(locales.map((locale) => {
    const relative = fs.existsSync(path.join(sourceDir, "i18n", `${locale}.json`)) ? `i18n/${locale}.json` : `${locale}.json`;
    return [locale, readInput(relative)];
  }));
  const defaults = Object.fromEntries(locales.map((locale) => [locale,
    readJson(path.join(__dirname, "../examples/i18n", `${locale}.json`)).translations,
  ]));
  const converted = convertEffectData(source, catalogs, defaults);
  fs.mkdirSync(path.join(outputDir, "i18n"), { recursive: true });
  const outputs = {};
  const write = (relative, text) => {
    fs.writeFileSync(path.join(outputDir, relative), text, "utf8");
    outputs[relative] = sha256(text);
  };
  write("data.json", JSON.stringify(converted.data, null, 2) + "\n");
  for (const locale of locales) write(`i18n/${locale}.json`, JSON.stringify(converted.tables[locale], null, 2) + "\n");
  // Existing re-recording tools match original names, rather than translated keys.
  const dictionaryScript = path.join(sourceDir, "build_effect_dictionary.cjs");
  if (fs.existsSync(dictionaryScript)) {
    const original = fs.readFileSync(dictionaryScript, "utf8");
    const convertedScript = original.replace("effect.title.includes(word)", "(effect.sourceTitle ?? effect.title).includes(word)");
    if (convertedScript !== original) {
      inputs["build_effect_dictionary.cjs"] = sha256(original);
      write("build_effect_dictionary.cjs", convertedScript);
    }
  }
  const report = { sourceDir, outputDir, inputs, outputs, counts: converted.counts };
  fs.writeFileSync(path.join(outputDir, "migration-report.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}

module.exports = { convertEffectData, prepare };
if (require.main === module) {
  try {
    assert.ok(process.argv[2], "Usage: node scripts/migrate-effect-i18n.cjs <effect-directory> [output-directory]");
    console.log(JSON.stringify(prepare(process.argv[2], process.argv[3]), null, 2));
  } catch (error) { console.error(error); process.exitCode = 1; }
}
