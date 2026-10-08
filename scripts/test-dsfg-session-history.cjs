/* Run: node scripts/test-dsfg-session-history.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const originalTs = Module._extensions['.ts'];
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, fileName: file,
}).outputText, file);
const { createStudioSessionHistory } = require('../src/views/DSFGStudio/components/studioSessionHistory.ts');
const { createEditorHistory } = require('../src/views/ClientUIAnimationEditor/editorHistory.ts');

function fixture(options = {}) {
  const current = vue.ref('Dialogue'), blocked = vue.ref(false), saves = [], locals = new Map();
  let failSwitch = false, waitSwitch;
  const history = createStudioSessionHistory({
    currentEditor: () => current.value, blocked: () => blocked.value, limit: options.limit,
    switchEditor: async kind => {
      saves.push([current.value, kind, locals.get(current.value)?.state.value]);
      if (failSwitch) throw Error('save failed');
      if (waitSwitch) await waitSwitch;
      current.value = kind;
    },
  });
  function editor(kind, initial) {
    const state = vue.ref(initial), baseline = vue.ref(initial), known = new Set();
    let failRestore = false;
    const raw = createEditorHistory({
      capture: () => state.value, describe: () => `修改${kind}`,
      restore: snapshot => {
        if (failRestore) { failRestore = false; throw Error('restore failed'); }
        state.value = baseline.value = snapshot;
      },
    });
    function finish() {
      raw.end('input'); raw.flush(); baseline.value = state.value;
      const entry = raw.entries.value[raw.index.value];
      if (entry && !known.has(entry.id)) { known.add(entry.id); history.recordEdit(kind, entry, raw); }
    }
    const unregister = history.registerFinisher(kind, finish, () => current.value === kind, () => state.value !== baseline.value);
    const local = { state, raw, finish, unregister,
      edit(value) { state.value = value; raw.observe(value); finish(); },
      input(value) { raw.begin('input'); state.value = value; raw.observe(value); },
      reset(value) { state.value = baseline.value = value; raw.reset(value); known.clear(); history.resetOwner(kind); },
      set failRestore(value) { failRestore = value; },
    };
    locals.set(kind, local); return local;
  }
  async function switchTo(kind) {
    history.finishRegistered();
    const before = current.value;
    // Successful user navigation is recorded after save, just like the shell.
    if (before === kind) return;
    saves.push([before, kind, locals.get(before)?.state.value]);
    if (failSwitch) throw Error('save failed');
    current.value = kind; history.recordSwitch(before, kind);
  }
  return { history, current, blocked, saves, locals, editor, switchTo,
    set failSwitch(value) { failSwitch = value; }, set waitSwitch(value) { waitSwitch = value; } };
}

async function main() {
  let passed = 0;
  async function test(name, check) { await check(); passed++; console.log('PASS ' + name); }

  await test('Module navigation and real local content histories replay in chronological order', async () => {
    const f = fixture(), d = f.editor('Dialogue', 'd0'), q = f.editor('Quest', 'q0'), c = f.editor('Camera', 'c0');
    d.edit('d1'); await f.switchTo('Quest'); q.edit('q1'); await f.switchTo('Camera'); c.edit('c1');
    assert.deepEqual(f.history.entries.value.map(e => e.label), ['修改Dialogue', '切换到任务', '修改Quest', '切换到镜头', '修改Camera']);
    await f.history.undo(); assert.equal(c.state.value, 'c0'); assert.equal(f.current.value, 'Camera');
    await f.history.undo(); assert.equal(f.current.value, 'Quest'); assert.equal(q.state.value, 'q1');
    await f.history.undo(); assert.equal(q.state.value, 'q0');
    await f.history.undo(); assert.equal(f.current.value, 'Dialogue'); assert.equal(d.state.value, 'd1');
    await f.history.undo(); assert.equal(d.state.value, 'd0'); assert.equal(f.history.canUndo.value, false);
    for (let i = 0; i < 5; i++) await f.history.redo();
    assert.equal(f.current.value, 'Camera'); assert.equal(d.state.value, 'd1'); assert.equal(q.state.value, 'q1'); assert.equal(c.state.value, 'c1');
    assert.equal(f.history.canRedo.value, false);
    assert.deepEqual(f.saves.slice(2), [['Camera', 'Quest', 'c0'], ['Quest', 'Dialogue', 'q0'], ['Dialogue', 'Quest', 'd1'], ['Quest', 'Camera', 'q1']]);
  });

  await test('A pending first text gesture enables global undo and is committed before navigation', async () => {
    const f = fixture(), d = f.editor('Dialogue', 'd0'); f.editor('Quest', 'q0');
    assert.equal(f.history.canUndo.value, false);
    d.input('typing'); assert.equal(f.history.entries.value.length, 0); assert.equal(f.history.canUndo.value, true);
    await f.history.undo(); assert.equal(d.state.value, 'd0'); assert.equal(f.history.canRedo.value, true);
    d.input('final'); assert.equal(f.history.canRedo.value, false);
    await f.switchTo('Quest');
    assert.equal(f.history.entries.value.length, 2); assert.equal(f.saves.at(-1)[2], 'final');
    await f.history.undo(); assert.equal(f.current.value, 'Dialogue');
    await f.history.undo(); assert.equal(d.state.value, 'd0');
  });

  await test('Editing after cross-module undo drops future navigation and content without replaying orphan commands', async () => {
    const f = fixture(), d = f.editor('Dialogue', 'd0'), q = f.editor('Quest', 'q0');
    d.edit('d1'); await f.switchTo('Quest'); q.edit('q1'); await f.switchTo('Dialogue'); d.edit('d2');
    await f.history.undo(); await f.history.undo(); await f.history.undo();
    assert.equal(f.current.value, 'Quest'); assert.equal(q.state.value, 'q0');
    q.edit('q2'); assert.equal(f.history.canRedo.value, false);
    assert.deepEqual(f.history.entries.value.map(e => e.label), ['修改Dialogue', '切换到任务', '修改Quest']);
    await f.history.undo(); await f.history.undo(); await f.history.undo();
    assert.equal(f.current.value, 'Dialogue'); assert.equal(d.state.value, 'd0');
    await f.history.redo(); await f.history.redo(); await f.history.redo();
    assert.equal(f.current.value, 'Quest'); assert.equal(q.state.value, 'q2'); assert.equal(d.state.value, 'd1');
    assert.equal(f.history.canRedo.value, false);
  });

  await test('Failed navigation saves and failed local restores preserve cursor and allow a retry', async () => {
    const f = fixture(), d = f.editor('Dialogue', 'd0'); f.editor('Quest', 'q0');
    d.edit('d1'); f.failSwitch = true;
    await assert.rejects(f.switchTo('Quest'), /save failed/);
    assert.equal(f.history.entries.value.length, 1); assert.equal(f.current.value, 'Dialogue');
    f.failSwitch = false; await f.switchTo('Quest'); const cursor = f.history.index.value;
    f.failSwitch = true; await assert.rejects(f.history.undo(), /save failed/);
    assert.equal(f.current.value, 'Quest'); assert.equal(f.history.index.value, cursor); assert.equal(f.history.busy.value, false);
    f.failSwitch = false; await f.history.undo(); d.failRestore = true;
    await assert.rejects(f.history.undo(), /restore failed/);
    assert.equal(d.state.value, 'd1'); assert.equal(f.history.index.value, 0); assert.equal(d.raw.index.value, 0);
    await f.history.undo(); assert.equal(d.state.value, 'd0');
  });

  await test('Save replay is serialized, blocked actions wait for unblocking, and the cursor advances only on success', async () => {
    const f = fixture(); f.editor('Dialogue', 'd0'); f.editor('Quest', 'q0'); await f.switchTo('Quest');
    f.blocked.value = true; assert.equal(f.history.canUndo.value, false); await f.history.undo(); assert.equal(f.current.value, 'Quest');
    f.blocked.value = false; let release;
    f.waitSwitch = new Promise(resolve => { release = resolve; });
    const replay = f.history.undo();
    assert.equal(f.history.busy.value, true); assert.equal(f.history.index.value, 0); assert.equal(f.history.canRedo.value, false);
    await f.history.undo(); f.history.recordSwitch('Quest', 'Camera'); assert.equal(f.history.entries.value.length, 1);
    release(); await replay;
    assert.equal(f.current.value, 'Dialogue'); assert.equal(f.history.index.value, -1); assert.equal(f.history.busy.value, false);
  });

  await test('Resetting one loaded document removes its past and future commands while retaining other modules and navigation', async () => {
    const f = fixture(), d = f.editor('Dialogue', 'd0'), q = f.editor('Quest', 'q0');
    d.edit('d1'); await f.switchTo('Quest'); q.edit('q1'); await f.switchTo('Dialogue'); d.edit('d2'); await f.history.undo();
    d.reset('replacement');
    assert.deepEqual(f.history.entries.value.map(e => e.label), ['切换到任务', '修改Quest', '切换到对话']);
    assert.equal(f.history.index.value, 2); assert.equal(f.history.canRedo.value, false);
    await f.history.undo(); await f.history.undo(); await f.history.undo();
    assert.equal(q.state.value, 'q0'); assert.equal(d.state.value, 'replacement'); assert.equal(f.current.value, 'Dialogue');
    await f.history.redo(); await f.history.redo(); assert.equal(q.state.value, 'q1');
  });

  await test('The shared 100-command limit includes navigation and retains usable local cursors', async () => {
    const f = fixture(), d = f.editor('Dialogue', '0');
    for (let i = 1; i <= 105; i++) d.edit(String(i));
    assert.equal(f.history.entries.value.length, 100);
    for (let i = 0; i < 100; i++) await f.history.undo();
    assert.equal(d.state.value, '5'); assert.equal(f.history.canUndo.value, false);
    for (let i = 0; i < 100; i++) await f.history.redo(); assert.equal(d.state.value, '105');
    f.history.clear();
    for (let i = 0; i < 110; i++) await f.switchTo(f.current.value === 'Dialogue' ? 'Quest' : 'Dialogue');
    assert.equal(f.history.entries.value.length, 100);
    for (let i = 0; i < 100; i++) await f.history.undo();
    assert.equal(f.history.canUndo.value, false); assert.equal(f.current.value, 'Dialogue');
  });

  await test('Finisher replacement, unregistration and workspace clear do not retain stale pending edits', async () => {
    const f = fixture(), pending = vue.ref(false); let old = 0, next = 0;
    const unregisterOld = f.history.registerFinisher('dialog', () => old++, () => true, () => pending.value);
    assert.equal(f.history.canUndo.value, false); pending.value = true; assert.equal(f.history.canUndo.value, true);
    const unregisterNext = f.history.registerFinisher('dialog', () => next++, () => true, () => pending.value);
    unregisterOld(); f.history.finishRegistered(); assert.equal(old, 0); assert.equal(next, 1);
    unregisterNext(); assert.equal(f.history.canUndo.value, false);
    f.history.recordSwitch('Dialogue', 'Quest'); f.history.clear();
    assert.equal(f.history.entries.value.length, 0); assert.equal(f.history.canUndo.value, false); assert.equal(f.history.canRedo.value, false);
    f.history.dispose(); f.history.recordSwitch('Dialogue', 'Camera'); assert.equal(f.history.entries.value.length, 0);
  });

  await test('A late unrelated file load keeps navigation replay consistent; clearing the workspace invalidates a pending cursor', async () => {
    const f = fixture(), d = f.editor('Dialogue', 'd0'); f.editor('Quest', 'q0');
    d.edit('d1'); await f.switchTo('Quest');
    let release; f.waitSwitch = new Promise(resolve => { release = resolve; });
    const replay = f.history.undo();
    d.reset('replacement'); assert.equal(f.history.index.value, 0);
    release(); await replay;
    assert.equal(f.history.index.value, -1); assert.equal(f.current.value, 'Dialogue'); assert.equal(f.history.canRedo.value, true);
    f.waitSwitch = undefined; await f.history.redo();
    f.waitSwitch = new Promise(resolve => { release = resolve; });
    const obsolete = f.history.undo(); f.history.clear(); release(); await obsolete;
    assert.equal(f.history.index.value, -1); assert.equal(f.history.entries.value.length, 0);
    assert.equal(f.history.canUndo.value, false); assert.equal(f.history.canRedo.value, false);
  });

  console.log(`\n${passed} DSFG session history checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (originalTs) Module._extensions['.ts'] = originalTs; else delete Module._extensions['.ts'];
});
