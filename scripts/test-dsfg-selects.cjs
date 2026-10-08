const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc');
const base = path.resolve(__dirname, '../src/views/DSFGStudio');
const originalLoad = Module._load;
const originals = Object.fromEntries(['.ts', '.vue', '.css'].map(ext => [ext, Module._extensions[ext]]));
let selection;
Module._load = function(request, parent, isMain) {
  if (request === 'naive-ui') return { NSelect: vue.defineComponent({
    props: ['value', 'options', 'disabled', 'themeOverrides', 'menuProps'],
    setup(props, { attrs }) { return () => { selection = { props, attrs }; return vue.h('field'); }; },
  }) };
  return originalLoad.call(this, request, parent, isMain);
};
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
Module._extensions['.ts'] = (mod, filename) => mod._compile(compile(fs.readFileSync(filename, 'utf8')), filename);
Module._extensions['.css'] = () => {};
Module._extensions['.vue'] = (mod, filename) => {
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  mod._compile(compile(compileScript(descriptor, { id: 'select-test', inlineTemplate: true }).content), filename);
};
function element(tag) { return { tag, children: [], parent: null }; }
const renderer = vue.createRenderer({
  createElement: element, createText: text => ({ text }), createComment: text => ({ text }),
  setText(node, text) { node.text = text; }, setElementText(node, text) { node.text = text; },
  parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  insert(node, parent, anchor) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node);
  },
  remove(node) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); },
  patchProp(node, key, oldValue, value) { (node.props ??= {})[key] = value; }, setScopeId() {},
});
async function main() {
  const Field = require(path.join(base, 'components/StudioSelectField.vue')).default;
  const model = vue.ref(0), disabled = vue.ref(false), label = vue.ref('数值零'), visible = vue.ref(true);
  const events = [];
  const app = renderer.createApp({ setup() { return () => vue.h(Field, {
    modelValue: model.value, disabled: disabled.value, 'aria-label': '测试类型',
    'onUpdate:modelValue': value => { events.push(['model', value]); model.value = value; },
    onChange: event => events.push(['change', event.target.value]),
  }, { default: () => [
    vue.h('option', { value: undefined }, '手动填写'),
    vue.h(vue.Fragment, {}, [vue.h('option', { value: 0 }, label.value), vue.h('option', { value: '0' }, '字符串零')]),
    vue.h('option', { value: false }, '布尔否'),
    visible.value ? vue.h('option', { value: 'blocked', disabled: true }, '禁用项') : vue.createCommentVNode(),
    vue.h('optgroup', { label: '分组' }, [vue.h('option', { value: 42 }, '分组数值')]),
  ] }); } });
  app.mount(element('root'));
  assert.equal(selection.props.value, 1);
  assert.equal(selection.props.menuProps['data-clip-editor'], '');
  assert.equal(selection.props.themeOverrides.peers.InternalSelection.borderRadius, '9px');
  function choose(index) { selection.attrs['onUpdate:value'](index); }
  choose(2); assert.equal(model.value, '0'); assert.deepEqual(events.slice(-2), [['model', '0'], ['change', '0']]);
  await vue.nextTick(); choose(1); assert.equal(model.value, 0);
  await vue.nextTick(); choose(3); assert.equal(model.value, false);
  await vue.nextTick(); choose(0); assert.equal(model.value, undefined);
  await vue.nextTick(); assert.equal(selection.props.value, 0);
  const count = events.length; choose(4); assert.equal(events.length, count);
  disabled.value = true; await vue.nextTick(); choose(1); assert.equal(events.length, count);
  disabled.value = false; label.value = '更名数值'; visible.value = false; await vue.nextTick();
  assert.equal(selection.props.options[1].label, '更名数值');
  assert.equal(selection.props.options.at(-1).type, 'group');
  choose(4); assert.equal(model.value, 42);
  model.value = 'missing'; await vue.nextTick(); assert.equal(selection.props.value, null);
  app.unmount();
  console.log('PASS Real field adapter: numeric/string/boolean/undefined values, model-before-change events, disabled state, groups and reactive slots');

  const EntityField = require(path.join(base, 'components/EntityPresetEditor/EntityPresetValueInput.vue')).default;
  const entityModel = vue.ref('saved-value'), entityField = vue.ref('guid');
  const entityRoot = element('root');
  const entityApp = renderer.createApp({ setup: () => () => vue.h(EntityField, {
    field: entityField.value, label: '镜头目标', modelValue: entityModel.value,
    'onUpdate:modelValue': value => { entityModel.value = value; },
  }) });
  const rows = [{ id: 'door', name: '大门', talker: '', subtitle: '', guid: '18446744073709551615', entityQuery: '门/入口' }];
  entityApp.provide('selectedWorkspaceId', vue.ref('camera-workspace'));
  entityApp.provide('storage', {
    setProject() { return this; }, async exists(file) { assert.equal(file, '/camera-workspace/EntityPresets.json'); return true; },
    async readFile() { return JSON.stringify({ kind: 'DSFGEntityPresets', schemaVersion: 1, presets: rows }); },
    async writeFile() { assert.fail('Selecting an entity must not write presets'); },
  });
  entityApp.mount(entityRoot);
  await new Promise(resolve => setImmediate(resolve)); await vue.nextTick();
  assert.equal(entityModel.value, 'saved-value');
  assert.equal(selection.props.value, null);
  assert.deepEqual(selection.props.options.map(item => item.value), ['1086324738', '18446744073709551615']);
  assert.equal(selection.props.menuProps['data-clip-editor'], '');
  selection.attrs['onUpdate:value']('18446744073709551615'); await vue.nextTick();
  assert.equal(entityModel.value, '18446744073709551615');
  entityField.value = 'entityQuery'; await vue.nextTick();
  assert.deepEqual(selection.props.options, [{ label: '大门 · 门/入口', value: '门/入口' }]);
  selection.attrs['onUpdate:value']('门/入口'); await vue.nextTick();
  assert.equal(entityModel.value, '门/入口');
  function findInput(node) { return node.tag === 'input' ? node : node.children?.map(findInput).find(Boolean); }
  findInput(entityRoot).props.onInput({ target: { value: '手动查询' } }); await vue.nextTick();
  assert.equal(entityModel.value, '手动查询');
  assert.equal(selection.props.value, null);
  entityApp.unmount();
  console.log('PASS Entity field loads workspace presets, copies exact GUID/query values, preserves old values and allows manual input');

  let checked = 0;
  function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(filename); continue; }
    if (!filename.endsWith('.vue')) continue;
    const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
    if (!descriptor.template) continue;
    function audit(node) {
      if (node.type === 1) assert.notEqual(node.tag, 'select', `${filename} still uses a browser-native dropdown`);
      for (const child of node.children ?? []) audit(child);
    }
    audit(descriptor.template.ast);
    if (!/StudioSelectField|NSelect|NTreeSelect/.test(descriptor.template.content)) continue;
    const script = compileScript(descriptor, { id: 'select-audit' });
    assert.deepEqual(compileTemplate({ filename, id: 'select-audit', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
    for (const style of descriptor.styles) assert.deepEqual(compileStyle({ filename, id: 'select-audit', source: style.content, scoped: style.scoped }).errors, []);
    checked++;
  } }
  walk(base);
  console.log(`PASS ${checked} dropdown consumer components compile; no live native select remains in DSFGStudio`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  for (const [ext, loader] of Object.entries(originals)) { if (loader) Module._extensions[ext] = loader; else delete Module._extensions[ext]; }
});
