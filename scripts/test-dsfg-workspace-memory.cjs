/* Run with: node scripts/test-dsfg-workspace-memory.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');

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
  const state = { ids: [...ids], writes: [], created: [], trashed: [], trashError: undefined };
  const storage = {
    setProject(projectId) { assert.equal(projectId, 'DSFGStudio'); return this; },
    async getFolders(folder) { assert.equal(folder, '/'); return [...state.ids]; },
    async mkdir(folder) {
      const id = folder.slice(1);
      state.created.push(folder);
      if (!state.ids.includes(id)) state.ids.push(id);
    },
    async writeFile(file, contents) { state.writes.push([file, contents]); },
    async exists(folder) { return state.ids.includes(folder.slice(1)); },
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
    ...vue,
    onBeforeMount: fn => beforeMount.push(fn),
    onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => unmounted.push(fn),
    inject: key => { assert.equal(key, 'storage'); return backend.storage; }, provide() {},
    ProjectID: 'DSFGStudio',
    createStudioSessionHistory: () => history,
    studioSessionHistoryKey: Symbol('history'), studioSidebarKey: Symbol('sidebar'), workspaceStructIdsKey: Symbol('structs'),
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
  scope.run(() => vm.runInContext(`${script}\nglobalThis.studio = { selectedWorkspaceId, workspaceIds, ChangeWorkspace, DelectWorkspace, setEditorRef, switchingEditor };`, context, { filename }));
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
}

main().catch(error => { console.error(error); process.exitCode = 1; });
