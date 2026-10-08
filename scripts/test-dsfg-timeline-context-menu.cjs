/* Run: node scripts/test-dsfg-timeline-context-menu.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '..');
const editor = path.join(root, 'src/views/DSFGStudio/components/DialogueEditor');
const readSfc = file => parse(fs.readFileSync(path.join(editor, file), 'utf8'), { filename: file }).descriptor;
const timeline = readSfc('GroupTimelineV3.vue');
const menu = readSfc('components/TimelineContextMenu.vue');
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function transpile(source) {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
}
function setupSource(descriptor) {
  const source = ts.createSourceFile('setup.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true);
  return transpile(source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source)).join('\n'));
}
const originalLoad = Module._load, originalTs = Module._extensions['.ts'];
let hooks, variableLibrary;
Module._load = function(request, parent, main) {
  if (request === 'vue') return { ...vue, onMounted: fn => hooks.mount.push(fn), onBeforeUnmount: fn => hooks.unmount.push(fn) };
  if (request === 'miliastra-variable') return variableLibrary;
  return originalLoad.call(this, request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request, parent, main);
};
Module._extensions['.ts'] = (mod, file) => mod._compile(transpile(fs.readFileSync(file, 'utf8')), file);
const tick = async () => { await Promise.resolve(); await vue.nextTick(); await Promise.resolve(); };
let factories, clipboard, timing, registry, useDialogueHistory, codec, outlets;
function fixture() {
  hooks = { mount: [], unmount: [] };
  const callbacks = new Map();
  const window = global.window = {
    addEventListener(name, fn) { if (!callbacks.has(name)) callbacks.set(name, new Set()); callbacks.get(name).add(fn); },
    removeEventListener(name, fn) { callbacks.get(name)?.delete(fn); }, setTimeout: fn => fn(),
  };
  const body = {}; global.document = { body, documentElement: {} };
  const project = vue.ref(factories.createEmptyDialogueProject());
  project.value.dialogue.nodes.a = factories.createDialogueNode('a');
  project.value.dialogue.nodes.b = factories.createDialogueNode('b');
  const active = vue.ref('a');
  const scope = vue.effectScope();
  const history = scope.run(() => useDialogueHistory({ project, element: vue.ref({ contains: () => false }),
    blocked: () => false, afterRestore() {}, onError(error) { throw error; } }));
  const props = { get node() { return project.value.dialogue.nodes[active.value]; } };
  const context = vm.createContext({ ...vue, ...factories, ...clipboard, ...timing, ...registry,
    defineProps: () => props, defineEmits: () => () => {}, onMounted() {}, onBeforeUnmount() {},
    usePublicEventPresets: () => ({ availablePresets: vue.ref([]) }), window,
  });
  scope.run(() => vm.runInContext(setupSource(timeline) + '\nglobalThis.api = { openTrackContextMenu, openClipContextMenu, timelineContextAction, closeTimelineContextMenu, timelineContextMenu, contextMenuItems, selectedId, pixelsPerSecond, addFocusPushClip };', context));
  history.reset(); hooks.mount.forEach(fn => fn());
  const cleanup = hooks.unmount;
  const target = { closest: selector => selector === '[data-clip-editor]' ? target : null };
  function fire(name) { for (const fn of callbacks.get(name) ?? []) fn({ target, button: 0, pointerId: 1 }); }
  return { project, props, active, api: context.api, history, fire,
    close() { cleanup.forEach(fn => fn()); scope.stop(); clipboard.timelineClipClipboard.value = undefined; } };
}
function trackEvent(api, time, label = false, left = 100) {
  return { clientX: left + 118 + time * api.pixelsPerSecond.value, clientY: 200,
    currentTarget: { getBoundingClientRect: () => ({ left }), isConnected: true, focus() {} },
    target: { closest: () => label ? {} : null } };
}
const clipEvent = { clientX: 320, clientY: 200, currentTarget: { isConnected: true, focus() {} } };
let passed = 0;
async function test(name, check) { await check(); passed++; console.log('PASS ' + name); }
async function main() {
  variableLibrary = await import('miliastra-variable');
  factories = require(path.join(editor, 'utils/dialogueProject.ts'));
  clipboard = require(path.join(editor, 'utils/timelineClipClipboard.ts'));
  timing = require(path.join(editor, 'utils/groupTimeline.ts'));
  registry = require(path.join(editor, 'config/lineRegistry.ts'));
  codec = require(path.join(editor, 'utils/dialogueProjectCodec.ts'));
  outlets = require(path.join(editor, 'utils/groupOutlets.ts'));
  ({ useDialogueHistory } = require(path.join(editor, 'useDialogueHistory.ts')));
  await test('Timeline and teleported context menu compile with isolated track and Clip handlers', () => {
    for (const descriptor of [timeline, menu]) {
      const script = compileScript(descriptor, { id: 'context-menu-test' });
      assert.deepEqual(compileTemplate({ id: 'context-menu-test', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
      for (const style of descriptor.styles) assert.deepEqual(compileStyle({ id: 'context-menu-test', source: style.content, scoped: style.scoped }).errors, []);
    }
    const handlers = timeline.template.content.match(/@contextmenu\.prevent\.stop="open(?:Track|Clip)ContextMenu/g);
    assert.equal(handlers.length, 8);
    assert.ok(menu.template.content.includes('data-clip-editor'));
  });
  await test('Copy captures independent values; cross-Group paste uses clicked time and fresh component IDs', async () => {
    const f = fixture();
    try {
      const line = f.props.node.lines[0], clip = factories.createPerformanceClip('Camera', 1.2);
      clip.components[0].properties.reference = { guid: '1086324738', query: 'actor', presetId: 'entity-a', vector: { x: '-', y: '-1.5', z: '0.' } };
      line.clips.push(clip);
      f.api.openClipContextMenu(clipEvent, { kind: 'performance', line, clip }); f.api.timelineContextAction('copy');
      const snapshot = plain(clipboard.timelineClipClipboard.value);
      clip.components[0].properties.reference.query = 'changed';
      f.active.value = 'b'; await tick();
      const targetLine = f.props.node.lines[0], lane = { kind: 'performance', lineId: targetLine.id };
      f.api.openTrackContextMenu(trackEvent(f.api, 3.2, false, -190), lane); f.api.timelineContextAction('paste');
      const pasted = targetLine.clips[0];
      assert.equal(pasted.startTime, 3.2); assert.notEqual(pasted.id, clip.id);
      assert.notEqual(pasted.components[0].id, clip.components[0].id);
      assert.deepEqual(plain(pasted.components[0].properties), snapshot.clip.components[0].properties);
      f.api.openTrackContextMenu(trackEvent(f.api, 4.7), lane); f.api.timelineContextAction('paste');
      assert.notEqual(targetLine.clips[1].id, pasted.id);
      targetLine.clips[1].components[0].properties.reference.query = 'another';
      assert.equal(pasted.components[0].properties.reference.query, 'actor');
      assert.deepEqual(plain(clipboard.timelineClipClipboard.value), snapshot);
    } finally { f.close(); }
  });
  await test('Fixed track paste regenerates option IDs and rejects occupied, incompatible or missing tracks', () => {
    const node = factories.createDialogueNode('target'), source = factories.createSelectClip();
    source.options.push(factories.createSelectOption()); source.params = ['-1', '42', '-'];
    const snapshot = clipboard.captureTimelineClip({ kind: 'select', clip: source });
    const pasted = clipboard.pasteTimelineClip(node, { kind: 'select' }, snapshot, 2.5);
    assert.equal(pasted.clip.startTime, 2.5); assert.deepEqual(pasted.clip.params, source.params);
    for (let i = 0; i < source.options.length; i++) {
      assert.notEqual(pasted.clip.options[i].id, source.options[i].id);
      assert.equal(pasted.clip.options[i].content, source.options[i].content);
      assert.equal(pasted.clip.options[i].icon, source.options[i].icon);
    }
    assert.equal(clipboard.pasteTimelineClip(node, { kind: 'select' }, snapshot, 0), undefined);
    assert.equal(clipboard.pasteTimelineClip(node, { kind: 'dialogue' }, snapshot, 0), undefined);
    assert.equal(clipboard.pasteTimelineClip(node, { kind: 'performance', lineId: 'missing' }, snapshot, 0), undefined);
    const eventLine = factories.createPerformanceLine('PublicEvent'); node.lines.push(eventLine);
    const camera = clipboard.captureTimelineClip({ kind: 'performance', line: node.lines[0], clip: factories.createPerformanceClip('Camera') });
    assert.equal(clipboard.pasteTimelineClip(node, { kind: 'performance', lineId: eventLine.id }, camera, 0), undefined);
    assert.equal(eventLine.clips.length, 0);
    const focus = factories.createFocusPushClip(); focus.outputMode = 'Shared'; focus.sharedOutletIndex = 2;
    clipboard.pasteTimelineClip(node, { kind: 'focusPush' }, clipboard.captureTimelineClip({ kind: 'focusPush', clip: focus }), 5);
    assert.equal(node.focusPush.outputMode, 'Shared'); assert.equal(node.focusPush.sharedOutletIndex, 2);
  });
  await test('Track creation honors the cursor, clamps before zero, and keeps the 1s Focus Push label default', () => {
    const f = fixture();
    try {
      f.props.node.dialogue = undefined;
      for (const kind of ['dialogue', 'select', 'focusPush']) {
        f.api.openTrackContextMenu(trackEvent(f.api, 2.6), { kind }); f.api.timelineContextAction('add');
        assert.equal(f.props.node[kind].startTime, 2.6);
        f.api.openTrackContextMenu(trackEvent(f.api, 4), { kind });
        assert.equal(f.api.contextMenuItems.value[0].disabled, true); f.api.timelineContextAction('add');
        assert.equal(f.props.node[kind].startTime, 2.6);
      }
      f.props.node.focusPush = undefined;
      f.api.openTrackContextMenu(trackEvent(f.api, 0, true), { kind: 'focusPush' }); f.api.timelineContextAction('add');
      assert.equal(f.props.node.focusPush.startTime, 1);
      const line = f.props.node.lines[0];
      f.api.openTrackContextMenu(trackEvent(f.api, -5), { kind: 'performance', lineId: line.id }); f.api.timelineContextAction('add');
      assert.equal(line.clips[0].startTime, 0);
      f.api.openTrackContextMenu(trackEvent(f.api, 4.4), { kind: 'performance', lineId: line.id }); f.api.timelineContextAction('add');
      assert.equal(line.clips[1].startTime, 4.4);
    } finally { f.close(); }
  });
  await test('Delete targets the right-clicked Clip; stale menus cannot mutate another node or deleted track', async () => {
    const f = fixture();
    try {
      const line = f.props.node.lines[0]; line.clips.push(factories.createPerformanceClip('Camera'), factories.createPerformanceClip('Camera'));
      const keepId = line.clips[1].id;
      f.api.openClipContextMenu(clipEvent, { kind: 'performance', line, clip: line.clips[0] });
      f.api.selectedId.value = keepId; f.api.timelineContextAction('delete');
      assert.equal(line.clips.length, 1); assert.equal(line.clips[0].id, keepId);
      f.api.openClipContextMenu(clipEvent, { kind: 'performance', line, clip: line.clips[0] });
      f.active.value = 'b'; f.api.timelineContextAction('delete');
      assert.ok(f.props.node.dialogue); assert.equal(line.clips.length, 1);
      f.api.openTrackContextMenu(trackEvent(f.api, 3), { kind: 'performance', lineId: f.props.node.lines[0].id });
      f.props.node.lines = []; f.api.timelineContextAction('add'); assert.equal(f.props.node.lines.length, 0);
      await tick(); assert.equal(f.api.timelineContextMenu.value, undefined);
    } finally { f.close(); }
  });
  await test('Teleported menu gestures give one undo step; Select deletion restores Clip IDs and outlet links', async () => {
    const f = fixture();
    try {
      const line = f.props.node.lines[0]; line.clips.push(factories.createPerformanceClip('Camera'));
      f.history.reset();
      f.api.openClipContextMenu(clipEvent, { kind: 'performance', line, clip: line.clips[0] });
      f.fire('pointerdown'); f.api.timelineContextAction('copy'); f.fire('pointerup'); await tick();
      assert.equal(f.history.canUndo.value, false);
      const before = codec.encodeDialogueProject(f.project.value);
      f.api.openTrackContextMenu(trackEvent(f.api, 2.8), { kind: 'performance', lineId: line.id });
      f.fire('pointerdown'); f.api.timelineContextAction('paste'); f.fire('pointerup'); await tick();
      const pasted = codec.encodeDialogueProject(f.project.value);
      assert.equal(f.history.entries.value.length, 1);
      await f.history.undo(); assert.equal(codec.encodeDialogueProject(f.project.value), before);
      await f.history.redo(); assert.equal(codec.encodeDialogueProject(f.project.value), pasted);
      f.props.node.select = factories.createSelectClip();
      const optionId = f.props.node.select.options[0].id;
      f.project.value.graph.edges.push({ id: 'select-link', source: 'a', target: 'b', sourceHandle: outlets.selectOutletId(optionId) });
      const parent = readSfc('DialogueEditor.vue');
      const ast = ts.createSourceFile('parent.ts', parent.scriptSetup.content, ts.ScriptTarget.Latest, true);
      const sync = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'SynchronizeGraphEdges');
      const syncContext = vm.createContext({ dialogueProject: f.project, ...outlets });
      vm.runInContext(transpile(sync.getText(ast)), syncContext);
      f.project.value.dialogue.nodes.a.dialogue = undefined;
      f.history.reset();
      f.project.value.graph.edges.push({ id: 'other-link', source: 'b', target: 'a', sourceHandle: 'next' });
      const stop = vue.watch(f.project, syncContext.SynchronizeGraphEdges, { deep: true, flush: 'sync' });
      try {
        f.history.reset(); const initial = codec.encodeDialogueProject(f.project.value);
        f.api.openClipContextMenu(clipEvent, { kind: 'select', clip: f.props.node.select });
        f.fire('pointerdown'); f.api.timelineContextAction('delete'); f.fire('pointerup'); await tick();
        assert.equal(f.props.node.select, undefined);
        assert.deepEqual(f.project.value.graph.edges.map(edge => edge.id), ['other-link']);
        assert.equal(f.history.entries.value.length, 1);
        await f.history.undo(); assert.equal(codec.encodeDialogueProject(f.project.value), initial);
        assert.equal(f.props.node.select.options[0].id, optionId);
        await f.history.redo(); assert.equal(f.props.node.select, undefined);
        assert.deepEqual(f.project.value.graph.edges.map(edge => edge.id), ['other-link']);
      } finally { stop(); }
    } finally { f.close(); }
  });
  await test('Menu stays inside the viewport, supports keyboard navigation, dismisses outside and cleans up listeners', async () => {
    const scope = vue.effectScope(), mount = [], unmount = [], events = [], listeners = new Map();
    const document = { activeElement: undefined };
    const buttons = [0, 1].map(index => ({ index, focus() { document.activeElement = this; } }));
    let enabledButtons = buttons;
    const element = vue.markRaw({ offsetWidth: 212, offsetHeight: 150,
      querySelector: () => enabledButtons[0], querySelectorAll: () => enabledButtons,
      contains: target => target === element, focus() { document.activeElement = element; } });
    const props = vue.reactive({ position: { x: 995, y: 795 }, title: 'Clip 操作', items: [] });
    const window = { innerWidth: 1000, innerHeight: 800,
      addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } };
    const context = vm.createContext({ ...vue, defineProps: () => props, defineEmits: () => (...args) => events.push(args),
      onMounted: fn => mount.push(fn), onBeforeUnmount: fn => unmount.push(fn), window, document });
    scope.run(() => vm.runInContext(setupSource(menu) + '\nglobalThis.api = { menu, position, keydown };', context));
    const api = context.api; api.menu.value = element;
    try {
      mount.forEach(fn => fn()); await tick();
      assert.deepEqual(plain(api.position.value), { left: '780px', top: '642px' });
      assert.equal(document.activeElement, buttons[0]);
      const key = key => api.keydown({ key, preventDefault() {}, stopPropagation() {} });
      key('ArrowDown'); assert.equal(document.activeElement, buttons[1]);
      key('ArrowDown'); assert.equal(document.activeElement, buttons[0]);
      key('End'); assert.equal(document.activeElement, buttons[1]);
      key('Home'); assert.equal(document.activeElement, buttons[0]);
      listeners.get('pointerdown')({ composedPath: () => [element] }); assert.equal(events.length, 0);
      listeners.get('scroll')({ target: element }); assert.equal(events.length, 0);
      listeners.get('pointerdown')({ composedPath: () => [] }); assert.deepEqual(events.pop(), ['close']);
      listeners.get('scroll')({ target: {} }); assert.deepEqual(events.pop(), ['close']);
      key('Escape'); assert.deepEqual(events.pop(), ['close', true]);
      key('Tab'); assert.deepEqual(events.pop(), ['close']);
      enabledButtons = []; props.position = { x: 0, y: 0 }; await tick();
      assert.equal(document.activeElement, element, 'Fully disabled menus still accept Escape');
      assert.deepEqual(plain(api.position.value), { left: '8px', top: '8px' });
      unmount.forEach(fn => fn()); assert.equal(listeners.size, 0);
    } finally { scope.stop(); }
  });
  console.log(`\n${passed} DSFG Timeline context menu checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  if (originalTs) Module._extensions['.ts'] = originalTs; else delete Module._extensions['.ts'];
});
