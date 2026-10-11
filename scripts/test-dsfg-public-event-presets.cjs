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
  const { createPublicEventPreset, createPublicEventParameter, changePublicEventParameterType, encodePublicEventPresets: encode, decodePublicEventPresets: decode } = require(path.join(base, 'publicEventPresets.ts'));
  const { usePublicEventPresets } = require(path.join(base, 'usePublicEventPresets.ts'));
  const { systemPresetConfig } = require(path.join(base, 'systemPresetConfig.ts'));
  const defaultPresets = decode(encode(systemPresetConfig.publicEvents.presets));
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
  assert.deepEqual(first.instance.presets.value, defaultPresets, 'History state includes system public events');
  assert.deepEqual(first.instance.systemPresets.value, defaultPresets);
  assert.deepEqual(first.instance.defaultPresets.value, defaultPresets);
  assert.deepEqual(first.instance.customPresets.value, []);
  assert.notEqual(first.instance.systemPresets.value[0], systemPresetConfig.publicEvents.presets[0], 'System value edits must not mutate central defaults');
  first.hooks.selectedWorkspaceId.value = 'B';
  first.instance.customPresets.value = [a];
  await first.instance.flush();
  assert.equal(JSON.parse(files.get('/A/PublicEventPresets.json')).presetStorage, 'system-overrides');
  assert.deepEqual(JSON.parse(files.get('/A/PublicEventPresets.json')).systemOverrides, []);
  assert.deepEqual(decode(files.get('/A/PublicEventPresets.json')), [a]);
  assert.equal(files.has('/B/PublicEventPresets.json'), false);
  const systemEvent = first.instance.systemPresets.value[0];
  systemEvent.name = 'NOLOC_WorkspaceSkill';
  systemEvent.parameters[0].defaultValue = '42';
  await first.instance.flush();
  const savedSystem = JSON.parse(files.get('/A/PublicEventPresets.json')).systemOverrides;
  assert.equal(savedSystem.length, 1);
  assert.equal(savedSystem[0].id, defaultPresets[0].id);
  assert.equal(savedSystem[0].alias, defaultPresets[0].alias);
  assert.equal(savedSystem[0].name, 'NOLOC_WorkspaceSkill');
  assert.equal(savedSystem[0].parameters[0].defaultValue, '42');
  assert.deepEqual(systemPresetConfig.publicEvents.presets, defaultPresets, 'Saving system overrides must preserve central default entries');
  fail = true;
  first.instance.presets.value.find(preset => preset.id === a.id).name = '招手';
  await assert.rejects(first.instance.flush());
  fail = false;
  await first.instance.retry();
  first.hooks.unmount[0]();
  const reopened = await mount('A');
  assert.equal(reopened.instance.presets.value.find(preset => preset.id === a.id).name, '招手');
  assert.equal(reopened.instance.presets.value.length, defaultPresets.length + 1);
  assert.equal(reopened.instance.systemPresets.value[0].name, 'NOLOC_WorkspaceSkill');
  assert.equal(reopened.instance.systemPresets.value[0].parameters[0].defaultValue, '42');
  assert.equal(reopened.instance.systemPresets.value[0].alias, defaultPresets[0].alias);
  assert.equal(reopened.instance.customPresets.value.length, 1);
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
  const boolPreset = { ...a, parameters: [{ id: 'enabled', name: '启用', type: 'Bool', defaultValue: 'False' }] };
  assert.deepEqual(decode(encode([boolPreset])), [boolPreset]);
  for (const defaultValue of [undefined, '']) {
    assert.equal(decode(encode([{ ...boolPreset, parameters: [{ ...boolPreset.parameters[0], defaultValue }] }]))[0].parameters[0].defaultValue, 'False');
  }
  const newBool = { ...createPublicEventParameter(), type: 'Bool', reference: 'entities.guid' };
  changePublicEventParameterType(newBool);
  assert.equal(newBool.defaultValue, 'False'); assert.equal(newBool.reference, undefined);
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
  const { encodeEntityPresets } = require(path.join(base, 'entityPresets.ts'));
  files.set('/Refs/EntityPresets.json', encodeEntityPresets([
    { id: 'door', name: '门', talker: '', subtitle: '', guid: '18446744073709551615', entityQuery: '门/入口' },
    { id: 'empty', name: '空草稿', talker: '', subtitle: '', guid: '', entityQuery: '' },
    { id: 'invalid', name: '无效 GUID', talker: '', subtitle: '', guid: 'abc', entityQuery: '   ' },
  ]));
  context = { storage, selectedWorkspaceId: vue.ref('Refs'), mount: [], unmount: [] };
  const refs = referencesApi.usePresetReferences();
  await Promise.all(context.mount.map(hook => hook()));
  assert.equal(refs.ready.value, true);
  assert.deepEqual(refs.options('entities.guid', 'Guid'), [
    { label: '玩家自身 · 1086324738', value: '1086324738' },
    { label: '门 · 18446744073709551615', value: '18446744073709551615' },
  ]);
  assert.deepEqual(refs.options('entities.entityQuery', 'String'), [{ label: '门 · 门/入口', value: '门/入口' }]);
  assert.deepEqual(refs.options('entities.guid', 'String'), []);
  assert.deepEqual(refs.options('entities.entityQuery', 'Guid'), []);
  assert.deepEqual(refs.options(reference.value, 'Guid'), [{ label: '角色 A · 18446744073709551615', value: '18446744073709551615' }]);
  assert.deepEqual(refs.options(reference.value, 'Int32'), []);
  assert.deepEqual(refs.options('custom:missing:guid', 'Guid'), []);
  assert.ok(refs.options('skillAnimations.configId', 'ConfigReference').length);
  assert.equal(refs.sources.value.some(source => source.value === 'booleans.value'), false);
  assert.deepEqual(refs.options('booleans.value', 'Int32'), []);
  assert.deepEqual(refs.options('booleans.value', 'Bool'), []);
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
  const objectForward = systemPresetConfig.publicEvents.presets.find(item => item.name === 'NOLOC_SetObjectEntityFoward');
  assert.equal(objectForward.alias, '触发实体朝向（仅物件）');
  assert.deepEqual(objectForward.parameters.map(item => item.type), ['Bool', 'Int32', 'Guid', 'String', 'Int32', 'Guid', 'String']);
  assert.deepEqual(objectForward.parameters.map(item => item.reference), [undefined, 'entityGetMethods.value', 'entities.guid', 'entities.entityQuery', 'entityGetMethods.value', 'entities.guid', 'entities.entityQuery']);
  assert.equal(objectForward.parameters[0].defaultValue, 'False');
  const { getPublicEventArgumentReference, applyPublicEventPreset, getPublicEventArguments, isPublicEventArgumentVisible, syncPublicEventVisibility, compilePublicEventArguments } = require(path.join(base, '../DialogueEditor/utils/publicEventParameters.ts'));
  const clip = { components: [{ templateId: 'public.event', properties: {} }] };
  applyPublicEventPreset(clip, objectForward);
  const args = getPublicEventArguments(clip);
  ['True', '0', '1086324738', '', '1', '', '门/入口'].forEach((value, i) => { args[i].value = value; });
  assert.deepEqual(compilePublicEventArguments(objectForward.name, args).boolParams, ['True']);
  assert.deepEqual(compilePublicEventArguments(objectForward.name, args).guidParams, ['1086324738', '0']);
  assert.deepEqual(compilePublicEventArguments(objectForward.name, args).stringParams, [objectForward.name, '', '门/入口']);
  for (const index of [2, 3, 5, 6]) {
    delete args[index].reference;
    const before = JSON.stringify(clip);
    assert.equal(getPublicEventArgumentReference(clip, args[index]), index === 2 || index === 5 ? 'entities.guid' : 'entities.entityQuery');
    assert.equal(JSON.stringify(clip), before);
  }
  args[2].reference = 'custom:characters:guid';
  assert.equal(getPublicEventArgumentReference(clip, args[2]), 'custom:characters:guid');
  applyPublicEventPreset(clip, objectForward);
  assert.equal(getPublicEventArguments(clip)[2].value, '1086324738');
  assert.deepEqual(decode(encode([objectForward])), [objectForward]);
  const resetCamera = systemPresetConfig.publicEvents.presets.find(item => item.name === 'NOLOC_ResetCamera');
  assert.deepEqual(resetCamera.parameters.map(item => [item.name, item.type, item.reference, item.defaultValue]), [['是否立即到达', 'Bool', undefined, 'False']]);
  assert.deepEqual(decode(encode([resetCamera])), [resetCamera]);
  const blackScreen = systemPresetConfig.publicEvents.presets.find(item => item.name === 'NOLOC_SimpleBlackScreen');
  assert.equal(blackScreen.alias, '播放简单黑幕');
  assert.deepEqual(blackScreen.parameters.map(item => [item.type, item.defaultValue]), [['String', '#000000FF'], ['Float', '0.5'], ['Float', '1'], ['Float', '0.5']]);
  assert.deepEqual(decode(encode([blackScreen])), [blackScreen]);
  const playerTeleport = systemPresetConfig.publicEvents.presets.find(item => item.id === 'public-player-teleport');
  assert.equal(playerTeleport.name, 'NOLOC_PlayerTeleport');
  assert.deepEqual(playerTeleport.parameters.map(item => [item.id, item.name, item.type, item.defaultValue]), [
    ['public-player-teleport-set-position', '设置位置', 'Bool', 'False'],
    ['public-player-teleport-position-x', '位置 X', 'Float', '0'],
    ['public-player-teleport-position-y', '位置 Y', 'Float', '0'],
    ['public-player-teleport-position-z', '位置 Z', 'Float', '0'],
    ['public-player-teleport-set-rotation', '设置旋转', 'Bool', 'False'],
    ['public-player-teleport-rotation-y', '旋转 Y', 'Float', '0'],
  ]);
  assert.deepEqual(playerTeleport.parameters.map(item => item.visibleWhen), [
    undefined,
    [{ parameterId: 'public-player-teleport-set-position', equals: 'True' }],
    [{ parameterId: 'public-player-teleport-set-position', equals: 'True' }],
    [{ parameterId: 'public-player-teleport-set-position', equals: 'True' }],
    undefined,
    [{ parameterId: 'public-player-teleport-set-rotation', equals: 'True' }],
  ]);
  assert.deepEqual(decode(encode([playerTeleport])), [playerTeleport]);
  const teleportClip = { components: [{ templateId: 'public.event', properties: {} }] };
  applyPublicEventPreset(teleportClip, playerTeleport);
  const teleportArgs = getPublicEventArguments(teleportClip);
  assert.deepEqual(teleportArgs.filter(item => isPublicEventArgumentVisible(item, teleportArgs)).map(item => item.name), ['设置位置', '设置旋转']);
  const floatValues = ['12.5', '-3', '40.25', '90'];
  const teleportFloats = teleportArgs.filter(item => item.type === 'Float');
  teleportFloats.forEach((item, index) => { item.value = floatValues[index]; });
  for (const [setPosition, setRotation] of [['False', 'False'], ['True', 'False'], ['True', 'True'], ['False', 'True'], ['False', 'False']]) {
    teleportArgs[0].value = setPosition;
    teleportArgs[4].value = setRotation;
    assert.deepEqual(teleportArgs.map(item => isPublicEventArgumentVisible(item, teleportArgs)), [
      true, setPosition === 'True', setPosition === 'True', setPosition === 'True', true, setRotation === 'True',
    ]);
    const compiled = compilePublicEventArguments(playerTeleport.name, teleportArgs);
    assert.deepEqual(compiled.boolParams, [setPosition, setRotation], 'Teleport switch order is stable in the Bool list');
    assert.deepEqual(compiled.floatParams, [
      ...(setPosition === 'True' ? floatValues.slice(0, 3) : ['0', '0', '0']),
      setRotation === 'True' ? floatValues[3] : '0',
    ], 'Hidden teleport values keep their Float slots with zero placeholders');
    assert.deepEqual(compiled.stringParams, [playerTeleport.name]);
    assert.deepEqual(teleportFloats.map(item => item.value), floatValues, 'Switching and compiling preserve hidden input values');
  }
  const legacyTeleport = { ...playerTeleport, parameters: playerTeleport.parameters.filter(item => item.type === 'Float').map(({ visibleWhen, ...item }) => item) };
  const legacyTeleportClip = { components: [{ templateId: 'public.event', properties: {} }] };
  applyPublicEventPreset(legacyTeleportClip, legacyTeleport);
  getPublicEventArguments(legacyTeleportClip).forEach((item, index) => { item.value = floatValues[index]; });
  assert.equal(syncPublicEventVisibility(legacyTeleportClip, [playerTeleport]), true);
  const legacyTeleportArgs = getPublicEventArguments(legacyTeleportClip);
  assert.deepEqual(legacyTeleportArgs.map(item => item.type), ['Float', 'Float', 'Float', 'Float'], 'Existing actions retain their parameter structure');
  assert.ok(legacyTeleportArgs.every(item => isPublicEventArgumentVisible(item, legacyTeleportArgs)), 'Missing switches keep legacy Float inputs visible');
  assert.deepEqual(compilePublicEventArguments(playerTeleport.name, legacyTeleportArgs).floatParams, floatValues);
  assert.deepEqual(compilePublicEventArguments(playerTeleport.name, legacyTeleportArgs).boolParams, []);
  applyPublicEventPreset(legacyTeleportClip, playerTeleport);
  const reappliedTeleportArgs = getPublicEventArguments(legacyTeleportClip);
  assert.deepEqual(reappliedTeleportArgs.filter(item => item.type === 'Bool').map(item => item.value), ['False', 'False']);
  assert.deepEqual(reappliedTeleportArgs.filter(item => item.type === 'Float').map(item => item.value), floatValues, 'Reapplying the preset adds switches while preserving all Float values');
  reappliedTeleportArgs.filter(item => item.type === 'Bool').forEach(item => { item.value = 'True'; });
  assert.ok(reappliedTeleportArgs.every(item => isPublicEventArgumentVisible(item, reappliedTeleportArgs)));
  assert.deepEqual(compilePublicEventArguments(playerTeleport.name, reappliedTeleportArgs).floatParams, floatValues);
  assert.deepEqual(compilePublicEventArguments(playerTeleport.name, reappliedTeleportArgs).boolParams, ['True', 'True']);
  console.log('PASS player teleport defaults, four switch combinations, stable Bool/Float slots, hidden values and legacy preset reapplication');
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
