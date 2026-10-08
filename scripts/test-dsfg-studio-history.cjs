/* Run: node scripts/test-dsfg-studio-history.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const sfc = require('@vue/compiler-sfc');
const base = path.resolve(__dirname, '../src/views/DSFGStudio/components');
const originalLoad = Module._load, originalTs = Module._extensions['.ts'];
let context, library;
Module._load = function(name, parent, main) {
  if (name === 'miliastra-variable') return library;
  if (name === 'vue') return { ...vue, getCurrentInstance: () => null,
    inject: (key, fallback) => context.values.has(key) ? context.values.get(key) : fallback,
    provide: (key, value) => context.values.set(key, value),
    onMounted: fn => context.mount.push(fn), onBeforeUnmount: fn => context.unmount.push(fn) };
  return originalLoad.call(this, name.startsWith('@/') ? path.resolve(__dirname, '../src', name.slice(2)) : name, parent, main);
};
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, fileName: file,
}).outputText, file);
const plain = value => JSON.parse(JSON.stringify(value));
const tick = async () => { await Promise.resolve(); await vue.nextTick(); await Promise.resolve(); };
function target(kind = 'canvas', owned = true) {
  return { kind, owned,
    matches(selector) { return kind === 'textarea' || kind === 'input' || (kind === 'checkbox' && !selector.includes("not([type='checkbox'])")); },
    closest(selector) {
      if (selector === '[inert]') return this.inert ? this : null;
      if (selector.includes('input') || selector.includes('textarea')) return this.matches(selector) ? this : null;
      return kind === 'menu' && selector.includes('studio-select-menu') ? this : null;
    } };
}
const sessions = [];
function session() {
  const ctx = { values: new Map(), mount: [], unmount: [] }, scope = vue.effectScope();
  const callbacks = new Map(), frames = [];
  const win = { addEventListener(name, fn) { if (!callbacks.has(name)) callbacks.set(name, new Set()); callbacks.get(name).add(fn); },
    removeEventListener(name, fn) { callbacks.get(name)?.delete(fn); if (!callbacks.get(name)?.size) callbacks.delete(name); } };
  const doc = { body: target('body', false), documentElement: target('html', false) };
  function activate() { context = ctx; global.window = win; global.document = doc; global.requestAnimationFrame = fn => frames.push(fn); }
  const f = {
    ctx, callbacks, frames, element: vue.ref({ contains: node => node.owned, closest: () => null }),
    run(fn) { activate(); return scope.run(fn); },
    async mount() { activate(); await Promise.all(ctx.mount.map(fn => fn())); await tick(); },
    fire(name, extra = {}) {
      activate();
      const event = { target: target(), button: 0, pointerId: 1, key: 'z', ctrlKey: false, metaKey: false, altKey: false,
        shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
      for (const fn of [...(callbacks.get(name) ?? [])]) fn(event);
      return event;
    },
    close() { activate(); ctx.unmount.forEach(fn => fn()); scope.stop(); },
  };
  sessions.push(f); return f;
}
async function main() {
  library = await import('miliastra-variable');
  const { useStudioHistory, useStudioDocumentHistory } = require(path.join(base, 'useStudioHistory.ts'));
  const { useWorkspacePresetHistory } = require(path.join(base, 'EntityPresetEditor/useWorkspacePresetHistory.ts'));
  const { useWorkspacePresets } = require(path.join(base, 'EntityPresetEditor/useWorkspacePresets.ts'));
  const custom = require(path.join(base, 'EntityPresetEditor/customPresets.ts'));
  const publicEvents = require(path.join(base, 'EntityPresetEditor/publicEventPresets.ts'));
  const styles = require(path.join(base, 'EntityPresetEditor/stylePresets.ts'));
  const quest = require(path.join(base, 'QuestEditor/questProject.ts'));
  const flow = require(path.join(base, 'QuestEditor/questFlow.ts'));
  const scene = require(path.join(base, 'SceneEditor/sceneProject.ts'));
  const camera = require(path.join(base, 'CameraEditor/cameraProject.ts'));
  const walk = require(path.join(base, 'WalkTalkEditor/walkTalkProject.ts'));
  let passed = 0;
  async function test(name, check) { await check(); passed++; console.log('PASS ' + name); }
  function presetSession() {
    const f = session(), files = new Map(), writes = [], errors = [], activeFile = vue.ref('CustomPresets.json');
    let fail = false;
    const storage = { setProject() { return this; }, async exists(file) { return files.has(file); }, async readFile(file) { return files.get(file); },
      async writeFile(file, data) { if (fail) throw Error('offline'); files.set(file, data); writes.push([file, data]); } };
    f.ctx.values.set('storage', storage); f.ctx.values.set('selectedWorkspaceId', vue.ref('A'));
    const history = f.run(() => useWorkspacePresetHistory({ element: f.element, activeFile: () => activeFile.value, onError: e => errors.push(e) }));
    const state = f.run(custom.useCustomPresets);
    return { ...f, files, writes, errors, activeFile, history, state, set fail(value) { fail = value; } };
  }
  function documentSession(projectValue, label = '修改内容') {
    const f = session(), project = vue.ref(projectValue), blocked = vue.ref(false), errors = [];
    const history = f.run(() => useStudioDocumentHistory({ project, element: f.element, blocked: () => blocked.value, label, onError: e => errors.push(e) }));
    history.reset();
    return { ...f, project, blocked, history, errors };
  }
  await test('Custom field deletion restores all record cells and exact GUID strings; category and record deletion redo', async () => {
    const f = presetSession(); await f.mount();
    const table = custom.createCustomTable(), field = custom.createCustomField(), row = custom.createCustomRecord();
    field.type = 'GUID'; row.values[field.id] = '18446744073709551615'; table.fields.push(field); table.records.push(row);
    f.state.presets.value.push(table); await tick();
    const before = plain(f.state.presets.value), history = f.history.current.value;
    f.state.presets.value[0].fields = [];
    delete f.state.presets.value[0].records[0].values[field.id]; await tick();
    await history.undo(); assert.deepEqual(plain(f.state.presets.value), before);
    await history.redo(); assert.deepEqual(f.state.presets.value[0].records[0].values, {});
    await history.undo(); f.state.presets.value[0].records.splice(0, 1); await tick();
    assert.equal(history.canRedo.value, false);
    await history.undo(); assert.deepEqual(plain(f.state.presets.value), before);
    f.state.presets.value.splice(0, 1); await tick(); await history.undo(); assert.deepEqual(plain(f.state.presets.value), before);
    await history.redo(); await f.state.flush();
    assert.deepEqual(custom.decodeCustomPresets(f.files.get('/A/CustomPresets.json')), []);
    assert.deepEqual(f.errors, []); f.close();
  });
  await test('All editable preset categories register independent CRUD histories and exclude immutable system defaults', async () => {
    const f = presetSession();
    const entities = f.run(() => require(path.join(base, 'EntityPresetEditor/useEntityPresets.ts')).useEntityPresets());
    const skills = f.run(() => require(path.join(base, 'EntityPresetEditor/useSkillAnimationPresets.ts')).useSkillAnimationPresets());
    const events = f.run(() => require(path.join(base, 'EntityPresetEditor/usePublicEventPresets.ts')).usePublicEventPresets());
    const styleStates = ['dialogueStyles', 'questStyles', 'walkTalkStyles', 'cameras'].map(key => [key, f.run(() => styles.useStylePresets(key))]);
    await f.mount();
    const list = [['EntityPresets.json', entities, { id: 'person', name: '角色', talker: 'A', subtitle: '', guid: '', entityQuery: '' }],
      ['SkillAnimationPresets.json', skills, { id: 'skill', name: '动画', configId: '123' }],
      ['PublicEventPresets.json', events, publicEvents.createPublicEventPreset()],
      ...styleStates.map(([key, state]) => [`${key}.json`, state, styles.createStylePreset(key)])];
    for (const [fileName, state, entry] of list) {
      const system = plain(state.systemPresets.value); f.activeFile.value = fileName;
      state.presets.value.push(entry); await tick(); const history = f.history.current.value;
      assert.ok(history.canUndo.value, fileName);
      await history.undo(); assert.deepEqual(state.presets.value, []);
      assert.deepEqual(plain(state.systemPresets.value), system);
      await history.redo(); assert.deepEqual(plain(state.presets.value), [entry]);
    }
    f.activeFile.value = 'EntityPresets.json'; await f.history.current.value.undo();
    assert.equal(skills.presets.value.length, 1); assert.equal(events.presets.value.length, 1);
    f.close(); assert.equal(f.callbacks.size, 0);
  });
  await test('Public-event parameter reorder, reference changes and visibility rules undo as complete edits', async () => {
    const f = presetSession(); f.activeFile.value = 'PublicEventPresets.json';
    const state = f.run(() => require(path.join(base, 'EntityPresetEditor/usePublicEventPresets.ts')).usePublicEventPresets());
    await f.mount();
    const preset = publicEvents.createPublicEventPreset(), a = publicEvents.createPublicEventParameter(), b = publicEvents.createPublicEventParameter();
    a.visibleWhen = [{ parameterId: b.id, equals: '1' }]; a.reference = 'entities.guid';
    preset.parameters = [a, b]; state.presets.value.push(preset); await tick(); const initial = plain(state.presets.value);
    state.presets.value[0].parameters.reverse(); await tick(); await f.history.current.value.undo();
    assert.deepEqual(plain(state.presets.value), initial);
    f.fire('pointerdown', { target: target('menu', false) });
    state.presets.value[0].parameters[0].type = 'String'; state.presets.value[0].parameters[0].reference = undefined;
    f.fire('pointerup'); await tick(); await f.history.current.value.undo(); assert.deepEqual(plain(state.presets.value), initial);
    state.presets.value[0].parameters.splice(1, 1); await tick(); await f.history.current.value.undo();
    assert.deepEqual(plain(state.presets.value), initial); f.close();
  });
  await test('Typing groups per input, checkbox changes remain separate, and category switches finish old input sessions', async () => {
    const f = presetSession(); const state = f.run(() => styles.useStylePresets('dialogueStyles')); await f.mount();
    f.activeFile.value = 'dialogueStyles.json'; state.presets.value.push(styles.createStylePreset('dialogueStyles')); await tick();
    const history = f.history.current.value, before = plain(state.presets.value), input = target('input');
    f.fire('focusin', { target: input });
    for (const label of ['对', '对话', '对话样式']) { state.presets.value[0].label = label; f.fire('input', { target: input }); await tick(); }
    assert.equal(f.fire('keydown', { ctrlKey: true, target: input }).defaultPrevented, false);
    f.activeFile.value = 'CustomPresets.json'; await tick(); f.activeFile.value = 'dialogueStyles.json';
    await history.undo(); assert.deepEqual(plain(state.presets.value), before); await history.redo();
    const checkbox = target('checkbox'); f.fire('focusin', { target: checkbox });
    state.presets.value[0].showTitle = true; f.fire('input', { target: checkbox }); await tick();
    state.presets.value[0].showTitle = false; f.fire('input', { target: checkbox }); await tick();
    assert.equal(f.fire('keydown', { ctrlKey: true, target: checkbox }).defaultPrevented, true); await tick();
    assert.equal(state.presets.value[0].showTitle, true); await history.undo(); assert.equal(state.presets.value[0].showTitle, false);
    f.close();
  });
  await test('Late preset loads do not reset other categories; failed saves persist the latest restored snapshot', async () => {
    const f = presetSession(); await f.mount();
    f.state.presets.value.push(custom.createCustomTable()); await tick(); const history = f.history.current.value;
    const late = f.run(() => styles.useStylePresets('questStyles'));
    await f.mount(); assert.equal(late.ready.value, true); assert.equal(history.canUndo.value, true);
    f.fail = true; await assert.rejects(f.state.flush()); await history.undo(); f.fail = false; await f.state.retry();
    assert.deepEqual(custom.decodeCustomPresets(f.files.get('/A/CustomPresets.json')), []);
    assert.equal(history.canRedo.value, true);
    await history.redo(); await f.state.flush(); assert.equal(custom.decodeCustomPresets(f.files.get('/A/CustomPresets.json')).length, 1);
    f.close();
  });
  await test('Corrupt preset files cannot create undo commands or overwrite the original file', async () => {
    const f = presetSession(); f.files.set('/A/CustomPresets.json', 'corrupt'); await f.mount();
    assert.equal(f.state.ready.value, false); assert.equal(f.history.current.value.canUndo.value, false);
    f.state.presets.value.push(custom.createCustomTable()); await tick(); await f.state.flush();
    assert.equal(f.files.get('/A/CustomPresets.json'), 'corrupt'); f.close();
  });
  await test('Quest creation, parent changes, flow links, cascade deletion and reference clearing restore together', async () => {
    const f = documentSession(quest.createQuestProject()); await f.mount(); const empty = plain(f.project.value);
    const chapter = quest.createQuestChapter(f.project.value), main = quest.createQuestMain(f.project.value, chapter.id);
    const a = quest.createQuestSub(f.project.value, main.id), b = quest.createQuestSub(f.project.value, main.id); await tick();
    const created = plain(f.project.value); await f.history.undo(); assert.deepEqual(plain(f.project.value), empty); await f.history.redo();
    assert.equal(flow.connectQuestFlow(f.project.value, a.id, b.id, 'next'), '');
    f.project.value.subQuests[0].failureQuestId = b.id; await tick(); const linked = plain(f.project.value);
    quest.removeQuestSubQuests(f.project.value, new Set([b.id])); await tick();
    assert.deepEqual(f.project.value.subQuests[0].nextQuestIds, [null]);
    await f.history.undo(); assert.deepEqual(plain(f.project.value), linked);
    await f.history.undo(); assert.deepEqual(plain(f.project.value), created);
    f.project.value.mainQuests[0].chapterId = null; f.project.value.unassignedChapterId = -5; await tick();
    await f.history.undo(); assert.deepEqual(plain(f.project.value), created); f.close();
  });
  await test('Scene ID edits restore parent references and world contact values as one operation', async () => {
    const value = scene.createSceneProject(); value.worlds.push({ id: '5', name: '第二世界', contacts: [] });
    value.worlds[0].contacts.push({ key: '5', x: '1', y: '2', z: '3' }); value.mainAreas.push({ id: '5', name: '第二区域', worldId: '5' });
    const f = documentSession(value); await f.mount(); const initial = plain(f.project.value);
    f.fire('focusin', { target: target('input') }); scene.updateSceneWorldId(f.project.value, f.project.value.worlds[1], '10');
    f.history.finish(); await f.history.undo(); assert.deepEqual(plain(f.project.value), initial);
    await f.history.redo(); assert.equal(f.project.value.mainAreas[1].worldId, '10'); assert.equal(f.project.value.worlds[0].contacts[0].key, '10');
    f.project.value.worlds[0].contacts.splice(0, 1); await tick(); await f.history.undo();
    assert.equal(f.project.value.worlds[0].contacts[0].key, '10'); f.close();
  });
  await test('Camera duration, nested slots, viewpoint and extension drafts survive undo without normalization', async () => {
    const f = documentSession(camera.createCameraProject()); await f.mount(); const before = plain(f.project.value);
    f.fire('pointerdown'); f.project.value.clip.duration = 5;
    f.project.value.clip.components[0].cameraViewpointEnabled = true;
    f.project.value.clip.components[0].properties.positionData.slot[0].vector3 = '-,2,3';
    f.project.value.clip.components[0].properties.future = { draft: '' }; f.fire('pointerup'); await tick();
    const after = plain(f.project.value); await f.history.undo(); assert.deepEqual(plain(f.project.value), before);
    await f.history.redo(); assert.deepEqual(plain(f.project.value), after); f.close();
  });
  await test('Walk-talk drop reordering, deletion and incomplete numeric input preserve entry IDs and values', async () => {
    const value = walk.createWalkTalkProject(); walk.addWalkTalkEntry(value); walk.addWalkTalkEntry(value); walk.addWalkTalkEntry(value);
    const f = documentSession(value); await f.mount(); const initial = plain(f.project.value), id = value.entries[0].id;
    f.fire('pointerdown'); walk.moveWalkTalkEntry(f.project.value, id, 2); f.fire('pointerup'); await tick();
    await f.history.undo(); assert.deepEqual(plain(f.project.value), initial); await f.history.redo();
    const moved = plain(f.project.value); walk.removeWalkTalkEntry(f.project.value, id); await tick(); await f.history.undo();
    assert.deepEqual(plain(f.project.value), moved); f.project.value.entries[0].continueDelay = '-'; await tick();
    await f.history.undo(); await f.history.redo(); assert.equal(f.project.value.entries[0].continueDelay, '-'); f.close();
  });
  await test('Successful loads/imports/deletion isolate history; failed loads preserve existing undo and redo', async () => {
    for (const value of [quest.createQuestProject(), scene.createSceneProject(), camera.createCameraProject(), walk.createWalkTalkProject()]) {
      const loaded = plain(value);
      const f = documentSession(value); await f.mount();
      f.project.value.futureDraft = 'edited'; await tick(); f.blocked.value = true; await tick(); f.blocked.value = false; await tick();
      assert.equal(f.history.canUndo.value, true, value.kind); await f.history.undo(); assert.equal(f.project.value.futureDraft, undefined);
      assert.equal(f.history.canRedo.value, true); f.blocked.value = true;
      f.project.value = loaded; f.blocked.value = false; await tick();
      assert.equal(f.history.canUndo.value, false); assert.equal(f.history.canRedo.value, false);
      f.project.value.futureDraft = 'new-file'; await tick(); await f.history.undo(); assert.equal(f.project.value.futureDraft, undefined);
      f.blocked.value = true; f.project.value = undefined; f.blocked.value = false; await tick();
      assert.equal(f.history.canUndo.value, false); f.close();
    }
  });
  await test('Async structure-ID import and restoring defaults each form one reversible dialog edit', async () => {
    const f = session(), busy = vue.ref(false), draft = vue.ref({ ids: { camera: '123' }, candidates: { camera: ['123', '456'] } });
    const history = f.run(() => useStudioHistory({ element: f.element, blocked: () => busy.value, label: '修改结构体 ID',
      capture: () => JSON.stringify(draft.value), restore: raw => { draft.value = JSON.parse(raw); }, onError: e => { throw e; } }));
    await f.mount(); const before = plain(draft.value);
    busy.value = true; draft.value.ids.camera = '999'; draft.value.candidates = {}; await tick(); busy.value = false; await tick();
    await history.undo(); assert.deepEqual(plain(draft.value), before); await history.redo(); assert.equal(draft.value.ids.camera, '999');
    draft.value = { ids: { camera: '1000' }, candidates: {} }; await tick(); await history.undo(); assert.equal(draft.value.ids.camera, '999'); f.close();
  });
  await test('All editor toolbars, shared history and settings compile as Vue SFCs', () => {
    for (const file of ['StudioHistoryToolbar.vue', 'EntityPresetEditor/EntityPresetEditor.vue', 'EntityPresetEditor/CustomPresetSection.vue',
      'EntityPresetEditor/StylePresetSection.vue', 'QuestEditor/QuestEditor.vue', 'QuestEditor/QuestPanel.vue', 'CameraEditor/CameraEditor.vue',
      'SceneEditor/SceneEditor.vue', 'WalkTalkEditor/WalkTalkEditor.vue', 'WorkspaceStructIdSettings.vue']) {
      const filename = path.join(base, file), source = fs.readFileSync(filename, 'utf8');
      const { descriptor, errors } = sfc.parse(source, { filename }); assert.deepEqual(errors, [], file);
      const script = sfc.compileScript(descriptor, { id: file });
      assert.deepEqual(sfc.compileTemplate({ source: descriptor.template.content, filename, id: file,
        compilerOptions: { bindingMetadata: script.bindings } }).errors, [], file);
      for (const style of descriptor.styles) assert.deepEqual(sfc.compileStyle({ source: style.content, filename, id: file, scoped: style.scoped }).errors, [], file);
    }
  });
  console.log(`\n${passed} DSFG studio history checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  sessions.forEach(f => f.close());
  Module._load = originalLoad;
  if (originalTs) Module._extensions['.ts'] = originalTs; else delete Module._extensions['.ts'];
});
