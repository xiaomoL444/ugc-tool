/* Run: node scripts/test-dsfg-preset-cache.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const previousLoad = Module._load, previousTs = Module._extensions['.ts'];
let context;
Module._load = function(name, parent, main) {
  if (name === 'vue') return { ...vue,
    inject: (key, fallback) => context.values.has(key) ? context.values.get(key) : fallback,
    onMounted: fn => context.mount.push(fn), onBeforeUnmount: fn => context.unmount.push(fn) };
  return previousLoad.call(this, name, parent, main);
};
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, fileName: file,
}).outputText, file);
const { useWorkspacePresets } = require('../src/views/DSFGStudio/components/EntityPresetEditor/useWorkspacePresets.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const definition = (fileName, editableDefaults = false) => ({ fileName, editableDefaults, fixedFields: ['name'],
  defaults: () => [{ id: 'system', name: 'System', ...(editableDefaults ? { value: 'Default' } : {}) }],
  encode: presets => JSON.stringify({ presets }), decode: raw => {
    const presets = JSON.parse(raw).presets;
    if (!Array.isArray(presets)) throw Error('Missing presets');
    if (editableDefaults && presets.some(item => !item || typeof item.id !== 'string'
      || typeof item.name !== 'string' || typeof item.value !== 'string')) throw Error('Invalid preset');
    return presets;
  } });
const instances = [];
function storageFixture() {
  const files = new Map(), writes = [];
  let write = async (file, raw) => { files.set(file, raw); writes.push([file, raw]); };
  let read = async file => files.get(file);
  return { files, writes, storage: { setProject() { return this; }, async exists(file) { return files.has(file); },
    readFile(file) { return read(file); }, writeFile(file, raw) { return write(file, raw); } },
    set write(fn) { write = fn; }, set read(fn) { read = fn; } };
}
function instance(storage, workspace = 'A', fileName = 'TestPresets.json', editableDefaults = false) {
  const ctx = { values: new Map([['storage', storage], ['selectedWorkspaceId', vue.ref(workspace)]]), mount: [], unmount: [] };
  const scope = vue.effectScope();
  context = ctx;
  const state = scope.run(() => useWorkspacePresets(definition(fileName, editableDefaults)));
  let closed = false;
  const result = { state, mount: () => Promise.all(ctx.mount.map(fn => fn())),
    close() { if (closed) return; closed = true; ctx.unmount.forEach(fn => fn()); scope.stop(); } };
  instances.push(result); return result;
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function main() {
  let passed = 0;
  async function test(name, check) { await check(); passed++; console.log('PASS ' + name); }
  await test('Successful saves refresh mounted consumers without another write or workspace/category leakage', async () => {
    const f = storageFixture(), writer = instance(f.storage), reader = instance(f.storage), otherWorkspace = instance(f.storage, 'B'), otherFile = instance(f.storage, 'A', 'Other.json');
    await Promise.all([writer.mount(), reader.mount(), otherWorkspace.mount(), otherFile.mount()]);
    let readyChanges = 0; const stop = vue.watch(reader.state.ready, () => readyChanges++, { flush: 'sync' });
    writer.state.presets.value.push({ id: 'custom', name: 'Updated' }); await writer.state.flush();
    assert.deepEqual(plain(reader.state.presets.value), [{ id: 'custom', name: 'Updated' }]);
    assert.deepEqual(plain(reader.state.availablePresets.value), [{ id: 'system', name: 'System' }, { id: 'custom', name: 'Updated' }]);
    assert.equal(readyChanges, 0, 'Cached refresh does not reset ready or preset history');
    assert.deepEqual(plain(otherWorkspace.state.presets.value), []); assert.deepEqual(plain(otherFile.state.presets.value), []);
    assert.equal(f.writes.length, 1, 'Receiving a save never schedules another save'); stop();
  });
  await test('Failed saves keep consumer data unchanged; retry publishes only the successful result', async () => {
    const f = storageFixture(), writer = instance(f.storage), reader = instance(f.storage);
    await Promise.all([writer.mount(), reader.mount()]);
    f.write = async () => { throw Error('offline'); };
    writer.state.presets.value.push({ id: 'custom', name: 'Retry' }); await assert.rejects(writer.state.flush(), /offline/);
    assert.deepEqual(plain(reader.state.presets.value), []);
    f.write = async (file, raw) => { f.files.set(file, raw); f.writes.push([file, raw]); };
    await writer.state.retry(); assert.equal(reader.state.presets.value[0].name, 'Retry'); assert.equal(f.writes.length, 1);
  });
  await test('Dirty drafts and in-flight local saves are never overwritten by another editor', async () => {
    const f = storageFixture(), writer = instance(f.storage), reader = instance(f.storage);
    await Promise.all([writer.mount(), reader.mount()]);
    reader.state.presets.value.push({ id: 'local', name: 'Local draft' });
    writer.state.presets.value.push({ id: 'remote', name: 'Remote saved' }); await writer.state.flush();
    assert.equal(reader.state.presets.value[0].name, 'Local draft');
    const gate = deferred(), entered = deferred();
    f.write = async (file, raw) => {
      if (JSON.parse(raw).presets[0]?.name === 'Local draft') { entered.resolve(); await gate.promise; }
      f.files.set(file, raw); f.writes.push([file, raw]);
    };
    const saving = reader.state.flush(); await entered.promise;
    writer.state.presets.value[0].name = 'Another remote save'; await writer.state.flush();
    assert.equal(reader.state.presets.value[0].name, 'Local draft');
    gate.resolve(); await saving; assert.equal(writer.state.presets.value[0].name, 'Local draft');
  });
  await test('A late initial disk read cannot replace the newest saved preset snapshot or later edits', async () => {
    const f = storageFixture(); f.files.set('/A/TestPresets.json', JSON.stringify({ presetStorage: 'custom-only', presets: [{ id: 'old', name: 'Old' }] }));
    const writer = instance(f.storage); await writer.mount();
    const gate = deferred(), entered = deferred(), oldRaw = f.files.get('/A/TestPresets.json');
    f.read = async () => { entered.resolve(); return gate.promise; };
    const reader = instance(f.storage), loading = reader.mount(); await entered.promise;
    writer.state.presets.value[0].name = 'New'; await writer.state.flush(); assert.equal(reader.state.presets.value[0].name, 'New');
    reader.state.presets.value[0].name = 'New local draft'; gate.resolve(oldRaw); await loading;
    assert.equal(reader.state.presets.value[0].name, 'New local draft'); await reader.state.flush();
    assert.equal(writer.state.presets.value[0].name, 'New local draft');
  });
  await test('Unmounted consumers stop receiving snapshots', async () => {
    const f = storageFixture(), writer = instance(f.storage), reader = instance(f.storage);
    await Promise.all([writer.mount(), reader.mount()]); reader.close();
    writer.state.presets.value.push({ id: 'new', name: 'Saved after close' }); await writer.state.flush();
    assert.deepEqual(plain(reader.state.presets.value), []);
  });
  await test('System value overrides save separately and refresh consumers without duplicating system rows', async () => {
    const f = storageFixture(), writer = instance(f.storage, 'A', 'TestPresets.json', true), reader = instance(f.storage, 'A', 'TestPresets.json', true);
    const other = instance(f.storage, 'B', 'TestPresets.json', true);
    await Promise.all([writer.mount(), reader.mount(), other.mount()]);
    const seed = { id: 'system', name: 'System', value: 'Default' };
    assert.deepEqual(plain(writer.state.presets.value), [seed]);
    assert.deepEqual(plain(writer.state.availablePresets.value), plain(writer.state.presets.value));
    assert.equal(f.writes.length, 0, 'Reading defaults does not create a workspace file');
    writer.state.systemPresets.value[0].value = 'Edited default';
    assert.equal(writer.state.defaultPresets.value[0].value, 'Default', 'System overrides never mutate default seeds');
    await writer.state.flush();
    const saved = JSON.parse(f.files.get('/A/TestPresets.json'));
    assert.equal(saved.presetStorage, 'system-overrides'); assert.deepEqual(saved.presets, []);
    assert.deepEqual(saved.systemOverrides, [{ ...seed, value: 'Edited default' }]);
    assert.deepEqual(plain(reader.state.systemPresets.value), [{ ...seed, value: 'Edited default' }]);
    assert.deepEqual(plain(other.state.systemPresets.value), [seed]);
    assert.equal(f.writes.length, 1, 'A received complete snapshot does not trigger another save');
    const reopened = instance(f.storage, 'A', 'TestPresets.json', true); await reopened.mount();
    assert.deepEqual(plain(reopened.state.availablePresets.value), [{ ...seed, value: 'Edited default' }]);
  });
  await test('Legacy custom-only files merge defaults and preserve custom snapshots and referenced IDs', async () => {
    const f = storageFixture(), filename = '/A/TestPresets.json';
    const seed = { id: 'system', name: 'System', value: 'Default' };
    const custom = { id: 'custom', name: 'User entry', value: 'Custom' }, edited = { id: 'custom:system', name: 'Edited snapshot', value: 'Snapshot' };
    const copy = { id: 'custom:system:copy', name: 'Another snapshot', value: 'Copy' };
    f.files.set(filename, JSON.stringify({ presetStorage: 'custom-only', presets: [custom] }));
    const withDefault = instance(f.storage, 'A', 'TestPresets.json', true); await withDefault.mount();
    assert.deepEqual(plain(withDefault.state.presets.value), [seed, custom]); withDefault.close();
    f.files.set(filename, JSON.stringify({ presetStorage: 'custom-only', presets: [custom, edited, copy] }));
    const withSnapshot = instance(f.storage, 'A', 'TestPresets.json', true); await withSnapshot.mount();
    assert.deepEqual(plain(withSnapshot.state.systemPresets.value), [seed]);
    assert.deepEqual(plain(withSnapshot.state.customPresets.value), [custom, edited, copy]);
    withSnapshot.state.customPresets.value[1].name = 'Keep edited snapshot'; await withSnapshot.state.flush(); withSnapshot.close();
    const reopened = instance(f.storage, 'A', 'TestPresets.json', true); await reopened.mount();
    assert.equal(reopened.state.customPresets.value[1].id, 'custom:system', 'Existing clip preset references retain their target ID');
    assert.equal(reopened.state.customPresets.value[1].name, 'Keep edited snapshot');
    assert.deepEqual(plain(reopened.state.customPresets.value).filter(item => item.id !== 'custom:system'), [custom, copy]); reopened.close();
    f.files.set(filename, JSON.stringify({ presets: [{ ...seed, name: 'Legacy edited code', value: 'Legacy override' }, custom] }));
    const mixed = instance(f.storage, 'A', 'TestPresets.json', true); await mixed.mount();
    assert.deepEqual(plain(mixed.state.presets.value), [{ ...seed, value: 'Legacy override' }, custom]);
  });
  await test('Custom list removal preserves system overrides and system identities cannot be changed or deleted', async () => {
    const f = storageFixture(), writer = instance(f.storage, 'A', 'TestPresets.json', true), reader = instance(f.storage, 'A', 'TestPresets.json', true);
    await Promise.all([writer.mount(), reader.mount()]);
    writer.state.systemPresets.value[0].value = 'Retained override';
    writer.state.systemPresets.value[0].name = 'Changed code'; writer.state.systemPresets.value[0].id = 'Changed ID';
    assert.equal(writer.state.systemPresets.value[0].name, 'System'); assert.equal(writer.state.systemPresets.value[0].id, 'system');
    writer.state.customPresets.value = [{ id: 'custom', name: 'Retained', value: 'Custom' }];
    writer.state.presets.value.splice(0, 1);
    await writer.state.flush();
    assert.deepEqual(plain(reader.state.systemPresets.value), [{ id: 'system', name: 'System', value: 'Retained override' }]);
    assert.equal(reader.state.customPresets.value[0].name, 'Retained');
    const partial = instance(f.storage, 'A', 'TestPresets.json', true); await partial.mount();
    assert.equal(partial.state.systemPresets.value[0].value, 'Retained override');
    writer.state.customPresets.value = []; await writer.state.flush();
    assert.deepEqual(plain(reader.state.customPresets.value), []);
    const empty = instance(f.storage, 'A', 'TestPresets.json', true); await empty.mount();
    assert.deepEqual(plain(empty.state.customPresets.value), []);
    assert.deepEqual(plain(empty.state.systemPresets.value), [{ id: 'system', name: 'System', value: 'Retained override' }]);
    const stored = JSON.parse(f.files.get('/A/TestPresets.json')); assert.deepEqual(stored.presets, []); assert.equal(stored.systemOverrides.length, 1);
  });
  await test('Editable default save failures preserve remote values and retry the latest workspace edits', async () => {
    const f = storageFixture(), writer = instance(f.storage, 'A', 'TestPresets.json', true), reader = instance(f.storage, 'A', 'TestPresets.json', true);
    await Promise.all([writer.mount(), reader.mount()]);
    f.write = async () => { throw Error('offline'); };
    writer.state.systemPresets.value[0].value = 'Failed'; await assert.rejects(writer.state.flush(), /offline/);
    assert.equal(reader.state.systemPresets.value[0].value, 'Default');
    writer.state.systemPresets.value[0].value = 'Latest edit';
    f.write = async (file, raw) => { f.files.set(file, raw); f.writes.push([file, raw]); };
    await writer.state.retry(); assert.equal(reader.state.systemPresets.value[0].value, 'Latest edit');
    reader.state.systemPresets.value[0].value = 'Local draft'; writer.state.systemPresets.value[0].value = 'Remote edit'; await writer.state.flush();
    assert.equal(reader.state.systemPresets.value[0].value, 'Local draft', 'Dirty system overrides are not replaced by broadcasts');
    await reader.state.flush();
  });
  await test('Corrupt editable preset files are retained without writes or injected defaults', async () => {
    const f = storageFixture(); f.files.set('/A/TestPresets.json', 'broken');
    const broken = instance(f.storage, 'A', 'TestPresets.json', true); await broken.mount();
    assert.equal(broken.state.ready.value, false); assert.ok(broken.state.error.value);
    await broken.state.flush(); assert.equal(f.files.get('/A/TestPresets.json'), 'broken'); assert.equal(f.writes.length, 0);
  });
  await test('Old complete workspace files restore missing systems while preserving legal value overrides and custom entries', async () => {
    const f = storageFixture(), filename = '/A/TestPresets.json';
    for (const presets of [[], [{ id: 'system', name: 'Edited old code', value: 'Old override' }, { id: 'custom', name: 'Custom code', value: 'User value' }]]) {
      f.files.set(filename, JSON.stringify({ presetStorage: 'workspace', presets }));
      const current = instance(f.storage, 'A', 'TestPresets.json', true); await current.mount();
      assert.equal(current.state.systemPresets.value[0].name, 'System');
      assert.equal(current.state.systemPresets.value[0].value, presets.length ? 'Old override' : 'Default');
      assert.deepEqual(plain(current.state.customPresets.value), presets.filter(item => item.id !== 'system'));
      current.close();
    }
  });
  await test('Malformed system overrides reject the complete file and retain the original bytes', async () => {
    for (const systemOverrides of [null, [{ id: 'unknown', name: 'Unknown', value: 'Bad' }],
      [{ id: 'system', name: 'System', value: 123 }], [{ id: 'system', value: 'A' }, { id: 'system', value: 'B' }]]) {
      const f = storageFixture(), raw = JSON.stringify({ presetStorage: 'system-overrides', presets: [], systemOverrides });
      f.files.set('/A/TestPresets.json', raw);
      const current = instance(f.storage, 'A', 'TestPresets.json', true); await current.mount();
      assert.equal(current.state.ready.value, false); assert.ok(current.state.error.value); await current.state.flush();
      assert.equal(f.files.get('/A/TestPresets.json'), raw); assert.equal(f.writes.length, 0); current.close();
    }
  });
  console.log(`\n${passed} DSFG preset cache checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  instances.forEach(item => item.close()); Module._load = previousLoad;
  if (previousTs) Module._extensions['.ts'] = previousTs; else delete Module._extensions['.ts'];
});
