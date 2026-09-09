/* Run: node scripts/test-client-ui-timeline-context-menu.cjs
 * Executes the editor's real track menu actions with Vue reactivity.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const vue = require("vue");
const { parse } = require("@vue/compiler-sfc");

const filename = path.resolve(__dirname, "../src/views/ClientUIAnimationEditor/ClientUIAnimationEditor.vue");
const parsed = parse(fs.readFileSync(filename, "utf8"), { filename });
assert.deepEqual(parsed.errors, []);
const ast = ts.createSourceFile(filename + ".ts", parsed.descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = ["openTimelineContextMenu", "closeTimelineContextMenu", "deleteTimelineContextTrack", "removeTweenTrack", "removeTweenLane", "selectTweenTrack", "closeMenus", "closeTweenFieldPicker", "resetTimelineKeyboardShortcut", "startTweenClipDrag", "startTweenEdgeDrag", "startTweenTimingDrag", "startTimelineScrub", "sequenceDurationValue"];
const declarations = ast.statements.filter((statement) => ts.isFunctionDeclaration(statement) && names.includes(statement.name.text)).map((statement) => statement.getText(ast));
assert.equal(declarations.length, names.length);
const selectionWatch = ast.statements.find((statement) => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === "watch" && statement.getText(ast).includes("closeTimelineContextMenu"));
assert.ok(selectionWatch, "A removed or deselected track must close its menu");
const script = ts.transpileModule(`let timelineContextReturnFocus = null; let timelineSpacePressed = true;\n${declarations.join("\n")}\n${selectionWatch.getText(ast)}\nglobalThis.api = { ${names.join(", ")}, isSpaceHeld: () => timelineSpacePressed };`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const clipLayout = {};
const clipLayoutFile = path.resolve(path.dirname(filename), "timelineClipLayout.ts");
vm.runInNewContext(ts.transpileModule(fs.readFileSync(clipLayoutFile, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: clipLayout }, { filename: clipLayoutFile });

function focusTarget() {
  return { isConnected: true, focused: 0, focus() { this.focused++; }, getBoundingClientRect: () => ({ left: 30, bottom: 80 }) };
}
function fixture() {
  const node = { id: "node-a", name: "Text", properties: { text: "Keep me" } };
  const tracks = [
    { id: "line-a", nodeId: node.id, fieldKey: "anchoredPositionX", startTime: 1, duration: 2, initialValue: 0, endValue: 10 },
    { id: "line-b", nodeId: node.id, fieldKey: "anchoredPositionY", startTime: 2, duration: 1, initialValue: 0, endValue: 20 },
    { id: "line-c", nodeId: "node-b", fieldKey: "anchoredPositionX", startTime: 0, duration: 3, initialValue: 0, endValue: 30 },
  ];
  const returnFocus = focusTarget();
  const nodeFocus = focusTarget();
  let dragCleanup = 0;
  const tweenTracks = vue.ref(tracks);
  const selectedTweenTrackId = vue.ref("line-c");
  const context = vm.createContext({
    ...vue, ...clipLayout, tweenTracks, selectedTweenTrackId,
    selectedTweenTrack: vue.computed(() => tweenTracks.value.find((track) => track.id === selectedTweenTrackId.value) ?? null),
    selectedId: vue.ref("node-b"), timelineContextMenu: vue.ref(null),
    timelineContent: vue.ref(null), currentTime: vue.ref(0), duration: vue.ref(5), MIN_TWEEN_DURATION: 0.01,
    draggingTweenTrackId: vue.ref(null),
    stopTweenClipDrag: () => { dragCleanup++; },
    timelineTrackNames: vue.shallowRef({ querySelector: () => nodeFocus }),
    addMenuOpen: vue.ref(false), anchorMenuOpen: vue.ref(false), luaExportMenuOpen: vue.ref(false),
    tweenFieldPickerNodeId: vue.ref(null), tweenFieldSearch: vue.ref(""),
  });
  vm.runInContext(script, context, { filename, timeout: 2000 });
  const row = (id) => ({ kind: "tween", key: id, node, track: tweenTracks.value.find((track) => track.id === id), field: { label: "Position", fieldKey: id } });
  const event = (keyboard = false) => ({
    ...(keyboard ? { key: "F10" } : { clientX: 620, clientY: 410 }),
    currentTarget: { querySelector: () => returnFocus, getBoundingClientRect: returnFocus.getBoundingClientRect },
    defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
  });
  return { context, api: context.api, node, row, event, returnFocus, nodeFocus, cleanupCount: () => dragCleanup };
}

let passed = 0;
async function test(name, check) { await check(); passed++; console.log(`PASS ${name}`); }
async function main() {
  await test("Right-click selects the clicked Line and preserves timing", () => {
    const { context, api, row, event } = fixture();
    const before = JSON.stringify(context.tweenTracks.value);
    const pointer = event();
    api.openTimelineContextMenu(pointer, row("line-a"));
    assert.equal(pointer.defaultPrevented, true);
    assert.equal(context.selectedTweenTrackId.value, "line-a");
    assert.equal(context.selectedId.value, "node-a");
    assert.equal(context.timelineContextMenu.value.trackId, "line-a");
    assert.deepEqual([context.timelineContextMenu.value.x, context.timelineContextMenu.value.y], [620, 410]);
    assert.equal(api.isSpaceHeld(), false);
    assert.equal(JSON.stringify(context.tweenTracks.value), before);
  });
  await test("Delete removes only the context target and preserves controls/other tracks", async () => {
    const { context, api, node, row, event, returnFocus, nodeFocus } = fixture();
    const nodeBefore = JSON.stringify(node);
    const tracksBefore = JSON.stringify(context.tweenTracks.value.filter((track) => track.id !== "line-a"));
    api.openTimelineContextMenu(event(), row("line-a"));
    api.deleteTimelineContextTrack("line-a");
    returnFocus.isConnected = false;
    await vue.nextTick();
    assert.equal(JSON.stringify(context.tweenTracks.value), tracksBefore);
    assert.equal(JSON.stringify(node), nodeBefore);
    assert.equal(context.selectedTweenTrackId.value, null);
    assert.equal(context.selectedId.value, "node-a");
    assert.equal(context.timelineContextMenu.value, null);
    assert.equal(nodeFocus.focused, 1);
  });
  await test("Closing the menu restores keyboard focus without deleting a Line", async () => {
    const { context, api, row, event, returnFocus } = fixture();
    api.openTimelineContextMenu(event(true), row("line-b"));
    assert.deepEqual([context.timelineContextMenu.value.x, context.timelineContextMenu.value.y], [30, 80]);
    api.closeTimelineContextMenu(true);
    await vue.nextTick();
    assert.equal(context.tweenTracks.value.length, 3);
    assert.equal(returnFocus.focused, 1);
  });
  await test("Selection changes or removed targets invalidate stale menu actions", () => {
    const { context, api, row, event } = fixture();
    api.openTimelineContextMenu(event(), row("line-a"));
    context.selectedTweenTrackId.value = "line-b";
    assert.equal(context.timelineContextMenu.value, null);
    api.deleteTimelineContextTrack("line-a");
    assert.equal(context.tweenTracks.value.length, 3);
    api.openTimelineContextMenu(event(), row("line-a"));
    api.removeTweenTrack("line-a");
    assert.equal(context.timelineContextMenu.value, null);
    api.deleteTimelineContextTrack("line-b");
    assert.equal(context.tweenTracks.value.length, 2);
  });
  await test("Node rows and nonexistent Lines never expose deletion", () => {
    const { context, api, node, row, event } = fixture();
    api.openTimelineContextMenu(event(), { kind: "node", node });
    assert.equal(context.timelineContextMenu.value, null);
    const missing = row("line-a");
    api.removeTweenTrack("line-a");
    api.openTimelineContextMenu(event(), missing);
    assert.equal(context.timelineContextMenu.value, null);
  });
  await test("Reopening on another Line targets the newest Line", () => {
    const { context, api, row, event } = fixture();
    api.openTimelineContextMenu(event(), row("line-a"));
    api.openTimelineContextMenu(event(), row("line-b"));
    api.deleteTimelineContextTrack("line-a");
    assert.equal(context.tweenTracks.value.length, 3);
    api.deleteTimelineContextTrack("line-b");
    assert.deepEqual(Array.from(context.tweenTracks.value, (track) => track.id), ["line-a", "line-c"]);
  });
  await test("Deletion cleans up active dragging; right buttons never edit clips or scrub", () => {
    const { context, api, row, event, cleanupCount } = fixture();
    const target = row("line-a");
    const before = JSON.stringify(context.tweenTracks.value);
    api.startTweenClipDrag({ button: 2 }, target);
    api.startTweenEdgeDrag({ button: 2 }, target, "start");
    api.startTimelineScrub({ button: 2 });
    assert.equal(JSON.stringify(context.tweenTracks.value), before);
    context.draggingTweenTrackId.value = target.track.id;
    api.openTimelineContextMenu(event(), target);
    api.deleteTimelineContextTrack(target.track.id);
    assert.equal(cleanupCount(), 1);
  });
  console.log(`${passed} timeline context menu regressions passed.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
