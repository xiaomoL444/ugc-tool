const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');
const originalLoad = Module._load;
const originalTs = Module._extensions['.ts'];
let context;
Module._load = function(request, parent, main) {
  if (request === 'vue') return { ...vue, inject: key => context[key], onMounted: fn => context.mount.push(fn), onBeforeUnmount: fn => context.unmount.push(fn) };
  return originalLoad.call(this, request, parent, main);
};
Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file,
}).outputText, file);

async function main() {
  const base = path.resolve(__dirname, '../src/views/DSFGStudio/components/EntityPresetEditor');
  const { createSkillAnimationPreset, encodeSkillAnimationPresets: encode, decodeSkillAnimationPresets: decode, getSkillAnimationConfigId: getId } = require(path.join(base, 'skillAnimationPresets.ts'));
  const { useSkillAnimationPresets } = require(path.join(base, 'useSkillAnimationPresets.ts'));
  const { systemPresetConfig } = require(path.join(base, 'systemPresetConfig.ts'));
  const a = { ...createSkillAnimationPreset(), name: '挥手', configId: '123' };
  const b = { ...createSkillAnimationPreset(), name: '挥手', configId: '' };
  assert.notEqual(a.id, b.id);
  assert.deepEqual(decode(encode([a, b])), [a, b]);
  for (const raw of ['', '-1', '1.5', '1e3', '2147483648', 'bad']) assert.equal(getId({ ...a, configId: raw }), null);
  for (const raw of ['0', '2147483647', ' 123 ']) assert.equal(getId({ ...a, configId: raw }), Number(raw));
  assert.throws(() => decode(encode([a, a])));
  assert.throws(() => decode('{}'));
  console.log('PASS preset drafts, duplicate names, ID boundaries and malformed data');

  const files = new Map();
  let fail = false;
  const storage = { setProject() { return this; }, async exists(file) { return files.has(file); },
    async readFile(file) { return files.get(file); }, async writeFile(file, data) { if (fail) throw Error('save failed'); files.set(file, data); } };
  async function mount(workspace) {
    context = { storage, selectedWorkspaceId: vue.ref(workspace), mount: [], unmount: [] };
    const instance = useSkillAnimationPresets();
    const hooks = context;
    await hooks.mount[0]();
    return { instance, hooks };
  }
  const first = await mount('A');
  assert.equal(files.size, 0);
  first.hooks.selectedWorkspaceId.value = 'B';
  first.instance.presets.value.push(a);
  await first.instance.flush();
  assert.deepEqual(decode(files.get('/A/SkillAnimationPresets.json')), [a]);
  assert.deepEqual(JSON.parse(files.get('/A/SkillAnimationPresets.json')).systemOverrides, []);
  assert.equal(files.has('/B/SkillAnimationPresets.json'), false);
  fail = true;
  first.instance.systemPresets.value[0].configId = '456';
  await assert.rejects(first.instance.flush());
  fail = false;
  await first.instance.retry();
  first.hooks.unmount[0]();
  const reopened = await mount('A');
  assert.equal(reopened.instance.systemPresets.value[0].configId, '456');
  reopened.hooks.unmount[0]();
  files.set('/Broken/SkillAnimationPresets.json', 'broken');
  const broken = await mount('Broken');
  assert.equal(broken.instance.ready.value, false);
  assert.ok(broken.instance.error.value);
  await broken.instance.flush();
  assert.equal(files.get('/Broken/SkillAnimationPresets.json'), 'broken');
  broken.hooks.unmount[0]();
  console.log('PASS workspace isolation, persistence, failed-save retry and corrupt-file preservation');

  const { useEntityPresets } = require(path.join(base, 'useEntityPresets.ts'));
  const { createEntityPreset } = require(path.join(base, 'entityPresets.ts'));
  for (const [category, hook, entry, field] of [
    [systemPresetConfig.entities, useEntityPresets, { id: 'system-person', name: '人物代号', talker: '默认人物', subtitle: '', guid: '', entityQuery: '' }, 'talker'],
    [systemPresetConfig.skillAnimations, useSkillAnimationPresets, { id: 'system-skill', name: '默认动画', configId: '123' }, 'configId'],
  ]) {
    const originalDefaults = category.presets.splice(0, category.presets.length, entry);
    const workspace = `defaults-${entry.id}`;
    async function open(name = workspace) {
      context = { storage, selectedWorkspaceId: vue.ref(name), mount: [], unmount: [] };
      const instance = hook();
      const hooks = context;
      await hooks.mount[0]();
      return { instance, close: () => hooks.unmount[0]() };
    }
    const current = await open();
    assert.deepEqual(JSON.parse(JSON.stringify(current.instance.systemPresets.value)), [entry]);
    assert.ok(!vue.isReadonly(current.instance.systemPresets.value[0]));
    assert.ok(vue.isReadonly(current.instance.defaultPresets.value[0]));
    assert.deepEqual(JSON.parse(JSON.stringify(current.instance.presets.value)), [entry]);
    assert.equal(current.instance.availablePresets.value.length, 1);
    current.instance.presets.value[0][field] = '默认条目修改';
    current.instance.systemPresets.value[0].name = '系统代号修改';
    assert.equal(current.instance.systemPresets.value[0].name, entry.name);
    current.instance.customPresets.value = [{ ...entry, id: 'user-item', [field]: '工作区修改' }];
    await current.instance.flush();
    assert.notEqual(category.presets[0][field], '工作区修改');
    current.close();
    category.presets[0][field] = '新版系统默认';
    const saved = await open();
    assert.equal(saved.instance.presets.value[0][field], '默认条目修改');
    assert.equal(saved.instance.presets.value[1][field], '工作区修改');
    saved.instance.customPresets.value = [];
    await saved.instance.flush();
    saved.close();
    const empty = await open();
    assert.deepEqual(empty.instance.customPresets.value, []);
    assert.equal(empty.instance.defaultPresets.value[0][field], '新版系统默认');
    assert.equal(empty.instance.systemPresets.value[0][field], '默认条目修改');
    assert.equal(empty.instance.availablePresets.value.length, 1);
    await empty.instance.flush();
    empty.close();
    const restored = await open();
    assert.deepEqual(restored.instance.customPresets.value, []);
    assert.equal(restored.instance.systemPresets.value[0][field], '默认条目修改');
    restored.close();
    category.presets.splice(0, category.presets.length, ...originalDefaults);
  }
  systemPresetConfig.entities.newItem.talker = '新建默认人物';
  assert.equal(createEntityPreset().talker, '新建默认人物');
  systemPresetConfig.entities.newItem.talker = '';
  systemPresetConfig.skillAnimations.newItem.name = '新建默认动画';
  assert.equal(createSkillAnimationPreset().name, '新建默认动画');
  systemPresetConfig.skillAnimations.newItem.name = '';
  console.log('PASS entity and skill system values are editable while aliases and mandatory system rows stay fixed');

  const { useStylePresets, encodeStylePresets, decodeStylePresets, getStylePresetOptions, supportsCustomStylePresets,
    supportsEditableSystemStylePresets, getStylePresetValueType, createStylePreset } = require(path.join(base, 'stylePresets.ts'));
  const legacyDialogueStyles = systemPresetConfig.dialogueStyles.presets.map(({ showTitle, ...item }) => item);
  assert.deepEqual(decodeStylePresets('dialogueStyles', encodeStylePresets('dialogueStyles', legacyDialogueStyles)), systemPresetConfig.dialogueStyles.presets);
  const titleDefaults = decodeStylePresets('dialogueStyles', encodeStylePresets('dialogueStyles', [
    { id: 'legacy', label: '旧自定义', value: 'Legacy' },
    { id: 'enabled', label: '显示', value: 'Enabled', showTitle: true },
    { id: 'disabled', label: '不显示', value: 'NOLOC_Default', showTitle: false },
  ]));
  assert.deepEqual(getStylePresetOptions(titleDefaults).map(item => item.showTitle), [false, true, false]);
  assert.equal(require(path.join(base, 'stylePresets.ts')).createStylePreset('dialogueStyles').showTitle, false);
  for (const invalid of ['false', 0, null]) assert.throws(() => decodeStylePresets('dialogueStyles', encodeStylePresets('dialogueStyles', [{ id: 'bad', label: '', value: 'Bad', showTitle: invalid }])));
  for (const category of ['entityGetMethods']) {
    assert.equal(supportsCustomStylePresets(category), false);
    const file = `/fixed-${category}/${category}.json`;
    const original = encodeStylePresets(category, [{ id: 'legacy-custom', label: '旧自定义', value: '99' }]);
    files.set(file, original);
    context = { storage, selectedWorkspaceId: vue.ref(`fixed-${category}`), mount: [], unmount: [] };
    const instance = useStylePresets(category);
    const hooks = context;
    await hooks.mount[0]();
    assert.deepEqual(instance.availablePresets.value, systemPresetConfig[category].presets);
    assert.deepEqual(instance.options.value.map(item => item.value), ['0', '1']);
    assert.equal(instance.presets.value[0].value, '99');
    await instance.flush(); hooks.unmount[0]();
    assert.equal(files.get(file), original, 'Loading fixed presets must preserve the legacy file');
  }
  console.log('PASS fixed categories expose only system choices and preserve legacy custom files');
  assert.equal(supportsCustomStylePresets('movementMethods'), true);
  assert.equal(supportsEditableSystemStylePresets('movementMethods'), false);
  assert.equal(getStylePresetValueType('movementMethods'), 'Int32');
  assert.equal(getStylePresetValueType('entityGetMethods'), 'Int32');
  assert.equal(getStylePresetValueType('questStyles'), 'String');
  assert.deepEqual(systemPresetConfig.movementMethods.presets.map(item => [item.label, item.value]), [['行走', '0'], ['跑步', '1'], ['冲刺', '2']]);
  const movementSeed = JSON.stringify(systemPresetConfig.movementMethods);
  const movementDraft = createStylePreset('movementMethods');
  assert.equal(movementDraft.label, ''); assert.equal(movementDraft.value, '');
  async function openMovement(workspace = 'movement-methods') {
    context = { storage, selectedWorkspaceId: vue.ref(workspace), mount: [], unmount: [] };
    const instance = useStylePresets('movementMethods'), hooks = context;
    await hooks.mount[0]();
    return { instance, close: () => hooks.unmount[0]() };
  }
  const movement = await openMovement();
  assert.equal(files.has('/movement-methods/movementMethods.json'), false, 'Reading movement defaults does not create a workspace file');
  assert.ok(vue.isReadonly(movement.instance.systemPresets.value[0]));
  assert.deepEqual(movement.instance.presets.value, []);
  movement.instance.customPresets.value = [{ ...movementDraft, label: '自定义移动', value: '3' }];
  await movement.instance.flush(); movement.close();
  const movementStored = JSON.parse(files.get('/movement-methods/movementMethods.json'));
  assert.equal(movementStored.presetStorage, 'custom-only');
  assert.deepEqual(movementStored.presets.map(item => [item.label, item.value]), [['自定义移动', '3']]);
  assert.equal(movementStored.systemOverrides, undefined);
  const savedMovement = await openMovement();
  assert.deepEqual(savedMovement.instance.options.value.map(item => item.value), ['0', '1', '2', '3']);
  const otherMovement = await openMovement('other-movement-methods');
  assert.deepEqual(otherMovement.instance.options.value.map(item => item.value), ['0', '1', '2']);
  otherMovement.close();
  savedMovement.instance.customPresets.value = [];
  await savedMovement.instance.flush(); savedMovement.close();
  const emptyMovement = await openMovement();
  assert.deepEqual(emptyMovement.instance.options.value.map(item => item.value), ['0', '1', '2']);
  assert.deepEqual(emptyMovement.instance.customPresets.value, []);
  emptyMovement.close();
  assert.equal(JSON.stringify(systemPresetConfig.movementMethods), movementSeed);
  console.log('PASS independent movement methods keep system choices read-only and custom integers persistent, isolated and removable');
  for (const category of ['dialogueStyles', 'questStyles', 'walkTalkStyles', 'cameras']) {
    assert.equal(supportsCustomStylePresets(category), true);
    async function openStyles() {
      context = { storage, selectedWorkspaceId: vue.ref(`styles-${category}`), mount: [], unmount: [] };
      const instance = useStylePresets(category);
      const hooks = context;
      await hooks.mount[0]();
      return { instance, close: () => hooks.unmount[0]() };
    }
    const current = await openStyles();
    assert.deepEqual(current.instance.options.value.map(item => item.value), systemPresetConfig[category].presets.map(item => item.value));
    current.instance.presets.value.push({ id: 'custom-style', value: 'Custom_类型', label: '自定义名称' });
    await current.instance.flush();
    current.close();
    const saved = await openStyles();
    assert.equal(saved.instance.options.value.at(-1).value, 'Custom_类型');
    assert.equal(saved.instance.options.value.at(-1).label, '自定义名称');
    if (category === 'dialogueStyles') {
      assert.equal(saved.instance.options.value.at(-1).showTitle, false);
      saved.instance.presets.value.at(-1).showTitle = true;
      await saved.instance.flush();
      const withTitle = await openStyles();
      assert.equal(withTitle.instance.options.value.at(-1).showTitle, true);
      withTitle.close();
    }
    assert.notEqual(systemPresetConfig[category].presets[0].value, 'Custom_类型');
    saved.instance.customPresets.value = [];
    await saved.instance.flush(); saved.close();
    const empty = await openStyles();
    assert.deepEqual(empty.instance.customPresets.value, []);
    await empty.instance.flush();
    assert.deepEqual(empty.instance.options.value.map(item => item.value), systemPresetConfig[category].presets.map(item => item.value));
    empty.close();
    const defaults = systemPresetConfig[category].presets;
    files.set(`/styles-${category}/${category}.json`, encodeStylePresets(category, [
      ...(category === 'dialogueStyles' ? legacyDialogueStyles : defaults), { ...defaults[0], id: 'old-custom', value: 'User_Value' },
    ]));
    const legacy = await openStyles();
    assert.deepEqual(legacy.instance.presets.value.map(item => item.value), [...defaults.map(item => item.value), 'User_Value']);
    legacy.close();
    files.set(`/styles-${category}/${category}.json`, encodeStylePresets(category, [{ ...defaults[0], value: 'Edited_System' }]));
    const edited = await openStyles();
    assert.equal(edited.instance.presets.value[0].value, 'Edited_System');
    assert.equal(edited.instance.presets.value[0].id, defaults[0].id);
    assert.equal(edited.instance.options.value[0].value, 'Edited_System');
    edited.instance.systemPresets.value[0].label = '保留修改';
    assert.equal(edited.instance.systemPresets.value[0].label, defaults[0].label);
    await edited.instance.flush();
    const stored = JSON.parse(files.get(`/styles-${category}/${category}.json`));
    assert.equal(stored.presetStorage, 'system-overrides');
    assert.equal(stored.presets.length, 0);
    assert.equal(stored.systemOverrides.length, 1);
    edited.close();
    assert.throws(() => decodeStylePresets(category, '{}'));
    const duplicate = { id: 'duplicate', label: 'A', value: 'A' };
    assert.throws(() => decodeStylePresets(category, encodeStylePresets(category, [duplicate, duplicate])));
  }
  assert.deepEqual(getStylePresetOptions([
    { id: 'a', label: '名称', value: 'X' }, { id: 'b', label: '重复', value: 'X' },
    { id: 'c', label: '未完成', value: ' ' }, { id: 'd', label: '', value: 'Y' },
  ]).map(item => item.label), ['名称', 'Y']);
  assert.throws(() => decodeStylePresets('questStyles', encodeStylePresets('dialogueStyles', [])));
  console.log('PASS styles preserve fixed system aliases, save value overrides and migrate legacy edited system values');


}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  if (originalTs) Module._extensions['.ts'] = originalTs;
  else delete Module._extensions['.ts'];
});
