/* Run with: node scripts/test-dsfg-text-preview.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const previousExtension = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  });
  module._compile(result.outputText, filename);
};

try {
  const { buildDialogueTextPreview: preview } = require(path.resolve(__dirname, "../src/views/DSFGStudio/components/DialogueEditor/utils/dialogueTextPreview.ts"));
  let passed = 0;
  const test = (name, run) => { run(); passed++; console.log(`PASS ${name}`); };
  function project(withEntry = true) {
    return {
      schemaVersion: 12,
      exportSettings: { qxqyStructIds: {} },
      dialogue: { tree: {}, entryNodeId: withEntry ? "start" : undefined, nodes: {}, conditionBranches: {} },
      graph: { nodes: withEntry ? [{ id: "start", type: "entry", position: { x: 0, y: 0 }, data: {} }] : [], edges: [] },
    };
  }
  function group(source, id, options, graphId = id) {
    const node = {
      id, name: id, nodeType: "Dialogue", durationMode: "Auto", timeline: { maxLines: 8, duration: 1 }, lines: [],
      dialogue: { id: `${id}-dialogue`, style: "Default_UI", speaker: `speaker ${id}`, content: `text ${id}`, subtitle: `subtitle ${id}`, startTime: 0, continueDelayTime: 0.5, advanceMode: options ? "None" : "PlayerInput", nodeGraphEvent: [] },
    };
    if (options) node.select = { id: `${id}-select`, style: "Default_UI", startTime: 0, continueDelayTime: 0.5, options: options.map((content, index) => ({ id: `option-${index}`, content, icon: 0 })) };
    source.dialogue.nodes[id] = node;
    if (graphId !== null) source.graph.nodes.push({ id: graphId, type: "group", position: { x: 999, y: 999 }, data: { dialogueNodeId: id } });
    return node;
  }
  function condition(source, id, expressions, graphId = id) {
    const node = { id, name: id, nodeType: "ConditionBranch", outputs: expressions.map((expression, index) => ({ id: `branch-${index}`, label: `出口 ${index + 1}`, condition: expression })) };
    source.dialogue.conditionBranches[id] = node;
    if (graphId !== null) source.graph.nodes.push({ id: graphId, type: "condition", position: { x: 0, y: 0 }, data: { conditionBranchNodeId: id } });
    return node;
  }
  function connect(source, from, to, sourceHandle = "next") {
    source.graph.edges.push({ id: `edge-${source.graph.edges.length}`, source: from, target: to, sourceHandle });
  }
  const find = (result, nodeId) => result.blocks.find((block) => block.nodeIds.includes(nodeId));
  const edgeTo = (result, nodeId) => result.edges.filter((edge) => edge.target === find(result, nodeId).id);

  test("Empty project and entry-only project are supported", () => {
    assert.deepEqual(preview(project(false)), { blocks: [], edges: [] });
    const result = preview(project());
    assert.equal(result.blocks.length, 1);
    assert.equal(result.blocks[0].kind, "entry");
    assert.equal(result.blocks[0].reachable, true);
    assert.equal(result.blocks[0].outlets[0].connected, false);
  });

  test("Sequential dialogue follows edges, merges paragraphs, and ignores coordinates/next cache", () => {
    const source = project();
    group(source, "C"); group(source, "B"); group(source, "A").next = ["C"];
    connect(source, "B", "C"); connect(source, "A", "B"); connect(source, "start", "A");
    const result = preview(source);
    assert.deepEqual(result.blocks.map((block) => block.nodeIds), [["start"], ["A", "B", "C"]]);
    assert.deepEqual(find(result, "A").lines.map((line) => [line.speaker, line.content, line.subtitle]), ["A", "B", "C"].map((id) => [`speaker ${id}`, `text ${id}`, `subtitle ${id}`]));
    assert.equal(find(result, "A").outlets[0].connected, false);
    assert.equal(result.edges.length, 1);
  });

  test("Select terminates a merged passage and preserves option text/order and empty outlets", () => {
    const source = project(); group(source, "A"); group(source, "S", [" 选择一\n", "", "第三项"]); group(source, "B"); group(source, "C");
    connect(source, "start", "A"); connect(source, "A", "S");
    connect(source, "S", "C", "select:option-2"); connect(source, "S", "B", "select:option-0");
    const result = preview(source);
    assert.deepEqual(result.blocks.map((block) => block.nodeIds), [["start"], ["A", "S"], ["B"], ["C"]]);
    assert.equal(find(result, "S").kind, "select");
    assert.deepEqual(find(result, "S").outlets.map((outlet) => [outlet.text, outlet.connected]), [[" 选择一\n", true], ["", false], ["第三项", true]]);
    assert.deepEqual(result.edges.filter((edge) => edge.source === find(result, "S").id).map((edge) => edge.outletIndex), [0, 2]);
  });

  test("Condition expressions are per outlet, literal and traversed in declared order", () => {
    const source = project(); condition(source, "Q", ["  flag == '你好'\n", "globalThis.shouldNeverRun = 1", ""]); group(source, "B"); group(source, "A");
    connect(source, "Q", "B", "branch-1"); connect(source, "Q", "A", "branch-0"); connect(source, "start", "Q");
    const result = preview(source);
    assert.deepEqual(result.blocks.map((block) => block.nodeIds), [["start"], ["Q"], ["A"], ["B"]]);
    assert.deepEqual(find(result, "Q").outlets.map((outlet) => outlet.text), ["  flag == '你好'\n", "globalThis.shouldNeverRun = 1", ""]);
    assert.equal(globalThis.shouldNeverRun, undefined);
    assert.equal(find(result, "Q").lines.length, 0);
  });

  test("Merges stop at joins, so both incoming paths reach a shared passage", () => {
    const source = project(); condition(source, "Q", ["left", "right"]); ["A", "B", "Join", "Tail"].forEach((id) => group(source, id));
    connect(source, "start", "Q"); connect(source, "Q", "A", "branch-0"); connect(source, "Q", "B", "branch-1"); connect(source, "A", "Join"); connect(source, "B", "Join"); connect(source, "Join", "Tail");
    const result = preview(source);
    assert.deepEqual(find(result, "Join").nodeIds, ["Join", "Tail"]);
    assert.notEqual(find(result, "A"), find(result, "Join"));
    assert.notEqual(find(result, "B"), find(result, "Join"));
    assert.equal(edgeTo(result, "Join").length, 2);
  });

  test("Branches returning to earlier dialogue preserve that target boundary and back edge", () => {
    const source = project(); ["A", "B"].forEach((id) => group(source, id)); condition(source, "Q", ["back", "end"]);
    connect(source, "start", "A"); connect(source, "A", "B"); connect(source, "B", "Q"); connect(source, "Q", "B", "branch-0");
    const result = preview(source);
    assert.notEqual(find(result, "A"), find(result, "B"));
    assert.ok(result.edges.some((edge) => edge.source === find(result, "Q").id && edge.target === find(result, "B").id));
    assert.equal(result.blocks.flatMap((block) => block.nodeIds).filter((id) => id === "B").length, 1);
  });

  test("Pure single-chain cycle keeps a return edge after passage compression", () => {
    const source = project(false); ["A", "B", "C"].forEach((id) => group(source, id));
    connect(source, "A", "B"); connect(source, "B", "C"); connect(source, "C", "A");
    const result = preview(source);
    assert.deepEqual(result.blocks[0].nodeIds, ["A", "B", "C"]);
    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].source, result.edges[0].target);
    assert.equal(result.blocks[0].reachable, false);
  });

  test("Reachable loop back to first passage keeps entry and return connections", () => {
    const source = project(); group(source, "A"); group(source, "B");
    connect(source, "start", "A"); connect(source, "A", "B"); connect(source, "B", "A");
    const result = preview(source);
    assert.deepEqual(find(result, "A").nodeIds, ["A", "B"]);
    assert.equal(edgeTo(result, "A").length, 2);
    assert.equal(find(result, "B").reachable, true);
  });

  test("Two outlets to one target are not deduplicated and mark a join", () => {
    const source = project(); group(source, "S", ["one", "two"]); group(source, "A");
    connect(source, "start", "S"); connect(source, "S", "A", "select:option-1"); connect(source, "S", "A", "select:option-0");
    const result = preview(source);
    assert.deepEqual(edgeTo(result, "A").map((edge) => edge.outletIndex), [0, 1]);
    assert.equal(new Set(result.edges.map((edge) => edge.id)).size, result.edges.length);
  });

  test("Orphan chains still merge in flow order despite reversed registration", () => {
    const source = project(); group(source, "B"); group(source, "A"); group(source, "Hidden", undefined, null); condition(source, "HiddenCondition", [""], null);
    connect(source, "A", "B");
    const result = preview(source);
    assert.deepEqual(find(result, "A").nodeIds, ["A", "B"]);
    assert.equal(find(result, "B").reachable, false);
    assert.equal(find(result, "Hidden").reachable, false);
    assert.ok(find(result, "HiddenCondition"));
  });

  test("Graph aliases map to business IDs, including repeated views and hidden nodes", () => {
    const source = project(); group(source, "A", undefined, "view-A"); condition(source, "Q", ["go"], "view-Q"); group(source, "Hidden", undefined, null);
    source.graph.nodes.push({ id: "view-A-duplicate", type: "group", position: { x: 0, y: 0 }, data: { dialogueNodeId: "A" } });
    connect(source, "start", "view-A"); connect(source, "view-A-duplicate", "view-Q"); connect(source, "view-Q", "Hidden", "branch-0");
    const result = preview(source);
    assert.deepEqual(result.blocks.map((block) => block.nodeIds), [["start"], ["A"], ["Q"], ["Hidden"]]);
    assert.equal(result.blocks.every((block) => block.reachable), true);
  });

  test("Only legal source handles count; latest reconnected outlet wins", () => {
    const source = project(); group(source, "A"); group(source, "B"); group(source, "C"); condition(source, "Q", ["valid"]);
    connect(source, "start", "Q"); connect(source, "Q", "A", "invalid"); connect(source, "Q", "B", "branch-0"); connect(source, "Q", "C", "branch-0");
    const result = preview(source);
    assert.equal(find(result, "A").reachable, false);
    assert.equal(find(result, "B").reachable, false);
    assert.equal(find(result, "C").reachable, true);
    assert.deepEqual(result.edges.filter((edge) => edge.source === find(result, "Q").id).map((edge) => edge.target), [find(result, "C").id]);
  });

  test("Output nodes and legacy entry/next handles are preserved", () => {
    const source = project(); group(source, "A");
    source.graph.nodes.push({ id: "finish", type: "output", position: { x: 0, y: 0 }, data: {} });
    connect(source, "start", "A", "output"); connect(source, "A", "finish", null);
    const result = preview(source);
    assert.deepEqual(result.blocks.map((block) => block.kind), ["entry", "dialogue", "output"]);
    assert.equal(find(result, "finish").reachable, true);
    assert.deepEqual(find(result, "finish").outlets, []);
  });

  test("No dialogue, empty choices, conflicting requesters and dangling targets retain warnings", () => {
    const source = project(); const empty = group(source, "Empty", []); delete empty.dialogue;
    condition(source, "NoBranch", []); group(source, "Broken"); const conflict = group(source, "Conflict", ["option"]); conflict.dialogue.advanceMode = "PlayerInput";
    connect(source, "Broken", "missing");
    const result = preview(source);
    assert.equal(find(result, "Empty").lines[0].hasDialogue, false);
    assert.equal(find(result, "Empty").outlets.length, 0);
    for (const id of ["Empty", "NoBranch", "Broken", "Conflict"]) assert.ok(find(result, id).warnings.length > 0);
    assert.equal(find(result, "Broken").outlets[0].connected, false);
    assert.deepEqual(find(result, "Conflict").outlets.map((outlet) => outlet.kind), ["next", "select"]);
  });

  test("Project is deeply immutable and returned text is not a live business-data reference", () => {
    const source = project(); group(source, "A", [" literal "]); connect(source, "start", "A");
    const before = JSON.stringify(source);
    function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } }
    freeze(source);
    const result = preview(source);
    find(result, "A").lines[0].content = "changed projection";
    find(result, "A").outlets[0].text = "changed projection";
    assert.equal(JSON.stringify(source), before);
  });

  test("Long chains do not use recursive traversal or lose nodes", () => {
    const source = project(); const count = 12000;
    for (let index = 0; index < count; index++) { group(source, `G${index}`); connect(source, index ? `G${index - 1}` : "start", `G${index}`); }
    const result = preview(source);
    assert.equal(result.blocks.length, 2);
    assert.equal(result.blocks[1].lines.length, count);
    assert.equal(result.blocks[1].lines[count - 1].nodeId, `G${count - 1}`);
  });
  console.log(`\n${passed} text preview checks passed.`);
} finally {
  if (previousExtension) Module._extensions[".ts"] = previousExtension;
  else delete Module._extensions[".ts"];
}
