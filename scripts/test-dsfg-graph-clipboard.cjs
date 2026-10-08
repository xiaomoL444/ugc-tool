/* Run: node scripts/test-dsfg-graph-clipboard.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '..');
const editor = path.join(root, 'src/views/DSFGStudio/components/DialogueEditor');
const originalLoad = Module._load, originalTs = Module._extensions['.ts'];
let hooks, variables;
Module._load = function(request, parent, main) {
  if (request === 'vue') return { ...vue, onMounted: fn => hooks.mount.push(fn), onBeforeUnmount: fn => hooks.unmount.push(fn) };
  if (request === 'miliastra-variable') return variables;
  return originalLoad.call(this, request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request, parent, main);
};
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, fileName: file,
}).outputText, file);
const tick = async () => { await vue.nextTick(); await Promise.resolve(); await Promise.resolve(); };
const json = value => JSON.parse(JSON.stringify(value));
let passed = 0;
async function test(name, check) { await check(); passed++; console.log('PASS ' + name); }

async function main() {
  variables = await import('miliastra-variable');
  const model = require(path.join(editor, 'utils/dialogueProject.ts'));
  const codec = require(path.join(editor, 'utils/dialogueProjectCodec.ts'));
  const { selectOutletId } = require(path.join(editor, 'utils/groupOutlets.ts'));
  const { copyDialogueGraphNodes: copy, parseDialogueGraphClipboard: read, pasteDialogueGraphNodes: paste } = require(path.join(editor, 'utils/dialogueGraphClipboard.ts'));
  const { useDialogueGraphClipboard } = require(path.join(editor, 'useDialogueGraphClipboard.ts'));
  function fixture(aliases = false) {
    const p = model.createEmptyDialogueProject();
    const a = model.createDialogueNode('a'), b = model.createDialogueNode('b'), c = model.createConditionBranchNode('c');
    a.dialogue.advanceMode = 'None'; a.dialogue.autoContinue = -1; a.select = model.createSelectClip();
    a.select.options.push(model.createSelectOption()); a.select.params = ['-2147483648', '42'];
    a.focusPush = model.createFocusPushClip(); a.focusPush.outputMode = 'Shared'; a.focusPush.sharedOutletIndex = 1;
    b.focusPush = model.createFocusPushClip();
    const camera = model.createPerformanceClip('Camera', 0.3); a.lines[0].clips.push(camera);
    camera.components[0].properties.draft = '-';
    camera.components[0].properties.reference = { id: 'external-reference', guid: '1086324738', entity: '实体查询' };
    const events = model.createPerformanceLine('PublicEvent'), event = model.createPerformanceClip('PublicEvent', 0.4);
    event.components[0].properties.value = 'NOLOC_Test';
    event.components[0].properties.parameters = [{ id: 'external-parameter', name: '实体', type: 'Guid', value: '18446744073709551615' }];
    events.clips.push(event); a.lines.push(events);
    p.dialogue.nodes = { a, b }; p.dialogue.conditionBranches = { c };
    const ids = aliases ? ['canvas-a', 'canvas-b', 'canvas-c'] : ['a', 'b', 'c'];
    p.graph.nodes.push(...[a, b, c].map((node, i) => ({ id: ids[i], type: i === 2 ? 'condition' : 'group',
      position: { x: 320 + 360 * i, y: i * 160 }, data: { [i === 2 ? 'conditionBranchNodeId' : 'dialogueNodeId']: node.id, annotation: '备注 ' + i },
      selected: true, dimensions: { width: 250, height: 160 } })));
    const edge = (source, sourceHandle, target) => p.graph.edges.push({ id: 'edge-' + p.graph.edges.length, source, sourceHandle, target, targetHandle: 'input' });
    edge(p.dialogue.entryNodeId, 'next', ids[0]); edge(ids[0], selectOutletId(a.select.options[0].id), ids[2]);
    edge(ids[0], selectOutletId(a.select.options[1].id), ids[1]); edge(ids[2], c.outputs[0].id, ids[1]);
    edge(ids[2], c.outputs[1].id, ids[0]); edge(ids[1], 'next', ids[0]); edge(ids[1], 'focus-push', ids[2]);
    return { p, a, b, c, ids };
  }
  function localIds(node) {
    return [node.id, ...(node.dialogue ? [node.dialogue.id] : []), ...(node.select ? [node.select.id, ...node.select.options.map(option => option.id)] : []),
      ...(node.focusPush ? [node.focusPush.id] : []), ...(node.outputs ?? []).map(output => output.id),
      ...(node.lines ?? []).flatMap(line => [line.id, ...line.clips.flatMap(clip => [clip.id, ...clip.components.map(component => component.id)])])];
  }
  await test('Copy snapshots selected nodes, settings and notes while excluding entry nodes and external connections', () => {
    const { p, a, ids } = fixture(true), before = codec.encodeDialogueProject(p);
    assert.equal(copy(p, [p.dialogue.entryNodeId]), undefined);
    const data = copy(p, [p.dialogue.entryNodeId, ids[0], ids[2]]);
    assert.deepEqual(data.nodes.map(item => item.graph.id), [ids[0], ids[2]]);
    assert.equal(data.edges.length, 2); assert.equal(data.nodes[0].graph.data.annotation, '备注 0');
    assert.equal(data.nodes[0].graph.dimensions, undefined); assert.equal(data.nodes[0].graph.selected, undefined);
    assert.equal(codec.encodeDialogueProject(p), before);
    a.dialogue.content = 'changed after copy'; a.lines[0].clips[0].components[0].properties.draft = 'new';
    assert.equal(data.nodes[0].node.dialogue.content, '新建台词');
    assert.equal(data.nodes[0].node.lines[0].clips[0].components[0].properties.draft, '-');
    p.graph.nodes.find(node => node.id === ids[0]).hidden = true;
    assert.equal(copy(p, [ids[0]]), undefined);
  });
  await test('Paste regenerates every local identity and remaps select/condition handles, preserving configuration references', () => {
    const { p, a, b, c, ids } = fixture(true), data = read(JSON.stringify(copy(p, ids)));
    const source = codec.encodeDialogueProject(p), before = JSON.stringify(data);
    const result = paste(p, data, 60), [newA, newB, newC] = result.nodeIds;
    assert.equal(codec.encodeDialogueProject(p), source); assert.equal(JSON.stringify(data), before);
    const pastedA = result.project.dialogue.nodes[newA], pastedB = result.project.dialogue.nodes[newB], pastedC = result.project.dialogue.conditionBranches[newC];
    const originals = new Set([a, b, c].flatMap(localIds)), copies = [pastedA, pastedB, pastedC].flatMap(localIds);
    assert.equal(new Set(copies).size, copies.length); assert.ok(copies.every(id => !originals.has(id)));
    assert.deepEqual(pastedA.lines[0].clips[0].components[0].properties, a.lines[0].clips[0].components[0].properties);
    assert.deepEqual(pastedA.lines[1].clips[0].components[0].properties, a.lines[1].clips[0].components[0].properties);
    assert.deepEqual(pastedA.select.params, a.select.params); assert.equal(pastedA.dialogue.autoContinue, -1);
    assert.equal(pastedA.focusPush.sharedOutletIndex, 1);
    const internal = result.project.graph.edges.slice(p.graph.edges.length);
    assert.equal(internal.length, 6); assert.ok(internal.every(edge => result.nodeIds.includes(edge.source) && result.nodeIds.includes(edge.target)));
    assert.deepEqual(internal.filter(edge => edge.source === newA).map(edge => edge.sourceHandle), pastedA.select.options.map(option => selectOutletId(option.id)));
    assert.deepEqual(internal.filter(edge => edge.source === newC).map(edge => edge.sourceHandle), pastedC.outputs.map(output => output.id));
    assert.equal(internal.find(edge => edge.source === newB && edge.sourceHandle === 'focus-push').target, newC);
    assert.ok(internal.every(edge => !p.graph.edges.some(old => old.id === edge.id)));
    for (const [i, id] of result.nodeIds.entries()) {
      const graph = result.project.graph.nodes.find(node => node.id === id);
      assert.deepEqual(graph.position, { x: 380 + 360 * i, y: 60 + 160 * i });
      assert.equal(graph.data.annotation, '备注 ' + i); assert.equal(graph.selected, undefined);
    }
  });
  await test('Pasted complete flows export the same runtime configuration and repeated pastes remain independent', () => {
    const { p, ids } = fixture(), data = copy(p, ids);
    const target = model.createEmptyDialogueProject(), one = paste(target, data, 60);
    one.project.graph.edges.push({ id: 'entry-copy', source: target.dialogue.entryNodeId, sourceHandle: 'next', target: one.nodeIds[0], targetHandle: 'input' });
    const { exportQxqyPerformance } = require(path.join(editor, 'utils/qxqyPerformanceExporter.ts'));
    assert.deepEqual(exportQxqyPerformance(one.project).value, exportQxqyPerformance(p).value);
    const two = paste(one.project, data, 120);
    assert.ok(two.nodeIds.every(id => !one.nodeIds.includes(id)));
    assert.equal(two.project.graph.nodes.find(node => node.id === two.nodeIds[0]).position.x, one.project.graph.nodes.find(node => node.id === one.nodeIds[0]).position.x + 60);
    two.project.dialogue.nodes[two.nodeIds[0]].dialogue.content = 'only the second copy';
    assert.equal(two.project.dialogue.nodes[one.nodeIds[0]].dialogue.content, '新建台词');
    assert.equal(data.nodes[0].node.dialogue.content, '新建台词');
  });
  await test('Clipboard validation ignores ordinary text and rejects malformed tagged nodes before any mutation', () => {
    const { p, ids } = fixture();
    for (const text of ['普通文字', '{', '{}', JSON.stringify({ kind: 'different-tool' })]) assert.equal(read(text), undefined);
    const data = copy(p, ids), bad = json(data); bad.nodes[0].node.lines[0].clips[0].components = null;
    assert.throws(() => read(JSON.stringify(bad)), /不完整/);
    const edge = json(data); edge.edges[0].target = 'external'; assert.throws(() => read(JSON.stringify(edge)), /不完整/);
    const duplicate = json(data); duplicate.nodes.push(duplicate.nodes[0]); assert.throws(() => read(JSON.stringify(duplicate)), /不完整/);
  });
  await test('Native clipboard events respect text inputs, inactive/inert editors and unrelated text, with progressive paste offsets', () => {
    hooks = { mount: [], unmount: [] };
    const listeners = new Map(); let enabled = true, inert = false;
    const target = (editable = false, owned = true) => ({ owned, closest: () => editable ? {} : null });
    global.document = { body: target(false, false), documentElement: target(false, false) };
    global.window = { addEventListener(name, handler) { listeners.set(name, handler); }, removeEventListener(name, handler) { if (listeners.get(name) === handler) listeners.delete(name); } };
    const { p, ids } = fixture(); let selection = ids;
    const pasted = [], errors = [], copied = [], data = new Map();
    useDialogueGraphClipboard({ project: vue.ref(p), element: vue.ref({ contains: item => item.owned, closest: () => inert ? {} : null }),
      enabled: () => enabled, selectedNodeIds: () => selection, paste: (value, offset) => { pasted.push({ value, offset }); return true; },
      onCopy: count => copied.push(count), onError: error => errors.push(error) });
    hooks.mount.forEach(fn => fn());
    function fire(type, eventTarget = target()) {
      const event = { target: eventTarget, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
        clipboardData: { setData: (type, value) => data.set(type, value), getData: type => data.get(type) || '' } };
      listeners.get(type)(event); return event;
    }
    assert.equal(fire('copy', target(true)).defaultPrevented, false);
    assert.equal(fire('copy', target(false, false)).defaultPrevented, false);
    enabled = false; assert.equal(fire('copy').defaultPrevented, false); enabled = true;
    inert = true; assert.equal(fire('copy', document.body).defaultPrevented, false); inert = false;
    selection = [p.dialogue.entryNodeId]; assert.equal(fire('copy').defaultPrevented, false); selection = ids;
    assert.equal(fire('copy').defaultPrevented, true); assert.deepEqual(copied, [3]);
    assert.equal(fire('paste', target(true)).defaultPrevented, false);
    assert.equal(fire('paste').defaultPrevented, true); fire('paste', document.body);
    assert.deepEqual(pasted.map(item => item.offset), [60, 120]);
    data.set('text/plain', '普通文字'); assert.equal(fire('paste').defaultPrevented, false); assert.equal(pasted.length, 2);
    data.set('text/plain', JSON.stringify({ kind: 'dsfg-dialogue-nodes', version: 1, nodes: [], edges: [] }));
    assert.equal(fire('paste').defaultPrevented, true); assert.equal(errors.length, 1); assert.equal(pasted.length, 2);
    hooks.unmount.forEach(fn => fn()); assert.equal(listeners.size, 0);
  });
  await test('The actual editor paste commits one undo step, saves atomically and focuses the new node using the reactive project', async () => {
    const filename = path.join(editor, 'DialogueEditor.vue'), script = parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor.scriptSetup.content;
    const ast = ts.createSourceFile(filename + '.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const methods = ['PasteGraphNodes', 'FocusPastedNodes'].map(name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast)).join('\n');
    const code = ts.transpileModule(methods + '\nthis.paste = PasteGraphNodes;', { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
    const { p, ids } = fixture(), data = copy(p, [ids[0]]), project = vue.ref(p), writes = [], focused = [];
    const { createEditorHistory } = require(path.join(root, 'src/views/ClientUIAnimationEditor/editorHistory.ts'));
    const { createWorkspaceSaveQueue } = require(path.join(editor, '../QuestEditor/workspaceSaveQueue.ts'));
    const history = createEditorHistory({ capture: () => codec.encodeDialogueProject(project.value), restore: value => { project.value = JSON.parse(value); }, describe: () => 'paste' });
    const saves = createWorkspaceSaveQueue(async (file, data) => writes.push(JSON.parse(data)), () => {}, 10000);
    const scope = vue.effectScope();
    scope.run(() => vue.watch(project, () => { history.observe(codec.encodeDialogueProject(project.value)); saves.schedule('dialogue.json', codec.encodeDialogueProject(project.value)); }, { deep: true, flush: 'sync' }));
    const group = vue.ref('old'), inspector = vue.ref(true);
    const context = vm.createContext({ dialogueProject: project, pasteDialogueGraphNodes: paste,
      dialogueHistory: { ...history, finish: () => history.flush() }, nodesSelectionActive: vue.ref(true), clipInspectorOpen: inspector,
      getSelectedNodes: vue.computed(() => project.value.graph.nodes.filter(node => node.selected)), getSelectedEdges: vue.ref([]),
      removeSelectedNodes: nodes => nodes.forEach(node => { node.selected = false; }), removeSelectedEdges() {}, selectedGroupNodeId: group,
      nextTick: vue.nextTick, requestAnimationFrame: fn => queueMicrotask(fn), disposed: false, editorView: vue.ref('graph'),
      findNode: id => project.value.graph.nodes.find(node => node.id === id), addSelectedNodes: nodes => nodes.forEach(node => { node.selected = true; }),
      fitView: async options => { focused.push(json(options)); }, consola: { error: error => { throw error; } },
    });
    vm.runInContext(code, context); const before = codec.encodeDialogueProject(project.value);
    assert.equal(context.paste(data, 60), true); await tick(); await tick();
    assert.equal(history.entries.value.length, 1); assert.equal(inspector.value, false);
    assert.ok(project.value.dialogue.nodes[group.value]); assert.equal(focused.length, 1);
    assert.deepEqual(focused[0].nodes, [group.value]); await saves.flush(); assert.equal(Object.keys(writes.at(-1).dialogue.nodes).length, 3);
    await history.undo(); assert.equal(codec.encodeDialogueProject(project.value), before); await saves.flush();
    assert.equal(Object.keys(writes.at(-1).dialogue.nodes).length, 2);
    await history.redo(); await saves.flush(); assert.equal(Object.keys(writes.at(-1).dialogue.nodes).length, 3);
    const focusCount = focused.length; context.paste(data, 120); project.value = model.createEmptyDialogueProject(); await tick(); await tick();
    assert.equal(focused.length, focusCount, 'A file switch cancels pending node focus');
    await saves.flush(); scope.stop(); history.dispose();
  });
  console.log(`\n${passed} DSFG graph clipboard checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = originalLoad;
  if (originalTs) Module._extensions['.ts'] = originalTs; else delete Module._extensions['.ts']; });
