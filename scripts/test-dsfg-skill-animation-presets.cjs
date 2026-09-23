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
  assert.equal(files.has('/B/SkillAnimationPresets.json'), false);
  fail = true;
  first.instance.presets.value[0].name = '招手';
  await assert.rejects(first.instance.flush());
  fail = false;
  await first.instance.retry();
  first.hooks.unmount[0]();
  const reopened = await mount('A');
  assert.equal(reopened.instance.presets.value[0].name, '招手');
  reopened.hooks.unmount[0]();
  files.set('/Broken/SkillAnimationPresets.json', 'broken');
  const broken = await mount('Broken');
  assert.equal(broken.instance.ready.value, false);
  assert.ok(broken.instance.error.value);
  await broken.instance.flush();
  assert.equal(files.get('/Broken/SkillAnimationPresets.json'), 'broken');
  broken.hooks.unmount[0]();
  console.log('PASS workspace isolation, persistence, failed-save retry and corrupt-file preservation');

  const { systemPresetConfig } = require(path.join(base, 'systemPresetConfig.ts'));
  const { useEntityPresets } = require(path.join(base, 'useEntityPresets.ts'));
  const { createEntityPreset } = require(path.join(base, 'entityPresets.ts'));
  for (const [category, hook, entry, field] of [
    [systemPresetConfig.entities, useEntityPresets, { id: 'system-person', name: '人物代号', talker: '默认人物', subtitle: '' }, 'talker'],
    [systemPresetConfig.skillAnimations, useSkillAnimationPresets, { id: 'system-skill', name: '默认动画', configId: '123' }, 'name'],
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
    assert.ok(vue.isReadonly(current.instance.systemPresets.value[0]));
    assert.deepEqual(current.instance.presets.value, []);
    current.instance.presets.value.push({ ...entry, id: 'user-item', [field]: '工作区修改' });
    await current.instance.flush();
    assert.notEqual(category.presets[0][field], '工作区修改');
    current.close();
    category.presets[0][field] = '新版系统默认';
    const saved = await open();
    assert.equal(saved.instance.presets.value[0][field], '工作区修改');
    saved.instance.presets.value = [];
    await saved.instance.flush();
    saved.close();
    const empty = await open();
    assert.deepEqual(empty.instance.presets.value, []);
    assert.equal(empty.instance.systemPresets.value[0][field], '新版系统默认');
    assert.equal(empty.instance.availablePresets.value.length, 1);
    await empty.instance.flush();
    empty.close();
    const restored = await open();
    assert.deepEqual(restored.instance.presets.value, []);
    assert.equal(restored.instance.availablePresets.value[0][field], '新版系统默认');
    restored.close();
    category.presets.splice(0, category.presets.length, ...originalDefaults);
  }
  systemPresetConfig.entities.newItem.talker = '新建默认人物';
  assert.equal(createEntityPreset().talker, '新建默认人物');
  systemPresetConfig.entities.newItem.talker = '';
  systemPresetConfig.skillAnimations.newItem.name = '新建默认动画';
  assert.equal(createSkillAnimationPreset().name, '新建默认动画');
  systemPresetConfig.skillAnimations.newItem.name = '';
  console.log('PASS entity and skill system entries stay readonly and available above independently saved custom entries');

  const { useStylePresets, encodeStylePresets, decodeStylePresets, getStylePresetOptions } = require(path.join(base, 'stylePresets.ts'));
  for (const category of ['dialogueStyles', 'questStyles', 'walkTalkStyles', 'cameras']) {
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
    assert.notEqual(systemPresetConfig[category].presets[0].value, 'Custom_类型');
    saved.instance.presets.value = [];
    await saved.instance.flush(); saved.close();
    const empty = await openStyles();
    assert.deepEqual(empty.instance.presets.value, []);
    await empty.instance.flush();
    assert.deepEqual(empty.instance.options.value.map(item => item.value), systemPresetConfig[category].presets.map(item => item.value));
    empty.close();
    const defaults = systemPresetConfig[category].presets;
    files.set(`/styles-${category}/${category}.json`, encodeStylePresets(category, [
      ...defaults, { ...defaults[0], id: 'old-custom', value: 'User_Value' },
    ]));
    const legacy = await openStyles();
    assert.deepEqual(legacy.instance.presets.value.map(item => item.value), ['User_Value']);
    legacy.close();
    files.set(`/styles-${category}/${category}.json`, encodeStylePresets(category, [{ ...defaults[0], value: 'Edited_System' }]));
    const edited = await openStyles();
    assert.equal(edited.instance.presets.value[0].value, 'Edited_System');
    assert.notEqual(edited.instance.presets.value[0].id, defaults[0].id);
    assert.equal(edited.instance.options.value[0].value, defaults[0].value);
    edited.instance.presets.value[0].label = '保留修改';
    await edited.instance.flush();
    const stored = JSON.parse(files.get(`/styles-${category}/${category}.json`));
    assert.equal(stored.presetStorage, 'custom-only');
    assert.equal(stored.presets.length, 1);
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
  console.log('PASS styles keep system entries first, save custom-only lists and migrate edited legacy defaults without data loss');


}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  if (originalTs) Module._extensions['.ts'] = originalTs;
  else delete Module._extensions['.ts'];
});
