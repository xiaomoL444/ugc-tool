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
  const { createPublicEventPreset, encodePublicEventPresets: encode, decodePublicEventPresets: decode } = require(path.join(base, 'publicEventPresets.ts'));
  const { usePublicEventPresets } = require(path.join(base, 'usePublicEventPresets.ts'));
  const a = { ...createPublicEventPreset(), alias: '挥手动作', name: '挥手', parameters: [{ id: 'text', name: '内容', type: 'String', defaultValue: '123' }] };
  const b = { ...createPublicEventPreset(), name: '挥手', parameters: [] };
  assert.notEqual(a.id, b.id);
  assert.deepEqual(decode(encode([a, b])), [a, b]);
  assert.throws(() => decode(encode([a, a])));
  assert.throws(() => decode('{}'));
  console.log('PASS preset drafts, duplicate names, string parameters and malformed data');

  const files = new Map();
  let fail = false;
  const storage = { setProject() { return this; }, async exists(file) { return files.has(file); },
    async readFile(file) { return files.get(file); }, async writeFile(file, data) { if (fail) throw Error('save failed'); files.set(file, data); } };
  async function mount(workspace) {
    context = { storage, selectedWorkspaceId: vue.ref(workspace), mount: [], unmount: [] };
    const instance = usePublicEventPresets();
    const hooks = context;
    await hooks.mount[0]();
    return { instance, hooks };
  }
  const first = await mount('A');
  assert.equal(files.size, 0);
  first.hooks.selectedWorkspaceId.value = 'B';
  first.instance.presets.value.push(a);
  await first.instance.flush();
  assert.deepEqual(decode(files.get('/A/PublicEventPresets.json')), [a]);
  assert.equal(files.has('/B/PublicEventPresets.json'), false);
  fail = true;
  first.instance.presets.value[0].name = '招手';
  await assert.rejects(first.instance.flush());
  fail = false;
  await first.instance.retry();
  first.hooks.unmount[0]();
  const reopened = await mount('A');
  assert.equal(reopened.instance.presets.value[0].name, '招手');
  reopened.hooks.unmount[0]();
  files.set('/Broken/PublicEventPresets.json', 'broken');
  const broken = await mount('Broken');
  assert.equal(broken.instance.ready.value, false);
  assert.ok(broken.instance.error.value);
  await broken.instance.flush();
  assert.equal(files.get('/Broken/PublicEventPresets.json'), 'broken');
  broken.hooks.unmount[0]();
  console.log('PASS workspace isolation, persistence, failed-save retry and corrupt-file preservation');


  const migrated = decode(JSON.stringify({ kind: 'DSFGPublicEventPresets', schemaVersion: 1, presets: [{ id: 'old', name: 'event', parameter: 'legacy' }] }))[0];
  assert.equal(migrated.name, 'event');
  assert.equal(migrated.alias, 'event');
  const { publicEventPresetLabel } = require(path.join(base, 'publicEventPresets.ts'));
  assert.equal(publicEventPresetLabel(a), '挥手动作 · 招手');
  assert.equal(publicEventPresetLabel(b), '挥手');
  assert.equal(decode(encode([{ ...a, alias: '' }]))[0].alias, '');
  assert.throws(() => decode(encode([{ ...a, alias: 123 }])));
  const { alias: omittedAlias, ...oldTypedPreset } = a;
  assert.equal(decode(encode([oldTypedPreset]))[0].alias, a.name);
  assert.equal(migrated.parameters[0].defaultValue, 'legacy');
  for (const invalid of [{ ...a.parameters[0], type: 'Bogus' }, { ...a.parameters[0], defaultValue: 42 }]) {
    assert.throws(() => decode(encode([{ ...a, parameters: [invalid] }])));
  }

  const customApi = require(path.join(base, 'customPresets.ts'));
  const referencesApi = require(path.join(base, 'presetReferences.ts'));
  const table = { id: 'characters', name: '角色配置', fields: [{ id: 'guid', name: '角色 GUID', type: 'Guid' }, { id: 'title', name: '称号', type: 'String' }], records: [{ id: 'actor', name: '角色 A', values: { guid: '18446744073709551615', title: '旅行者' } }] };
  assert.deepEqual(customApi.decodeCustomPresets(customApi.encodeCustomPresets([table])), [table]);
  assert.throws(() => customApi.decodeCustomPresets(customApi.encodeCustomPresets([{ ...table, fields: [...table.fields, table.fields[0]] }])));
  assert.throws(() => customApi.decodeCustomPresets(customApi.encodeCustomPresets([{ ...table, records: [{ ...table.records[0], values: { guid: 123 } }] }])));
  const reference = referencesApi.referenceSources([table]).find(item => item.label === '角色配置 / 角色 GUID');
  assert.equal(referencesApi.compatibleReference(reference, 'Guid'), true);
  assert.equal(referencesApi.compatibleReference(reference, 'Int32'), false);
  const event = { ...a, parameters: [{ ...a.parameters[0], reference: reference.value }] };
  assert.deepEqual(decode(encode([event])), [event]);
  files.set('/Refs/CustomPresets.json', customApi.encodeCustomPresets([table]));
  context = { storage, selectedWorkspaceId: vue.ref('Refs'), mount: [], unmount: [] };
  const refs = referencesApi.usePresetReferences();
  await Promise.all(context.mount.map(hook => hook()));
  assert.equal(refs.ready.value, true);
  assert.deepEqual(refs.options(reference.value, 'Guid'), [{ label: '角色 A · 18446744073709551615', value: '18446744073709551615' }]);
  assert.deepEqual(refs.options(reference.value, 'Int32'), []);
  assert.deepEqual(refs.options('custom:missing:guid', 'Guid'), []);
  assert.ok(refs.options('skillAnimations.configId', 'ConfigReference').length);
  assert.deepEqual(refs.options('booleans.value', 'Int32'), [{ label: '否', value: '0' }, { label: '是', value: '1' }]);
  assert.deepEqual(refs.options('booleans.value', 'String'), []);
  assert.deepEqual(refs.options('entityGetMethods.value', 'Int32'), [{ label: 'GUID', value: '0' }, { label: 'String', value: '1' }]);
  assert.deepEqual(refs.options('entityGetMethods.value', 'String'), []);
  context.unmount.forEach(hook => hook());
  context = { storage, selectedWorkspaceId: vue.ref('Custom'), mount: [], unmount: [] };
  const customState = customApi.useCustomPresets();
  await Promise.all(context.mount.map(hook => hook()));
  customState.presets.value.push(table);
  await customState.flush();
  assert.deepEqual(customApi.decodeCustomPresets(files.get('/Custom/CustomPresets.json')), [table]);
  customState.presets.value[0].records[0].values.title = '冒险家';
  await customState.flush();
  assert.equal(customApi.decodeCustomPresets(files.get('/Custom/CustomPresets.json'))[0].records[0].values.title, '冒险家');
  context.unmount.forEach(hook => hook());
  console.log('PASS multi-field custom configuration persistence, typed references, GUID precision and missing-source fallback');

  const systemTable = { id: 'system-actors', name: '系统角色', fields: [table.fields[0]], records: [{ id: 'actor', name: '系统角色 A', values: { guid: '100' } }] };
  const overlay = { id: 'user-extension', extends: systemTable.id, name: systemTable.name, fields: [table.fields[1]], records: [{ id: 'actor', name: '不可覆盖', values: { guid: '999', title: '旅行者' } }, { id: 'new-actor', name: '自定义角色', values: { guid: '200', title: '伙伴' } }] };
  const originalSystem = structuredClone(systemTable);
  const merged = customApi.mergeCustomPresets([systemTable], [overlay]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].fields, table.fields);
  assert.deepEqual(merged[0].records[0], { id: 'actor', name: '系统角色 A', values: { guid: '100', title: '旅行者' } });
  assert.equal(merged[0].records[1].name, '自定义角色');
  assert.deepEqual(systemTable, originalSystem);
  assert.equal(customApi.mergeCustomPresets([], [overlay])[0].id, systemTable.id);
  assert.throws(() => customApi.decodeCustomPresets(customApi.encodeCustomPresets([overlay, { ...overlay, id: 'other-extension' }])));
  assert.throws(() => customApi.decodeCustomPresets(customApi.encodeCustomPresets([{ ...overlay, extends: '' }])));
  const { systemPresetConfig } = require(path.join(base, 'systemPresetConfig.ts'));
  const objectForward = systemPresetConfig.publicEvents.presets.find(item => item.name === 'NOLOC_SetObjectEntityFoward');
  assert.equal(objectForward.alias, '触发实体朝向（仅物件）');
  assert.deepEqual(objectForward.parameters.map(item => item.type), ['Int32', 'Int32', 'Guid', 'String', 'Int32', 'Guid', 'String']);
  assert.deepEqual(objectForward.parameters.map(item => item.reference), ['booleans.value', 'entityGetMethods.value', undefined, undefined, 'entityGetMethods.value', undefined, undefined]);
  assert.deepEqual(decode(encode([objectForward])), [objectForward]);
  const resetCamera = systemPresetConfig.publicEvents.presets.find(item => item.name === 'NOLOC_ResetCamera');
  assert.deepEqual(resetCamera.parameters.map(item => [item.name, item.type, item.reference, item.defaultValue]), [['是否立即到达', 'Int32', 'booleans.value', '0']]);
  assert.deepEqual(decode(encode([resetCamera])), [resetCamera]);
  const blackScreen = systemPresetConfig.publicEvents.presets.find(item => item.name === 'NOLOC_SimpleBlackScreen');
  assert.equal(blackScreen.alias, '播放简单黑幕');
  assert.deepEqual(blackScreen.parameters.map(item => [item.type, item.defaultValue]), [['String', '#000000FF'], ['Float', '0.5'], ['Float', '1'], ['Float', '0.5']]);
  assert.deepEqual(decode(encode([blackScreen])), [blackScreen]);
  systemPresetConfig.customTables.presets.push(systemTable);
  try {
    context = { storage, selectedWorkspaceId: vue.ref('Extended'), mount: [], unmount: [] };
    const extended = customApi.useCustomPresets();
    await Promise.all(context.mount.map(hook => hook()));
    assert.equal(files.has('/Extended/CustomPresets.json'), false);
    extended.presets.value.push(overlay);
    await extended.flush();
    assert.deepEqual(customApi.decodeCustomPresets(files.get('/Extended/CustomPresets.json')), [overlay]);
    assert.deepEqual(extended.availablePresets.value, merged);
    context.unmount.forEach(hook => hook());
    context = { storage, selectedWorkspaceId: vue.ref('Extended'), mount: [], unmount: [] };
    const extendedRefs = referencesApi.usePresetReferences();
    await Promise.all(context.mount.map(hook => hook()));
    assert.deepEqual(extendedRefs.options('custom:system-actors:title', 'String'), [{ label: '系统角色 A · 旅行者', value: '旅行者' }, { label: '自定义角色 · 伙伴', value: '伙伴' }]);
    context.unmount.forEach(hook => hook());
  } finally { systemPresetConfig.customTables.presets.pop(); }
  console.log('PASS system field protection, custom extensions, reload, stable references and orphan preservation');

  const { compileScript, compileTemplate } = require('@vue/compiler-sfc');
  for (const relative of ['EntityPresetEditor.vue', 'CustomPresetSection.vue', '../DialogueEditor/components/clip-editors/PublicEventClipEditor.vue']) {
    const filename = path.resolve(base, relative);
    const parsed = parse(fs.readFileSync(filename, 'utf8'), { filename });
    const compiled = compileScript(parsed.descriptor, { id: relative });
    assert.deepEqual(compileTemplate({ source: parsed.descriptor.template.content, filename, id: relative, compilerOptions: { bindingMetadata: compiled.bindings } }).errors, []);
  }
  console.log('PASS typed preset migration, validation and real Vue parameter forms compile');

}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  if (originalTs) Module._extensions['.ts'] = originalTs;
  else delete Module._extensions['.ts'];
});
