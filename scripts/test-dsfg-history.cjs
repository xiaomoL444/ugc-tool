/* Run: node scripts/test-dsfg-history.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const originalLoad = Module._load, originalTs = Module._extensions['.ts'];
let hooks, variableLibrary;
Module._load = function(request, parent, main) {
  if (request === 'vue') return { ...vue, onMounted: fn => hooks.mount.push(fn), onBeforeUnmount: fn => hooks.unmount.push(fn) };
  if (request === 'miliastra-variable') return variableLibrary;
  return originalLoad.call(this, request.startsWith('@/') ? path.resolve(__dirname, '../src', request.slice(2)) : request, parent, main);
};
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, fileName: file,
}).outputText, file);
const editor = path.resolve(__dirname, '../src/views/DSFGStudio/components/DialogueEditor');
let useDialogueHistory, createEmptyDialogueProject, createDialogueNode, createPerformanceClip, encodeDialogueProject;
const { createWorkspaceSaveQueue } = require(path.join(editor, '../QuestEditor/workspaceSaveQueue.ts'));
const tick = async () => { await Promise.resolve(); await vue.nextTick(); await Promise.resolve(); };
function target(kind = 'canvas', owned = true) {
  return { kind, owned, matches: selector => ['input', 'textarea'].includes(kind) && selector.includes(kind),
    closest(selector) { return this.matches(selector) ? this : null; } };
}
function fixture() {
  hooks = { mount: [], unmount: [] };
  const callbacks = new Map(), frames = [];
  global.document = { body: target('body', false), documentElement: target('html', false) };
  global.window = { addEventListener(name, fn) { callbacks.set(name, fn); }, removeEventListener(name, fn) { if (callbacks.get(name) === fn) callbacks.delete(name); } };
  global.requestAnimationFrame = fn => { frames.push(fn); };
  const project = vue.ref(createEmptyDialogueProject()), blocked = vue.ref(false), errors = [];
  const scope = vue.effectScope();
  let restores = 0;
  const history = scope.run(() => useDialogueHistory({ project, element: vue.ref({ contains: node => node.owned }),
    blocked: () => blocked.value, afterRestore: () => { restores++; }, onError: error => errors.push(error) }));
  history.reset(); hooks.mount.forEach(fn => fn());
  const cleanup = hooks.unmount;
  function fire(name, extra = {}) {
    const event = { target: target(), button: 0, pointerId: 1, key: 'z', ctrlKey: false, metaKey: false, shiftKey: false,
      altKey: false, repeat: false, isComposing: false, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
    callbacks.get(name)?.(event); return event;
  }
  return { project, blocked, history, fire, callbacks, frames, errors, scope, get restores() { return restores; },
    close() { cleanup.forEach(fn => fn()); scope.stop(); } };
}
let passed = 0;
async function test(name, check) { await check(); passed++; console.log('PASS ' + name); }
async function main() {
  variableLibrary = await import('miliastra-variable');
  ({ useDialogueHistory } = require(path.join(editor, 'useDialogueHistory.ts')));
  ({ createEmptyDialogueProject, createDialogueNode, createPerformanceClip } = require(path.join(editor, 'utils/dialogueProject.ts')));
  ({ encodeDialogueProject } = require(path.join(editor, 'utils/dialogueProjectCodec.ts')));
  await test('Create, connect, reconnect and delete restore business nodes and graph edges exactly', async () => {
    const f = fixture(), initial = encodeDialogueProject(f.project.value);
    const a = createDialogueNode('a'), b = createDialogueNode('b');
    f.project.value.dialogue.nodes = { a, b };
    f.project.value.graph.nodes.push(...['a', 'b'].map((id, i) => ({ id, type: 'group', position: { x: i * 300, y: 0 }, data: { dialogueNodeId: id } })));
    await tick(); const created = encodeDialogueProject(f.project.value);
    f.project.value.graph.edges.push({ id: 'edge', source: 'a', target: 'b', sourceHandle: 'next' });
    await tick(); const connected = encodeDialogueProject(f.project.value);
    f.project.value.graph.edges[0].target = 'a'; await tick();
    await f.history.undo(); assert.equal(encodeDialogueProject(f.project.value), connected);
    await f.history.undo(); assert.equal(encodeDialogueProject(f.project.value), created);
    await f.history.undo(); assert.equal(encodeDialogueProject(f.project.value), initial);
    await f.history.redo(); await f.history.redo(); assert.equal(encodeDialogueProject(f.project.value), connected);
    delete f.project.value.dialogue.nodes.b;
    f.project.value.graph.nodes = f.project.value.graph.nodes.filter(n => n.id !== 'b');
    f.project.value.graph.edges = []; await tick();
    await f.history.undo(); assert.equal(encodeDialogueProject(f.project.value), connected);
    assert.deepEqual(f.errors, []); f.close();
  });
  await test('One node or Timeline drag is one step, while selection and measurements add no history', async () => {
    const f = fixture();
    f.project.value.dialogue.nodes.a = createDialogueNode('a');
    f.project.value.graph.nodes.push({ id: 'a', type: 'group', position: { x: 0, y: 0 }, data: { dialogueNodeId: 'a' } });
    f.history.reset();
    const initial = encodeDialogueProject(f.project.value);
    f.project.value.graph.nodes[0].selected = true;
    f.project.value.graph.nodes[0].dimensions = { width: 252, height: 200 };
    await tick(); assert.equal(f.history.canUndo.value, false);
    f.fire('pointerdown');
    for (let i = 1; i <= 8; i++) { f.project.value.graph.nodes[0].position.x = i * 20; await tick(); }
    assert.equal(f.history.entries.value.length, 0);
    f.fire('pointerup'); await tick(); assert.equal(f.history.entries.value.length, 1);
    await f.history.undo(); assert.equal(encodeDialogueProject(f.project.value), initial);
    await f.history.redo(); assert.equal(f.project.value.graph.nodes[0].position.x, 160);
    f.fire('pointerdown');
    for (let i = 1; i < 6; i++) { f.project.value.dialogue.nodes.a.dialogue.continueDelayTime = i; await tick(); }
    f.fire('pointerup'); await tick();
    await f.history.undo(); assert.equal(f.project.value.dialogue.nodes.a.dialogue.continueDelayTime, 0.5);
    assert.equal(f.project.value.graph.nodes[0].position.x, 160); f.close();
  });
  await test('Async graph arrangement becomes one available undo step after editing resumes', async () => {
    const f = fixture();
    f.project.value.graph.nodes.push({ id: 'a', type: 'group', position: { x: 0, y: 0 }, data: { dialogueNodeId: 'a' } });
    f.history.reset(); const initial = encodeDialogueProject(f.project.value);
    f.blocked.value = true;
    f.project.value.graph.nodes[0].position.x = 400; await tick();
    f.project.value.graph.nodes[0].position.y = 200; await tick();
    assert.equal(f.history.canUndo.value, false);
    f.blocked.value = false; await tick(); assert.equal(f.history.entries.value.length, 1);
    await f.history.undo(); assert.equal(encodeDialogueProject(f.project.value), initial);
    await f.history.redo(); assert.deepEqual(f.project.value.graph.nodes[0].position, { x: 400, y: 200 }); f.close();
  });
  await test('Text input groups typing; new editing after undo discards redo without losing Clip drafts', async () => {
    const f = fixture(); f.project.value.dialogue.nodes.a = createDialogueNode('a'); f.history.reset();
    const input = target('textarea'); f.fire('focusin', { target: input });
    for (const text of ['你', '你好', '你好世界']) { f.project.value.dialogue.nodes.a.dialogue.content = text; f.fire('input', { target: input }); await tick(); }
    f.fire('focusout', { target: input }); await tick(); assert.equal(f.history.entries.value.length, 1);
    await f.history.undo(); assert.equal(f.project.value.dialogue.nodes.a.dialogue.content, '新建台词');
    f.project.value.dialogue.nodes.a.lines[0].clips.push(createPerformanceClip('PublicEvent'));
    await tick(); assert.equal(f.history.canRedo.value, false);
    f.project.value.dialogue.nodes.a.lines[0].clips[0].components[0].properties.draft = '-'; await tick();
    await f.history.undo(); await f.history.redo();
    assert.equal(f.project.value.dialogue.nodes.a.lines[0].clips[0].components[0].properties.draft, '-'); f.close();
  });
  await test('Canvas/body shortcuts work; native text undo, unrelated controls and busy documents are respected', async () => {
    const f = fixture(); f.project.value.dialogue.nodes.a = createDialogueNode('a'); f.history.reset();
    f.project.value.dialogue.nodes.a.dialogue.content = 'edited'; await tick();
    assert.equal(f.fire('keydown', { ctrlKey: true, target: target('input') }).defaultPrevented, false);
    assert.equal(f.fire('keydown', { ctrlKey: true, target: target('canvas', false) }).defaultPrevented, false);
    f.blocked.value = true; assert.equal(f.fire('keydown', { ctrlKey: true }).defaultPrevented, false); f.blocked.value = false;
    assert.equal(f.fire('keydown', { ctrlKey: true, key: 'Z', target: document.body }).defaultPrevented, true); await tick();
    assert.equal(f.project.value.dialogue.nodes.a.dialogue.content, '新建台词');
    f.fire('keydown', { metaKey: true, shiftKey: true }); await tick(); assert.equal(f.project.value.dialogue.nodes.a.dialogue.content, 'edited');
    f.fire('keydown', { ctrlKey: true }); await tick(); f.fire('keydown', { ctrlKey: true, key: 'y' }); await tick();
    assert.equal(f.project.value.dialogue.nodes.a.dialogue.content, 'edited');
    f.close(); assert.equal(f.callbacks.size, 0);
  });
  await test('Successful document resets isolate history and invalidate delayed drop completion', async () => {
    const f = fixture(); f.fire('drop');
    f.project.value.dialogue.nodes.a = createDialogueNode('a'); await tick();
    f.blocked.value = true; f.project.value = createEmptyDialogueProject(); f.history.reset(); f.blocked.value = false;
    f.fire('drop'); f.project.value.dialogue.nodes.b = createDialogueNode('b'); await tick();
    f.frames.shift()(); f.frames.shift()(); f.frames.shift()(); await tick();
    assert.equal(f.history.entries.value.length, 0, 'Old-file completion must not end the new drop');
    f.frames.shift()(); await tick(); assert.equal(f.history.entries.value.length, 1);
    await f.history.undo(); assert.equal(f.project.value.dialogue.nodes.b, undefined); assert.equal(f.history.canUndo.value, false);
    f.close();
  });
  await test('Undo replaces pending auto-save snapshots and keeps history available after save failure', async () => {
    const f = fixture(), writes = []; let fail = true;
    const queue = createWorkspaceSaveQueue(async (file, data) => { if (fail) throw Error('offline'); writes.push(data); }, () => {}, 10000);
    const stop = vue.watch(f.project, () => queue.schedule('dialogue.json', encodeDialogueProject(f.project.value)), { deep: true, flush: 'sync' });
    const initial = encodeDialogueProject(f.project.value);
    f.project.value.dialogue.nodes.a = createDialogueNode('a'); await tick();
    await assert.rejects(queue.flush()); await f.history.undo(); fail = false; await queue.flush();
    assert.deepEqual(writes, [initial]); assert.equal(f.history.canRedo.value, true);
    await f.history.redo(); await queue.flush(); assert.ok(JSON.parse(writes.at(-1)).dialogue.nodes.a);
    stop(); f.close();
  });
  console.log(`\n${passed} DSFG history checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  if (originalTs) Module._extensions['.ts'] = originalTs; else delete Module._extensions['.ts'];
});
