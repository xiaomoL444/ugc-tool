/* node scripts/test-dsfg-runtime-import.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
async function main() {
  const library = await import('miliastra-variable');
  const root = path.resolve(__dirname, '..'), base = path.join(root, 'src/views/DSFGStudio/components');
  const originalLoad = Module._load, originalTs = Module._extensions['.ts'];
  Module._load = function(name, parent, isMain) {
    if (name === 'miliastra-variable') return library;
    return originalLoad.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, isMain);
  };
  Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file }).outputText, file);
  let count = 0;
  const test = async (name, fn) => { await fn(); console.log('PASS ' + name); count++; };
  const load = name => require(path.join(base, name));
  try {
    const wm = load('WalkTalkEditor/walkTalkProject.ts'), we = load('WalkTalkEditor/walkTalkExporter.ts'), wi = load('WalkTalkEditor/walkTalkImporter.ts').importWalkTalk;
    const sm = load('SceneEditor/sceneProject.ts'), se = load('SceneEditor/sceneExporter.ts'), si = load('SceneEditor/sceneImporter.ts').importScene;
    const qm = load('QuestEditor/questProject.ts'), qe = load('QuestEditor/questExporter.ts'), qi = load('QuestEditor/questImporter.ts').importQuest;
    const dm = load('DialogueEditor/utils/dialogueProject.ts'), de = load('DialogueEditor/utils/qxqyPerformanceExporter.ts'), di = load('DialogueEditor/utils/qxqyPerformanceImporter.ts').importQxqyPerformance;
    function customIds(project) { project.structIds = Object.fromEntries(Object.keys(project.structIds).map((key, i) => [key, String(88000 + i)])); }
    const canonical = value => {
      if (Array.isArray(value)) return value.map(canonical);
      if (!value || typeof value !== 'object') return value;
      if (value.param_type === 'Float') return { ...value, value: String(Number(value.value)) };
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, canonical(child)]));
    };
    await test('WalkTalk imports runtime wrapper, custom IDs, order, long IDs, text and numeric params', () => {
      const p = wm.createWalkTalkProject(); customIds(p);
      Object.assign(wm.addWalkTalkEntry(p), { talker: '旅行者', subtitle: '测试', content: '第一行\n第二行', params: '0, -1, 100', continueDelay: '2.9', style: 'Custom_UI' });
      wm.addWalkTalkEntry(p);
      const output = we.exportWalkTalk(p), imported = wi('\uFEFF' + output.json);
      assert.deepEqual(imported.structIds, p.structIds); assert.equal(imported.entries.length, 2);
      assert.deepEqual(we.exportWalkTalk(imported).value, output.value);
      assert.notEqual(imported.entries[0].id, imported.entries[1].id);
    });
    await test('Scene imports world contacts, full inner dictionary keys and inferred nested IDs', () => {
      const p = sm.createSceneProject(); customIds(p);
      p.worlds.push({ id: '5', name: '世界 B', contacts: [] }); p.worlds[0].contacts = [{ key: '5', x: '1.5', y: '2', z: '-3' }];
      p.subAreas[0].id = '199';
      const output = se.exportScene(p); assert.deepEqual(se.exportScene(si(output.json)).value, output.value);
    });
    await test('Quest imports stable IDs, sparse buckets, custom IDs, parent sentinel and references', () => {
      const p = qm.createQuestProject(); customIds(p); p.unassignedChapterId = -42;
      const main = qm.createQuestMain(p); main.id = 50;
      const sub = qm.createQuestSub(p, 50); sub.id = 199; sub.nextQuestIds = [199, null, 9999]; sub.belondPrimaryId = 12;
      const output = qe.exportQuestVariables(p), imported = qi(output.json);
      assert.equal(imported.unassignedChapterId, -42); assert.equal(imported.subQuests[0].id, 199);
      assert.deepEqual(qe.exportQuestVariables(imported).value, output.value);
    });
    await test('Empty runtime configurations import without manufacturing rows', () => {
      assert.equal(wi(we.exportWalkTalk(wm.createWalkTalkProject()).json).entries.length, 0);
      assert.equal(qi(qe.exportQuestVariables(qm.createQuestProject()).json).subQuests.length, 0);
      const scene = sm.createSceneProject(); scene.worlds = []; scene.mainAreas = []; scene.subAreas = [];
      assert.equal(si(se.exportScene(scene).json).worlds.length, 0);
      assert.equal(di(de.exportQxqyPerformance(dm.createEmptyDialogueProject()).json).project.graph.nodes.length, 1);
    });
    await test('Wrong document kinds, incomplete schemas, duplicate dictionary keys and mismatched own IDs are rejected', () => {
      assert.throws(() => wi(wm.encodeWalkTalkProject(wm.createWalkTalkProject())));
      assert.throws(() => qi(se.exportScene(sm.createSceneProject()).json));
      const scene = se.exportScene(sm.createSceneProject()).value;
      scene.value[0].value.value.push(structuredClone(scene.value[0].value.value[0])); assert.throws(() => si(JSON.stringify(scene)), /重复/);
      const bad = se.exportScene(sm.createSceneProject()).value; bad.value[0].value.value[0].key.value = '33'; assert.throws(() => si(JSON.stringify(bad)), /自身 ID/);
      const walk = we.exportWalkTalk(wm.createWalkTalkProject()).value; walk.value.pop(); assert.throws(() => wi(JSON.stringify(walk)), /字段/);
    });
    function node(p, name) {
      const n = dm.createDialogueNode(name); p.dialogue.nodes[n.id] = n;
      p.graph.nodes.push({ id: n.id, type: 'group', position: { x: 0, y: 0 }, data: { dialogueNodeId: n.id } }); return n;
    }
    function edge(p, source, target, handle = 'next') { p.graph.edges.push({ id: crypto.randomUUID(), source, target, sourceHandle: handle, targetHandle: 'input' }); }
    await test('Dialogue imports dialogue/select/custom/public event/camera, loops and empty outlets and survives editor reopen', () => {
      const p = dm.createEmptyDialogueProject(), a = node(p, 'a'), b = node(p, 'b');
      edge(p, p.dialogue.entryNodeId, 'a', 'output'); edge(p, 'a', 'b');
      b.dialogue.advanceMode = 'None'; b.select = dm.createSelectClip(); b.select.options.push(dm.createSelectOption());
      edge(p, 'b', 'a', 'select:' + b.select.options[0].id);
      a.dialogue.nodeGraphEvent = ['0', '15'];
      const camera = dm.createPerformanceClip('Camera', 0.3); camera.duration = 1.5; a.lines[0].clips.push(camera);
      const custom = dm.createPerformanceLine('Custom'), clip = dm.createPerformanceClip('Custom', 0.4); clip.components[0].properties.value = '触发'; custom.clips.push(clip); a.lines.push(custom);
      const publicLine = dm.createPerformanceLine('PublicEvent'), publicClip = dm.createPerformanceClip('PublicEvent', 0.5);
      publicClip.components[0].properties.value = '事件'; publicClip.components[0].properties.parameters = [{ id: 'guid', name: '目标', type: 'Guid', value: '18446744073709551615' }, { id: 'text', name: '文字', type: 'String', value: '你好' }]; publicLine.clips.push(publicClip); a.lines.push(publicLine);
      const output = de.exportQxqyPerformance(p), imported = di(output.json).project;
      assert.equal(imported.graph.edges.length, 3);
      assert.deepEqual(canonical(de.exportQxqyPerformance(imported).value), canonical(output.value));
      const codec = load('DialogueEditor/utils/dialogueProjectCodec.ts');
      const reopened = codec.decodeDialogueProject(codec.encodeDialogueProject(imported));
      assert.deepEqual(canonical(de.exportQxqyPerformance(reopened).value), canonical(output.value));
    });
    await test('Condition branches and FocusPush rebuild per-outlet indices', () => {
      const p = dm.createEmptyDialogueProject(), n = node(p, 'n'); n.focusPush = dm.createFocusPushClip(0.5);
      const branch = dm.createConditionBranchNode('branch'); branch.outputs[0].condition = 'a > 1'; p.dialogue.conditionBranches.branch = branch;
      p.graph.nodes.push({ id: 'branch', type: 'condition', position: { x: 0, y: 0 }, data: { conditionBranchNodeId: 'branch' } });
      edge(p, p.dialogue.entryNodeId, 'branch', 'output'); edge(p, 'branch', 'n', branch.outputs[0].id); edge(p, 'n', 'branch', 'focus-push');
      const output = de.exportQxqyPerformance(p);
      assert.deepEqual(canonical(de.exportQxqyPerformance(di(output.json).project).value), canonical(output.value));
    });
    await test('Unknown dialogue actions and invalid references fail explicitly', () => {
      const p = dm.createEmptyDialogueProject(); node(p, 'a');
      const output = de.exportQxqyPerformance(p).value;
      function change(value) {
        if (Array.isArray(value)) return value.forEach(change);
        if (!value || typeof value !== 'object') return;
        if (value.param_type === 'String' && value.value === 'NOLOC_DIALOG') value.value = 'NOLOC_UNKNOWN';
        else Object.values(value).forEach(change);
      }
      change(output);
      assert.throws(() => di(JSON.stringify(output)), /不支持/);
    });
    const { commitRuntimeImport } = load('runtimeImportStorage.ts');
    await test('Multi-file imports append with collision suffixes and sanitized names', async () => {
      const files = new Map([['/work/a.json', 'old']]);
      const storage = { exists: async p => files.has(p), readFile: async p => files.get(p), writeFile: async (p, value) => files.set(p, value) };
      const result = await commitRuntimeImport({ file: { name: 'a.json', size: 2, text: async () => '{}' }, decode: JSON.parse, encode: JSON.stringify, storage, active: () => true, flush: async () => {}, directory: '/work' });
      assert.equal(result.name, 'a (1).json'); assert.equal(files.get('/work/a.json'), 'old');
    });
    await test('Overwrite confirms, flushes, backs up then writes; cancellation and parse/save errors preserve the document', async () => {
      const files = new Map([['/work/QuestEditor.json', 'old']]), calls = [];
      const storage = { exists: async p => files.has(p), readFile: async p => files.get(p), writeFile: async (p, value) => { calls.push(p); files.set(p, value); } };
      const options = { file: { name: 'a.json', size: 2, text: async () => '{}' }, decode: JSON.parse, encode: JSON.stringify, storage, active: () => true, flush: async () => { calls.push('flush'); }, overwrite: { path: '/work/QuestEditor.json', backupDirectory: '/work/ImportBackups/Quest', confirm: () => false } };
      assert.equal(await commitRuntimeImport(options), undefined); assert.deepEqual(calls, []);
      options.overwrite.confirm = () => true;
      await assert.rejects(commitRuntimeImport({ ...options, decode: () => { throw Error('bad'); } })); assert.deepEqual(calls, []);
      await assert.rejects(commitRuntimeImport({ ...options, flush: async () => { throw Error('save failure'); } })); assert.equal(files.get(options.overwrite.path), 'old');
      await commitRuntimeImport(options); assert.equal(calls[0], 'flush'); assert.ok(calls[1].startsWith('/work/ImportBackups/Quest/')); assert.equal(files.get(calls[1]), 'old'); assert.equal(calls[2], options.overwrite.path);
    });
    await test('Unmount during file read prevents writes', async () => {
      let active = true, writes = 0;
      const result = await commitRuntimeImport({ file: { name: 'x.json', size: 2, text: async () => { active = false; return '{}'; } }, decode: JSON.parse, encode: JSON.stringify, storage: { exists: async () => false, readFile: async () => '', writeFile: async () => { writes++; } }, active: () => active, flush: async () => {}, directory: '/work' });
      assert.equal(result, undefined); assert.equal(writes, 0);
    });
    await test('Backup failure and target-write failure never return a replacement document', async () => {
      const files = new Map([['/work/Scene.json', 'original']]);
      let failBackup = true;
      const options = { file: { name: 'x.json', size: 2, text: async () => '{}' }, decode: JSON.parse, encode: JSON.stringify,
        storage: { exists: async path => files.has(path), readFile: async path => files.get(path), writeFile: async (path, value) => {
          if (failBackup || path === '/work/Scene.json') throw Error('write failed'); files.set(path, value);
        } }, active: () => true, flush: async () => {}, overwrite: { path: '/work/Scene.json', backupDirectory: '/work/ImportBackups/Scene', confirm: () => true } };
      await assert.rejects(commitRuntimeImport(options)); assert.equal(files.size, 1);
      failBackup = false; await assert.rejects(commitRuntimeImport(options));
      assert.equal(files.get('/work/Scene.json'), 'original'); assert.equal(files.size, 2);
    });
    await test('The three actual Vue import handlers install only persisted projects and keep scoped paths', async () => {
      const vue = require('vue'), { parse } = require('@vue/compiler-sfc'), vm = require('node:vm');
      const codec = load('DialogueEditor/utils/dialogueProjectCodec.ts');
      for (const kind of ['Dialogue', 'Quest', 'WalkTalk']) {
        const file = path.join(base, `${kind}Editor/${kind}Editor.vue`), source = parse(fs.readFileSync(file, 'utf8')).descriptor.scriptSetup.content;
        const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const handler = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'importConfiguration');
        assert.ok(handler);
        const files = new Map(), project = vue.ref(), busy = vue.ref(false), messages = [];
        const storage = { setProject: () => storage, exists: async path => files.has(path), readFile: async path => files.get(path), writeFile: async (path, value) => { files.set(path, value); } };
        const bindings = { commitRuntimeImport, importWalkTalk: wi, importQuest: qi, importQxqyPerformance: di,
          encodeWalkTalkProject: wm.encodeWalkTalkProject, encodeQuestProject: qm.encodeQuestProject, encodeDialogueProject: codec.encodeDialogueProject,
          project, dialogueProject: project, busy, fileBusy: busy, disposed: false, exporting: vue.ref(false), loading: false, loadingFile: false,
          storage, ProjectID: 'DSFGStudio', workspaceId: 'captured', documentWorkspaceId: 'captured', DialogueEditorID: 'DialogueEditor',
          documentPath: '/captured/QuestEditor.json', directory: '/captured/WalkTalkEditor', saveQueue: { flush: async () => {} },
          selectedFile: vue.ref(''), selectedDialogueFile: vue.ref(''), selectedGroupNodeId: vue.ref(''), structIdSettingsOpen: vue.ref(false),
          settingsOpen: vue.ref(false), creating: vue.ref(false), newDialogueFileOpen: vue.ref(false), fileError: vue.ref(''), saveStatus: vue.ref(''),
          legacyFiles: vue.ref([]), legacySelection: vue.ref(''), loadError: vue.ref(''), refreshFiles: async () => {}, RefreshDialogueFile: async () => {},
          confirm: () => true, toast: { success: message => messages.push(message), warning: () => {} } };
        const context = vm.createContext(bindings);
        vm.runInContext(ts.transpileModule(handler.getText(ast) + '\n globalThis.runImport = importConfiguration;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
        const text = kind === 'Dialogue' ? de.exportQxqyPerformance(dm.createEmptyDialogueProject()).json : kind === 'Quest' ? qe.exportQuestVariables(qm.createQuestProject()).json : we.exportWalkTalk(wm.createWalkTalkProject()).json;
        await context.runImport({ name: 'runtime.json', size: text.length, text: async () => text });
        assert.ok(project.value); assert.equal(busy.value, false); assert.equal(files.size, 1);
        const outputPath = [...files.keys()][0]; assert.ok(outputPath.startsWith('/captured/'));
        assert.equal(JSON.parse(files.get(outputPath)).type, undefined, 'Storage must contain an editable project, not a runtime Struct');
        assert.equal(messages.length, 1);
        const previous = project.value;
        await assert.rejects(context.runImport({ name: 'bad.json', size: 2, text: async () => '{}' }));
        assert.equal(project.value, previous); assert.equal(files.size, 1); assert.equal(busy.value, false);
      }
    });
    await test('All four editors expose import controls and the reusable file picker compiles', () => {
      const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc');
      for (const relative of ['RuntimeImportButton.vue', 'DialogueEditor/DialogueEditor.vue', 'QuestEditor/QuestEditor.vue', 'WalkTalkEditor/WalkTalkEditor.vue', 'SceneEditor/SceneEditor.vue']) {
        const filename = path.join(base, relative), source = fs.readFileSync(filename, 'utf8'), result = parse(source, { filename });
        assert.deepEqual(result.errors, []); const script = compileScript(result.descriptor, { id: 'runtime-import-test' });
        assert.deepEqual(compileTemplate({ source: result.descriptor.template.content, filename, id: 'runtime-import-test', compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
        for (const style of result.descriptor.styles) assert.deepEqual(compileStyle({ source: style.content, filename, id: 'runtime-import-test', scoped: true }).errors, []);
        if (relative !== 'RuntimeImportButton.vue') assert.ok(source.includes(':import-file="importConfiguration"'));
      }
    });
    console.log(`${count} runtime import checks passed.`);
  } finally { Module._load = originalLoad; if (originalTs) Module._extensions['.ts'] = originalTs; else delete Module._extensions['.ts']; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
