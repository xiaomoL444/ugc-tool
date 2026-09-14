/* Run with: node scripts/test-dsfg-text-navigation.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { parse, compileScript, compileTemplate } = require("@vue/compiler-sfc");

const editorDirectory = path.resolve(__dirname, "../src/views/DSFGStudio/components/DialogueEditor");
const copy = (value) => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function transpile(source, filename, module = ts.ModuleKind.None) {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module }, fileName: filename,
  }).outputText;
}
function readSfc(name) {
  const filename = path.join(editorDirectory, name);
  const source = fs.readFileSync(filename, "utf8");
  const parsed = parse(source, { filename });
  const scriptAst = ts.createSourceFile(filename + ".ts", parsed.descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return {
    filename, source, parsed, descriptor: parsed.descriptor,
    functionText(name) {
      const statement = scriptAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
      assert.ok(statement, `Missing actual component handler: ${name}`);
      return statement.getText(scriptAst);
    },
  };
}
function elements(root) {
  return [root, ...(root.children ?? []).flatMap(elements)].filter((node) => node.type === 1);
}
function directive(node, name, argument) {
  return node.props?.find((property) => property.type === 7 && property.name === name && property.arg?.content === argument);
}
function modifiers(property) {
  return (property?.modifiers ?? []).map((modifier) => typeof modifier === "string" ? modifier : modifier.content);
}
function withClass(nodes, className) {
  const node = nodes.find((node) => node.props.some((property) => property.type === 6 && property.name === "class" && property.value?.content.split(/\s+/).includes(className)));
  assert.ok(node, `Missing rendered element .${className}`);
  return node;
}
function project() {
  return {
    dialogue: {
      nodes: { A: { id: "A", dialogue: { content: "第一句" } }, B: { id: "B", dialogue: { content: "第二句" }, select: { options: ["选项"] } }, orphan: { id: "orphan" } },
      conditionBranches: { A: { id: "A", outputs: [] } },
    },
    graph: {
      nodes: [
        { id: "entry", type: "entry", data: {}, position: { x: 120, y: 80 }, draggable: false },
        { id: "view-A", type: "group", data: { dialogueNodeId: "A" }, position: { x: 480, y: 80 }, selected: true },
        { id: "view-B", type: "group", data: { dialogueNodeId: "B" }, position: { x: 840, y: 80 } },
        { id: "condition-A", type: "condition", data: { conditionBranchNodeId: "A" }, position: { x: 1200, y: 80 }, selected: true },
        { id: "output", type: "output", data: {}, position: { x: 1560, y: 80 } },
      ],
      edges: [{ id: "edge", source: "entry", target: "view-A", selected: true }],
    },
  };
}
function block(kind = "select", nodeIds = ["A", "B"]) {
  return { id: "block-A", kind, title: "合并卡片", nodeIds, lines: nodeIds.map((nodeId) => ({ nodeId })), outlets: [], warnings: [], reachable: true };
}

async function main() {
  let passed = 0;
  async function test(name, run) { await run(); passed += 1; console.log(`PASS ${name}`); }
  const navigationFilename = path.join(editorDirectory, "utils/dialogueTextNavigation.ts");
  const moduleContext = { exports: {} };
  vm.runInNewContext(transpile(fs.readFileSync(navigationFilename, "utf8"), navigationFilename, ts.ModuleKind.CommonJS), moduleContext, { timeout: 1000 });
  const { getTextPreviewNavigationTarget: targetFor, resolveTextPreviewGraphNodeId: graphIdFor } = moduleContext.exports;
  const editor = readSfc("DialogueEditor.vue");
  const preview = readSfc("DialogueTextPreview.vue");

  await test("Both real Vue SFC scripts and templates compile", () => {
    for (const component of [editor, preview]) {
      assert.deepEqual(component.parsed.errors, []);
      const script = compileScript(component.descriptor, { id: "dsfg-text-navigation-test" });
      const template = compileTemplate({ filename: component.filename, id: "dsfg-text-navigation-test", source: component.descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } });
      assert.deepEqual(template.errors, []);
    }
  });
  await test("Merged card background targets its first Group and the second line targets its own Group", () => {
    assert.deepEqual(copy(targetFor(block())), { nodeId: "A", kind: "select" });
    assert.deepEqual(copy(targetFor(block(), "B")), { nodeId: "B", kind: "select" });
  });
  await test("Select outlets target the last Group rather than the first line", () => {
    assert.deepEqual(copy(targetFor(block(), undefined, true)), { nodeId: "B", kind: "select" });
  });
  await test("Missing lines and empty cards do not invent a navigation target", () => {
    assert.equal(targetFor(block(), "missing"), undefined);
    assert.equal(targetFor(block("dialogue", [])), undefined);
    assert.equal(targetFor(block("select", []), undefined, true), undefined);
  });
  await test("Conditions and terminal cards preserve their distinct target kind", () => {
    for (const kind of ["condition", "entry", "output"]) {
      assert.deepEqual(copy(targetFor(block(kind, ["node"]))), { nodeId: "node", kind });
    }
  });
  await test("Business IDs resolve to canvas aliases, including Select cards", () => {
    assert.equal(graphIdFor(project(), { nodeId: "A", kind: "dialogue" }), "view-A");
    assert.equal(graphIdFor(project(), { nodeId: "B", kind: "select" }), "view-B");
    assert.equal(graphIdFor(project(), { nodeId: "view-A", kind: "dialogue" }), undefined);
  });
  await test("Group and condition with the same business ID never resolve to each other", () => {
    assert.equal(graphIdFor(project(), { nodeId: "A", kind: "condition" }), "condition-A");
    assert.equal(graphIdFor(project(), { nodeId: "A", kind: "select" }), "view-A");
    assert.equal(graphIdFor(project(), { nodeId: "entry", kind: "entry" }), "entry");
    assert.equal(graphIdFor(project(), { nodeId: "output", kind: "output" }), "output");
    assert.equal(graphIdFor(project(), { nodeId: "entry", kind: "dialogue" }), undefined);
    assert.equal(graphIdFor(project(), { nodeId: "output", kind: "entry" }), undefined);
  });
  await test("Old same-ID graph nodes and data-based condition nodes remain addressable", () => {
    const source = project();
    source.graph.nodes = [
      { id: "legacy", type: "group", data: {} },
      { id: "legacy-condition", type: "condition", data: {} },
      { id: "condition-alias", data: { conditionBranchNodeId: "Q" } },
    ];
    assert.equal(graphIdFor(source, { nodeId: "legacy", kind: "dialogue" }), "legacy");
    assert.equal(graphIdFor(source, { nodeId: "legacy-condition", kind: "condition" }), "legacy-condition");
    assert.equal(graphIdFor(source, { nodeId: "Q", kind: "condition" }), "condition-alias");
    assert.equal(graphIdFor(source, { nodeId: "Q", kind: "dialogue" }), undefined);
  });
  await test("Hidden nodes are skipped and duplicate references choose the first visible alias", () => {
    const source = project();
    source.graph.nodes[1].hidden = true;
    assert.equal(graphIdFor(source, { nodeId: "A", kind: "dialogue" }), undefined);
    source.graph.nodes.push({ id: "visible-A", type: "group", data: { dialogueNodeId: "A" } });
    source.graph.nodes.push({ id: "another-A", type: "group", data: { dialogueNodeId: "A" } });
    assert.equal(graphIdFor(source, { nodeId: "A", kind: "dialogue" }), "visible-A");
  });
  await test("Pure navigation projection never creates nodes or changes coordinates or content", () => {
    const source = freeze(project());
    const card = freeze(block());
    const before = copy(source);
    assert.equal(graphIdFor(source, targetFor(card, "B")), "view-B");
    assert.equal(graphIdFor(source, { nodeId: "orphan", kind: "dialogue" }), undefined);
    assert.equal(graphIdFor(source, { nodeId: "missing", kind: "dialogue" }), undefined);
    assert.deepEqual(source, before);
  });

  const previewElements = elements(preview.descriptor.template.ast);
  const cardElement = withClass(previewElements, "text-flow-block");
  await test("Explicit Clip and node buttons navigate without stealing double-click text selection", () => {
    const lineElement = previewElements.find((node) => node.tag === "DialogueTextLine");
    const cardButton = previewElements.find((node) => directive(node, "on", "click")?.exp?.content === "navigateToBlock(placed.block)");
    const outletButton = previewElements.find((node) => directive(node, "on", "click")?.exp?.content === "navigateToBlock(placed.block, undefined, true)");
    for (const [element, event, expected] of [[cardButton, "click", [block()]], [lineElement, "configure", [block(), "B"]], [outletButton, "click", [block(), undefined, true]]]) {
      const handler = directive(element, "on", event);
      let args;
      vm.runInNewContext(handler.exp.content, { placed: { block: block() }, line: { nodeId: "B" }, navigateToBlock(...values) { args = values; } });
      assert.deepEqual(args, expected);
    }
  });
  await test("Cards allow focus but leave Enter and double-click to the text inputs", () => {
    assert.ok(cardElement.props.some((property) => property.name === "tabindex" && property.value?.content === "0"));
    assert.equal(directive(cardElement, "on", "keydown"), undefined);
    assert.equal(directive(cardElement, "on", "dblclick"), undefined);
  });
  await test("Text editor binds both direct text edits and graph navigation", () => {
    assert.ok(previewElements.some((node) => node.tag === "DialogueTextLine"));
    const previewComponent = elements(editor.descriptor.template.ast).find((node) => node.tag === "DialogueTextPreview");
    assert.equal(directive(previewComponent, "on", "navigate")?.exp.content, "NavigateToPreviewNode");
    assert.equal(directive(previewComponent, "on", "edit")?.exp.content, "EditDialogueText");
    assert.equal(directive(previewComponent, "on", "replace")?.exp.content, "dialogueProject = $event");
  });
  await test("Actual preview handler emits only a valid navigation event", () => {
    const calls = [];
    const context = vm.createContext({ getTextPreviewNavigationTarget: targetFor, emit(...args) { calls.push(copy(args)); } });
    vm.runInContext(transpile(preview.functionText("navigateToBlock"), preview.filename), context);
    context.navigateToBlock(block(), "B");
    context.navigateToBlock(block(), "missing");
    assert.deepEqual(calls, [["navigate", { nodeId: "B", kind: "select" }]]);
  });

  const handlerCode = transpile([editor.functionText("ChangeEditorView"), editor.functionText("NavigateToPreviewNode")].join("\n"), editor.filename);
  function harness(options = {}) {
    const source = project();
    const dialogueProject = { value: options.noProject ? undefined : source };
    const editorView = { value: "text" };
    const selectedGroupNodeId = { value: "previous" };
    const nodesSelectionActive = { value: true };
    const calls = [];
    const frames = [];
    const warnings = [];
    const context = vm.createContext({
      dialogueProject, editorView, selectedGroupNodeId, nodesSelectionActive,
      resolveTextPreviewGraphNodeId: graphIdFor,
      ApplyGraphLayout() { calls.push("layout"); },
      toast: { warning(message) { warnings.push(message); } },
      nextTick() { calls.push("tick"); return Promise.resolve(); },
      requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
      findNode(id) { calls.push(["find", id]); return options.noMountedNode ? undefined : source.graph.nodes.find((node) => node.id === id); },
      getSelectedNodes: { get value() { return source.graph.nodes.filter((node) => node.selected); } },
      getSelectedEdges: { get value() { return source.graph.edges.filter((edge) => edge.selected); } },
      removeSelectedNodes(nodes) { calls.push("remove-nodes"); nodes.forEach((node) => { node.selected = false; }); },
      removeSelectedEdges(edges) { calls.push("remove-edges"); edges.forEach((edge) => { edge.selected = false; }); },
      // Deliberately append selection, as Vue Flow does while Ctrl/Shift is held.
      addSelectedNodes(nodes) { calls.push("add-node"); nodes.forEach((node) => { node.selected = true; }); },
      fitView(value) { calls.push(["fit", copy(value), selectedGroupNodeId.value, editorView.value]); return Promise.resolve(true); },
    });
    vm.runInContext(handlerCode, context, { timeout: 1000, filename: editor.filename });
    return {
      source, dialogueProject, editorView, selectedGroupNodeId, nodesSelectionActive, calls, frames, warnings,
      navigate: (target) => context.NavigateToPreviewNode(target),
      async finish(pending) {
        // Drain cross-realm Promise assimilation as well as Vue's simulated tick.
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(frames.length, 1, "Wait for Vue rendering before scheduling first frame");
        frames.shift()(0);
        assert.equal(frames.length, 1, "Wait a second frame for ResizeObserver dimensions");
        frames.shift()(0);
        await pending;
      },
    };
  }
  await test("Real editor handler opens the target Timeline before measuring and fitting only its graph alias", async () => {
    const state = harness();
    const coordinates = copy(state.source.graph.nodes.map((node) => node.position));
    const content = copy(state.source.dialogue);
    const pending = state.navigate({ nodeId: "B", kind: "select" });
    assert.equal(state.editorView.value, "graph");
    assert.equal(state.selectedGroupNodeId.value, "B");
    assert.equal(state.nodesSelectionActive.value, false);
    assert.deepEqual(state.calls, ["tick"]);
    await state.finish(pending);
    const fit = state.calls.find((call) => Array.isArray(call) && call[0] === "fit");
    assert.equal(state.calls.filter((call) => call === "layout").length, 1);
    assert.ok(state.calls.indexOf("layout") < state.calls.indexOf(fit));
    assert.deepEqual(fit[1].nodes, ["view-B"]);
    assert.equal(fit[1].maxZoom, 1);
    assert.ok(fit[1].padding > 0);
    assert.deepEqual(fit.slice(2), ["B", "graph"]);
    assert.deepEqual(state.source.graph.nodes.filter((node) => node.selected).map((node) => node.id), ["view-B"]);
    assert.ok(state.source.graph.edges.every((edge) => !edge.selected));
    assert.deepEqual(state.source.graph.nodes.map((node) => node.position), coordinates);
    assert.deepEqual(state.source.dialogue, content);
  });
  await test("Condition, Entry and Output navigation fits their node without opening Timeline", async () => {
    for (const target of [{ nodeId: "A", kind: "condition" }, { nodeId: "entry", kind: "entry" }, { nodeId: "output", kind: "output" }]) {
      const state = harness();
      const pending = state.navigate(target);
      assert.equal(state.selectedGroupNodeId.value, "");
      await state.finish(pending);
      assert.equal(state.calls.find((call) => Array.isArray(call) && call[0] === "fit")[2], "");
    }
  });
  await test("Missing business-to-graph mapping warns but does not switch view or create graph data", async () => {
    const state = harness();
    const before = copy(state.source);
    await state.navigate({ nodeId: "orphan", kind: "dialogue" });
    assert.equal(state.editorView.value, "text");
    assert.equal(state.selectedGroupNodeId.value, "previous");
    assert.equal(state.warnings.length, 1);
    assert.deepEqual(state.calls, []);
    assert.deepEqual(state.source, before);
  });
  await test("A closed file does not begin navigation", async () => {
    const state = harness({ noProject: true });
    await state.navigate({ nodeId: "A", kind: "dialogue" });
    assert.deepEqual(state.calls, []);
    assert.deepEqual(state.warnings, []);
    assert.equal(state.editorView.value, "text");
  });
  await test("Changing the file or switching back to preview cancels pending viewport changes", async () => {
    for (const cancel of [(state) => { state.dialogueProject.value = project(); }, (state) => { state.editorView.value = "text"; }]) {
      const state = harness();
      const pending = state.navigate({ nodeId: "B", kind: "dialogue" });
      cancel(state);
      await state.finish(pending);
      assert.deepEqual(state.calls, ["tick"]);
    }
  });
  await test("A graph node removed or hidden during layout does not get selected or fitted", async () => {
    for (const options of [{ noMountedNode: true }, {}]) {
      const state = harness(options);
      const pending = state.navigate({ nodeId: "B", kind: "dialogue" });
      if (!options.noMountedNode) state.source.graph.nodes.find((node) => node.id === "view-B").hidden = true;
      await state.finish(pending);
      assert.deepEqual(state.calls, ["tick", ["find", "view-B"]]);
    }
  });
  console.log(`\n${passed} DSFG text navigation checks passed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
