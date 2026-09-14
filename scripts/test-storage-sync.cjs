/* Run: node scripts/test-storage-sync.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const ts = require('typescript');
const original = Module._extensions['.ts'];
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const { compareStorage, executeSync, planSync } = require('../src/services/storage/storageSync.ts');
Module._extensions['.ts'] = original;
const hash = data => crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
class MemoryStorage {
  files = new Map(); folders = new Set(['/']); backups = []; writes = []; beforeWrite;
  constructor(files = {}) { for (const [name, data] of Object.entries(files)) this.seed(name, data); }
  seed(name, data) { this.mkdirSync(path.posix.dirname(name)); this.files.set(name, data); }
  mkdirSync(folder) { for (let p = folder; !this.folders.has(p); p = path.posix.dirname(p)) this.folders.add(p); }
  async mkdir(folder) { if (this.files.has(folder)) throw Error('file blocks folder'); this.mkdirSync(folder); }
  async exists(name) { return this.files.has(name) || this.folders.has(name); }
  async getFolders(parent) { return [...this.folders].filter(p => p !== parent && path.posix.dirname(p) === parent).map(p => path.posix.basename(p)); }
  async getFiles(parent) { return [...this.files.keys()].filter(p => path.posix.dirname(p) === parent).map(p => path.posix.basename(p)); }
  async readSnapshot(name) { const data = this.files.get(name); return data === undefined ? null : { data, revision: hash(data) }; }
  async writeFileIfUnchanged(name, data, expected) {
    await this.beforeWrite?.(name);
    const old = await this.readSnapshot(name);
    if ((old?.revision ?? null) !== expected) throw Error('version conflict');
    if (old) this.backups.push([name, old.data]);
    this.seed(name, data); this.writes.push(name);
  }
}

(async () => {
  let passed = 0;
  const test = async (name, run) => { await run(); console.log('PASS ' + name); passed++; };
  await test('Bidirectional merge copies unique files and empty folders; identical files are untouched', async () => {
    const a = new MemoryStorage({'/p/a.json':'A','/p/same.json':'same'}), b = new MemoryStorage({'/p/b.json':'B','/p/same.json':'same'});
    await a.mkdir('/p/empty');
    const plan = planSync(await compareStorage(a,b), 'both');
    const result = await executeSync(plan,a,b);
    assert.equal(result.error, undefined); assert.equal(result.completed,3);
    assert.deepEqual([...a.files].sort(), [...b.files].sort()); assert.ok(b.folders.has('/p/empty'));
    assert.ok(!a.writes.includes('/p/same.json') && !b.writes.includes('/p/same.json'));
  });
  await test('Both migration directions copy without deleting the target-only files', async () => {
    for (const direction of ['to-browser','to-desktop']) {
      const a = new MemoryStorage({'/p/a':'A'}), b = new MemoryStorage({'/p/b':'B'});
      await executeSync(planSync(await compareStorage(a,b),direction),a,b);
      assert.equal(a.files.size,direction==='to-browser'?2:1); assert.equal(b.files.size,direction==='to-desktop'?2:1);
    }
  });
  await test('Conflicts skip by default and require an explicit direction-compatible choice', async () => {
    const a = new MemoryStorage({'/p/a':'browser'}), b = new MemoryStorage({'/p/a':'desktop'});
    const rows = await compareStorage(a,b);
    assert.equal(planSync(rows,'both').length,0);
    rows.find(row=>row.status==='conflict').choice='desktop';
    assert.equal(planSync(rows,'to-desktop').length,0);
    const result = await executeSync(planSync(rows,'both'),a,b);
    assert.equal(result.completed,1); assert.equal(a.files.get('/p/a'),'desktop'); assert.deepEqual(a.backups,[['/p/a','browser']]);
  });
  await test('Source or target edits after preview stop copying without overwriting', async () => {
    for (const side of ['source','target']) {
      const a = new MemoryStorage({'/p/a':'A'}), b = new MemoryStorage();
      const actions=planSync(await compareStorage(a,b),'both').filter(action=>action.source.kind==='file');
      (side==='source'?a:b).seed('/p/a','new edit');
      const result=await executeSync(actions,a,b);
      assert.ok(result.error); assert.equal(result.completed,0); assert.equal(b.files.get('/p/a'),side==='target'?'new edit':undefined);
    }
  });
  await test('The destination version is checked again inside the write', async () => {
    const a=new MemoryStorage({'/p/a':'A'}),b=new MemoryStorage();
    const actions=planSync(await compareStorage(a,b),'both').filter(action=>action.source.kind==='file');
    b.beforeWrite=()=>b.seed('/p/a','racing writer');
    const result=await executeSync(actions,a,b); assert.ok(result.error); assert.equal(b.files.get('/p/a'),'racing writer');
  });
  await test('File/folder conflicts block their entire subtree', async () => {
    const a=new MemoryStorage({'/p/x':'file'}),b=new MemoryStorage({'/p/x/child':'child'});
    const rows=await compareStorage(a,b); assert.equal(rows.filter(row=>row.status==='blocked').length,2); assert.equal(planSync(rows,'both').length,0);
  });
  await test('Trash, sync backups and service internals are excluded', async () => {
    const a=new MemoryStorage({'/RecyleBin/id/a':'trash','/.ugc-sync-backups/id/a':'backup','/p/.ugc-hidden/a':'hidden','/p/.selection.json':'selection'}),b=new MemoryStorage();
    const rows=await compareStorage(a,b); assert.deepEqual(rows.map(row=>row.path),['/p','/p/.selection.json']);
  });
  await test('Windows-incompatible names and case aliases stop preview before any writes', async () => {
    for(const file of ['/p/CON.txt','/p/a:stream','/p/name.','/p/name?']) await assert.rejects(compareStorage(new MemoryStorage({[file]:'x'}),new MemoryStorage()),/Windows/);
    await assert.rejects(compareStorage(new MemoryStorage({'/p/A':'x'}),new MemoryStorage({'/p/a':'y'})),/大小写/);
  });
  await test('Cancelled scans make no writes; interrupted sync retains and reports completed items', async () => {
    const a=new MemoryStorage({'/p/a':'A','/p/b':'B'}),b=new MemoryStorage();
    const cancelled=new AbortController(); cancelled.abort(); await assert.rejects(compareStorage(a,b,undefined,cancelled.signal));
    const actions=planSync(await compareStorage(a,b),'both'), signal=new AbortController();
    const result=await executeSync(actions,a,b,()=>signal.abort(),signal.signal);
    assert.equal(result.cancelled,true); assert.equal(result.completed,1); assert.equal(b.writes.length,0);
  });
  await test('Failure midway reports progress and a new comparison resumes only missing items', async () => {
    const a=new MemoryStorage({'/p/a':'A','/p/b':'B'}),b=new MemoryStorage();
    b.beforeWrite=name=>{ if(name==='/p/b')throw Error('disk disconnected'); };
    const result=await executeSync(planSync(await compareStorage(a,b),'both'),a,b);
    assert.equal(result.completed,2); assert.equal(result.failedPath,'/p/b');
    b.beforeWrite=undefined;
    const remaining=planSync(await compareStorage(a,b),'both'); assert.deepEqual(remaining.map(action=>action.path),['/p/b']);
    assert.equal((await executeSync(remaining,a,b)).completed,1);
  });
  console.log(`\n${passed} storage sync tests passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
