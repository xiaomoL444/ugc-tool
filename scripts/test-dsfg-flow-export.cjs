/* Run with: node scripts/test-dsfg-flow-export.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

async function main() {
  const variableLibrary = await import("miliastra-variable");
  const rootDirectory = path.resolve(__dirname, "..");
  const editorDirectory = path.join(rootDirectory, "src/views/DSFGStudio/components/DialogueEditor");
  const originalLoad = Module._load;
  const originalTypescriptExtension = Module._extensions[".ts"];
  Module._load = function (request, parent, isMain) {
    if (request === "miliastra-variable") return variableLibrary;
    return originalLoad.call(this, request.startsWith("@/") ? path.join(rootDirectory, "src", request.slice(2)) : request, parent, isMain);
  };
  Module._extensions[".ts"] = (module, filename) => {
    const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
      fileName: filename,
    });
    module._compile(compiled.outputText, filename);
  };

  try {
    const { createEmptyDialogueProject, createDialogueNode, createSelectClip, createPerformanceClip, createConditionBranchNode, createConditionBranchOutput } = require(path.join(editorDirectory, "utils/dialogueProject.ts"));
    const { exportQxqyPerformance } = require(path.join(editorDirectory, "utils/qxqyPerformanceExporter.ts"));
    const { createQxqyStructWorkspace, createDefaultQxqyStructIds } = require(path.join(editorDirectory, "utils/qxqyStructWorkspace.ts"));
    const { selectOutletId } = require(path.join(editorDirectory, "utils/groupOutlets.ts"));
    let passed = 0;
    function test(name, check) { check(); passed += 1; console.log(`PASS ${name}`); }
    const table = (dictionary) => dictionary.value.flatMap((entry) => entry.value.value);
    function addGraphNode(source, id, type) {
      source.graph.nodes.push({ id, type, position: { x: 0, y: 0 }, data: type === "condition" ? { conditionBranchNodeId: id } : { dialogueNodeId: id } });
    }
    function group(source, id, optionCount, onCanvas = true) {
      const node = createDialogueNode(id);
      node.name = id;
      if (optionCount !== undefined) {
        node.dialogue.advanceMode = "None";
        node.select = createSelectClip();
        node.select.id = `${id}-select`;
        node.select.options = Array.from({ length: optionCount }, (_, index) => ({ id: `${id}-option-${index}`, content: `${id} option ${index}`, icon: index + 10 }));
      }
      source.dialogue.nodes[id] = node;
      if (onCanvas) addGraphNode(source, id, "group");
      return node;
    }
    function branch(source, id, conditions, onCanvas = true) {
      const node = createConditionBranchNode(id);
      node.name = id;
      node.outputs = conditions.map((condition, index) => ({ ...createConditionBranchOutput(index), id: `${id}-out-${index}`, condition }));
      source.dialogue.conditionBranches[id] = node;
      if (onCanvas) addGraphNode(source, id, "condition");
      return node;
    }
    function connect(source, from, handle, to) {
      source.graph.edges.push({ id: `edge-${source.graph.edges.length}`, source: from, sourceHandle: handle, target: to, targetHandle: "input" });
    }
    function entry(source, to) { connect(source, source.dialogue.entryNodeId, "output", to); }
    function exported(source) {
      const result = exportQxqyPerformance(source);
      const parsed = createQxqyStructWorkspace(source.exportSettings.qxqyStructIds).parse(JSON.parse(result.json));
      assert.deepEqual(parsed.issues, []);
      const groups = table(parsed.value.ActionGroup);
      assert.equal(groups.length, result.groupOrder.length);
      const byId = new Map(result.groupOrder.map((id, index) => [id, groups[index]]));
      return { result, parsed, groups, byId, next: (id) => byId.get(id).value.NextGroup.value, actions: (id) => table(byId.get(id).value.ActionClip) };
    }
    function assertBranch(output, id, conditions, targets) {
      const value = output.byId.get(id).value;
      assert.deepEqual(value.Timer.value.map((item) => [item.key.value, item.value.value]), [["0", "0.00"]]);
      assert.equal(value.ActionClip.itemCount, 1);
      assert.equal(value.ActionClip.value[0].key.value, "0");
      const actions = output.actions(id);
      assert.equal(actions.length, 1);
      assert.equal(actions[0].value.actionType.value, "NOLOC_BRANCH");
      assert.deepEqual(actions[0].value.stringParams.value, conditions);
      assert.deepEqual(actions[0].value.intParams.value, []);
      assert.deepEqual(value.NextGroup.value, targets.map(String));
      assert.equal(value.NextGroup.value.length, conditions.length);
    }

    test("Entry-linked branch is global index zero; unconnected slots and empty expressions are retained", () => {
      const source = createEmptyDialogueProject();
      const conditions = ["", "  A\nB  ", "引号\"'与\\反斜杠"];
      branch(source, "branch", conditions);
      entry(source, "branch");
      const output = exported(source);
      assert.deepEqual(output.result.groupOrder, ["branch"]);
      assertBranch(output, "branch", conditions, [-1, -1, -1]);
      assert.equal(table(output.parsed.value.DialogueDate).length, 0);
      assert.equal(table(output.parsed.value.DialogueSelectData).length, 0);
      assert.equal(output.result.warnings.some((warning) => warning.includes("尚未定义运行时结构")), false);
    });

    test("Branch outlets preserve middle gaps and duplicate targets even when edges are shuffled", () => {
      const source = createEmptyDialogueProject();
      branch(source, "branch", ["A", "", "B", "A again"]);
      group(source, "tail-B"); group(source, "tail-A");
      connect(source, "branch", "branch-out-3", "tail-A");
      connect(source, "branch", "branch-out-2", "tail-B");
      connect(source, "branch", "branch-out-0", "tail-A");
      entry(source, "branch");
      const output = exported(source);
      assert.deepEqual(output.result.groupOrder, ["branch", "tail-A", "tail-B"]);
      assertBranch(output, "branch", ["A", "", "B", "A again"], [1, -1, 2, 1]);
      assert.deepEqual(output.next("tail-A"), ["-1"]);
      assert.deepEqual(output.next("tail-B"), ["-1"]);
    });

    test("Branch reorder changes expressions, target slots and DFS consistently by stable outlet IDs", () => {
      const source = createEmptyDialogueProject();
      const node = branch(source, "branch", ["A", "gap", "B", "A again"]);
      group(source, "tail-A"); group(source, "tail-B");
      connect(source, "branch", "branch-out-3", "tail-A");
      connect(source, "branch", "branch-out-0", "tail-A");
      connect(source, "branch", "branch-out-2", "tail-B");
      entry(source, "branch");
      node.outputs = [node.outputs[2], node.outputs[0], node.outputs[1], node.outputs[3]];
      const output = exported(source);
      assert.deepEqual(output.result.groupOrder, ["branch", "tail-B", "tail-A"]);
      assertBranch(output, "branch", ["B", "A", "gap", "A again"], [1, 2, -1, 2]);
    });

    test("Select keeps unconnected positions, duplicate targets and current option order", () => {
      const source = createEmptyDialogueProject();
      const node = group(source, "choice", 4);
      group(source, "tail-A"); group(source, "tail-B");
      connect(source, "choice", selectOutletId("choice-option-3"), "tail-A");
      connect(source, "choice", selectOutletId("choice-option-0"), "tail-A");
      connect(source, "choice", selectOutletId("choice-option-2"), "tail-B");
      entry(source, "choice");
      const before = exported(source);
      assert.deepEqual(before.result.groupOrder, ["choice", "tail-A", "tail-B"]);
      assert.deepEqual(before.next("choice"), ["1", "-1", "2", "1"]);
      node.select.options = [node.select.options[2], node.select.options[1], node.select.options[0], node.select.options[3]];
      const after = exported(source);
      assert.deepEqual(after.result.groupOrder, ["choice", "tail-B", "tail-A"]);
      assert.deepEqual(after.next("choice"), ["1", "-1", "2", "2"]);
      const selectData = table(after.parsed.value.DialogueSelectData)[0].value;
      assert.deepEqual(selectData.content.value, node.select.options.map((option) => option.content));
      assert.deepEqual(selectData.icons.value, ["12", "11", "10", "13"]);
    });

    test("Dialogue and branch invalid or missing targets retain -1 rather than deleting slots", () => {
      const source = createEmptyDialogueProject();
      for (const id of ["unconnected", "missing", "self", "entry-target", "graph-only-target"]) group(source, id);
      addGraphNode(source, "graph-only", "group");
      connect(source, "missing", "next", "does-not-exist");
      connect(source, "self", "next", "self");
      connect(source, "entry-target", "next", source.dialogue.entryNodeId);
      connect(source, "graph-only-target", "next", "graph-only");
      const conditions = ["missing", "self", "entry", "graph only", "unconnected"];
      branch(source, "invalid-branch", conditions);
      for (const [index, target] of [[0, "does-not-exist"], [1, "invalid-branch"], [2, source.dialogue.entryNodeId], [3, "graph-only"]]) connect(source, "invalid-branch", `invalid-branch-out-${index}`, target);
      entry(source, "invalid-branch");
      const output = exported(source);
      assertBranch(output, "invalid-branch", conditions, [-1, -1, -1, -1, -1]);
      for (const id of ["unconnected", "missing", "self", "entry-target", "graph-only-target"]) assert.deepEqual(output.next(id), ["-1"]);
      assert.equal(output.result.groupOrder.includes("graph-only"), false);
    });

    test("Mixed Group/branch cycles traverse outlet-order DFS once with a shared index space", () => {
      const source = createEmptyDialogueProject();
      group(source, "D");
      branch(source, "C", ["back A", "gap", "to D"]);
      group(source, "A", 2);
      branch(source, "B", ["to A", "to C"]);
      connect(source, "C", "C-out-2", "D");
      connect(source, "A", selectOutletId("A-option-1"), "C");
      connect(source, "B", "B-out-1", "C");
      connect(source, "D", "next", "B");
      connect(source, "C", "C-out-0", "A");
      connect(source, "A", selectOutletId("A-option-0"), "D");
      connect(source, "B", "B-out-0", "A");
      entry(source, "B");
      const output = exported(source);
      assert.deepEqual(output.result.groupOrder, ["B", "A", "D", "C"]);
      assert.equal(new Set(output.result.groupOrder).size, 4);
      assertBranch(output, "B", ["to A", "to C"], [1, 3]);
      assert.deepEqual(output.next("A"), ["2", "3"]);
      assert.deepEqual(output.next("D"), ["0"]);
      assertBranch(output, "C", ["back A", "gap", "to D"], [1, -1, 2]);
    });

    test("Disconnected canvas nodes and business nodes without canvas nodes are appended", () => {
      const source = createEmptyDialogueProject();
      group(source, "A"); branch(source, "B", ["A"]);
      branch(source, "orphan-branch", [""]); group(source, "orphan-group");
      group(source, "hidden-group", undefined, false); branch(source, "hidden-branch", ["hidden"], false);
      connect(source, "hidden-branch", "hidden-branch-out-0", "hidden-group");
      connect(source, "B", "B-out-0", "A"); entry(source, "B");
      const output = exported(source);
      assert.deepEqual(output.result.groupOrder.slice(0, 4), ["B", "A", "orphan-branch", "orphan-group"]);
      assert.deepEqual([...output.result.groupOrder].sort(), ["B", "A", "orphan-branch", "orphan-group", "hidden-group", "hidden-branch"].sort());
      assertBranch(output, "hidden-branch", ["hidden"], [output.result.groupOrder.indexOf("hidden-group")]);
      assert.ok(output.result.warnings.some((warning) => warning.includes("orphan-branch")));
      assert.ok(output.result.warnings.some((warning) => warning.includes("hidden-branch")));
    });

    test("Without an Entry connection fallback still includes both business node kinds", () => {
      const source = createEmptyDialogueProject();
      group(source, "first-group"); branch(source, "second-branch", [""]);
      connect(source, "first-group", "next", "second-branch");
      const output = exported(source);
      assert.deepEqual(output.result.groupOrder, ["first-group", "second-branch"]);
      assert.deepEqual(output.next("first-group"), ["1"]);
      assertBranch(output, "second-branch", [""], [-1]);
      assert.ok(output.result.warnings.some((warning) => warning.includes("开始节点")));
    });

    test("Custom IDs propagate through branch ActionGroups without shifting separate data-table indices", () => {
      const source = createEmptyDialogueProject();
      branch(source, "B", ["go"]);
      const node = group(source, "G", 2);
      node.lines[0].clips.push(createPerformanceClip("Camera"));
      connect(source, "B", "B-out-0", "G");
      connect(source, "G", selectOutletId("G-option-0"), "B");
      entry(source, "B");
      const originalIds = createDefaultQxqyStructIds();
      source.exportSettings.qxqyStructIds = Object.fromEntries(Object.keys(originalIds).map((key, index) => [key, String(5077936100 + index)]));
      const output = exported(source);
      assert.deepEqual(output.result.groupOrder, ["B", "G"]);
      assertBranch(output, "B", ["go"], [1]);
      assert.deepEqual(output.next("G"), ["0", "-1"]);
      const actions = output.actions("G");
      assert.deepEqual(actions.find((action) => action.value.actionType.value === "NOLOC_DIALOG").value.intParams.value, ["0"]);
      assert.deepEqual(actions.find((action) => action.value.actionType.value === "NOLOC_DIALOG_SELECT").value.intParams.value, ["0"]);
      const cameraAction = actions.find((action) => action.value.actionType.value === "NOLOC_CAMERA");
      assert.deepEqual(cameraAction.value.intParams.value, ["0"]);
      assert.deepEqual(cameraAction.value.stringParams.value, []);
      const actualIds = new Set();
      function walk(value) {
        if (!value || typeof value !== "object") return;
        for (const [key, child] of Object.entries(value)) {
          if (key === "structId" || key === "value_structId") actualIds.add(child);
          else walk(child);
        }
      }
      walk(output.result.value);
      for (const id of actualIds) assert.ok(Object.values(source.exportSettings.qxqyStructIds).includes(id));
      for (const id of Object.values(originalIds)) assert.equal(actualIds.has(id), false);
      assert.equal(output.groups[0].structId, source.exportSettings.qxqyStructIds.actionGroup);
      assert.equal(output.actions("B")[0].structId, source.exportSettings.qxqyStructIds.actionClip);
    });

    test("110 mixed branch/Group nodes cross 100-item chunks using unchanged global NextGroup indices", () => {
      const source = createEmptyDialogueProject();
      const ids = Array.from({ length: 110 }, (_, index) => `node-${index}`);
      ids.forEach((id, index) => index % 2 === 0 ? branch(source, id, [`condition ${index}`]) : group(source, id));
      source.graph.nodes = [source.graph.nodes[0], ...source.graph.nodes.slice(1).reverse()];
      for (let index = 108; index >= 0; index -= 1) connect(source, ids[index], index % 2 === 0 ? `${ids[index]}-out-0` : "next", ids[index + 1]);
      entry(source, ids[0]);
      const output = exported(source);
      assert.deepEqual(output.result.groupOrder, ids);
      assert.deepEqual(output.parsed.value.ActionGroup.value.map((chunk) => [chunk.key.value, chunk.value.itemCount]), [["0", 100], ["1", 10]]);
      assert.deepEqual(output.next("node-99"), ["100"]);
      assertBranch(output, "node-100", ["condition 100"], [101]);
      assert.deepEqual(output.next("node-109"), ["-1"]);
      assert.equal(table(output.parsed.value.DialogueDate).length, 55);
      ids.forEach((id, index) => assert.deepEqual(output.next(id), [index === 109 ? "-1" : String(index + 1)]));
    });

    test("Zero-output branches, Groups and Selects export empty NextGroup and warn", () => {
      const source = createEmptyDialogueProject();
      branch(source, "empty-branch", []);
      const noOutputGroup = group(source, "empty-group");
      noOutputGroup.dialogue.advanceMode = "None";
      group(source, "empty-select", 0);
      entry(source, "empty-branch");
      const output = exported(source);
      assertBranch(output, "empty-branch", [], []);
      for (const id of ["empty-branch", "empty-group", "empty-select"]) {
        assert.deepEqual(output.next(id), []);
        assert.ok(output.result.warnings.some((warning) => warning.includes(id) && warning.includes("出口")));
      }
    });

    for (const kind of ["branch", "select"]) {
      test(`${kind} accepts exactly 100 outputs and rejects 101 instead of truncating lists`, () => {
        const source = createEmptyDialogueProject();
        const node = kind === "branch" ? branch(source, "wide", Array.from({ length: 100 }, (_, index) => `condition ${index}`)) : group(source, "wide", 100);
        entry(source, "wide");
        const output = exported(source);
        assert.deepEqual(output.next("wide"), Array(100).fill("-1"));
        if (kind === "branch") {
          assertBranch(output, "wide", node.outputs.map((item) => item.condition), Array(100).fill(-1));
          node.outputs.push({ ...createConditionBranchOutput(100), condition: "condition 100" });
        } else {
          assert.equal(table(output.parsed.value.DialogueSelectData)[0].value.content.value.length, 100);
          node.select.options.push({ id: "overflow", content: "option 100", icon: 0 });
        }
        assert.throws(() => exportQxqyPerformance(source), /100/);
      });
    }

    test("Conflicting Dialogue plus 100 Select outputs rejects the combined 101 NextGroup slots", () => {
      const source = createEmptyDialogueProject();
      const node = group(source, "conflicting", 100);
      node.dialogue.advanceMode = "PlayerInput";
      entry(source, "conflicting");
      assert.throws(() => exportQxqyPerformance(source), /100/);
    });
    console.log(`\n${passed} DSFG flow export checks passed.`);
  } finally {
    Module._load = originalLoad;
    if (originalTypescriptExtension) Module._extensions[".ts"] = originalTypescriptExtension;
    else delete Module._extensions[".ts"];
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
