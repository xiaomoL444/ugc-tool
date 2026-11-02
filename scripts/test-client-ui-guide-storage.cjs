// node scripts/test-client-ui-guide-storage.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const previous = Module._extensions['.ts'];
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);

const { hasDismissedEditorGuide, dismissEditorGuide, EDITOR_GUIDE_STATE_PATH } = require('../src/views/ClientUIAnimationEditor/editorGuideStorage.ts');

class MemoryStorage {
  project = 'OtherTool';
  files = new Map();
  afterExists = () => {};
  failWrite = false;
  failRead = false;
  setProject(project) { this.project = project; return this; }
  async exists(path) {
    const exists = this.files.has(`/${this.project}${path}`);
    await this.afterExists();
    return exists;
  }
  async readFile(path) {
    if (this.failRead) throw new Error('read failed');
    return this.files.get(`/${this.project}${path}`);
  }
  async writeFile(path, text) {
    if (this.failWrite) throw new Error('write failed');
    this.files.set(`/${this.project}${path}`, text);
  }
}

(async () => {
  try {
    const storage = new MemoryStorage();
    const path = `/ClientUIAnimationEditor${EDITOR_GUIDE_STATE_PATH}`;
    assert.equal(await hasDismissedEditorGuide(storage), false, 'New storage shows the welcome guide');
    assert.equal(storage.files.size, 0, 'Reading first-use status does not mark the guide dismissed');
    await dismissEditorGuide(storage);
    assert.equal(storage.files.size, 1, 'Only the tool-level preference is written');
    assert.equal(await hasDismissedEditorGuide(storage), true, 'Dismissal persists beyond the dialog instance');

    storage.afterExists = async () => { storage.setProject('AnotherTool'); };
    assert.equal(await hasDismissedEditorGuide(storage), true, 'Resets shared namespace after an asynchronous read');
    storage.setProject('AnotherTool');
    await dismissEditorGuide(storage);
    assert.equal(storage.files.size, 1, 'Saving after a tool switch does not write into the other tool');

    for (const text of ['invalid json', 'null', '{}', '{"version":1,"dismissed":false}', '{"version":2,"dismissed":true}']) {
      storage.files.set(path, text);
      assert.equal(await hasDismissedEditorGuide(storage), false, 'Incomplete or invalid state allows onboarding');
    }
    storage.failRead = true;
    await assert.rejects(hasDismissedEditorGuide(storage), /read failed/, 'Unavailable storage is distinct from a saved dismissal');
    storage.failRead = false;
    storage.failWrite = true;
    await assert.rejects(dismissEditorGuide(storage), /write failed/, 'Save failures reach the UI warning handler');
    storage.failWrite = false;
    await dismissEditorGuide(storage);
    assert.equal(await hasDismissedEditorGuide(storage), true, 'Storage remains usable after a failed save');
    console.log('PASS: first-use persistence, corrupt state, storage errors, recovery and cross-tool namespace isolation.');
  } finally { Module._extensions['.ts'] = previous; }
})().catch(error => { console.error(error); process.exitCode = 1; });
