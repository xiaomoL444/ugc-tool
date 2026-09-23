/* Run with: node scripts/test-remote-i18n.cjs. All fetches use in-memory fixtures. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
// Exercise browser message refs, including updates after a remote fetch.
global.window = {};
const { computed } = require("vue");
const { createI18n } = require("vue-i18n");
require.extensions[".ts"] = (loaded, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
  });
  loaded._compile(result.outputText, filename);
};
const { RemoteI18nLoader, parseTranslationTable } = require("../src/i18n/remote.ts");
const { escapeMessageText, messageSearchText } = require("../src/i18n/messageText.ts");
const { buildEffectSearchIndex } = require("../src/views/EffectPlayer/searchIndex.ts");
const { buildEffectTagGroups, matchesEffectTagGroups, countEffectTags } = require("../src/views/EffectPlayer/tagFilters.ts");
const source = { namespace: "effectPlayer", locale: "en-US", url: "/ugc-tool-data/EffectPlayer/i18n/en-us.json" };
const chineseSource = { namespace: "effectPlayer", locale: "zh-CN", url: "/ugc-tool-data/EffectPlayer/i18n/zh-cn.json" };
const table = (translations, extra = {}) => ({ version: 1, namespace: source.namespace, locale: "en-us", translations, ...extra });
const chineseTable = (translations) => table(translations, { locale: "zh-cn" });
const response = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
function setup(queue, messages = {}, timeoutMs = 100) {
  const composer = createI18n({ legacy: false, locale: "en-US", fallbackLocale: { "en-US": [], "zh-CN": [], default: [] }, fallbackFormat: false,
    missingWarn: false, fallbackWarn: false, messages: { "en-US": {}, "zh-CN": {}, ...messages } }).global;
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    assert.ok(queue.length, "Every request requires an explicit mock response");
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(url, options) : next;
  };
  return { composer, calls, loader: new RemoteI18nLoader(composer, { fetch: request, timeoutMs }) };
}

function validateFormat() {
  const parse = (input) => parseTranslationTable(input, source.namespace, source.locale);
  const parsed = parse(table({ "names.2": "White Dust", "names.3": null, "names.4": "", "names.5": "   ", "tags.4": "Glow" }));
  assert.equal(parsed.entries, 2);
  assert.deepEqual(parsed.messages, { names: { 2: "White Dust" }, tags: { 4: "Glow" } });
  assert.deepEqual(parse(table({})), { messages: {}, entries: 0 });
  assert.deepEqual(parse({ "effectPlayer.data.10001": "Wind", "effectPlayer.category.1": "Environment" }), {
    messages: { data: { 10001: "Wind" }, category: { 1: "Environment" } }, entries: 2,
  });
  assert.deepEqual(parse({}), { messages: {}, entries: 0 });
  assert.deepEqual(parse({ "effectPlayer.data.1": null, "effectPlayer.data.2": "  " }), { messages: {}, entries: 0 });
  for (const invalid of [
    { "otherPlayer.data.1": "Wrong namespace" },
    { "effectPlayer.data.1": "Wind", "otherPlayer.data.2": "Mixed namespaces" },
    { "effectPlayer.data.1": 123 },
    { "effectPlayer.data": "Parent", "effectPlayer.data.1": "Child" },
    { "effectPlayer.__proto__.injected": "Bad" },
  ]) assert.throws(() => parse(invalid));
  assert.equal(parse(table({ title: "Uppercase locale" }, { locale: "EN-US" })).messages.title, "Uppercase locale", "Table locale matching is case-insensitive");
  assert.equal(parse(table({ "category.自定义分类": "Custom category" })).messages.category.自定义分类, "Custom category", "Data-defined category names may contain Chinese characters");
  assert.deepEqual(parseTranslationTable(chineseTable({ "names.2": "白色烟尘" }), source.namespace, "zh-CN").messages, { names: { 2: "白色烟尘" } });
  for (const invalid of [null, [], table({}, { version: 2 }), table({}, { namespace: "otherPage" }), table({}, { format: "html" }), table([]),
    table({}, { locale: "zh-cn" }), table({}, { locale: "en_US" }), table({}, { locale: null }), table({}, { locale: undefined }),
    table({ "": "Bad" }), table({ "names..2": "Bad" }), table({ "names.__proto__.injected": "Bad" }),
    table({ "names.constructor": "Bad" }), table({ "prototype.name": "Bad" }),
    table({ names: "Parent", "names.2": "Child" }), table({ "names.2": "Child", names: "Parent" }),
    table({ "names.2": [] }), table({ "names.2": 3 }), table({ "names.2": false }), table({ "names.2": { "en-US": "Old row format" } }),
    JSON.parse('{"version":1,"namespace":"effectPlayer","locale":"en-us","translations":{"__proto__":"Bad"}}'),
  ]) assert.throws(() => parse(invalid));
  assert.throws(() => parseTranslationTable(table({}), "__proto__", source.locale));
  assert.throws(() => parseTranslationTable(table({}), source.namespace, "en_US"));
  assert.equal({}.injected, undefined);
  const inherited = parse(table({ "names.toString.remoteI18nProbe": "Safe name" }));
  assert.equal(inherited.messages.names.toString.remoteI18nProbe, "Safe name");
  assert.equal(Object.prototype.toString.remoteI18nProbe, undefined, "Intermediate path segments must never mutate inherited properties");
}

async function textAndMessages() {
  const literal = "Mage's @ aura {rank} | {'quoted'} \\ spark\nNext line";
  assert.equal(messageSearchText(escapeMessageText(literal)), literal);
  const flat = setup([
    response({ "effectPlayer.data.10001": literal, "effectPlayer.category.1": "Environment" }),
    response({ "effectPlayer.data.10001": "风声", "effectPlayer.category.1": "环境" }),
    response({}),
  ]);
  assert.equal((await flat.loader.load(source)).status, "loaded");
  assert.equal(flat.composer.t("effectPlayer.data.10001"), literal);
  assert.equal(flat.composer.t("effectPlayer.category.1"), "Environment");
  await flat.loader.load(chineseSource);
  flat.composer.locale.value = "zh-CN";
  assert.equal(flat.composer.t("effectPlayer.data.10001"), "风声");
  assert.equal(flat.composer.t("effectPlayer.category.1"), "环境");
  await flat.loader.load(chineseSource);
  assert.equal(flat.composer.t("effectPlayer.data.10001"), "effectPlayer.data.10001");
  flat.composer.locale.value = "en-US";
  assert.equal(flat.composer.t("effectPlayer.data.10001"), literal);
  const { composer, loader } = setup([response(table({ "names.2": literal })), response(table({
    greeting: "Hello, {name}", count: "One effect | {count} effects",
  }, { format: "message" }))]);
  assert.deepEqual(await loader.load(source), { status: "loaded", namespace: source.namespace, locale: source.locale, entries: 1 });
  assert.equal(composer.t("effectPlayer.names.2"), literal, "Text format preserves message punctuation literally");
  await loader.load(source);
  assert.equal(composer.t("effectPlayer.greeting", { name: "Luna" }), "Hello, Luna");
  assert.equal(composer.t("effectPlayer.count", { count: 2 }, 2), "2 effects");
}

async function concurrencyAndIsolation() {
  let resolveFirst;
  const pending = new Promise((resolve) => { resolveFirst = resolve; });
  const other = { namespace: "soundPlayer", locale: "en-US", url: "/SoundPlayer/i18n/en-us.json?revision=2" };
  const { composer, loader, calls } = setup([() => pending,
    response(chineseTable({ "names.2": "中文特效" })),
    response(table({ "names.2": "Sound" }, { namespace: other.namespace })),
    response(table({ "names.2": "Effect updated" })),
  ], { "en-US": { common: { save: "Save" } } });
  const first = loader.load(source);
  assert.equal(first, loader.load({ ...source }), "Concurrent loads share the request Promise");
  assert.equal(calls.length, 1);
  assert.equal((await loader.load({ ...source, url: "/another.json" })).status, "failed");
  assert.equal(calls.length, 1, "One namespace and locale pair cannot race multiple translation sources");
  assert.deepEqual(await loader.load(chineseSource), { status: "loaded", namespace: source.namespace, locale: "zh-CN", entries: 1 }, "Different languages in the same namespace may load concurrently");
  assert.match(calls[1].url, /\/i18n\/zh-cn\.json\?_t=\d+$/);
  assert.equal((await loader.load(other)).status, "loaded", "Independent namespaces may load concurrently");
  assert.match(calls[2].url, /\?revision=2&_t=\d+$/);
  resolveFirst(response(table({ "names.2": "Effect" })));
  assert.equal((await first).status, "loaded");
  assert.equal(composer.t("effectPlayer.names.2"), "Effect");
  assert.equal(composer.t("soundPlayer.names.2"), "Sound");
  assert.equal(composer.t("common.save"), "Save");
  await loader.load(source);
  assert.equal(calls.length, 4, "Completed loads revalidate on the next call");
  assert.equal(composer.t("effectPlayer.names.2"), "Effect updated");
  assert.equal(composer.t("soundPlayer.names.2"), "Sound");
  composer.locale.value = "zh-CN";
  assert.equal(composer.t("effectPlayer.names.2"), "中文特效", "English refresh leaves the Chinese snapshot intact");
  assert.match(calls[0].url, /\/i18n\/en-us\.json\?_t=\d+$/);
  assert.equal(calls[0].options.cache, "no-store");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
}

async function snapshotReplacement() {
  const { composer, loader } = setup([
    response(table({ title: "Remote title", "names.2": "First", "names.3": "Removed" })),
    response(chineseTable({ "names.2": "初版", "names.3": "保留中文" })),
    response(table({ "names.2": "Updated", "names.3": "  ", "names.4": null })),
    response(null, 404), response(table({ "names.2": "Uploaded again" })), response(null, 404),
  ], { "en-US": { effectPlayer: { title: "Local title", tags: { 4: "Local tag" } } }, "zh-CN": { effectPlayer: { title: "本地标题" } } });
  await loader.load(source);
  assert.equal(composer.t("effectPlayer.title"), "Remote title");
  await loader.load(chineseSource);
  await loader.load(source);
  assert.equal(composer.t("effectPlayer.names.2"), "Updated");
  assert.equal(composer.t("effectPlayer.names.3"), "effectPlayer.names.3", "Removed or empty cells delete obsolete translations");
  assert.equal(composer.t("effectPlayer.title"), "Local title", "Removing remote overrides restores the baseline");
  assert.equal(composer.t("effectPlayer.tags.4"), "Local tag");
  composer.locale.value = "zh-CN";
  assert.equal(composer.t("effectPlayer.names.2"), "初版", "Refreshing English preserves Chinese messages");
  assert.equal(composer.t("effectPlayer.names.3"), "保留中文");
  assert.equal(composer.t("effectPlayer.title"), "本地标题");
  composer.locale.value = "en-US";
  assert.deepEqual(await loader.load(source), { status: "missing", namespace: source.namespace, locale: source.locale });
  assert.equal(composer.t("effectPlayer.names.2"), "effectPlayer.names.2", "404 clears the remote snapshot");
  assert.equal(composer.t("effectPlayer.title"), "Local title");
  composer.locale.value = "zh-CN";
  assert.equal(composer.t("effectPlayer.names.2"), "初版", "English 404 does not clear Chinese translations");
  composer.locale.value = "en-US";
  assert.equal((await loader.load(source)).status, "loaded");
  assert.equal(composer.t("effectPlayer.names.2"), "Uploaded again", "404 never prevents a later upload from being read");
  assert.deepEqual(await loader.load(chineseSource), { status: "missing", namespace: source.namespace, locale: "zh-CN" });
  assert.equal(composer.t("effectPlayer.names.2"), "Uploaded again", "Chinese 404 leaves English translations intact");
  composer.locale.value = "zh-CN";
  assert.equal(composer.t("effectPlayer.names.2"), "effectPlayer.names.2", "Missing Chinese must not fall back to the available English name");
  assert.equal(composer.t("effectPlayer.title"), "本地标题");
}

async function failuresAndRetry() {
  const { composer, loader, calls } = setup([new TypeError("Network unavailable"), response(null, 503),
    { status: 200, ok: true, json: async () => { throw new SyntaxError("Invalid JSON"); } },
    response(table({ "names.2": "Last good value" })),
    response(table({ "names.2": "Must never leak", "names.3": false })),
    response(table({ "names.2": "Wrong namespace" }, { namespace: "otherPage" })),
    response(table({ "names.2": "Wrong language" }, { locale: "zh-cn" })), response(null, 500),
    response(table({ "names.2": "Recovered" })),
  ]);
  for (let i = 0; i < 3; i++) {
    const result = await loader.load(source);
    assert.equal(result.status, "failed"); assert.ok(result.error instanceof Error);
    assert.equal(result.namespace, source.namespace); assert.equal(result.locale, source.locale);
  }
  assert.equal((await loader.load(source)).status, "loaded");
  for (let i = 0; i < 4; i++) {
    assert.equal((await loader.load(source)).status, "failed");
    assert.equal(composer.t("effectPlayer.names.2"), "Last good value", "Validation and transient failures preserve the complete snapshot");
    assert.equal(composer.t("effectPlayer.names.3"), "effectPlayer.names.3");
  }
  assert.equal((await loader.load(source)).status, "loaded");
  assert.equal(composer.t("effectPlayer.names.2"), "Recovered");
  assert.equal(calls.length, 9, "Failures leave the loader retryable");
}

async function timeout() {
  let observedSignal;
  const { composer, loader, calls } = setup([(_url, { signal }) => new Promise((_resolve, reject) => {
    observedSignal = signal;
    signal.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")), { once: true });
  }), response(table({ "names.2": "After timeout" }))], {}, 5);
  const result = await loader.load(source);
  assert.equal(result.status, "failed");
  assert.equal(result.error.name, "AbortError");
  assert.equal(observedSignal.aborted, true);
  assert.equal((await loader.load(source)).status, "loaded");
  assert.equal(composer.t("effectPlayer.names.2"), "After timeout");
  assert.equal(calls.length, 2, "Timeouts do not leave stale in-flight requests");
}

async function reactiveSearch() {
  const literal = "Dust @ Gate {A} | Burst";
  const { composer, loader } = setup([response(table({ "data.2": literal, "tags.4": "Remote Spark" })),
    response(chineseTable({ "data.2": "远程白色烟尘" })), response(table({ "data.2": "Fresh Snow" })), response(chineseTable({})),
  ]);
  const items = [{ id: 2, title: "原始标题", name: "source_effect", tagList: [4] }];
  const title = computed(() => composer.t("effectPlayer.data.2"));
  const index = computed(() => buildEffectSearchIndex(items, { 4: "原始标签" }, Object.values(composer.messages.value)));
  assert.equal(title.value, "effectPlayer.data.2");
  assert.equal(index.value.get("2").includes("dust"), false);
  assert.ok(index.value.get("2").includes("source_effect"));
  assert.ok(index.value.get("2").includes("原始标签"));
  await loader.load(source);
  assert.equal(title.value, literal, "Rendered names update after the remote request");
  assert.ok(index.value.get("2").includes(literal.toLowerCase()), "Escaped storage messages are searchable by visible text");
  assert.equal(index.value.get("2").includes("远程白色烟尘"), false, "Unloaded languages have no remote search entries");
  await loader.load(chineseSource);
  assert.ok(index.value.get("2").includes("远程白色烟尘"));
  assert.ok(index.value.get("2").includes("remote spark"));
  const englishIndex = index.value;
  composer.locale.value = "zh-CN";
  assert.equal(title.value, "远程白色烟尘");
  assert.equal(index.value, englishIndex, "Display language does not discard the multilingual index");
  await loader.load(source);
  assert.equal(title.value, "远程白色烟尘", "Refreshing English preserves the displayed Chinese name");
  assert.ok(index.value.get("2").includes("fresh snow"));
  assert.equal(index.value.get("2").includes("dust"), false);
  assert.equal(index.value.get("2").includes("remote spark"), false);
  assert.ok(index.value.get("2").includes("原始标题"));
  await loader.load(chineseSource);
  assert.equal(title.value, "effectPlayer.data.2", "Missing Chinese does not fall back to English");
  assert.equal(index.value.get("2").includes("远程白色烟尘"), false, "Empty Chinese snapshots remove their old search entries");
  assert.ok(index.value.get("2").includes("fresh snow"), "Deleting Chinese search entries preserves loaded English names");
}

async function translatedFiltersKeepSelections() {
  const catalogs = require("../src/i18n/index.ts").createAppI18n().global;
  const englishMessages = catalogs.getLocaleMessage("en-US").effectPlayer;
  const chineseMessages = catalogs.getLocaleMessage("zh-CN").effectPlayer;
  const { composer, loader } = setup([
    response(table({ "category.1": "Remote element family", "category.2": "Remote custom group", "tags.1": "Remote wind" })),
    response(chineseTable({ "category.1": "远程元素类别", "category.2": "远程自定义类别", "tags.1": "远程风元素" })),
    response(chineseTable({ "category.1": "更新的元素类别", "category.2": "更新的自定义类别", "tags.1": "更新的风元素" })),
    response(chineseTable({})),
  ], { "en-US": { effectPlayer: englishMessages }, "zh-CN": { effectPlayer: chineseMessages } });
  // Categories use the complete keys from data.json directly.
  const sourceGroups = buildEffectTagGroups({ 1: "原始风", 2: "原始火", 3: "原始自定义" }, { "effectPlayer.category.1": [1, 2], "effectPlayer.category.2": [3] });
  const selection = Object.freeze([1, 2, 3]);
  const items = [
    { id: 10, tagList: [1, 3] }, { id: 20, tagList: [2, 3] },
    { id: 30, tagList: [1] }, { id: 40, tagList: [3] },
  ];
  const groups = computed(() => sourceGroups.map((group) => ({
    ...group, name: composer.t(group.name),
    tags: group.tags.map((tag) => ({ ...tag, name: composer.t(`effectPlayer.tags.${tag.id}`) })),
  })));
  const matchingIds = computed(() => items.filter((item) => matchesEffectTagGroups(item, selection, groups.value)).map((item) => item.id));
  const baselineCounts = countEffectTags(items, sourceGroups);
  const unchangedSelection = () => {
    assert.deepEqual(selection, [1, 2, 3]);
    assert.deepEqual(matchingIds.value, [10, 20], "Localized labels preserve ID-based OR/AND filtering");
    assert.deepEqual(groups.value.map(({ id, tags }) => ({ id, ids: tags.map((tag) => tag.id) })),
      sourceGroups.map(({ id, tags }) => ({ id, ids: tags.map((tag) => tag.id) })));
    assert.deepEqual(countEffectTags(items, groups.value), baselineCounts, "Translation changes do not affect category/tag counts");
  };
  unchangedSelection();
  assert.equal(groups.value[0].name, "effectPlayer.category.1", "Categories show keys until OSS translations load");
  assert.equal(composer.te("effectPlayer.category.属性"), false, "No bundled legacy category translations remain");
  assert.equal(composer.t("effectPlayer.filter.open"), englishMessages.filter.open);
  await loader.load(source);
  assert.equal(groups.value[0].name, "Remote element family");
  assert.equal(groups.value[1].name, "Remote custom group", "Custom category keys render through Vue I18n");
  assert.equal(groups.value[0].tags[0].name, "Remote wind");
  assert.equal(composer.t("effectPlayer.filter.open"), englishMessages.filter.open, "Site UI retains its local translation");
  unchangedSelection();
  await loader.load(chineseSource);
  composer.locale.value = "zh-CN";
  assert.equal(groups.value[0].name, "远程元素类别");
  assert.equal(groups.value[1].name, "远程自定义类别");
  assert.equal(groups.value[0].tags[0].name, "远程风元素");
  assert.equal(composer.t("effectPlayer.filter.open"), chineseMessages.filter.open);
  unchangedSelection();
  await loader.load(chineseSource);
  assert.equal(groups.value[0].name, "更新的元素类别");
  assert.equal(groups.value[1].name, "更新的自定义类别");
  assert.equal(groups.value[0].tags[0].name, "更新的风元素");
  assert.equal(composer.t("effectPlayer.filter.open"), chineseMessages.filter.open);
  unchangedSelection();
  composer.locale.value = "en-US";
  assert.equal(groups.value[0].name, "Remote element family", "Refreshing Chinese preserves English labels");
  unchangedSelection();
  composer.locale.value = "zh-CN";
  await loader.load(chineseSource);
  assert.equal(groups.value[0].name, "effectPlayer.category.1", "Deleted category translations have no local fallback");
  unchangedSelection();
}

async function shippedExamplesCompile() {
  const examples = [source, chineseSource].map((entry) => ({
    source: entry,
    table: JSON.parse(fs.readFileSync(path.join(__dirname, "../examples/i18n", `${entry.locale.toLowerCase()}.json`), "utf8")),
  }));
  const { composer, loader } = setup(examples.map((example) => response(example.table)));
  for (const example of examples) {
    for (const key of ["category.1", "tags.1"]) {
      assert.equal(typeof example.table.translations[key], "string", `${example.source.locale} example must demonstrate ${key}`);
    }
    assert.ok(Object.keys(example.table.translations).every((key) => !key.startsWith("filter.")), "Site UI translations stay in local catalogs");
    const result = await loader.load(example.source);
    assert.equal(result.status, "loaded", `${example.source.locale} example must satisfy the remote contract`);
    composer.locale.value = example.source.locale;
    const compileErrors = [];
    const originalError = console.error;
    try {
      console.error = (...args) => compileErrors.push(args);
      for (const [key, message] of Object.entries(example.table.translations)) {
        const fullKey = `effectPlayer.${key}`;
        if (typeof message !== "string" || !message.trim()) {
          assert.equal(composer.t(fullKey), fullKey, `${fullKey} empty example cells remain missing`);
          continue;
        }
        const params = Object.fromEntries([...message.matchAll(/\{(\w+)\}/g)].map((match) => [match[1], 2]));
        const translated = composer.t(fullKey, params, 2);
        assert.notEqual(translated, fullKey, `${example.source.locale}/${fullKey} must compile`);
        if (example.table.format !== "message") assert.equal(translated, message, "Text examples preserve their exact visible labels");
      }
    } finally {
      console.error = originalError;
    }
    assert.deepEqual(compileErrors, [], `${example.source.locale} example messages must compile without errors`);
  }
}

async function main() {
  validateFormat();
  await textAndMessages();
  await concurrencyAndIsolation();
  await snapshotReplacement();
  await failuresAndRetry();
  await timeout();
  await reactiveSearch();
  await translatedFiltersKeepSelections();
  await shippedExamplesCompile();
  console.log("PASS remote i18n: per-language files, validation, text and messages, concurrency and isolation, snapshots, retry, timeout, multilingual search, stable translated filters, and shipped examples");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
