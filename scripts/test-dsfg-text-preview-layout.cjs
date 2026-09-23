/* Run with: node scripts/test-dsfg-text-preview-layout.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../src/views/DSFGStudio/components/DialogueEditor/utils/dialogueTextPreviewLayout.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: filename,
});
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = module.paths;
loaded._compile(compiled.outputText, filename);
const { layoutDialogueTextPreview } = loaded.exports;

let passed = 0;
function test(name, check) { check(); passed += 1; console.log(`PASS ${name}`); }
function block(id, outlets = 1, options = {}) {
  return { id, kind: "dialogue", title: id, nodeIds: [id], lines: [], outlets: Array.from({ length: outlets }, (_, index) => ({ id: `${id}-${index}` })), reachable: true, warnings: [], ...options };
}
function edge(source, target, outletIndex = 0, id = `${source}-${outletIndex}-${target}`) { return { id, source, target, outletIndex }; }
function graph(blocks, edges) { return { blocks, edges }; }
function rect(layout, id) { return layout.blocks.find((item) => item.id === id); }
function points(edgeLayout) { return Array.from(edgeLayout.path.matchAll(/[ML] ([\d.e+-]+) ([\d.e+-]+)/g), (match) => [Number(match[1]), Number(match[2])]); }
function validate(layout) {
  const epsilon = 0.00001;
  for (const item of layout.blocks) {
    assert.ok(item.x >= 0 && item.y >= 0 && item.width > 0 && item.height > 0, `valid rectangle ${item.id}`);
    assert.ok(item.x + item.width <= layout.width && item.y + item.height <= layout.height, `rectangle inside bounds ${item.id}`);
  }
  for (let i = 0; i < layout.blocks.length; i += 1) {
    for (let j = i + 1; j < layout.blocks.length; j += 1) {
      const a = layout.blocks[i];
      const b = layout.blocks[j];
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${a.id} and ${b.id} do not overlap`);
    }
  }
  for (const route of layout.edges) {
    assert.ok(Number.isFinite(route.labelX) && Number.isFinite(route.labelY));
    assert.ok(route.labelX >= 0 && route.labelX <= layout.width && route.labelY >= 0 && route.labelY <= layout.height);
    const vertices = points(route);
    assert.ok(vertices.length >= 4);
    vertices.forEach(([x, y]) => assert.ok(x >= 0 && x <= layout.width && y >= 0 && y <= layout.height, `edge ${route.id} inside bounds`));
    for (let index = 1; index < vertices.length; index += 1) {
      const [x1, y1] = vertices[index - 1];
      const [x2, y2] = vertices[index];
      assert.ok(x1 === x2 || y1 === y2, `edge ${route.id} is orthogonal`);
      for (const item of layout.blocks) {
        if (x1 === x2) {
          const crosses = x1 > item.x + epsilon && x1 < item.x + item.width - epsilon && Math.max(y1, y2) > item.y + epsilon && Math.min(y1, y2) < item.y + item.height - epsilon;
          assert.ok(!crosses, `vertical segment of ${route.id} avoids ${item.id}`);
        } else {
          const crosses = y1 > item.y + epsilon && y1 < item.y + item.height - epsilon && Math.max(x1, x2) > item.x + epsilon && Math.min(x1, x2) < item.x + item.width - epsilon;
          assert.ok(!crosses, `horizontal segment of ${route.id} avoids ${item.id}`);
        }
      }
    }
  }
}

test("Empty preview has finite usable bounds", () => {
  const result = layoutDialogueTextPreview(graph([], []));
  assert.deepEqual(result.blocks, []);
  assert.deepEqual(result.edges, []);
  assert.ok(result.width > 0 && result.height > 0);
});

test("A normal conversation proceeds from top to bottom", () => {
  const result = layoutDialogueTextPreview(graph([block("entry", 1, { kind: "entry" }), block("a"), block("b")], [edge("entry", "a"), edge("a", "b")]));
  assert.ok(rect(result, "entry").y < rect(result, "a").y && rect(result, "a").y < rect(result, "b").y);
  assert.equal(rect(result, "entry").x, rect(result, "a").x);
  assert.ok(result.edges.every((item) => !item.isReturn));
  validate(result);
});

test("Diamond branches follow outlet order and share one merge card", () => {
  const result = layoutDialogueTextPreview(graph([block("s", 2), block("right"), block("left"), block("merge")], [edge("s", "right", 1), edge("s", "left", 0), edge("right", "merge"), edge("left", "merge")]));
  assert.equal(rect(result, "left").y, rect(result, "right").y);
  assert.ok(rect(result, "left").x < rect(result, "right").x);
  assert.equal(result.blocks.filter((item) => item.id === "merge").length, 1);
  assert.ok(rect(result, "merge").y > rect(result, "left").y);
  validate(result);
});

test("Cycle-closing edge returns along an outside lane", () => {
  const result = layoutDialogueTextPreview(graph([block("a", 1, { kind: "entry" }), block("b"), block("c")], [edge("a", "b"), edge("b", "c"), edge("c", "a")]));
  assert.equal(result.edges.filter((item) => item.isReturn).length, 1);
  assert.equal(result.edges.find((item) => item.isReturn).id, "c-0-a");
  assert.ok(points(result.edges.find((item) => item.isReturn)).some(([x]) => x > Math.max(...result.blocks.map((item) => item.x + item.width))));
  validate(result);
});

test("Self-links remain visible and never enter the card", () => {
  const result = layoutDialogueTextPreview(graph([block("a")], [edge("a", "a")]));
  assert.equal(result.edges[0].isReturn, true);
  validate(result);
});

test("Long text heights reserve space before the next layer", () => {
  const input = graph([block("s", 2), block("a"), block("b"), block("merge")], [edge("s", "a", 0), edge("s", "b", 1), edge("a", "merge"), edge("b", "merge")]);
  const result = layoutDialogueTextPreview(input, { s: 77, a: 1300, b: 65, merge: 420 });
  assert.equal(rect(result, "a").height, 1300);
  assert.equal(rect(result, "b").height, 65);
  assert.ok(rect(result, "merge").y > rect(result, "a").y + 1300);
  validate(result);
});

test("Edges that skip a layer route around intervening text", () => {
  const input = graph([block("s", 2), block("a"), block("b"), block("c")], [edge("s", "a", 0), edge("a", "b"), edge("b", "c"), edge("s", "c", 1)]);
  const result = layoutDialogueTextPreview(input);
  const skipped = result.edges.find((item) => item.id === "s-1-c");
  assert.equal(skipped.isReturn, false);
  assert.ok(points(skipped).some(([x]) => x < Math.min(...result.blocks.map((item) => item.x))));
  validate(result);
});

test("Parallel edges retain separate paths and source ports", () => {
  const result = layoutDialogueTextPreview(graph([block("s", 3), block("a")], [edge("s", "a", 0, "first"), edge("s", "a", 1, "second"), edge("s", "a", 2, "third"), edge("s", "a", 0, "duplicate")]));
  assert.equal(result.edges.length, 4);
  assert.equal(new Set(result.edges.map((item) => item.path)).size, 4);
  assert.ok(points(result.edges[0])[0][0] < points(result.edges[1])[0][0]);
  assert.ok(points(result.edges[1])[0][0] < points(result.edges[2])[0][0]);
  validate(result);
});

test("Unreachable sections remain below the entry even if input order is reversed", () => {
  const input = graph([block("orphan", 1, { reachable: false }), block("a"), block("entry", 1, { kind: "entry" })], [edge("entry", "a"), edge("orphan", "a")]);
  const result = layoutDialogueTextPreview(input);
  assert.ok(rect(result, "orphan").y > rect(result, "a").y);
  assert.ok(rect(result, "entry").y < rect(result, "a").y);
  assert.equal(result.edges.find((item) => item.id === "orphan-0-a").isReturn, true);
  validate(result);
});

test("Multiple disconnected sections are deterministic and do not overlap", () => {
  const input = graph([block("orphan", 1, { reachable: false }), block("entry", 1, { kind: "entry" }), block("a"), block("other", 0, { reachable: false })], [edge("entry", "a")]);
  const first = layoutDialogueTextPreview(input);
  assert.deepEqual(first, layoutDialogueTextPreview(input));
  validate(first);
});

test("Invalid measurements fall back to the default height and dangling edges are ignored", () => {
  const input = graph([block("a"), block("b"), block("c")], [edge("a", "b"), edge("b", "c"), edge("missing", "a"), edge("c", "missing")]);
  const result = layoutDialogueTextPreview(input, { a: Number.NaN, b: -20, c: Number.POSITIVE_INFINITY });
  assert.ok(result.blocks.every((item) => item.height === 160));
  assert.equal(result.edges.length, 2);
  validate(result);
});

test("Complex branching with loops and long cards keeps every route out of every card", () => {
  const blocks = Array.from({ length: 64 }, (_, index) => block(String(index), 4, { kind: index === 0 ? "entry" : "dialogue", reachable: index < 56 }));
  const edges = [];
  for (let index = 0; index < blocks.length; index += 1) {
    if (index < 55) edges.push(edge(String(index), String(index + 1), 0));
    if (index % 3 === 0) edges.push(edge(String(index), String((index * 7 + 13) % blocks.length), 1));
    if (index % 5 === 0) edges.push(edge(String(index), String((index + 29) % blocks.length), 2));
    if (index % 11 === 0) edges.push(edge(String(index), String(index), 3));
  }
  const input = graph(blocks, edges);
  const heights = Object.fromEntries(blocks.map((item, index) => [item.id, 50 + index * 47 % 700]));
  const result = layoutDialogueTextPreview(input, heights);
  assert.equal(result.blocks.length, blocks.length);
  assert.equal(result.edges.length, edges.length);
  assert.deepEqual(result, layoutDialogueTextPreview(input, heights));
  validate(result);
});

test("Very long conversations are stack-safe and leave model data untouched", () => {
  const count = 4000;
  const input = graph(Array.from({ length: count }, (_, index) => block(String(index))), Array.from({ length: count - 1 }, (_, index) => edge(String(index), String(index + 1))));
  const original = JSON.stringify(input);
  const result = layoutDialogueTextPreview(input);
  assert.equal(result.blocks.length, count);
  assert.equal(result.edges.length, count - 1);
  assert.ok(rect(result, String(count - 1)).y > rect(result, "0").y);
  assert.equal(JSON.stringify(input), original);
});

console.log(`\n${passed} text preview layout tests passed.`);
