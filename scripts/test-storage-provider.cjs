/* Run: node scripts/test-storage-provider.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function create(mode) {
  let browserInstances = 0;
  class FakeProvider {
    storageName = 'test';
    calls = [];
    callback;
    failure;
    async init() {}
    onChange(callback) { this.callback = callback; }
    async writeFile(...args) { this.calls.push(args); if (this.failure) throw this.failure; }
  }
  class Browser extends FakeProvider { constructor() { super(); browserInstances++; } }
  class Desktop extends FakeProvider {}
  const filename = path.resolve(__dirname, '../src/services/storage/storage.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, console, crypto: globalThis.crypto, require: name => {
    if (name === './browserStorage') return { BrowserStorage: Browser };
    if (name === './desktopStorage') return { DesktopStorage: Desktop, readStorageSettings: () => ({ mode }) };
    if (name === 'consola') return { consola: { info() {}, trace() {} } };
    throw new Error(`Unexpected import ${name}`);
  } });
  return { storage: exports.StorageClass.getInstance(), count: () => browserInstances, Desktop, Browser };
}

(async () => {
  const desktop = create('desktop');
  await desktop.storage.init();
  assert.ok(desktop.storage.provider instanceof desktop.Desktop);
  assert.equal(desktop.count(), 0);
  console.log('PASS Explicit desktop selection never initializes browser storage');
  const failure = new Error('disk unavailable');
  desktop.storage.provider.failure = failure;
  await assert.rejects(desktop.storage.setProject('first').writeFile('/file.json', 'data'), error => error === failure);
  assert.deepEqual(desktop.storage.provider.calls, [['/first/file.json', 'data']]);
  assert.equal(desktop.count(), 0);
  console.log('PASS Failed writes propagate once without retry or fallback');
  let notifications = 0;
  const remove = desktop.storage.onChange(() => { notifications++; });
  desktop.storage.provider.callback({ type: 'tree-changed', fileId: '/first/file.json' });
  remove();
  desktop.storage.provider.callback({ type: 'tree-changed', fileId: '/first/file.json' });
  assert.equal(notifications, 1);
  console.log('PASS Initial provider forwards changes and supports unsubscribing');
  const browser = create('browser');
  await browser.storage.init();
  const pending = browser.storage.setProject('one').writeFile('/a.json', 'one');
  browser.storage.setProject('two');
  await pending;
  assert.deepEqual(browser.storage.provider.calls, [['/one/a.json', 'one']]);
  assert.equal(browser.count(), 1);
  console.log('PASS Browser mode preserves the namespace captured by each operation');
  let finishWrite;
  browser.storage.provider.writeFile = () => new Promise(resolve => { finishWrite = resolve; });
  const inFlight = browser.storage.writeFile('/pending', 'pending');
  let paused = false;
  const pausing = browser.storage.pauseForSync().then(resume => { paused = true; return resume; });
  await assert.rejects(browser.storage.writeFile('/blocked', 'blocked'), /同步/);
  assert.equal(paused, false);
  finishWrite(); await inFlight;
  const resume = await pausing;
  assert.equal(paused, true);
  await assert.rejects(browser.storage.writeFile('/blocked', 'blocked'), /同步/);
  resume(); browser.storage.provider.writeFile = async () => {};
  await browser.storage.writeFile('/after', 'after');
  console.log('PASS Sync pause drains in-flight saves and blocks stale editor operations');
})().catch(error => { console.error(error); process.exitCode = 1; });
