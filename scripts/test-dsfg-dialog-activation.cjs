/* Run with: node scripts/test-dsfg-dialog-activation.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');

const filename = path.resolve(__dirname, '../src/views/DSFGStudio/components/StudioCreateDialog.vue');
const source = parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor.scriptSetup.content;
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const script = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 },
}).outputText;

function harness({ active = true, hidden = false, inert = false } = {}) {
  const scope = vue.effectScope(), current = vue.ref(active), events = [], mounted = [], unmounted = [];
  let opened = 0, closed = 0, inputFocus = 0, restoredFocus = 0;
  const previousFocus = { isConnected: true, closest: () => inert ? {} : null,
    getClientRects: () => hidden ? [] : [{}], focus: () => restoredFocus++ };
  const context = vm.createContext({ ...vue,
    studioEditorActiveKey: Symbol('studioEditorActive'), inject: () => () => current.value,
    defineProps: () => ({ modelValue: '', busy: false }), withDefaults: (props, defaults) => ({ ...defaults, ...props }),
    defineEmits: () => (...args) => events.push(args),
    onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => unmounted.push(fn), document: { activeElement: previousFocus },
  });
  scope.run(() => vm.runInContext(`${script}\nglobalThis.api = { dialog, input };`, context, { filename }));
  context.api.dialog.value = { showModal: () => opened++, close: () => closed++ };
  context.api.input.value = { focus: () => inputFocus++ };
  return { current, previousFocus, events, mount: () => mounted.forEach(fn => fn()),
    state: () => ({ opened, closed, inputFocus, restoredFocus }),
    async unmount() { unmounted.forEach(fn => fn()); scope.stop(); await vue.nextTick(); } };
}

async function main() {
  const active = harness(); active.mount();
  assert.deepEqual(active.state(), { opened: 1, closed: 0, inputFocus: 1, restoredFocus: 0 });
  await active.unmount(); assert.equal(active.state().restoredFocus, 1);
  console.log('PASS Active create dialogs open normally and restore focus to a visible element');

  const switching = harness({ inert: true }); switching.mount(); switching.current.value = false;
  assert.equal(switching.state().closed, 1); assert.deepEqual(switching.events, [['close']]);
  await switching.unmount(); assert.equal(switching.state().restoredFocus, 0);
  console.log('PASS Module deactivation closes its create dialog without focusing an inert editor');

  const hidden = harness({ active: false, hidden: true }); hidden.mount();
  assert.equal(hidden.state().opened, 0); assert.equal(hidden.state().inputFocus, 0);
  await hidden.unmount(); assert.equal(hidden.state().restoredFocus, 0);
  console.log('PASS Hidden modules do not open dialogs or restore focus to hidden content');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
