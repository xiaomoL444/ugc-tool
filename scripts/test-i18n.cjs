/* Run with: node scripts/test-i18n.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { computed, effectScope, nextTick } = require("vue");

require.extensions[".ts"] = (loaded, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  });
  loaded._compile(compiled.outputText, filename);
};

const { createAppI18n, i18n, initializeLocale, setLocale, loadOssTranslations, loadOssTranslationDictionary,
  t, normalizeAppLocale } = require("../src/i18n/index.ts");
const { assetFeatureLabels } = require("../src/components/AssetFeatures/labels.ts");
const { useOssTranslations } = require("../src/i18n/useOssTranslations.ts");
const { localeStorageKey, resolveInitialLocale, supportedLocales } = require("../src/i18n/preferences.ts");
assert.deepEqual(supportedLocales.map(({ value }) => value), ["zh-CN", "zh-TW", "en-US", "ja-JP", "ru-RU"]);
for (const { value: locale } of supportedLocales) {
  for (const variant of [locale, locale.toLowerCase(), locale.toUpperCase().replace(/-/g, "_")]) {
    assert.equal(normalizeAppLocale(variant), locale, "Supported locale spelling normalizes to AppLocale");
    assert.deepEqual(assetFeatureLabels(variant), assetFeatureLabels(locale), "Description labels use the same canonical language");
  }
  assert.equal(assetFeatureLabels(locale).description, i18n.global.t("assetFeatures.ui.description", {}, { locale }));
}
for (const unsupported of ["fr-FR", "en", "", null]) {
  assert.equal(normalizeAppLocale(unsupported), undefined, "Explicit unsupported language does not fall back");
}
assert.equal(assetFeatureLabels("fr-FR").description, "assetFeatures.ui.description", "Unsupported description labels preserve the full key");
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
// The complete editor catalog and maintenance parity are covered separately by
// scripts/test-client-ui-i18n.cjs through the same public Vue I18n renderer.
const compiledMessages = locale => leaves(catalogs.getLocaleMessage(locale))
  .filter(([key]) => !key.startsWith("clientUIAnimationEditor."));
const chinese = compiledMessages("zh-CN");
const english = compiledMessages("en-US");
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

// The public entry exposes ordinary Vue I18n translation. Stored text is a snapshot.
const originalMessageLocale = i18n.global.locale.value;
const literalName = "保存 @ {my-name} | label";
const liveMessage = computed(() => t("common.copySuccess", { text: t("effectPlayer.filter.open") }));
const localizedMessages = new Set();
try {
  assert.equal(t, i18n.global.t, "The public t is the actual composer translation function");
  i18n.global.locale.value = 'zh-CN';
  const storedMessages = JSON.parse(JSON.stringify([t("effectPlayer.filter.open"), t("common.copySuccess", { text: literalName })]));
  const originalMessages = [...storedMessages];
  const error = new Error(t("common.copySuccess", { text: literalName }));
  const workerReply = structuredClone({ type: 'error', message: error.message });
  for (const { value: locale } of supportedLocales) {
    i18n.global.locale.value = locale;
    const effectText = i18n.global.t("effectPlayer.filter.open");
    const commonText = i18n.global.t("common.copySuccess", { text: effectText });
    assert.equal(liveMessage.value, commonText, locale + ": template/computed translations react to language changes");
    assert.equal(t("common.copySuccess", { text: literalName }), i18n.global.t("common.copySuccess", { text: literalName }), locale + ": ordinary interpolation preserves user data");
    assert.deepEqual(storedMessages, originalMessages, locale + ": saved message strings retain their creation language");
    assert.equal(workerReply.message, originalMessages[1], locale + ": a completed Worker error remains its original string");
    assert.equal(error.message, originalMessages[1], locale + ": retained Error.message remains its original string");
    localizedMessages.add(liveMessage.value);
  }
  assert.ok(localizedMessages.size > 1, "Fresh translations use the newly selected language");
  assert.ok(storedMessages.every(message => typeof message === 'string'));
  assert.equal(Object.hasOwn(storedMessages, 'messages'), false, "Message arrays have no parallel descriptor channel");
} finally { i18n.global.locale.value = originalMessageLocale; }

assert.equal(fs.existsSync(require('node:path').join(__dirname, '../src/i18n/messages.ts')), false, "There is no separate message descriptor or fixed-language restoration module");

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
    i18n.global.locale.value = "zh-CN";
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
    assert.deepEqual(first.map(({ locale, status }) => [locale, status]), [["zh-CN", "loaded"]]);
    assert.equal(requests.length, 1, "Entering a page requests only the current language");
    assert.equal(i18n.global.getLocaleMessage("zh-CN").effectPlayer.names[2], "白色烟尘");
    assert.equal(i18n.global.te("effectPlayer.names.2", "en-US"), false, "A missing language file must not reuse another language");
    i18n.global.locale.value = "en-US";
    const second = await loadOssTranslations("EffectPlayer", "effectPlayer");
    assert.deepEqual(second.map(({ locale, status }) => [locale, status]), [["en-US", "missing"]]);
    englishUploaded = true;
    assert.equal((await loadOssTranslations("EffectPlayer", "effectPlayer"))[0].status, "loaded", "Missing files can be retried after upload");
    assert.equal(requests.length, 3);
    assert.equal(i18n.global.getLocaleMessage("en-US").effectPlayer.names[2], "White Dust Cloud");
    await loadOssTranslations("EffectPlayer", "effectPlayer", "i18n", { refresh: false });
    assert.equal(requests.length, 3, "Language switches reuse a valid snapshot");
    await loadOssTranslations("EffectPlayer", "effectPlayer");
    assert.equal(requests.length, 3, "All ordinary consumers reuse the same successful snapshot");
    const raw = await loadOssTranslationDictionary("EffectPlayer", "effectPlayer");
    assert.equal(raw.dictionary["effectPlayer.names.2"], "White Dust Cloud");
    assert.equal(requests.length, 3, "Display and raw dictionary consumers share the request/cache");
    await loadOssTranslations("EffectPlayer", "effectPlayer", "i18n", { refresh: true });
    assert.equal(requests.length, 4, "Explicit reloads still revalidate the selected file");
  } finally {
    global.fetch = originalFetch;
  }
}

async function verifyScopedLanguageLoading() {
  const originalFetch = global.fetch;
  const requests = [];
  let failJapanese = true;
  let finishRussian;
  const scope = effectScope();
  const flush = async () => { await nextTick(); await new Promise(resolve => setImmediate(resolve)); };
  try {
    global.fetch = async url => {
      const file = new URL(url, "https://example.test").pathname.split("/").pop();
      requests.push(file);
      if (file === "ja-jp.json" && failJapanese) return { status: 503, ok: false };
      const response = { status: 200, ok: true, json: async () => ({ "lazyProbe.data.1": file }) };
      if (file === "ru-ru.json") return new Promise(resolve => { finishRussian = () => resolve(response); });
      return response;
    };
    i18n.global.locale.value = "zh-CN";
    const load = scope.run(() => useOssTranslations("LazyProbe", "lazyProbe"));
    i18n.global.locale.value = "en-US";
    await flush();
    assert.equal(requests.length, 0, "No translations load before the page enables its catalog");
    await load();
    assert.deepEqual(requests, ["en-us.json"]);
    i18n.global.locale.value = "zh-CN";
    await flush();
    assert.deepEqual(requests, ["en-us.json", "zh-cn.json"]);
    i18n.global.locale.value = "en-US";
    await flush();
    assert.equal(requests.length, 2, "Returning to a loaded language performs no request");
    i18n.global.locale.value = "ja-JP";
    await flush();
    i18n.global.locale.value = "en-US";
    await flush();
    failJapanese = false;
    i18n.global.locale.value = "ja-JP";
    await flush();
    assert.equal(requests.filter(file => file === "ja-jp.json").length, 2, "A failed language remains retryable");
    assert.equal(i18n.global.getLocaleMessage("ja-JP").lazyProbe.data[1], "ja-jp.json");
    i18n.global.locale.value = "ru-RU";
    await flush();
    i18n.global.locale.value = "en-US";
    await flush();
    finishRussian();
    await flush();
    assert.equal(i18n.global.locale.value, "en-US", "A late response cannot switch the selected language");
    assert.equal(i18n.global.getLocaleMessage("en-US").lazyProbe.data[1], "en-us.json", "Late translations remain isolated by language");
    scope.stop();
    const count = requests.length;
    i18n.global.locale.value = "zh-TW";
    await flush();
    await load();
    assert.equal(requests.length, count, "Disposed pages never request translations, including late index callbacks");
  } finally {
    scope.stop();
    global.fetch = originalFetch;
  }
}

async function verifySharedDictionaryConsumers() {
  const originalFetch = global.fetch;
  const literal = "Dust @ Gate {A} | Burst";
  const calls = [];
  try {
    i18n.global.locale.value = "en-US";
    global.fetch = async url => {
      calls.push(url);
      return new Response(JSON.stringify({ "sharedProbe.data.1": literal }), { headers: { "Content-Type": "application/json" } });
    };
    const [display, raw] = await Promise.all([
      loadOssTranslations("SharedProbe", "sharedProbe"),
      loadOssTranslationDictionary("SharedProbe", "sharedProbe"),
    ]);
    assert.equal(display[0].status, "loaded");
    assert.equal(calls.length, 1, "Concurrent display and description consumers download one file");
    assert.equal(raw.dictionary["sharedProbe.data.1"], literal, "Raw data never contains Vue message escaping");
    assert.ok(Object.isFrozen(raw.dictionary), "Consumers cannot change the shared raw dictionary");
    assert.equal(i18n.global.t("sharedProbe.data.1"), literal, "Rendered and raw translations preserve the same visible text");
    const bounded = await loadOssTranslationDictionary("SharedProbe", "sharedProbe", "i18n", { maxBytes: 1 });
    assert.equal(bounded.result.status, "failed", "Strict consumers validate the byte size of cached files");
    assert.equal(bounded.dictionary, undefined);
    assert.equal((await loadOssTranslations("SharedProbe", "sharedProbe"))[0].status, "loaded", "A consumer-specific limit does not poison the shared valid cache");
    assert.equal(calls.length, 1);
    let injectedCalls = 0;
    const fetcher = async () => {
      injectedCalls++;
      return new Response(JSON.stringify({ "budgetProbe.data.1": "A longer translation" }), { headers: { "Content-Type": "application/json" } });
    };
    const first = await loadOssTranslationDictionary("BudgetProbe", "budgetProbe", "i18n", { fetcher, maxBytes: 1 });
    assert.equal(first.result.status, "failed");
    const recovered = await loadOssTranslationDictionary("BudgetProbe", "budgetProbe", "i18n", { fetcher, maxBytes: 1000 });
    assert.equal(recovered.result.status, "loaded", "Retries use their own limits instead of the first caller's budget");
    assert.equal(injectedCalls, 2);
    assert.equal((await loadOssTranslationDictionary("BudgetProbe", "budgetProbe", "i18n", { fetcher })).dictionary["budgetProbe.data.1"], "A longer translation");
    assert.equal(injectedCalls, 2);
    assert.equal(i18n.global.te("budgetProbe.data.1", "en-US"), false, "Injected verification sources stay isolated from production translations");
  } finally { global.fetch = originalFetch; }
}

verifyOssLanguageFiles().then(verifyScopedLanguageLoading).then(verifySharedDictionaryConsumers).then(() => {
  console.log(`PASS i18n: locale preferences, live switching, missing keys, interpolation, pluralization, storage failure, lazy language requests, cached switches, retries, disposal, late responses and ${english.length} local messages`);
}).catch((error) => { console.error(error); process.exitCode = 1; });
