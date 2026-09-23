/* Run with: node scripts/test-struct-i18n.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { computed } = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');

require.extensions['.ts'] = (loaded, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  });
  loaded._compile(result.outputText, filename);
};
const { createAppI18n, supportedLocales } = require('../src/i18n/index.ts');
const { ParamMetaMap } = require('../src/views/StructViewer/utils/variableTypeMap.ts');
const { appRoutes } = require('../src/configs/routes.ts');
const composer = createAppI18n().global;
const route = appRoutes.find(route => route.name === 'StructViewer');
const title = computed(() => composer.t(route.titleKey));
const type = computed(() => composer.t(ParamMetaMap.Bool.titleKey));
const historyKey = 'structViewer.ui.history.renameWorkspace';
const undo = computed(() => composer.t('structViewer.ui.undo', { action: composer.t(historyKey), count: 3 }));
const base = require('../src/i18n/locales/structViewer/zh-cn.json');
for (const { value: locale } of supportedLocales) {
  const catalog = require(`../src/i18n/locales/structViewer/${locale.toLowerCase()}.json`);
  assert.deepEqual(Object.keys(catalog).sort(), Object.keys(base).sort());
  composer.locale.value = locale;
  for (const [key, message] of Object.entries(catalog)) {
    const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(placeholders(message), placeholders(base[key]), `${locale}: ${key}`);
    const params = Object.fromEntries(placeholders(message).map(name => [name, 'sample']));
    assert.notEqual(composer.t(key, params), key);
    if (locale === 'en-US' || locale === 'ru-RU') assert.doesNotMatch(message, /\p{Script=Han}/u);
  }
  assert.notEqual(title.value, route.titleKey);
  assert.notEqual(composer.t(route.descriptionKey), route.descriptionKey);
  for (const meta of Object.values(ParamMetaMap)) assert.ok(catalog[meta.titleKey]);
  assert.ok(undo.value.includes(composer.t(historyKey)));
  assert.ok(undo.value.includes('3'));
}
composer.locale.value = 'en-US';
assert.equal(title.value, 'Struct Editor');
assert.equal(type.value, 'Boolean');
composer.locale.value = 'zh-CN';
assert.equal(type.value, '布尔值');

const root = path.resolve(__dirname, '../src/views/StructViewer');
for (const relative of ['StructViewer.vue', 'components/ParamNodeRender.vue', 'button/AddListElementButton.vue', 'button/AppendListElementButton.vue', 'button/RemoveListElementButton.vue']) {
  const filename = path.join(root, relative);
  const source = fs.readFileSync(filename, 'utf8');
  const { descriptor, errors } = parse(source, { filename });
  assert.deepEqual(errors, []);
  const script = compileScript(descriptor, { id: relative });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: relative, compilerOptions: { bindingMetadata: script.bindings, expressionPlugins: ['typescript'] } });
  assert.deepEqual(template.errors, [], relative);
  for (const [, key] of source.matchAll(/['"](structViewer\.[\w.]+)['"]/g)) assert.ok(base[key], key);
}
const viewer = fs.readFileSync(path.join(root, 'StructViewer.vue'), 'utf8');
for (const literal of ['const baseStorageKey = "结构体编辑器"', 'const baseStructKey = "高级数据管理"', 'const variableDataGroupKey = "自定义变量"']) assert.ok(viewer.includes(literal));
const renderer = fs.readFileSync(path.join(root, 'components/ParamNodeRender.vue'), 'utf8');
assert.ok(renderer.includes('value="True"'));
assert.ok(renderer.includes('value="False"'));
console.log(`PASS struct i18n: ${Object.keys(base).length} messages in five languages, live labels, history, parameter types, SFC compilation and stable storage values`);
