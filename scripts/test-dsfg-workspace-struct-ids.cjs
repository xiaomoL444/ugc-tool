/* node scripts/test-dsfg-workspace-struct-ids.cjs [sample.gil] */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc');

async function main() {
  const library = await import('miliastra-variable');
  const converter = await import('genshin-impact-ugc-file-converter-web');
  const root = path.resolve(__dirname, '..'), base = path.join(root, 'src/views/DSFGStudio/components');
  const originalLoad = Module._load, originalTs = Module._extensions['.ts'];
  Module._load = function(name, parent, main) {
    if (name === 'miliastra-variable') return library;
    if (name === 'genshin-impact-ugc-file-converter-web') return converter;
    return originalLoad.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, main);
  };
  Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file,
  }).outputText, file);
  try {
    const config = require(path.join(base, 'workspaceStructIds.ts'));
    const gil = require(path.join(base, 'gilStructIds.ts'));
    const { workspaceStructIdsKey, useWorkspaceStructIds } = require(path.join(base, 'useWorkspaceStructIds.ts'));
    const defaults = config.createWorkspaceStructIds();
    const memory = (initial = []) => {
      const data = new Map(initial), writes = [];
      return { data, writes, async exists(p) { return data.has(p) || [...data.keys()].some(key => key.startsWith(`${p}/`)); },
        async getFiles(p) { return [...data.keys()].filter(key => key.startsWith(`${p}/`)).map(key => key.slice(p.length + 1)); },
        async readFile(p) { if (!data.has(p)) throw new Error('missing'); return data.get(p); },
        async writeFile(p, text) { writes.push(p); data.set(p, text); } };
    };
    let count = 0;
    async function test(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
    await test('A new workspace has all 21 active IDs, with PositionSlot in the performance module', async () => {
      const storage = memory();
      const result = await config.loadWorkspaceStructIds(storage, 'new');
      assert.equal(Object.keys(result.ids).length, 21);
      assert.deepEqual(config.validateWorkspaceStructIds(result.ids), []);
      const modules = config.moduleStructIds(result.ids);
      assert.equal(modules.quest.positionSlot, modules.dialogue.cameraSlot);
      assert.deepEqual(storage.writes, []);
    });
    await test('Legacy custom IDs migrate without modifying documents; conflicts require a choice', async () => {
      const old = id => JSON.stringify({ exportSettings: { qxqyStructIds: { ...config.moduleStructIds(defaults).dialogue, dialogue: id } } });
      const storage = memory([['/a/DialogueEditor/one.json', old('123')], ['/a/DialogueEditor/two.json', old('456')],
        ['/a/QuestEditor.json', JSON.stringify({ structIds: { configuration: '789', positionSlot: '999' } })],
        ['/a/Scene.json', '{broken']]);
      const result = await config.loadWorkspaceStructIds(storage, 'a');
      assert.equal(result.ids['dialogue.dialogue'], '');
      assert.deepEqual(result.candidates['dialogue.dialogue'].map(item => item.id), ['123', '456']);
      assert.equal(result.ids['quest.configuration'], '789');
      assert.equal(result.ids['dialogue.cameraSlot'], defaults['dialogue.cameraSlot'], 'obsolete quest PositionSlot must not override the camera ID');
      assert.equal(result.warnings.length, 1);
      assert.deepEqual(storage.writes, []);
      result.ids['dialogue.dialogue'] = '123';
      await storage.writeFile('/a/StructIds.json', config.encodeWorkspaceStructIds(result.ids));
      assert.deepEqual((await config.loadWorkspaceStructIds(storage, 'a')).ids, result.ids);
      assert.deepEqual((await config.loadWorkspaceStructIds(storage, 'b')).ids, defaults);
      assert.equal(storage.data.get('/a/DialogueEditor/two.json'), old('456'));
    });
    await test('Broken workspace settings cannot be silently replaced by defaults', async () => {
      for (const text of ['{bad', '{}', JSON.stringify({ kind: 'DSFGStructIds', schemaVersion: 1, ids: { 'dialogue.dialogue': 42 } })]) {
        const storage = memory([['/a/StructIds.json', text]]);
        await assert.rejects(config.loadWorkspaceStructIds(storage, 'a'));
        assert.deepEqual(storage.writes, []);
        assert.equal(storage.data.get('/a/StructIds.json'), text);
      }
    });
    await test('ID validation rejects blank, out-of-range and numerically duplicate IDs', () => {
      for (const id of ['', '-1', '2147483648', 'NaN', `0${defaults['dialogue.performance']}`]) {
        assert.ok(config.validateWorkspaceStructIds({ ...defaults, 'quest.chapter': id }).length);
      }
      assert.throws(() => config.encodeWorkspaceStructIds({ ...defaults, 'quest.chapter': '' }));
    });
    await test('GIL table extraction ignores graph references, handles singleton and duplicated snapshots', () => {
      const snapshot = { '1': 501, '501': 'string:[演出]对话' };
      const structs = gil.readGilStructTable({ json: { '10': { '1': { '1': 99, '501': 'string:[演出]对话' }, '6': { '1': snapshot, '2': snapshot } } } });
      assert.deepEqual(structs, [{ id: '501', name: '[演出]对话' }]);
      assert.throws(() => gil.readGilStructTable({ json: {} }));
      assert.throws(() => gil.importGilStructIds(new Uint8Array([1, 2, 3]), defaults));
      const match = gil.matchGilStructIds(structs, defaults);
      assert.equal(match.ids['dialogue.dialogue'], '501');
      assert.equal(match.ids['quest.chapter'], defaults['quest.chapter']);
      assert.equal(match.missing.length, 20);
      const ambiguous = gil.matchGilStructIds([...structs, { id: '502', name: '[演出]对话' }], defaults);
      assert.equal(ambiguous.ids['dialogue.dialogue'], '');
      assert.equal(ambiguous.candidates['dialogue.dialogue'].length, 2);
      assert.deepEqual(defaults, config.createWorkspaceStructIds());
    });
    if (process.argv[2]) await test('The supplied real GIL identifies every DSFG structure ID', () => {
      const result = gil.importGilStructIds(fs.readFileSync(process.argv[2]), defaults);
      assert.equal(result.matched.length, 21);
      assert.deepEqual(result.missing, []); assert.deepEqual(result.ambiguous, []);
      assert.deepEqual(config.validateWorkspaceStructIds(result.ids), []);
      assert.equal(result.ids['quest.subQuestDictionary'], '1077936170');
    });
    await test('All modules export workspace IDs immediately, including nested types, without rewriting documents', () => {
      const ids = vue.ref(Object.fromEntries(Object.keys(defaults).map((key, index) => [key, String(1200000000 + index)])));
      const error = vue.ref('');
      const app = vue.createApp({}); app.provide(workspaceStructIdsKey, { ids, error });
      const effective = app.runWithContext(useWorkspaceStructIds);
      const { createEmptyDialogueProject, createDialogueNode } = require(path.join(base, 'DialogueEditor/utils/dialogueProject.ts'));
      const { createQuestProject, createQuestChapter, createQuestMain, createQuestSub } = require(path.join(base, 'QuestEditor/questProject.ts'));
      const { createWalkTalkProject, addWalkTalkEntry } = require(path.join(base, 'WalkTalkEditor/walkTalkProject.ts'));
      const { createSceneProject } = require(path.join(base, 'SceneEditor/sceneProject.ts'));
      const dialogue = createEmptyDialogueProject(), quest = createQuestProject(), walkTalk = createWalkTalkProject(), scene = createSceneProject();
      dialogue.dialogue.nodes.group = createDialogueNode('group');
      dialogue.graph.nodes.push({ id: 'group', type: 'group', position: { x: 0, y: 0 } });
      dialogue.graph.edges.push({ id: 'entry', source: dialogue.dialogue.entryNodeId, target: 'group' });
      const chapter = createQuestChapter(quest), main = createQuestMain(quest, chapter.id); createQuestSub(quest, main.id);
      addWalkTalkEntry(walkTalk);
      const before = JSON.stringify([dialogue, quest, walkTalk, scene]);
      const outputs = [
        require(path.join(base, 'DialogueEditor/utils/qxqyPerformanceExporter.ts')).exportQxqyPerformance(effective.dialogue(dialogue)).json,
        require(path.join(base, 'QuestEditor/questExporter.ts')).exportQuestVariables(effective.quest(quest)).json,
        require(path.join(base, 'WalkTalkEditor/walkTalkExporter.ts')).exportWalkTalk(effective.walkTalk(walkTalk)).json,
        require(path.join(base, 'SceneEditor/sceneExporter.ts')).exportScene(effective.scene(scene)).json,
      ];
      const expected = config.moduleStructIds(ids.value);
      for (const [index, rootId] of [expected.dialogue.performance, expected.quest.configuration, expected.walkTalk.sequence, expected.scene.scene].entries()) {
        assert.equal(JSON.parse(outputs[index]).structId, rootId);
        for (const old of Object.values(defaults)) assert.ok(!outputs[index].includes(`"${old}"`), `old nested ID ${old} in module ${index}`);
      }
      assert.equal(JSON.stringify([dialogue, quest, walkTalk, scene]), before);
      ids.value = { ...ids.value, 'dialogue.dialogue': '1300000000' };
      assert.equal(effective.dialogue(dialogue).exportSettings.qxqyStructIds.dialogue, '1300000000');
      error.value = 'read failed'; assert.throws(() => effective.scene(scene), /read failed/);
      error.value = ''; ids.value['scene.world'] = ''; assert.throws(() => effective.scene(scene), /设置结构体 ID/);
    });
    await test('The actual settings dialog isolates drafts and retains edits on read/save failure', async () => {
      const filename = path.join(base, 'WorkspaceStructIdSettings.vue');
      const descriptor = parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor;
      const ast = ts.createSourceFile(`${filename}.ts`, descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const script = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      const events = [], saves = [];
      let failSave = true;
      const props = { workspace: 'a', state: { ids: { ...defaults }, candidates: {}, warnings: [] }, loadError: '',
        async saveSettings(ids) { if (failSave) throw new Error('disk full'); saves.push({ ...ids }); } };
      const context = vm.createContext({ ...config, ...vue, Error, document: { activeElement: null },
        // This VM isolates dialog I/O; gesture/history behavior runs in test-dsfg-studio-history.cjs.
        useStudioHistory: () => ({}),
        defineProps: () => props, defineEmits: () => (...args) => events.push(args), onMounted() {}, onBeforeUnmount() {},
        require: name => { assert.equal(name, './gilStructIds'); return gil; } });
      vm.runInContext(`${script}\nglobalThis.api = { draft, candidates, busy, error, save, close, readGil, importMessage };`, context);
      const ui = context.api;
      ui.draft.value['quest.chapter'] = '200';
      ui.close(); assert.equal(props.state.ids['quest.chapter'], defaults['quest.chapter']);
      events.length = 0;
      await ui.save(); assert.equal(ui.error.value, 'disk full'); assert.equal(events.length, 0); assert.equal(ui.draft.value['quest.chapter'], '200');
      await ui.readGil({ target: { files: [{ name: 'broken.gil', size: 3, async arrayBuffer() { return new Uint8Array([1, 2, 3]); } }], value: 'chosen' } });
      assert.ok(ui.error.value); assert.equal(ui.draft.value['quest.chapter'], '200'); assert.equal(ui.busy.value, false);
      if (process.argv[2]) {
        const bytes = fs.readFileSync(process.argv[2]);
        await ui.readGil({ target: { files: [{ name: 'sample.gil', size: bytes.length, async arrayBuffer() { return bytes; } }], value: 'chosen' } });
        assert.equal(ui.error.value, ''); assert.match(ui.importMessage.value, /21 \/ 21/); assert.equal(saves.length, 0);
      }
      failSave = false; await ui.save(); assert.equal(saves.length, 1); assert.equal(events.at(-1)[0], 'close');
      ui.draft.value['quest.chapter'] = ''; await ui.save(); assert.equal(saves.length, 1);
    });
    await test('The shell saves only after successful storage and loads settings before opening the dialog', async () => {
      const filename = path.join(base, '../DSFGStudio.vue');
      const source = parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor.scriptSetup.content;
      const ast = ts.createSourceFile('shell.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const names = ['readStructSettings', 'openStructSettings', 'saveStructSettings'];
      const script = ts.transpileModule(ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name.text)).map(node => node.getText(ast)).join('\n'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      const memoryStorage = memory(), storage = { ...memoryStorage, setProject() { return this; } };
      const notices = [];
      const state = { ...config, storage, ProjectID: 'DSFGStudio', selectedWorkspaceId: vue.ref('a'), switchingEditor: vue.ref(false),
        structSettingsOpen: vue.ref(false), structSettingsError: vue.ref(''), structSettings: vue.ref({ ids: { ...defaults }, candidates: {}, warnings: [] }),
        editorRef: vue.ref({ async prepareToLeave() {} }), toast: { success: m => notices.push(m), error: m => notices.push(m) } };
      const context = vm.createContext(state); vm.runInContext(script, context);
      await context.openStructSettings(); assert.equal(state.structSettingsOpen.value, true); assert.equal(state.switchingEditor.value, false);
      const changed = { ...defaults, 'quest.chapter': '300' };
      storage.writeFile = async () => { throw new Error('offline'); };
      await assert.rejects(context.saveStructSettings(changed), /offline/);
      assert.equal(state.structSettings.value.ids['quest.chapter'], defaults['quest.chapter']);
      storage.writeFile = memoryStorage.writeFile; await context.saveStructSettings(changed);
      assert.equal(state.structSettings.value.ids['quest.chapter'], '300');
      assert.equal(JSON.parse(storage.data.get('/a/StructIds.json')).ids['quest.chapter'], '300');
      await context.readStructSettings('b'); assert.equal(state.structSettings.value.ids['quest.chapter'], defaults['quest.chapter']);
      storage.data.set('/b/StructIds.json', '{bad'); await context.readStructSettings('b'); assert.ok(state.structSettingsError.value);
      await assert.rejects(context.saveStructSettings(changed), /原文件/);
      assert.equal(storage.data.get('/b/StructIds.json'), '{bad');
    });
    await test('Workspace dialog and all editor templates compile with the centralized menu', () => {
      for (const relative of ['../DSFGStudio.vue', 'WorkspaceStructIdSettings.vue', 'DialogueEditor/DialogueEditor.vue', 'QuestEditor/QuestEditor.vue', 'WalkTalkEditor/WalkTalkEditor.vue', 'SceneEditor/SceneEditor.vue']) {
        const filename = path.join(base, relative), source = fs.readFileSync(filename, 'utf8');
        const { descriptor, errors } = parse(source, { filename }); assert.deepEqual(errors, []);
        const script = compileScript(descriptor, { id: 'workspace-ids' });
        assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: 'workspace-ids', compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
        for (const style of descriptor.styles) assert.deepEqual(compileStyle({ source: style.content, filename, id: 'workspace-ids', scoped: style.scoped }).errors, []);
        if (relative.endsWith('Editor.vue')) assert.ok(!descriptor.template.content.includes('结构体 ID 设置'));
      }
    });
    console.log(`\n${count} workspace struct ID checks passed.`);
  } finally { Module._load = originalLoad; if (originalTs) Module._extensions['.ts'] = originalTs; else delete Module._extensions['.ts']; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
