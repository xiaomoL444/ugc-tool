/* Run with: node scripts/test-dsfg-workspace-memory.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, file);
const targetApi = require('../src/views/DSFGStudio/components/workspaceSettings.ts');
const releaseApi = require('../src/views/DSFGStudio/components/versioning/types.ts');
const featureApi = require('../src/views/DSFGStudio/components/workspaceFeatures.ts');
const catalogApi = require('../src/views/DSFGStudio/components/versioning/catalog.ts');

const filename = path.resolve(__dirname, '../src/views/DSFGStudio/DSFGStudio.vue');
const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename });
assert.deepEqual(errors, []);
const source = descriptor.scriptSetup.content;
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const script = ts.transpileModule(ast.statements
  .filter(node => !ts.isImportDeclaration(node))
  .map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const memoryKey = 'DSFGStudio:lastWorkspaceId';

function browserMemory(initial) {
  const values = new Map(initial === undefined ? [] : [[memoryKey, initial]]);
  const denied = { access: false, read: false, write: false, remove: false };
  const operations = [];
  const storage = {
    getItem(key) {
      operations.push(['get', key]);
      if (denied.read) throw new Error('Storage reads are disabled');
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      operations.push(['set', key, value]);
      if (denied.write) throw new Error('Storage writes are disabled');
      values.set(key, String(value));
    },
    removeItem(key) {
      operations.push(['remove', key]);
      if (denied.remove) throw new Error('Storage removal is disabled');
      values.delete(key);
    },
  };
  return {
    denied, operations,
    get value() { return values.get(memoryKey); },
    get storage() {
      if (denied.access) throw new Error('localStorage access is disabled');
      return storage;
    },
  };
}

function workspaceBackend(ids) {
  const state = { ids: [...ids], files: new Map(), writes: [], created: [], trashed: [], trashError: undefined };
  const storage = {
    setProject(projectId) { assert.equal(projectId, 'DSFGStudio'); return this; },
    async getFolders(folder) { assert.equal(folder, '/'); return [...state.ids]; },
    async mkdir(folder) {
      const id = folder.slice(1);
      state.created.push(folder);
      if (!state.ids.includes(id)) state.ids.push(id);
    },
    async writeFile(file, contents) { state.files.set(file, contents); state.writes.push([file, contents]); },
    async readFile(file) { if (!state.files.has(file)) throw new Error('missing'); return state.files.get(file); },
    async exists(folder) { return state.ids.includes(folder.slice(1)) || state.files.has(folder); },
    async rename(folder, name) {
      const id = folder.slice(1);
      assert.ok(state.ids.includes(id)); assert.ok(!state.ids.includes(name));
      state.ids = state.ids.map(value => value === id ? name : value);
      for (const [file, text] of [...state.files]) if (file.startsWith(folder + '/')) {
        state.files.delete(file); state.files.set('/' + name + file.slice(folder.length), text);
      }
    },
    async trash(folder) {
      state.trashed.push(folder);
      if (state.trashError) throw state.trashError;
      state.ids = state.ids.filter(id => `/${id}` !== folder);
    },
  };
  return { state, storage };
}

function createStudio(backend, memory) {
  const beforeMount = [], mounted = [], unmounted = [], settingsLoads = [], notices = [], logs = [];
  const scope = vue.effectScope();
  const history = {
    busy: vue.ref(false), canUndo: vue.ref(false), canRedo: vue.ref(false),
    finishRegistered() {}, clear() {}, dispose() {}, recordSwitch() {},
    async undo() {}, async redo() {},
  };
  const window = { addEventListener() {}, removeEventListener() {} };
  const contextValues = {
    ...vue, ...targetApi, ...releaseApi, ...featureApi, ...catalogApi,
    workspaceGilCalibrationFiles: value => value.files,
    onBeforeMount: fn => beforeMount.push(fn),
    onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => unmounted.push(fn),
    inject: key => { assert.equal(key, 'storage'); return backend.storage; }, provide() {},
    ProjectID: 'DSFGStudio',
    createStudioSessionHistory: () => history,
    studioSessionHistoryKey: Symbol('history'), studioSidebarKey: Symbol('sidebar'), workspaceStructIdsKey: Symbol('structs'),
    workspaceSettingsKey: Symbol('settings'),
    createWorkspaceStructIds: () => ({ dialogue: 1 }),
    loadWorkspaceStructIds: async (storage, workspaceId) => {
      assert.equal(storage, backend.storage);
      assert.ok(backend.state.ids.includes(workspaceId), `Cannot open missing workspace ${workspaceId}`);
      settingsLoads.push(workspaceId);
      return { ids: { dialogue: 1 }, candidates: {}, warnings: [] };
    },
    validateWorkspaceStructIds: () => [], encodeWorkspaceStructIds: ids => JSON.stringify({ ids }),
    WORKSPACE_STRUCT_IDS_FILE: 'workspace-struct-ids.json',
    SCENE_FILE: 'scene.json', createSceneProject: () => ({ scenes: [] }), encodeSceneProject: JSON.stringify,
    consola: Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [level, (...args) => logs.push([level, ...args])])),
    toast: Object.fromEntries(['warning', 'error', 'success'].map(level => [level, (...args) => notices.push([level, ...args])])),
    DialogueEditor: {}, QuestEditor: {}, WalkTalkEditor: {}, EntityPresetEditor: {}, SceneEditor: {}, CameraEditor: {},
    confirm: () => true, window,
    document: { addEventListener() {}, removeEventListener() {}, body: {}, documentElement: {} },
  };
  Object.defineProperty(contextValues, 'localStorage', { get: () => memory.storage });
  Object.defineProperty(window, 'localStorage', { get: () => memory.storage });
  const context = vm.createContext(contextValues);
  scope.run(() => vm.runInContext(`${script}\nglobalThis.studio = { selectedWorkspaceId, workspaceIds, ChangeWorkspace, DelectWorkspace, setEditorRef, switchingEditor,
    AddWorkspace, openCreateWorkspace, newWorkspaceName, newWorkspaceFileType, newWorkspaceSettings, newWorkspaceCalibration,
    newWorkspaceGilBusy, newWorkspaceCalibrationFiles, visibleEditorTabs, selectedFunction, visitedEditors, ChangeEditorKind,
    workspaceSettings, structSettingsOpen, saveStructSettings, finishWorkspaceSettings };`, context, { filename }));
  return {
    ...context.studio, settingsLoads, notices, logs,
    async open() { for (const hook of beforeMount) await hook(); },
    close() { unmounted.forEach(hook => hook()); scope.stop(); },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function main() {
  {
    const backend = workspaceBackend([]), memory = browserMemory();
    const studio = createStudio(backend, memory);
    await studio.open();
    assert.equal(studio.selectedWorkspaceId.value, '默认工作区');
    assert.deepEqual(backend.state.created, ['/默认工作区']);
    assert.deepEqual(backend.state.writes, [['/默认工作区/scene.json', '{"scenes":[]}']]);
    assert.deepEqual(Array.from(studio.workspaceIds.value), ['默认工作区']);
    assert.deepEqual(studio.settingsLoads, ['默认工作区']);
    assert.equal(memory.value, '默认工作区');
    studio.close();
    console.log('PASS First use creates and remembers the default workspace through the real startup hook');
  }
  {
    const backend = workspaceBackend(['first', 'last']), memory = browserMemory();
    const studio = createStudio(backend, memory);
    await studio.open();
    assert.equal(studio.selectedWorkspaceId.value, 'first');
    assert.equal(memory.value, 'first');
    assert.deepEqual(backend.state.created, []);
    const pending = deferred();
    let saves = 0;
    studio.setEditorRef('Dialogue', { async prepareToLeave() { saves++; await pending.promise; } });
    const switching = studio.ChangeWorkspace('last');
    assert.equal(studio.switchingEditor.value, true);
    assert.equal(memory.value, 'first', 'Pending saves must not overwrite the last successful selection');
    assert.equal(studio.selectedWorkspaceId.value, 'first');
    pending.resolve(); await switching;
    assert.equal(saves, 1);
    assert.equal(studio.selectedWorkspaceId.value, 'last');
    assert.equal(memory.value, 'last');
    studio.close();

    // A separate shell instance represents reopening the page; folder order is not the preference.
    backend.state.ids = ['new-first', 'last', 'first'];
    const reopened = createStudio(backend, memory);
    await reopened.open();
    assert.equal(reopened.selectedWorkspaceId.value, 'last');
    assert.deepEqual(reopened.settingsLoads, ['last'], 'Restoration must load the remembered workspace settings');
    assert.equal(memory.value, 'last');
    reopened.close();
    console.log('PASS Successful switches persist after saving and restore in a new shell despite folder reordering');
  }
  {
    const backend = workspaceBackend(['available', 'other']), memory = browserMemory('deleted-elsewhere');
    const studio = createStudio(backend, memory);
    await studio.open();
    assert.equal(studio.selectedWorkspaceId.value, 'available');
    assert.deepEqual(studio.settingsLoads, ['available']);
    assert.equal(memory.value, 'available', 'Replace an unavailable remembered workspace with the actual fallback');
    studio.close();
    console.log('PASS A missing remembered workspace falls back to the first available workspace and updates memory');
  }
  {
    const backend = workspaceBackend(['saved', 'target']), memory = browserMemory('saved');
    const studio = createStudio(backend, memory);
    await studio.open();
    studio.setEditorRef('Dialogue', { async prepareToLeave() { throw new Error('Cannot save edits'); } });
    await studio.ChangeWorkspace('target');
    assert.equal(studio.selectedWorkspaceId.value, 'saved');
    assert.equal(memory.value, 'saved');
    assert.equal(studio.switchingEditor.value, false);
    assert.deepEqual(studio.settingsLoads, ['saved']);
    assert.ok(studio.notices.some(([level]) => level === 'error'));
    await studio.DelectWorkspace(true);
    assert.equal(studio.selectedWorkspaceId.value, 'saved');
    assert.equal(memory.value, 'saved');
    assert.deepEqual(backend.state.trashed, [], 'A failed save must not delete the workspace');
    studio.close();
    console.log('PASS Failed editor saves preserve both selection and memory during switching and deletion');
  }
  {
    const backend = workspaceBackend(['remove-me', 'remaining']), memory = browserMemory('remove-me');
    const studio = createStudio(backend, memory);
    await studio.open();
    backend.state.trashError = new Error('Cannot delete folder');
    await studio.DelectWorkspace(true);
    assert.equal(studio.selectedWorkspaceId.value, 'remove-me');
    assert.equal(memory.value, 'remove-me');
    assert.deepEqual(backend.state.ids, ['remove-me', 'remaining']);
    backend.state.trashError = undefined;
    await studio.DelectWorkspace(true);
    assert.equal(studio.selectedWorkspaceId.value, '');
    assert.equal(memory.value, undefined);
    assert.deepEqual(Array.from(studio.workspaceIds.value), ['remaining']);
    studio.close();
    const reopened = createStudio(backend, memory);
    await reopened.open();
    assert.equal(reopened.selectedWorkspaceId.value, 'remaining');
    assert.equal(memory.value, 'remaining');
    reopened.close();
    console.log('PASS Successful deletion clears memory; failed deletion preserves it; reopening selects a surviving workspace');
  }
  {
    for (const failure of ['access', 'read', 'write']) {
      const backend = workspaceBackend(['first', 'second']), memory = browserMemory();
      memory.denied[failure] = true;
      const studio = createStudio(backend, memory);
      await studio.open();
      assert.equal(studio.selectedWorkspaceId.value, 'first', `${failure}: opening still works`);
      await studio.ChangeWorkspace('second');
      assert.equal(studio.selectedWorkspaceId.value, 'second', `${failure}: switching still works`);
      assert.equal(studio.switchingEditor.value, false);
      assert.deepEqual(studio.settingsLoads, ['first', 'second']);
      assert.ok(studio.logs.some(([level]) => level === 'warn'), `${failure}: storage failure is reported`);
      studio.close();
    }
    const backend = workspaceBackend(['only']), memory = browserMemory('only');
    memory.denied.remove = true;
    const studio = createStudio(backend, memory);
    await studio.open(); await studio.DelectWorkspace(true);
    assert.equal(studio.selectedWorkspaceId.value, '', 'Unavailable preference storage must not interrupt actual deletion');
    assert.deepEqual(backend.state.ids, []);
    assert.equal(studio.switchingEditor.value, false);
    assert.ok(studio.logs.some(([level]) => level === 'warn'));
    studio.close();
    console.log('PASS Denied localStorage access, reads, writes and removal do not interrupt workspace actions');
  }
  {
    const backend = workspaceBackend(['old']), memory = browserMemory('old');
    const studio = createStudio(backend, memory); await studio.open();
    assert.equal(studio.newWorkspaceFileType.value, 0);
    assert.equal(studio.newWorkspaceSettings.value.baseReleaseId, 2);
    studio.newWorkspaceFileType.value = 2;
    studio.newWorkspaceSettings.value.baseReleaseId = 1;
    studio.openCreateWorkspace();
    assert.equal(studio.newWorkspaceFileType.value, 0, 'Opening creation restores the default Beyond map type');
    assert.equal(studio.newWorkspaceSettings.value.baseReleaseId, 2);
    studio.newWorkspaceName.value = 'new';
    await studio.AddWorkspace();
    assert.equal(studio.selectedWorkspaceId.value, 'new'); assert.equal(memory.value, 'new');
    assert.deepEqual(JSON.parse(backend.state.files.get('/new/WorkspaceSettings.json')),
      targetApi.createWorkspaceSettings({ fileType: 0, baseReleaseId: 2 , packageIds: []}));
    assert.equal(studio.workspaceSettings.value.fileType, 0);
    await studio.ChangeWorkspace('old');
    assert.equal(studio.workspaceSettings.value.baseReleaseId, 1, 'Missing legacy settings keep the 2.0 baseline');
    await studio.ChangeWorkspace('new');
    assert.equal(studio.workspaceSettings.value.baseReleaseId, 2, 'New workspaces use the latest complete release baseline');
    studio.close();
    console.log('PASS New workspaces default to Beyond maps, persist the selected release and load independent targets');
  }
  {
    for (const fileType of [1, 2]) {
      const backend = workspaceBackend(['old']), studio = createStudio(backend, browserMemory('old'));
      await studio.open(); studio.openCreateWorkspace();
      studio.newWorkspaceFileType.value = fileType; studio.newWorkspaceName.value = 'component';
      await studio.AddWorkspace();
      assert.deepEqual(backend.state.created, [], 'Component creation must wait for local GIL calibration');
      studio.newWorkspaceCalibration.value = { files: { 'StructIds.json': '{"calibrated":123}', 'SkillAnimationPresets.json': '{"skill":456}' } };
      studio.newWorkspaceSettings.value.baseReleaseId = 1;
      assert.equal(studio.newWorkspaceCalibrationFiles.value, undefined, 'Changing the target invalidates calibration');
      studio.newWorkspaceCalibration.value = { files: { 'StructIds.json': '{"calibrated":123}', 'SkillAnimationPresets.json': '{"skill":456}' } };
      studio.newWorkspaceGilBusy.value = true; await studio.AddWorkspace();
      assert.deepEqual(backend.state.created, [], 'Creation cannot race the importer');
      studio.newWorkspaceGilBusy.value = false; await studio.AddWorkspace();
      assert.equal(studio.selectedWorkspaceId.value, 'component');
      assert.equal(backend.state.files.get('/component/StructIds.json'), '{"calibrated":123}');
      assert.equal(backend.state.files.get('/component/SkillAnimationPresets.json'), '{"skill":456}');
      assert.equal(backend.state.files.has('/component/scene.json'), false);
      assert.equal(studio.workspaceSettings.value.fileType, fileType);
      const reopened = createStudio(backend, browserMemory('component')); await reopened.open();
      assert.deepEqual(Array.from(reopened.visibleEditorTabs.value, tab => tab.value), ['Dialogue', 'Camera', 'EntityPresets']);
      reopened.close(); studio.close();
    }
    console.log('PASS Both component types require calibration, discard stale targets, persist calibrated files and reopen with filtered tabs');
  }
  {
    const backend = workspaceBackend(['old']), studio = createStudio(backend, browserMemory('old'));
    await studio.open(); studio.openCreateWorkspace(); studio.newWorkspaceName.value = 'retry';
    studio.newWorkspaceFileType.value = 1;
    studio.newWorkspaceCalibration.value = { files: { 'StructIds.json': 'calibrated', 'SkillAnimationPresets.json': 'skills' } };
    const write = backend.storage.writeFile;
    backend.storage.writeFile = async (file, data) => { if (file.endsWith('/WorkspaceSettings.json')) throw new Error('disk full'); return write(file, data); };
    await studio.AddWorkspace();
    assert.deepEqual(backend.state.trashed, ['/retry']); assert.deepEqual(backend.state.ids, ['old']);
    assert.equal(studio.selectedWorkspaceId.value, 'old');
    backend.storage.writeFile = write; await studio.AddWorkspace();
    assert.equal(studio.selectedWorkspaceId.value, 'retry');
    studio.openCreateWorkspace(); studio.newWorkspaceName.value = 'race';
    backend.state.ids.push('race'); backend.state.files.set('/race/important.json', 'existing content');
    await studio.AddWorkspace(); assert.equal(backend.state.files.get('/race/important.json'), 'existing content');
    assert.ok(!backend.state.writes.some(([file]) => file.startsWith('/race/')));
    studio.close(); console.log('PASS Failed calibration writes roll back new folders for retry; a concurrent existing workspace is never overwritten');
  }
  {
    const backend = workspaceBackend(['map', 'component']);
    backend.state.files.set('/component/WorkspaceSettings.json', targetApi.encodeWorkspaceSettings(targetApi.createWorkspaceSettings({ fileType: 1, baseReleaseId: 2 , packageIds: []})));
    const studio = createStudio(backend, browserMemory('map')); await studio.open();
    await studio.ChangeEditorKind('Quest'); assert.equal(studio.selectedFunction.value, 'Quest');
    await studio.ChangeWorkspace('component');
    assert.equal(studio.selectedFunction.value, 'Dialogue');
    assert.deepEqual(Array.from(studio.visitedEditors.value), ['Dialogue']);
    await studio.ChangeEditorKind('Scene'); assert.equal(studio.selectedFunction.value, 'Dialogue', 'History or events cannot open a hidden editor');
    await studio.ChangeWorkspace('map'); await studio.ChangeEditorKind('Scene');
    await studio.saveStructSettings({ dialogue: 1 }, targetApi.createWorkspaceSettings({ fileType: 2, baseReleaseId: 2 , packageIds: []}), 'map');
    assert.equal(studio.selectedFunction.value, 'Dialogue', 'Saving a changed file type leaves an unavailable active editor');
    assert.deepEqual(Array.from(studio.visibleEditorTabs.value, tab => tab.value), ['Dialogue', 'Camera', 'EntityPresets']);
    studio.close();
    console.log('PASS Workspace switching and target changes leave hidden editors while retaining map-only source files');
  }
  {
    const backend = workspaceBackend(['old']), memory = browserMemory('old');
    backend.state.files.set('/old/DialogueEditor/story.json', '{"existing":"dialogue data"}');
    backend.state.files.set('/old/SkillAnimationPresets.json', '{"existing":"skill data"}');
    const studio = createStudio(backend, memory); await studio.open();
    const target = targetApi.createWorkspaceSettings({ fileType: 2, baseReleaseId: 2 , packageIds: []});
    await studio.saveStructSettings({ dialogue: 42 }, target, 'renamed');
    assert.equal(studio.selectedWorkspaceId.value, 'old', 'Rename waits for the dialog to finish skill saves');
    assert.deepEqual(JSON.parse(backend.state.files.get('/old/WorkspaceSettings.json')), target);
    await studio.finishWorkspaceSettings('renamed');
    assert.equal(studio.selectedWorkspaceId.value, 'renamed'); assert.equal(memory.value, 'renamed');
    assert.equal(backend.state.files.get('/renamed/DialogueEditor/story.json'), '{"existing":"dialogue data"}');
    assert.equal(backend.state.files.get('/renamed/SkillAnimationPresets.json'), '{"existing":"skill data"}');
    assert.deepEqual(JSON.parse(backend.state.files.get('/renamed/WorkspaceSettings.json')), target);
    assert.ok(!backend.state.files.has('/old/WorkspaceSettings.json'));
    const reopened = createStudio(backend, memory); await reopened.open();
    assert.equal(reopened.selectedWorkspaceId.value, 'renamed');
    assert.equal(reopened.workspaceSettings.value.fileType, 2); reopened.close(); studio.close();
    console.log('PASS Combined settings save defers renaming until presets are saved, preserves every file and reopens the new name');
  }
  {
    const backend = workspaceBackend(['old']), memory = browserMemory('old');
    const studio = createStudio(backend, memory); await studio.open();
    const prepared = [];
    for (const name of ['Dialogue', 'Quest', 'EntityPresets']) studio.setEditorRef(name, { async prepareToLeave() { prepared.push(name); } });
    studio.structSettingsOpen.value = true;
    assert.equal(await studio.DelectWorkspace(true), true);
    assert.deepEqual(prepared, ['Dialogue', 'Quest', 'EntityPresets']);
    assert.equal(studio.structSettingsOpen.value, false); assert.equal(studio.selectedWorkspaceId.value, '');
    assert.equal(memory.value, undefined); studio.close();
    console.log('PASS Deletion from workspace settings flushes every cached module and closes the settings page');
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
