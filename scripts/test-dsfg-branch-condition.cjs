/* Run with: node scripts/test-dsfg-branch-condition.cjs */
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
    const resolved = request.startsWith("@/")
      ? path.join(rootDirectory, "src", request.slice(2))
      : request;
    return originalLoad.call(this, resolved, parent, isMain);
  };
  Module._extensions[".ts"] = (module, filename) => {
    const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
      fileName: filename,
    });
    module._compile(compiled.outputText, filename);
  };

  try {
    const {
      createEmptyDialogueProject,
      createDialogueNode,
      createConditionBranchNode,
      createConditionBranchOutput,
    } = require(path.join(editorDirectory, "utils/dialogueProject.ts"));
    const { encodeDialogueProject, decodeDialogueProject } = require(path.join(editorDirectory, "utils/dialogueProjectCodec.ts"));
    const { exportQxqyPerformance } = require(path.join(editorDirectory, "utils/qxqyPerformanceExporter.ts"));
    const { createQxqyStructWorkspace } = require(path.join(editorDirectory, "utils/qxqyStructWorkspace.ts"));
    let passed = 0;
    function test(name, check) {
      check();
      passed += 1;
      console.log(`PASS ${name}`);
    }
    function project(conditions = ["", ""]) {
      const source = createEmptyDialogueProject();
      const branch = createConditionBranchNode("branch-0");
      branch.outputs.forEach((output, index) => { output.condition = conditions[index] ?? ""; });
      source.dialogue.conditionBranches[branch.id] = branch;
      source.graph.nodes.push({ id: branch.id, type: "condition", position: { x: 320, y: 180 }, data: { conditionBranchNodeId: branch.id } });
      for (let index = 0; index < 2; index += 1) {
        const id = `group-${index}`;
        source.dialogue.nodes[id] = createDialogueNode(id);
        source.graph.nodes.push({ id, type: "group", position: { x: 620, y: index * 200 }, data: { dialogueNodeId: id } });
        source.graph.edges.push({ id: `branch-edge-${index}`, source: branch.id, sourceHandle: branch.outputs[index].id, target: id, targetHandle: "input", type: "default" });
      }
      source.graph.edges.unshift({ id: "entry-branch", source: source.dialogue.entryNodeId, sourceHandle: "output", target: branch.id, targetHandle: "input" });
      return source;
    }
    const restored = (source) => decodeDialogueProject(encodeDialogueProject(source));
    const branchOf = (source) => source.dialogue.conditionBranches["branch-0"];
    const edgesOf = (source) => source.graph.edges.map((edge) => ({ id: edge.id, source: edge.source, sourceHandle: edge.sourceHandle, target: edge.target, targetHandle: edge.targetHandle }));

    test("Each new output has its own empty condition and the node has no shared condition", () => {
      const branch = createConditionBranchNode("new-branch");
      assert.equal(branch.id, "new-branch");
      assert.equal(branch.nodeType, "ConditionBranch");
      assert.equal(Object.hasOwn(branch, "condition"), false);
      assert.deepEqual(branch.outputs.map((output) => output.condition), ["", ""]);
      assert.equal(createConditionBranchOutput(2).condition, "");
      assert.deepEqual(branch.outputs.map((output) => output.label), ["分支 1", "分支 2"]);
      assert.equal(new Set(branch.outputs.map((output) => output.id)).size, 2);
      assert.equal(Object.hasOwn(branch, "timeline"), false);
      assert.equal(Object.hasOwn(branch, "lines"), false);
    });

    test("Each output preserves its own whitespace, line endings, quotes and arbitrary characters", () => {
      const samples = [
        "", "   ", "  player.level >= 10  ",
        "\t中文条件[\"角色\"] == '你好' && path == C:\\Camera\\Shot\r\n\t第二行\n结尾  ",
        "Literal ${value} and `backticks`; <tag>&amp;</tag> \\n \u0000",
      ];
      for (const condition of samples) {
        const otherCondition = `second output: ${condition}`;
        const source = project([condition, otherCondition]);
        const first = restored(source);
        const second = restored(first);
        assert.deepEqual(branchOf(first).outputs.map((output) => output.condition), [condition, otherCondition]);
        assert.deepEqual(branchOf(second).outputs.map((output) => output.condition), [condition, otherCondition]);
        assert.deepEqual(JSON.parse(encodeDialogueProject(source)).dialogue.conditionBranches["branch-0"].outputs.map((output) => output.condition), [condition, otherCondition]);
        assert.equal(Object.hasOwn(branchOf(second), "condition"), false);
      }
    });

    test("Missing and non-string output conditions normalize independently to an empty string", () => {
      for (const condition of [undefined, null, false, true, 0, 123, {}, { expression: "legacy" }, ["legacy"]]) {
        const source = project(["", "second output remains unchanged"]);
        if (condition === undefined) delete branchOf(source).outputs[0].condition;
        else branchOf(source).outputs[0].condition = condition;
        const decoded = decodeDialogueProject(JSON.stringify(source));
        assert.deepEqual(branchOf(decoded).outputs.map((output) => output.condition), ["", "second output remains unchanged"]);
        assert.equal(typeof branchOf(decoded).outputs[0].condition, "string");
        assert.equal(branchOf(restored(decoded)).outputs[0].condition, "");
      }
    });

    test("Legacy shared node conditions are not guessed or copied into output expressions", () => {
      const source = project();
      branchOf(source).condition = "legacy shared condition";
      delete branchOf(source).outputs[0].condition;
      delete branchOf(source).outputs[1].condition;
      const decoded = decodeDialogueProject(JSON.stringify(source));
      assert.equal(Object.hasOwn(branchOf(decoded), "condition"), false);
      assert.deepEqual(branchOf(decoded).outputs.map((output) => output.condition), ["", ""]);
      assert.equal(encodeDialogueProject(decoded).includes("legacy shared condition"), false);
    });

    test("Editing a condition leaves branch IDs, output IDs, graph connections and export IDs unchanged", () => {
      const source = project(["first original", "second remains"]);
      source.exportSettings.qxqyStructIds = Object.fromEntries(Object.keys(source.exportSettings.qxqyStructIds).map((key, index) => [key, String(4077936100 + index)]));
      const outputIds = branchOf(source).outputs.map((output) => output.id);
      const expectedEdges = edgesOf(source);
      const expectedNodeIds = source.graph.nodes.map((node) => node.id);
      const edited = "  custom_condition(\"A\", 'B')\nAND another  ";
      branchOf(source).outputs[0].condition = edited;
      const decoded = restored(source);
      assert.equal(branchOf(decoded).id, "branch-0");
      assert.deepEqual(branchOf(decoded).outputs.map((output) => output.condition), [edited, "second remains"]);
      assert.deepEqual(branchOf(decoded).outputs.map((output) => output.id), outputIds);
      assert.deepEqual(decoded.graph.nodes.map((node) => node.id), expectedNodeIds);
      assert.deepEqual(edgesOf(decoded), expectedEdges);
      assert.deepEqual(decoded.exportSettings.qxqyStructIds, source.exportSettings.qxqyStructIds);
      assert.deepEqual(decoded.graph.nodes.find((node) => node.id === "branch-0").data, { conditionBranchNodeId: "branch-0" });
    });

    test("Renaming and reordering outputs keeps each expression attached to its output ID", () => {
      const source = project(["condition A", "condition B"]);
      const branch = branchOf(source);
      const expressionsById = Object.fromEntries(branch.outputs.map((output) => [output.id, output.condition]));
      const originalEdges = edgesOf(source);
      const originalIds = branch.outputs.map((output) => output.id);
      branch.outputs[0].label = "重命名出口 A";
      branch.outputs[1].label = "重命名出口 B";
      branch.outputs.reverse();
      const decoded = restored(source);
      assert.deepEqual(branchOf(decoded).outputs.map((output) => output.id), [...originalIds].reverse());
      assert.deepEqual(branchOf(decoded).outputs.map((output) => output.label), ["重命名出口 B", "重命名出口 A"]);
      for (const output of branchOf(decoded).outputs) assert.equal(output.condition, expressionsById[output.id]);
      assert.deepEqual(edgesOf(decoded), originalEdges);
    });

    test("Adding and removing outputs does not transfer expressions between remaining outlets", () => {
      const source = project(["条件 A\n  keep spaces  ", "条件 B"]);
      const branch = branchOf(source);
      const originalOutputs = structuredClone(branch.outputs);
      const originalEdges = edgesOf(source);
      // Same business-data operations used by the node's add/delete controls.
      const third = createConditionBranchOutput(2);
      const fourth = createConditionBranchOutput(3);
      assert.equal(third.condition, "");
      assert.equal(fourth.condition, "");
      third.condition = "removed condition C";
      fourth.condition = "condition D";
      branch.outputs.push(third, fourth);
      assert.deepEqual(branch.outputs.slice(0, 2), originalOutputs);
      assert.equal(branchOf(restored(source)).outputs.length, 4);
      branch.outputs.splice(branch.outputs.findIndex((output) => output.id === third.id), 1);
      const decoded = restored(source);
      assert.deepEqual(branchOf(decoded).outputs, [...originalOutputs, fourth]);
      assert.deepEqual(edgesOf(decoded), originalEdges);
      assert.equal(new Set(branchOf(decoded).outputs.map((output) => output.id)).size, 3);
      assert.equal(encodeDialogueProject(decoded).includes("removed condition C"), false);
    });

    test("Branches with no outputs do not create shared conditions or Timeline data on reload", () => {
      const source = project(["removed A", "removed B"]);
      branchOf(source).outputs = [];
      // These outgoing connections no longer exist after the editor's normal cleanup.
      source.graph.edges = source.graph.edges.filter((edge) => edge.source !== "branch-0");
      const decoded = restored(source);
      assert.equal(Object.hasOwn(branchOf(decoded), "condition"), false);
      assert.deepEqual(branchOf(decoded).outputs, []);
      assert.equal(Object.hasOwn(branchOf(decoded), "timeline"), false);
      assert.equal(Object.hasOwn(decoded.dialogue.nodes, "branch-0"), false);
      assert.deepEqual(edgesOf(decoded), edgesOf(source));
    });

    test("Conditions stay inert while branch exports one NOLOC_BRANCH action at time zero", () => {
      globalThis.__dsfgBranchConditionExecuted = false;
      const condition = "(() => { globalThis.__dsfgBranchConditionExecuted = true; })()";
      const source = restored(project([condition, "another plain string"]));
      const result = exportQxqyPerformance(source);
      assert.equal(globalThis.__dsfgBranchConditionExecuted, false);
      assert.deepEqual(branchOf(source).outputs.map((output) => output.condition), [condition, "another plain string"]);
      assert.equal(result.warnings.some((warning) => warning.includes("条件判断分支尚未定义运行时结构")), false);
      assert.deepEqual(result.groupOrder, ["branch-0", "group-0", "group-1"]);
      const parsed = createQxqyStructWorkspace(source.exportSettings.qxqyStructIds).parse(result.value);
      const groups = parsed.value.ActionGroup.value.flatMap((entry) => entry.value.value);
      const branch = groups[0].value;
      assert.deepEqual(branch.Timer.value.map((entry) => [entry.key.value, entry.value.value]), [["0", "0.00"]]);
      assert.equal(branch.ActionClip.itemCount, 1);
      const actions = branch.ActionClip.value[0].value.value;
      assert.equal(actions.length, 1);
      assert.equal(actions[0].value.actionType.value, "NOLOC_BRANCH");
      assert.deepEqual(actions[0].value.stringParams.value, [condition, "another plain string"]);
      assert.deepEqual(actions[0].value.intParams.value, []);
      assert.deepEqual(branch.NextGroup.value, ["1", "2"]);
      assert.equal(globalThis.__dsfgBranchConditionExecuted, false);
    });

    console.log(`\n${passed} DSFG branch condition checks passed.`);
  } finally {
    Module._load = originalLoad;
    if (originalTypescriptExtension) Module._extensions[".ts"] = originalTypescriptExtension;
    else delete Module._extensions[".ts"];
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
