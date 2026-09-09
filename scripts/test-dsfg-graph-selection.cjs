/* Run with: node scripts/test-dsfg-graph-selection.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { parse, compileScript, compileTemplate } = require("@vue/compiler-sfc");

async function main() {
  const filename = path.resolve(__dirname, "../src/views/DSFGStudio/components/DialogueEditor/DialogueEditor.vue");
  const source = fs.readFileSync(filename, "utf8");
  const parsed = parse(source, { filename });
  const descriptor = parsed.descriptor;
  let passed = 0;
  async function test(name, check) {
    await check();
    passed += 1;
    console.log(`PASS ${name}`);
  }

  await test("DialogueEditor script and template compile as a real Vue SFC", () => {
    assert.deepEqual(parsed.errors, []);
    assert.ok(descriptor.scriptSetup);
    assert.ok(descriptor.template);
    const compiledScript = compileScript(descriptor, { id: "dsfg-graph-selection-test" });
    const compiledTemplate = compileTemplate({
      id: "dsfg-graph-selection-test",
      filename,
      source: descriptor.template.content,
      compilerOptions: { bindingMetadata: compiledScript.bindings },
    });
    assert.deepEqual(compiledTemplate.errors, []);
  });

  function findElement(node, tag, ancestors = []) {
    if (node.type === 1 && node.tag === tag) return { node, ancestors };
    for (const child of node.children ?? []) {
      const result = findElement(child, tag, [...ancestors, node]);
      if (result) return result;
    }
    return undefined;
  }
  const flow = findElement(descriptor.template.ast, "VueFlow");
  assert.ok(flow, "The editor must contain VueFlow");
  function directive(node, name, argument) {
    return node.props?.find((property) => property.type === 7 && property.name === name && property.arg?.content === argument);
  }
  function boundValue(argument, bindings = {}) {
    const property = directive(flow.node, "bind", argument);
    assert.ok(property?.exp?.content, `Missing VueFlow binding: ${argument}`);
    // Evaluate the isolated binding from the local component with explicit view state.
    const value = vm.runInNewContext(`(${property.exp.content})`, bindings, { timeout: 1000 });
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
  }
  function modifierNames(property) {
    return (property?.modifiers ?? []).map((modifier) => typeof modifier === "string" ? modifier : modifier.content);
  }

  await test("Canvas uses right-button panning, keyless left-box selection and selected-node dragging", () => {
    assert.deepEqual(boundValue("pan-on-drag"), [2]);
    assert.equal(boundValue("selection-key-code"), true);
    assert.equal(boundValue("select-nodes-on-drag"), true);
    assert.equal(boundValue("pan-activation-key-code"), null);
    assert.equal(boundValue("snap-to-grid"), true);
    assert.equal(directive(flow.node, "on", "selection-end")?.exp?.content, "FinishGraphSelection");
    assert.equal(directive(flow.node, "on", "node-click")?.exp?.content, "SelectGraphNode");
    const contextMenu = [flow.node, ...flow.ancestors.slice().reverse()].map((node) => directive(node, "on", "contextmenu")).find(Boolean);
    assert.ok(contextMenu && modifierNames(contextMenu).includes("prevent"), "Canvas contextmenu must suppress the native right-click menu");
  });

  await test("Text view disables the hidden graph's delete keys and keyboard movement", () => {
    assert.deepEqual(boundValue("delete-key-code", { editorView: "graph" }), ["Backspace", "Delete"]);
    assert.equal(boundValue("delete-key-code", { editorView: "text" }), null);
    assert.equal(boundValue("disable-keyboard-a11y", { editorView: "graph" }), false);
    assert.equal(boundValue("disable-keyboard-a11y", { editorView: "text" }), true);
  });

  const script = descriptor.scriptSetup.content;
  const scriptAst = ts.createSourceFile(filename + ".ts", script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  function functionText(name) {
    const declaration = scriptAst.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
    assert.ok(declaration, `Missing handler ${name}`);
    return declaration.getText(scriptAst);
  }
  await test("Selection is read from VueFlow's real refs and uses Vue nextTick", () => {
    const flowBinding = scriptAst.statements.filter(ts.isVariableStatement)
      .flatMap((statement) => Array.from(statement.declarationList.declarations))
      .find((declaration) => declaration.initializer && ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(scriptAst) === "useVueFlow");
    assert.ok(flowBinding && ts.isObjectBindingPattern(flowBinding.name));
    const names = flowBinding.name.elements.map((element) => element.propertyName?.getText(scriptAst) ?? element.name.getText(scriptAst));
    assert.ok(names.includes("getSelectedNodes"));
    assert.ok(names.includes("nodesSelectionActive"));
    const vueImport = scriptAst.statements.filter(ts.isImportDeclaration).find((statement) => statement.moduleSpecifier.text === "vue");
    assert.ok(vueImport?.importClause?.namedBindings && ts.isNamedImports(vueImport.importClause.namedBindings));
    assert.ok(vueImport.importClause.namedBindings.elements.some((element) => (element.propertyName ?? element.name).text === "nextTick"));
  });

  const handlerSource = [functionText("SelectGraphNode"), functionText("FinishGraphSelection")].join("\n");
  const handlerCode = ts.transpileModule(handlerSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
    fileName: filename + ".handlers.ts",
  }).outputText;
  function harness(initialSelection, options = {}) {
    let selection = initialSelection;
    let reads = 0;
    let ticks = 0;
    let flushTick;
    const selectedGroupNodeId = { value: "previous-group" };
    const nodesSelectionActive = { value: options.overlayActive ?? true };
    const selectionRef = {};
    const clicks = [];
    Object.defineProperty(selectionRef, "value", { get() { reads += 1; return selection; } });
    const context = vm.createContext({
      selectedGroupNodeId,
      nodesSelectionActive,
      getSelectedNodes: selectionRef,
      nextTick() {
        ticks += 1;
        if (options.deferTick) return new Promise((resolve) => { flushTick = resolve; });
        return Promise.resolve();
      },
    });
    // Execute the two actual SFC handlers with isolated reactive-ref substitutes.
    vm.runInContext(handlerCode, context, { timeout: 1000, filename });
    const originalClick = context.SelectGraphNode;
    context.SelectGraphNode = (event) => {
      clicks.push({ node: event.node, overlayActive: nodesSelectionActive.value });
      return originalClick(event);
    };
    return {
      finish: () => context.FinishGraphSelection(),
      setSelection(value) { selection = value; },
      flush() { assert.ok(flushTick, "Handler must await nextTick"); flushTick(); },
      get reads() { return reads; },
      get ticks() { return ticks; },
      selectedGroupNodeId,
      nodesSelectionActive,
      clicks,
    };
  }
  const groupNode = { id: "canvas-group", type: "group", selected: true, position: { x: 120, y: 80 }, data: { dialogueNodeId: "business-group" } };
  const branchNode = { id: "canvas-branch", type: "condition", selected: true, position: { x: 240, y: 80 }, data: { conditionBranchNodeId: "business-branch" } };

  await test("A boxed single Group reuses the click handler and opens its business Timeline", async () => {
    const state = harness([groupNode]);
    await state.finish();
    assert.equal(state.ticks, 1);
    assert.equal(state.selectedGroupNodeId.value, "business-group");
    assert.equal(state.nodesSelectionActive.value, false);
    assert.equal(state.clicks.length, 1);
    assert.equal(state.clicks[0].node, groupNode);
    assert.equal(state.clicks[0].overlayActive, false, "Single-selection overlay must be removed before click behavior");
  });

  await test("A boxed single condition node performs its click behavior without a Timeline", async () => {
    const state = harness([branchNode]);
    await state.finish();
    assert.equal(state.selectedGroupNodeId.value, "");
    assert.equal(state.nodesSelectionActive.value, false);
    assert.equal(state.clicks.length, 1);
    assert.equal(state.clicks[0].node, branchNode);
  });

  await test("A boxed Entry or node without business data clears the previous Timeline", async () => {
    const entryNode = { id: "entry", type: "entry", data: {} };
    const state = harness([entryNode]);
    await state.finish();
    assert.equal(state.selectedGroupNodeId.value, "");
    assert.equal(state.nodesSelectionActive.value, false);
    assert.equal(state.clicks.length, 1);
    assert.equal(state.clicks[0].node, entryNode);
  });

  await test("Empty selection closes a stale Timeline without synthesizing a node click", async () => {
    const state = harness([], { overlayActive: false });
    await state.finish();
    assert.equal(state.selectedGroupNodeId.value, "");
    assert.equal(state.clicks.length, 0);
    assert.equal(state.nodesSelectionActive.value, false);
  });

  await test("Multiple selected nodes retain their draggable overlay and are not clicked individually", async () => {
    const selection = [structuredClone(groupNode), structuredClone(branchNode)];
    const original = structuredClone(selection);
    const state = harness(selection);
    await state.finish();
    assert.equal(state.selectedGroupNodeId.value, "");
    assert.equal(state.nodesSelectionActive.value, true);
    assert.equal(state.clicks.length, 0);
    assert.deepEqual(selection, original, "Selection flags and node positions must remain untouched");
  });

  await test("Selection is not read until nextTick, so a newly boxed single node is honored", async () => {
    const state = harness([groupNode, branchNode], { deferTick: true });
    const pending = state.finish();
    assert.equal(state.ticks, 1);
    assert.equal(state.reads, 0);
    assert.equal(state.selectedGroupNodeId.value, "previous-group");
    state.setSelection([groupNode]);
    state.flush();
    await pending;
    assert.equal(state.reads, 1);
    assert.equal(state.selectedGroupNodeId.value, "business-group");
    assert.equal(state.nodesSelectionActive.value, false);
    assert.equal(state.clicks.length, 1);
  });

  await test("A post-tick multi-selection cannot accidentally open the previously selected Group", async () => {
    const state = harness([groupNode], { deferTick: true });
    const pending = state.finish();
    assert.equal(state.reads, 0);
    state.setSelection([groupNode, branchNode]);
    state.flush();
    await pending;
    assert.equal(state.selectedGroupNodeId.value, "");
    assert.equal(state.nodesSelectionActive.value, true);
    assert.equal(state.clicks.length, 0);
  });
  console.log(`\n${passed} DSFG graph selection checks passed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
