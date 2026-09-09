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
const template = parsed.descriptor.template.ast;
const styles = parsed.descriptor.styles.map((style) => style.content).join("\n");
const compiledStyles = compileStyle({ source: styles, filename, id: "playhead-layout-tests" });
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

test("Playhead hit target, visual line and snapping guide share the full-height layout helper", () => {
  const playhead = elementWithClass("playhead");
  const visualLine = elementWithClass("playhead-line");
  const snapGuide = elementWithClass("timeline-snap-guide");
  assert.ok(playhead && visualLine && snapGuide);
  assert.equal(directive(playhead, "bind", "style")?.exp?.content, "timelineGuideStyle(currentTime)");
  assert.equal(directive(visualLine, "bind", "style")?.exp?.content, "timelineGuideStyle(currentTime)");
  assert.equal(directive(snapGuide, "bind", "style")?.exp?.content, "timelineGuideStyle(timelineSnapTime)");
  assert.equal(snapGuide.props.find((prop) => prop.type === 7 && prop.name === "if")?.exp?.content, "timelineSnapTime !== null");
  assert.equal(attribute(snapGuide, "aria-hidden"), "true");
});

test("The playhead remains a focusable draggable slider with keyboard navigation", () => {
  const playhead = elementWithClass("playhead");
  assert.equal(attribute(playhead, "role"), "slider");
  assert.equal(attribute(playhead, "tabindex"), "0");
  assert.equal(attribute(playhead, "aria-label"), "时间轴播放进度");
  const pointerDown = directive(playhead, "on", "pointerdown");
  assert.equal(pointerDown?.exp?.content, "startTimelineScrub");
  assert.ok(pointerDown.modifiers.some((modifier) => (modifier.content ?? modifier) === "stop"));
  const handlers = playhead.props.filter((prop) => prop.type === 7 && prop.name === "on" && prop.arg?.content === "keydown");
  for (const [key, expected] of [["left", "nudgeTimelineProgress(-1)"], ["right", "nudgeTimelineProgress(1)"], ["home", "rewindPlayback"], ["end", "currentTime = duration"]]) {
    const handler = handlers.find((prop) => prop.modifiers.some((modifier) => (modifier.content ?? modifier) === key));
    assert.equal(handler?.exp?.content, expected, key);
    assert.ok(handler.modifiers.some((modifier) => (modifier.content ?? modifier) === "prevent"), key);
  }
});

test("The later playhead CSS releases the old bottom-zero viewport constraint", () => {
  assert.match(lastRuleBody("playhead"), /\bbottom\s*:\s*auto\s*;/);
  assert.match(lastRuleBody("playhead"), /\bpointer-events\s*:\s*auto\s*;/);
  assert.match(lastRuleBody("track-lane"), /\bheight\s*:\s*33px\s*;/);
});

test("The guide hit area spans its full height while the snapping line is noninteractive", () => {
  const hitArea = styles.match(/\.playhead::after\s*\{([^}]+)\}/)?.[1];
  assert.ok(hitArea);
  assert.match(hitArea, /\btop\s*:\s*0\s*;/);
  assert.match(hitArea, /\bbottom\s*:\s*0\s*;/);
  assert.match(hitArea, /\bwidth\s*:\s*15px\s*;/);
  assert.match(lastRuleBody("timeline-snap-guide"), /\bpointer-events\s*:\s*none\s*;/);
});

test("The independent visual line stays visible without intercepting Clip input", () => {
  const visualLine = elementWithClass("playhead-line");
  assert.ok(visualLine, "The playhead visual must be separate from its hit target");
  assert.equal(attribute(visualLine, "aria-hidden"), "true");
  assert.equal(attribute(visualLine, "tabindex"), undefined);
  assert.equal(visualLine.props.some((prop) => prop.type === 7 && prop.name === "on"), false);
  assert.equal(cssValue(".playhead-line", "pointer-events"), "none");
  assert.equal(cssValue(".playhead-line", "position"), "absolute");
  assert.equal(cssValue(".playhead-line", "top"), "0");
  assert.equal(cssValue(".playhead-line", "width"), "1px");
  assert.equal(cssValue(".playhead-line", "min-height"), "100%");
  assert.equal(cssValue(".playhead", "background"), "transparent");
  assert.ok(cssValue(".playhead-line", "background"));
  assert.notEqual(cssValue(".playhead-line", "background"), "transparent");
  assert.notEqual(cssValue(".playhead-line", "bottom"), "0", "The visual must not regress to viewport-only height");
});

test("Clip bodies and their edge handles outrank the playhead hit target, but not its visible line", () => {
  const hitLevel = Number(cssValue(".playhead", "z-index"));
  const clipLevel = Number(cssValue(".tween-clip", "z-index"));
  const dragLevel = Number(cssValue(".tween-clip.dragging", "z-index"));
  const visualLevel = Number(cssValue(".playhead-line", "z-index"));
  for (const level of [hitLevel, clipLevel, dragLevel, visualLevel]) assert.ok(Number.isFinite(level));
  assert.ok(clipLevel > hitLevel, "An idle Clip must receive the first click even where the playhead crosses it");
  assert.ok(dragLevel > hitLevel, "Dragging a Clip must not switch to scrubbing the playhead");
  assert.ok(visualLevel > Math.max(clipLevel, dragLevel), "The visible line must still span every Clip row");
  assert.ok([undefined, "auto"].includes(cssValue(".track-lane", "z-index")), "A row stacking context must not trap Clips below the playhead hit target");
  assert.notEqual(cssValue(".tween-clip", "pointer-events"), "none");
  assert.notEqual(cssValue(".tween-edge-handle", "pointer-events"), "none");
});

test("Clip body and both resize edges stop pointerdown before it reaches timeline scrubbing", () => {
  const clip = elementWithClass("tween-clip");
  const bodyPointer = directive(clip, "on", "pointerdown");
  assert.equal(bodyPointer?.exp?.content, "startTweenClipDrag($event, { ...row, track: clip })");
  assert.ok(hasModifier(bodyPointer, "stop"));
  assert.notEqual(directive(clip, "on", "click")?.exp?.content?.includes("startTimelineScrub"), true);
  for (const edge of ["start", "end"]) {
    const handle = elementWithClass(`edge-${edge}`, clip);
    const edgePointer = directive(handle, "on", "pointerdown");
    assert.equal(edgePointer?.exp?.content, `startTweenEdgeDrag($event, { ...row, track: clip }, '${edge}')`);
    assert.ok(hasModifier(edgePointer, "stop"), `${edge} resize must not bubble into Clip move or timeline scrub`);
  }
});

test("Blank timeline lanes and the ruler retain click-and-drag scrubbing", () => {
  for (const className of ["timeline-lanes", "time-ruler"]) {
    const element = elementWithClass(className);
    assert.equal(directive(element, "on", "pointerdown")?.exp?.content, "startTimelineScrub", className);
    assert.notEqual(cssValue(`.${className}`, "pointer-events"), "none", className);
  }
});

console.log(`${passed} playhead layout regressions passed.`);
