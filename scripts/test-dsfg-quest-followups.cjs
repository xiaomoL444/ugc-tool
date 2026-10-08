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
const handlerNames = ["chooseNextQuest", "moveNextQuest", "removeNextQuest", "removeSelected", "updateSubInteger", "chooseFailureQuest", "removeFailureQuest"];
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
  const sub = { id: 199, title: "当前子任务", nextQuestIds: [...ids], failureQuestId: -1, finishMainQuest: false, questProgress: 0 };
  const context = vm.createContext({
    selectedSub: { value: sub },
    subsById: { value: new Map([[0, { id: 0 }], [100, { id: 100 }], [199, sub]]) },
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

test("New scalar inputs are wired to sub-only fields with exact integer bounds and boolean binding", () => {
  const inputs = findElements(descriptor.template.ast, (node) => node.tag === "input");
  const failure = inputs.find((node) => attr(node, "aria-label") === "失败回溯任务 ID");
  const progress = inputs.find((node) => attr(node, "aria-label") === "任务进度");
  const finish = inputs.find((node) => attr(node, "aria-label") === "完成主任务");
  assert.equal(failure, undefined, 'Rollback selection must not expose a manual ID input');
  for (const [node, key] of [[progress, "questProgress"]]) {
    assert.ok(node); assert.equal(attr(node, "type"), "number"); assert.equal(attr(node, "step"), "1");
    assert.equal(attr(node, "min"), "-2147483648"); assert.equal(attr(node, "max"), "2147483647");
    assert.equal(directive(node, "on", "input").exp.content, `updateSubInteger('${key}', $event)`);
    assert.equal(directive(node, "on", "change").exp.content, `updateSubInteger('${key}', $event, true)`);
  }
  assert.equal(attr(finish, "type"), "checkbox"); assert.equal(directive(finish, "model").exp.content, "selectedSub.finishMainQuest");
});

test("Rollback task is chosen once by name, removable without deleting a task, and accepts ID zero", () => {
  const { state, sub } = harness([100]);
  state.chooseFailureQuest(null); state.chooseFailureQuest(9999); assert.equal(sub.failureQuestId, -1);
  state.chooseFailureQuest(0); assert.equal(sub.failureQuestId, 0);
  state.chooseFailureQuest(100); assert.equal(sub.failureQuestId, 0);
  state.removeFailureQuest(); assert.equal(sub.failureQuestId, -1);
  assert.equal(state.subsById.value.size, 3); assert.deepEqual(sub.nextQuestIds, [100]);
  state.chooseFailureQuest(100); assert.equal(sub.failureQuestId, 100);
  sub.failureQuestId = null; state.chooseFailureQuest(0); assert.equal(sub.failureQuestId, null);
  state.removeFailureQuest(); assert.equal(sub.failureQuestId, -1);
  sub.failureQuestId = 9999; state.removeFailureQuest(); assert.equal(sub.failureQuestId, -1);
  state.selectedSub.value = undefined; state.chooseFailureQuest(0); state.removeFailureQuest(); assert.equal(sub.failureQuestId, -1);
});
test("Rollback and progress update immediately with zero, negatives and Int32 boundaries", () => {
  const { state, sub, warnings } = harness();
  for (const key of ["failureQuestId", "questProgress"]) for (const value of [199, 100, 0, -1, 2147483647, -2147483648]) {
    state.updateSubInteger(key, inputEvent(String(value)));
    assert.equal(sub[key], value); assert.equal(JSON.parse(JSON.stringify(sub))[key], value);
  }
  assert.deepEqual(warnings, []);
});
test("New integer fields keep intermediate input until commit, rejecting fractional or out-of-range values", () => {
  for (const key of ["failureQuestId", "questProgress"]) for (const value of ["-", "1.5", "2147483648", "-2147483649", "Infinity"]) {
    const { state, sub, warnings } = harness(); sub[key] = 199;
    const event = inputEvent(value); state.updateSubInteger(key, event);
    assert.equal(sub[key], 199); assert.deepEqual(warnings, []);
    assert.equal(event.target.value, value);
    state.updateSubInteger(key, event, true);
    assert.equal(sub[key], 199); assert.equal(event.target.value, "199"); assert.equal(warnings.length, 1);
  }
});
test("Clearing rollback persists null, while badInput and an empty progress never turn into zero", () => {
  const { state, sub, warnings } = harness(); sub.failureQuestId = 100; sub.questProgress = 25;
  state.updateSubInteger("failureQuestId", inputEvent("", NaN, true)); assert.equal(sub.failureQuestId, 100);
  state.updateSubInteger("failureQuestId", inputEvent("")); assert.equal(sub.failureQuestId, null);
  assert.equal(JSON.parse(JSON.stringify(sub)).failureQuestId, null);
  const bad = inputEvent("-", NaN, true); state.updateSubInteger("failureQuestId", bad, true); assert.equal(bad.target.value, "");
  const progress = inputEvent(""); state.updateSubInteger("questProgress", progress); assert.equal(sub.questProgress, 25);
  state.updateSubInteger("questProgress", progress, true); assert.equal(progress.target.value, "25");
  state.updateSubInteger("failureQuestId", inputEvent("0")); assert.equal(sub.failureQuestId, 0);
  assert.equal(warnings.length, 2);
});
test("New integer handlers do nothing without a selected sub quest", () => {
  const { state, sub } = harness(), before = JSON.stringify(sub); state.selectedSub.value = undefined;
  state.updateSubInteger("failureQuestId", inputEvent("1")); state.updateSubInteger("questProgress", inputEvent("1"));
  assert.equal(JSON.stringify(sub), before);
});
test("Main/sub deletion clears rollback targets along with follow-up slots; cancellation preserves both", () => {
  for (const [kind, id] of [["main", 0], ["sub", 1]]) {
    const { state, project, successes } = deletionHarness(kind, id);
    project.subQuests[2].failureQuestId = 1; project.subQuests[3].failureQuestId = 9999;
    state.removeSelected();
    assert.equal(project.subQuests.find((sub) => sub.id === 2).failureQuestId, null);
    assert.equal(project.subQuests.find((sub) => sub.id === 3).failureQuestId, 9999);
    assert.match(successes[0], new RegExp(`${kind === "main" ? 5 : 6}.*置空`));
    const cancelled = deletionHarness(kind, id, false); cancelled.project.subQuests[2].failureQuestId = 1;
    const before = JSON.stringify(cancelled.project); cancelled.state.removeSelected(); assert.equal(JSON.stringify(cancelled.project), before);
  }
});
test("Choosing follow-up tasks preserves order and zero while rejecting duplicates and invalid additions", () => {
  const { state, sub } = harness([9999, null]);
  for (const id of [199, 100, 0, 199]) state.chooseNextQuest(id);
  state.chooseNextQuest(null); state.chooseNextQuest(9999);
  assert.deepEqual(sub.nextQuestIds, [9999, null, 199, 100, 0]);
  assert.deepEqual(JSON.parse(JSON.stringify(sub)).nextQuestIds, sub.nextQuestIds);
});

test("Duplicate additions and replacements leave the list unchanged, including ID zero", () => {
  const { state, sub, warnings } = harness([0, 100, null, null]);
  state.chooseNextQuest(0); state.chooseNextQuest(100);
  state.chooseNextQuest(0, 1); state.chooseNextQuest(100, 2);
  assert.deepEqual(sub.nextQuestIds, [0, 100, null, null]);
  assert.equal(warnings.length, 4);
  state.chooseNextQuest(0, 0); state.chooseNextQuest(null, 2);
  assert.equal(warnings.length, 4, "Keeping the current selection is harmless");
  state.chooseNextQuest(null, 0); state.chooseNextQuest(0, 2);
  assert.deepEqual(sub.nextQuestIds, [null, 100, 0, null]);
  state.removeNextQuest(1); state.chooseNextQuest(100);
  assert.deepEqual(sub.nextQuestIds, [null, 0, null, 100]);
});

test("Replacing and clearing a selection changes only its slot and preserves external references", () => {
  const { state, sub } = harness([9999, null, 100]);
  state.chooseNextQuest(0, 1);
  assert.deepEqual(sub.nextQuestIds, [9999, 0, 100]);
  state.chooseNextQuest(null, 2);
  assert.deepEqual(sub.nextQuestIds, [9999, 0, null]);
  state.chooseNextQuest(9999, 1);
  assert.deepEqual(sub.nextQuestIds, [9999, 0, null]);
  state.chooseNextQuest(199, 2);
  assert.deepEqual(sub.nextQuestIds, [9999, 0, 199]);
});

test("The 100-item limit blocks additions but permits replacement and removal", () => {
  const { state, sub } = harness(Array.from({ length: 99 }, (_, index) => index + 1));
  state.chooseNextQuest(0);
  assert.equal(sub.nextQuestIds.length, 100);
  assert.equal(sub.nextQuestIds[99], 0);
  state.chooseNextQuest(199);
  assert.equal(sub.nextQuestIds.length, 100);
  state.chooseNextQuest(199, 0);
  assert.equal(sub.nextQuestIds[0], 199);
  state.removeNextQuest(50); state.chooseNextQuest(100);
  assert.equal(sub.nextQuestIds.length, 100);
  assert.equal(sub.nextQuestIds[99], 100);
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
    state.chooseNextQuest(0, index);
    state.chooseNextQuest(null, index);
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
  state.chooseNextQuest(199);
  state.chooseNextQuest(0, 0);
  state.chooseNextQuest(null, 0);
  state.removeNextQuest(0);
  state.moveNextQuest(0, 1);
  assert.deepEqual(sub.nextQuestIds, [100]);
  assert.deepEqual(warnings, []);
});

test("Follow-ups use only task pickers with indexed replacement and a capped add action", () => {
  const section = findElements(descriptor.template.ast, node => attr(node, "class") === "next-quests")[0];
  assert.equal(findElements(section, node => node.tag === "input").length, 0);
  const pickers = findElements(section, node => node.tag === "QuestReferenceSelect");
  assert.equal(pickers.length, 2);
  assert.equal(directive(pickers[0], "on", "update:model-value").exp.content, "chooseNextQuest($event, index)");
  assert.equal(directive(pickers[1], "on", "update:model-value").exp.content, "chooseNextQuest($event)");
  const disabled = directive(pickers[1], "bind", "disabled").exp.content;
  assert.equal(evaluate(disabled, { selectedSub: { nextQuestIds: Array(99) } }), false);
  assert.equal(evaluate(disabled, { selectedSub: { nextQuestIds: Array(100) } }), true);
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

test("Task selections write only to the currently selected sub quest", () => {
  const { state, sub } = harness([100]);
  const other = { id: 200, nextQuestIds: [] };
  state.selectedSub.value = other;
  state.chooseNextQuest(199);
  assert.deepEqual(other.nextQuestIds, [199]);
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
