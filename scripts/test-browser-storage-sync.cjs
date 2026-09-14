/* Exercises the real BrowserStorage on ZenFS's in-memory backend. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
(async () => {
  const core = await import('@zenfs/core');
  let initializations = 0;
  const exports = {};
  const file = path.resolve(__dirname, '../src/services/storage/browserStorage.ts');
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: file,
  }).outputText, { exports, crypto: globalThis.crypto, TextEncoder, Uint8Array, console, require: name => {
    if (name === '@zenfs/core') return { ...core, configureSingle: async () => { initializations++; await core.configureSingle({ backend: core.InMemory }); } };
    if (name === '@zenfs/dom') return { IndexedDB: {} };
    if (name === 'path') return path.posix;
    throw Error('Unexpected import ' + name);
  } });
  const a = new exports.BrowserStorage(), b = new exports.BrowserStorage();
  await Promise.all([a.init(), b.init()]); assert.equal(initializations, 1);
  console.log('PASS Browser sync reuses the existing ZenFS mount');
  await a.writeFile('/p/中文.json', '旧版本 🌙');
  const snapshot = await b.readSnapshot('/p/中文.json');
  await b.writeFileIfUnchanged('/p/中文.json', '新版本', snapshot.revision);
  assert.equal(await a.readFile('/p/中文.json'), '新版本');
  const backups = await a.getFolders('/.ugc-sync-backups');
  assert.equal(backups.length, 1);
  assert.equal(await a.readFile(`/.ugc-sync-backups/${backups[0]}/p/中文.json`), '旧版本 🌙');
  console.log('PASS Conditional browser writes preserve a readable backup');
  await assert.rejects(a.writeFileIfUnchanged('/p/中文.json', 'stale', snapshot.revision), /变化/);
  assert.equal(await b.readFile('/p/中文.json'), '新版本');
  await b.writeFileIfUnchanged('/p/new.json', 'created', null);
  await assert.rejects(a.writeFileIfUnchanged('/p/new.json', 'overwrite', null), /变化/);
  console.log('PASS Stale preview and create-only writes cannot overwrite newer browser data');
  const current = await a.readSnapshot('/p/中文.json');
  const results = await Promise.allSettled([
    a.writeFileIfUnchanged('/p/中文.json', 'first', current.revision),
    b.writeFileIfUnchanged('/p/中文.json', 'second', current.revision),
  ]);
  assert.deepEqual(results.map(item=>item.status), ['fulfilled','rejected']);
  console.log('PASS Concurrent conditional writes serialize across provider instances');
  await a.mv('/p/new.json', '/RecyleBin/test');
  await a.mv('/RecyleBin/test/new.json', '/p');
  await a.rename('/p/new.json','renamed.json');
  assert.equal(await b.readFile('/p/renamed.json'),'created');
  console.log('PASS Browser rename, trash and restore still work with awaited writes');
})().catch(error=>{ console.error(error); process.exitCode=1; });
