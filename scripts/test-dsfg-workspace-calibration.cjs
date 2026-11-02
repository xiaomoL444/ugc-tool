/* node scripts/test-dsfg-workspace-calibration.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const targetApi = require('../src/views/DSFGStudio/components/workspaceSettings.ts');
const { baseReleases } = require('../src/views/DSFGStudio/components/versioning/baseReleases.ts');
const { extensionPackages } = require('../src/views/DSFGStudio/components/versioning/extensionPackages.ts');

const filename = path.resolve(__dirname, '../src/views/DSFGStudio/components/WorkspaceGilCalibration.vue');
const source = parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor.scriptSetup.content;
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const script = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function panel() {
  const props = vue.reactive({ target: { fileType: 1, baseReleaseId: 2 , packageIds: []}, disabled: false });
  const events = [], unmount = [], pending = [], scope = vue.effectScope();
  const context = vm.createContext({ ...vue, ...targetApi, Error, WORKSPACE_STRUCT_ID_FIELDS: [],
    defineProps: () => props,
    defineEmits: () => (name, value) => {
      events.push([name, value]);
      // The parent passes an inline target object and rerenders when its busy ref changes.
      if (name === 'busy') props.target = { ...props.target };
    },
    onBeforeUnmount: fn => unmount.push(fn),
    readWorkspaceGilCalibration: (file, target) => new Promise((resolve, reject) => pending.push({ resolve, reject, target })),
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
  f.props.target = { fileType: 2, baseReleaseId: 1 , packageIds: []}; await vue.nextTick();
  f.pendingReads.shift().resolve({ fileName: 'old-target.gil' }); await reading; await vue.nextTick();
  assert.equal(f.calibration.value, undefined); assert.equal(f.busy.value, false);
  assert.equal(f.error.value, '');
  console.log('PASS Late reads cannot publish calibration after file type or release changes');

  const baseCount = baseReleases.length, packageCount = extensionPackages.length;
  const versions = { gameVersion: 'fixture', templateVersion: 'fixture', internalVersion: 'fixture' };
  baseReleases.push({ ...versions, id: 991, order: 991, packageIds: [] }, { ...versions, id: 992, order: 992, packageIds: [] });
  extensionPackages.push({ id: 991, name: 'fixture package' }, { id: 992, name: 'fixture package 2' });
  try {
    f.props.target = { fileType: 1, baseReleaseId: 991, packageIds: [991, 992] }; await vue.nextTick();
    reading = f.readFile(event()); await vue.nextTick();
    const first = f.pendingReads.shift();
    f.props.target.packageIds.reverse(); await vue.nextTick();
    assert.equal(f.busy.value, true, 'Reordering the same package set does not invalidate calibration');
    assert.deepEqual(first.target.packageIds, [991, 992], 'In-flight reads own their package snapshot');
    f.props.target.packageIds.pop(); await vue.nextTick();
    first.resolve({ fileName: 'old-packages.gil' }); await reading;
    assert.equal(f.calibration.value, undefined);
    reading = f.readFile(event()); await vue.nextTick();
    const second = f.pendingReads.shift();
    f.props.target.baseReleaseId = 992; await vue.nextTick();
    second.resolve({ fileName: 'old-base.gil' }); await reading;
    assert.equal(f.calibration.value, undefined);
    console.log('PASS Package/base changes discard late calibration, while order-only changes and parent copies preserve it');
  } finally { baseReleases.splice(baseCount); extensionPackages.splice(packageCount); }

  f.props.target = { fileType: 1, baseReleaseId: 2 , packageIds: []}; await vue.nextTick();

  reading = f.readFile(event()); await vue.nextTick(); f.close();
  const count = f.events.length;
  f.pendingReads.shift().resolve({ fileName: 'closed.gil' }); await reading;
  assert.equal(f.events.length, count); assert.equal(f.calibration.value, undefined);
  assert.deepEqual(f.events.at(-1), ['change', undefined]);
  console.log('PASS Closing clears parent calibration and suppresses late file results');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
