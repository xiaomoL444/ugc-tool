const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');

const base = path.resolve(__dirname, '../src/views/DSFGStudio/components');
const originals = Object.fromEntries(['.ts', '.vue'].map(ext => [ext, Module._extensions[ext]]));
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
Module._extensions['.ts'] = (mod, filename) => mod._compile(compile(fs.readFileSync(filename, 'utf8')), filename);
Module._extensions['.vue'] = (mod, filename) => {
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  mod._compile(compile(compileScript(descriptor, { id: 'typed-input-test', inlineTemplate: true }).content), filename);
};

function element(tag) {
  return {
    tag, children: [], parent: null, props: {}, value: '', selectionStart: 0, selectionEnd: 0,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    setCustomValidity(message) { this.validationMessage = message; },
  };
}
const renderer = vue.createRenderer({
  createElement: element, createText: text => ({ text }), createComment: text => ({ text }),
  setText(node, text) { node.text = text; }, setElementText(node, text) { node.text = text; },
  parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  insert(node, parent, anchor) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node);
  },
  remove(node) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); },
  patchProp(node, key, oldValue, value) { node.props[key] = value; if (key === 'value') node.value = value; },
  setScopeId() {},
});

function invoke(node, name, event) {
  const handler = node.props[name];
  assert.ok(handler, `Expected ${name} handler on the real input`);
  for (const fn of Array.isArray(handler) ? handler : [handler]) fn(event);
}
async function main() {
  const { isTypedValueDraft, getTypedValueError } = require(path.join(base, 'typedValueInput.ts'));
  for (const value of ['', '-', '+', '-0', '+17', '-2147483648']) {
    assert.equal(isTypedValueDraft('Int32', value), true, `Integer draft ${JSON.stringify(value)}`);
  }
  for (const value of ['1.5', '1e3', '--1', '12abc', '中文字', '１２']) {
    assert.equal(isTypedValueDraft('Int32', value), false, `Reject integer draft ${JSON.stringify(value)}`);
  }
  for (const value of ['0', '-2147483648', '2147483647', '+17']) assert.equal(getTypedValueError('Int32', value), '');
  for (const value of ['-', '+', '2147483648', '-2147483649', '1.5', '1e3']) assert.ok(getTypedValueError('Int32', value));
  for (const type of ['Guid', 'ConfigReference', 'EntityReference']) {
    for (const value of ['', '0', '0017', '2147483647']) assert.equal(isTypedValueDraft(type, value), true);
    for (const value of ['-1', '+1', '1.2', '1e3', '角色']) assert.equal(isTypedValueDraft(type, value), false);
  }
  const guid = '18446744073709551615';
  assert.equal(getTypedValueError('Guid', guid), '');
  for (const type of ['ConfigReference', 'EntityReference']) {
    assert.equal(getTypedValueError(type, '0'), '');
    assert.equal(getTypedValueError(type, '2147483647'), '');
    assert.ok(getTypedValueError(type, '2147483648'));
    assert.ok(getTypedValueError(type, '-1'));
  }
  for (const value of ['', '-', '+', '.', '-.', '.5', '1.', '1e', '1e-', '1E+', '-0', '+1.25e-3']) {
    assert.equal(isTypedValueDraft('Float', value), true, `Float draft ${JSON.stringify(value)}`);
  }
  for (const value of ['e', 'e1', '1..2', '1.2.3', '1e--3', '1e2e3', '1,5', 'NaN', 'Infinity', '中文字']) {
    assert.equal(isTypedValueDraft('Float', value), false, `Reject float draft ${JSON.stringify(value)}`);
  }
  for (const value of ['0', '-1', '.5', '1.', '1e-3', '+1.25E+3', '3.4e38']) assert.equal(getTypedValueError('Float', value), '');
  for (const value of ['-', '.', '-.', '1e', '1e-', '1e999', '3.5e38', 'NaN', 'Infinity']) assert.ok(getTypedValueError('Float', value));
  for (const value of ['', '文本 12.5', '你好，旅行者', '角色\n第二行', '１２']) {
    assert.equal(isTypedValueDraft('String', value), true);
    assert.equal(getTypedValueError('String', value), '');
  }
  console.log('PASS Integer/float drafts and complete values, signed Int32 bounds, unsigned IDs, exact large GUIDs and free text');

  const Field = require(path.join(base, 'TypedValueInput.vue')).default;
  const model = vue.ref('12'), valueType = vue.ref('Int32'), disabled = vue.ref(false);
  const updates = [];
  const root = element('root');
  const app = renderer.createApp({ setup: () => () => vue.h(Field, {
    modelValue: model.value, valueType: valueType.value, disabled: disabled.value,
    'aria-label': '类型参数', placeholder: '请输入参数', class: 'inherited-input',
    'onUpdate:modelValue': value => { updates.push(value); model.value = value; },
  }) });
  app.mount(root);
  const input = root.children.find(node => node.tag === 'input');
  assert.ok(input, 'Component must expose one real input root so scoped styles and attributes apply');
  assert.equal(input.props['aria-label'], '类型参数');
  assert.equal(input.props.placeholder, '请输入参数');
  assert.match(input.props.class, /inherited-input/);
  assert.equal(input.value, '12');
  async function enter(text, isComposing = false) {
    input.value = text;
    input.selectionStart = input.selectionEnd = text.length;
    invoke(input, 'onInput', { target: input, currentTarget: input, isComposing });
    await vue.nextTick();
  }
  await enter('12.5'); assert.equal(model.value, '12'); assert.equal(input.value, '12');
  await enter('12abc'); assert.equal(model.value, '12'); assert.equal(input.value, '12');
  await enter('-'); assert.equal(model.value, '-'); assert.equal(input.value, '-');
  await enter('-15'); assert.equal(model.value, '-15');
  await enter(''); assert.equal(model.value, ''); assert.equal(input.value, '');
  await enter('18');
  input.selectionStart = input.selectionEnd = 2;
  let prevented = false;
  invoke(input, 'onBeforeinput', {
    target: input, currentTarget: input, inputType: 'insertText', data: '.', cancelable: true,
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true, 'Beforeinput must reject invalid edits before mutating the DOM');
  assert.equal(model.value, '18');
  input.selectionStart = 0; input.selectionEnd = 2;
  prevented = false;
  invoke(input, 'onBeforeinput', {
    target: input, currentTarget: input, inputType: 'insertText', data: '-3', cancelable: true,
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, false, 'Validate the complete candidate with the selected range replaced');
  await enter('-3');
  input.selectionStart = 0; input.selectionEnd = 2;
  prevented = false;
  invoke(input, 'onBeforeinput', {
    target: input, currentTarget: input, inputType: 'insertFromPaste', data: '43x', cancelable: true,
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true, 'Paste must reject the complete invalid text instead of silently dropping characters');
  await enter('43x'); assert.equal(model.value, '-3'); assert.equal(input.value, '-3');
  console.log('PASS Real Vue input rejects whole invalid edits/pastes, supports signed/empty drafts and beforeinput selection replacement');

  invoke(input, 'onCompositionstart', { target: input, currentTarget: input });
  await enter('中文', true); assert.equal(model.value, '-3'); assert.equal(input.value, '中文');
  invoke(input, 'onCompositionend', { target: input, currentTarget: input }); await vue.nextTick();
  assert.equal(model.value, '-3'); assert.equal(input.value, '-3');
  invoke(input, 'onCompositionstart', { target: input, currentTarget: input });
  await enter('23', true); assert.equal(model.value, '-3');
  invoke(input, 'onCompositionend', { target: input, currentTarget: input }); await vue.nextTick();
  assert.equal(model.value, '23'); assert.equal(input.value, '23');
  valueType.value = 'String'; await vue.nextTick();
  invoke(input, 'onCompositionstart', { target: input, currentTarget: input });
  await enter('你', true);
  input.value = '你好，旅行者 12.5';
  invoke(input, 'onCompositionend', { target: input, currentTarget: input }); await vue.nextTick();
  assert.equal(model.value, '你好，旅行者 12.5');
  await enter('任意文字 . e - + １２'); assert.equal(model.value, '任意文字 . e - + １２');
  console.log('PASS IME composes freely and validates only completed numeric text; strings accept Chinese and arbitrary text');

  valueType.value = 'Float'; model.value = '0'; await vue.nextTick();
  for (const value of ['-', '-.', '-.5', '1.', '1e', '1e-', '1e-3']) {
    await enter(value); assert.equal(model.value, value); assert.equal(input.value, value);
  }
  await enter('1.2.3'); assert.equal(model.value, '1e-3'); assert.equal(input.value, '1e-3');
  await enter('1e-');
  invoke(input, 'onBlur', { target: input, currentTarget: input }); await vue.nextTick();
  assert.ok(input.props['aria-invalid'] === true || input.props['aria-invalid'] === 'true');
  assert.ok(input.props.title); assert.ok(input.validationMessage);
  assert.equal(model.value, '1e-', 'Incomplete drafts remain visible for correction');
  await enter('2.5');
  invoke(input, 'onBlur', { target: input, currentTarget: input }); await vue.nextTick();
  assert.ok(!input.props['aria-invalid'] || input.props['aria-invalid'] === 'false');
  assert.equal(input.validationMessage, '');
  valueType.value = 'Int32'; await vue.nextTick();
  assert.equal(model.value, '2.5'); assert.equal(input.value, '2.5');
  const count = updates.length;
  model.value = '历史非法值'; await vue.nextTick();
  assert.equal(input.value, '历史非法值'); assert.equal(updates.length, count, 'Loading old values must never overwrite stored data');
  invoke(input, 'onBlur', { target: input, currentTarget: input }); await vue.nextTick();
  assert.ok(input.props['aria-invalid']); assert.ok(input.validationMessage);
  await enter('2147483648');
  invoke(input, 'onBlur', { target: input, currentTarget: input }); await vue.nextTick();
  assert.equal(model.value, '2147483648'); assert.ok(input.validationMessage);
  await enter('2147483647');
  invoke(input, 'onBlur', { target: input, currentTarget: input }); await vue.nextTick();
  assert.equal(input.validationMessage, '');
  valueType.value = 'Guid'; model.value = ''; await vue.nextTick();
  await enter(guid); assert.equal(model.value, guid); assert.equal(typeof model.value, 'string');
  await enter('-1'); assert.equal(model.value, guid); assert.equal(input.value, guid);
  disabled.value = true; await vue.nextTick(); assert.equal(input.props.disabled, true);
  app.unmount();
  console.log('PASS Float editing, blur validation, reactive type changes, historical values, range errors, exact GUIDs and disabled attributes');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const [ext, loader] of Object.entries(originals)) {
    if (loader) Module._extensions[ext] = loader; else delete Module._extensions[ext];
  }
});
