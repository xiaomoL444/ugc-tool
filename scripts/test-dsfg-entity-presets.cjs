/* Run with: node scripts/test-dsfg-entity-presets.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const previousLoad = Module._load;
const previousTs = Module._extensions['.ts'];
let context;
Module._load = function(request, parent, isMain) {
  if (request === 'vue') return { ...vue, inject: key => context[key], onMounted: fn => context.mount.push(fn), onBeforeUnmount: fn => context.unmount.push(fn) };
  return previousLoad.call(this, request, parent, isMain);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename);
async function main() {
  const base = path.resolve(__dirname, '../src/views/DSFGStudio/components/EntityPresetEditor');
  const { createEntityPreset, encodeEntityPresets: encode, decodeEntityPresets: decode } = require(path.join(base, 'entityPresets.ts'));
  const { useEntityPresets } = require(path.join(base, 'useEntityPresets.ts'));
  let count = 0;
  async function test(name, check) { await check(); count++; console.log(`PASS ${name}`); }
  await test('Preset settings contains the entity section and retains the existing editor route and save guard', () => {
    const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc');
    const filename = path.join(base, 'EntityPresetEditor.vue');
    const source = fs.readFileSync(filename, 'utf8');
    const { descriptor, errors } = parse(source, { filename });
    assert.deepEqual(errors, []);
    const script = compileScript(descriptor, { id: 'preset-settings' });
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: 'preset-settings', compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
    for (const style of descriptor.styles) assert.deepEqual(compileStyle({ source: style.content, filename, id: 'preset-settings', scoped: true }).errors, []);
    assert.match(source, /<h2>预设设置<\/h2>/);
    assert.match(source, /<section[^>]*aria-labelledby="entity-presets-title"/);
    assert.match(source, /<h3 id="entity-presets-title">预设实体<\/h3>/);
    assert.match(source, /prepareToLeave: flush/);
    const selector = fs.readFileSync(path.join(base, '../EditorKindSelect.vue'), 'utf8');
    assert.match(selector, /<option value="EntityPresets">预设设置<\/option>/);
    const preview = fs.readFileSync(path.join(base, '../DialogueEditor/DialogueTextPreview.vue'), 'utf8');
    assert.ok(preview.includes('编辑内容 → 预设设置 → 预设实体'));
  });
  await test('People have independent IDs; empty subtitle and same-name variants survive roundtrip', () => {
    const a = { ...createEntityPreset(), talker: 'A' };
    const b = { ...createEntityPreset(), talker: 'A', subtitle: '旅行者' };
    assert.notEqual(a.id, b.id);
    assert.deepEqual(decode(encode([a, b])), [a, b]);
    assert.equal(a.subtitle, '');
  });
  await test('Malformed or duplicate entries and unsupported files are rejected', () => {
    for (const data of [null, {}, { kind: 'Other', schemaVersion: 1, presets: [] },
      { kind: 'DSFGEntityPresets', schemaVersion: 1, presets: [{ id: 'a', talker: 'A' }] },
      { kind: 'DSFGEntityPresets', schemaVersion: 1, presets: [{ id: 'a', talker: 'A', subtitle: '' }, { id: 'a', talker: 'B', subtitle: '' }] }]) {
      assert.throws(() => decode(JSON.stringify(data)));
    }
  });
  await test('Entity aliases migrate old files and preserve explicit values without replacing Talker', () => {
    const old = { id: 'old', talker: '原说话人', subtitle: '' };
    assert.equal(decode(encode([old]))[0].name, '原说话人');
    const named = { ...old, name: '网页代号' };
    assert.deepEqual(decode(encode([named])), [named]);
    assert.equal(decode(encode([{ ...named, name: '' }]))[0].name, '');
    assert.throws(() => decode(encode([{ ...named, name: 123 }])));
    const { systemPresetConfig } = require(path.join(base, 'systemPresetConfig.ts'));
    assert.deepEqual(systemPresetConfig.entities.presets.find(item => item.id === 'system-player-self'), {
      id: 'system-player-self', name: '玩家自身', talker: '{1:ps.NICKNAME}', subtitle: '',
    });
  });
  const files = new Map();
  let fail = false;
  const storage = { setProject(id) { assert.equal(id, 'DSFGStudio'); return this; }, async exists(file) { return files.has(file); },
    async readFile(file) { return files.get(file); }, async writeFile(file, data) { if (fail) throw new Error('write failed'); files.set(file, data); } };
  async function mount(workspace) {
    context = { storage, selectedWorkspaceId: vue.ref(workspace), mount: [], unmount: [] };
    const instance = useEntityPresets();
    const hooks = context;
    await hooks.mount[0]();
    return { instance, hooks };
  }
  await test('Loading a new workspace does not create files; edits are saved to the captured workspace', async () => {
    const { instance, hooks } = await mount('workspace-A');
    assert.equal(instance.ready.value, true); assert.equal(files.size, 0);
    hooks.selectedWorkspaceId.value = 'workspace-B';
    instance.presets.value.push({ id: 'a', talker: 'A', subtitle: '' });
    await instance.flush();
    assert.equal(files.has('/workspace-B/EntityPresets.json'), false);
    assert.equal(decode(files.get('/workspace-A/EntityPresets.json'))[0].talker, 'A');
    hooks.unmount[0]();
  });
  await test('Switching away and reopening restores presets while other workspaces remain empty', async () => {
    const a = await mount('workspace-A'), b = await mount('workspace-B');
    assert.equal(a.instance.presets.value[0].talker, 'A');
    assert.deepEqual(b.instance.presets.value, []);
    a.hooks.unmount[0](); b.hooks.unmount[0]();
  });
  await test('A failed save blocks flush and retry saves the latest data', async () => {
    const { instance, hooks } = await mount('workspace-A');
    fail = true;
    instance.presets.value[0].subtitle = 'old';
    await assert.rejects(instance.flush());
    assert.ok(instance.error.value);
    instance.presets.value[0].subtitle = 'new';
    fail = false;
    await instance.retry();
    assert.equal(decode(files.get('/workspace-A/EntityPresets.json'))[0].subtitle, 'new');
    assert.equal(instance.error.value, '');
    hooks.unmount[0]();
  });
  await test('Corrupt persisted data stays untouched instead of being replaced by an empty list', async () => {
    files.set('/broken/EntityPresets.json', 'not-json');
    const { instance, hooks } = await mount('broken');
    assert.equal(instance.ready.value, false); assert.ok(instance.error.value);
    await instance.flush();
    assert.equal(files.get('/broken/EntityPresets.json'), 'not-json');
    hooks.unmount[0]();
  });
  console.log(`\n${count} DSFG entity preset checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = previousLoad;
  if (previousTs) Module._extensions['.ts'] = previousTs; else delete Module._extensions['.ts'];
});
