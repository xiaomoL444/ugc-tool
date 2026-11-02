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
  return { tag, children: [], parent: null, events: new Map(), clientWidth: 918,
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
function testPlayerLookForward() {
  const preset = require(path.join(base, 'EntityPresetEditor/systemPresetConfig.ts')).systemPresetConfig.publicEvents.presets
    .find(item => item.id === 'public-player-look-forward');
  assert.equal(preset.name, 'NOLOC_PlayerLookForward');
  assert.deepEqual(preset.parameters.map(item => [item.name, item.type, item.defaultValue, item.reference]), [
    ['是否是朝向说话人', 'Bool', 'True', undefined],
    ['实体获取方式', 'Int32', '', 'entityGetMethods.value'],
    ['GUID', 'Guid', '', undefined],
    ['String', 'String', '', undefined],
  ]);
  const clip = { id: 'look-forward', type: 'PublicEvent', name: '公共事件', startTime: 0, duration: 1, components: [] };
  api.applyPublicEventPreset(clip, preset);
  const args = api.getPublicEventArguments(clip);
  assert.deepEqual(args.filter(arg => api.isPublicEventArgumentVisible(arg, args)).map(arg => arg.name), ['是否是朝向说话人']);
  assert.deepEqual(api.compilePublicEventArguments(preset.name, args), {
    stringParams: ['NOLOC_PlayerLookForward', ''], intParams: ['0'], guidParams: ['0'],
    configParams: [], prefabParams: [], floatParams: [], boolParams: ['True'],
  });
  args[0].value = 'False'; args[1].value = '0'; args[2].value = '18446744073709551615'; args[3].value = 'NPC/目标';
  assert.deepEqual(args.filter(arg => api.isPublicEventArgumentVisible(arg, args)).map(arg => arg.name), ['是否是朝向说话人', '实体获取方式', 'GUID']);
  let compiled = api.compilePublicEventArguments(preset.name, args);
  assert.deepEqual(compiled.guidParams, ['18446744073709551615']); assert.deepEqual(compiled.stringParams, ['NOLOC_PlayerLookForward', '']);
  args[1].value = '1';
  assert.deepEqual(args.filter(arg => api.isPublicEventArgumentVisible(arg, args)).map(arg => arg.name), ['是否是朝向说话人', '实体获取方式', 'String']);
  compiled = api.compilePublicEventArguments(preset.name, args);
  assert.deepEqual(compiled.guidParams, ['0']); assert.deepEqual(compiled.intParams, ['1']);
  assert.deepEqual(compiled.boolParams, ['False']); assert.deepEqual(compiled.stringParams, ['NOLOC_PlayerLookForward', 'NPC/目标']);
  assert.equal(args[2].value, '18446744073709551615', 'Hiding a field must preserve the entered GUID');
  console.log('PASS PlayerLookForward follows the screenshot defaults, both entity modes, typed export slots and GUID precision');
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
  const boolPreset = clone(preset);
  boolPreset.parameters[0] = { ...boolPreset.parameters[0], type: 'Bool', defaultValue: 'False' };
  delete boolPreset.parameters[0].reference;
  setRule(boolPreset, 'True');
  const legacyBefore = clone(clip);
  assert.equal(api.syncPublicEventVisibility(clip, [boolPreset]), false);
  assert.deepEqual(clip, legacyBefore, 'Changing the condition source to Bool must retain legacy Int32 values and 0/1 conditions');
  assert.equal(api.getPublicEventArgumentReference(clip, api.getPublicEventArguments(clip)[0]), undefined, 'Removed boolean sources should use direct typed input');
  assert.equal(api.getPublicEventArguments(clip)[0].reference, 'booleans.value', 'Legacy reference metadata is preserved in the saved clip');
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
function findInput(root, label) {
  if (root.tag === 'input' && root.props?.['aria-label'] === label) return root;
  return root.children?.map(child => findInput(child, label)).find(Boolean);
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
  const files = new Map([[file, JSON.stringify({ ...JSON.parse(presetApi.encodePublicEventPresets([preset])), presetStorage: 'system-overrides', systemOverrides: [] })]]);
  const writes = [];
  const storage = {
    setProject() { return this; },
    async exists(filename) { return files.has(filename); },
    async readFile(filename) { assert.ok(files.has(filename)); return files.get(filename); },
    async writeFile(filename, data) { files.set(filename, data); writes.push(filename); },
  };
  const workspace = vue.ref('visibility-ui');
  const target = vue.ref({ fileType: 0, baseReleaseId: 2 , packageIds: []});
  const apps = [];
  function mount(component) {
    const app = renderer.createApp(component), root = element('root');
    app.provide('storage', storage); app.provide('selectedWorkspaceId', workspace);
    app.provide(require(path.join(base, 'useWorkspaceSettings.ts')).workspaceSettingsKey, target);
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
      assert.equal(findSelect(root, '是否是玩家预设值'), undefined, 'The removed boolean source must not show an unusable select');
      const field = findInput(root, '是否是玩家');
      assert.ok(field, 'Legacy boolean references must remain editable as integers');
      field.props.onInput({ target: { value }, isComposing: false }); await vue.nextTick();
      assert.equal(api.getPublicEventArguments(clip)[0].value, value);
      assert.equal(api.getPublicEventArguments(clip)[0].type, 'Int32');
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
    findInput(restoredRoot, '是否是玩家').props.onInput({ target: { value: '1' }, isComposing: false }); await vue.nextTick();
    assert.equal(findSelect(restoredRoot, '技能模版预设值').props.value, '1098707708');
    assert.deepEqual(writes, [file, file, file, file], 'Preset consumers must not write additional copies when receiving successful saves');
    console.log('PASS real Vue editor keeps legacy boolean references editable as Int32, receives preset saves and retains hidden values after save/reopen');
    const timing = require(path.join(base, 'DialogueEditor/utils/groupTimeline.ts'));
    restored.duration = 6;
    editedPreset.requiresDuration = false;
    await writer.flush(); await settle();
    assert.equal(timing.isPerformanceClipResizable(restored), false, 'A successful preset save updates an already-mounted Clip');
    assert.equal(timing.getPerformanceClipDuration(restored), 0);
    assert.equal(restored.duration, 6);
    editedPreset.requiresDuration = true;
    await writer.flush(); await settle();
    assert.equal(timing.isPerformanceClipResizable(restored), true);
    assert.equal(timing.getPerformanceClipDuration(restored), 6);
    console.log('PASS real Vue preset save notifications update the duration policy and restore the saved length on re-enable');
    const lookPreset = require(path.join(base, 'EntityPresetEditor/systemPresetConfig.ts')).systemPresetConfig.publicEvents.presets
      .find(item => item.id === 'public-player-look-forward');
    const lookClip = vue.reactive({ id: 'look-editor', type: 'PublicEvent', name: '公共事件', startTime: 0, duration: 1, components: [] });
    api.applyPublicEventPreset(lookClip, lookPreset);
    const { root: lookRoot } = mount({ setup: () => () => vue.h(Editor, { clip: lookClip }) }); await settle();
    assert.ok(findSelect(lookRoot, '公共事件预设').props.options.some(option => option.value === lookPreset.id && option.label.includes('（v7.2）')));
    const savedLook = JSON.stringify(lookClip);
    target.value = { fileType: 0, baseReleaseId: 1 , packageIds: []}; await settle();
    assert.equal(findSelect(lookRoot, '公共事件预设').props.options.some(option => option.value === lookPreset.id), false);
    assert.equal(JSON.stringify(lookClip), savedLook, 'Downgrading the workspace must preserve the saved event and its arguments');
    target.value = { fileType: 0, baseReleaseId: 2 , packageIds: []}; await settle();
    assert.ok(findSelect(lookRoot, '公共事件预设').props.options.some(option => option.value === lookPreset.id));
    assert.equal(findSelect(lookRoot, '公共事件预设').props.value, lookPreset.id);
    console.log('PASS Timeline offers PlayerLookForward from 7.2 and retains saved event data when switching to 7.1 and back');
  } finally { for (const app of apps.reverse()) app.unmount(); }
}

async function testTimelineDurationDisplay() {
  const Timeline = require(path.join(base, 'DialogueEditor/GroupTimelineV3.vue')).default;
  const { createDialogueNode, createPerformanceClip } = require(path.join(base, 'DialogueEditor/utils/dialogueProject.ts'));
  const preset = { ...createPreset(), alias: '这是一个按事件名称自动扩展宽度的公共事件', requiresDuration: false };
  const clip = vue.reactive(createClip(preset)); clip.duration = 6.5;
  const custom = createPerformanceClip('Custom', 3); custom.components[0].properties.value = '自定义事件';
  const node = vue.reactive(createDialogueNode('duration-display')); node.dialogue = undefined;
  node.lines = [
    { id: 'public-line', type: 'PublicEvent', name: '公共事件', clips: [clip] },
    { id: 'custom-line', type: 'Custom', name: '自定义事件', clips: [custom] },
  ];
  const oldWindow = global.window, oldObserver = global.ResizeObserver;
  global.window = { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout };
  global.ResizeObserver = class { observe() {} disconnect() {} };
  const root = element('root'), dock = element('dock');
  const app = renderer.createApp({ setup: () => () => vue.h(Timeline, { node, inspectorTarget: dock }) });
  app.provide('selectedWorkspaceId', vue.ref('duration-display'));
  app.provide('storage', { setProject() { return this; }, async exists() { return false; } });
  const nodes = (root, test) => [...(test(root) ? [root] : []), ...(root.children ?? []).flatMap(child => nodes(child, test))];
  const hasClass = (node, name) => typeof node.props?.class === 'string' && node.props.class.split(/\s+/).includes(name);
  const text = node => (node.text ?? '') + (node.children ?? []).map(text).join('');
  const publicButton = () => nodes(root, node => hasClass(node, 'clip-publicevent'))[0];
  const durationInputs = () => nodes(dock, node => node.tag === 'label' && text(node).includes('持续时间'));
  try {
    app.mount(root); await settle();
    const button = publicButton(), customButton = nodes(root, node => hasClass(node, 'clip-custom'))[0];
    for (const button of [publicButton(), customButton]) {
      assert.equal(button.props.style.width, undefined, 'Event-name clips must not receive a time-based pixel width');
      assert.ok(hasClass(button, 'auto-width-clip'), 'Public events with disabled edges use the same content sizing as Custom');
      assert.equal(nodes(button, node => hasClass(node, 'clip-resize-handle')).length, 0);
      assert.equal(text(button).includes('+'), false, 'Event-name clips must not display a duration');
    }
    assert.ok(text(button).includes(preset.alias));
    button.props.onClick({ stopPropagation() {} }); await settle();
    assert.equal(durationInputs().length, 0, 'The inspector hides duration when edge dragging is disabled');
    clip.components[0].properties.requiresDuration = true; await settle();
    assert.ok(publicButton().props.style.width.endsWith('px'));
    assert.equal(nodes(publicButton(), node => hasClass(node, 'clip-resize-handle')).length, 2);
    assert.ok(text(publicButton()).includes('6.5s'));
    assert.equal(durationInputs().length, 1);
    clip.components[0].properties.requiresDuration = false; await settle();
    assert.equal(publicButton().props.style.width, undefined);
    assert.equal(text(publicButton()).includes('6.5s'), false);
    assert.equal(durationInputs().length, 0);
    assert.equal(clip.duration, 6.5, 'Toggling the display policy preserves the stored duration');
    console.log('PASS rendered Timeline uses event-name sizing, hides duration and handles, and restores editable timing on enable');
  } finally {
    app.unmount();
    if (oldWindow === undefined) delete global.window; else global.window = oldWindow;
    if (oldObserver === undefined) delete global.ResizeObserver; else global.ResizeObserver = oldObserver;
  }
}

async function main() {
  variableLibrary = await import('miliastra-variable');
  if (!process.argv.includes('--ui-only')) {
    testPlayerLookForward();
    testSavedClipSynchronization();
    testMatchingBoundaries();
    testWholeProjectAndReopen();
  }
  await testRealEditorWithPresetSaves();
  await testTimelineDurationDisplay();
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  for (const [extension, loader] of Object.entries(originalExtensions)) {
    if (loader) Module._extensions[extension] = loader;
    else delete Module._extensions[extension];
  }
});
