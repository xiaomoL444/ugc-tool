const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const previous = Module._extensions['.ts'];
Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, file);
const { fitMissingPrimitiveResources } = require('../src/views/ClientUIAnimationEditor/primitiveBatch.ts');
const fitData = { version: 1, width: 1, height: 1, elements: [{}] };
const asset = (id, extra = {}) => ({ id, name: id, imageUrl: id, ...extra });
async function main() {
  let assets = [asset('existing', { fitData }), asset('empty', { imageUrl: '' }), asset('a'), asset('bad'), asset('b', { fitOptions: { count: 42, resolution: 64, workers: 1 } })];
  const calls = [], saves = [], progress = [];
  let running = 0;
  const save = async value => { saves.push(value.id); assets = assets.map(a => a.id === value.id ? value : a); };
  const result = await fitMissingPrimitiveResources(() => assets, async (source, options, signal, report) => {
    assert.equal(running++, 0, 'fits must run sequentially');
    calls.push(source);
    try {
      await new Promise(resolve => setTimeout(resolve, 1));
      report({ phase: 'fit', done: 1, total: options.count });
      if (source === 'bad') throw new Error('unreadable');
      if (source === 'b') assert.equal(options.count, 42, 'use each resource settings');
      return fitData;
    } finally { running--; }
  }, save, new AbortController().signal, value => progress.push(value));
  assert.deepEqual(calls, ['a', 'bad', 'b']);
  assert.deepEqual(saves, ['a', 'b']);
  assert.equal(result.generated, 2);
  assert.deepEqual(result.failures, [{ name: 'bad', message: 'unreadable' }]);
  assert.equal(progress.at(-1).total, 3);
  calls.length = 0;
  await fitMissingPrimitiveResources(() => assets, async source => { calls.push(source); return fitData; }, save, new AbortController().signal, () => {});
  assert.deepEqual(calls, ['bad'], 'retry only missing results');

  assets = [asset('done'), asset('cancel'), asset('later')]; saves.length = 0;
  const job = new AbortController();
  const cancelled = await fitMissingPrimitiveResources(() => assets, async source => {
    if (source === 'cancel') job.abort();
    return fitData;
  }, save, job.signal, () => {});
  assert.deepEqual(saves, ['done'], 'keep completed fits and reject late completion after cancellation');
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.generated, 1);

  assets = [asset('changed'), asset('deleted'), asset('already-fit'), asset('settings')]; saves.length = 0;
  const stale = await fitMissingPrimitiveResources(() => assets, async source => {
    if (source === 'changed') assets[0].imageUrl = 'replacement';
    if (source === 'deleted') assets = assets.filter(a => a.id !== source);
    if (source === 'already-fit') assets.find(a => a.id === source).fitData = fitData;
    if (source === 'settings') assets.find(a => a.id === source).fitOptions = { count: 10 };
    return fitData;
  }, save, new AbortController().signal, () => {});
  assert.equal(stale.skipped, 4);
  assert.deepEqual(saves, [], 'stale fits must not overwrite edits or restore deleted resources');
  console.log('PASS batch ordering, settings, skip existing, failure isolation, retry, cancellation and stale result protection');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Module._extensions['.ts'] = previous; });
