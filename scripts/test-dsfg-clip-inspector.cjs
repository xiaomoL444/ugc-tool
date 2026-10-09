/* Run with: node scripts/test-dsfg-clip-inspector.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');
const directory = path.resolve(__dirname, '../src/views/DSFGStudio/components/DialogueEditor');
const filename = path.join(directory, 'GroupTimelineV3.vue');
const descriptor = parse(fs.readFileSync(filename, 'utf8')).descriptor;
const source = ts.createSourceFile(filename + '.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true);
const script = ts.transpileModule(source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;
const timing = {}, dialogues = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(directory, 'utils/dialogueClips.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: dialogues });
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(directory, 'utils/groupTimeline.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: timing, require: name => { assert.equal(name, './dialogueClips'); return dialogues; } });
async function main() {
  const props = vue.reactive({ node: { id: 'group-a', dialogue: { id: 'dialogue-a', content: '原台词', startTime: 0, continueDelayTime: 0.5 },
    lines: [{ id: 'line-a', type: 'PublicEvent', clips: [{ id: 'event-a', type: 'PublicEvent', name: '事件', startTime: 0, duration: 1 }] }], timeline: { duration: 2 } } });
  const events = [], stops = [], callbacks = new Map(), timers = new Map();
  const parentState = { clipInspectorOpen: false, selectedGroupNodeId: 'group-a' };
  const editor = parse(fs.readFileSync(path.join(directory, 'DialogueEditor.vue'), 'utf8')).descriptor;
  const paneHandler = editor.template.content.match(/@pane-click="([^"]+)"/)[1];
  const paneClick = vm.runInNewContext(`(${paneHandler})`, parentState);
  let mount, unmount, timerId = 0;
  function flushTimers() {
    for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
  }
  function fire(type, path = [], extra = {}) {
    for (const { fn } of callbacks.get(type) ?? []) fn({ type, detail: type === 'click' ? 1 : 0, button: 0, composedPath: () => path, ...extra });
  }
  function click(...path) { fire('click', path); }
  const marker = attribute => ({ matches: selector => selector.includes(`[${attribute}]`) });
  const context = vm.createContext({ ...dialogues, ...timing, ref: vue.ref, computed: vue.computed, watch: (...args) => { const stop = vue.watch(...args); stops.push(stop); },
    defineProps: () => props, defineEmits: () => (...args) => { events.push(args); if (args[0] === 'inspectorOpen') parentState.clipInspectorOpen = args[1]; },
    onMounted: fn => { mount = fn; }, onBeforeUnmount: fn => { unmount = fn; },
    usePublicEventPresets: () => ({ availablePresets: vue.ref([]) }), getLineDefinitions: () => [],
    ResizeObserver: class { observe() {} disconnect() {} },
    window: {
      addEventListener(name, fn, capture) {
        if (!callbacks.has(name)) callbacks.set(name, new Set());
        callbacks.get(name).add({ fn, capture });
      },
      removeEventListener(name, fn) {
        const listeners = callbacks.get(name);
        for (const listener of listeners ?? []) if (listener.fn === fn) listeners.delete(listener);
        if (!listeners?.size) callbacks.delete(name);
      },
      setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
    },
  });
  vm.runInContext(`${script}\nglobalThis.api = { openEditor, selectedClip, selectedId, editorOpen, deleteSelectedClip, updateStartTime };`, context);
  const api = context.api;
  mount();
  try {
    assert.deepEqual(events.at(-1), ['inspectorOpen', false]);
    api.openEditor({}, { kind: 'dialogue', clip: props.node.dialogue });
    assert.deepEqual(events.at(-1), ['inspectorOpen', true]);
    assert.equal(api.selectedClip.value.clip, props.node.dialogue);
    api.selectedClip.value.clip.content = '右侧编辑的新台词';
    assert.equal(props.node.dialogue.content, '右侧编辑的新台词');
    console.log('PASS Opening the inspector edits the original Clip object and reports visibility');
    assert.equal([...callbacks.get('click')][0].capture, true, 'Outside clicks are caught even when another control stops bubbling');
    click(marker('data-clip-editor')); flushTimers(); assert.equal(api.editorOpen.value, true);
    props.inspectorTarget = { name: 'dock' };
    click(props.inspectorTarget); flushTimers(); assert.equal(api.editorOpen.value, true);
    click(marker('data-timeline-clip')); flushTimers(); assert.equal(api.editorOpen.value, true);
    console.log('PASS Inspector content, teleported menus, dock borders and Clip triggers stay interactive');
    for (const origin of [marker('data-clip-editor'), props.inspectorTarget, marker('data-timeline-clip')]) {
      fire('pointerdown', [origin]); fire('pointerup', [{}]); click({});
      paneClick(); flushTimers();
      assert.equal(api.editorOpen.value, true, 'A gesture starting inside must not dismiss on an outside release');
      assert.equal(parentState.selectedGroupNodeId, 'group-a');
    }
    fire('pointerdown', [marker('data-clip-editor')]); fire('pointerup', [{}]);
    fire('pointerdown', [{}]); click({}); flushTimers();
    assert.equal(api.editorOpen.value, false, 'A new outside press clears a drag that emitted no click');
    for (const resetEvent of ['pointercancel', 'blur']) {
      api.openEditor({}, { kind: 'dialogue', clip: props.node.dialogue });
      fire('pointerdown', [marker('data-clip-editor')]); fire(resetEvent); click({}); flushTimers();
      assert.equal(api.editorOpen.value, false, `${resetEvent} clears the previous press`);
    }
    api.openEditor({}, { kind: 'dialogue', clip: props.node.dialogue });
    fire('pointerdown', [marker('data-clip-editor')]); fire('click', [{}], { detail: 0 }); flushTimers();
    assert.equal(api.editorOpen.value, false, 'A keyboard click is independent from a previous pointer gesture');
    api.openEditor({}, { kind: 'dialogue', clip: props.node.dialogue });
    console.log('PASS Drag-selection releases keep the inspector open; new presses, cancellation and keyboard clicks reset the gesture');
    click({});
    assert.equal(api.editorOpen.value, true, 'Keep the inspector open through the current click dispatch');
    paneClick(); flushTimers();
    assert.equal(api.editorOpen.value, false);
    assert.equal(parentState.clipInspectorOpen, false);
    assert.equal(parentState.selectedGroupNodeId, 'group-a', 'A graph pane click closes only the inspector');
    assert.equal(api.selectedId.value, 'dialogue-a');
    api.openEditor({}, { kind: 'dialogue', clip: props.node.dialogue });
    click({}); flushTimers(); assert.equal(api.editorOpen.value, false);
    api.openEditor({}, { kind: 'dialogue', clip: props.node.dialogue });
    fire('contextmenu', [marker('data-clip-editor')]);
    flushTimers(); assert.equal(api.editorOpen.value, true);
    fire('pointerdown', [marker('data-clip-editor')]);
    fire('contextmenu', [{}]);
    flushTimers(); assert.equal(api.editorOpen.value, false, 'Right-clicking an outside track closes only the inspector');
    fire('pointercancel');
    api.openEditor({}, { kind: 'dialogue', clip: props.node.dialogue });
    click({});
    api.openEditor({}, { kind: 'dialogue', clip: props.node.dialogue });
    flushTimers(); assert.equal(api.editorOpen.value, true, 'A queued dismissal cannot close a freshly opened inspector');
    console.log('PASS Clicking outside closes the inspector, preserves the Timeline, and cancels stale dismissals');
    const line = props.node.lines[0];
    api.openEditor({}, { kind: 'performance', clip: line.clips[0], line });
    api.updateStartTime(api.selectedClip.value.clip, { target: { value: '2.5' } });
    assert.equal(line.clips[0].startTime, 2.5);
    assert.equal(props.node.dialogue.content, '右侧编辑的新台词');
    api.editorOpen.value = false;
    assert.deepEqual(events.at(-1), ['inspectorOpen', false]);
    api.openEditor({}, { kind: 'performance', clip: line.clips[0], line });
    api.deleteSelectedClip();
    assert.equal(line.clips.length, 0); assert.equal(api.selectedClip.value, undefined);
    assert.deepEqual(events.at(-1), ['inspectorOpen', false]);
    console.log('PASS Switching, closing and deleting Clips preserve neighboring content and close the dock');
    api.openEditor({}, { kind: 'dialogue', clip: props.node.dialogue });
    click({});
    props.node = { id: 'group-b', dialogue: { id: 'dialogue-b', content: '另一个节点', startTime: 0, continueDelayTime: 0.5 }, lines: [], timeline: { duration: 2 } };
    await vue.nextTick();
    assert.equal(api.editorOpen.value, false); assert.equal(api.selectedId.value, 'dialogue-b');
    api.openEditor({}, { kind: 'dialogue', clip: props.node.dialogue });
    flushTimers(); assert.equal(api.editorOpen.value, true);
    click({});
    unmount(); assert.deepEqual(events.at(-1), ['inspectorOpen', false]);
    const eventCount = events.length; flushTimers(); assert.equal(events.length, eventCount);
    assert.equal(callbacks.size, 0);
    console.log('PASS Changing the Timeline node and unmounting clear inspector visibility');
    const markup = descriptor.template.content;
    assert.ok(markup.includes(':to="inspectorTarget || \'body\'"'));
    assert.ok(markup.includes(':key="selectedClip.clip.id"'));
    const icon = parse(fs.readFileSync(path.join(directory, 'components/SelectOptionIcon.vue'), 'utf8')).descriptor;
    assert.ok(icon.template.content.includes('v-if="open" data-clip-editor'));
    assert.ok(editor.template.content.includes(':inspector-target="clipInspectorTarget"'));
    assert.ok(editor.template.content.includes('@inspector-open="clipInspectorOpen = $event"'));
    assert.ok(editor.template.content.includes('if (!clipInspectorOpen)'));
    console.log('PASS Timeline routes to the editor dock and keys Clip forms to prevent stale local state');
  } finally { stops.forEach(stop => stop()); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
