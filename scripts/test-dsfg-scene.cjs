const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');

async function main() {
  const library = await import('miliastra-variable');
  const root = path.resolve(__dirname, '..');
  const base = path.join(root, 'src/views/DSFGStudio/components/SceneEditor');
  const originalLoad = Module._load, originalTs = Module._extensions['.ts'];
  let context;
  Module._load = function(name, parent, isMain) {
    if (name === 'miliastra-variable') return library;
    if (name === 'vue' && context) return { ...vue, inject: key => context[key], onMounted: fn => context.mount.push(fn), onBeforeUnmount: fn => context.unmount.push(fn) };
    return originalLoad.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, isMain);
  };
  Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file }).outputText, file);
  try {
    const model = require(path.join(base, 'sceneProject.ts'));
    const exporter = require(path.join(base, 'sceneExporter.ts'));
    const sample = require(path.join(root, 'src/assets/DSFGStudio/Scene/NOLOC_场景配置数据.json'));
    const project = model.createSceneProject();
    assert.deepEqual(project.worlds, [{ id: '0', name: '主世界', contacts: [] }]);
    assert.deepEqual(project.mainAreas, [{ id: '0', name: '主区域', worldId: '0' }]);
    assert.deepEqual(project.subAreas, [{ id: '0', name: '主二级区域', mainAreaId: '0', bgm: '0' }]);
    assert.deepEqual(model.decodeSceneProject(model.encodeSceneProject(project)), project);
    const exported = exporter.exportScene(project);
    assert.deepEqual(exported.value, sample);
    assert.deepEqual(exporter.createSceneStructWorkspace(project.structIds).parse(exported.value).issues, []);
    console.log('PASS defaults exactly match supplied scene variable and struct definitions');
    const grouped = model.createSceneProject();
    grouped.mainAreas.push({ id: '2', name: '第二一级区域', worldId: '0' });
    grouped.subAreas = [205, 105, 0, 100, 99].map(id => ({ id: String(id), name: `区域${id}`, mainAreaId: id === 105 ? '2' : '0', bgm: '0' }));
    const originalOrder = grouped.subAreas.map(row => row.id);
    const groupedOutput = exporter.exportScene(grouped);
    const groupedParsed = exporter.createSceneStructWorkspace(grouped.structIds).parse(groupedOutput.value);
    assert.deepEqual(groupedParsed.issues, []);
    const buckets = groupedParsed.value['二级区域'].value;
    assert.deepEqual(buckets.map(entry => [entry.key.value, entry.value.value['二级区域字典'].value.map(row => row.key.value)]), [
      ['0', ['0', '99']], ['1', ['100', '105']], ['2', ['205']],
    ]);
    assert.deepEqual(grouped.subAreas.map(row => row.id), originalOrder);
    grouped.subAreas = [];
    const emptyParsed = exporter.createSceneStructWorkspace(grouped.structIds).parse(exporter.exportScene(grouped).value);
    assert.equal(emptyParsed.value['二级区域'].itemCount, 0);
    console.log('PASS ID / 100 buckets, boundary and sparse IDs, full inner IDs, empty areas and unchanged editor order');
    const edited = model.createSceneProject();
    edited.worlds.push({ id: '3', name: '目标世界', contacts: [] });
    edited.worlds[0].contacts.push({ key: '3', x: '1.25', y: '-2', z: '0' });
    edited.structIds = Object.fromEntries(Object.keys(edited.structIds).map((key, i) => [key, String(20000 + i)]));
    const output = exporter.exportScene(edited);
    const parsed = exporter.createSceneStructWorkspace(edited.structIds).parse(output.value);
    assert.deepEqual(parsed.issues, []);
    assert.equal(output.value.structId, edited.structIds.scene);
    assert.equal(parsed.value['世界'].value[0].value.value.contact.itemCount, 1);
    assert.equal(JSON.stringify(output.value).includes('107793617'), false);
    assert.equal(model.createSceneProject().worlds[0].contacts.length, 0);
    console.log('PASS contact Vector3, custom struct IDs and isolated default copies');
    const linked = model.createSceneProject();
    linked.worlds.push({ id: '3', name: '目标世界', contacts: [] }, { id: '4', name: '其他世界', contacts: [] });
    linked.worlds[0].contacts.push({ key: '3', x: '1', y: '2', z: '3' });
    assert.deepEqual(model.contactWorldOptions(linked, linked.worlds[0]).map(row => row.id), ['4']);
    assert.deepEqual(model.contactWorldOptions(linked, linked.worlds[0], '3').map(row => row.id), ['3', '4']);
    linked.mainAreas.push({ id: '1', name: '目标区域', worldId: '3' });
    model.updateSceneWorldId(linked, linked.worlds[1], '105');
    assert.equal(linked.worlds[0].contacts[0].key, '105');
    assert.equal(linked.mainAreas[1].worldId, '105');
    assert.deepEqual(model.validateSceneProject(linked), []);
    const linkedResult = exporter.createSceneStructWorkspace(linked.structIds).parse(exporter.exportScene(linked).value);
    assert.equal(linkedResult.value['世界'].value[0].value.value.contact.value[0].key.value, '105');
    linked.worlds[0].contacts[0].key = '0';
    assert.ok(model.validateSceneProject(linked).some(message => message.includes('不能关联自身')));
    linked.worlds[0].contacts[0].key = '999';
    assert.ok(model.validateSceneProject(linked).some(message => message.includes('关联世界不存在')));
    linked.worlds[0].contacts[0].key = '105';
    linked.worlds[0].contacts.push({ key: '105', x: '0', y: '0', z: '0' });
    assert.ok(model.validateSceneProject(linked).some(message => message.includes('关联世界 ID不能重复')));
    console.log('PASS world contact choices, ID reference updates, export keys and invalid links');
    edited.mainAreas[0].worldId = '99';
    assert.ok(model.validateSceneProject(edited).some(message => message.includes('所属世界')));
    assert.throws(() => exporter.exportScene(edited));
    assert.throws(() => model.decodeSceneProject('{}'));
    assert.throws(() => model.decodeSceneProject(model.encodeSceneProject({ ...project, worlds: [{ id: 0, name: 'bad', contacts: [] }] })));
    console.log('PASS invalid parents and malformed source are rejected');

    const files = new Map(); let failWrites = false;
    const storage = { setProject() { return this; }, async exists(file) { return files.has(file); }, async readFile(file) { return files.get(file); }, async writeFile(file, value) { if (failWrites) throw new Error('save failed'); files.set(file, value); } };
    async function mount(id) {
      context = { storage, selectedWorkspaceId: vue.ref(id), mount: [], unmount: [] };
      const state = require(path.join(base, 'useSceneProject.ts')).useSceneProject();
      const hooks = context;
      await Promise.all(hooks.mount.map(fn => fn()));
      return { state, hooks };
    }
    const a = await mount('A');
    assert.equal(files.size, 1);
    assert.ok(files.has('/A/Scene.json'));
    a.hooks.selectedWorkspaceId.value = 'B';
    a.state.project.value.worlds[0].name = '改名';
    await a.state.prepareToLeave();
    assert.equal(files.has('/B/Scene.json'), false);
    a.hooks.unmount.forEach(fn => fn());
    const again = await mount('A');
    assert.equal(files.size, 1);
    assert.equal(again.state.project.value.worlds[0].name, '改名');
    failWrites = true;
    again.state.project.value.subAreas[0].bgm = '77';
    await assert.rejects(again.state.prepareToLeave());
    failWrites = false; await again.state.retry();
    assert.equal(model.decodeSceneProject(files.get('/A/Scene.json')).subAreas[0].bgm, '77');
    again.hooks.unmount.forEach(fn => fn());
    files.set('/Broken/Scene.json', 'broken');
    const broken = await mount('Broken');
    assert.equal(broken.state.project.value, undefined);
    assert.ok(broken.state.error.value);
    await broken.state.prepareToLeave();
    assert.equal(files.get('/Broken/Scene.json'), 'broken');
    broken.hooks.unmount.forEach(fn => fn());
    console.log('PASS one scene per workspace, captured save path, retry and corrupt-file preservation');
    for (const file of [path.join(base, 'SceneEditor.vue'), path.join(base, '../EditorKindSelect.vue')]) {
      const { descriptor, errors } = parse(fs.readFileSync(file, 'utf8'), { filename: file });
      assert.deepEqual(errors, []);
      const compiled = compileScript(descriptor, { id: file });
      assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: file, id: file, compilerOptions: { bindingMetadata: compiled.bindings } }).errors, []);
    }
    console.log('PASS scene editor and navigation compile');
  } finally {
    Module._load = originalLoad;
    if (originalTs) Module._extensions['.ts'] = originalTs; else delete Module._extensions['.ts'];
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
