/* Run: node scripts/test-client-ui-playhead-layout.cjs
 * Exercises the real Vue guide-style function and template/CSS wiring.
 * CSS layout contracts are checked here; actual scrolling needs browser QA.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { parse, compileStyle } = require("@vue/compiler-sfc");

const filename = path.resolve(__dirname, "../src/views/ClientUIAnimationEditor/ClientUIAnimationEditor.vue");
const parsed = parse(fs.readFileSync(filename, "utf8"), { filename });
assert.deepEqual(parsed.errors, []);
const source = parsed.descriptor.scriptSetup.content;
const ast = ts.createSourceFile(`${filename}.ts`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = ["sequenceDurationValue", "timelineGuideStyle"];
const declarations = ast.statements
  .filter((statement) => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text))
  .map((statement) => statement.getText(ast));
assert.equal(declarations.length, names.length, "Guide layout must use the editor's actual functions");
const script = ts.transpileModule(`${declarations.join("\n")}\nglobalThis.api = { ${names.join(", ")} };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const keyframeFilename = path.resolve(path.dirname(filename), "KeyframeTimeline.vue");
const keyframeParsed = parse(fs.readFileSync(keyframeFilename, "utf8"), { filename: keyframeFilename });
assert.deepEqual(keyframeParsed.errors, []);
const template = keyframeParsed.descriptor.template.ast;
const styles = keyframeParsed.descriptor.styles.map((style) => style.content).join("\n");
const compiledStyles = compileStyle({ source: styles, filename: keyframeFilename, id: "playhead-layout-tests" });
assert.deepEqual(compiledStyles.errors, []);
const styleAst = compiledStyles.rawResult.root;

function fixture(rowCount = 1, duration = 5) {
  const context = vm.createContext({
    MIN_TWEEN_DURATION: 0.01,
    timelineRows: { value: Array.from({ length: rowCount }, (_, index) => ({ key: `row-${index}` })) },
    duration: { value: duration },
  });
  vm.runInContext(script, context, { filename, timeout: 2000 });
  return { context, style: (time) => context.api.timelineGuideStyle(time) };
}

function elementWithClass(className, root = template) {
  if (root.type === 1 && root.props.some((prop) => prop.type === 6 && prop.name === "class" && prop.value?.content.split(/\s+/).includes(className))) return root;
  for (const child of root.children ?? []) {
    const found = elementWithClass(className, child);
    if (found) return found;
  }
  return null;
}

function directive(element, name, argument) {
  return element.props.find((prop) => prop.type === 7 && prop.name === name && prop.arg?.content === argument);
}

function attribute(element, name) {
  return element.props.find((prop) => prop.type === 6 && prop.name === name)?.value?.content;
}

function lastRuleBody(className) {
  const rules = [...styles.matchAll(new RegExp(`\\.${className}\\s*\\{([^}]+)\\}`, "g"))];
  assert.ok(rules.length, `Missing .${className} CSS rule`);
  return rules.at(-1)[1];
}

// A class can be styled more than once (for example .tween-clip has a later
// font-size override). Read the cascade instead of looking only at its last rule.
function cssValue(selector, property) {
  let value;
  styleAst.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(property, (declaration) => { value = declaration.value; });
  });
  return value;
}

function hasModifier(directive, modifier) {
  return directive?.modifiers.some((entry) => (entry.content ?? entry) === modifier);
}

let passed = 0;
function test(name, check) { check(); passed++; console.log(`PASS ${name}`); }

test("Empty and short timelines keep a viewport-relative minimum height", () => {
  for (const rowCount of [0, 1, 2, 5]) {
    assert.equal(fixture(rowCount).style(0).height, `max(100%, ${rowCount * 33}px)`);
  }
});

test("Long timelines extend the guide over all rows instead of one scroll viewport", () => {
  for (const rowCount of [12, 40, 120]) {
    assert.equal(fixture(rowCount).style(2.5).height, `max(100%, ${rowCount * 33}px)`);
  }
});

test("Adding and deleting rows recomputes content height without stale DOM measurements", () => {
  const { context, style } = fixture(1);
  assert.equal(style(0).height, "max(100%, 33px)");
  context.timelineRows.value = Array.from({ length: 30 }, (_, index) => ({ key: `extra-${index}` }));
  assert.equal(style(0).height, "max(100%, 990px)");
  context.timelineRows.value = [];
  assert.equal(style(0).height, "max(100%, 0px)");
});

test("The first frame stays on the visible left edge", () => {
  assert.equal(fixture().style(0).left, "clamp(0px, 0%, calc(100% - 1px))");
});

test("Intermediate progress retains proportional placement", () => {
  const { style } = fixture(20, 5);
  assert.equal(style(0.5).left, "clamp(0px, 10%, calc(100% - 1px))");
  assert.equal(style(2.5).left, "clamp(0px, 50%, calc(100% - 1px))");
});

test("The final frame is inset one pixel rather than clipped at left 100%", () => {
  assert.equal(fixture(20, 5).style(5).left, "clamp(0px, 100%, calc(100% - 1px))");
});

test("Times outside the sequence are clamped before rendering", () => {
  const { style } = fixture(20, 5);
  assert.equal(style(-3).left, "clamp(0px, 0%, calc(100% - 1px))");
  assert.equal(style(50).left, "clamp(0px, 100%, calc(100% - 1px))");
});

test("Changing sequence duration immediately updates proportional placement", () => {
  const { context, style } = fixture(20, 10);
  assert.equal(style(2.5).left, "clamp(0px, 25%, calc(100% - 1px))");
  context.duration.value = 5;
  assert.equal(style(2.5).left, "clamp(0px, 50%, calc(100% - 1px))");
});

test("Zero duration follows the existing safe sequence-duration fallback", () => {
  const { style } = fixture(0, 0);
  assert.equal(style(0).left, "clamp(0px, 0%, calc(100% - 1px))");
  assert.equal(style(0.01).left, "clamp(0px, 100%, calc(100% - 1px))");
});

test("The keyframe content grid owns every row and the full-height playhead area", () => {
  const grid = elementWithClass("kf-grid"); const area = elementWithClass("kf-playhead-area");
  assert.ok(grid && area);
  assert.ok(grid.children.includes(area), "The guide belongs to all scroll content, not just the visible viewport");
  assert.ok(elementWithClass("kf-row", grid)); assert.ok(elementWithClass("kf-filler", grid));
  assert.equal(cssValue(".kf-grid", "position"), "relative");
  assert.equal(cssValue(".kf-grid", "min-height"), "100%");
  assert.equal(cssValue(".kf-grid", "display"), "flex");
  assert.equal(cssValue(".kf-grid", "flex-direction"), "column");
  assert.equal(cssValue(".kf-scroll", "overflow"), "auto");
  assert.equal(cssValue(".kf-filler", "flex"), "1");
  assert.equal(directive(elementWithClass("kf-playhead"), "bind", "style")?.exp?.content, "{ left: percent(currentTime) }");
});

test("The ruler is a focusable draggable slider whose actual keyboard handler supports arrows, Home and End", () => {
  const ruler = elementWithClass("kf-ruler");
  assert.equal(attribute(ruler, "role"), "slider"); assert.equal(attribute(ruler, "tabindex"), "0");
  assert.equal(attribute(ruler, "aria-label"), "关键帧播放进度");
  assert.equal(directive(ruler, "on", "pointerdown")?.exp?.content, "startSeek");
  assert.equal(directive(ruler, "on", "keydown")?.exp?.content, "handleRulerKey");
  const keyframeAst = ts.createSourceFile(`${keyframeFilename}.ts`, keyframeParsed.descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functions = keyframeAst.statements.filter((statement) => ts.isFunctionDeclaration(statement) && ["handleRulerKey", "clampTime"].includes(statement.name?.text)).map((statement) => statement.getText(keyframeAst));
  assert.equal(functions.length, 2);
  const props = { currentTime: 2.5 }; const changes = [];
  const context = vm.createContext({ props, safeDuration: { value: 5 }, emit(event, value) { assert.equal(event, "seek"); props.currentTime = value; changes.push(value); } });
  vm.runInContext(ts.transpileModule(`${functions.join("\n")}\nglobalThis.keydown=handleRulerKey`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  for (const [key, shiftKey, expected] of [["ArrowLeft", false, 2.49], ["ArrowRight", true, 2.59], ["Home", false, 0], ["ArrowLeft", false, 0], ["End", false, 5], ["ArrowRight", false, 5]]) {
    let prevented = false; context.keydown({ key, shiftKey, preventDefault() { prevented = true; } });
    assert.equal(props.currentTime, expected); assert.equal(prevented, true);
  }
  context.keydown({ key: "a", preventDefault() { assert.fail("Unrelated keys must not be prevented"); } });
  assert.equal(changes.length, 6);
});

test("The guide spans the content grid top to bottom with a shared ruler/lane horizontal origin", () => {
  assert.equal(cssValue(".kf-playhead-area", "position"), "absolute");
  assert.equal(cssValue(".kf-playhead-area", "top"), "0");
  assert.equal(cssValue(".kf-playhead-area", "bottom"), "0");
  assert.equal(cssValue(".kf-playhead-area", "left"), "234px");
  assert.equal(cssValue(".kf-playhead-area", "right"), "14px");
  assert.equal(cssValue(".kf-row", "grid-template-columns"), "220px minmax(0, 1fr)");
  assert.equal(cssValue(".kf-track-content", "inset"), "0 14px");
  assert.equal(cssValue(".kf-row", "flex"), "0 0 30px");
});

test("Only the ruler-sized playhead handle accepts input, never an invisible full-height hit strip", () => {
  const handle = elementWithClass("kf-playhead-handle"); assert.ok(handle);
  assert.equal(directive(handle, "on", "pointerdown")?.exp?.content, "startSeek($event, ruler)");
  assert.ok(hasModifier(directive(handle, "on", "pointerdown"), "stop"));
  assert.equal(cssValue(".kf-timeline .kf-playhead-handle", "pointer-events"), "auto");
  assert.equal(cssValue(".kf-timeline .kf-playhead-handle", "position"), "sticky");
  assert.equal(cssValue(".kf-timeline .kf-playhead-handle", "top"), "0");
  assert.equal(cssValue(".kf-timeline .kf-playhead-handle", "height"), "25px");
  assert.ok(parseFloat(cssValue(".kf-timeline .kf-playhead-handle", "height")) < parseFloat(cssValue(".kf-ruler-row", "min-height")));
  assert.equal(cssValue(".kf-playhead-area", "pointer-events"), "none");
});

test("The independent one-pixel visual line remains visible and noninteractive over every key row", () => {
  const visualLine = elementWithClass("kf-playhead");
  assert.ok(visualLine, "The playhead visual must be separate from its hit target");
  assert.equal(attribute(elementWithClass("kf-playhead-area"), "aria-hidden"), "true");
  assert.equal(attribute(visualLine, "tabindex"), undefined);
  assert.equal(visualLine.props.some((prop) => prop.type === 7 && prop.name === "on"), false);
  assert.equal(cssValue(".kf-playhead", "pointer-events"), "none");
  assert.equal(cssValue(".kf-playhead", "position"), "absolute");
  assert.equal(cssValue(".kf-playhead", "top"), "0");
  assert.equal(cssValue(".kf-playhead", "bottom"), "0");
  assert.equal(cssValue(".kf-playhead", "width"), "1px");
  assert.ok(cssValue(".kf-playhead", "background"));
  assert.notEqual(cssValue(".kf-playhead", "background"), "transparent");
});

test("Keys win input at visual-line intersections while their connection segments remain passive", () => {
  const keyLevel = Number(cssValue(".kf-timeline .kf-key", "z-index"));
  const visualLevel = Number(cssValue(".kf-playhead-area", "z-index"));
  assert.ok(Number.isFinite(keyLevel)); assert.ok(Number.isFinite(visualLevel)); assert.ok(visualLevel > keyLevel);
  assert.equal(cssValue(".kf-playhead-area", "pointer-events"), "none");
  assert.equal(cssValue(".kf-playhead", "pointer-events"), "none");
  assert.notEqual(cssValue(".kf-timeline .kf-key", "pointer-events"), "none");
  assert.equal(cssValue(".kf-timeline .kf-key", "touch-action"), "none");
  assert.equal(cssValue(".kf-segment", "pointer-events"), "none");
  assert.equal(cssValue(".kf-gridline", "pointer-events"), "none");
});

test("Key drag, selection, double-click and context actions stop before lane seeking or insertion", () => {
  const key = elementWithClass("kf-key");
  const bodyPointer = directive(key, "on", "pointerdown");
  assert.equal(bodyPointer?.exp?.content, "startKeyDrag($event, row.track, key)");
  assert.ok(hasModifier(bodyPointer, "stop"));
  assert.equal(directive(key, "on", "click")?.exp?.content, "selectKey(row.track, key)");
  for (const event of ["click", "dblclick", "contextmenu"]) assert.ok(hasModifier(directive(key, "on", event), "stop"));
  assert.equal(directive(key, "on", "contextmenu")?.exp?.content, "openMenu($event, row.track, key)");
});

test("Blank property lanes, filler and the ruler retain scrubbing without stealing key clicks", () => {
  const trackContents = [];
  const visit = (element) => { if (element.type === 1 && attribute(element, "class")?.split(/\s+/).includes("kf-track-content")) trackContents.push(element); (element.children ?? []).forEach(visit); };
  visit(template);
  assert.equal(trackContents.length, 3);
  const property = trackContents.find((element) => directive(element, "on", "dblclick")); assert.ok(property);
  assert.ok(hasModifier(directive(property, "on", "pointerdown"), "self"));
  assert.ok(hasModifier(directive(property, "on", "dblclick"), "self"));
  for (const content of trackContents) assert.equal(directive(content, "on", "pointerdown")?.exp?.content, "startSeek");
  assert.notEqual(cssValue(".kf-track-content", "pointer-events"), "none");
  assert.equal(cssValue(".kf-ruler-row", "position"), "sticky");
});

console.log(`${passed} playhead layout regressions passed.`);
