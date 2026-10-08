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
const definition = fileName => ({ fileName, defaults: () => [{ id: 'system', name: 'System' }],
  encode: presets => JSON.stringify({ presets }), decode: raw => JSON.parse(raw).presets });
const instances = [];
function storageFixture() {
  const files = new Map(), writes = [];
  let write = async (file, raw) => { files.set(file, raw); writes.push([file, raw]); };
  let read = async file => files.get(file);
  return { files, writes, storage: { setProject() { return this; }, async exists(file) { return files.has(file); },
    readFile(file) { return read(file); }, writeFile(file, raw) { return write(file, raw); } },
    set write(fn) { write = fn; }, set read(fn) { read = fn; } };
}
function instance(storage, workspace = 'A', fileName = 'TestPresets.json') {
  const ctx = { values: new Map([['storage', storage], ['selectedWorkspaceId', vue.ref(workspace)]]), mount: [], unmount: [] };
  const scope = vue.effectScope();
  context = ctx;
  const state = scope.run(() => useWorkspacePresets(definition(fileName)));
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
  console.log(`\n${passed} DSFG preset cache checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  instances.forEach(item => item.close()); Module._load = previousLoad;
  if (previousTs) Module._extensions['.ts'] = previousTs; else delete Module._extensions['.ts'];
});
