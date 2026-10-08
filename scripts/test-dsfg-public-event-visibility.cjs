/* Run with: node scripts/test-dsfg-public-event-visibility.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');

const base = path.resolve(__dirname, '../src/views/DSFGStudio/components');
const originalLoad = Module._load;
let variableLibrary;
const originalExtensions = Object.fromEntries(['.ts', '.vue', '.css'].map(extension => [extension, Module._extensions[extension]]));
const compile = (source, filename) => ts.transpileModule(source, {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
Module._load = function(request, parent, isMain) {
  if (request === 'miliastra-variable') return variableLibrary;
  if (request === 'naive-ui') return { NSelect: vue.defineComponent({
    props: ['value', 'options', 'disabled', 'themeOverrides', 'menuProps'],
    setup(props, { attrs }) {
      return () => vue.h('select-stub', {
        label: attrs['aria-label'], value: props.value, options: props.options, disabled: props.disabled,
        choose: value => attrs['onUpdate:value'](value),
      });
    },
  }) };
  return originalLoad.call(this, request.startsWith('@/') ? path.resolve(__dirname, '../src', request.slice(2)) : request, parent, isMain);
};
Module._extensions['.ts'] = (mod, filename) => mod._compile(compile(fs.readFileSync(filename, 'utf8'), filename), filename);
Module._extensions['.css'] = () => {};
Module._extensions['.vue'] = (mod, filename) => {
  let source = fs.readFileSync(filename, 'utf8');
  // An optional mutation check proves the user-visible regression fails without the new synchronization effect.
  if (process.argv.includes('--simulate-previous-editor') && path.basename(filename) === 'PublicEventClipEditor.vue') {
    const previous = source;
    source = source.replace(/watchEffect\(\(\) => \{\s*if \(ready.value\) syncPublicEventVisibility\(props.clip, presets.value\);\s*\}, \{ flush: "sync" \}\);/, '');
    assert.notEqual(source, previous, 'The mutation check must remove the editor synchronization effect');
  }
  const { descriptor } = parse(source, { filename });
  mod._compile(compile(compileScript(descriptor, { id: 'public-event-visibility', inlineTemplate: true }).content, filename), filename);
};

function element(tag) {
  return { tag, children: [], parent: null, events: new Map(),
    addEventListener(name, callback) { this.events.set(name, callback); },
    removeEventListener(name) { this.events.delete(name); },
  };
}
const renderer = vue.createRenderer({
  createElement: element, createText: text => ({ text, parent: null }), createComment: text => ({ text, parent: null }),
  setText(node, text) { node.text = text; }, setElementText(node, text) { node.text = text; node.children = []; },
  parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  insert(node, parent, anchor) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node);
  },
  remove(node) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = null;
  },
  patchProp(node, key, oldValue, value) { (node.props ??= {})[key] = value; }, setScopeId() {},
});
const clone = value => JSON.parse(JSON.stringify(value));
const api = require(path.join(base, 'DialogueEditor/utils/publicEventParameters.ts'));
const presetApi = require(path.join(base, 'EntityPresetEditor/publicEventPresets.ts'));

function createPreset() {
  return {
    id: 'visibility-hit-ball', alias: '击球', name: 'NOLOC_击球', parameters: [
      { id: 'player', name: '是否是玩家', type: 'Int32', reference: 'booleans.value', defaultValue: '1' },
      { id: 'yaw', name: 'y轴角度', type: 'Float', defaultValue: '0' },
      { id: 'skill', name: '技能模版', type: 'ConfigReference', reference: 'skillAnimations.configId', defaultValue: '1098707708' },
    ],
  };
}
function createClip(preset, id = 'old-clip') {
  const clip = { id, type: 'PublicEvent', name: '公共事件', startTime: 1, duration: 1, components: [] };
  api.applyPublicEventPreset(clip, preset);
  api.getPublicEventArguments(clip)[0].value = '0';
  return clip;
}
function setRule(preset, equals = '1') {
  preset.parameters.find(parameter => parameter.id === 'skill').visibleWhen = [{ parameterId: 'player', equals }];
}
function withoutVisibility(clip) {
  const value = clone(clip);
  for (const parameter of api.getPublicEventArguments(value)) delete parameter.visibleWhen;
  return value;
}
function createProject(clips) {
  const { createEmptyDialogueProject, createDialogueNode, createPerformanceLine } = require(path.join(base, 'DialogueEditor/utils/dialogueProject.ts'));
  const project = createEmptyDialogueProject();
  for (let index = 0; index < clips.length; index++) {
    const node = createDialogueNode(`node-${index}`);
    const line = createPerformanceLine('PublicEvent');
    line.clips.push(clips[index]);
    node.lines.push(line);
    project.dialogue.nodes[node.id] = node;
  }
  return project;
}

function testSavedClipSynchronization() {
  assert.equal(typeof api.syncPublicEventVisibility, 'function', 'Saved clips need a visibility-only preset synchronization helper');
  assert.equal(typeof api.syncDialoguePublicEventVisibility, 'function', 'All project clips need visibility synchronization');
  const preset = createPreset(), clip = createClip(preset);
  const argumentsBefore = api.getPublicEventArguments(clip);
  argumentsBefore[1].value = '2.5';
  const original = withoutVisibility(clip);
  setRule(preset);
  // Editing a preset must copy only its current display rules into an existing action.
  preset.alias = '重命名预设'; preset.name = 'NOLOC_重命名';
  preset.parameters[2].name = '重命名字段';
  preset.parameters[2].defaultValue = '42';
  preset.parameters[2].reference = 'custom:other:config';
  preset.parameters.reverse();
  assert.equal(api.syncPublicEventVisibility(clip, [preset]), true);
  assert.deepEqual(withoutVisibility(clip), original, 'Synchronization must preserve event names, values, references, parameter types and ordering');
  const args = api.getPublicEventArguments(clip), skill = args.find(parameter => parameter.id === 'skill');
  assert.equal(args, argumentsBefore, 'Synchronization must keep the saved argument list');
  assert.deepEqual(skill.visibleWhen, [{ parameterId: 'player', equals: '1' }]);
  assert.equal(api.isPublicEventArgumentVisible(skill, args), false);
  assert.deepEqual(api.compilePublicEventArguments('NOLOC_击球', args).configParams, ['0']);
  assert.equal(skill.value, '1098707708', 'A hidden argument must retain its entered value');
  assert.deepEqual(api.compilePublicEventArguments('NOLOC_击球', args).floatParams, ['2.5']);
  const savedRules = skill.visibleWhen;
  assert.equal(api.syncPublicEventVisibility(clip, [preset]), false, 'Repeated synchronization must not produce another change');
  assert.equal(skill.visibleWhen, savedRules, 'Unchanged rules must retain identity for reactive consumers');
  args.find(parameter => parameter.id === 'player').value = '1';
  assert.equal(api.isPublicEventArgumentVisible(skill, args), true);
  assert.deepEqual(api.compilePublicEventArguments('NOLOC_击球', args).configParams, ['1098707708']);

  const presetRules = preset.parameters.find(parameter => parameter.id === 'skill').visibleWhen;
  assert.notEqual(skill.visibleWhen, presetRules);
  assert.notEqual(skill.visibleWhen[0], presetRules[0]);
  skill.visibleWhen[0].equals = '9';
  assert.equal(presetRules[0].equals, '1', 'Saved rules must not alias the preset draft');
  assert.equal(api.syncPublicEventVisibility(clip, [preset]), true);
  const second = createClip(createPreset(), 'second');
  api.syncPublicEventVisibility(second, [preset]);
  assert.notEqual(api.getPublicEventArguments(second)[2].visibleWhen, skill.visibleWhen);
  assert.notEqual(api.getPublicEventArguments(second)[2].visibleWhen[0], skill.visibleWhen[0]);

  setRule(preset, '0');
  assert.equal(api.syncPublicEventVisibility(clip, [preset]), true);
  assert.equal(api.isPublicEventArgumentVisible(skill, args), false);
  args[0].value = '0';
  assert.equal(api.isPublicEventArgumentVisible(skill, args), true);
  preset.parameters.find(parameter => parameter.id === 'skill').visibleWhen.push({ parameterId: 'yaw', equals: '0' });
  assert.equal(api.syncPublicEventVisibility(clip, [preset]), true);
  assert.equal(api.isPublicEventArgumentVisible(skill, args), false, 'All display conditions must be satisfied');
  args[1].value = '0';
  assert.equal(api.isPublicEventArgumentVisible(skill, args), true);
  delete preset.parameters.find(parameter => parameter.id === 'skill').visibleWhen;
  assert.equal(api.syncPublicEventVisibility(clip, [preset]), true);
  assert.equal(api.isPublicEventArgumentVisible(skill, args), true);
  assert.ok(!skill.visibleWhen?.length, 'Deleting a preset condition must remove the saved condition');
  assert.equal(api.syncPublicEventVisibility(clip, [preset]), false);
  console.log('PASS old clips receive added/edited/deleted conditions, preserve values and export hidden config ID as a zero placeholder');
}

function testMatchingBoundaries() {
  const preset = createPreset(); setRule(preset);
  const clip = createClip(preset);
  for (const candidates of [[], [{ ...clone(preset), id: 'another-preset' }]]) {
    const before = clone(clip);
    assert.equal(api.syncPublicEventVisibility(clip, candidates), false);
    assert.deepEqual(clip, before, 'A missing preset must preserve saved rules');
  }
  const byNameOnly = clone(clip);
  delete byNameOnly.components[0].properties.presetId;
  const beforeByName = clone(byNameOnly);
  assert.equal(api.syncPublicEventVisibility(byNameOnly, [preset]), false);
  assert.deepEqual(byNameOnly, beforeByName, 'Event names must never be used to infer a preset ID');
  for (const change of [parameter => { parameter.id = 'replacement'; }, parameter => { parameter.type = 'Int32'; }]) {
    const changedPreset = clone(preset);
    change(changedPreset.parameters[2]);
    delete changedPreset.parameters[2].visibleWhen;
    const before = clone(clip);
    assert.equal(api.syncPublicEventVisibility(clip, [changedPreset]), false);
    assert.deepEqual(clip, before, 'Changed parameter IDs/types must preserve the old argument and condition');
  }
  const unmatched = clone(clip);
  api.getPublicEventArguments(unmatched).push({ id: 'old-only', name: '技能模版', type: 'ConfigReference', value: '99', visibleWhen: [{ parameterId: 'player', equals: '0' }] });
  const oldOnly = clone(api.getPublicEventArguments(unmatched).at(-1));
  const changed = clone(preset); setRule(changed, '0');
  assert.equal(api.syncPublicEventVisibility(unmatched, [changed]), true);
  assert.deepEqual(api.getPublicEventArguments(unmatched).at(-1), oldOnly, 'Same labels must not synchronize unrelated IDs');
  const unrelated = { id: 'animation', type: 'Animation', name: '动画', components: [] };
  assert.equal(api.syncPublicEventVisibility(unrelated, [preset]), false);
  console.log('PASS synchronization requires saved preset IDs and matching parameter IDs/types, and leaves missing presets and unrelated fields intact');
}

function testWholeProjectAndReopen() {
  const preset = createPreset();
  const clips = Array.from({ length: 4 }, (_, index) => createClip(preset, `unopened-${index}`));
  const project = createProject(clips);
  // Exercise more than one line inside one node as well as several unopened nodes.
  project.dialogue.nodes['node-0'].lines.push({ id: 'extra-line', name: '公共事件', type: 'PublicEvent', clips: [createClip(preset, 'same-node-other-line')] });
  const original = Object.values(project.dialogue.nodes).flatMap(node => node.lines.flatMap(line => line.clips)).map(withoutVisibility);
  setRule(preset);
  assert.equal(api.syncDialoguePublicEventVisibility(project, [preset]), true);
  const allClips = Object.values(project.dialogue.nodes).flatMap(node => node.lines.flatMap(line => line.clips));
  assert.equal(allClips.length, 5);
  assert.deepEqual(allClips.map(withoutVisibility), original);
  for (const clip of allClips) {
    const args = api.getPublicEventArguments(clip);
    assert.equal(api.isPublicEventArgumentVisible(args[2], args), false);
    assert.deepEqual(api.compilePublicEventArguments(preset.name, args).configParams, ['0']);
  }
  assert.equal(api.syncDialoguePublicEventVisibility(project, [preset]), false);
  const { encodeDialogueProject, decodeDialogueProject } = require(path.join(base, 'DialogueEditor/utils/dialogueProjectCodec.ts'));
  const reopened = decodeDialogueProject(encodeDialogueProject(project));
  assert.equal(api.syncDialoguePublicEventVisibility(reopened, [preset]), false);
  const reopenedClips = Object.values(reopened.dialogue.nodes).flatMap(node => node.lines.flatMap(line => line.clips));
  assert.deepEqual(reopenedClips.map(withoutVisibility), original);
  for (const clip of reopenedClips) {
    const args = api.getPublicEventArguments(clip);
    assert.deepEqual(args[2].visibleWhen, [{ parameterId: 'player', equals: '1' }]);
    assert.equal(args[2].value, '1098707708');
    assert.deepEqual(api.compilePublicEventArguments(preset.name, args).configParams, ['0']);
  }
  delete preset.parameters[2].visibleWhen;
  assert.equal(api.syncDialoguePublicEventVisibility(reopened, [preset]), true);
  for (const clip of reopenedClips) assert.ok(!api.getPublicEventArguments(clip)[2].visibleWhen?.length);
  console.log('PASS every clip across nodes/lines updates without being opened, and real dialogue save/reopen preserves conditions and values');
}

function findSelect(root, label) {
  if (root.tag === 'select-stub' && root.props.label === label) return root;
  return root.children?.map(child => findSelect(child, label)).find(Boolean);
}
async function settle() {
  await new Promise(resolve => setImmediate(resolve));
  await vue.nextTick();
  await new Promise(resolve => setImmediate(resolve));
  await vue.nextTick();
}
async function testRealEditorWithPresetSaves() {
  const Editor = require(path.join(base, 'DialogueEditor/components/clip-editors/PublicEventClipEditor.vue')).default;
  const { usePublicEventPresets } = require(path.join(base, 'EntityPresetEditor/usePublicEventPresets.ts'));
  const preset = createPreset(), clip = vue.reactive(createClip(preset));
  const initialClip = withoutVisibility(clip);
  const file = '/visibility-ui/PublicEventPresets.json';
  const files = new Map([[file, JSON.stringify({ ...JSON.parse(presetApi.encodePublicEventPresets([preset])), presetStorage: 'custom-only' })]]);
  const writes = [];
  const storage = {
    setProject() { return this; },
    async exists(filename) { return files.has(filename); },
    async readFile(filename) { assert.ok(files.has(filename)); return files.get(filename); },
    async writeFile(filename, data) { files.set(filename, data); writes.push(filename); },
  };
  const workspace = vue.ref('visibility-ui');
  const apps = [];
  function mount(component) {
    const app = renderer.createApp(component), root = element('root');
    app.provide('storage', storage); app.provide('selectedWorkspaceId', workspace);
    app.mount(root); apps.push(app);
    return { app, root };
  }
  let writer;
  try {
    mount({ setup() { writer = usePublicEventPresets(); return () => vue.h('writer'); } });
    const { app: editorApp, root } = mount({ setup: () => () => vue.h(Editor, { clip }) });
    await settle();
    assert.equal(writer.ready.value, true);
    assert.ok(findSelect(root, '技能模版预设值'), 'The original unconditioned clip should expose its saved skill ID');
    const choosePlayer = async value => {
      const field = findSelect(root, '是否是玩家预设值');
      assert.ok(field); assert.equal(field.props.disabled, false);
      assert.deepEqual(field.props.options.map(option => option.value), ['0', '1']);
      field.props.choose(value); await vue.nextTick();
      assert.equal(api.getPublicEventArguments(clip)[0].value, value);
    };
    const editedPreset = writer.presets.value.find(item => item.id === preset.id);
    setRule(editedPreset);
    await writer.flush(); await settle();
    assert.equal(Boolean(findSelect(root, '技能模版预设值')), false, 'Saving a new condition must hide the old clip field immediately, without reselecting the preset');
    assert.deepEqual(withoutVisibility(clip), initialClip);
    assert.equal(api.getPublicEventArguments(clip)[2].value, '1098707708');
    assert.deepEqual(api.compilePublicEventArguments(preset.name, api.getPublicEventArguments(clip)).configParams, ['0']);
    await choosePlayer('1');
    assert.equal(findSelect(root, '技能模版预设值').props.value, '1098707708', 'Selecting 是 must restore the same saved ID');
    await choosePlayer('0');
    assert.equal(Boolean(findSelect(root, '技能模版预设值')), false, 'Selecting 否 must hide the dependent field reactively');

    setRule(editedPreset, '0');
    await writer.flush(); await settle();
    assert.ok(findSelect(root, '技能模版预设值'), 'Editing the condition must refresh the already-mounted editor');
    await choosePlayer('1');
    assert.equal(Boolean(findSelect(root, '技能模版预设值')), false);
    delete editedPreset.parameters[2].visibleWhen;
    await writer.flush(); await settle();
    assert.ok(findSelect(root, '技能模版预设值'), 'Deleting the condition must restore the already-mounted field');
    setRule(editedPreset);
    await writer.flush(); await settle();
    await choosePlayer('0');
    assert.equal(Boolean(findSelect(root, '技能模版预设值')), false);

    const { encodeDialogueProject, decodeDialogueProject } = require(path.join(base, 'DialogueEditor/utils/dialogueProjectCodec.ts'));
    const saved = encodeDialogueProject(createProject([clip]));
    editorApp.unmount(); apps.splice(apps.indexOf(editorApp), 1);
    const restored = vue.reactive(decodeDialogueProject(saved).dialogue.nodes['node-0'].lines.find(line => line.type === 'PublicEvent').clips[0]);
    const { root: restoredRoot } = mount({ setup: () => () => vue.h(Editor, { clip: restored }) });
    await settle();
    assert.equal(Boolean(findSelect(restoredRoot, '技能模版预设值')), false, 'A reopened action must honor the stored visibility condition');
    findSelect(restoredRoot, '是否是玩家预设值').props.choose('1'); await vue.nextTick();
    assert.equal(findSelect(restoredRoot, '技能模版预设值').props.value, '1098707708');
    assert.deepEqual(writes, [file, file, file, file], 'Preset consumers must not write additional copies when receiving successful saves');
    console.log('PASS real Vue editor receives writer.flush preset saves, toggles 否/是 reactively, and retains hidden values after save/reopen');
  } finally { for (const app of apps.reverse()) app.unmount(); }
}

async function main() {
  variableLibrary = await import('miliastra-variable');
  if (!process.argv.includes('--ui-only')) {
    testSavedClipSynchronization();
    testMatchingBoundaries();
    testWholeProjectAndReopen();
  }
  await testRealEditorWithPresetSaves();
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  for (const [extension, loader] of Object.entries(originalExtensions)) {
    if (loader) Module._extensions[extension] = loader;
    else delete Module._extensions[extension];
  }
});
