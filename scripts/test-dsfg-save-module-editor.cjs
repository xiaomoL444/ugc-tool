/* Run: node scripts/test-dsfg-save-module-editor.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');

const base = path.resolve(__dirname, '../src/views/DSFGStudio/components/EntityPresetEditor');
const originalLoad = Module._load;
const originalExtensions = Object.fromEntries(['.ts', '.vue', '.css'].map(extension => [extension, Module._extensions[extension]]));
const originalDocument = global.document, originalWindow = global.window;
const windowListeners = new Map();
const importedCandidates = [
  { id: 'first', name: '测试存档 [700 / 800]', values: [-2147483643, ...Array(98).fill(0), 1] },
  { id: 'second', name: '测试存档 [700 / 801]', values: [42, -1, ...Array(98).fill(0)] },
  { id: 'third', name: '测试存档 [700 / 802]', values: Array(100).fill(0) },
  { id: 'fourth', name: '测试存档 [700 / 803]', values: [-1, 0, 0, -1, -1, ...Array(94).fill(0), -2147483648] },
];
let importCalls = 0;
Module._load = function(request, parent, isMain) {
  if (path.basename(request).replace(/\.ts$/, '') === 'saveModuleGia') return {
    async importSaveModuleGia(bytes) {
      importCalls++;
      if (bytes[0] !== 1) throw new Error('测试：存档 GIA 数据无效');
      return { candidates: structuredClone(importedCandidates) };
    },
  };
  if (request === 'naive-ui') return { NSelect: vue.defineComponent({
    props: ['value', 'options', 'disabled', 'themeOverrides', 'menuProps'],
    setup(props, { attrs }) {
      return () => vue.h('select-stub', {
        label: attrs['aria-label'], value: props.value, options: props.options, disabled: props.disabled,
        choose: value => attrs['onUpdate:value'](value),
      });
    },
  }) };
  return originalLoad.call(this, request.startsWith('@/') ? path.resolve(__dirname, '../src', request.slice(2)) : request, parent, isMain);
};
const compile = (source, filename) => ts.transpileModule(source, {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
Module._extensions['.ts'] = (mod, filename) => mod._compile(compile(fs.readFileSync(filename, 'utf8'), filename), filename);
Module._extensions['.css'] = () => {};
Module._extensions['.vue'] = (mod, filename) => {
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  mod._compile(compile(compileScript(descriptor, { id: 'save-module-editor-test', inlineTemplate: true }).content, filename), filename);
};

global.document = { activeElement: null };
global.window = {
  addEventListener(name, listener, capture) {
    const listeners = windowListeners.get(name) ?? [];
    listeners.push({ listener, capture }); windowListeners.set(name, listeners);
  },
  removeEventListener(name, listener) {
    windowListeners.set(name, (windowListeners.get(name) ?? []).filter(item => item.listener !== listener));
  },
};
const hasClass = (node, name) => String(node.props?.class ?? '').split(/\s+/).includes(name);
function all(root, predicate) {
  return [...(predicate(root) ? [root] : []), ...(root.children ?? []).flatMap(child => all(child, predicate))];
}
const find = (root, predicate) => all(root, predicate)[0];
const text = node => [node.text ?? '', ...(node.children ?? []).map(text)].join('');
const input = (root, label) => find(root, node => node.tag === 'input' && node.props['aria-label'] === label);
const select = (root, label) => find(root, node => node.tag === 'select-stub' && node.props.label === label);
function query(root, selector) {
  const parts = selector.trim().split(/\s+/);
  function matches(node, part) {
    if (!node.tag) return false;
    const tag = part.match(/^[a-z][\w-]*/i)?.[0];
    if (tag && node.tag !== tag) return false;
    for (const match of part.matchAll(/\.([\w-]+)/g)) if (!hasClass(node, match[1])) return false;
    for (const match of part.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]/g)) {
      if (node.props[match[1]] === undefined || (match[2] !== undefined && String(node.props[match[1]]) !== match[2])) return false;
    }
    if (part.includes(':last-child') && node.parent?.children.filter(child => child.tag).at(-1) !== node) return false;
    return true;
  }
  return all(root, node => {
    if (!matches(node, parts.at(-1))) return false;
    let ancestor = node.parent;
    for (let index = parts.length - 2; index >= 0; index--) {
      while (ancestor && !matches(ancestor, parts[index])) ancestor = ancestor.parent;
      if (!ancestor) return false;
      ancestor = ancestor.parent;
    }
    return true;
  });
}
function element(tag) {
  return { tag, tagName: tag.toUpperCase(), children: [], parent: null, props: {}, events: new Map(),
    style: { display: '' }, value: '',
    addEventListener(name, callback) {
      const listeners = this.events.get(name) ?? [];
      listeners.push(callback); this.events.set(name, listeners);
    },
    removeEventListener(name, callback) { this.events.set(name, (this.events.get(name) ?? []).filter(listener => listener !== callback)); },
    querySelector(selector) { return query(this, selector)[0]; },
    querySelectorAll(selector) { return query(this, selector); },
    getAttribute(name) { return this.props[name] ?? null; },
    setAttribute(name, value) { this.props[name] = String(value); },
    removeAttribute(name) { delete this.props[name]; },
    contains(target) { return all(this, node => node === target).length > 0; },
    matches(selector) {
      if (selector.includes('input:not')) return this.tag === 'textarea'
        || this.tag === 'input' && !['checkbox', 'radio', 'range', 'button', 'submit'].includes(this.props.type);
      return query(this, selector).includes(this);
    },
    closest(selector) {
      for (let node = this; node; node = node.parent) if (node.matches?.(selector)) return node;
      return null;
    },
    focus() { global.document.activeElement = this; },
    click() { dispatch(this, 'click'); },
  };
}
const renderer = vue.createRenderer({
  createElement: element, createText: text => ({ text, parent: null }), createComment: text => ({ text, parent: null }),
  setText(node, text) { node.text = text; }, setElementText(node, text) { node.text = text; node.children = []; },
  parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  insert(node, parent, anchor) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node);
  },
  remove(node) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = null;
  },
  patchProp(node, key, previous, value) {
    node.props[key] = value;
    if (key === 'value') node.value = value;
    if (key === 'style' && value && typeof value === 'object') Object.assign(node.style, value);
  },
  setScopeId() {},
});
function dispatch(node, name, extra = {}) {
  const event = { target: node, currentTarget: node, isComposing: false, button: 0, pointerId: 1,
    defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
  for (const { listener } of windowListeners.get(name) ?? []) listener(event);
  for (const listener of node.events.get(name) ?? []) listener(event);
  const prop = node.props[`on${name[0].toUpperCase()}${name.slice(1)}`];
  for (const listener of Array.isArray(prop) ? prop : prop ? [prop] : []) listener(event);
}
async function settle() {
  await new Promise(resolve => setImmediate(resolve)); await vue.nextTick();
  await new Promise(resolve => setImmediate(resolve)); await vue.nextTick();
}
async function change(node, value) {
  assert.ok(node, 'Expected a rendered save-module input');
  assert.ok(!node.props.disabled, 'Expected an enabled save-module input');
  node.value = String(value); dispatch(node, 'change'); await settle();
}
async function typeNumber(node, value) {
  assert.ok(node && !node.props.disabled, 'Expected an editable numeric input');
  node.value = String(value); dispatch(node, 'input'); await settle();
}
async function rename(node, value) {
  assert.ok(node && !node.props.disabled);
  node.value = value; dispatch(node, 'input'); dispatch(node, 'change'); dispatch(node, 'focusout'); await settle();
}
async function click(surface, label) {
  const button = find(surface, node => node.tag === 'button' && text(node) === label);
  assert.ok(button, `Expected ${label} action`); assert.ok(!button.props.disabled);
  dispatch(button, 'pointerdown'); dispatch(button, 'click'); dispatch(button, 'pointerup'); await settle();
}

async function main() {
  const Section = require(path.join(base, 'SaveModuleSection.vue')).default;
  const { useWorkspacePresetHistory } = require(path.join(base, 'useWorkspacePresetHistory.ts'));
  const files = new Map(), writes = [];
  let failWrites = false;
  const storage = {
    setProject() { return this; }, async exists(file) { return files.has(file); },
    async readFile(file) { assert.ok(files.has(file)); return files.get(file); },
    async writeFile(file, data) {
      if (failWrites) throw new Error('测试：存档保存失败');
      files.set(file, data); writes.push(file);
    },
  };
  const mounted = [];
  function mount(workspace = 'save-module-editor-test') {
    const Wrapper = vue.defineComponent({ setup(_, { expose }) {
      const rootElement = vue.ref(), section = vue.ref();
      const history = useWorkspacePresetHistory({ element: rootElement, activeFile: () => 'SaveModules.json', onError: error => { throw error; } });
      expose({ section, history });
      return () => vue.h('main', { ref: rootElement }, [vue.h(Section, { ref: section })]);
    } });
    const root = element('root'), app = renderer.createApp(Wrapper);
    app.provide('storage', storage); app.provide('selectedWorkspaceId', vue.ref(workspace));
    const instance = app.mount(root); mounted.push(app);
    return { root, instance, app };
  }
  const renderedBits = surface => all(surface, node => node.tag === 'button' && node.props['data-bit'] !== undefined)
    .sort((a, b) => Number(a.props['data-bit']) - Number(b.props['data-bit']));
  const binary = (surface, index = 0) => renderedBits(surface)
    .filter(node => Math.floor(Number(node.props['data-bit']) / 32) === index)
    .map(node => text(node.children.filter(child => child.tag === 'span').at(-1)).trim()).join('');
  const bit = (surface, index) => find(surface, node => node.tag === 'button' && Number(node.props['data-bit']) === index);
  const control = (surface, label) => find(surface, node => ['input', 'textarea'].includes(node.tag) && node.props['aria-label'] === label);
  const segment = (surface, name) => find(surface, node => node.tag === 'button' && node.props['aria-label'] === '查看位段 ' + name);
  const integerRow = (surface, index) => find(surface, node => node.tag === 'button'
    && (Number(node.props['data-integer-index']) === index || String(node.props['aria-label'] ?? '').startsWith('整数 ' + index + '，')));
  const selectedBits = surface => renderedBits(surface).filter(node => String(node.props['data-selected']) === 'true')
    .map(node => Number(node.props['data-bit']));
  const forbiddenLabels = /系统默认|系统预设只读|暂无系统存档模块|自定义存档模块|新建存档模块/;
  async function selectInteger(surface, index) {
    const row = integerRow(surface, index);
    assert.ok(row, 'Expected integer row ' + index); dispatch(row, 'click'); await settle();
  }
  async function chooseEndpoints(surface, first, last) {
    for (const index of [first, last]) {
      assert.ok(bit(surface, index), 'Expected global bit ' + index);
      dispatch(bit(surface, index), 'pointerdown'); dispatch(bit(surface, index), 'pointerup');
      dispatch(bit(surface, index), 'click'); await settle();
    }
  }
  async function writeDescription(surface, value) { await rename(control(surface, '位段说明'), value); }
  async function assertSelection(surface, start, length) {
    assert.equal(Number(input(surface, '起始位').value), start);
    assert.equal(Number(input(surface, '位段长度').value), length);
    const visibleSelection = renderedBits(surface).map(node => Number(node.props['data-bit']))
      .filter(index => index >= start && index < start + length);
    assert.deepEqual(selectedBits(surface), visibleSelection);
  }
  try {
    const { root, instance, app } = mount(); await settle();
    const raw = () => input(root, '十进制整数');
    const snapshot = async () => { await instance.section.flush(); return JSON.parse(files.get('/save-module-editor-test/SaveModules.json')); };
    const fields = config => config.presets.flatMap(module => module.fields);
    const selectedBinary = surface => text(find(surface, node => node.props?.['aria-label'] === '选中位段二进制'));
    const saveButton = surface => find(surface, node => node.tag === 'button' && text(node) === '保存位段');
    assert.equal(files.size, 0, 'Rendering an empty binary viewer must not create a workspace file');
    assert.equal(forbiddenLabels.test(text(root)), false, 'The binary viewer must not show module grouping or module creation');
    assert.equal(all(root, node => node.tag === 'button' && node.props['data-integer-index'] !== undefined).length, 100);
    assert.deepEqual(renderedBits(root).map(node => Number(node.props['data-bit'])), Array.from({ length: 3200 }, (_, index) => index),
      'The grid must expose every concatenated source bit exactly once with a global position');
    assert.equal(binary(root), '0'.repeat(32)); assert.equal(binary(root, 1), '0'.repeat(32));
    assert.equal(Number(raw().value), 0);
    const zeroFilter = input(root, '只看非零整数');
    zeroFilter.checked = true; dispatch(zeroFilter, 'change'); await settle();
    assert.equal(renderedBits(root).length, 3200, 'Sidebar filtering must preserve zero integers and global offsets in the concatenated stream');
    zeroFilter.checked = false; dispatch(zeroFilter, 'change'); await settle();

    await typeNumber(raw(), 5);
    assert.equal(binary(root), '0'.repeat(29) + '101', 'Decimal edits must immediately update all 32 bits');
    await typeNumber(raw(), -1); assert.equal(binary(root), '1'.repeat(32));
    await typeNumber(raw(), -2147483648); assert.equal(binary(root), '1' + '0'.repeat(31));
    await typeNumber(raw(), 2147483647); assert.equal(binary(root), '0' + '1'.repeat(31));
    for (const invalid of ['', '-', '1e', '1.5', '2147483648', '-2147483649']) {
      await typeNumber(raw(), invalid);
      assert.equal(binary(root), '0' + '1'.repeat(31), 'Invalid decimal drafts must preserve the previous preview');
      await change(raw(), invalid); assert.equal(Number(raw().value), 2147483647);
    }
    await change(raw(), 5);

    // Global positions increase left-to-right; the last four bits of integer 0
    // still decode its low nibble, including a reversed two-click selection.
    await chooseEndpoints(root, 31, 28); await assertSelection(root, 28, 4);
    assert.equal(selectedBinary(root), '0101');
    await writeDescription(root, '任务阶段'); await click(root, '保存位段');
    let saved = await snapshot(), [low] = fields(saved);
    assert.equal(saved.presetStorage, 'custom-only'); assert.equal(saved.schemaVersion, 2);
    assert.deepEqual(low, { id: low.id, name: '任务阶段', startBit: 28, length: 4, min: '0', max: '15' });
    await click(root, '新建位段'); await chooseEndpoints(root, 24, 27); await assertSelection(root, 24, 4);
    await writeDescription(root, '角色等级'); await click(root, '保存位段');
    await click(root, '新建位段'); await chooseEndpoints(root, 0, 0); await assertSelection(root, 0, 1);
    await writeDescription(root, '完成标记'); await click(root, '保存位段');
    assert.equal(Number(raw().value), 5, 'Saving definitions must preserve the decimal preview');

    // A reverse drag crosses the integer 1/2 boundary, then navigation to an
    // unrelated integer must preserve the unsaved span and content draft.
    await selectInteger(root, 1); await click(root, '新建位段');
    dispatch(bit(root, 67), 'pointerdown'); dispatch(bit(root, 60), 'pointerenter'); dispatch(bit(root, 60), 'pointerup');
    await settle(); await assertSelection(root, 60, 8);
    await writeDescription(root, '跨整数状态');
    await selectInteger(root, 99); await assertSelection(root, 60, 8);
    assert.equal(control(root, '位段说明').value, '跨整数状态', 'Integer navigation must preserve unsaved content');
    assert.ok(segment(root, '任务阶段'), 'Saved spans must remain listed for unrelated integer navigation');
    await selectInteger(root, 1); await assertSelection(root, 60, 8); await click(root, '保存位段');
    const crossing = fields(await snapshot()).find(field => field.name === '跨整数状态');
    assert.deepEqual([crossing.startBit, crossing.length, crossing.max], [60, 8, '255']);
    for (const position of [60, 63, 64, 67]) assert.ok(hasClass(bit(root, position), 'defined'), 'Both integer rows must mark the saved crossing');
    assert.equal(hasClass(bit(root, 59), 'defined'), false); assert.equal(hasClass(bit(root, 68), 'defined'), false);
    await change(raw(), 10); await selectInteger(root, 2); await change(raw(), -2147483648);
    assert.equal(selectedBinary(root), '10101000', 'Cross-integer decoding must concatenate the first tail before the second head');
    assert.match(text(segment(root, '跨整数状态')), /= 168/);
    await selectInteger(root, 99); assert.ok(segment(root, '跨整数状态'));
    assert.equal(Number(input(root, '起始位').value), 60); assert.equal(Number(input(root, '位段长度').value), 8);
    dispatch(segment(root, '跨整数状态'), 'click'); await settle(); await assertSelection(root, 60, 8);
    assert.equal(selectedBinary(root), '10101000', 'Selecting a saved crossing must not truncate it to an active integer');

    await selectInteger(root, 2); await click(root, '新建位段'); await chooseEndpoints(root, 80, 83);
    await writeDescription(root, '临时选择'); await click(root, '保存位段'); await snapshot();

    // Editing A is a transient draft. Removing B changes the saved entries
    // array, but must not replace A's description, coordinates or range; undo
    // and redo of B must obey the same rule even when snapshot objects change.
    const unrelatedHistory = vue.unref(instance.history.current); unrelatedHistory.finish();
    dispatch(segment(root, '任务阶段'), 'click'); await settle();
    await writeDescription(root, '任务未保存草稿');
    await change(input(root, '起始位'), 40); await change(input(root, '位段长度'), 5);
    await change(input(root, '位段最小值'), '1'); await change(input(root, '位段最大值'), '17');
    async function assertPendingTaskDraft() {
      await assertSelection(root, 40, 5);
      assert.equal(control(root, '位段说明').value, '任务未保存草稿');
      assert.equal(String(input(root, '位段最小值').value), '1');
      assert.equal(String(input(root, '位段最大值').value), '17');
      assert.deepEqual(fields(await snapshot()).find(field => field.id === low.id), low,
        'Unrelated edits must neither overwrite nor persist the pending A draft');
    }
    dispatch(find(root, node => node.tag === 'button' && node.props['aria-label'] === '删除位段 临时选择'), 'click'); await settle();
    unrelatedHistory.finish(); await assertPendingTaskDraft();
    assert.equal(segment(root, '临时选择'), undefined);
    await unrelatedHistory.undo(); await settle(); assert.ok(segment(root, '临时选择')); await assertPendingTaskDraft();
    await unrelatedHistory.redo(); await settle(); assert.equal(segment(root, '临时选择'), undefined); await assertPendingTaskDraft();
    const beforePendingSave = fields(await snapshot());
    await click(root, '保存位段'); unrelatedHistory.finish();
    const afterPendingSave = fields(await snapshot());
    assert.deepEqual(afterPendingSave.find(field => field.id === low.id), {
      id: low.id, name: '任务未保存草稿', startBit: 40, length: 5, min: '1', max: '17',
    });
    assert.deepEqual(afterPendingSave.filter(field => field.id !== low.id), beforePendingSave.filter(field => field.id !== low.id),
      'Saving the preserved A draft must update only A');
    await unrelatedHistory.undo(); await settle(); await assertSelection(root, 28, 4);
    assert.equal(control(root, '位段说明').value, '任务阶段');
    assert.equal(String(input(root, '位段最小值').value), '0'); assert.equal(String(input(root, '位段最大值').value), '15');
    await unrelatedHistory.redo(); await settle(); await assertSelection(root, 40, 5);
    assert.equal(control(root, '位段说明').value, '任务未保存草稿');
    assert.equal(String(input(root, '位段最小值').value), '1'); assert.equal(String(input(root, '位段最大值').value), '17');
    await unrelatedHistory.undo(); await settle(); await assertSelection(root, 28, 4);
    assert.equal(control(root, '位段说明').value, '任务阶段');
    await selectInteger(root, 0); await click(root, '新建位段'); await chooseEndpoints(root, 26, 33);
    await writeDescription(root, '跨边界重叠'); assert.ok(saveButton(root).props.disabled); assert.match(text(root), /重叠/);
    assert.equal(fields(await snapshot()).length, 4, 'A cross-integer overlap draft must not alter saved definitions');

    // More than 32 bits are configurable and range values must never pass
    // through Number, which would round the exact 64-bit unsigned maximum.
    await selectInteger(root, 3); await change(raw(), -1);
    await selectInteger(root, 4); await change(raw(), -1);
    await click(root, '新建位段'); await change(input(root, '起始位'), 96); await change(input(root, '位段长度'), 64);
    await writeDescription(root, '完整64位'); await assertSelection(root, 96, 64);
    assert.equal(selectedBinary(root), '1'.repeat(64));
    assert.equal(String(input(root, '位段最大值').value), '18446744073709551615');
    assert.match(text(root), /= 18446744073709551615/);
    await change(input(root, '起始位'), 3168); assert.ok(saveButton(root).props.disabled, 'A span beyond global bit 3199 must be rejected');
    await change(input(root, '起始位'), 96); assert.ok(!saveButton(root).props.disabled);
    await change(input(root, '位段长度'), 0); assert.ok(saveButton(root).props.disabled);
    await change(input(root, '位段长度'), 64); assert.ok(!saveButton(root).props.disabled);
    await change(input(root, '位段长度'), '1.5'); assert.equal(Number(input(root, '位段长度').value), 64);
    await change(input(root, '位段最大值'), '18446744073709551616'); assert.ok(saveButton(root).props.disabled);
    await change(input(root, '位段最大值'), '18446744073709551615'); assert.ok(!saveButton(root).props.disabled);
    await change(input(root, '位段最小值'), '18446744073709551616'); assert.ok(saveButton(root).props.disabled);
    await change(input(root, '位段最小值'), '0');
    await writeDescription(root, ''); assert.ok(saveButton(root).props.disabled);
    await writeDescription(root, '完整64位'); await click(root, '保存位段');
    saved = await snapshot();
    const wide = fields(saved).find(field => field.name === '完整64位');
    assert.deepEqual([wide.startBit, wide.length, wide.min, wide.max], [96, 64, '0', '18446744073709551615']);
    assert.match(text(segment(root, '完整64位')), /= 18446744073709551615/);

    await selectInteger(root, 99); await typeNumber(raw(), -2147483648);
    assert.equal(binary(root, 99), '1' + '0'.repeat(31));
    await click(root, '新建位段'); await chooseEndpoints(root, 3168, 3168); await assertSelection(root, 3168, 1);
    await writeDescription(root, '末项符号'); await click(root, '保存位段');
    assert.ok(segment(root, '任务阶段')); assert.ok(segment(root, '完整64位')); assert.ok(segment(root, '末项符号'));
    await selectInteger(root, 0); assert.equal(Number(raw().value), 5);
    dispatch(segment(root, '任务阶段'), 'click'); await settle(); await assertSelection(root, 28, 4);
    assert.equal(control(root, '位段说明').value, '任务阶段'); assert.equal(selectedBinary(root), '0101');
    await change(input(root, '位段最大值'), '9'); await writeDescription(root, '任务进度'); await click(root, '保存位段');
    saved = await snapshot(); assert.equal(fields(saved).length, 6);
    assert.equal(fields(saved)[0].name, '任务进度'); assert.equal(fields(saved)[0].max, '9');

    // A pending two-click endpoint must survive integer navigation, as does a
    // finished draft; otherwise distant crossing spans cannot be selected.
    await click(root, '新建位段');
    dispatch(bit(root, 31), 'pointerdown'); dispatch(bit(root, 31), 'pointerup'); dispatch(bit(root, 31), 'click'); await settle();
    await selectInteger(root, 1);
    dispatch(bit(root, 32), 'pointerdown'); dispatch(bit(root, 32), 'pointerup'); dispatch(bit(root, 32), 'click'); await settle();
    await assertSelection(root, 31, 2);
    dispatch(segment(root, '任务进度'), 'click'); await settle(); await selectInteger(root, 0);
    const storageBeforePreview = files.get('/save-module-editor-test/SaveModules.json');
    const history = vue.unref(instance.history.current); history.finish();
    const historyBeforePreview = history.entries.value.length;
    await typeNumber(raw(), -2147483483);
    assert.equal(binary(root), '10000000000000000000000010100101'); assert.equal(selectedBinary(root), '0101');
    dispatch(segment(root, '完成标记'), 'click'); await settle(); await assertSelection(root, 0, 1); assert.equal(selectedBinary(root), '1');

    async function loadFile(marker, name) {
      const fileInput = input(root, '导入存档 GIA 文件'); fileInput.value = 'selected';
      fileInput.files = [{ name, arrayBuffer: async () => Uint8Array.from([marker]).buffer }];
      dispatch(fileInput, 'change'); await settle(); assert.equal(fileInput.value, '');
    }
    await loadFile(1, '测试存档.gia');
    assert.equal(importCalls, 1); assert.equal(Number(raw().value), -2147483643);
    assert.equal(binary(root), '1' + '0'.repeat(28) + '101');
    assert.equal(select(root, '选择存档实例').props.options.length, 4);
    assert.ok(segment(root, '跨整数状态')); assert.ok(segment(root, '完整64位'));
    await selectInteger(root, 99); assert.equal(Number(raw().value), 1); assert.equal(binary(root, 99), '0'.repeat(31) + '1');
    select(root, '选择存档实例').props.choose(3); await settle();
    assert.equal(Number(raw().value), -2147483648); assert.equal(binary(root, 99), '1' + '0'.repeat(31));
    assert.match(text(segment(root, '完整64位')), /= 18446744073709551615/, 'GIA values must produce an exact long-span decimal');
    dispatch(segment(root, '完整64位'), 'click'); await settle(); await assertSelection(root, 96, 64);
    assert.equal(selectedBinary(root), '1'.repeat(64));
    await selectInteger(root, 0); assert.equal(Number(raw().value), -1);
    select(root, '选择存档实例').props.choose(1); await settle();
    assert.equal(Number(raw().value), 42); assert.equal(binary(root), '0'.repeat(26) + '101010');
    await selectInteger(root, 1); assert.equal(Number(raw().value), -1); assert.equal(binary(root, 1), '1'.repeat(32));
    assert.match(text(segment(root, '跨整数状态')), /= 240/);
    select(root, '选择存档实例').props.choose(0); await settle();
    await selectInteger(root, 0); await change(raw(), 123); await click(root, '恢复导入值'); assert.equal(Number(raw().value), -2147483643);
    await change(raw(), 77); await loadFile(2, '坏存档.gia');
    assert.equal(Number(raw().value), 77, 'Rejected imports must preserve the edited preview');
    assert.equal(select(root, '选择存档实例').props.value, 0); assert.equal(select(root, '选择存档实例').props.options.length, 4);
    assert.match(text(root), /原有整数值已保留/); assert.match(text(root), /测试存档.gia/); assert.equal(text(root).includes('坏存档.gia'), false);
    await instance.section.flush(); history.finish();
    assert.equal(files.get('/save-module-editor-test/SaveModules.json'), storageBeforePreview, 'Preview changes must not persist into definitions');
    assert.equal(history.entries.value.length, historyBeforePreview, 'Preview edits and selection must not create undo commands');

    dispatch(segment(root, '任务进度'), 'click'); await settle();
    await writeDescription(root, '任务进度新版'); await click(root, '保存位段'); history.finish(); assert.ok(history.canUndo.value);
    await history.undo(); await settle(); assert.ok(segment(root, '任务进度')); assert.equal(segment(root, '任务进度新版'), undefined);
    assert.equal(Number(raw().value), 77, 'Definition undo must preserve transient integer values');
    await history.redo(); await settle(); assert.ok(segment(root, '任务进度新版')); await instance.section.flush();
    dispatch(segment(root, '跨整数状态'), 'click'); await settle();
    await selectInteger(root, 0);
    await change(input(root, '位段长度'), 10); await click(root, '保存位段'); history.finish();
    await history.undo(); await settle(); await assertSelection(root, 60, 8);
    await history.redo(); await settle(); await assertSelection(root, 60, 10);
    assert.equal(Number(raw().value), 77); await instance.section.flush();
    dispatch(segment(root, '任务进度新版'), 'click'); await settle();
    failWrites = true; await writeDescription(root, '待重试保存'); await click(root, '保存位段');
    await assert.rejects(instance.section.flush(), /测试：存档保存失败/); assert.match(text(root), /预设保存失败/);
    failWrites = false; await click(root, '重试'); await instance.section.flush();
    assert.equal(fields(JSON.parse(files.get('/save-module-editor-test/SaveModules.json')))[0].name, '待重试保存');
    const other = mount('another-save-workspace'); await settle();
    assert.equal(segment(other.root, '待重试保存'), undefined); assert.equal(Number(input(other.root, '十进制整数').value), 0);
    other.app.unmount(); app.unmount(); await settle();
    const reopened = mount(); await settle(); assert.ok(segment(reopened.root, '待重试保存')); assert.ok(segment(reopened.root, '跨整数状态'));
    dispatch(segment(reopened.root, '完整64位'), 'click'); await settle(); await assertSelection(reopened.root, 96, 64);
    assert.equal(selectedBinary(reopened.root), '0'.repeat(64), 'Reopening retains long definitions with a fresh integer preview');

    // v1 bit 0 means a local low bit. Migration flips its position into the
    // global left-to-right numbering without changing the bits it describes.
    const legacy = { kind: 'DSFGSaveModules', schemaVersion: 1, presetStorage: 'custom-only', presets: [
      { id: 'legacy-quest', name: '旧任务模块', fields: [{ id: 'legacy-low', name: '历史任务', integerIndex: 0, startBit: 0, endBit: 3, min: 0, max: 9 }] },
      { id: 'legacy-role', name: '旧角色模块', fields: [{ id: 'legacy-high', name: '历史角色', integerIndex: 1, startBit: 4, endBit: 7, min: 0, max: 15 }] },
    ] };
    const legacyBytes = JSON.stringify(legacy); files.set('/legacy-save-workspace/SaveModules.json', legacyBytes);
    const existing = mount('legacy-save-workspace'); await settle();
    assert.ok(segment(existing.root, '历史任务')); assert.ok(segment(existing.root, '历史角色')); assert.equal(forbiddenLabels.test(text(existing.root)), false);
    await existing.instance.section.flush(); assert.equal(files.get('/legacy-save-workspace/SaveModules.json'), legacyBytes, 'Loading migration must not write the old file');
    dispatch(segment(existing.root, '历史任务'), 'click'); await settle(); await assertSelection(existing.root, 28, 4);
    await change(input(existing.root, '十进制整数'), 5); assert.equal(selectedBinary(existing.root), '0101');
    await writeDescription(existing.root, '历史任务新版'); await click(existing.root, '保存位段'); await existing.instance.section.flush();
    const resaved = JSON.parse(files.get('/legacy-save-workspace/SaveModules.json')); assert.equal(resaved.schemaVersion, 2);
    assert.deepEqual(resaved.presets.map(module => [module.id, module.name]), legacy.presets.map(module => [module.id, module.name]));
    assert.deepEqual(resaved.presets[1].fields[0], { id: 'legacy-high', name: '历史角色', startBit: 56, length: 4, min: '0', max: '15' });

    // Semantic invalid legacy entries stay repairable, including a fractional
    // integer index that must never become a valid global offset by accident.
    const orphanFile = '/orphan-save-workspace/SaveModules.json';
    const orphanData = { kind: 'DSFGSaveModules', schemaVersion: 1, presetStorage: 'custom-only', presets: [
      { id: 'legacy-drafts', name: '旧存档草稿', fields: [
        { id: 'legacy-overflow', name: '越界位段', integerIndex: 100, startBit: 4, endBit: 7, min: 0, max: 15 },
        { id: 'legacy-negative', name: '负下标位段', integerIndex: -1, startBit: 0, endBit: 1, min: 0, max: 3 },
        { id: 'legacy-fraction', name: '小数下标位段', integerIndex: 1.5, startBit: 8, endBit: 9, min: 0, max: 3 },
        { id: 'legacy-valid', name: '有效旧位段', integerIndex: 0, startBit: 0, endBit: 0, min: 0, max: 1 },
      ] },
    ] };
    const originalOrphans = JSON.stringify(orphanData); files.set(orphanFile, originalOrphans);
    const orphans = mount('orphan-save-workspace'); await settle();
    const orphanAction = (action, name) => find(orphans.root, node => node.tag === 'button' && node.props['aria-label'] === action + '位段 ' + name);
    for (const name of ['越界位段', '负下标位段', '小数下标位段']) assert.ok(orphanAction('修正', name), 'Invalid legacy span must remain repairable: ' + name);
    assert.ok(segment(orphans.root, '有效旧位段')); await orphans.instance.section.flush(); assert.equal(files.get(orphanFile), originalOrphans);
    const orphanHistory = vue.unref(orphans.instance.history.current); orphanHistory.finish();
    const orphanHistoryBeforeRepair = orphanHistory.entries.value.length;
    await selectInteger(orphans.root, 7); await change(input(orphans.root, '十进制整数'), 88);
    dispatch(orphanAction('修正', '越界位段'), 'click'); await settle();
    assert.equal(control(orphans.root, '位段说明').value, '越界位段');
    await change(input(orphans.root, '起始位'), 248); await change(input(orphans.root, '位段长度'), 4); await assertSelection(orphans.root, 248, 4);
    await orphans.instance.section.flush(); orphanHistory.finish(); assert.equal(files.get(orphanFile), originalOrphans);
    assert.equal(orphanHistory.entries.value.length, orphanHistoryBeforeRepair, 'Preparing repair must not create history');
    await click(orphans.root, '保存位段'); await orphans.instance.section.flush(); orphanHistory.finish();
    const repaired = JSON.parse(files.get(orphanFile));
    assert.deepEqual(repaired.presets.map(module => [module.id, module.name]), [['legacy-drafts', '旧存档草稿']]);
    assert.deepEqual(repaired.presets[0].fields[0], { id: 'legacy-overflow', name: '越界位段', startBit: 248, length: 4, min: '0', max: '15' });
    assert.equal(repaired.presets[0].fields.length, 4); assert.ok(orphanAction('修正', '小数下标位段'));
    assert.ok(segment(orphans.root, '越界位段')); assert.equal(orphanAction('修正', '越界位段'), undefined);
    assert.equal(orphanHistory.entries.value.length, orphanHistoryBeforeRepair + 1);
    await orphanHistory.undo(); await settle(); assert.ok(orphanAction('修正', '越界位段')); assert.equal(segment(orphans.root, '越界位段'), undefined);
    assert.equal(Number(input(orphans.root, '十进制整数').value), 88, 'Repair undo must preserve the integer preview');
    await orphanHistory.redo(); await settle(); assert.ok(segment(orphans.root, '越界位段'));
    const beforeOrphanDelete = JSON.stringify(JSON.parse(files.get(orphanFile)).presets[0].fields);
    dispatch(orphanAction('删除', '负下标位段'), 'click'); await settle(); orphanHistory.finish(); await orphans.instance.section.flush();
    assert.equal(orphanAction('修正', '负下标位段'), undefined); assert.ok(orphanAction('修正', '小数下标位段'));
    assert.equal(JSON.parse(files.get(orphanFile)).presets[0].fields.length, 3);
    await orphanHistory.undo(); await settle(); await orphans.instance.section.flush();
    assert.equal(JSON.stringify(JSON.parse(files.get(orphanFile)).presets[0].fields), beforeOrphanDelete, 'Deleting invalid spans must support exact history restoration');

    files.set('/corrupt-save-workspace/SaveModules.json', 'not JSON'); const corrupt = mount('corrupt-save-workspace'); await settle();
    assert.match(text(corrupt.root), /存档模块数据不完整.*原文件已保留/); assert.ok(saveButton(corrupt.root).props.disabled);
    await corrupt.instance.section.flush(); assert.equal(files.get('/corrupt-save-workspace/SaveModules.json'), 'not JSON');
    assert.ok(writes.every(file => ['/save-module-editor-test/SaveModules.json', '/legacy-save-workspace/SaveModules.json', orphanFile].includes(file)));
    console.log('PASS signed decimal-to-32-bit binary previews and invalid decimal drafts');
    console.log('PASS global left-to-right positions, reversed endpoints and drag crossing integers, pending draft preservation and cross-row highlights');
    console.log('PASS pending saved-span description/position/range survive unrelated deletion and history; saving and undo/redo refresh only the changed definition');
    console.log('PASS spans longer than 32 bits, exact 64-bit values/ranges, overlap and 3200-bit boundary validation');
    console.log('PASS all-span listing, four GIA candidates, exact long-span GIA decode, restore and failed-import preservation without storage/history changes');
    console.log('PASS persistence, crossing undo/redo, save retry, isolation, reopen, v1 migration, invalid-span repair/deletion and corrupt-file preservation');
  } finally {
    failWrites = false;
    for (const app of mounted.reverse()) app.unmount();
    await settle();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  for (const [extension, handler] of Object.entries(originalExtensions)) {
    if (handler) Module._extensions[extension] = handler; else delete Module._extensions[extension];
  }
  if (originalDocument === undefined) delete global.document; else global.document = originalDocument;
  if (originalWindow === undefined) delete global.window; else global.window = originalWindow;
});
