/* node scripts/test-dsfg-workspace-calibration.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');

const filename = path.resolve(__dirname, '../src/views/DSFGStudio/components/WorkspaceGilCalibration.vue');
const source = parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor.scriptSetup.content;
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const script = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function panel() {
  const props = vue.reactive({ target: { fileType: 1, templateReleaseId: 2 }, disabled: false });
  const events = [], unmount = [], pending = [], scope = vue.effectScope();
  const context = vm.createContext({ ...vue, Error, WORKSPACE_STRUCT_ID_FIELDS: [],
    defineProps: () => props,
    defineEmits: () => (name, value) => {
      events.push([name, value]);
      // The parent passes an inline target object and rerenders when its busy ref changes.
      if (name === 'busy') props.target = { ...props.target };
    },
    onBeforeUnmount: fn => unmount.push(fn),
    readWorkspaceGilCalibration: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    workspaceGilCalibrationFiles: result => { if (result.incomplete) throw new Error('choose candidate'); return {}; },
  });
  scope.run(() => vm.runInContext(`${script}\nglobalThis.api = { readFile, calibration, busy, error, pending };`, context));
  return { ...context.api, props, events, pendingReads: pending,
    close() { unmount.forEach(fn => fn()); scope.stop(); } };
}
const event = () => ({ target: { value: 'chosen', files: [{ name: 'fixture.gil', size: 100 }] } });

async function main() {
  const f = panel();
  let reading = f.readFile(event());
  await vue.nextTick();
  assert.equal(f.busy.value, true, 'A parent render with identical target values must not cancel the importer');
  f.pendingReads.shift().resolve({ fileName: 'fixture.gil' }); await reading; await vue.nextTick();
  assert.equal(f.calibration.value.fileName, 'fixture.gil'); assert.equal(f.busy.value, false);
  assert.equal(f.pending.value, '');
  console.log('PASS Parent busy renders preserve the current GIL read and publish successful calibration');

  reading = f.readFile(event()); await vue.nextTick();
  assert.equal(f.calibration.value, undefined, 'Reimport clears the previous successful calibration immediately');
  f.pendingReads.shift().reject(new Error('bad archive')); await reading; await vue.nextTick();
  assert.equal(f.error.value, 'bad archive'); assert.equal(f.calibration.value, undefined);
  assert.equal(f.busy.value, false);
  console.log('PASS A failed reimport cannot reuse stale successful calibration');

  reading = f.readFile(event()); await vue.nextTick();
  f.props.target = { fileType: 2, templateReleaseId: 1 }; await vue.nextTick();
  f.pendingReads.shift().resolve({ fileName: 'old-target.gil' }); await reading; await vue.nextTick();
  assert.equal(f.calibration.value, undefined); assert.equal(f.busy.value, false);
  assert.equal(f.error.value, '');
  console.log('PASS Late reads cannot publish calibration after file type or release changes');

  reading = f.readFile(event()); await vue.nextTick(); f.close();
  const count = f.events.length;
  f.pendingReads.shift().resolve({ fileName: 'closed.gil' }); await reading;
  assert.equal(f.events.length, count); assert.equal(f.calibration.value, undefined);
  assert.deepEqual(f.events.at(-1), ['change', undefined]);
  console.log('PASS Closing clears parent calibration and suppresses late file results');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
