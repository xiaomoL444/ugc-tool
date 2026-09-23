/* Run: node scripts/test-client-ui-keyboard.cjs
 * Tests the editor's actual shortcut declarations, without mounting Vue/DOM.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { parse } = require("@vue/compiler-sfc");

const filename = path.resolve(__dirname, "../src/views/ClientUIAnimationEditor/ClientUIAnimationEditor.vue");
const parsed = parse(fs.readFileSync(filename, "utf8"), { filename });
assert.deepEqual(parsed.errors, []);
const source = parsed.descriptor.scriptSetup.content;
const ast = ts.createSourceFile(filename + ".ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = ["togglePlayback", "isTimelineTextEditing", "handleTimelineKeyboardShortcut", "handleTimelineKeyboardRelease", "resetTimelineKeyboardShortcut"];
const declarations = ast.statements.filter((statement) => ts.isFunctionDeclaration(statement) && names.includes(statement.name.text)).map((statement) => statement.getText(ast));
assert.equal(declarations.length, names.length);
const script = ts.transpileModule(`let timelineSpacePressed = false;\n${declarations.join("\n")}\nglobalThis.shortcuts = { ${names.join(", ")} };`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;

class Element {
  constructor(tagName, options = {}) {
    Object.assign(this, { tagName: tagName.toUpperCase(), type: "text", readOnly: false, disabled: false, isContentEditable: false, isConnected: true }, options);
  }
  closest(selector) { return selector.split(", ").includes(this.tagName.toLowerCase()) ? this : null; }
  getClientRects() { return this.visible === false ? [] : [{}]; }
}
function fixture() {
  const context = vm.createContext({ HTMLElement: Element, editorElement: { value: new Element("div") }, timelineContextMenu: { value: null }, timelineDataImportOpen: { value: false }, playing: { value: false }, currentTime: { value: 0 }, sequenceDurationValue: () => 5 });
  vm.runInContext(script, context, { filename, timeout: 2000 });
  return context;
}
function space(target, options = {}) {
  return { code: "Space", repeat: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, target, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...options };
}
let passed = 0;
function test(name, check) { check(); passed += 1; console.log(`PASS ${name}`); }

test("Focused buttons/tree items/selects toggle playback, without default activation", () => {
  for (const tag of ["button", "div", "select", "summary", "a"]) {
    const context = fixture();
    const target = new Element(tag);
    const down = space(target);
    context.shortcuts.handleTimelineKeyboardShortcut(down);
    assert.equal(context.playing.value, true, tag);
    assert.equal(down.defaultPrevented, true);
    assert.equal(down.stopped, true);
    const up = space(target);
    context.shortcuts.handleTimelineKeyboardRelease(up);
    assert.equal(up.defaultPrevented, true);
    assert.equal(up.stopped, true);
    context.shortcuts.handleTimelineKeyboardShortcut(space(target));
    assert.equal(context.playing.value, false, "Second press must pause");
  }
});

test("Held Space consumes repeat events but does not repeatedly toggle", () => {
  const context = fixture();
  const target = new Element("button");
  context.shortcuts.handleTimelineKeyboardShortcut(space(target));
  for (const repeat of [true, true, false]) {
    const event = space(target, { repeat });
    context.shortcuts.handleTimelineKeyboardShortcut(event);
    assert.equal(context.playing.value, true);
    assert.equal(event.defaultPrevented, true);
  }
  context.shortcuts.handleTimelineKeyboardRelease(space(target));
  context.shortcuts.handleTimelineKeyboardShortcut(space(target));
  assert.equal(context.playing.value, false);
});

test("An open timeline menu keeps Space for its focused action", () => {
  const context = fixture();
  context.timelineContextMenu.value = { trackId: "clicked-line" };
  const down = space(new Element("button"));
  context.shortcuts.handleTimelineKeyboardShortcut(down);
  assert.equal(context.playing.value, false);
  assert.equal(down.defaultPrevented, false);
  const up = space(down.target);
  context.shortcuts.handleTimelineKeyboardRelease(up);
  assert.equal(up.defaultPrevented, false);
});

test("Text fields, contenteditable and precise number editing retain Space", () => {
  for (const target of [new Element("input"), new Element("textarea"), new Element("input", { type: "number" }), new Element("div", { isContentEditable: true })]) {
    const context = fixture();
    const event = space(target);
    context.shortcuts.handleTimelineKeyboardShortcut(event);
    assert.equal(context.playing.value, false);
    assert.equal(event.defaultPrevented, false);
    const release = space(target);
    context.shortcuts.handleTimelineKeyboardRelease(release);
    assert.equal(release.defaultPrevented, false);
  }
});

test("Timeline Data import keeps Space for its inputs and buttons instead of playing behind the dialog", () => {
  for (const target of [new Element("button"), new Element("input", { type: "radio" }), new Element("textarea")]) {
    const context = fixture();
    context.timelineDataImportOpen.value = true;
    const event = space(target);
    context.shortcuts.handleTimelineKeyboardShortcut(event);
    assert.equal(context.playing.value, false);
    assert.equal(event.defaultPrevented, false);
  }
});

test("Readonly scrub numbers and nontext input controls do not steal playback Space", () => {
  for (const target of [new Element("input", { type: "number", readOnly: true }), new Element("input", { type: "checkbox" }), new Element("input", { type: "range" })]) {
    const context = fixture();
    context.shortcuts.handleTimelineKeyboardShortcut(space(target));
    assert.equal(context.playing.value, true);
  }
});

test("Hidden/unmounted editor, modifiers and IME do not intercept Space", () => {
  for (const options of [{ code: "Enter" }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
    const context = fixture();
    const event = space(new Element("button"), options);
    context.shortcuts.handleTimelineKeyboardShortcut(event);
    assert.equal(context.playing.value, false);
    assert.equal(event.defaultPrevented, false);
  }
  for (const editor of [null, new Element("div", { isConnected: false }), new Element("div", { visible: false }), new Element("div", { inert: true })]) {
    const context = fixture();
    context.editorElement.value = editor;
    const event = space(new Element("button"));
    context.shortcuts.handleTimelineKeyboardShortcut(event);
    assert.equal(context.playing.value, false);
    assert.equal(event.defaultPrevented, false);
  }
});

test("Lost window focus releases held state and playback at end restarts at zero", () => {
  const context = fixture();
  const target = new Element("button");
  context.currentTime.value = 5;
  context.shortcuts.handleTimelineKeyboardShortcut(space(target));
  assert.equal(context.currentTime.value, 0);
  context.shortcuts.resetTimelineKeyboardShortcut();
  context.shortcuts.handleTimelineKeyboardShortcut(space(target));
  assert.equal(context.playing.value, false);
});

test("Both keyboard listeners are registered and removed in capture phase", () => {
  assert.match(source, /addEventListener\("keydown", handleTimelineKeyboardShortcut, true\)/);
  assert.match(source, /addEventListener\("keyup", handleTimelineKeyboardRelease, true\)/);
  assert.match(source, /removeEventListener\("keydown", handleTimelineKeyboardShortcut, true\)/);
  assert.match(source, /removeEventListener\("keyup", handleTimelineKeyboardRelease, true\)/);
  assert.match(source, /addEventListener\("blur", resetTimelineKeyboardShortcut\)/);
  assert.match(source, /removeEventListener\("blur", resetTimelineKeyboardShortcut\)/);
});

console.log(`${passed} keyboard regressions passed.`);
