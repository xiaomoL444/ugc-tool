/* node scripts/test-client-ui-i18n.cjs [resource-i18n-dir]
 * Fixed UI follows I18N.md: flat full semantic keys, local messages and normal
 * Vue I18n interpolation. Maintenance evidence contains the unescaped text.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { computed } = require('vue');
const { parse: parseSfc } = require('@vue/compiler-sfc');
const { parse: parseTemplate } = require(require.resolve('@vue/compiler-dom', {
  paths: [path.dirname(require.resolve('@vue/compiler-sfc'))],
}));

const namespace = 'clientUIAnimationEditor';
const locales = ['zh-cn', 'zh-tw', 'en-us', 'ja-jp', 'ru-ru'];
const composerLocales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ru-RU'];
const repository = path.resolve(__dirname, '..');
const editorDirectory = path.join(repository, 'src/views/ClientUIAnimationEditor');
const bundledDirectory = path.join(repository, 'src/i18n/locales/clientUIAnimationEditor');
const resourceDirectory = path.resolve(process.argv[2] || 'H:/mihoyo Assets/GenshinAsserts/UGCAsserts/UGC_ClientUIAnimationEditor/i18n');
const manifestFile = path.resolve(resourceDirectory, '../translation-source/source-map.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
assert.ok(Array.isArray(manifest.sources), 'Maintenance source-map has its sources array');
const byKey = new Map(manifest.sources.map(entry => [entry.key, entry]));
assert.equal(byKey.size, manifest.sources.length, 'Maintenance full keys are unique');
const semanticKey = /^clientUIAnimationEditor\.(?:ui\.[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*|category\.\d+)$/;
const namedTokens = text => [...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(match => match[1]).sort();
const interpolateRaw = (text, params) => text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
  (token, name) => Object.hasOwn(params, name) ? String(params[name] ?? '') : token);
const testParams = text => Object.fromEntries(namedTokens(text).map(name => [name, `value_${name}@$&|\\{literal}`]));
function keyForSource(source) {
  const entry = manifest.sources.find(item => item.source === source);
  assert.ok(entry, `Known semantic fixture has maintenance evidence: ${source}`);
  return entry.key;
}

function readCatalog(file) {
  const bytes = fs.readFileSync(file);
  assert.ok(!(bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191), `${file}: UTF-8 without BOM`);
  const text = bytes.toString('utf8');
  const ast = ts.parseJsonText(file, text);
  const properties = ast.statements[0]?.expression?.properties;
  assert.ok(properties, `${file}: JSON object dictionary`);
  const writtenKeys = properties.map(property => property.name.text);
  assert.equal(new Set(writtenKeys).size, writtenKeys.length, `${file}: no duplicate JSON properties`);
  const catalog = JSON.parse(text);
  for (const [key, translation] of Object.entries(catalog)) {
    assert.match(key, semanticKey, `${file}: full semantic key, without metadata/hash wrapper`);
    assert.ok(typeof translation === 'string' && translation.trim(), `${file}/${key}: nonempty translation`);
  }
  return catalog;
}

const catalogs = Object.fromEntries(locales.map(locale => [locale,
  readCatalog(path.join(bundledDirectory, `${locale}.json`)),
]));
const keys = Object.keys(catalogs['zh-cn']).sort();
assert.ok(keys.length > 1000, 'The whole editor has a populated semantic catalog');
assert.deepEqual([...byKey.keys()].sort(), keys, 'Every dictionary entry has raw translation/source provenance');
for (const locale of locales) {
  const catalog = catalogs[locale];
  assert.deepEqual(Object.keys(catalog).sort(), keys, `${locale}: full five-language key coverage`);
  assert.equal(fs.readFileSync(path.join(resourceDirectory, `${locale}.json`), 'utf8'),
    fs.readFileSync(path.join(bundledDirectory, `${locale}.json`), 'utf8'), `${locale}: resource/bundled copy parity`);
  for (const key of keys) {
    const entry = byKey.get(key);
    assert.ok(typeof entry.source === 'string' && entry.source.trim(), `${key}: original source retained`);
    assert.ok(typeof entry.origin === 'string', `${key}: translation provenance retained`);
    assert.ok(Object.hasOwn(entry, 'native'), `${key}: native-key evidence retained`);
    const raw = entry.translations?.[locale];
    assert.ok(typeof raw === 'string' && raw.trim(), `${locale}/${key}: unescaped maintenance translation`);
    assert.equal(entry.translations['zh-cn'], entry.source, `${key}: maintenance Chinese retains the original source bytes`);
    if (entry.native?.used === true) {
      assert.equal(raw, entry.native.translations?.[locale], `${locale}/${key}: reused native translations preserve the complete original tuple`);
    }
    assert.deepEqual(namedTokens(raw), namedTokens(entry.translations['zh-cn']), `${locale}/${key}: placeholder occurrence counts`);
    if (['en-us', 'ru-ru'].includes(locale)) assert.doesNotMatch(raw, /\p{Script=Han}/u, `${locale}/${key}: no untranslated Chinese`);
  }
}

// Source audit treats full keys as identities. It never derives a key from text.
const referencedKeys = new Set();
const invalidCalls = [];
const uiFunctions = new Set(['t']);
function scanScript(content, file, offset = 0) {
  const ast = ts.createSourceFile(`${file}.ts`, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  function visit(node) {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && (node.text.startsWith(`${namespace}.ui.`) || node.text.startsWith(`${namespace}.category.`))) {
      referencedKeys.add(node.text);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && uiFunctions.has(node.expression.text)) {
      const argument = node.arguments[0];
      if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) && argument.text !== '' && !semanticKey.test(argument.text)) {
        invalidCalls.push({ file: path.relative(repository, file), line: offset + ast.getLineAndCharacterOfPosition(argument.getStart()).line + 1,
          function: node.expression.text, value: argument.text });
      }
      if (argument && (ts.isTemplateExpression(argument) || ts.isBinaryExpression(argument) && argument.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
        invalidCalls.push({ file: path.relative(repository, file), line: offset + ast.getLineAndCharacterOfPosition(argument.getStart()).line + 1,
          function: node.expression.text, value: argument.getText(ast), reason: 'dynamically generated UI key' });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
for (const name of fs.readdirSync(editorDirectory)) {
  const file = path.join(editorDirectory, name);
  if (name.endsWith('.ts')) scanScript(fs.readFileSync(file, 'utf8'), file);
  if (!name.endsWith('.vue')) continue;
  const { descriptor, errors } = parseSfc(fs.readFileSync(file, 'utf8'), { filename: file });
  assert.deepEqual(errors, [], `${name}: Vue syntax`);
  for (const block of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) scanScript(block.content, file, block.loc.start.line - 1);
  if (descriptor.template) {
    const template = parseTemplate(descriptor.template.content);
    function visit(node) {
      if (node.type === 5) scanScript(`(${node.content.content})`, file, descriptor.template.loc.start.line + node.loc.start.line - 2);
      for (const prop of node.props ?? []) if (prop.type === 7 && prop.exp) {
        scanScript(`(${prop.exp.content})`, file, descriptor.template.loc.start.line + prop.loc.start.line - 2);
      }
      for (const child of node.children ?? []) visit(child);
    }
    visit(template);
  }
}
for (const relative of ['src/configs/routes.ts', 'src/configs/homePage.json']) {
  const file = path.join(repository, relative);
  scanScript(fs.readFileSync(file, 'utf8'), file);
}
assert.deepEqual(invalidCalls, [], 'Static UI calls use full keys; untranslated Chinese/dynamic keys are invalid');
const missingKeys = [...referencedKeys].filter(key => !byKey.has(key));
assert.deepEqual(missingKeys, [], 'Every referenced editor full key is in the dictionary and manifest');
const unusedKeys = keys.filter(key => !referencedKeys.has(key));
const { collect } = require('./build-client-ui-i18n.cjs');
const sourceAudit = collect(manifestFile);
assert.deepEqual(sourceAudit.missingKeys, [], 'Maintenance collector reports no missing full-key references');
assert.ok(Array.isArray(sourceAudit.unusedKeys), 'Collector reports unused provenance entries for review');
for (const reference of sourceAudit.messages) {
  assert.ok(byKey.has(reference.key), `${reference.key}: collected identity is maintained`);
}
const mainSource = fs.readFileSync(path.join(editorDirectory, 'ClientUIAnimationEditor.vue'), 'utf8');
assert.doesNotMatch(mainSource, /(?:useOssTranslations|loadOssTranslations)\s*\(\s*['"]ClientUIAnimationEditor['"]/, 'Fixed editor UI has no OSS override loader');
assert.equal(fs.existsSync(path.join(repository, 'src/i18n/messages.ts')), false, 'There is no descriptor or fixed-language restoration module');
const indexSource = fs.readFileSync(path.join(repository, 'src/i18n/index.ts'), 'utf8');
assert.match(indexSource, /export const t\s*=\s*i18n\.global\.t/, 'The public entry exposes ordinary composer t');
for (const locale of locales) {
  assert.ok(indexSource.includes(`./locales/clientUIAnimationEditor/${locale}.json`), `${locale}: local dictionary is explicitly imported by the public entry`);
}
assert.match(indexSource, /flatJson\s*:\s*true/, 'Complete local keys use the project flatJson registration');
const workerSource = fs.readFileSync(path.join(editorDirectory, 'psdImport.worker.ts'), 'utf8');
assert.match(workerSource, /(?:i18n\.global\.)?locale\.value\s*=\s*data\.locale/, 'PSD Worker selects the locale received in its start request');
assert.doesNotMatch(workerSource, /\bsetLocale\s*\(|\bdocument\b|\blocalStorage\b|loadOssTranslations|loadOssTranslationDictionary/, 'Worker translation does not require browser globals or OSS dictionaries');
assert.doesNotMatch(workerSource, /messageDescriptor|uiMessage|uiText/, 'Worker replies contain ordinary strings without a descriptor channel');

const originalTsLoader = require.extensions['.ts'];
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file,
}).outputText, file);
let history;
try {
  const { i18n } = require('../src/i18n/index.ts');
  const { t } = require('../src/i18n/index.ts');
  const { describeHistoryChange } = require('../src/views/ClientUIAnimationEditor/historyChangeLabel.ts');
  const { createEditorHistory } = require('../src/views/ClientUIAnimationEditor/editorHistory.ts');
  const { validatePsdHeader } = require('../src/views/ClientUIAnimationEditor/psdImportData.ts');
  let parameterized = 0, unparameterized = 0;
  for (const [index, locale] of locales.entries()) {
    i18n.global.locale.value = composerLocales[index];
    for (const key of keys) {
      const raw = byKey.get(key).translations[locale];
      const params = testParams(raw);
      assert.ok(i18n.global.te(key), `${locale}/${key}: current locale is registered`);
      assert.equal(t(key, params), interpolateRaw(raw, params), `${locale}/${key}: standard interpolation matches maintenance text`);
      if (namedTokens(raw).length === 0) {
        assert.equal(t(key), raw, `${locale}/${key}: unparameterized output preserves every literal character`);
        unparameterized++;
      } else parameterized++;
    }
    const escapeKey = keyForSource('不支持的字符串转义 \\{escaped}。');
    const escaped = t(escapeKey, { escaped: 'q' });
    assert.equal(escaped, interpolateRaw(byKey.get(escapeKey).translations[locale], { escaped: 'q' }), `${locale}: invalid Lua escape keeps one original backslash`);
    const versionEntry = manifest.sources.find(entry => entry.source.includes('@{version}'));
    assert.ok(versionEntry, 'Runtime version fixture is present');
    assert.ok(t(versionEntry.key, { version: 'v-test' }).includes('@v-test'), `${locale}: literal @ next to a parameter survives standard compilation`);
  }

  const countKey = keyForSource('新增 {count} 个控件');
  const fontKey = keyForSource('字号');
  const addControlKey = keyForSource('新增{value}「{value2}」');
  const textControlKey = keyForSource('文本框');
  const userName = '保存';
  const live = computed(() => t(countKey, { count: 2 }));
  const field = computed(() => t(fontKey));
  const freshNested = () => t(addControlKey, { value: t(textControlKey), value2: userName });
  i18n.global.locale.value = 'zh-CN';
  const before = JSON.stringify({ nodes: [], tweenTracks: [] });
  const after = JSON.stringify({ nodes: [{ id: 'one', name: userName, type: 'text' }], tweenTracks: [] });
  const historyLabel = describeHistoryChange(before, after);
  assert.equal(typeof historyLabel, 'string', 'History records ordinary translated strings');
  history = createEditorHistory({ capture: () => after, restore: () => {}, describe: () => describeHistoryChange(before, after) });
  history.reset(before); history.observe(after); history.flush();
  assert.equal(history.entries.value[0].label, historyLabel, 'History labels save the language active when the operation occurs');
  assert.equal(Object.hasOwn(history.entries.value[0], 'message'), false, 'History has no duplicate message channel');
  const restoredHistoryLabel = JSON.parse(JSON.stringify(history.entries.value[0].label));
  const errorKey = keyForSource('图片资源库加载失败，请重试。');
  const savedError = new Error(t(errorKey));
  const workerKey = keyForSource('图层「{name}」的像素数据无效。');
  const workerFailure = new Error(t(workerKey, { name: userName }));
  const workerReply = structuredClone({ type: 'error', message: workerFailure.message });
  const savedWarnings = JSON.parse(JSON.stringify([t(countKey, { count: 2 }), freshNested()]));
  const originalWarnings = [...savedWarnings];
  assert.ok(savedWarnings.every(message => typeof message === 'string'), 'Import/export warnings save ordinary translated strings');
  assert.equal(Object.hasOwn(savedWarnings, 'messages'), false, 'Warning arrays have no parallel channel');
  const liveValues = new Set(), fontValues = new Set();
  for (const [index, locale] of locales.entries()) {
    i18n.global.locale.value = composerLocales[index];
    liveValues.add(live.value); fontValues.add(field.value);
    assert.equal(live.value, interpolateRaw(byKey.get(countKey).translations[locale], { count: 2 }), locale + ': fresh count message uses current language');
    assert.equal(freshNested(), interpolateRaw(byKey.get(addControlKey).translations[locale], {
      value: byKey.get(textControlKey).translations[locale], value2: userName,
    }), locale + ': ordinary nested translation preserves user names');
    assert.equal(history.entries.value[0].label, historyLabel, locale + ': existing history retains its creation language');
    assert.equal(restoredHistoryLabel, historyLabel, locale + ': JSON-restored history retains its original string');
    assert.deepEqual(savedWarnings, originalWarnings, locale + ': JSON-restored warnings retain their original language');
    assert.equal(savedError.message, byKey.get(errorKey).translations['zh-cn'], locale + ': an existing error remains its original string');
    assert.equal(workerReply.message, interpolateRaw(byKey.get(workerKey).translations['zh-cn'], { name: userName }), locale + ': completed Worker error remains its original string');
    assert.throws(() => validatePsdHeader(new ArrayBuffer(0)), error =>
      error instanceof Error && error.message === byKey.get(keyForSource('文件不完整，不是有效的 PSD。')).translations[locale] &&
      !Object.hasOwn(error, 'messageDescriptor'), locale + ': new validation errors use current-language Error.message');
    const nextHistory = createEditorHistory({ capture: () => after, restore: () => {}, describe: () => describeHistoryChange(before, after) });
    try {
      nextHistory.reset(before); nextHistory.observe(after); nextHistory.flush();
      assert.equal(nextHistory.entries.value[0].label, freshNested(), locale + ': new history records the current language');
    } finally { nextHistory.dispose(); }
  }
  assert.equal(liveValues.size, 5, 'Computed parameterized translations react to all five languages');
  assert.equal(fontValues.size, 5, 'Computed labels react to all five languages');

  i18n.global.locale.value = 'en-US';
  assert.equal(t(keyForSource('撤销')), 'Undo', 'Native Undo has editor semantics');
  assert.equal(t(keyForSource('关闭')), 'Close');
  assert.equal(t(keyForSource('缩放')), 'Scale', 'Transform scale is distinct from canvas zoom');
  assert.equal(t(keyForSource('中')), 'Center', 'Anchor center is distinct from medium quality');
  const missingKey = 'clientUIAnimationEditor.ui.shared.missingRegressionMessage';
  assert.equal(i18n.global.te(missingKey), false);
  assert.equal(t(missingKey, { name: userName }), missingKey, 'Unknown full key displays unchanged');
  const snapshot = JSON.parse(JSON.stringify(i18n.global.getLocaleMessage('en-US')));
  const missingMessages = JSON.parse(JSON.stringify(snapshot));
  let parent = missingMessages;
  const segments = fontKey.split('.');
  for (const segment of segments.slice(0, -1)) parent = parent[segment];
  delete parent[segments.at(-1)];
  try {
    i18n.global.setLocaleMessage('en-US', missingMessages);
    assert.equal(i18n.global.te(fontKey), false, 'te reads only the current locale');
    assert.equal(t(fontKey), fontKey, 'Deleted current-locale translation displays the full key');
    assert.equal(i18n.global.t(fontKey), fontKey, 'Global composer has no Chinese/cross-language fallback');
    assert.equal(field.value, fontKey, 'An existing computed label observes missing current-locale messages');
    i18n.global.locale.value = 'zh-CN';
    assert.equal(t(fontKey), byKey.get(fontKey).translations['zh-cn'], 'Other locale still retains its own translation');
  } finally {
    i18n.global.setLocaleMessage('en-US', snapshot);
    i18n.global.locale.value = 'zh-CN';
  }
  console.log(`PASS ${keys.length} flat semantic keys × 5 locales; ${unparameterized} literal and ${parameterized} parameterized renders, raw maintenance parity, source references, ordinary interpolation, user data, stable saved history/warnings/errors and JSON/Worker strings and missing-key behavior. Unused manifest keys: ${unusedKeys.length}.`);
} finally {
  history?.dispose();
  if (originalTsLoader) require.extensions['.ts'] = originalTsLoader;
  else delete require.extensions['.ts'];
}
