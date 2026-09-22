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
    const { createEmptyDialogueProject, createFocusPushClip, normalizeDialogueProject, createDialogueNode, createSelectClip, createPerformanceClip, createConditionBranchNode, createConditionBranchOutput } = require(path.join(editorDirectory, "utils/dialogueProject.ts"));
    const { exportQxqyPerformance } = require(path.join(editorDirectory, "utils/qxqyPerformanceExporter.ts"));
    const { createQxqyStructWorkspace, createDefaultQxqyStructIds } = require(path.join(editorDirectory, "utils/qxqyStructWorkspace.ts"));
    const { selectOutletId, FOCUS_PUSH_OUTLET_ID, resolveGroupOutlets } = require(path.join(editorDirectory, "utils/groupOutlets.ts"));
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
      for (const item of groups) for (const action of table(item.value.ActionClip)) {
        assert.deepEqual(Object.keys(action.value), ['actionType', 'duration', 'stringParams', 'intParams', 'guidParams', 'configParams', 'prefabParams', 'floatParams']);
        for (const [key, type] of [['guidParams', 'GuidList'], ['configParams', 'ConfigReferenceList'], ['prefabParams', 'EntityReferenceList']]) {
          assert.equal(action.value[key].toParamNode().param_type, type);
          if (action.value.actionType.value !== "NOLOC_TRIGGERPUBLIC") assert.deepEqual(action.value[key].value, []);
        }
      }
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

    test("Dialogue params preserve ordered integer inputs through reload and reject invalid slots", () => {
      const source = createEmptyDialogueProject();
      const node = group(source, "params"); entry(source, "params");
      node.dialogue.nodeGraphEvent = ['0', '-2147483648', '2147483647', ' +002 ', '0'];
      const restored = normalizeDialogueProject(JSON.parse(JSON.stringify(source)));
      assert.deepEqual(restored.dialogue.nodes.params.dialogue.nodeGraphEvent, node.dialogue.nodeGraphEvent);
      assert.deepEqual(table(exported(restored).parsed.value.DialogueData)[0].value.prams.value, ['0', '-2147483648', '2147483647', '2', '0']);
      for (const invalid of ['', '-', '1.5', '2147483648', '-2147483649', 'abc']) {
        node.dialogue.nodeGraphEvent = ['1', invalid, '2'];
        assert.throws(() => exported(source), /第 2 个入参/);
      }
      node.dialogue.nodeGraphEvent = Array(100).fill('0');
      assert.equal(table(exported(source).parsed.value.DialogueData)[0].value.prams.value.length, 100);
      node.dialogue.nodeGraphEvent.push('0');
      assert.throws(() => exported(source), /100/);
      delete node.dialogue.nodeGraphEvent;
      assert.deepEqual(normalizeDialogueProject(source).dialogue.nodes.params.dialogue.nodeGraphEvent, []);
    });
    test("ActionClip imports eight typed fields and preserves reference lists with custom struct IDs", () => {
      const ids = { ...createDefaultQxqyStructIds(), actionClip: '99887766' };
      const workspace = createQxqyStructWorkspace(ids);
      const action = workspace.createDefault(ids.actionClip);
      action.value.guidParams.setValue(['18446744073709551615', '9007199254740993']);
      action.value.configParams.setValue(['1098907649']);
      action.value.prefabParams.setValue(['123456']);
      action.value.floatParams.setValue(['0.5', '1', '-0.25']);
      const raw = JSON.parse(action.serialize(2));
      assert.equal(raw.structId, ids.actionClip);
      assert.deepEqual(raw.value.slice(4).map(item => item.param_type), ['GuidList', 'ConfigReferenceList', 'EntityReferenceList', 'FloatList']);
      const parsed = workspace.parse(raw);
      assert.deepEqual(parsed.issues, []);
      assert.deepEqual(parsed.value.guidParams.value, ['18446744073709551615', '9007199254740993']);
      assert.deepEqual(parsed.value.configParams.value, ['1098907649']);
      assert.deepEqual(parsed.value.prefabParams.value, ['123456']);
      assert.deepEqual(parsed.value.floatParams.value.map(Number), [0.5, 1, -0.25]);
      assert.deepEqual(JSON.parse(parsed.serialize(2)), raw);
      const embedded = table(workspace.createDefault(ids.actionGroup).value.ActionClip)[0];
      assert.deepEqual(Object.keys(embedded.value), Object.keys(action.value));
      assert.equal(embedded.structId, ids.actionClip);
    });

    test("Entry-linked branch is global index zero; unconnected slots and empty expressions are retained", () => {
      const source = createEmptyDialogueProject();
      const conditions = ["", "  A\nB  ", "引号\"'与\\反斜杠"];
      branch(source, "branch", conditions);
      entry(source, "branch");
      const output = exported(source);
      assert.deepEqual(output.result.groupOrder, ["branch"]);
      assertBranch(output, "branch", conditions, [-1, -1, -1]);
      assert.equal(table(output.parsed.value.DialogueData).length, 0);
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
      assert.equal(table(output.parsed.value.DialogueData).length, 55);
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


    test("Public Event parameter schema maps event name and mixed typed values to separate lists", () => {
      const { applyPublicEventPreset, compilePublicEventArguments, getPublicEventClipLabel } = require(path.join(editorDirectory, "utils/publicEventParameters.ts"));
      const source = createEmptyDialogueProject();
      const node = group(source, "event"); entry(source, "event");
      const clip = createPerformanceClip("PublicEvent", 2);
      const preset = { id: "preset", alias: "打开大门", name: "OpenDoor", parameters: [
        { id: "a", name: "提示", type: "String", defaultValue: "hello" },
        { id: "b", name: "数量", type: "Int32", defaultValue: "-2" },
        { id: "c", name: "配置", type: "ConfigReference", defaultValue: "123" },
        { id: "d", name: "目标", type: "Guid", reference: "custom:characters:guid", defaultValue: "18446744073709551615" },
        { id: "e", name: "元件", type: "EntityReference", defaultValue: "456" },
        { id: "f", name: "文本2", type: "String", defaultValue: "tail" },
      ] };
      applyPublicEventPreset(clip, preset);
      assert.equal(getPublicEventClipLabel(clip, [preset]), "打开大门");
      assert.equal(getPublicEventClipLabel(clip, [{ ...preset, alias: "开门" }]), "开门");
      assert.equal(getPublicEventClipLabel(clip, []), "打开大门");
      const legacyClip = structuredClone(clip);
      delete legacyClip.components[0].properties.presetId;
      delete legacyClip.components[0].properties.presetAlias;
      assert.equal(getPublicEventClipLabel(legacyClip, [preset]), "打开大门");
      assert.equal(getPublicEventClipLabel(legacyClip, []), "公共事件");
      const params = clip.components[0].properties.parameters;
      assert.equal(params[3].reference, "custom:characters:guid");
      params[0].value = "edited";
      applyPublicEventPreset(clip, preset);
      assert.equal(clip.components[0].properties.parameters[0].value, "edited");
      preset.parameters[0].defaultValue = "later";
      assert.equal(clip.components[0].properties.parameters[0].value, "edited");
      node.lines.push({ id: "public", name: "Public", type: "PublicEvent", clips: [clip] });
      const restored = normalizeDialogueProject(JSON.parse(JSON.stringify(source)));
      assert.equal(restored.dialogue.nodes.event.lines.find(line => line.type === "PublicEvent").clips[0].components[0].properties.parameters[3].reference, "custom:characters:guid");
      const action = exported(restored).actions("event").find(a => a.value.actionType.value === "NOLOC_TRIGGERPUBLIC").value;
      assert.deepEqual(action.stringParams.value, ["OpenDoor", "edited", "tail"]);
      assert.deepEqual(action.intParams.value, ["-2"]);
      assert.deepEqual(action.configParams.value, ["123"]);
      assert.deepEqual(action.guidParams.value, ["18446744073709551615"]);
      assert.deepEqual(action.prefabParams.value, ["456"]);
      for (const [type, value] of [["Float", ""], ["Float", "NaN"], ["Float", "Infinity"], ["Float", "1e40"], ["Float", "0xFF"], ["Float", "0.5s"], ["Int32", "2147483648"], ["Guid", "1.5"], ["ConfigReference", "-1"], ["EntityReference", "bad"], ["Bogus", "0"]]) {
        assert.throws(() => compilePublicEventArguments("event", [{ name: "invalid", type, value }]), /不符合/);
      }
      const strings = Array.from({ length: 99 }, (_, i) => ({ type: "String", name: String(i), value: "" }));
      assert.equal(compilePublicEventArguments("event", strings).stringParams.length, 100);
      assert.throws(() => compilePublicEventArguments("event", [...strings, strings[0]]), /100/);
    });

    test("Simple black screen defaults survive reload and export string color plus ordered float timings", () => {
      const { applyPublicEventPreset } = require(path.join(editorDirectory, "utils/publicEventParameters.ts"));
      const { systemPresetConfig } = require(path.join(editorDirectory, "../EntityPresetEditor/systemPresetConfig.ts"));
      const source = createEmptyDialogueProject();
      const node = group(source, "black-screen"); entry(source, node.id);
      const clip = createPerformanceClip("PublicEvent", 0);
      applyPublicEventPreset(clip, systemPresetConfig.publicEvents.presets.find(item => item.name === "NOLOC_SimpleBlackScreen"));
      node.lines.push({ id: "black", name: "黑幕", type: "PublicEvent", clips: [clip] });
      const restored = normalizeDialogueProject(JSON.parse(JSON.stringify(source)));
      const action = exported(restored).actions(node.id).find(item => item.value.actionType.value === "NOLOC_TRIGGERPUBLIC").value;
      assert.deepEqual(action.stringParams.value, ["NOLOC_SimpleBlackScreen", "#000000FF"]);
      assert.deepEqual(action.intParams.value, []);
      assert.deepEqual(action.floatParams.value.map(Number), [0.5, 1, 0.5]);
    });

    test("Object entity forward event preserves its seven parameters in typed export lists", () => {
      const { applyPublicEventPreset, isPublicEventArgumentVisible, compilePublicEventArguments } = require(path.join(editorDirectory, "utils/publicEventParameters.ts"));
      const { systemPresetConfig } = require(path.join(editorDirectory, "../EntityPresetEditor/systemPresetConfig.ts"));
      const source = createEmptyDialogueProject();
      const node = group(source, "forward"); entry(source, node.id);
      const clip = createPerformanceClip("PublicEvent", 0);
      applyPublicEventPreset(clip, systemPresetConfig.publicEvents.presets.find(item => item.name === "NOLOC_SetObjectEntityFoward"));
      const values = ['1', '0', '18446744073709551615', 'actor', '1', '0', 'target'];
      clip.components[0].properties.parameters.forEach((param, index) => { param.value = values[index]; });
      node.lines.push({ id: "forward-line", name: "朝向", type: "PublicEvent", clips: [clip] });
      const action = exported(normalizeDialogueProject(JSON.parse(JSON.stringify(source)))).actions(node.id).find(item => item.value.actionType.value === "NOLOC_TRIGGERPUBLIC").value;
      assert.deepEqual(action.intParams.value, ['1', '0', '1']);
      assert.deepEqual(action.guidParams.value, ['18446744073709551615', '0']);
      assert.deepEqual(action.stringParams.value, ['NOLOC_SetObjectEntityFoward', '', 'target']);
      const args = clip.components[0].properties.parameters;
      const visible = () => args.filter(param => isPublicEventArgumentVisible(param, args)).map(param => param.id);
      assert.deepEqual(visible(), ['object-forward-boolean', 'object-forward-method-1', 'object-forward-guid-1', 'object-forward-method-2', 'object-forward-string-2']);
      args[0].value = '0';
      assert.deepEqual(visible(), ['object-forward-boolean', 'object-forward-method-1', 'object-forward-guid-1']);
      const reset = compilePublicEventArguments('NOLOC_SetObjectEntityFoward', args);
      assert.deepEqual(reset.intParams, ['0', '0', '0']);
      assert.deepEqual(reset.guidParams, ['18446744073709551615', '0']);
      assert.deepEqual(reset.stringParams, ['NOLOC_SetObjectEntityFoward', '', '']);
      assert.equal(args[6].value, 'target');
      args[1].value = '1';
      assert.deepEqual(visible(), ['object-forward-boolean', 'object-forward-method-1', 'object-forward-string-1']);
      const resetByString = compilePublicEventArguments('NOLOC_SetObjectEntityFoward', args);
      assert.deepEqual(resetByString.intParams, ['0', '1', '0']);
      assert.deepEqual(resetByString.guidParams, ['0', '0']);
      assert.deepEqual(resetByString.stringParams, ['NOLOC_SetObjectEntityFoward', 'actor', '']);
      args[0].value = '1'; args[1].value = '1'; args[4].value = '0';
      assert.deepEqual(visible(), ['object-forward-boolean', 'object-forward-method-1', 'object-forward-string-1', 'object-forward-method-2', 'object-forward-guid-2']);
      assert.deepEqual(compilePublicEventArguments('NOLOC_SetObjectEntityFoward', args).stringParams, ['NOLOC_SetObjectEntityFoward', 'actor', '']);
    });

    test("Public Event keeps multiple timed clips, parameters and identities through save/reload", () => {
      const { createPerformanceLine } = require(path.join(editorDirectory, "utils/dialogueProject.ts"));
      const { encodeDialogueProject, decodeDialogueProject } = require(path.join(editorDirectory, "utils/dialogueProjectCodec.ts"));
      const { getLineDefinitions } = require(path.join(editorDirectory, "config/lineRegistry.ts"));
      assert.ok(getLineDefinitions().some(line => line.type === "PublicEvent" && line.removable));
      const source = createEmptyDialogueProject();
      const node = group(source, "public"); entry(source, "public");
      const line = createPerformanceLine("PublicEvent"); node.lines.push(line);
      const values = ["event_a", "  公共事件  ", "", "event_a"];
      const durations = [0, 0.75, 3.5, 1];
      for (const [index, value] of values.entries()) {
        const clip = createPerformanceClip(line.type, index < 2 ? 0 : 2.5);
        assert.equal(clip.duration, 1);
        clip.duration = durations[index];
        clip.components[0].properties.value = value;
        line.clips.push(clip);
      }
      const restored = decodeDialogueProject(encodeDialogueProject(source));
      assert.deepEqual(restored.dialogue.nodes.public.lines[1], line);
      const output = exported(restored);
      const actions = output.actions("public").filter(action => action.value.actionType.value === "NOLOC_TRIGGERPUBLIC");
      assert.equal(actions.length, 4);
      assert.deepEqual(actions.map(action => action.value.stringParams.value), values.map(value => [value]));
      assert.deepEqual(actions.map(action => action.value.duration.value), durations.map(value => value.toFixed(2)));
      assert.ok(actions.every(action => action.value.intParams.value.length === 0));
      const { getGroupTimelineEnd } = require(path.join(editorDirectory, "utils/groupTimeline.ts"));
      assert.equal(getGroupTimelineEnd(restored.dialogue.nodes.public), 6);
      assert.deepEqual(output.byId.get("public").value.Timer.value.map(item => item.value.value), ["0.00", "2.50"]);
      assert.deepEqual(output.next("public"), ["-1"]);
      line.clips[0].components[0].properties.value = 12;
      assert.throws(() => exported(source), /PublicEvent.*字符串/);
    });

    test("Custom clips export exact strings directly to stringParams[0] and survive reload", () => {
      const source = createEmptyDialogueProject();
      const node = group(source, "custom");
      entry(source, "custom");
      const values = ["", "  中文 trigger \n 第二行  ", "event:123"];
      const clips = values.map((value, i) => {
        const clip = createPerformanceClip("Custom", i * 2);
        clip.duration = 0.75;
        clip.components[0].properties.value = value;
        return clip;
      });
      node.lines.push({ id: "custom-line", name: "Custom", type: "Custom", clips });
      const restored = normalizeDialogueProject(JSON.parse(JSON.stringify(source)));
      const output = exported(restored);
      const actions = output.actions("custom").filter(a => a.value.actionType.value === "NOLOC_TRIGGERCUSTOME");
      assert.deepEqual(actions.map(a => a.value.stringParams.value), values.map(value => [value]));
      assert.ok(actions.every(a => a.value.duration.value === "0.00" && a.value.intParams.value.length === 0));
      assert.equal(output.parsed.value.PlayerSkillData, undefined);
      assert.deepEqual(output.byId.get("custom").value.Timer.value.map(item => item.value.value), ["0.00", "2.00", "4.00"]);
      clips[0].components[0].properties.value = 42;
      assert.throws(() => exportQxqyPerformance(source), /触发参数必须是字符串/);
    });

    test("Instant clips ignore legacy durations in timeline, loading and export", () => {
      const { getGroupTimelineEnd } = require(path.join(editorDirectory, "utils/groupTimeline.ts"));
      for (const type of ["Custom"]) {
        const source = createEmptyDialogueProject();
        const node = group(source, "instant");
        const clip = createPerformanceClip(type, 5);
        assert.equal(clip.duration, 0);
        clip.duration = 100;
        node.lines.push({ id: type, type, name: type, clips: [clip] });
        assert.equal(getGroupTimelineEnd(node), 5);
        assert.equal(normalizeDialogueProject(source).dialogue.nodes.instant.lines[1].clips[0].duration, 0);
        const actionType = "NOLOC_TRIGGERCUSTOME";
        assert.equal(exported(source).actions("instant").find(a => a.value.actionType.value === actionType).value.duration.value, "0.00");
      }
    });

    test("Focus Push coexists with Dialogue and Select without changing ordinary outlet slots", () => {
      for (const optionCount of [undefined, 2, 99]) {
        const source = createEmptyDialogueProject();
        const node = group(source, "start", optionCount);
        node.focusPush = createFocusPushClip(2.5);
        group(source, "manual");
        branch(source, "automatic", ["condition"]);
        entry(source, "start");
        connect(source, "start", optionCount === undefined ? "next" : selectOutletId(node.select.options[0].id), "manual");
        connect(source, "start", FOCUS_PUSH_OUTLET_ID, "automatic");
        assert.deepEqual(resolveGroupOutlets(node).warnings, []);
        const output = exported(source);
        assert.deepEqual(output.result.groupOrder, ["start", "manual", "automatic"]);
        assert.deepEqual(output.next("start"), optionCount === undefined ? ["1", "2"] : ["1", ...Array(optionCount - 1).fill("-1"), "2"]);
        const action = output.actions("start").find(a => a.value.actionType.value === "NOLOC_FOCUSPUSH").value;
        assert.deepEqual(action.intParams.value, [String(optionCount ?? 1)]);
        assert.deepEqual(action.stringParams.value, ["NOLOC_Self"]);
        assert.equal(action.duration.value, "0.00");
        assert.deepEqual(output.byId.get("start").value.Timer.value.map(item => item.value.value), ["0.00", "2.50"]);
      }
    });

    test("Shared Focus Push uses the player outlet without adding a slot or following stale Self edges", () => {
      const source = createEmptyDialogueProject();
      const node = group(source, "start");
      node.focusPush = createFocusPushClip(2);
      node.focusPush.outputMode = "Shared";
      group(source, "manual"); group(source, "old-self");
      entry(source, "start");
      connect(source, "start", "next", "manual");
      connect(source, "start", FOCUS_PUSH_OUTLET_ID, "old-self");
      assert.deepEqual(resolveGroupOutlets(node).outlets.map(o => o.id), ["next"]);
      assert.deepEqual(resolveGroupOutlets(node).warnings, []);
      let output = exported(source);
      let action = output.actions("start").find(a => a.value.actionType.value === "NOLOC_FOCUSPUSH").value;
      assert.deepEqual(output.next("start"), ["1"]);
      assert.deepEqual(action.stringParams.value, ["NOLOC_Shared"]);
      assert.deepEqual(action.intParams.value, ["0"]);
      node.focusPush.outputMode = "Self";
      output = exported(source);
      action = output.actions("start").find(a => a.value.actionType.value === "NOLOC_FOCUSPUSH").value;
      assert.deepEqual(output.next("start"), ["1", "2"]);
      assert.deepEqual(action.stringParams.value, ["NOLOC_Self"]);
      assert.deepEqual(action.intParams.value, ["1"]);
      assert.equal(resolveGroupOutlets(node).outlets.length, 2);
    });

    test("Shared Focus Push exports each selected option index and preserves gaps and duplicate targets", () => {
      const source = createEmptyDialogueProject();
      const node = group(source, "start", 3);
      node.focusPush = createFocusPushClip(2);
      node.focusPush.outputMode = "Shared";
      group(source, "target");
      entry(source, "start");
      connect(source, "start", selectOutletId(node.select.options[0].id), "target");
      connect(source, "start", selectOutletId(node.select.options[2].id), "target");
      for (const index of [0, 1, 2]) {
        node.focusPush.sharedOutletIndex = index;
        const output = exported(source);
        assert.deepEqual(output.next("start"), ["1", "-1", "1"]);
        const action = output.actions("start").find(a => a.value.actionType.value === "NOLOC_FOCUSPUSH").value;
        assert.deepEqual(action.intParams.value, [String(index)]);
        assert.deepEqual(action.stringParams.value, ["NOLOC_Shared"]);
      }
      const restored = normalizeDialogueProject(JSON.parse(JSON.stringify(source)));
      assert.deepEqual(restored.dialogue.nodes.start.focusPush, node.focusPush);
      assert.deepEqual(exported(restored).next("start"), ["1", "-1", "1"]);
      for (const index of [-1, 3, 1.5]) {
        node.focusPush.sharedOutletIndex = index;
        assert.ok(resolveGroupOutlets(node).warnings.some(w => w.includes("共用出口不可用")));
        assert.throws(() => exported(source), /共用出口不可用/);
      }
      node.focusPush.sharedOutletIndex = 2;
      node.select.options.pop();
      assert.throws(() => exported(source), /共用出口不可用/);
      delete node.select;
      assert.equal(resolveGroupOutlets(node).outlets.length, 0);
      assert.throws(() => exported(source), /共用出口不可用/);
    });

    test("Shared Focus Push does not consume a slot at the 100-output limit; legacy clips default to Self", () => {
      const source = createEmptyDialogueProject();
      const node = group(source, "start", 100);
      node.focusPush = createFocusPushClip(2);
      node.focusPush.outputMode = "Shared";
      node.focusPush.sharedOutletIndex = 99;
      entry(source, "start");
      const output = exported(source);
      assert.equal(output.next("start").length, 100);
      const action = output.actions("start").find(a => a.value.actionType.value === "NOLOC_FOCUSPUSH").value;
      assert.deepEqual(action.intParams.value, ["99"]);
      delete node.focusPush.outputMode;
      delete node.focusPush.sharedOutletIndex;
      const restored = normalizeDialogueProject(source).dialogue.nodes.start;
      assert.equal(restored.focusPush.outputMode, "Self");
      assert.equal(restored.focusPush.sharedOutletIndex, 0);
    });

    test("Focus Push keeps duplicate target slots and indexes the second outlet", () => {
      const source = createEmptyDialogueProject();
      const node = group(source, "start");
      node.focusPush = createFocusPushClip(2);
      group(source, "target");
      entry(source, "start");
      connect(source, "start", "next", "target");
      connect(source, "start", FOCUS_PUSH_OUTLET_ID, "target");
      const output = exported(source);
      assert.deepEqual(output.next("start"), ["1", "1"]);
      const action = output.actions("start").find(a => a.value.actionType.value === "NOLOC_FOCUSPUSH").value;
      assert.deepEqual(action.intParams.value, ["1"]);
    });

    test("Focus Push counts towards the 100 NextGroup slot limit", () => {
      const source = createEmptyDialogueProject();
      const node = group(source, "start", 100);
      node.focusPush = createFocusPushClip(2);
      entry(source, "start");
      assert.throws(() => exportQxqyPerformance(source), /101.*100/);
    });

    test("Focus Push alone is a valid outlet; missing or invalid targets export -1", () => {
      for (const target of [undefined, "missing", "start"]) {
        const source = createEmptyDialogueProject();
        const node = group(source, "start");
        node.dialogue = undefined;
        node.focusPush = createFocusPushClip(0);
        entry(source, "start");
        if (target) connect(source, "start", FOCUS_PUSH_OUTLET_ID, target);
        assert.deepEqual(resolveGroupOutlets(node).warnings, []);
        const output = exported(source);
        assert.deepEqual(output.next("start"), ["-1"]);
        assert.equal(output.actions("start").length, 1);
        assert.deepEqual(output.actions("start")[0].value.intParams.value, ["0"]);
      }
    });

    test("Focus Push follows reconnection, shares timed buckets, and disappears after deletion", () => {
      const source = createEmptyDialogueProject();
      const node = group(source, "start");
      node.focusPush = createFocusPushClip(0);
      group(source, "first"); group(source, "second");
      entry(source, "start");
      connect(source, "start", FOCUS_PUSH_OUTLET_ID, "first");
      connect(source, "start", FOCUS_PUSH_OUTLET_ID, "second");
      const output = exported(source);
      assert.deepEqual(output.result.groupOrder, ["start", "second", "first"]);
      assert.deepEqual(output.next("start"), ["-1", "1"]);
      assert.equal(output.byId.get("start").value.Timer.itemCount, 1);
      assert.equal(output.actions("start").length, 2);
      assert.deepEqual(output.actions("start")[1].value.intParams.value, ["1"]);
      delete node.focusPush;
      assert.deepEqual(resolveGroupOutlets(node).outlets.map(outlet => outlet.id), ["next"]);
      assert.equal(exported(source).actions("start").some(a => a.value.actionType.value === "NOLOC_FOCUSPUSH"), false);
    });

    test("Focus Push time, identity and graph connection survive project save and reload", () => {
      const { encodeDialogueProject, decodeDialogueProject } = require(path.join(editorDirectory, "utils/dialogueProjectCodec.ts"));
      const { getGroupTimelineEnd } = require(path.join(editorDirectory, "utils/groupTimeline.ts"));
      const source = createEmptyDialogueProject();
      const node = group(source, "start");
      group(source, "target");
      node.focusPush = createFocusPushClip(12.3);
      entry(source, "start");
      connect(source, "start", FOCUS_PUSH_OUTLET_ID, "target");
      const restored = decodeDialogueProject(encodeDialogueProject(source));
      assert.deepEqual(restored.dialogue.nodes.start.focusPush, node.focusPush);
      assert.equal(getGroupTimelineEnd(restored.dialogue.nodes.start), 12.3);
      assert.deepEqual(exported(restored).actions("start").find(a => a.value.actionType.value === "NOLOC_FOCUSPUSH").value.intParams.value, ["1"]);
      node.focusPush.startTime = -5;
      assert.equal(normalizeDialogueProject(source).dialogue.nodes.start.focusPush.startTime, 0);
      delete node.focusPush;
      assert.equal(decodeDialogueProject(encodeDialogueProject(source)).dialogue.nodes.start.focusPush, undefined);
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
