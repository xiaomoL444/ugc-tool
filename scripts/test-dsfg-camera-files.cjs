/* Run with: node scripts/test-dsfg-camera-files.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const root = path.resolve(__dirname, '..');
const base = path.join(root, 'src/views/DSFGStudio/components');
const plain = value => JSON.parse(JSON.stringify(value));

async function main() {
  const library = await import('miliastra-variable');
  const originalLoad = Module._load, originalTs = Module._extensions['.ts'];
  const originalWindow = global.window, originalDocument = global.document, originalConfirm = global.confirm;
  let hooks;
  Module._load = function(name, parent, isMain) {
    if (name === 'miliastra-variable') return library;
    if (name === 'vue') return { ...vue, inject: key => key === 'storage' ? hooks.storage : key === 'selectedWorkspaceId' ? hooks.workspace : hooks.isActive,
      onMounted: fn => hooks.mount.push(fn), onBeforeUnmount: fn => hooks.unmount.push(fn) };
    return originalLoad.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, isMain);
  };
  Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
  const sessions = [];
  try {
    const model = require(path.join(base, 'CameraEditor/cameraProject.ts'));
    const { useCameraFiles } = require(path.join(base, 'CameraEditor/useCameraFiles.ts'));
    const dm = require(path.join(base, 'DialogueEditor/utils/dialogueProject.ts'));
    const exports = require(path.join(base, 'DialogueEditor/utils/qxqyPerformanceExporter.ts'));
    const structs = require(path.join(base, 'DialogueEditor/utils/qxqyStructWorkspace.ts'));
    let passed = 0;
    async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
    function target() {
      const listeners = new Map();
      return { listeners, addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type), visibilityState: 'visible' };
    }
    function session(data = [], workspace = 'original') {
      const files = new Map(data), directories = new Set(), writes = [], trashed = [];
      const storage = {
        setProject() { return this; },
        async exists(file) { return files.has(file) || directories.has(file) || [...files.keys()].some(key => key.startsWith(file + '/')); },
        async mkdir(dir) { directories.add(dir); },
        async getFiles(dir) { return [...files.keys()].filter(key => key.startsWith(dir + '/')).map(key => key.slice(dir.length + 1)); },
        async readFile(file) { if (!files.has(file)) throw new Error('missing'); return files.get(file); },
        async writeFile(file, data) { writes.push([file, data]); files.set(file, data); },
        async trash(file) { trashed.push(file); files.delete(file); },
      };
      const current = { storage, workspace: vue.ref(workspace), active: vue.ref(true), mount: [], unmount: [] };
      current.isActive = () => current.active.value;
      hooks = current;
      const win = target(), doc = target();
      global.window = win; global.document = doc;
      const scope = vue.effectScope();
      const api = scope.run(useCameraFiles);
      const result = { ...api, storage, data: files, writes, trashed, directories, workspace: current.workspace, active: current.active, win, doc, confirmReply: true,
        mount() { global.window = win; global.document = doc; current.mount.forEach(fn => fn()); },
        unmount() { current.unmount.forEach(fn => fn()); scope.stop(); },
      };
      global.confirm = () => result.confirmReply;
      sessions.push(result); return result;
    }
    const doc = (name, duration) => { const p = model.createCameraProject(name); p.clip.duration = duration; return model.encodeCameraProject(p); };
    const aPath = '/original/CameraEditor/a.json', bPath = '/original/CameraEditor/b.json';
    const open = async () => { const h = session([[aPath, doc('A', 2)], [bPath, doc('B', 4)]]); await h.selectFile('a.json'); return h; };

    await test('Camera files have independent identities and preserve position, viewpoint and extension drafts', () => {
      const a = model.createCameraProject('A'), b = model.createCameraProject('B');
      assert.notEqual(a.clip.id, b.clip.id); assert.notEqual(a.clip.components[0].id, b.clip.components[0].id);
      a.clip.duration = 3.5;
      a.clip.components[0].properties.positionData.slot[0].vector3 = '1,2,3';
      a.clip.components[0].properties.rotationData.slot[0].vector3 = '10,20,30';
      a.clip.components[0].properties.futureProperty = { draft: '保留' };
      const restored = model.decodeCameraProject(model.encodeCameraProject(a));
      assert.deepEqual(restored, a); assert.notDeepEqual(restored, b);
      assert.equal(restored.clip.components[0].cameraViewpointEnabled, false);
      assert.equal(model.cameraFileName(' A.JSON '), 'A.json');
      for (const name of ['', '.', '..', '../A', 'A/B', 'A\\B', 'A:bad']) assert.throws(() => model.cameraFileName(name));
    });
    await test('Wrong document types and corrupt or duplicate components fail without manufacturing a blank camera', () => {
      for (const invalid of ['{', '{}', JSON.stringify({ kind: 'DSFGCameraProject', schemaVersion: 2 })]) assert.throws(() => model.decodeCameraProject(invalid));
      const p = model.createCameraProject(); p.clip.components.push(plain(p.clip.components[0]));
      assert.throws(() => model.decodeCameraProject(model.encodeCameraProject(p)), /参数不完整/);
    });
    await test('Standalone export matches dialogue CameraClip export, remaps nested IDs and leaves the draft unchanged', () => {
      const p = model.createCameraProject('Standalone'); p.clip.duration = 3.5;
      p.clip.components[0].properties.positionData.slot[0].vector3 = '1,2,3';
      const ids = Object.fromEntries(Object.keys(structs.createDefaultQxqyStructIds()).map((key, i) => [key, String(73000 + i)]));
      const before = model.encodeCameraProject(p);
      const result = exports.exportQxqyCameraClip(p.clip, ids);
      assert.equal(result.value.structId, ids.camera);
      const parsed = structs.createQxqyStructWorkspace(ids).parse(JSON.parse(result.json));
      assert.deepEqual(parsed.issues, []);
      assert.equal(parsed.value.duration.value, '3.50');
      assert.equal(parsed.value.positionData.structId, ids.cameraPosition);
      assert.equal(parsed.value.positionData.value.slot.value[0].structId, ids.cameraSlot);
      assert.equal(parsed.value.rotationData.value.slot.itemCount, 0);
      const dialogue = dm.createEmptyDialogueProject(), group = dm.createDialogueNode('camera');
      dialogue.exportSettings.qxqyStructIds = ids; group.dialogue = undefined; group.lines[0].clips.push(p.clip); dialogue.dialogue.nodes.camera = group;
      const full = structs.createQxqyStructWorkspace(ids).parse(JSON.parse(exports.exportQxqyPerformance(dialogue).json));
      const embedded = full.value.CameraMovementData.value[0].value.value[0];
      assert.deepEqual(result.value, embedded.toQxqyValue());
      assert.equal(model.encodeCameraProject(p), before);
    });
    await test('A missing camera directory is empty; create opens an independent camera and retains existing files', async () => {
      const h = session(); await h.refreshFiles(); assert.deepEqual(plain(h.files.value), []);
      h.newName.value = 'a'; h.creating.value = true; await h.createFile();
      assert.equal(h.selectedFile.value, 'a.json'); assert.equal(h.creating.value, false);
      assert.ok(h.data.has(aPath)); assert.ok(h.directories.has('/original/CameraEditor'));
      const first = h.project.value.clip.id;
      h.newName.value = 'b.json'; await h.createFile();
      assert.notEqual(h.project.value.clip.id, first); assert.deepEqual(plain(h.files.value), ['a.json', 'b.json']);
      h.creating.value = true; h.newName.value = 'a'; const saved = h.data.get(aPath); await h.createFile();
      assert.equal(h.selectedFile.value, 'b.json'); assert.equal(h.data.get(aPath), saved); assert.equal(h.creating.value, true);
      assert.match(h.error.value, /同名/);
      h.newName.value = '../unsafe'; await h.createFile(); assert.equal(h.data.size, 2);
    });
    await test('Switch flushes duration and nested position drafts to the original file and workspace', async () => {
      const h = await open();
      h.project.value.clip.duration = 7;
      h.project.value.clip.components[0].properties.positionData.slot[0].vector3 = '3,4,5';
      h.workspace.value = 'other'; await h.selectFile('b.json');
      assert.equal(h.project.value.clip.duration, 4);
      assert.equal(model.decodeCameraProject(h.data.get(aPath)).clip.duration, 7);
      assert.equal(model.decodeCameraProject(h.data.get(aPath)).clip.components[0].properties.positionData.slot[0].vector3, '3,4,5');
      h.project.value.clip.duration = 9; await h.prepareToLeave();
      assert.equal(model.decodeCameraProject(h.data.get(bPath)).clip.duration, 9);
      assert.ok(h.writes.every(([file]) => file.startsWith('/original/CameraEditor/')));
    });
    await test('Failed saves prevent file switch, creation, deletion and leaving, and can be retried', async () => {
      const h = await open(), write = h.storage.writeFile;
      h.storage.writeFile = async () => { throw new Error('save failed'); };
      h.project.value.clip.duration = 11; await h.selectFile('b.json');
      assert.equal(h.selectedFile.value, 'a.json'); assert.equal(h.project.value.clip.duration, 11);
      h.newName.value = 'new'; await h.createFile(); assert.equal(h.data.size, 2);
      await h.deleteFile(); assert.equal(h.trashed.length, 0);
      await assert.rejects(h.prepareToLeave(), /save failed/); assert.equal(h.status.value, '保存失败');
      h.storage.writeFile = write; await h.flush(); assert.equal(model.decodeCameraProject(h.data.get(aPath)).clip.duration, 11);
    });
    await test('Corrupt reads preserve the open camera and never overwrite the corrupt file', async () => {
      const h = await open(); h.data.set(bPath, '{broken'); const before = h.project.value;
      await h.selectFile('b.json'); assert.equal(h.project.value, before); assert.equal(h.selectedFile.value, 'a.json');
      assert.equal(h.data.get(bPath), '{broken'); assert.ok(h.error.value);
    });
    await test('Delete cancellation and trash failure preserve content; success uses the recycle bin after saving', async () => {
      const h = await open(); h.confirmReply = false; await h.deleteFile(); assert.equal(h.selectedFile.value, 'a.json');
      h.confirmReply = true; const trash = h.storage.trash; h.storage.trash = async () => { throw new Error('trash failed'); };
      h.project.value.clip.duration = 5; await h.deleteFile(); assert.equal(h.selectedFile.value, 'a.json');
      assert.equal(model.decodeCameraProject(h.data.get(aPath)).clip.duration, 5);
      h.storage.trash = trash; await h.deleteFile(); assert.deepEqual(h.trashed, [aPath]);
      assert.equal(h.project.value, undefined); assert.equal(h.selectedFile.value, ''); assert.equal(h.data.has(aPath), false);
    });
    await test('Busy reads block leaving and unmounted async reads cannot replace the document', async () => {
      const h = await open(); let release;
      const read = new Promise(resolve => { release = resolve; }); h.storage.readFile = () => read;
      const pending = h.selectFile('b.json'); await Promise.resolve(); await assert.rejects(h.prepareToLeave(), /正在读写/);
      h.unmount(); release(doc('B', 8)); await pending; assert.equal(h.selectedFile.value, 'a.json');
    });
    await test('Only the visible camera editor consumes Ctrl+S and flushes its pending draft', async () => {
      const h = await open(); h.mount(); h.project.value.clip.duration = 12;
      let prevented = 0;
      const event = { ctrlKey: true, metaKey: false, key: 's', repeat: false, preventDefault() { prevented++; } };
      h.active.value = false;
      await h.win.listeners.get('keydown')(event);
      assert.equal(prevented, 0); assert.equal(h.writes.length, 0);
      assert.equal(model.decodeCameraProject(h.data.get(aPath)).clip.duration, 2);
      h.active.value = true;
      await h.win.listeners.get('keydown')(event);
      assert.equal(prevented, 1); assert.equal(h.writes.length, 1);
      assert.equal(model.decodeCameraProject(h.data.get(aPath)).clip.duration, 12);
    });
    await test('Browser lifecycle flushes pending changes and releases its listeners on unmount', async () => {
      const h = await open(); h.mount(); h.project.value.clip.duration = 6;
      let prevented = false;
      h.win.listeners.get('beforeunload')({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true); await h.flush(); assert.equal(model.decodeCameraProject(h.data.get(aPath)).clip.duration, 6);
      h.unmount(); assert.equal(h.win.listeners.size, 0); assert.equal(h.doc.listeners.size, 0);
    });
    console.log(`\n${passed} camera file checks passed.`);
  } finally {
    for (const h of sessions) { h.unmount(); await h.flush().catch(() => undefined); }
    Module._load = originalLoad;
    if (originalTs) Module._extensions['.ts'] = originalTs; else delete Module._extensions['.ts'];
    global.window = originalWindow; global.document = originalDocument; global.confirm = originalConfirm;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
