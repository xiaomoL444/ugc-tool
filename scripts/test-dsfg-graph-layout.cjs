/* Run with: node scripts/test-dsfg-graph-layout.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const filename = path.resolve(__dirname, "../src/views/DSFGStudio/components/DialogueEditor/utils/dialogueGraphLayout.ts");
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = module.paths;
loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { layoutDialogueGraph } = loaded.exports;
const node = (id, extra = {}) => ({ id, type: "group", position: { x: 0, y: 0 }, data: { dialogueNodeId: id }, ...extra });
const edge = (source, target, id = `${source}-${target}`) => ({ id, source, target, sourceHandle: "next", targetHandle: "input" });
let passed = 0;
function test(name, run) { run(); console.log(`PASS ${name}`); passed++; }
function noOverlap(nodes, sizes) {
  for (const a of nodes) {
    assert.ok(Number.isFinite(a.position.x) && Number.isFinite(a.position.y));
    for (const b of nodes) {
      if (a.id === b.id) continue;
      const sa = sizes.get(a.id), sb = sizes.get(b.id);
      assert.ok(a.position.x + sa.width <= b.position.x || b.position.x + sb.width <= a.position.x
        || a.position.y + sa.height <= b.position.y || b.position.y + sb.height <= a.position.y,
      `${a.id} and ${b.id} overlap`);
    }
  }
}
test("An empty graph is supported", () => assert.deepEqual(layoutDialogueGraph({ nodes: [], edges: [] }), []));
test("A dialogue chain flows left to right and preserves all non-position fields", () => {
  const graph = { nodes: [node("start", { type: "entry" }), node("a", { selected: true }), node("b")], edges: [edge("start", "a"), edge("a", "b")] };
  const before = structuredClone(graph);
  const result = layoutDialogueGraph(graph);
  assert.ok(result[0].position.x < result[1].position.x && result[1].position.x < result[2].position.x);
  result.forEach((item, i) => assert.deepEqual({ ...item, position: before.nodes[i].position }, before.nodes[i]));
  assert.deepEqual(graph, before);
});
test("Branches, a merge, and disconnected nodes use measured dimensions without overlap", () => {
  const graph = { nodes: [node("s"), node("a"), node("b"), node("merge"), node("loose")], edges: [edge("s", "a"), edge("s", "b"), edge("a", "merge"), edge("b", "merge")] };
  const sizes = new Map(graph.nodes.map((n, i) => [n.id, { width: 230 + i * 80, height: 90 + i * 160 }]));
  const result = layoutDialogueGraph(graph, sizes);
  noOverlap(result, sizes);
  const byId = Object.fromEntries(result.map(n => [n.id, n]));
  assert.equal(byId.a.position.x + sizes.get("a").width / 2, byId.b.position.x + sizes.get("b").width / 2);
  assert.notEqual(byId.a.position.y, byId.b.position.y);
  assert.ok(byId.merge.position.x > byId.a.position.x);
  assert.deepEqual(layoutDialogueGraph({ ...graph, nodes: result }, sizes), result);
});
test("Loops, parallel outlets, and dangling edges do not lose nodes or connections", () => {
  const graph = { nodes: [node("a"), node("b"), node("c")], edges: [edge("a", "b"), edge("a", "b", "other-option"), edge("b", "c"), edge("c", "a"), edge("a", "a"), edge("missing", "c")] };
  const before = structuredClone(graph);
  const sizes = new Map(graph.nodes.map(n => [n.id, { width: 252, height: 180 }]));
  const result = layoutDialogueGraph(graph, sizes);
  noOverlap(result, sizes);
  assert.deepEqual(graph, before);
  assert.equal(result.length, 3);
});
test("Hidden nodes retain their position and zero measurements use finite fallbacks", () => {
  const hidden = node("hidden", { hidden: true, position: { x: -123, y: 456 } });
  const result = layoutDialogueGraph({ nodes: [node("a"), hidden], edges: [edge("a", "hidden")] }, new Map([["a", { width: 0, height: NaN }]]));
  assert.equal(result[1], hidden);
  assert.ok(Number.isFinite(result[0].position.x) && Number.isFinite(result[0].position.y));
});
test("Editor supplies visible outlet order using business references for both node kinds", () => {
  const { parse } = require('@vue/compiler-sfc');
  const source = fs.readFileSync(path.resolve(path.dirname(filename), '../DialogueEditor.vue'), 'utf8');
  const script = parse(source).descriptor.scriptSetup.content;
  const ast = ts.createSourceFile('editor.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const handler = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ApplyGraphLayout').getText(ast);
  const project = { graph: { nodes: [node('visual-group', { data: { dialogueNodeId: 'group' } }), node('visual-branch', { type: 'condition', data: { conditionBranchNodeId: 'branch' } })], edges: [] },
    dialogue: { nodes: { group: { outlets: [{ id: 'select:z' }, { id: 'select:a' }] } }, conditionBranches: { branch: { outputs: [{ id: 'last-id-first' }, { id: 'first-id-last' }] } } } };
  require('node:vm').runInNewContext(ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText + '; ApplyGraphLayout(project);', {
    project, findNode: () => ({ dimensions: { width: 252, height: 180 } }), resolveGroupOutlets: group => group,
    layoutDialogueGraph(graph, sizes, order) {
      assert.deepEqual(Array.from(order.get('visual-group')), ['select:z', 'select:a']);
      assert.deepEqual(Array.from(order.get('visual-branch')), ['last-id-first', 'first-id-last']);
      assert.equal(sizes.size, 2);
      return graph.nodes;
    },
  });
});
test("Four option branches stay in outlet order even when nodes and edges were created backwards", () => {
  const targets = ['first', 'second', 'third', 'fourth'];
  const handles = ['select:z', 'select:a', 'select:q', 'select:b'];
  const graph = { nodes: [node('source'), ...targets.slice().reverse().map(id => node(id)), node('merge')],
    edges: targets.slice().reverse().flatMap(id => [
      { ...edge('source', id), sourceHandle: handles[targets.indexOf(id)] }, edge(id, 'merge'),
    ]) };
  const before = structuredClone(graph);
  const sizes = new Map(graph.nodes.map((n, i) => [n.id, { width: 252, height: 130 + i * 25 }]));
  const order = new Map([['source', handles]]);
  for (const edges of [graph.edges, graph.edges.slice().reverse()]) {
    const result = layoutDialogueGraph({ ...graph, edges }, sizes, order);
    const byId = Object.fromEntries(result.map(n => [n.id, n]));
    targets.slice(1).forEach((id, i) => assert.ok(byId[targets[i]].position.y < byId[id].position.y));
    noOverlap(result, sizes);
    assert.deepEqual(layoutDialogueGraph({ ...graph, nodes: result, edges }, sizes, order), result);
  }
  const reversed = layoutDialogueGraph(graph, sizes, new Map([['source', handles.slice().reverse()]]));
  const byId = Object.fromEntries(reversed.map(n => [n.id, n]));
  assert.ok(byId.fourth.position.y < byId.third.position.y && byId.third.position.y < byId.second.position.y && byId.second.position.y < byId.first.position.y);
  assert.deepEqual(graph, before);
});
test("Condition outlets, duplicate targets, empty slots and conflicting shared orders remain safe", () => {
  const graph = { nodes: [node('s', { type: 'condition' }), node('other'), node('a'), node('b'), node('end')], edges: [
    { ...edge('s', 'b'), sourceHandle: 'branch-last' },
    { ...edge('s', 'a'), sourceHandle: 'branch-first' },
    { ...edge('s', 'a', 'duplicate'), sourceHandle: 'branch-duplicate' },
    { ...edge('other', 'b'), sourceHandle: 'first' },
    { ...edge('other', 'a'), sourceHandle: 'last' },
    edge('a', 'end'), edge('b', 'end'), edge('end', 's'),
  ] };
  const before = structuredClone(graph);
  const sizes = new Map(graph.nodes.map(n => [n.id, { width: 252, height: 180 }]));
  const result = layoutDialogueGraph(graph, sizes, new Map([
    ['s', ['branch-first', 'missing-slot', 'branch-duplicate', 'branch-last']], ['other', ['first', 'last']],
  ]));
  noOverlap(result, sizes);
  assert.equal(result.length, graph.nodes.length);
  assert.deepEqual(graph, before);
});
console.log(`\n${passed} DSFG graph layout checks passed.`);
