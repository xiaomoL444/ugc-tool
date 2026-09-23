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
console.log(`\n${passed} DSFG graph layout checks passed.`);
