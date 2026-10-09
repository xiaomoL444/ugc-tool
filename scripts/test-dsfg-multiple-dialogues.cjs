/* Run: node scripts/test-dsfg-multiple-dialogues.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');

const root = path.resolve(__dirname, '..');
const editor = path.join(root, 'src/views/DSFGStudio/components/DialogueEditor');
const filename = path.join(editor, 'GroupTimelineV3.vue');
const parsed = parse(fs.readFileSync(filename, 'utf8'), { filename });
assert.deepEqual(parsed.errors, []);
const descriptor = parsed.descriptor;
const plain = value => JSON.parse(JSON.stringify(value));
const transpile = (source, fileName) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, fileName,
}).outputText;
const scriptAst = ts.createSourceFile(filename + '.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true);
const componentScript = transpile(scriptAst.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(scriptAst)).join('\n'), filename + '.ts');
const inspectorFile = path.join(editor, 'components/clip-editors/DialogueClipEditor.vue');
const inspectorDescriptor = parse(fs.readFileSync(inspectorFile, 'utf8'), { filename: inspectorFile }).descriptor;
const inspectorAst = ts.createSourceFile(inspectorFile + '.ts', inspectorDescriptor.scriptSetup.content, ts.ScriptTarget.Latest, true);
const inspectorScript = transpile(inspectorAst.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(inspectorAst)).join('\n'), inspectorFile + '.ts');
const originalLoad = Module._load, originalTs = Module._extensions['.ts'];
let hooks, library, factories, clips, clipboard, timing, codec, exporter, importer, workspace, registry, outlets, useDialogueHistory;
Module._load = function(request, parent, main) {
  if (request === 'vue') return { ...vue, onMounted: fn => hooks.mount.push(fn), onBeforeUnmount: fn => hooks.unmount.push(fn) };
  if (request === 'miliastra-variable') return library;
  return originalLoad.call(this, request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request, parent, main);
};
Module._extensions['.ts'] = (mod, file) => mod._compile(transpile(fs.readFileSync(file, 'utf8'), file), file);
const tick = async () => { await Promise.resolve(); await vue.nextTick(); await Promise.resolve(); };

function connectedProject(node) {
  const project = factories.createEmptyDialogueProject();
  project.dialogue.nodes[node.id] = node;
  project.graph.nodes.push({ id: node.id, type: 'group', position: { x: 320, y: 0 }, data: { dialogueNodeId: node.id } });
  project.graph.edges.push({ id: 'entry-group', source: project.dialogue.entryNodeId, sourceHandle: 'output', target: node.id, targetHandle: 'input' });
  return project;
}

// Run the complete Timeline setup and real document history with real Vue
// reactivity. Only DOM lifecycle/services are supplied by the host fixture.
function fixture(node = factories.createDialogueNode('group')) {
  hooks = { mount: [], unmount: [] };
  const callbacks = new Map(), timers = new Map();
  let timerId = 0;
  const window = global.window = {
    addEventListener(name, fn) { if (!callbacks.has(name)) callbacks.set(name, new Set()); callbacks.get(name).add(fn); },
    removeEventListener(name, fn) { callbacks.get(name)?.delete(fn); },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
  };
  global.document = { body: {}, documentElement: {} };
  const project = vue.ref(connectedProject(node));
  const props = { get node() { return project.value.dialogue.nodes[node.id]; } };
  const scope = vue.effectScope();
  const history = scope.run(() => useDialogueHistory({ project, element: vue.ref({ contains: () => false }),
    blocked: () => false, afterRestore() {}, onError(error) { throw error; } }));
  const context = vm.createContext({ ...vue, ...factories, ...clips, ...clipboard, ...timing, ...registry, ...outlets,
    defineProps: () => props, defineEmits: () => () => {},
    onMounted: fn => hooks.mount.push(fn), onBeforeUnmount: fn => hooks.unmount.push(fn),
    usePublicEventPresets: () => ({ availablePresets: vue.ref([]) }), window,
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  scope.run(() => vm.runInContext(componentScript + `\nglobalThis.api = {
    dialogueClips, canAddDialogueClip, selectedClip, selectedId, timelineDuration, contentDuration,
    pixelsPerSecond, timelineWidth, timelineScrollRef, viewportWidth,
    addDialogueClip, deleteSelectedClip, updateDialogueDuration, updateStartTime,
    startDrag, startResize, openTrackContextMenu, openClipContextMenu, timelineContextAction,
    contextMenuItems, timelineContextMenu, editorOpen,
  };`, context));
  const api = context.api;
  api.timelineScrollRef.value = { scrollLeft: 0, clientWidth: 918 };
  hooks.mount.forEach(fn => fn());
  history.reset();
  const target = { closest: selector => selector.includes('data-clip-editor') ? target : null, matches: () => false };
  function pointer(clientX = 100, pointerId = 1) {
    return { clientX, pointerId, button: 0, target, preventDefault() {}, stopPropagation() {}, composedPath: () => [] };
  }
  function fire(name, event = pointer()) { event.type = name; for (const fn of [...callbacks.get(name) ?? []]) fn(event); }
  return { props, project, history, api, pointer, fire,
    close() { hooks.unmount.forEach(fn => fn()); scope.stop(); clipboard.timelineClipClipboard.value = undefined; } };
}
function trackEvent(api, time) {
  return { clientX: 100 + 118 + time * api.pixelsPerSecond.value, clientY: 200,
    currentTarget: { getBoundingClientRect: () => ({ left: 100 }), isConnected: true, focus() {} },
    target: { closest: () => null } };
}
const clipEvent = { clientX: 320, clientY: 200, currentTarget: { isConnected: true, focus() {} } };
const input = value => ({ target: { value: String(value) } });
function freeClip(startTime, duration, content) {
  return Object.assign(factories.createDialogueClip(), { advanceMode: 'None', startTime, duration, content });
}
function inspector(node, clip) {
  const context = vm.createContext({ computed: vue.computed, inject: (key, fallback) => fallback,
    defineProps: () => ({ clip, get duration() { return timing.getFlowClipDuration(node, clip); } }),
    getDialogueStyles: require(path.join(editor, 'config/dialogueStyleRegistry.ts')).getDialogueStyles,
  });
  vm.runInContext(inspectorScript + '\nglobalThis.mode = advanceMode;', context);
  return context.mode;
}
function runtime(project) {
  const result = exporter.exportQxqyPerformance(project);
  const decoded = workspace.createQxqyStructWorkspace(project.exportSettings.qxqyStructIds).parse(JSON.parse(result.json));
  assert.deepEqual(decoded.issues, []);
  const table = dictionary => dictionary.value.flatMap(bucket => bucket.value.value);
  const group = table(decoded.value.ActionGroup)[0].value;
  return { result, decoded, group, actions: table(group.ActionClip), dialogues: table(decoded.value.DialogueData) };
}
let passed = 0;
async function test(name, check) { await check(); passed++; console.log('PASS ' + name); }

async function main() {
  library = await import('miliastra-variable');
  const load = name => require(path.join(editor, 'utils', name + '.ts'));
  factories = load('dialogueProject'); clips = load('dialogueClips'); clipboard = load('timelineClipClipboard');
  timing = load('groupTimeline'); codec = load('dialogueProjectCodec'); exporter = load('qxqyPerformanceExporter');
  importer = load('qxqyPerformanceImporter'); workspace = load('qxqyStructWorkspace'); outlets = load('groupOutlets');
  registry = require(path.join(editor, 'config/lineRegistry.ts'));
  ({ useDialogueHistory } = require(path.join(editor, 'useDialogueHistory.ts')));
  await test('The real multi-Dialogue Timeline script and template compile', () => {
    const script = compileScript(descriptor, { id: 'multiple-dialogues-test' });
    assert.deepEqual(compileTemplate({ filename, id: 'multiple-dialogues-test', source: descriptor.template.content,
      compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
  });

  await test('Dialogue helpers preserve object identity and stable chronological order through removal', () => {
    const node = factories.createDialogueNode('helpers');
    const primary = node.dialogue; primary.startTime = 4;
    const first = freeClip(1, 1, '最早'), tied = freeClip(4, 1, '同一时刻'), last = freeClip(8, 1, '最后');
    clips.appendDialogueClip(node, last); clips.appendDialogueClip(node, first); clips.appendDialogueClip(node, tied);
    const ordered = clips.getDialogueClips(node);
    assert.deepEqual(ordered.map(clip => clip.id), [first.id, primary.id, tied.id, last.id]);
    assert.equal(ordered[0], first); assert.equal(ordered[1], primary);
    clips.removeDialogueClip(node, primary.id);
    assert.deepEqual(clips.getDialogueClips(node).map(clip => clip.id), [first.id, tied.id, last.id]);
    assert.equal(clips.getDialogueClips(node)[0], first);
    clips.removeDialogueClip(node, 'missing');
    assert.equal(clips.getDialogueClips(node).length, 3);
  });

  await test('Switching to None frees duration; PlayerInput disables end resizing and appending', async () => {
    const node = factories.createDialogueNode('modes'); node.timeline.duration = 12;
    const f = fixture(node);
    try {
      const clip = f.props.node.dialogue;
      const mode = inspector(f.props.node, clip);
      assert.equal(f.api.canAddDialogueClip.value, false);
      assert.equal(timing.getFlowClipDuration(f.props.node, clip), 12);
      mode.value = 'None'; await tick();
      assert.equal(clip.duration, 12, 'The real mode selector preserves the existing business boundary on the first switch');
      f.api.updateDialogueDuration(clip, input(3.5));
      assert.equal(clip.duration, 3.5); assert.equal(timing.getFlowClipDuration(f.props.node, clip), 3.5);
      assert.equal(f.api.canAddDialogueClip.value, true);
      mode.value = 'PlayerInput'; await tick();
      const start = clip.startTime, duration = clip.duration;
      f.api.startResize(f.pointer(), clip, 'end'); f.fire('pointermove', f.pointer(500)); f.fire('pointerup');
      assert.equal(clip.startTime, start); assert.equal(clip.duration, duration);
      assert.equal(f.api.canAddDialogueClip.value, false);
      f.api.addDialogueClip(); assert.equal(f.api.dialogueClips.value.length, 1);
      mode.value = 'None'; await tick();
      assert.equal(timing.getFlowClipDuration(f.props.node, clip), 3.5, 'Changing modes retains the independently edited duration');
    } finally { f.close(); }
  });

  await test('Free duration editing accepts finite seconds and leaves PlayerInput timing derived', async () => {
    const node = factories.createDialogueNode('duration'); Object.assign(node.dialogue, { advanceMode: 'None', duration: 2 });
    const f = fixture(node);
    try {
      const clip = f.props.node.dialogue;
      f.api.updateDialogueDuration(clip, input(5.25)); assert.equal(clip.duration, 5.25);
      for (const value of ['Infinity', 'NaN', 'wrong']) { f.api.updateDialogueDuration(clip, input(value)); assert.equal(clip.duration, 5.25); }
      f.api.updateDialogueDuration(clip, input(-2)); assert.equal(clip.duration, timing.MIN_CLIP_DURATION);
      f.api.updateDialogueDuration(clip, input(2.5));
      f.api.updateStartTime(clip, input(4)); assert.equal(clip.startTime, 4); assert.equal(clip.duration, 2.5);
      const end = timing.getGroupTimelineEnd(f.props.node);
      clip.advanceMode = 'PlayerInput'; await tick();
      f.api.updateDialogueDuration(clip, input(50)); assert.equal(clip.duration, 2.5);
      assert.equal(timing.getFlowClipDuration(f.props.node, clip), Math.max(0.1, timing.getGroupTimelineEnd(f.props.node) - 4));
      assert.ok(end >= 6.5);
    } finally { f.close(); }
  });

  await test('None continue-delay drafts cannot extend its independent business boundary', () => {
    const node = factories.createDialogueNode('none-delay');
    Object.assign(node.dialogue, { advanceMode: 'None', duration: 1.25, continueDelayTime: 50 });
    node.timeline.duration = 2;
    assert.equal(timing.getFlowClipDuration(node, node.dialogue), 1.25);
    assert.equal(timing.getGroupTimelineEnd(node), 2);
    node.dialogue.advanceMode = 'PlayerInput';
    assert.equal(timing.getGroupTimelineEnd(node), 50);
    assert.equal(timing.getFlowClipDuration(node, node.dialogue), 50);
  });

  for (const boundary of ['start', 'end']) {
    await test(`None ${boundary} resize stays stable, accounts for scroll and preserves the opposite boundary`, () => {
      const node = factories.createDialogueNode('resize-' + boundary); Object.assign(node.dialogue, { advanceMode: 'None', startTime: 7, duration: 3 });
      const f = fixture(node);
      try {
        const clip = f.props.node.dialogue, scale = f.api.pixelsPerSecond.value, display = f.api.timelineDuration.value;
        f.api.timelineScrollRef.value.scrollLeft = 40;
        f.api.startResize(f.pointer(), clip, boundary);
        f.api.viewportWidth.value = 1200;
        f.api.timelineScrollRef.value.scrollLeft = 40 + scale;
        f.fire('pointermove', f.pointer());
        assert.equal(clip.startTime, boundary === 'start' ? 8 : 7);
        assert.equal(clip.duration, boundary === 'start' ? 2 : 4);
        for (let repeat = 0; repeat < 5; repeat++) f.fire('pointermove', f.pointer());
        assert.equal(clip.duration, boundary === 'start' ? 2 : 4);
        assert.equal(f.api.pixelsPerSecond.value, scale); assert.equal(f.api.timelineDuration.value, display);
        if (boundary === 'start') assert.equal(clip.startTime + clip.duration, 10);
        f.fire('pointerup');
        assert.equal(f.api.pixelsPerSecond.value, (1200 - 118 - 24) / f.api.timelineDuration.value);
      } finally { f.close(); }
    });
  }

  await test('Additional None Clips drag independently through automatic duration thresholds', () => {
    const node = factories.createDialogueNode('additional-drag'); Object.assign(node.dialogue, { advanceMode: 'None', duration: 1 });
    const added = freeClip(7, 3, '附加'); clips.appendDialogueClip(node, added);
    const f = fixture(node);
    try {
      const clip = f.api.dialogueClips.value.find(clip => clip.id === added.id), scale = f.api.pixelsPerSecond.value;
      f.api.startDrag(f.pointer(), clip);
      for (const delta of [3, 4, 1, 4]) {
        f.fire('pointermove', f.pointer(100 + delta * scale));
        assert.equal(clip.startTime, 7 + delta); assert.equal(clip.duration, 3); assert.equal(f.props.node.dialogue.startTime, 0);
        f.fire('pointermove', f.pointer(100 + delta * scale)); assert.equal(clip.startTime, 7 + delta);
      }
      f.fire('pointerup');
    } finally { f.close(); }
  });

  await test('Appending on the same Dialogue track starts after the last None boundary and supports clicked times', () => {
    const node = factories.createDialogueNode('append'); Object.assign(node.dialogue, { advanceMode: 'None', startTime: 1, duration: 2.5 });
    const f = fixture(node);
    try {
      f.api.addDialogueClip();
      assert.equal(f.api.dialogueClips.value.length, 2);
      const next = f.api.selectedClip.value.clip;
      assert.equal(next.startTime, 3.5); assert.notEqual(next.id, f.props.node.dialogue.id);
      next.advanceMode = 'None'; next.duration = 1.25;
      f.api.addDialogueClip(); assert.equal(f.api.selectedClip.value.clip.startTime, 4.75);
      f.api.selectedClip.value.clip.advanceMode = 'None';
      f.api.openTrackContextMenu(trackEvent(f.api, 8.2), { kind: 'dialogue' });
      assert.equal(f.api.contextMenuItems.value[0].disabled, false);
      f.api.timelineContextAction('add');
      assert.equal(f.api.selectedClip.value.clip.startTime, 8.2);
      assert.equal(f.api.dialogueClips.value.length, 4);
      f.api.openTrackContextMenu(trackEvent(f.api, 20), { kind: 'dialogue' });
      assert.equal(f.api.contextMenuItems.value[0].disabled, true);
      f.api.timelineContextAction('add'); assert.equal(f.api.dialogueClips.value.length, 4);
    } finally { f.close(); }
  });

  await test('Same-track paste respects the waiting boundary and rejects a second PlayerInput Clip', () => {
    const node = factories.createDialogueNode('waiting-paste'); node.dialogue.startTime = 5;
    const f = fixture(node);
    try {
      const source = freeClip(0, 1.25, '自由台词');
      clipboard.timelineClipClipboard.value = clipboard.captureTimelineClip({ kind: 'dialogue', clip: source });
      for (const time of [5, 7]) {
        f.api.openTrackContextMenu(trackEvent(f.api, time), { kind: 'dialogue' });
        const paste = f.api.contextMenuItems.value.find(item => item.id === 'paste');
        assert.equal(paste.disabled, true); assert.match(paste.hint, /玩家按下/);
        f.api.timelineContextAction('paste'); assert.equal(f.api.dialogueClips.value.length, 1);
      }
      f.api.openTrackContextMenu(trackEvent(f.api, 2), { kind: 'dialogue' });
      assert.equal(f.api.contextMenuItems.value.find(item => item.id === 'paste').disabled, false);
      f.api.timelineContextAction('paste');
      assert.equal(f.api.dialogueClips.value.length, 2);
      assert.equal(f.api.dialogueClips.value[0].duration, 1.25);
      assert.equal(f.api.dialogueClips.value[0].startTime, 2);
      clipboard.timelineClipClipboard.value = clipboard.captureTimelineClip({ kind: 'dialogue', clip: f.props.node.dialogue });
      f.api.openTrackContextMenu(trackEvent(f.api, 0), { kind: 'dialogue' });
      assert.equal(f.api.contextMenuItems.value.find(item => item.id === 'paste').disabled, true);
      f.api.timelineContextAction('paste'); assert.equal(f.api.dialogueClips.value.length, 2);
    } finally { f.close(); }
  });

  await test('Copy, paste and deleting the primary or additional Dialogue replay as complete history operations', async () => {
    const node = factories.createDialogueNode('history'); Object.assign(node.dialogue, { advanceMode: 'None', duration: 2, content: '原台词', nodeGraphEvent: ['-1', '7'] });
    const f = fixture(node);
    try {
      const source = f.props.node.dialogue;
      f.api.openClipContextMenu(clipEvent, { kind: 'dialogue', clip: source });
      f.fire('pointerdown'); f.api.timelineContextAction('copy'); f.fire('pointerup'); await tick();
      assert.equal(f.history.canUndo.value, false);
      const before = codec.encodeDialogueProject(f.project.value);
      f.api.openTrackContextMenu(trackEvent(f.api, 2.8), { kind: 'dialogue' });
      f.fire('pointerdown'); f.api.timelineContextAction('paste'); f.fire('pointerup'); await tick();
      assert.equal(f.api.dialogueClips.value.length, 2);
      const pasted = f.api.selectedClip.value.clip, pastedId = pasted.id;
      assert.notEqual(pastedId, source.id); assert.equal(pasted.duration, 2); assert.equal(pasted.startTime, 2.8);
      assert.deepEqual(plain(pasted.nodeGraphEvent), ['-1', '7']);
      const afterPaste = codec.encodeDialogueProject(f.project.value);
      assert.equal(f.history.entries.value.length, 1);
      await f.history.undo(); assert.equal(codec.encodeDialogueProject(f.project.value), before);
      await f.history.redo(); assert.equal(codec.encodeDialogueProject(f.project.value), afterPaste);
      for (const clipId of [pastedId, source.id]) {
        const selected = clipboard.findTimelineClip(f.props.node, clipId);
        assert.ok(selected); const saved = codec.encodeDialogueProject(f.project.value);
        f.api.openClipContextMenu(clipEvent, selected);
        f.fire('pointerdown'); f.api.timelineContextAction('delete'); f.fire('pointerup'); await tick();
        assert.equal(clipboard.findTimelineClip(f.props.node, clipId), undefined);
        const deleted = codec.encodeDialogueProject(f.project.value);
        await f.history.undo(); assert.equal(codec.encodeDialogueProject(f.project.value), saved);
        await f.history.redo(); assert.equal(codec.encodeDialogueProject(f.project.value), deleted);
        await f.history.undo();
      }
      assert.equal(f.api.dialogueClips.value.length, 2);
    } finally { f.close(); }
  });

  await test('Legacy None without duration migrates its old actual boundary and preserves explicit duration on reopening', () => {
    const node = factories.createDialogueNode('legacy'); node.dialogue.advanceMode = 'None'; node.dialogue.startTime = 1;
    delete node.dialogue.duration; node.timeline.duration = 2;
    const camera = factories.createPerformanceClip('Camera', 5); camera.duration = 3; node.lines[0].clips.push(camera);
    const project = connectedProject(node); project.schemaVersion = 12;
    const restored = codec.decodeDialogueProject(plain(project)), clip = restored.dialogue.nodes[node.id].dialogue;
    assert.equal(clip.duration, 7);
    assert.equal(timing.getFlowClipDuration(restored.dialogue.nodes[node.id], clip), 7);
    clip.duration = 1.25;
    const reopened = codec.decodeDialogueProject(codec.encodeDialogueProject(restored));
    assert.equal(reopened.dialogue.nodes[node.id].dialogue.duration, 1.25);
    const next = freeClip(3.5, 2.25, '附加台词'); clips.appendDialogueClip(reopened.dialogue.nodes[node.id], next);
    const again = codec.decodeDialogueProject(codec.encodeDialogueProject(reopened));
    assert.deepEqual(clips.getDialogueClips(again.dialogue.nodes[node.id]).map(c => [c.id, c.startTime, c.duration]), [[clip.id, 1, 1.25], [next.id, 3.5, 2.25]]);
  });

  await test('Runtime export and import preserve multiple None durations and the trailing PlayerInput action', () => {
    const node = factories.createDialogueNode('runtime');
    Object.assign(node.dialogue, { advanceMode: 'None', startTime: 0, duration: 1.25, content: '第一句', nodeGraphEvent: ['3'] });
    clips.appendDialogueClip(node, freeClip(1.5, 2.25, '第二句'));
    const final = Object.assign(factories.createDialogueClip(), { startTime: 4, content: '最后一句', continueDelayTime: 0.5 });
    clips.appendDialogueClip(node, final); node.timeline.duration = 8;
    const project = connectedProject(node), before = codec.encodeDialogueProject(project), output = runtime(project);
    const actions = output.actions.filter(action => action.value.actionType.value === 'NOLOC_DIALOG');
    assert.equal(actions.length, 3);
    assert.deepEqual(actions.map(action => action.value.duration.value), ['1.25', '2.25', '4.00']);
    assert.deepEqual(output.dialogues.map(row => row.value.content.value), ['第一句', '第二句', '最后一句']);
    assert.deepEqual(output.dialogues.map(row => row.value.continueDelay.value), ['-1.00', '-1.00', '0.50']);
    assert.equal(codec.encodeDialogueProject(project), before, 'Export must not mutate edited data');
    const imported = importer.importQxqyPerformance(output.result.json).project;
    const restored = Object.values(imported.dialogue.nodes)[0], importedClips = clips.getDialogueClips(restored);
    assert.deepEqual(importedClips.map(c => [c.content, c.startTime, c.advanceMode, timing.getFlowClipDuration(restored, c)]), [
      ['第一句', 0, 'None', 1.25], ['第二句', 1.5, 'None', 2.25], ['最后一句', 4, 'PlayerInput', 4],
    ]);
    assert.equal(exporter.exportQxqyPerformance(imported).json, output.result.json);
  });
  console.log(`\n${passed} Multiple Dialogue Clip regression checks passed.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  if (originalTs) Module._extensions['.ts'] = originalTs; else delete Module._extensions['.ts'];
});
