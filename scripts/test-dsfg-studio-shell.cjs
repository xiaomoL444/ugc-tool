/* Run with: node scripts/test-dsfg-studio-shell.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc');
const base = path.resolve(__dirname, '../src/views/DSFGStudio');
const components = [
  'DSFGStudio.vue', 'components/StudioEditorSession.vue', 'components/StudioSidebarContent.vue', 'components/StudioFileList.vue', 'components/StudioIcon.vue', 'components/StudioCreateDialog.vue', 'components/StudioWorkspaceSelect.vue',
  'components/DialogueEditor/DialogueEditor.vue', 'components/QuestEditor/QuestEditor.vue', 'components/QuestEditor/QuestPanel.vue',
  'components/WalkTalkEditor/WalkTalkEditor.vue', 'components/SceneEditor/SceneEditor.vue', 'components/EntityPresetEditor/EntityPresetEditor.vue',
  'components/CameraEditor/CameraEditor.vue',
];
for (const file of components) {
  const filename = path.join(base, file);
  const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  assert.deepEqual(errors, []);
  const script = compileScript(descriptor, { id: 'studio-shell-test' });
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: 'studio-shell-test', compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
  for (const style of descriptor.styles) assert.deepEqual(compileStyle({ source: style.content, filename, id: 'studio-shell-test', scoped: style.scoped }).errors, []);
}
const cssFile = path.join(base, 'studioShell.css');
const css = fs.readFileSync(cssFile, 'utf8');
const compiledStyle = compileStyle({ source: css, filename: cssFile, id: 'studio-shell-test' });
assert.deepEqual(compiledStyle.errors, []);
// Guard against changing the App header or other pages through global selectors.
compiledStyle.rawResult.root.walkRules(rule => {
  for (const selector of rule.selectors) assert.ok(selector.startsWith('#app .dsfg-studio'), selector);
});
console.log('PASS All shell/editor components compile; theme selectors stay inside DSFG Studio');

const cache = new Map();
function load(relative) {
  const filename = path.join(base, relative);
  if (cache.has(filename)) return cache.get(filename);
  let source = fs.readFileSync(filename, 'utf8');
  if (filename.endsWith('.vue')) {
    source = compileScript(parse(source, { filename }).descriptor, { id: 'sidebar-runtime', inlineTemplate: true }).content;
  }
  const module = { exports: {} };
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports, require(name) {
    if (name === 'vue') return vue;
    if (name === './studioSidebar') return load('components/studioSidebar.ts');
    if (name === './studioSessionHistory') return load('components/studioSessionHistory.ts');
    throw new Error(`Unexpected dependency ${name}`);
  } }, { filename });
  cache.set(filename, module.exports);
  return module.exports;
}
const Portal = load('components/StudioSidebarContent.vue').default;
const SessionHost = load('components/StudioEditorSession.vue').default;
const { studioSidebarKey } = load('components/studioSidebar.ts');
function element(tag, text = '') { return { tag, text, parent: null, children: [], props: {}, style: {} }; }
function detach(node) {
  if (!node.parent) return;
  const siblings = node.parent.children;
  siblings.splice(siblings.indexOf(node), 1);
  node.parent = null;
}
const sidebar = element('aside');
const body = element('body');
const renderer = vue.createRenderer({
  createElement: tag => element(tag), createText: text => element('#text', text), createComment: text => element('#comment', text),
  setText(node, text) { node.text = text; }, setElementText(node, text) { node.children = []; node.text = text; },
  parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
  insert(node, parent, anchor) { detach(node); const index = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(index < 0 ? parent.children.length : index, 0, node); node.parent = parent; },
  remove: detach, patchProp(node, key, before, after) { node.props[key] = after; },
  setScopeId() {}, querySelector: selector => selector === 'body' ? body : sidebar,
});
function buttons(node) { return [...(node.tag === 'button' ? [node] : []), ...node.children.flatMap(buttons)]; }

async function main() {
  const pickerFile = path.join(base, 'components/StudioWorkspaceSelect.vue');
  const pickerSource = parse(fs.readFileSync(pickerFile, 'utf8'), { filename: pickerFile }).descriptor.scriptSetup.content;
  const pickerAst = ts.createSourceFile('picker.ts', pickerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const pickerScript = ts.transpileModule(pickerAst.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(pickerAst)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const props = vue.reactive({ modelValue: '默认工作区', workspaces: ['默认工作区', '测试工作区', '视频例子'], disabled: false });
  const emits = [], listeners = [], removed = [], mounted = [], unmounted = [];
  const doc = { activeElement: null, addEventListener: (...args) => listeners.push(args), removeEventListener: (...args) => removed.push(args) };
  const choices = props.workspaces.map(id => ({ id, focus() { doc.activeElement = this; } }));
  const trigger = { focus() { doc.activeElement = this; } };
  const pickerRoot = { contains: node => node === trigger || choices.includes(node) };
  const scope = vue.effectScope();
  const context = vm.createContext({ ...vue, ref: vue.shallowRef, document: doc,
    defineProps: () => props, withDefaults: value => value, defineEmits: () => (...args) => emits.push(args),
    onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => unmounted.push(fn) });
  scope.run(() => vm.runInContext(`${pickerScript}\nglobalThis.picker = { root, trigger, menu, open, show, close, select, onMenuKeydown, onFocusOut, onPointerDown };`, context));
  const picker = context.picker;
  picker.root.value = pickerRoot; picker.trigger.value = trigger; picker.menu.value = { querySelectorAll: () => choices };
  mounted.forEach(fn => fn());
  await picker.show(); assert.equal(doc.activeElement, choices[0]);
  const key = value => picker.onMenuKeydown({ key: value, preventDefault() {} });
  key('End'); assert.equal(doc.activeElement, choices[2]);
  key('ArrowDown'); assert.equal(doc.activeElement, choices[0]);
  key('ArrowUp'); assert.equal(doc.activeElement, choices[2]);
  key('Home'); assert.equal(doc.activeElement, choices[0]);
  picker.select('测试工作区'); assert.deepEqual(emits, [['select', '测试工作区']]);
  assert.equal(props.modelValue, '默认工作区', 'A pending or failed parent save keeps the previous selection');
  assert.equal(picker.open.value, false); assert.equal(doc.activeElement, trigger);
  await picker.show(true); assert.equal(doc.activeElement, choices[2]);
  key('Tab'); assert.equal(picker.open.value, false); assert.equal(doc.activeElement, trigger);
  await picker.show(); picker.onPointerDown({ composedPath: () => [pickerRoot] }); assert.equal(picker.open.value, true);
  picker.onPointerDown({ composedPath: () => [] }); assert.equal(picker.open.value, false);
  await picker.show(); picker.onFocusOut({ relatedTarget: choices[1] }); assert.equal(picker.open.value, true);
  picker.onFocusOut({ relatedTarget: null }); assert.equal(picker.open.value, false);
  await picker.show(); props.disabled = true; await vue.nextTick(); assert.equal(picker.open.value, false);
  await picker.show(); picker.select('视频例子'); assert.equal(picker.open.value, false); assert.equal(emits.length, 1);
  props.disabled = false; props.workspaces = []; await vue.nextTick(); await picker.show(); key('ArrowDown'); picker.select('missing'); assert.equal(emits.length, 1);
  unmounted.forEach(fn => fn()); scope.stop(); assert.deepEqual(removed, listeners);
  console.log('PASS Workspace picker keyboard navigation, outside dismissal, controlled selection, disabled/empty states and listener cleanup');

  const target = vue.shallowRef();
  const selected = vue.ref('dialogue');
  const busy = vue.ref(false);
  let clicks = 0;
  const app = renderer.createApp({ setup() {
    vue.provide(studioSidebarKey, target);
    return () => vue.h('main', [vue.h(Portal, { key: selected.value }, { default: () => vue.h('button', { inert: busy.value, onClick: () => clicks++ }, selected.value) })]);
  } });
  const root = element('root');
  app.mount(root);
  assert.equal(buttons(root).length, 1);
  target.value = sidebar;
  await vue.nextTick();
  assert.equal(buttons(root).length, 0);
  assert.equal(buttons(sidebar).length, 1);
  assert.equal(buttons(sidebar)[0].text, 'dialogue');
  buttons(sidebar)[0].props.onClick();
  assert.equal(clicks, 1);
  console.log('PASS The actual portal moves navigation into the shared sidebar and retains events');

  busy.value = true;
  await vue.nextTick();
  assert.equal(buttons(sidebar)[0].props.inert, true);
  selected.value = 'quest';
  await vue.nextTick();
  assert.equal(buttons(sidebar).length, 1);
  assert.equal(buttons(sidebar)[0].text, 'quest');
  assert.equal(buttons(sidebar)[0].props.inert, true);
  busy.value = false;
  await vue.nextTick();
  assert.equal(buttons(sidebar)[0].props.inert, false);
  console.log('PASS Switching editors replaces old navigation and preserves reactive disabled state');
  app.unmount();
  assert.equal(sidebar.children.length, 0);
  console.log('PASS Closing the editor removes all teleported navigation and anchors');

  const fallback = element('standalone');
  const standalone = renderer.createApp({ render: () => vue.h(Portal, null, { default: () => vue.h('button', 'local navigation') }) });
  standalone.mount(fallback);
  assert.equal(buttons(fallback)[0].text, 'local navigation');
  assert.equal(buttons(body).length, 0);
  standalone.unmount();
  console.log('PASS Outside the studio shell, navigation renders locally rather than leaking into body');

  const activeModule = vue.ref('Dialogue');
  let mounts = 0, disposals = 0;
  const CachedEditor = vue.defineComponent({ props: ['editorKind'], setup(props) {
    const edits = vue.ref(0);
    vue.onMounted(() => mounts++); vue.onBeforeUnmount(() => disposals++);
    return () => vue.h(Portal, null, { default: () => vue.h('button', { onClick: () => edits.value++ }, `${props.editorKind}:${edits.value}`) });
  } });
  const cachedRoot = element('cached');
  const cached = renderer.createApp({ setup() {
    vue.provide(studioSidebarKey, target);
    return () => vue.h('main', ['Dialogue', 'Quest'].map(kind => vue.h(SessionHost, {
      key: kind, kind, editor: CachedEditor, active: activeModule.value === kind,
    })));
  } });
  cached.mount(cachedRoot); await vue.nextTick();
  const cachedButtons = () => buttons(sidebar);
  cachedButtons().find(node => node.text === 'Dialogue:0').props.onClick(); await vue.nextTick();
  activeModule.value = 'Quest'; await vue.nextTick();
  const hiddenDialogue = cachedButtons().find(node => node.text === 'Dialogue:1');
  assert.equal(hiddenDialogue.parent.props.inert, true);
  assert.equal(hiddenDialogue.parent.style.display, 'none');
  assert.equal(cachedButtons().find(node => node.text === 'Quest:0').parent.props.inert, false);
  activeModule.value = 'Dialogue'; await vue.nextTick();
  assert.equal(hiddenDialogue.parent.props.inert, false);
  assert.equal(hiddenDialogue.parent.style.display, undefined);
  assert.equal(mounts, 2); assert.equal(disposals, 0, 'Switching keeps both editor instances and their local state');
  cached.unmount(); assert.equal(disposals, 2); assert.equal(sidebar.children.length, 0);
  console.log('PASS Cached editors retain state while inactive sidebar content is hidden and inert; unmount removes all sessions');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
