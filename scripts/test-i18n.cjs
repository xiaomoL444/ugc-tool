/* Run with: node scripts/test-i18n.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { computed } = require("vue");

require.extensions[".ts"] = (loaded, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  });
  loaded._compile(compiled.outputText, filename);
};

const { createAppI18n, i18n, initializeLocale, setLocale, loadOssTranslations } = require("../src/i18n/index.ts");
const { localeStorageKey, resolveInitialLocale, supportedLocales } = require("../src/i18n/preferences.ts");
assert.deepEqual(supportedLocales.map(({ value }) => value), ["zh-CN", "zh-TW", "en-US", "ja-JP", "ru-RU"]);
for (const language of ["zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-Hant-HK", "zh_TW"]) {
  assert.equal(resolveInitialLocale(null, [language]), "zh-TW");
}
assert.equal(resolveInitialLocale(null, ["zh-Hans-TW"]), "zh-CN", "Explicit script takes priority over region");
assert.equal(resolveInitialLocale(null, ["ja"]), "ja-JP");
assert.equal(resolveInitialLocale(null, ["ru-RU"]), "ru-RU");
for (const locale of ["zh-TW", "ja-JP", "ru-RU"]) {
  assert.equal(resolveInitialLocale(locale, ["en-US"]), locale, "New saved language wins");
}
assert.equal(resolveInitialLocale("en-US", ["zh-CN"]), "en-US", "Saved preference wins");
assert.equal(resolveInitialLocale(null, ["fr-FR", "en-GB"]), "en-US");
assert.equal(resolveInitialLocale("invalid", ["zh-Hans-CN", "en-US"]), "zh-CN");
assert.equal(resolveInitialLocale(null, ["fr-FR"]), "zh-CN");
assert.equal(resolveInitialLocale(null, []), "zh-CN");

const instance = createAppI18n("zh-CN");
const { appRoutes } = require('../src/configs/routes.ts');
const soundRoute = appRoutes.find(route => route.name === 'SoundEffectPlayer');
assert.equal(soundRoute.titleKey, 'app.soundEffectPlayerTitle');
assert.equal(soundRoute.descriptionKey, 'app.soundEffectPlayerDescription');
const homeSoundTitle = computed(() => instance.global.t(soundRoute.titleKey));
const homeSoundDescription = computed(() => instance.global.t(soundRoute.descriptionKey));
for (const {value: locale} of supportedLocales) {
  instance.global.locale.value = locale;
  assert.notEqual(homeSoundTitle.value, soundRoute.titleKey);
  assert.notEqual(homeSoundDescription.value, soundRoute.descriptionKey);
  assert.match(homeSoundDescription.value, /7\.0/);
}
instance.global.locale.value = 'en-US';
assert.equal(homeSoundTitle.value, 'Sound Effect Player');
instance.global.locale.value = 'zh-CN';
assert.equal(homeSoundTitle.value, '音效播放器');
const composer = instance.global;
const liveTitle = computed(() => composer.t("app.effectPlayerTitle"));
assert.equal(liveTitle.value, "特效播放器");
composer.locale.value = "en-US";
assert.equal(liveTitle.value, "Effect Player", "Already-rendered computed labels update with locale");
assert.equal(composer.t("common.copySuccess", { text: "Yellow Glow" }), "Copied Yellow Glow");
assert.equal(composer.t("effectPlayer.filter.matchCount", { count: 1 }, 1), "1 matching effect");
assert.equal(composer.t("effectPlayer.filter.matchCount", { count: 2 }, 2), "2 matching effects");

composer.mergeLocaleMessage("zh-CN", { probe: { onlyChinese: "仅中文存在" } });
composer.mergeLocaleMessage("en-US", { probe: { onlyEnglish: "Only English" } });
composer.mergeLocaleMessage("en", { probe: { baseLanguage: "Generic English" } });
composer.mergeLocaleMessage("zh", { probe: { baseLanguage: "通用中文" } });
const originalWarn = console.warn;
try {
  console.warn = () => {};
  assert.equal(composer.t("probe.onlyChinese"), "probe.onlyChinese", "Missing English must not fall back to Chinese");
  assert.equal(composer.t("probe.baseLanguage"), "probe.baseLanguage", "Missing en-US must not implicitly fall back to en");
  composer.locale.value = "zh-CN";
  assert.equal(composer.t("probe.onlyEnglish"), "probe.onlyEnglish", "Missing Chinese must not fall back to English");
  assert.equal(composer.t("probe.baseLanguage"), "probe.baseLanguage", "Missing zh-CN must not implicitly fall back to zh");
  assert.equal(composer.t("effectPlayer.names.unknown-resource"), "effectPlayer.names.unknown-resource");
  assert.equal(composer.t("effectPlayer.tags.999999"), "effectPlayer.tags.999999");
} finally {
  console.warn = originalWarn;
}

function leaves(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    return typeof child === "string" ? [[fullKey, child]] : leaves(child, fullKey);
  });
}

const catalogs = createAppI18n().global;
const chinese = leaves(catalogs.getLocaleMessage("zh-CN"));
const english = leaves(catalogs.getLocaleMessage("en-US"));
assert.deepEqual(chinese.map(([key]) => key).sort(), english.map(([key]) => key).sort(), "Both catalogs cover the same keys");
for (const [locale, entries] of [["zh-CN", chinese], ["en-US", english]]) {
  catalogs.locale.value = locale;
  for (const [key, message] of entries) {
    assert.ok(message.trim(), `${locale}: ${key} must not be empty`);
    const params = Object.fromEntries([...message.matchAll(/\{(\w+)\}/g)].map((match) => [match[1], 2]));
    const translated = catalogs.t(key, params, 2);
    assert.notEqual(translated, key, `${locale}: ${key} must compile as a Vue I18n message`);
    if (locale === "en-US") assert.doesNotMatch(message, /[\u3400-\u9fff]/u, `${key} still contains untranslated Chinese`);
  }
}
assert.equal(catalogs.getLocaleMessage("zh-CN").effectPlayer.names, undefined, "Resource names are supplied by OSS, not bundled translations");
assert.equal(catalogs.getLocaleMessage("en-US").effectPlayer.names, undefined);
assert.equal(catalogs.getLocaleMessage("zh-CN").effectPlayer.category, undefined, "Category names are supplied only by OSS");
assert.equal(catalogs.getLocaleMessage("en-US").effectPlayer.category, undefined);

// Every supported language must provide both player UIs and shared controls locally.
for (const module of ["common", "effectPlayer", "soundEffectPlayer", "bgmPlayer"]) {
  const base = require(`../src/i18n/locales/${module}/en-us.json`);
  const parameters = (text) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
  for (const { value: locale } of supportedLocales) {
    const catalog = require(`../src/i18n/locales/${module}/${locale.toLowerCase()}.json`);
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(base).sort(), `${locale}: ${module} key coverage`);
    catalogs.locale.value = locale;
    for (const [key, message] of Object.entries(catalog)) {
      assert.ok(message.trim(), `${locale}: ${key} is nonempty`);
      assert.deepEqual(parameters(message), parameters(base[key]), `${locale}: ${key} parameters`);
      const params = Object.fromEntries(parameters(message).map((name) => [name, 2]));
      assert.notEqual(catalogs.t(key, params, 2), key, `${locale}: ${key} is registered and compiles`);
    }
    if (module === "effectPlayer") {
      assert.ok(Object.keys(catalog).every((key) => !/^effectPlayer\.(data|names|tags|category)\./.test(key)), "Asset names belong only in OSS");
    }
  }
}

// Exercise browser preference behavior without reading or writing real browser storage.
const savedDescriptors = Object.fromEntries(["document", "localStorage", "navigator"].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
const memory = new Map([[localeStorageKey, "en-US"]]);
try {
  Object.defineProperty(global, "document", { configurable: true, value: { documentElement: { lang: "" } } });
  Object.defineProperty(global, "navigator", { configurable: true, value: { languages: ["zh-CN"], language: "zh-CN" } });
  Object.defineProperty(global, "localStorage", { configurable: true, value: { getItem: (key) => memory.get(key), setItem: (key, value) => memory.set(key, value) } });
  initializeLocale();
  assert.equal(i18n.global.locale.value, "en-US");
  assert.equal(document.documentElement.lang, "en-US");
  setLocale("zh-CN");
  assert.equal(memory.get(localeStorageKey), "zh-CN");
  setLocale("unsupported");
  assert.equal(i18n.global.locale.value, "zh-CN", "Unsupported input must not corrupt the selected language");
  Object.defineProperty(global, "localStorage", { configurable: true, get() { throw new Error("Storage blocked"); } });
  assert.doesNotThrow(() => initializeLocale());
  assert.doesNotThrow(() => setLocale("en-US"));
  assert.equal(document.documentElement.lang, "en-US", "Language switching works with storage blocked");
  for (const locale of ["zh-TW", "ja-JP", "ru-RU"]) {
    setLocale(locale);
    assert.equal(i18n.global.locale.value, locale);
    assert.equal(document.documentElement.lang, locale);
  }
} finally {
  for (const [key, descriptor] of Object.entries(savedDescriptors)) {
    if (descriptor) Object.defineProperty(global, key, descriptor);
    else delete global[key];
  }
}

async function verifyOssLanguageFiles() {
  const originalFetch = global.fetch;
  const requests = [];
  let englishUploaded = false;
  try {
    global.fetch = async (url) => {
      requests.push(url);
      const path = new URL(url, "https://example.test").pathname;
      const target = supportedLocales.find(({ value }) => path.endsWith(`/EffectPlayer/i18n/${value.toLowerCase()}.json`));
      assert.ok(target, `Unexpected language URL: ${path}`);
      const chinese = path.endsWith("/zh-cn.json");
      if (!chinese && !englishUploaded) return { status: 404, ok: false };
      return { status: 200, ok: true, json: async () => ({
        version: 1, namespace: "effectPlayer", locale: target.value.toLowerCase(),
        translations: { "names.2": chinese ? "白色烟尘" : "White Dust Cloud" },
      }) };
    };
    const first = await loadOssTranslations("EffectPlayer", "effectPlayer", "i18n/");
    assert.deepEqual(first.map(({ locale, status }) => [locale, status]), supportedLocales.map(({ value }) => [value, value === "zh-CN" ? "loaded" : "missing"]));
    assert.equal(i18n.global.getLocaleMessage("zh-CN").effectPlayer.names[2], "白色烟尘");
    assert.equal(i18n.global.te("effectPlayer.names.2", "en-US"), false, "A missing language file must not reuse another language");
    englishUploaded = true;
    const second = await loadOssTranslations("EffectPlayer", "effectPlayer");
    assert.ok(second.every(({ status }) => status === "loaded"));
    assert.equal(requests.length, supportedLocales.length * 2, "Each supported language is revalidated, including previously missing files");
    assert.equal(i18n.global.getLocaleMessage("en-US").effectPlayer.names[2], "White Dust Cloud");
  } finally {
    global.fetch = originalFetch;
  }
}

verifyOssLanguageFiles().then(() => {
  console.log(`PASS i18n: locale preferences, live switching, missing keys, interpolation, pluralization, storage failure, per-language OSS files and ${english.length} local messages`);
}).catch((error) => { console.error(error); process.exitCode = 1; });
