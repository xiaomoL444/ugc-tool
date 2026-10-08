/* Run with: node scripts/test-dsfg-quest-flow.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc');
const directory = path.resolve(__dirname, '../src/views/DSFGStudio/components/QuestEditor');
function load(name) {
  const filename = path.join(directory, name + '.ts');
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require }, { filename });
  return module.exports;
}
const flow = load('questFlow'), model = load('questProject');
const plain = value => JSON.parse(JSON.stringify(value));
let count = 0;
function test(name, check) { check(); console.log('PASS ' + name); count++; }
function project() {
  const result = model.createQuestProject();
  result.mainQuests.push({ id: 1, chapterId: null, title: '第一章任务', style: 'Mainline' }, { id: 2, chapterId: null, title: '另一主任务', style: 'Mainline' });
  result.subQuests = [0, 1, 2].map(id => ({ id, mainQuestId: id === 2 ? 2 : 1, title: '任务 ' + id, description: '', unitState: '0', investigationPoint: '0,0,0', investigationRange: -1,
    belondPrimaryId: 0, hidden: false, nextQuestIds: [], failureQuestId: -1, finishMainQuest: false, questProgress: 0 }));
  return result;
}
test('graph and panel compile with their actual templates and styles', () => {
  for (const name of ['QuestFlowGraph.vue', 'QuestPanel.vue']) {
    const filename = path.join(directory, name), parsed = parse(fs.readFileSync(filename, 'utf8'), { filename });
    assert.deepEqual(parsed.errors, []);
    const script = compileScript(parsed.descriptor, { id: 'quest-flow' });
    assert.deepEqual(compileTemplate({ source: parsed.descriptor.template.content, filename, id: 'quest-flow', compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
    for (const style of parsed.descriptor.styles) assert.deepEqual(compileStyle({ source: style.content, filename, id: 'quest-flow', scoped: true }).errors, []);
  }
});
test('projection preserves ID zero, duplicates, null slots, external IDs, ordering and failure links', () => {
  const doc = project();
  doc.subQuests[0].nextQuestIds = [1, null, 1, 9999, -1];
  doc.subQuests[0].failureQuestId = 2;
  const before = JSON.stringify(doc), graph = flow.buildQuestFlow(doc, 1, 0);
  assert.equal(JSON.stringify(doc), before);
  assert.deepEqual(plain(graph.edges.filter(e => e.kind === 'next').map(e => [e.targetId, e.index])), [[1, 0], [null, 1], [1, 2], [9999, 3], [-1, 4]]);
  assert.equal(new Set(graph.edges.map(e => e.id)).size, graph.edges.length);
  assert.ok(graph.nodes.some(n => n.questId === 2 && n.boundary && !n.missing));
  assert.ok(graph.nodes.some(n => n.questId === 9999 && n.missing));
  assert.ok(graph.nodes.some(n => n.questId === null && n.missing));
  assert.equal(graph.edges.find(e => e.kind === 'failure').targetId, 2);
});
test('drawing connections changes only the matching runtime fields and survives save/reload', () => {
  const doc = project();
  assert.equal(flow.connectQuestFlow(doc, 0, 1, 'next'), '');
  assert.equal(flow.connectQuestFlow(doc, 0, 2, 'next'), '');
  assert.equal(flow.connectQuestFlow(doc, 0, 2, 'failure'), '');
  assert.deepEqual(plain(doc.subQuests[0].nextQuestIds), [1, 2]);
  assert.equal(doc.subQuests[0].failureQuestId, 2);
  const restored = model.decodeQuestProject(model.encodeQuestProject(doc));
  assert.deepEqual(plain(restored), plain(doc));
  assert.equal('nodes' in restored, false);
});
test('duplicate, missing and over-limit connections do not mutate the document', () => {
  const doc = project(); doc.subQuests[0].nextQuestIds = [1];
  const before = JSON.stringify(doc);
  assert.ok(flow.connectQuestFlow(doc, 0, 1, 'next'));
  assert.ok(flow.connectQuestFlow(doc, 0, 999, 'next'));
  assert.ok(flow.connectQuestFlow(doc, 999, 1, 'failure'));
  assert.equal(JSON.stringify(doc), before);
  doc.subQuests[0].nextQuestIds = Array(100).fill(null);
  assert.ok(flow.connectQuestFlow(doc, 0, 2, 'next')); assert.equal(doc.subQuests[0].nextQuestIds.length, 100);
});
test('removing one duplicate or null edge preserves other slots, failure removal restores -1', () => {
  const doc = project(); doc.subQuests[0].nextQuestIds = [1, null, 1, 2]; doc.subQuests[0].failureQuestId = 2;
  let graph = flow.buildQuestFlow(doc, null, 0);
  assert.equal(flow.disconnectQuestFlow(doc, graph.edges.find(e => e.kind === 'next' && e.index === 2)), true);
  assert.deepEqual(plain(doc.subQuests[0].nextQuestIds), [1, null, 2]);
  assert.equal(flow.disconnectQuestFlow(doc, graph.edges.find(e => e.kind === 'next' && e.index === 2)), false);
  graph = flow.buildQuestFlow(doc, null, 0);
  flow.disconnectQuestFlow(doc, graph.edges.find(e => e.targetId === null));
  assert.deepEqual(plain(doc.subQuests[0].nextQuestIds), [1, 2]);
  flow.disconnectQuestFlow(doc, graph.edges.find(e => e.kind === 'failure'));
  assert.equal(doc.subQuests[0].failureQuestId, -1); assert.equal(doc.subQuests.length, 3);
});
test('null failure is visible, default failure is absent, cycles and self-links lay out finitely', () => {
  const doc = project(); doc.subQuests[0].nextQuestIds = [0, 1]; doc.subQuests[1].nextQuestIds = [0]; doc.subQuests[1].failureQuestId = null;
  const graph = flow.buildQuestFlow(doc, null, 0);
  assert.equal(graph.edges.filter(e => e.kind === 'failure').length, 1);
  const positions = flow.layoutQuestFlow(graph.nodes, graph.edges);
  assert.equal(positions.size, graph.nodes.length);
  for (const position of positions.values()) assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y));
  assert.equal(flow.layoutQuestFlow([], []).size, 0);
});
test('large projects page sources and bound drawing without changing or dropping stored data', () => {
  const doc = project(), base = doc.subQuests[0];
  doc.subQuests = Array.from({ length: 10000 }, (_, id) => ({ ...base, id, nextQuestIds: Array.from({ length: 100 }, (_, i) => (id + i + 1) % 10000) }));
  const graph = flow.buildQuestFlow(doc, null, 0);
  assert.equal(graph.pageCount, 200); assert.equal(graph.total, 10000);
  assert.ok(graph.nodes.length <= 100); assert.ok(graph.edges.length <= 300); assert.ok(graph.omitted > 0);
  assert.equal(graph.edges.length + graph.omitted, 5000);
  const last = flow.buildQuestFlow(doc, null, 999);
  assert.equal(last.page, 199); assert.equal(last.nodes[0].questId, 9950);
  assert.equal(doc.subQuests.length, 10000); assert.equal(doc.subQuests[0].nextQuestIds.length, 100);
});
test('existing task deletion still clears every incoming reference and the graph reflects it', () => {
  const doc = project(); doc.subQuests[0].nextQuestIds = [1, 2, 1]; doc.subQuests[0].failureQuestId = 1;
  model.removeQuestSubQuests(doc, new Set([1]));
  assert.deepEqual(plain(doc.subQuests[0].nextQuestIds), [null, 2, null]);
  const graph = flow.buildQuestFlow(doc, null, 0);
  assert.equal(graph.edges.filter(e => e.targetId === null).length, 3);
  assert.equal(graph.nodes.some(n => n.questId === 1), false);
});
test('chapters wrap their main quests, unassigned and empty containers remain visible, missing references stay outside', () => {
  const doc = project();
  doc.chapters = [{ id: 0, title: '序章' }, { id: 1, title: '空章节' }];
  doc.mainQuests[0].chapterId = 0;
  doc.mainQuests.push({ id: 3, chapterId: 0, title: '空主任务', style: 'Mainline' });
  doc.subQuests[0].nextQuestIds = [2, 999];
  const before = JSON.stringify(doc), graph = flow.buildQuestFlow(doc, null, 0);
  const groups = new Map(graph.groups.map(group => [group.id, group]));
  assert.equal(groups.get('main:1').parentId, 'chapter:0');
  assert.equal(groups.get('main:2').parentId, 'chapter:unassigned');
  assert.equal(groups.get('main:3').count, 0);
  assert.equal(groups.get('chapter:1').count, 0);
  assert.equal(groups.get('chapter:0').count, 2);
  const boxes = flow.layoutQuestFlowGroups(graph.nodes, graph.edges, graph.groups);
  assert.equal(boxes.get('quest:0').parentId, 'main:1');
  assert.equal(boxes.get('quest:2').parentId, 'main:2');
  assert.equal(boxes.get('quest:999').parentId, undefined);
  assert.equal(JSON.stringify(doc), before);
});
test('nested layout contains every child with title clearance and separates sibling containers even for cyclic links', () => {
  const doc = project();
  doc.chapters = [{ id: 0, title: '章节一' }, { id: 1, title: '章节二' }];
  doc.mainQuests[0].chapterId = 0; doc.mainQuests[1].chapterId = 1;
  doc.subQuests[0].nextQuestIds = [0, 1, 2]; doc.subQuests[2].failureQuestId = 0;
  const graph = flow.buildQuestFlow(doc, null, 0), boxes = flow.layoutQuestFlowGroups(graph.nodes, graph.edges, graph.groups);
  for (const [id, box] of boxes) {
    assert.ok(Number.isFinite(box.position.x) && Number.isFinite(box.position.y));
    if (box.parentId) {
      const parent = boxes.get(box.parentId);
      assert.ok(box.position.x >= 26 && box.position.y >= 60, id + ' has heading clearance');
      assert.ok(box.position.x + box.width <= parent.width - 26, id + ' fits horizontally');
      assert.ok(box.position.y + box.height <= parent.height - 26, id + ' fits vertically');
    }
    for (const [otherId, other] of boxes) {
      if (id >= otherId || box.parentId !== other.parentId) continue;
      const overlap = box.position.x < other.position.x + other.width && other.position.x < box.position.x + box.width
        && box.position.y < other.position.y + other.height && other.position.y < box.position.y + box.height;
      assert.equal(overlap, false, id + ' overlaps ' + otherId);
    }
  }
});
test('main filtering keeps referenced target hierarchy and omits unrelated empty chapters', () => {
  const doc = project(); doc.chapters = [{ id: 1, title: '第二章' }, { id: 2, title: '空章' }];
  doc.mainQuests[1].chapterId = 1; doc.subQuests[0].nextQuestIds = [2];
  const graph = flow.buildQuestFlow(doc, 1, 0);
  assert.ok(graph.groups.some(group => group.id === 'main:2' && group.parentId === 'chapter:1'));
  assert.equal(graph.groups.some(group => group.id === 'chapter:2'), false);
  assert.equal(graph.nodes.find(node => node.questId === 2).boundary, true);
  const boxes = flow.layoutQuestFlowGroups(graph.nodes, graph.edges, graph.groups);
  assert.equal(boxes.get('quest:2').parentId, 'main:2');
});
test('group bounds expand and shrink in every direction without moving sibling tasks', () => {
  const doc = project(); doc.chapters = [{ id: 1, title: '章节' }]; doc.mainQuests.forEach(main => { main.chapterId = 1; });
  const graph = flow.buildQuestFlow(doc, null, 0);
  for (const delta of [{ x: -900, y: -700 }, { x: 1800, y: 900 }]) {
    const boxes = flow.layoutQuestFlowGroups(graph.nodes, graph.edges, graph.groups);
    flow.fitQuestFlowGroupBounds(boxes, graph.groups);
    const before = flow.questFlowAbsolutePositions(boxes), originalWidth = boxes.get('main:1').width;
    const moving = boxes.get('quest:0');
    moving.position = { x: moving.position.x + delta.x, y: moving.position.y + delta.y };
    flow.fitQuestFlowGroupBounds(boxes, graph.groups);
    const after = flow.questFlowAbsolutePositions(boxes);
    assert.deepEqual(plain(after.get('quest:0')), { x: before.get('quest:0').x + delta.x, y: before.get('quest:0').y + delta.y });
    assert.deepEqual(plain(after.get('quest:1')), plain(before.get('quest:1')));
    assert.deepEqual(plain(after.get('quest:2')), plain(before.get('quest:2')));
    assert.ok(boxes.get('main:1').width > originalWidth);
    for (const [id, box] of boxes) {
      if (!box.parentId) continue;
      const parent = boxes.get(box.parentId);
      assert.ok(box.position.x >= 26 && box.position.y >= 60, id);
      assert.ok(box.position.x + box.width <= parent.width - 26, id);
      assert.ok(box.position.y + box.height <= parent.height - 26, id);
    }
    const parent = after.get('main:1');
    moving.position = { x: before.get('quest:0').x - parent.x, y: before.get('quest:0').y - parent.y };
    flow.fitQuestFlowGroupBounds(boxes, graph.groups);
    assert.equal(boxes.get('main:1').width, originalWidth);
    const restored = flow.questFlowAbsolutePositions(boxes);
    for (const id of ['quest:0', 'quest:1', 'quest:2']) assert.deepEqual(plain(restored.get(id)), plain(before.get(id)));
    const stable = JSON.stringify([...boxes]);
    flow.fitQuestFlowGroupBounds(boxes, graph.groups);
    assert.equal(JSON.stringify([...boxes]), stable);
  }
});
async function testReactiveGraph() {
  const vue = require('vue');
  const filename = path.join(directory, 'QuestFlowGraph.vue');
  const source = parse(fs.readFileSync(filename, 'utf8')).descriptor.scriptSetup.content;
  const ast = ts.createSourceFile(filename + '.ts', source, ts.ScriptTarget.Latest, true);
  const script = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  const props = vue.reactive({ project: project(), selection: null });
  const stops = [], events = [], panDeltas = [], listeners = new Map();
  const editorActive = vue.ref(true);
  let unmount, deactivate;
  const context = vm.createContext({ ...flow, ref: vue.ref, computed: vue.computed, nextTick: vue.nextTick,
    studioEditorActiveKey: Symbol('studioEditorActive'), inject: () => () => editorActive.value,
    watch: (...args) => { const stop = vue.watch(...args); stops.push(stop); },
    onActivated() {}, onDeactivated(fn) { deactivate = fn; }, onBeforeUnmount(fn) { unmount = fn; }, defineProps: () => props,
    defineEmits: () => (event, id) => { events.push([event, id]); if (event === 'select') props.selection = { kind: 'sub', id }; },
    crypto: require('node:crypto'), MarkerType: { ArrowClosed: 'arrowclosed' }, toast: { warning() {} },
    useVueFlow: () => ({ fitView() {}, zoomIn() {}, zoomOut() {}, panBy(delta) { panDeltas.push(plain(delta)); } }),
    window: { addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); } },
  });
  vm.runInContext(`${script}\nglobalThis.api = { nodes, edges, connect, selectEdge, removeLink, selectNode, editNode, mainId, page, changeMain, dragStop, startCanvasPan, panning };`, context, { filename });
  const api = context.api;
  const absolutePositions = () => flow.questFlowAbsolutePositions(new Map(api.nodes.value.map(node => [node.id, { position: node.position, width: Number(node.width), height: Number(node.height), parentId: node.parentNode }])));
  try {
    const pointer = (button = 2, x = 100, y = 100, pointerId = 1) => ({ button, clientX: x, clientY: y, pointerId, preventDefault() {}, stopPropagation() {} });
    api.startCanvasPan(pointer(0)); assert.equal(listeners.size, 0);
    const beforePan = JSON.stringify(props.project);
    api.startCanvasPan(pointer()); assert.equal(api.panning.value, true);
    listeners.get('pointermove')(pointer(2, 500, 500, 2)); assert.equal(panDeltas.length, 0);
    listeners.get('pointermove')(pointer(2, 140, 125));
    listeners.get('pointermove')(pointer(2, 150, 105));
    assert.deepEqual(panDeltas, [{ x: 40, y: 25 }, { x: 10, y: -20 }]);
    listeners.get('pointerup')(pointer()); assert.equal(listeners.size, 0); assert.equal(api.panning.value, false);
    assert.equal(JSON.stringify(props.project), beforePan);
    const groupTarget = { closest(selector) { return selector === '.flow-group' ? this : null; } };
    api.startCanvasPan({ ...pointer(0), target: groupTarget });
    assert.equal(api.panning.value, true);
    listeners.get('pointermove')(pointer(0, 120, 140));
    assert.deepEqual(panDeltas.at(-1), { x: 20, y: 40 });
    listeners.get('pointerup')(pointer(0)); assert.equal(listeners.size, 0);
    for (const target of [{ closest() { return this; } }, { closest() { return null; } }]) {
      api.startCanvasPan({ ...pointer(0), target });
      assert.equal(listeners.size, 0, 'Left drags on headings, task cards and handles must stay with Vue Flow');
    }
    assert.equal(JSON.stringify(props.project), beforePan);
    api.startCanvasPan(pointer()); editorActive.value = false;
    assert.equal(listeners.size, 0); assert.equal(api.panning.value, false);
    api.startCanvasPan(pointer()); assert.equal(listeners.size, 0);
    editorActive.value = true;
    for (const finish of [() => listeners.get('pointercancel')(pointer()), () => listeners.get('blur')(), () => deactivate(), () => unmount()]) {
      api.startCanvasPan(pointer()); finish(); assert.equal(listeners.size, 0); assert.equal(api.panning.value, false);
    }
    console.log('PASS Group backgrounds pan with either button, headings retain left dragging, and pan listeners clean up'); count++;
    api.connect({ source: 'quest:0', target: 'quest:1', sourceHandle: 'next' });
    await vue.nextTick();
    assert.deepEqual(plain(props.project.subQuests[0].nextQuestIds), [1]);
    assert.equal(api.edges.value[0].target, 'quest:1');
    // Vue Flow computes a child's layer as max(parent.z, child.z) + 1.
    const effectiveZ = id => {
      const node = api.nodes.value.find(item => item.id === id);
      return node.parentNode ? Math.max(effectiveZ(node.parentNode), node.zIndex ?? 0) + 1 : node.zIndex ?? 0;
    };
    const edgeZ = api.edges.value[0].zIndex;
    for (const group of api.nodes.value.filter(node => node.type === 'quest-group')) assert.ok(edgeZ > effectiveZ(group.id), 'Group backgrounds must not wash out edges and labels');
    assert.ok(edgeZ < effectiveZ('quest:1'), 'Task cards should remain above the connecting paths');
    props.project.subQuests[0].nextQuestIds.push(2);
    await vue.nextTick();
    assert.equal(api.edges.value.length, 2);
    api.selectEdge({ edge: api.edges.value[0] }); api.removeLink(); await vue.nextTick();
    assert.deepEqual(plain(props.project.subQuests[0].nextQuestIds), [2]);
    assert.equal(api.edges.value.length, 1);
    api.connect({ source: 'quest:0', target: 'quest:1', sourceHandle: 'failure' }); await vue.nextTick();
    assert.equal(props.project.subQuests[0].failureQuestId, 1);
    api.selectNode({ node: api.nodes.value.find(n => n.id === 'quest:2') }); await vue.nextTick();
    assert.equal(props.selection.id, 2);
    api.editNode({ node: api.nodes.value.find(n => n.id === 'quest:2') });
    assert.ok(events.some(event => event[0] === 'edit' && event[1] === 2));
    api.dragStop({ nodes: [{ id: 'quest:2', position: { x: 750, y: 400 } }] });
    const movedPosition = plain(absolutePositions().get('quest:2'));
    props.project.subQuests[2].title = 'renamed'; await vue.nextTick();
    assert.deepEqual(plain(absolutePositions().get('quest:2')), movedPosition);
    const group = api.nodes.value.find(n => n.id === 'chapter:unassigned');
    const beforeGroupSelect = events.length;
    api.selectNode({ node: group }); api.editNode({ node: group });
    assert.equal(events.length, beforeGroupSelect);
    api.dragStop({ nodes: [{ ...group, position: { x: 1000, y: 200 } }] });
    props.project.mainQuests[0].title = '主任务改名'; await vue.nextTick();
    assert.deepEqual(plain(api.nodes.value.find(n => n.id === group.id).position), { x: 1000, y: 200 });
    const child = api.nodes.value.find(n => n.id === 'quest:2');
    assert.equal(child.parentNode, 'main:2');
    assert.equal(child.extent, undefined);
    assert.equal(props.project.subQuests[2].mainQuestId, 2);
    assert.ok(api.nodes.value.findIndex(n => n.id === 'chapter:unassigned') < api.nodes.value.findIndex(n => n.id === 'main:2'));
    assert.ok(api.nodes.value.findIndex(n => n.id === 'main:2') < api.nodes.value.findIndex(n => n.id === 'quest:2'));
    props.project = project(); await vue.nextTick();
    assert.equal(api.edges.value.length, 0);
    assert.notDeepEqual(plain(absolutePositions().get('quest:2')), movedPosition);
    console.log('PASS Actual graph handlers synchronize data, preserve free dragging and group moves, and reset for a new document'); count++;
  } finally { stops.forEach(stop => stop()); }
}
testReactiveGraph().then(() => console.log(`\n${count} quest flow tests passed.`)).catch(error => { console.error(error); process.exitCode = 1; });
