/* Run with: node scripts/test-dsfg-quest-followups.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { parse, compileScript, compileTemplate, compileStyle } = require("@vue/compiler-sfc");

const filename = path.resolve(__dirname, "../src/views/DSFGStudio/components/QuestEditor/QuestPanel.vue");
const parsed = parse(fs.readFileSync(filename, "utf8"), { filename });
const descriptor = parsed.descriptor;
const ast = ts.createSourceFile(`${filename}.ts`, descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const handlerNames = ["addNextQuest", "updateNextQuest", "moveNextQuest", "removeNextQuest", "removeSelected"];
const functions = handlerNames.map((name) => {
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Actual QuestPanel handler missing: ${name}`);
  return declaration.getText(ast);
}).join("\n");
const projectFilename = path.join(path.dirname(filename), "questProject.ts");
const projectAst = ts.createSourceFile(projectFilename, fs.readFileSync(projectFilename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const removeHelper = projectAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "removeQuestSubQuests");
assert.ok(removeHelper, "Actual shared task-deletion helper missing");
const compiledHandlers = ts.transpileModule(`${removeHelper.getText(projectAst).replace(/^export\s+/, "")}\n${functions}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;

function harness(ids = []) {
  const warnings = [];
  const sub = { id: 199, title: "当前子任务", nextQuestIds: [...ids] };
  const context = vm.createContext({
    selectedSub: { value: sub }, nextQuestIdInput: { value: "" },
    toast: { warning: (message) => warnings.push(message) },
  });
  vm.runInContext(compiledHandlers, context, { filename, timeout: 1000 });
  return { state: context, sub, warnings };
}
function inputEvent(text, numeric = Number(text), badInput = false) {
  return { target: { value: String(text), valueAsNumber: text === "" ? NaN : numeric, validity: { badInput } } };
}
function deletionHarness(kind, id, approved = true) {
  const project = {
    chapters: [{ id: 0, title: "章节" }],
    mainQuests: [{ id: 0, chapterId: 0, title: "主任务 A" }, { id: 1, chapterId: 0, title: "主任务 B" }],
    subQuests: [
      { id: 0, mainQuestId: 0, title: "A0", nextQuestIds: [1, 2, 1, null, 9999] },
      { id: 1, mainQuestId: 0, title: "A1", nextQuestIds: [0] },
      { id: 2, mainQuestId: 1, title: "B0", nextQuestIds: [1, 0, 1] },
      { id: 3, mainQuestId: 1, title: "B1", nextQuestIds: [1, 2] },
    ],
  };
  const collection = kind === "chapter" ? project.chapters : kind === "main" ? project.mainQuests : project.subQuests;
  const item = collection.find((value) => value.id === id);
  const confirmations = [], successes = [];
  const state = vm.createContext({
    props: { project }, selection: { value: { kind, id } }, selectedItem: { value: item },
    selectedSub: { value: kind === "sub" ? item : undefined }, expanded: { value: new Set() },
    subGroups: { value: new Map(project.mainQuests.map((main) => [main.id, project.subQuests.filter((sub) => sub.mainQuestId === main.id)])) },
    confirm: (message) => { confirmations.push(message); return approved; },
    toast: { success: (message) => successes.push(message) },
  });
  vm.runInContext(compiledHandlers, state, { filename, timeout: 1000 });
  return { state, project, confirmations, successes };
}
function findElements(node, predicate, found = []) {
  if (node.type === 1 && predicate(node)) found.push(node);
  for (const child of node.children ?? []) findElements(child, predicate, found);
  return found;
}
function directive(node, name, argument) {
  return node.props?.find((property) => property.type === 7 && property.name === name && property.arg?.content === argument);
}
function attr(node, name) {
  return node.props?.find((property) => property.type === 6 && property.name === name)?.value?.content;
}
function evaluate(expression, values) {
  return vm.runInNewContext(expression, values);
}
let passed = 0;
function test(name, check) { check(); passed++; console.log(`PASS ${name}`); }

test("Actual QuestPanel script, template and styles compile", () => {
  assert.deepEqual(parsed.errors, []);
  const script = compileScript(descriptor, { id: "quest-followups" });
  const template = compileTemplate({ filename, id: "quest-followups", source: descriptor.template.content,
    compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  for (const style of descriptor.styles) {
    const result = compileStyle({ filename, id: "quest-followups", source: style.content, scoped: style.scoped });
    assert.deepEqual(result.errors, []);
  }
});

test("Adding IDs preserves order, duplicates, zero, signed boundaries and complete future references", () => {
  const { state, sub, warnings } = harness();
  const values = ["199", "100", "0", "-1", "199", "9999", "-2147483648", "2147483647", " +000100 "];
  for (const text of values) {
    state.nextQuestIdInput.value = text;
    state.addNextQuest();
    assert.equal(state.nextQuestIdInput.value, "");
  }
  assert.deepEqual(sub.nextQuestIds, values.map(Number));
  assert.deepEqual(warnings, []);
});

test("Invalid new IDs do not change the list or erase the input", () => {
  for (const text of ["", " ", "-", "+", "1.5", "1e2", "0x10", "100,199", "NaN", "Infinity", "2147483648", "-2147483649"]) {
    const { state, sub, warnings } = harness([100]);
    state.nextQuestIdInput.value = text;
    state.addNextQuest();
    assert.deepEqual(sub.nextQuestIds, [100], text);
    assert.equal(state.nextQuestIdInput.value, text);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Int32/);
  }
});

test("Adding the 100th ID succeeds and adding the 101st is blocked until removal", () => {
  const { state, sub, warnings } = harness(Array.from({ length: 99 }, (_, index) => index));
  state.nextQuestIdInput.value = "9999";
  state.addNextQuest();
  assert.equal(sub.nextQuestIds.length, 100);
  assert.equal(sub.nextQuestIds[99], 9999);
  state.nextQuestIdInput.value = "199";
  const before = [...sub.nextQuestIds];
  state.addNextQuest();
  assert.deepEqual(sub.nextQuestIds, before);
  assert.equal(state.nextQuestIdInput.value, "199");
  state.removeNextQuest(50);
  state.addNextQuest();
  assert.equal(sub.nextQuestIds.length, 100);
  assert.equal(sub.nextQuestIds[99], 199);
  assert.equal(state.nextQuestIdInput.value, "");
  assert.deepEqual(warnings, []);
});

test("Valid input events update the actual model immediately before any change or blur", () => {
  const { state, sub, warnings } = harness([100, 199, 0]);
  state.updateNextQuest(1, inputEvent("9999"));
  assert.deepEqual(sub.nextQuestIds, [100, 9999, 0]);
  assert.deepEqual(JSON.parse(JSON.stringify(sub)).nextQuestIds, [100, 9999, 0], "Saving while the input is focused sees the current ID");
  state.updateNextQuest(0, inputEvent("-2147483648"));
  state.updateNextQuest(2, inputEvent("2147483647"));
  assert.deepEqual(sub.nextQuestIds, [-2147483648, 9999, 2147483647]);
  state.updateNextQuest(1, inputEvent("0"), true);
  assert.deepEqual(sub.nextQuestIds, [-2147483648, 0, 2147483647]);
  assert.deepEqual(warnings, []);
});

test("Invalid intermediate input stays editable without warnings or overwriting saved IDs", () => {
  for (const [text, numeric] of [["", NaN], ["-", NaN], ["1.5", 1.5], ["2147483648", 2147483648], ["-2147483649", -2147483649], ["Infinity", Infinity]]) {
    const { state, sub, warnings } = harness([199]);
    const event = inputEvent(text, numeric, text === "");
    state.updateNextQuest(0, event);
    assert.deepEqual(sub.nextQuestIds, [199]);
    assert.equal(event.target.value, text);
    assert.deepEqual(warnings, []);
  }
});

test("Committing invalid input warns and restores the most recent valid ID", () => {
  const { state, sub, warnings } = harness([199]);
  state.updateNextQuest(0, inputEvent("100"));
  const draft = inputEvent("", NaN, true);
  state.updateNextQuest(0, draft);
  assert.equal(draft.target.value, "");
  assert.deepEqual(warnings, []);
  state.updateNextQuest(0, draft, true);
  assert.deepEqual(sub.nextQuestIds, [100]);
  assert.equal(draft.target.value, "100");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Int32/);
  state.updateNextQuest(0, inputEvent("-1"));
  assert.deepEqual(sub.nextQuestIds, [-1]);
});

test("Explicitly empty numeric input immediately clears only its slot and can be refilled", () => {
  const { state, sub, warnings } = harness([100, 199, 0]);
  state.updateNextQuest(1, inputEvent(""));
  assert.deepEqual(sub.nextQuestIds, [100, null, 0]);
  assert.deepEqual(JSON.parse(JSON.stringify(sub)).nextQuestIds, [100, null, 0]);
  state.updateNextQuest(1, inputEvent(""), true);
  assert.deepEqual(sub.nextQuestIds, [100, null, 0]);
  state.updateNextQuest(1, inputEvent("9999"));
  assert.deepEqual(sub.nextQuestIds, [100, 9999, 0]);
  assert.deepEqual(warnings, []);
});

test("Invalid committed input restores an existing null slot as empty rather than zero or null text", () => {
  const { state, sub, warnings } = harness([null]);
  const event = inputEvent("", NaN, true);
  state.updateNextQuest(0, event);
  assert.deepEqual(warnings, []);
  state.updateNextQuest(0, event, true);
  assert.deepEqual(sub.nextQuestIds, [null]);
  assert.equal(event.target.value, "");
  assert.equal(warnings.length, 1);
  state.updateNextQuest(0, inputEvent("0"));
  assert.deepEqual(sub.nextQuestIds, [0]);
});

test("Nullable rows can be reordered and explicitly removed without altering neighboring IDs", () => {
  const { state, sub } = harness([100, null, 199, null]);
  state.moveNextQuest(1, 1);
  assert.deepEqual(sub.nextQuestIds, [100, 199, null, null]);
  state.removeNextQuest(2);
  assert.deepEqual(sub.nextQuestIds, [100, 199, null]);
  state.moveNextQuest(2, -1);
  assert.deepEqual(sub.nextQuestIds, [100, null, 199]);
});

test("Moving list rows swaps exactly the requested neighbors and keeps duplicate IDs", () => {
  const { state, sub } = harness([100, 199, 100, -1]);
  state.moveNextQuest(1, -1);
  assert.deepEqual(sub.nextQuestIds, [199, 100, 100, -1]);
  state.moveNextQuest(2, 1);
  assert.deepEqual(sub.nextQuestIds, [199, 100, -1, 100]);
  state.moveNextQuest(3, -1);
  assert.deepEqual(sub.nextQuestIds, [199, 100, 100, -1]);
});

test("Removing a row deletes only its occurrence and supports an empty list", () => {
  const { state, sub } = harness([100, 199, 100]);
  state.removeNextQuest(0);
  assert.deepEqual(sub.nextQuestIds, [199, 100]);
  state.removeNextQuest(1);
  state.removeNextQuest(0);
  assert.deepEqual(sub.nextQuestIds, []);
  state.removeNextQuest(0);
  assert.deepEqual(sub.nextQuestIds, []);
});

test("Out-of-range row actions are harmless and do not generate warnings", () => {
  const { state, sub, warnings } = harness([100, 199]);
  for (const index of [-1, 2, 100]) {
    state.updateNextQuest(index, inputEvent("0"));
    state.updateNextQuest(index, inputEvent("", NaN), true);
    state.removeNextQuest(index);
    state.moveNextQuest(index, 1);
  }
  state.moveNextQuest(0, -1);
  state.moveNextQuest(1, 1);
  assert.deepEqual(sub.nextQuestIds, [100, 199]);
  assert.deepEqual(warnings, []);
});

test("All list actions are harmless if no sub quest is selected", () => {
  const { state, sub, warnings } = harness([100]);
  state.selectedSub.value = undefined;
  state.nextQuestIdInput.value = "199";
  state.addNextQuest();
  state.updateNextQuest(0, inputEvent("0"));
  state.updateNextQuest(0, inputEvent("", NaN), true);
  state.removeNextQuest(0);
  state.moveNextQuest(0, 1);
  assert.deepEqual(sub.nextQuestIds, [100]);
  assert.equal(state.nextQuestIdInput.value, "199");
  assert.deepEqual(warnings, []);
});

test("Template binds input to immediate updates and change to explicit validation", () => {
  const inputs = findElements(descriptor.template.ast, (node) => node.tag === "input" && Boolean(directive(node, "on", "input")?.exp.content.includes("updateNextQuest")));
  assert.equal(inputs.length, 1);
  const input = inputs[0];
  assert.equal(directive(input, "on", "input").exp.content, "updateNextQuest(index, $event)");
  assert.equal(directive(input, "on", "change").exp.content, "updateNextQuest(index, $event, true)");
  const valueExpression = directive(input, "bind", "value").exp.content;
  assert.equal(evaluate(valueExpression, { id: null }), "");
  assert.equal(evaluate(valueExpression, { id: 0 }), 0);
  assert.equal(evaluate(valueExpression, { id: 199 }), 199);
  assert.equal(attr(input, "placeholder"), "空引用");
  assert.equal(attr(input, "type"), "number");
  assert.equal(attr(input, "step"), "1");
  assert.equal(attr(input, "min"), "-2147483648");
  assert.equal(attr(input, "max"), "2147483647");
});

test("Template enforces the add limit and supports Enter with its default action prevented", () => {
  const section = findElements(descriptor.template.ast, (node) => attr(node, "class") === "next-quest-add")[0];
  assert.ok(section);
  const controls = findElements(section, (node) => node.tag === "input" || node.tag === "button");
  assert.equal(controls.length, 2);
  for (const node of controls) {
    const disabled = directive(node, "bind", "disabled").exp.content;
    assert.equal(evaluate(disabled, { selectedSub: { nextQuestIds: Array(99) } }), false);
    assert.equal(evaluate(disabled, { selectedSub: { nextQuestIds: Array(100) } }), true);
  }
  const input = controls.find((node) => node.tag === "input");
  const keydown = directive(input, "on", "keydown");
  assert.equal(keydown.exp.content, "addNextQuest");
  assert.deepEqual(keydown.modifiers.map((modifier) => typeof modifier === "string" ? modifier : modifier.content).sort(), ["enter", "prevent"]);
  assert.equal(directive(controls.find((node) => node.tag === "button"), "on", "click").exp.content, "addNextQuest");
});

test("Template connects row move/remove controls and disables movement at either end", () => {
  const buttons = findElements(descriptor.template.ast, (node) => node.tag === "button" && /^(move|remove)NextQuest\(/.test(directive(node, "on", "click")?.exp.content ?? ""));
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons.map((node) => directive(node, "on", "click").exp.content), ["moveNextQuest(index, -1)", "moveNextQuest(index, 1)", "removeNextQuest(index)"]);
  const up = directive(buttons[0], "bind", "disabled").exp.content;
  const down = directive(buttons[1], "bind", "disabled").exp.content;
  const values = { selectedSub: { nextQuestIds: [100, 199] }, index: 0 };
  assert.equal(evaluate(up, values), true);
  assert.equal(evaluate(down, values), false);
  values.index = 1;
  assert.equal(evaluate(up, values), false);
  assert.equal(evaluate(down, values), true);
});

test("Changing the selected sub quest clears the unfinished add input", () => {
  const watcher = ast.statements.find((node) => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "watch"
    && node.expression.arguments[0].getText(ast) === "() => selectedSub.value?.id");
  assert.ok(watcher, "Actual selected-sub watcher missing");
  const { state, sub } = harness([100]);
  let observed, callback;
  state.watch = (source, change) => { observed = source; callback = change; };
  vm.runInContext(ts.transpileModule(watcher.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, state);
  assert.equal(observed(), sub.id);
  state.nextQuestIdInput.value = "9999";
  state.selectedSub.value = { id: 200, nextQuestIds: [] };
  assert.equal(observed(), 200);
  callback();
  assert.equal(state.nextQuestIdInput.value, "");
  assert.deepEqual(sub.nextQuestIds, [100]);
});

test("Confirmed sub deletion clears every matching reference across main quests and preserves IDs", () => {
  const { state, project, confirmations, successes } = deletionHarness("sub", 1);
  state.removeSelected();
  assert.deepEqual(project.subQuests.map((sub) => sub.id), [0, 2, 3]);
  assert.deepEqual(project.subQuests[0].nextQuestIds, [null, 2, null, null, 9999]);
  assert.deepEqual(project.subQuests[1].nextQuestIds, [null, 0, null]);
  assert.deepEqual(project.subQuests[2].nextQuestIds, [null, 2]);
  assert.deepEqual(project.mainQuests.map((main) => main.id), [0, 1]);
  assert.equal(state.selection.value.kind, "main");
  assert.equal(state.selection.value.id, 0);
  assert.equal(confirmations.length, 1);
  assert.match(confirmations[0], /置空.*位置/);
  assert.equal(successes.length, 1);
  assert.match(successes[0], /5.*置空/);
});

test("Confirmed main deletion cascades only its children and clears surviving cross-main references", () => {
  const { state, project, confirmations, successes } = deletionHarness("main", 0);
  state.removeSelected();
  assert.deepEqual(project.mainQuests.map((main) => main.id), [1]);
  assert.deepEqual(project.subQuests.map((sub) => sub.id), [2, 3]);
  assert.deepEqual(project.subQuests[0].nextQuestIds, [null, null, null]);
  assert.deepEqual(project.subQuests[1].nextQuestIds, [null, 2]);
  assert.equal(state.selection.value, null);
  assert.equal(confirmations.length, 1);
  assert.match(confirmations[0], /置空.*位置/);
  assert.equal(successes.length, 1);
  assert.match(successes[0], /4.*置空/);
});

test("Chapter deletion reparents main quests and leaves all child tasks and references unchanged", () => {
  const { state, project } = deletionHarness("chapter", 0);
  const before = JSON.stringify(project.subQuests);
  state.removeSelected();
  assert.deepEqual(project.chapters, []);
  assert.deepEqual(project.mainQuests.map((main) => main.id), [0, 1]);
  assert.deepEqual(project.mainQuests.map((main) => main.chapterId), [null, null]);
  assert.equal(JSON.stringify(project.subQuests), before);
});

test("Cancelling chapter, main or sub deletion preserves all data and follow-up positions", () => {
  for (const [kind, id] of [["chapter", 0], ["main", 0], ["sub", 1]]) {
    const { state, project, confirmations, successes } = deletionHarness(kind, id, false);
    const before = JSON.stringify(project);
    state.removeSelected();
    assert.equal(JSON.stringify(project), before);
    assert.equal(state.selection.value.kind, kind);
    assert.equal(state.selection.value.id, id);
    assert.equal(confirmations.length, 1);
    assert.deepEqual(successes, []);
  }
});

console.log(`${passed} quest follow-up UI tests passed.`);
