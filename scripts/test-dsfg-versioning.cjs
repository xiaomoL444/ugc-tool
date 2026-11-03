/* Run with: node scripts/test-dsfg-versioning.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const root = path.resolve(__dirname, '../src/views/DSFGStudio/components');
const settings = require(path.join(root, 'workspaceSettings.ts'));
const catalog = require(path.join(root, 'versioning/catalog.ts'));
const { baseReleases } = require(path.join(root, 'versioning/baseReleases.ts'));
const { extensionPackages } = require(path.join(root, 'versioning/extensionPackages.ts'));
const { formatReleaseLabel } = require(path.join(root, 'versioning/types.ts'));
const { isApplicable } = require(path.join(root, 'workspaceFeatures.ts'));
const plain = value => JSON.parse(JSON.stringify(value));
const v3 = overrides => ({ kind: 'DSFGWorkspaceSettings', schemaVersion: 3, fileType: 0,
  baseReleaseId: 11, packageIds: [101, 102], ...overrides });

async function main() {
  assert.deepEqual(extensionPackages, [{ id: 1, name: '7.2技能动画扩展包' }]);
  for (const id of [1, 2]) {
    const base = catalog.getBaseRelease(id);
    assert.deepEqual([base.gameVersion, base.templateVersion, base.internalVersion], id === 1 ? ['7.1', '2.0', '1.0.3'] : ['7.2', '2.1', '1.0.4']);
    assert.equal(formatReleaseLabel(base), `原神v${base.gameVersion}，模版版本v${base.templateVersion}，模版内部版本v${base.internalVersion}`);
    assert.equal(settings.createWorkspaceSettings(catalog.resolveBaseRelease(id, 0)).baseReleaseId, id);
    assert.deepEqual(base.packageIds, id === 1 ? [] : [1]);
  }
  assert.equal(settings.createWorkspaceSettings().baseReleaseId, 1);
  assert.equal(settings.createNewWorkspaceSettings().baseReleaseId, 2);
  assert.deepEqual(settings.createNewWorkspaceSettings().packageIds, [1]);
  assert.deepEqual(Object.keys(settings.createWorkspaceSettings()).sort(), ['baseReleaseId', 'fileType', 'kind', 'packageIds', 'schemaVersion']);
  console.log('PASS Only baseline/package state is saved; legacy defaults use 2.0 and creation uses the latest baseline');
  const original = catalog.getBaseRelease(1);
  assert.notEqual(formatReleaseLabel(original), formatReleaseLabel({ ...original, internalVersion: '1.0.3.1' }));
  assert.notEqual(formatReleaseLabel(original), formatReleaseLabel({ ...original, gameVersion: '7.2' }));
  console.log('PASS Game, template and internal versions are separate fields and all contribute to the display label');

  // Fixture definitions exist only in this process; no production catalogue is written.
  const sizes = [baseReleases.length, extensionPackages.length];
  try {
    const versions = { gameVersion: 'fixture', templateVersion: 'fixture', internalVersion: 'fixture' };
    baseReleases.push({ ...versions, id: 11, order: 20, packageIds: [] }, { ...versions, id: 5, order: 10, packageIds: [] },
      { ...versions, id: 31, order: 30, fileTypes: [2], packageIds: [] },
      { ...versions, id: 41, order: 40, packageIds: [101] }, { ...versions, id: 42, order: 50, packageIds: [101, 102] });
    extensionPackages.push({ id: 101, name: 'fixture 7.1', baseVersionRanges: [{ min: { releaseId: 5, inclusive: true } }] },
      { id: 102, name: 'fixture 7.2', baseVersionRanges: [{ min: { releaseId: 11, inclusive: true } }], requiredPackageIds: [101] },
      { id: 103, name: 'fixture classic', fileTypes: [2] }, { id: 104, name: 'fixture optional' });
    assert.equal(settings.createWorkspaceSettings().baseReleaseId, 1, 'Additional releases never move the legacy 2.0 default');

    const old = JSON.stringify({ kind: 'DSFGWorkspaceSettings', schemaVersion: 1, fileType: 0, templateReleaseId: 2 });
    const writes = [], storage = { async exists() { return true; }, async readFile() { return old; }, async writeFile(...args) { writes.push(args); } };
    const migrated = await settings.loadWorkspaceSettings(storage, 'old');
    assert.deepEqual(migrated, settings.createNewWorkspaceSettings());
    assert.deepEqual(writes, []);
    assert.equal(JSON.parse(settings.encodeWorkspaceSettings(migrated)).schemaVersion, 3);
    await assert.rejects(settings.loadWorkspaceSettings({ ...storage, async readFile() { return old.replace('"templateReleaseId":2', '"templateReleaseId":999'); } }, 'unknown'), /未知/);
    assert.deepEqual(writes, []);
    const earlyV2 = { kind: 'DSFGWorkspaceSettings', schemaVersion: 2, fileType: 0, sourceTemplateReleaseId: 2, baseReleaseId: null, packageIds: [] };
    assert.deepEqual(settings.decodeWorkspaceSettings(earlyV2), settings.createNewWorkspaceSettings());
    assert.deepEqual(settings.decodeWorkspaceSettings({ ...earlyV2, baseReleaseId: 5, packageIds: [101] }), v3({ baseReleaseId: 5, packageIds: [101] }));
    assert.equal(settings.decodeWorkspaceSettings({ ...earlyV2, baseReleaseId: 5, sourceTemplateReleaseId: 999 }).baseReleaseId, 5,
      'An explicit baseline wins over unused old source metadata');
    assert.throws(() => settings.decodeWorkspaceSettings({ ...earlyV2, sourceTemplateReleaseId: 999 }), /未知/);
    assert.equal(settings.decodeWorkspaceSettings({ ...earlyV2, sourceTemplateReleaseId: undefined }).baseReleaseId, 1);
    assert.equal(settings.decodeWorkspaceSettings(v3({ baseReleaseId: null, packageIds: [] })).baseReleaseId, 1);
    assert.equal('sourceTemplateReleaseId' in settings.decodeWorkspaceSettings(earlyV2), false);
    assert.equal(catalog.workspaceTargetKey({ ...migrated, sourceTemplateReleaseId: 1 }), catalog.workspaceTargetKey({ ...migrated, sourceTemplateReleaseId: 2 }));
    console.log('PASS Formats 1/2 migrate without writes, prefer explicit baselines and drop obsolete source metadata');

    const current = settings.decodeWorkspaceSettings(v3({ packageIds: [101] }));
    assert.deepEqual(current.packageIds, [101]);
    assert.deepEqual(settings.decodeWorkspaceSettings(JSON.parse(settings.encodeWorkspaceSettings(current))), current);
    assert.deepEqual(settings.decodeWorkspaceSettings(v3({ packageIds: [] })).packageIds, []);
    assert.equal('sourceTemplateReleaseId' in settings.decodeWorkspaceSettings(v3({ sourceTemplateReleaseId: 2 })), false);
    console.log('PASS Current snapshots retain removed optional packages and omit source metadata on every save');

    const included = settings.decodeWorkspaceSettings(v3({ baseReleaseId: 42, packageIds: [104] }));
    assert.deepEqual(included.packageIds, [104, 101, 102]);
    assert.deepEqual(catalog.resolveBaseRelease(42, 0).packageIds, [101, 102]);
    assert.deepEqual(settings.decodeWorkspaceSettings(JSON.parse(settings.encodeWorkspaceSettings(included))).packageIds, [104, 101, 102]);
    assert.deepEqual(JSON.parse(settings.encodeWorkspaceSettings({ ...included, packageIds: [104] })).packageIds, [104, 101, 102],
      'Saving a manually altered target restores the mandatory baseline-owned packages');
    const readonlyStorage = { async exists() { return true; }, async readFile() { return JSON.stringify(v3({ baseReleaseId: 41, packageIds: [] })); },
      async writeFile() { throw new Error('Reading must not write'); } };
    assert.deepEqual((await settings.loadWorkspaceSettings(readonlyStorage, 'included')).packageIds, [101]);
    assert.ok(catalog.workspaceTargetErrors(v3({ baseReleaseId: 42, packageIds: [104] })).some(error => error.includes('必须启用')));
    assert.equal(isApplicable({ requiredPackageIds: [102] }, v3({ baseReleaseId: 42, packageIds: [] })), true);
    assert.equal(isApplicable({ requiredPackageIds: [104] }, v3({ baseReleaseId: 42, packageIds: [] })), false);
    const switched = catalog.changeWorkspaceBase(included, 5);
    assert.deepEqual(switched.packageIds, [104], 'Leaving a baseline removes its supplied packages and retains other selections');
    assert.deepEqual(catalog.changeWorkspaceBase(switched, 41).packageIds, [104, 101]);
    assert.deepEqual(catalog.changeWorkspaceBase(included, 41).packageIds, [104, 101], 'Shared included packages remain enabled');
    assert.deepEqual(catalog.changeWorkspaceBase(included, null).packageIds, [104]);
    assert.deepEqual(included.packageIds, [104, 101, 102], 'Switching baselines does not mutate the saved target');
    console.log('PASS Baseline-owned packages are enabled for reads, baseline resolution, feature checks and saves; switching retains optional packages');

    for (const overrides of [
      { baseReleaseId: 999 }, { baseReleaseId: '11' }, { baseReleaseId: undefined }, { packageIds: undefined },
      { packageIds: [101, 101] }, { packageIds: ['101'] }, { packageIds: [999] }, { packageIds: [102] },
      { baseReleaseId: 5 }, { baseReleaseId: null }, { baseReleaseId: 31 }, { packageIds: [103] },
    ]) assert.throws(() => settings.decodeWorkspaceSettings(v3(overrides)), JSON.stringify(overrides));
    assert.doesNotThrow(() => settings.decodeWorkspaceSettings(v3({ fileType: 2, baseReleaseId: 31, packageIds: [103] })));
    console.log('PASS Invalid shapes, duplicates, unknown packages, missing dependencies and incompatible bases/types are rejected');

    const target = settings.decodeWorkspaceSettings(v3());
    const requirements = { baseVersionRanges: [{ min: { releaseId: 11, inclusive: true } }], requiredPackageIds: [101, 102] };
    assert.equal(isApplicable(requirements, target), true);
    assert.equal(isApplicable(requirements, { ...target, baseReleaseId: 5 }), false);
    assert.equal(isApplicable(requirements, { ...target, baseReleaseId: null }), false);
    assert.equal(isApplicable(requirements, { ...target, packageIds: [101] }), false);
    assert.equal(isApplicable({ requiredPackageIds: [101] }, { ...target, packageIds: [102] }), false);
    assert.equal(isApplicable({ fileTypes: [2], ...requirements }, target), false);
    const fromBase2 = { baseVersionRanges: [{ min: { releaseId: 2, inclusive: true } }] };
    assert.equal(isApplicable(fromBase2, settings.createNewWorkspaceSettings()), true);
    assert.equal(isApplicable(fromBase2, { ...settings.createWorkspaceSettings(), sourceTemplateReleaseId: 2 }), false);
    assert.throws(() => isApplicable({ requiredPackageIds: [999] }, target), /未知/);
    console.log('PASS Features depend on the actual baseline and packages, even when obsolete source metadata disagrees');

    const a = catalog.cloneWorkspaceTarget(v3()), b = catalog.cloneWorkspaceTarget(v3());
    a.packageIds.pop();
    assert.deepEqual(b.packageIds, [101, 102]);
    assert.deepEqual(catalog.getBaseRelease(11).packageIds, []);
    assert.equal(catalog.workspaceTargetKey(b), catalog.workspaceTargetKey({ ...b, packageIds: [102, 101] }));
    assert.notEqual(catalog.workspaceTargetKey(a), catalog.workspaceTargetKey(b));
    assert.notEqual(catalog.workspaceTargetKey(b), catalog.workspaceTargetKey({ ...b, baseReleaseId: 5 }));
    assert.equal(catalog.isInVersionRanges(20, [{ min: { releaseId: 5, inclusive: true } }], id => catalog.getBaseRelease(id).order), true);
    assert.throws(() => catalog.isInVersionRanges(20, [{ min: { releaseId: 11, inclusive: true }, max: { releaseId: 5, inclusive: true } }], id => catalog.getBaseRelease(id).order), /上下界/);
    console.log('PASS Copies isolate package arrays and canonical keys ignore order but detect baseline/package changes');

    const filename = path.join(root, 'WorkspaceVersionSettings.vue');
    const source = parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor.scriptSetup.content;
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const script = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const props = vue.reactive({ modelValue: settings.decodeWorkspaceSettings(v3()), disabled: false });
    const updates = [];
    const context = vm.createContext({ ...vue, ...settings, ...catalog, baseReleases, extensionPackages,
      defineProps: () => props, defineEmits: () => (event, value) => { assert.equal(event, 'update:modelValue'); updates.push(value); } });
    vm.runInContext(`${script}\nglobalThis.ui = { changeBase, togglePackage, errors };`, context);
    context.ui.togglePackage(102, { target: { checked: false } });
    assert.deepEqual(plain(updates.at(-1).packageIds), [101]);
    assert.deepEqual(plain(props.modelValue.packageIds), [101, 102]);
    context.ui.changeBase(5);
    assert.equal(updates.at(-1).baseReleaseId, 5);
    assert.equal(props.modelValue.baseReleaseId, 11);
    const beforeEmptySelection = updates.length;
    context.ui.changeBase(null);
    assert.equal(updates.length, beforeEmptySelection, 'The baseline selector cannot clear the baseline');
    props.modelValue = updates.at(-1);
    assert.ok(context.ui.errors.value.some(error => error.includes('兼容')));
    assert.doesNotThrow(() => context.ui.changeBase(31));
    props.modelValue = updates.at(-1);
    assert.ok(context.ui.errors.value.length, 'Incompatible baseline selections remain editable and show validation errors');
    console.log('PASS The actual version form emits isolated drafts and reports baseline compatibility errors');

    props.modelValue = included;
    const updateCount = updates.length;
    context.ui.togglePackage(101, { target: { checked: false } });
    assert.equal(updates.length, updateCount, 'Included packages cannot be unchecked even through a direct change event');
    context.ui.togglePackage(104, { target: { checked: false } });
    assert.deepEqual(plain(updates.at(-1).packageIds), [101, 102]);
    context.ui.changeBase(5);
    assert.deepEqual(plain(updates.at(-1).packageIds), [104]);
    context.ui.changeBase(42);
    assert.deepEqual(plain(updates.at(-1).packageIds), [104, 101, 102]);
    props.disabled = true;
    const disabledCount = updates.length;
    context.ui.togglePackage(104, { target: { checked: false } }); context.ui.changeBase(5);
    assert.equal(updates.length, disabledCount);
    console.log('PASS The version form locks baseline-owned packages and permits optional package edits');

    // Render the actual template to verify checkbox states and visible origin labels.
    const module = { exports: {} };
    const compiled = compileScript(parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'version-form-test', inlineTemplate: true }).content;
    vm.runInNewContext(ts.transpileModule(compiled, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
      { module, exports: module.exports, require(name) {
        if (name === 'vue') return vue;
        if (name === './StudioSelectField.vue') return { default: vue.defineComponent({ setup: () => () => vue.h('div') }) };
        return require(path.resolve(root, name));
      } }, { filename });
    const element = (tag, text = '') => ({ tag, text, parent: null, children: [], props: {} });
    const detach = node => { if (node.parent) { const children = node.parent.children; children.splice(children.indexOf(node), 1); node.parent = null; } };
    const renderer = vue.createRenderer({
      createElement: element, createText: text => element('#text', text), createComment: text => element('#comment', text),
      setText(node, text) { node.text = text; }, setElementText(node, text) { node.children = []; node.text = text; },
      parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
      insert(node, parent, anchor) { detach(node); const index = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(index < 0 ? parent.children.length : index, 0, node); node.parent = parent; },
      remove: detach, patchProp(node, key, previous, value) { node.props[key] = value; }, setScopeId() {},
    });
    const container = element('root'), model = vue.ref(included);
    const app = renderer.createApp({ setup: () => () => vue.h(module.exports.default, { modelValue: model.value,
      'onUpdate:modelValue': value => { model.value = value; } }) });
    app.mount(container);
    const all = node => [node, ...node.children.flatMap(all)];
    assert.equal(all(container).some(node => node.props['aria-label'] === '来源完整模版'), false);
    assert.equal(all(container).filter(node => node.props['aria-label'] === '基准版本').length, 1);
    const checkboxes = all(container).filter(node => node.tag === 'input' && node.props.type === 'checkbox');
    const checkboxFor = id => checkboxes[extensionPackages.findIndex(extension => extension.id === id)];
    assert.equal(checkboxFor(101).props.checked, true); assert.equal(checkboxFor(101).props.disabled, true);
    assert.equal(checkboxFor(102).props.checked, true); assert.equal(checkboxFor(102).props.disabled, true);
    assert.equal(checkboxFor(104).props.checked, true); assert.equal(checkboxFor(104).props.disabled, false);
    assert.equal(all(container).filter(node => node.text === '基准自带').length, 2);
    checkboxFor(101).props.onChange({ target: { checked: false } }); await vue.nextTick();
    assert.deepEqual(plain(model.value.packageIds), [104, 101, 102]);
    checkboxFor(104).props.onChange({ target: { checked: false } }); await vue.nextTick();
    assert.deepEqual(plain(model.value.packageIds), [101, 102]);
    app.unmount();
    console.log('PASS Rendered baseline-owned checkboxes are checked, disabled and labelled; optional checkboxes remain interactive');
  } finally {
    baseReleases.splice(sizes[0]); extensionPackages.splice(sizes[1]);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
