/* Run with: node scripts/test-dsfg-scene-graph.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc');
const base = path.resolve(__dirname, '../src/views/DSFGStudio/components/SceneEditor');
function transpile(source) { return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText; }
const moduleContext = { exports: {} };
vm.runInNewContext(transpile(fs.readFileSync(path.join(base, 'sceneGraph.ts'), 'utf8')), moduleContext);
const { buildSceneGraph } = moduleContext.exports;
function sample() {
  return { worlds: [{ id: '0', name: '主世界', contacts: [{ key: '02', x: '1.5', y: '-2', z: '3' }] }, { id: '2', name: '第二世界', contacts: [{ key: '0', x: '0', y: '0', z: '0' }] }],
    mainAreas: [{ id: '0', name: '主区域', worldId: '00' }, { id: '2', name: '另一区域', worldId: '2' }],
    subAreas: [{ id: '0', name: '地点', mainAreaId: '00', bgm: '0' }] };
}
function verifyBounds(graph) {
  const seen = new Map();
  for (const box of graph.boxes) {
    assert.ok(Number.isFinite(box.width) && Number.isFinite(box.height));
    if (box.parentId) {
      const parent = seen.get(box.parentId);
      assert.ok(parent, 'Parent precedes child');
      assert.ok(box.position.x >= 0 && box.position.y >= 64, 'Children leave room for the group heading');
      assert.ok(box.position.x + box.width <= parent.width);
      assert.ok(box.position.y + box.height <= parent.height);
    }
    for (const sibling of seen.values()) if (sibling.parentId === box.parentId) {
      const a = sibling.position, b = box.position;
      assert.ok(a.x + sibling.width <= b.x || b.x + box.width <= a.x || a.y + sibling.height <= b.y || b.y + box.height <= a.y, 'Siblings do not overlap');
    }
    seen.set(box.id, box);
  }
}
const project = sample(), before = JSON.stringify(project);
const graph = buildSceneGraph(project);
assert.equal(graph.boxes.length, 5); verifyBounds(graph);
assert.equal(graph.boxes.find(box => box.id === 'main:0').parentId, 'world:0');
assert.equal(graph.boxes.find(box => box.id === 'sub:0').parentId, 'main:0');
assert.equal(graph.edges[0].source, 'world:0'); assert.equal(graph.edges[0].target, 'world:1');
assert.equal(graph.edges[1].source, 'world:1'); assert.equal(graph.edges[1].target, 'world:0');
assert.ok(graph.edges[0].label.includes('1.5, -2, 3'));
assert.equal(JSON.stringify(project), before);
console.log('PASS nested hierarchy, zero/padded IDs, directed reciprocal contacts and unchanged scene data');

const orphan = sample();
orphan.mainAreas[0].worldId = '999'; orphan.subAreas.push({ id: '9', name: '孤立地点', mainAreaId: '999', bgm: '0' });
orphan.worlds[0].contacts.push({ key: '999', x: '0', y: '0', z: '0' });
const orphanGraph = buildSceneGraph(orphan); verifyBounds(orphanGraph);
assert.equal(orphanGraph.boxes.filter(box => box.data.selection).length, 6);
assert.equal(orphanGraph.warnings.length, 1); assert.equal(orphanGraph.edges.length, 2);
assert.ok(orphanGraph.boxes.some(box => box.id === 'unassigned-world'));
assert.ok(orphanGraph.boxes.some(box => box.id === 'unassigned-main'));
const crowded = sample();
for (let i = 1; i <= 40; i++) crowded.subAreas.push({ id: String(i), name: `地点${i}`, mainAreaId: i % 2 ? '0' : '2', bgm: '0' });
const expanded = buildSceneGraph(crowded); verifyBounds(expanded);
assert.ok(expanded.boxes.find(box => box.id === 'world:0').height > graph.boxes.find(box => box.id === 'world:0').height);
assert.equal(buildSceneGraph({ worlds: [], mainAreas: [], subAreas: [] }).boxes.length, 0);
verifyBounds(buildSceneGraph({ worlds: [{ id: '0', name: '', contacts: [] }], mainAreas: [], subAreas: [] }));
console.log('PASS orphan regions remain visible, invalid links report warnings, empty and growing groups fit their contents');

async function main() {
  const filename = path.join(base, 'SceneGraph.vue');
  const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  assert.deepEqual(errors, []);
  const script = compileScript(descriptor, { id: 'scene-graph-test' });
  assert.deepEqual(compileTemplate({ filename, id: 'scene-graph-test', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
  for (const style of descriptor.styles) assert.deepEqual(compileStyle({ filename, id: 'scene-graph-test', source: style.content, scoped: true }).errors, []);
  const ast = ts.createSourceFile(filename, descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const source = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n');
  const props = vue.reactive({ project: sample(), selection: { kind: 'world', index: 0 } });
  const listeners = new Map(), emitted = [], pans = [], hooks = {};
  const editorActive = vue.ref(true);
  const scope = vue.effectScope();
  const ctx = vm.createContext({ ...vue, buildSceneGraph, crypto: { randomUUID: () => 'test' },
    studioEditorActiveKey: Symbol('studioEditorActive'), inject: () => () => editorActive.value,
    defineProps: () => props, defineEmits: () => (...event) => emitted.push(event),
    useVueFlow: () => ({ fitView() {}, zoomIn() {}, zoomOut() {}, panBy: delta => pans.push(delta) }),
    MarkerType: { ArrowClosed: 'arrowclosed' },
    onActivated: fn => { hooks.activate = fn; }, onDeactivated: fn => { hooks.deactivate = fn; }, onBeforeUnmount: fn => { hooks.unmount = fn; },
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
  });
  try {
    scope.run(() => vm.runInContext(transpile(source + '\nglobalThis.api = { nodes, edges, remember, sync, arrange, selectNode, editNode, startPan, panning };'), ctx));
    const api = ctx.api;
    const saved = JSON.stringify(props.project);
    api.remember({ node: { id: 'world:0', position: { x: -100, y: 500 } } });
    props.project.worlds[0].name = '改名'; await vue.nextTick();
    assert.equal(api.nodes.value.find(node => node.id === 'world:0').position.x, -100);
    api.selectNode({ node: api.nodes.value.find(node => node.id === 'sub:0') });
    assert.equal(emitted[0][0], 'select'); assert.equal(emitted[0][1].kind, 'sub');
    api.editNode({ node: api.nodes.value.find(node => node.id === 'main:0') }); assert.equal(emitted[1][0], 'edit');
    assert.ok(api.edges.value.every(edge => edge.style.strokeWidth === 3 && edge.markerEnd.color === '#185abd'));
    const event = { button: 2, pointerId: 1, clientX: 10, clientY: 20, target: { closest: () => null }, preventDefault() {}, stopPropagation() {} };
    api.startPan(event); assert.equal(api.panning.value, true);
    listeners.get('pointermove')({ ...event, clientX: 40, clientY: 45 });
    assert.equal(pans[0].x, 30); assert.equal(pans[0].y, 25);
    hooks.deactivate(); assert.equal(listeners.size, 0); assert.equal(api.panning.value, false);
    api.startPan(event); editorActive.value = false;
    assert.equal(listeners.size, 0); assert.equal(api.panning.value, false);
    api.startPan(event); assert.equal(listeners.size, 0);
    editorActive.value = true;
    api.startPan({ ...event, button: 0, target: { closest: selector => selector === '.area-group' ? {} : null } });
    assert.equal(api.panning.value, true, 'Left drag on a group background pans');
    listeners.get('pointercancel')(event); assert.equal(listeners.size, 0);
    api.startPan({ ...event, button: 0, target: { closest: () => ({}) } });
    assert.equal(api.panning.value, false, 'Left drag on the heading remains available for moving its world');
    hooks.activate(); api.arrange(); assert.equal(api.nodes.value[0].position.x, 0);
    props.project.worlds[0].name = '主世界'; assert.equal(JSON.stringify(props.project), saved);
    props.project = sample(); await vue.nextTick(); assert.equal(api.nodes.value.length, 5);
    api.startPan(event); hooks.unmount(); assert.equal(listeners.size, 0);
    console.log('PASS graph template compiles; selection, edit, view-only dragging, connection styling and pan cleanup work');
  } finally { scope.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
