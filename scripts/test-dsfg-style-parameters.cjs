/* Run: node scripts/test-dsfg-style-parameters.cjs; this test creates no files. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const root = path.resolve(__dirname, '..');
const base = path.join(root, 'src/views/DSFGStudio/components');
const originalLoad = Module._load, originalTs = Module._extensions['.ts'];
let context, variableLibrary;
Module._load = function(request, parent, isMain) {
  if (request === 'vue') return { ...vue,
    inject: (key, fallback) => context?.values.has(key) ? context.values.get(key) : fallback,
    onMounted: callback => context.mount.push(callback),
    onBeforeUnmount: callback => context.unmount.push(callback),
  };
  if (request === 'miliastra-variable') return variableLibrary;
  return originalLoad.call(this, request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request, parent, isMain);
};
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  fileName: filename,
}).outputText, filename);
const plain = value => JSON.parse(JSON.stringify(value));
const parameter = (id, defaultValue, name = id, reference) => ({ id, name, type: 'Int32', defaultValue,
  ...(reference ? { reference } : {}) });
const instances = [];
function fixture() {
  const files = new Map(), writes = [];
  return { files, writes, storage: {
    setProject() { return this; }, async exists(file) { return files.has(file); },
    async readFile(file) { return files.get(file); },
    async writeFile(file, raw) { files.set(file, raw); writes.push([file, raw]); },
  } };
}
function instance(useStylePresets, storage, category, workspace = 'A') {
  const ctx = { values: new Map([['storage', storage], ['selectedWorkspaceId', vue.ref(workspace)]]), mount: [], unmount: [] };
  context = ctx;
  const scope = vue.effectScope();
  const state = scope.run(() => useStylePresets(category));
  let closed = false;
  const result = { state, mount: () => Promise.all(ctx.mount.map(callback => callback())),
    close() { if (closed) return; closed = true; context = ctx; ctx.unmount.forEach(callback => callback()); scope.stop(); } };
  instances.push(result);
  return result;
}
async function main() {
  variableLibrary = await import('miliastra-variable');
  const presets = require(path.join(base, 'EntityPresetEditor/stylePresets.ts'));
  const { systemPresetConfig } = require(path.join(base, 'EntityPresetEditor/systemPresetConfig.ts'));
  const { applyStyleParameters, syncStyleParameters } = require(path.join(base, 'DialogueEditor/utils/styleParameters.ts'));
  const { createEmptyDialogueProject, createDialogueNode, createDialogueClip, createSelectClip } = require(path.join(base, 'DialogueEditor/utils/dialogueProject.ts'));
  const { encodeDialogueProject, decodeDialogueProject } = require(path.join(base, 'DialogueEditor/utils/dialogueProjectCodec.ts'));
  const { exportQxqyPerformance } = require(path.join(base, 'DialogueEditor/utils/qxqyPerformanceExporter.ts'));
  const { createQxqyStructWorkspace } = require(path.join(base, 'DialogueEditor/utils/qxqyStructWorkspace.ts'));
  const { applyDialogueTextEdit } = require(path.join(base, 'DialogueEditor/utils/dialogueTextEditing.ts'));
  const { createEditorHistory } = require(path.join(root, 'src/views/ClientUIAnimationEditor/editorHistory.ts'));
  let passed = 0;
  async function test(name, check) { await check(); passed++; console.log('PASS ' + name); }
  await test('Style codecs default only dialogue/select parameters and retain integer metadata', () => {
    const row = { id: 'custom', label: 'Custom', value: 'Style_ID' };
    for (const category of ['dialogueStyles', 'selectStyles']) {
      const old = presets.decodeStylePresets(category, presets.encodeStylePresets(category, [row]))[0];
      assert.deepEqual(old.parameters, []);
      const populated = { ...old, parameters: [parameter('count', '7', '数量', 'entityGetMethods.value')] };
      assert.deepEqual(presets.decodeStylePresets(category, presets.encodeStylePresets(category, [populated]))[0], populated);
      const options = presets.getStylePresetOptions([populated]);
      assert.deepEqual(options[0].parameters, populated.parameters);
      options[0].parameters[0].name = 'Copy';
      assert.equal(populated.parameters[0].name, '数量');
      for (const malformed of [null, {}, [{ ...populated.parameters[0], type: 'String' }],
        [{ ...populated.parameters[0], defaultValue: 1 }], [populated.parameters[0], populated.parameters[0]],
        Array.from({ length: 101 }, (_, index) => parameter('p' + index, '0'))]) {
        assert.throws(() => presets.decodeStylePresets(category, presets.encodeStylePresets(category, [{ ...row, parameters: malformed }])), /原文件已保留/);
      }
    }
    const camera = presets.decodeStylePresets('cameras', presets.encodeStylePresets('cameras', [row]))[0];
    assert.ok(!('parameters' in camera));
    assert.equal(presets.createStyleParameter().type, 'Int32');
    assert.equal(presets.createStyleParameter().defaultValue, systemPresetConfig.styleParameters.newParameter.defaultValue);
    const first = presets.createStylePreset('dialogueStyles'), second = presets.createStylePreset('dialogueStyles');
    first.parameters.push(parameter('independent', '0'));
    assert.deepEqual(second.parameters, []);
    assert.deepEqual(systemPresetConfig.dialogueStyles.newItem.parameters, []);
  });
  await test('Applying presets copies defaults; syncing retains bound snapshots and positional legacy values', () => {
    const definition = { id: 'style', parameters: [parameter('one', '1'), parameter('two', '2')] };
    for (const [create, field] of [[createDialogueClip, 'nodeGraphEvent'], [createSelectClip, 'params']]) {
      const clip = create(); clip.style = definition.id; clip[field] = ['13', '', '99'];
      syncStyleParameters(clip, [definition]);
      assert.deepEqual(clip[field], ['13', '', '99']);
      assert.equal(clip.parameterPreset.parameters[2].name, '旧参数 3');
      const bound = plain(clip.parameterPreset);
      definition.parameters[0].name = 'Updated definition';
      syncStyleParameters(clip, [definition]);
      assert.deepEqual(plain(clip.parameterPreset), bound);
      clip[field][0] = 'User draft';
      syncStyleParameters(clip, [definition]);
      assert.equal(clip[field][0], 'User draft');
      applyStyleParameters(clip, definition);
      assert.deepEqual(clip[field], ['1', '2']);
      assert.equal(clip.parameterPreset.parameters.length, 2);
      clip.parameterPreset.parameters[0].name = 'Independent snapshot';
      assert.notEqual(definition.parameters[0].name, 'Independent snapshot');
      clip.style = 'other';
      syncStyleParameters(clip, [{ id: 'other', parameters: [parameter('new', '-5')] }]);
      assert.deepEqual(clip[field], ['-5']);
      clip.style = 'missing'; const before = plain(clip);
      syncStyleParameters(clip, [definition]);
      assert.deepEqual(plain(clip), before);
      const partial = create(); partial.style = definition.id; partial[field] = ['33'];
      syncStyleParameters(partial, [definition]);
      assert.deepEqual(partial[field], ['33', '2']);
    }
  });
  await test('Real project/clip watchers initialize without recursion and history restores exact edited snapshots', async () => {
    const project = vue.ref(createEmptyDialogueProject()), node = createDialogueNode('watched');
    node.select = createSelectClip(); node.additionalDialogues = [createDialogueClip()];
    node.additionalDialogues[0].nodeGraphEvent = ['91', '92'];
    project.value.dialogue.nodes[node.id] = node;
    const dialogueStylePresets = { ready: vue.ref(false), options: vue.ref([
      { id: node.dialogue.style, parameters: [parameter('dialogue-default', '3', 'Main', 'entityGetMethods.value')] },
      { id: 'alternate-dialogue', parameters: [parameter('dialogue-alternate', '4')] },
    ]) };
    const selectStylePresets = { ready: vue.ref(false), options: vue.ref([
      { id: node.select.style, parameters: [parameter('select-default', '5')] },
      { id: 'alternate-select', parameters: [parameter('select-alternate', '6')] },
    ]) };
    let runs = 0;
    const countedSync = (...args) => { assert.ok(++runs < 80, 'Parameter watchers must settle without recursion'); syncStyleParameters(...args); };
    const scope = vue.effectScope();
    let history;
    try {
      scope.run(() => {
        const source = fs.readFileSync(path.join(base, 'DialogueEditor/DialogueEditor.vue'), 'utf8');
        const start = source.indexOf('function syncProjectStyleParameters()');
        const end = source.indexOf('const exportedGroupIndices', start);
        assert.ok(start >= 0 && end > start, 'Use the actual project synchronization function and watcher');
        vm.runInNewContext(source.slice(start, end), {
          dialogueProject: project, dialogueStylePresets, selectStylePresets,
          syncStyleParameters: countedSync, watchEffect: vue.watchEffect,
        });
        for (const [filename, field, styles] of [
          ['DialogueClipEditor.vue', 'dialogue', dialogueStylePresets],
          ['SelectClipEditor.vue', 'select', selectStylePresets],
        ]) {
          const clipSource = fs.readFileSync(path.join(base, 'DialogueEditor/components/clip-editors', filename), 'utf8');
          const watcher = clipSource.match(/watchEffect\(\(\) => \{ if \(stylesReady\.value\) syncStyleParameters\(props\.clip, \w+\.value\); \}\);/);
          assert.ok(watcher, 'Use the actual clip watcher with its default pre flush');
          vm.runInNewContext(watcher[0], {
            props: { get clip() { return project.value.dialogue.nodes.watched[field]; } },
            stylesReady: styles.ready, dialogueStyles: styles.options, selectStyles: styles.options,
            syncStyleParameters: countedSync, watchEffect: vue.watchEffect,
          });
        }
      });
      assert.equal(runs, 0, 'Preset readiness gates initialization');
      dialogueStylePresets.ready.value = true; selectStylePresets.ready.value = true;
      await vue.nextTick();
      assert.deepEqual(plain(project.value.dialogue.nodes.watched.dialogue.nodeGraphEvent), ['3']);
      assert.deepEqual(plain(project.value.dialogue.nodes.watched.select.params), ['5']);
      assert.deepEqual(plain(project.value.dialogue.nodes.watched.additionalDialogues[0].nodeGraphEvent), ['91', '92']);
      history = createEditorHistory({ capture: () => encodeDialogueProject(project.value),
        restore: snapshot => { project.value = JSON.parse(snapshot); }, describe: () => 'Edit style parameters' });
      scope.run(() => vue.watch(() => encodeDialogueProject(project.value), snapshot => history.observe(snapshot), { flush: 'sync' }));
      const first = project.value.dialogue.nodes.watched;
      first.dialogue.nodeGraphEvent[0] = '17'; first.select.params[0] = '18';
      await vue.nextTick(); await Promise.resolve(); history.flush();
      const userDraft = encodeDialogueProject(project.value);
      dialogueStylePresets.options.value[0].parameters[0].defaultValue = '99';
      selectStylePresets.options.value[0].parameters[0].defaultValue = '98';
      await vue.nextTick();
      assert.equal(encodeDialogueProject(project.value), userDraft, 'Late preset updates retain edited values and reference snapshots');
      assert.equal(history.entries.value.length, 1);
      history.begin('style-picker');
      first.select.style = 'alternate-select';
      applyStyleParameters(first.select, selectStylePresets.options.value[1]);
      applyDialogueTextEdit(project.value, { nodeId: 'watched', field: 'style', value: 'alternate-dialogue' });
      await vue.nextTick(); history.end('style-picker');
      const changed = encodeDialogueProject(project.value);
      assert.deepEqual(plain(project.value.dialogue.nodes.watched.dialogue.nodeGraphEvent), ['4']);
      assert.deepEqual(plain(project.value.dialogue.nodes.watched.select.params), ['6']);
      assert.equal(history.entries.value.length, 2, 'Style changes and copied defaults form one complete gesture');
      await history.undo(); await vue.nextTick();
      assert.equal(encodeDialogueProject(project.value), userDraft, 'Undo restores saved definitions, source references and input values');
      await history.redo(); await vue.nextTick();
      assert.equal(encodeDialogueProject(project.value), changed);
      assert.equal(history.entries.value.length, 2, 'Watchers do not add migration edits after history replay');
      const replayed = project.value.dialogue.nodes.watched;
      applyStyleParameters(replayed.dialogue, dialogueStylePresets.options.value[1]);
      await vue.nextTick();
      assert.deepEqual(plain(replayed.dialogue.nodeGraphEvent), ['4']);
      assert.ok(runs < 80);
    } finally { history?.dispose(); scope.stop(); }
  });
  await test('Project codec retains snapshots and integer runtime export reads only nodeGraphEvent/params', () => {
    const project = createEmptyDialogueProject(), node = createDialogueNode('group');
    node.dialogue.advanceMode = 'None'; node.dialogue.duration = 1; node.select = createSelectClip();
    const dialogueStyle = { id: node.dialogue.style, parameters: [parameter('lower', '-2147483648', 'Lower'), parameter('count', '5', 'Count', 'entityGetMethods.value')] };
    const selectStyle = { id: node.select.style, parameters: [parameter('upper', '2147483647', 'Upper')] };
    applyStyleParameters(node.dialogue, dialogueStyle); applyStyleParameters(node.select, selectStyle);
    node.dialogue.nodeGraphEvent[1] = '+0007';
    project.dialogue.nodes[node.id] = node;
    project.graph.nodes.push({ id: node.id, type: 'group', position: { x: 0, y: 0 }, data: { dialogueNodeId: node.id } });
    project.graph.edges.push({ id: 'entry-group', source: project.dialogue.entryNodeId, target: node.id, sourceHandle: 'output', targetHandle: 'input' });
    const restored = decodeDialogueProject(encodeDialogueProject(project));
    assert.deepEqual(restored.dialogue.nodes.group.dialogue.parameterPreset, node.dialogue.parameterPreset);
    assert.deepEqual(restored.dialogue.nodes.group.select.parameterPreset, node.select.parameterPreset);
    assert.deepEqual(restored.dialogue.nodes.group.dialogue.nodeGraphEvent, ['-2147483648', '+0007']);
    const exported = exportQxqyPerformance(restored, [dialogueStyle]);
    const parsed = createQxqyStructWorkspace(restored.exportSettings.qxqyStructIds).parse(JSON.parse(exported.json));
    assert.deepEqual(parsed.issues, []);
    const table = dictionary => dictionary.value.flatMap(entry => entry.value.value);
    const dialogue = table(parsed.value.DialogueData)[0].value.prams;
    const select = table(parsed.value.DialogueSelectData)[0].value.params;
    assert.equal(dialogue.toParamNode().param_type, 'Int32List');
    assert.equal(select.toParamNode().param_type, 'Int32List');
    assert.deepEqual(dialogue.value, ['-2147483648', '7']);
    assert.deepEqual(select.value, ['2147483647']);
    assert.ok(!exported.json.includes('parameterPreset'));
    assert.ok(!exported.json.includes('entityGetMethods.value'));
    const legacy = plain(project);
    delete legacy.dialogue.nodes.group.dialogue.parameterPreset;
    legacy.dialogue.nodes.group.dialogue.nodeGraphEvent = ['8', '9', '10'];
    const legacyRestored = decodeDialogueProject(legacy);
    syncStyleParameters(legacyRestored.dialogue.nodes.group.dialogue, [dialogueStyle]);
    assert.deepEqual(legacyRestored.dialogue.nodes.group.dialogue.nodeGraphEvent, ['8', '9', '10']);
  });
  await test('Actual export handler waits for both style files and initializes default parameters before compilation', async () => {
    const source = fs.readFileSync(path.join(base, 'DialogueEditor/DialogueEditor.vue'), 'utf8');
    const syncStart = source.indexOf('function syncProjectStyleParameters()');
    const syncEnd = source.indexOf('watchEffect(syncProjectStyleParameters)', syncStart);
    const exportStart = source.indexOf('async function DownloadQxqyPerformanceFile()');
    const exportEnd = source.indexOf('onBeforeMount(', exportStart);
    assert.ok(syncStart >= 0 && syncEnd > syncStart && exportStart >= 0 && exportEnd > exportStart);
    const project = createEmptyDialogueProject(), node = createDialogueNode('exported');
    node.select = createSelectClip(); project.dialogue.nodes[node.id] = node;
    const dialogue = { ready: vue.ref(true), options: vue.ref([{ id: node.dialogue.style, parameters: [parameter('d', '11')] }]) };
    const select = { ready: vue.ref(false), options: vue.ref([]), error: vue.ref('') };
    let retries = 0, compiled = 0, downloads = 0;
    const errors = [];
    select.retry = async () => {
      retries++; select.options.value = [{ id: node.select.style, parameters: [parameter('s', '12')] }];
      select.ready.value = true;
    };
    const sandbox = vm.createContext({
      dialogueProject: vue.ref(project), selectedDialogueFile: vue.ref('Export.json'),
      dialogueStylePresets: dialogue, selectStylePresets: select,
      publicEventPresets: { ready: vue.ref(true), availablePresets: vue.ref([]) },
      syncStyleParameters, syncDialoguePublicEventVisibility() {},
      workspaceIds: { dialogue: value => value },
      exportQxqyPerformance(value) {
        compiled++;
        assert.deepEqual(plain(value.dialogue.nodes.exported.dialogue.nodeGraphEvent), ['11']);
        assert.deepEqual(plain(value.dialogue.nodes.exported.select.params), ['12']);
        return { value: {}, groupOrder: ['exported'], warnings: [] };
      },
      downloadJsonFile() { downloads++; },
      toast: { error: message => errors.push(message), success() {}, warning() {} },
      consola: { warn() {} },
    });
    vm.runInContext(source.slice(syncStart, syncEnd) + source.slice(exportStart, exportEnd), sandbox);
    await sandbox.DownloadQxqyPerformanceFile();
    assert.equal(retries, 1); assert.equal(compiled, 1); assert.equal(downloads, 1); assert.deepEqual(errors, []);
    select.ready.value = false; select.error.value = 'Corrupt option styles';
    select.retry = async () => { retries++; };
    await sandbox.DownloadQxqyPerformanceFile();
    assert.deepEqual(errors, ['Corrupt option styles']);
    assert.equal(compiled, 1, 'Failed option style loads must not silently export missing defaults');
    assert.equal(downloads, 1);
  });
  await test('Workspace reload persists system integer parameters while select label/value stay fixed', async () => {
    for (const category of ['dialogueStyles', 'selectStyles']) {
      const f = fixture(), writer = instance(presets.useStylePresets, f.storage, category);
      const reader = instance(presets.useStylePresets, f.storage, category);
      const otherWorkspace = instance(presets.useStylePresets, f.storage, category, 'B');
      await Promise.all([writer.mount(), reader.mount(), otherWorkspace.mount()]);
      const original = plain(writer.state.systemPresets.value[0]);
      writer.state.systemPresets.value[0].parameters.push(parameter('setting', '42', '设置', 'entityGetMethods.value'));
      writer.state.systemPresets.value[0].label = 'Attempted rename';
      assert.equal(writer.state.systemPresets.value[0].label, original.label);
      if (category === 'selectStyles') {
        writer.state.systemPresets.value[0].value = 'Attempted type edit';
        assert.equal(writer.state.systemPresets.value[0].value, original.value);
      }
      await writer.state.flush();
      const saved = JSON.parse(f.files.get(`/A/${category}.json`));
      assert.equal(saved.presetStorage, 'system-overrides');
      assert.deepEqual(saved.presets, []);
      assert.deepEqual(saved.systemOverrides[0].parameters, [parameter('setting', '42', '设置', 'entityGetMethods.value')]);
      assert.equal(reader.state.systemPresets.value[0].parameters[0].defaultValue, '42');
      assert.deepEqual(plain(otherWorkspace.state.systemPresets.value[0].parameters), []);
      writer.close(); reader.close(); otherWorkspace.close();
      const reloaded = instance(presets.useStylePresets, f.storage, category);
      await reloaded.mount();
      assert.deepEqual(plain(reloaded.state.systemPresets.value[0].parameters), saved.systemOverrides[0].parameters);
      assert.equal(reloaded.state.options.value[0].parameters[0].reference, 'entityGetMethods.value');
      reloaded.close();
    }
  });
  await test('Legacy edited system option style remains custom and corrupt parameter files are preserved', async () => {
    const f = fixture();
    const legacy = { id: 'select-default', label: 'Edited legacy label', value: 'Legacy_UI' };
    f.files.set('/A/selectStyles.json', presets.encodeStylePresets('selectStyles', [legacy]));
    const loaded = instance(presets.useStylePresets, f.storage, 'selectStyles'); await loaded.mount();
    assert.equal(loaded.state.systemPresets.value[0].value, 'Default_UI');
    assert.deepEqual(plain(loaded.state.customPresets.value[0]), { ...legacy, id: 'custom:select-default', parameters: [] });
    loaded.state.systemPresets.value[0].parameters.push(parameter('customized', '3'));
    await loaded.state.flush(); loaded.close();
    const reloaded = instance(presets.useStylePresets, f.storage, 'selectStyles'); await reloaded.mount();
    assert.equal(reloaded.state.customPresets.value[0].value, 'Legacy_UI');
    assert.equal(reloaded.state.systemPresets.value[0].parameters[0].defaultValue, '3');
    reloaded.close();
    const corrupt = presets.encodeStylePresets('dialogueStyles', [{ id: 'broken', label: 'Broken', value: 'Bad', parameters: null }]);
    f.files.set('/A/dialogueStyles.json', corrupt);
    const broken = instance(presets.useStylePresets, f.storage, 'dialogueStyles'); await broken.mount();
    assert.equal(broken.state.ready.value, false); assert.match(broken.state.error.value, /原文件已保留/);
    await broken.state.flush(); assert.equal(f.files.get('/A/dialogueStyles.json'), corrupt);
    broken.close();
  });
  console.log(`${passed} style parameter regression checks passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  instances.forEach(item => item.close());
  Module._load = originalLoad;
  if (originalTs) Module._extensions['.ts'] = originalTs; else delete Module._extensions['.ts'];
});
