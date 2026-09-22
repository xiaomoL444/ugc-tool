/* Real KeyframeTimeline SFC setup and template compilation; no replicated UI logic. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const ts = require("typescript");
const vue = require("vue");
const { parse, compileScript, compileTemplate } = require("@vue/compiler-sfc");
const editor = path.resolve(__dirname, "../src/views/ClientUIAnimationEditor");
const filename = path.join(editor, "KeyframeTimeline.vue");
const { descriptor, errors } = parse(fs.readFileSync(filename, "utf8"), { filename });
assert.deepEqual(errors, []);
const compiled = compileScript(descriptor, { id: "keyframe-timeline-test" });
assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: "keyframe-timeline-test", compilerOptions: { bindingMetadata: compiled.bindings } }).errors, []);
const ast = ts.createSourceFile(filename + ".ts", descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declarations = ast.statements.filter((item) => !ts.isImportDeclaration(item)).map((item) => item.getText(ast)).join("\n");
const names = ["root", "ruler", "rows", "selection", "notice", "menu", "clipboard", "startKeyDrag", "startSeek", "startRowSeek", "snapTime", "changeKeyTime", "changeDuration", "changeEase", "changeInterpolation", "patchSelected", "addKey", "openMenu", "menuAddKey", "menuDeleteKey", "menuDeleteTrack", "removeSelectedKey", "copyKey", "pasteKey", "handleKeyDown", "handleRulerKey", "toggleCollapsed"];
const code = ts.transpileModule(`${declarations}\nglobalThis.api={${names.join(",")}}`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const originalTs = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, file);
const registry = require(path.join(editor, "tweenRegistry.ts"));
const plain = (value) => JSON.parse(JSON.stringify(value));
const key = (id, time, value = 0) => ({ id, time, value, relative: false, easeType: "Linear", interpolation: "tween" });
function fixture() {
  const events = []; const listeners = new Map(); const unmounts = [];
  const props = vue.reactive({ nodes: [{ id: "root", parentId: null, name: "Root", type: "container" }, { id: "image", parentId: "root", name: "Image", type: "image" }],
    tracks: [{ id: "scale", nodeId: "root", fieldKey: "localScaleZ", keyframes: [key("a", 0, 1), key("b", 2, 2), key("c", 4, 3)] },
      { id: "color", nodeId: "image", fieldKey: "imageColor", keyframes: [key("d", 1.25, { r: 10, g: 20, b: 30, a: 0.5 })] }],
    selectedNodeId: "root", selectedKeyframeId: "a", currentTime: 0, duration: 5, playing: false, snapEnabled: false });
  let nextId = 0;
  const emit = (name, ...args) => {
    events.push([name, ...plain(args)]);
    const track = props.tracks.find((item) => item.id === args[0]);
    if (name === "select-node") props.selectedNodeId = args[0];
    if (name === "select-keyframe") props.selectedKeyframeId = args[1];
    if (name === "seek") props.currentTime = args[0];
    if (name === "move-keyframe") { track.keyframes.find((item) => item.id === args[1]).time = args[2]; props.currentTime = args[2]; }
    if (name === "update-keyframe") Object.assign(track.keyframes.find((item) => item.id === args[1]), Object.fromEntries(Object.entries(args[2]).filter(([, value]) => value !== undefined)));
    if (name === "upsert-keyframe" && !track.keyframes.some((item) => item.time === args[1])) {
      // Match the editor: insertion inherits the preceding key's relative mode,
      // and undefined patch fields do not overwrite that newly created mode.
      const previous = [...track.keyframes].sort((a, b) => a.time - b.time).filter((item) => item.time < args[1]).at(-1);
      track.keyframes.push({ ...key(`pasted-${++nextId}`, args[1], 0), relative: Boolean(previous?.relative) });
    }
    if (name === "remove-keyframe") track.keyframes = track.keyframes.filter((item) => item.id !== args[1]);
    if (name === "remove-track") props.tracks = props.tracks.filter((item) => item.id !== args[0]);
  };
  const context = vm.createContext({ ...vue, ...registry, defineProps: () => props, defineEmits: () => emit,
    onMounted: (fn) => fn(), onBeforeUnmount: (fn) => unmounts.push(fn),
    window: { innerWidth: 1000, innerHeight: 700,
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    },
  });
  const scope = vue.effectScope(); scope.run(() => vm.runInContext(code, context, { timeout: 2000 }));
  const api = context.api;
  const lane = { clientWidth: 500, getBoundingClientRect: () => ({ left: 100, width: 500 }) };
  api.ruler.value = lane; api.root.value = { focus() {} };
  const pointer = (x = 100, extras = {}) => ({ button: 0, pointerId: 3, clientX: x, clientY: 100, currentTarget: { parentElement: lane }, preventDefault() {}, ...extras });
  return { api, props, events, lane, pointer, dispatch(type, event) { for (const fn of [...listeners.get(type) ?? []]) fn(event); }, close() { unmounts.forEach((fn) => fn()); scope.stop(); } };
}
async function main() {
  let passed = 0;
  const test = async (name, run) => { const item = fixture(); try { await run(item); passed++; console.log(`PASS ${name}`); } finally { item.close(); } };
  await test("Rows preserve hierarchy and selection and collapse only that control's property rows", ({ api, props }) => {
    assert.deepEqual(plain(api.rows.value.map((row) => [row.kind, row.depth])), [["node", 0], ["track", 0], ["node", 1], ["track", 1]]);
    api.toggleCollapsed("root"); assert.equal(api.rows.value.length, 3);
    props.selectedKeyframeId = null; assert.equal(api.selection.value, null);
  });
  await test("Key dragging wins over seeking, clamps to duration and rejects duplicate times", ({ api, props, events, pointer, dispatch }) => {
    api.startKeyDrag(pointer(), props.tracks[0], props.tracks[0].keyframes[0]);
    dispatch("pointermove", pointer(200)); assert.equal(props.tracks[0].keyframes[0].time, 1);
    dispatch("pointermove", pointer(300)); assert.equal(props.tracks[0].keyframes[0].time, 1); assert.match(api.notice.value, /不能/);
    dispatch("pointermove", pointer(1000)); assert.equal(props.tracks[0].keyframes[0].time, 5);
    dispatch("pointermove", pointer(-100)); assert.equal(props.tracks[0].keyframes[0].time, 0);
    dispatch("pointerup", pointer());
    assert.equal(events.filter(([name]) => name === "begin-edit").length, 1); assert.equal(events.filter(([name]) => name === "end-edit").length, 1);
    assert.equal(events.some(([name]) => name === "seek"), false);
  });
  await test("Drag ignores another pointer and blur or cancel releases handlers once", ({ api, props, events, pointer, dispatch }) => {
    api.startKeyDrag(pointer(), props.tracks[0], props.tracks[0].keyframes[0]);
    dispatch("pointermove", pointer(200, { pointerId: 9 })); dispatch("pointercancel", pointer(200, { pointerId: 9 }));
    assert.equal(props.tracks[0].keyframes[0].time, 0);
    dispatch("pointermove", pointer(200)); dispatch("blur", {}); dispatch("pointermove", pointer(400));
    assert.equal(props.tracks[0].keyframes[0].time, 1);
    assert.equal(events.filter(([name]) => name === "end-edit").length, 1);
  });
  await test("Snapping follows another lane's key while the toggle disables attraction", ({ api, props }) => {
    props.snapEnabled = true; assert.equal(api.snapTime(1.3, props.tracks[0], "a", 500), 1.25);
    props.snapEnabled = false; assert.equal(api.snapTime(1.3, props.tracks[0], "a", 500), 1.3);
  });
  await test("Dragging freezes its playhead snap target so a following playhead cannot attract the key to itself", ({ api, props, pointer, dispatch }) => {
    props.snapEnabled = true;
    api.startKeyDrag(pointer(), props.tracks[0], props.tracks[0].keyframes[0]);
    dispatch("pointermove", pointer(123)); assert.equal(props.tracks[0].keyframes[0].time, 0.233333);
    props.currentTime = 0.23; // The real parent seeks to each moved key.
    dispatch("pointermove", pointer(126)); assert.equal(props.tracks[0].keyframes[0].time, 0.266667);
    props.currentTime = 0.26;
    dispatch("pointermove", pointer(129)); assert.equal(props.tracks[0].keyframes[0].time, 0.3);
    dispatch("pointerup", pointer(129));
  });
  await test("Frame rate defaults to 30, controls single/ten-frame stepping and preserves existing keys", ({ api, props }) => {
    const saved = plain(props.tracks);
    api.handleRulerKey({ key:'ArrowRight', preventDefault() {} }); assert.equal(props.currentTime, 0.033333);
    api.handleRulerKey({ key:'ArrowRight', shiftKey:true, preventDefault() {} }); assert.equal(props.currentTime, 0.366667);
    props.frameRate = 24; props.currentTime = 0;
    api.handleRulerKey({ key:'ArrowRight', preventDefault() {} }); assert.equal(props.currentTime, 0.041667);
    assert.deepEqual(plain(props.tracks), saved);
  });
  await test("Inspector follows the preceding key on the selected track without seeking", ({ api, props, events }) => {
    props.currentTime = 3; assert.equal(api.selection.value.key.id, 'b');
    api.patchSelected({easeType:'OutQuad'}); assert.equal(props.tracks[0].keyframes[1].easeType,'OutQuad');
    assert.equal(props.currentTime,3);
    props.currentTime = 4; assert.equal(api.selection.value.key.id,'c');
    props.currentTime = 1; assert.equal(api.selection.value.key.id,'a');
    props.selectedKeyframeId = 'd'; assert.equal(api.selection.value,null);
    props.currentTime = 1.25; assert.equal(api.selection.value.key.id,'d');
    assert.equal(events.some(e=>e[0]==='seek'),false);
  });
  await test("The time collision epsilon is inclusive, matching the parent editor's validation", ({ api, props }) => {
    props.selectedKeyframeId = "b"; props.currentTime = 2;
    api.changeKeyTime(0.000001); assert.equal(props.tracks[0].keyframes[1].time, 2);
    assert.match(api.notice.value, /已有/);
    api.changeKeyTime(0.000002); assert.equal(props.tracks[0].keyframes[1].time, 0.000002);
  });
  await test("Scrubbing playhead and Home/End change only time, never create history transactions", ({ api, props, lane, pointer, dispatch, events }) => {
    const before = plain(props.tracks);
    api.startSeek(pointer(350, { currentTarget: lane })); assert.equal(props.currentTime, 2.5);
    dispatch("pointermove", pointer(800)); assert.equal(props.currentTime, 5); dispatch("pointerup", pointer());
    api.handleRulerKey({ key: "Home", preventDefault() {} }); assert.equal(props.currentTime, 0);
    api.handleRulerKey({ key: "End", preventDefault() {} }); assert.equal(props.currentTime, 5);
    assert.deepEqual(plain(props.tracks), before); assert.equal(events.some(([name]) => name === "begin-edit"), false);
  });
  await test("Numeric key editing validates collisions and duration cannot trim existing keys", ({ api, props, events }) => {
    api.changeKeyTime(2); assert.equal(props.tracks[0].keyframes[0].time, 0);
    api.changeKeyTime(-10); assert.equal(props.tracks[0].keyframes[0].time, 0);
    api.changeKeyTime(1); assert.equal(props.tracks[0].keyframes[0].time, 1);
    api.changeDuration(2); assert.deepEqual(events.at(-1), ["update-duration", 4]);
    api.changeInterpolation({ target: { value: "step" } }); assert.equal(props.tracks[0].keyframes[0].interpolation, "step");
    api.changeEase({ target: { value: "OutQuad" } }); assert.equal(props.tracks[0].keyframes[0].easeType, "OutQuad");
  });
  await test("Context creation records pointer time and deletion differentiates one key from its whole lane", ({ api, props, lane }) => {
    api.openMenu({ currentTarget: lane, clientX: 350, clientY: 200 }, props.tracks[0]);
    assert.equal(api.menu.value.time, 2.5); api.menuAddKey(); assert.ok(props.tracks[0].keyframes.some((key) => key.time === 2.5));
    api.openMenu({ clientX: 350, clientY: 200 }, props.tracks[0], props.tracks[0].keyframes[0]); api.menuDeleteKey();
    assert.equal(props.tracks[0].keyframes.some((key) => key.id === "a"), false);
    api.openMenu({ currentTarget: lane, clientX: 350, clientY: 200 }, props.tracks[0]); api.menuDeleteTrack();
    assert.deepEqual(plain(props.tracks.map((track) => track.id)), ["color"]);
  });
  await test("Copy/paste clones color, ease and interpolation into a new key and refuses occupied time", async ({ api, props, events }) => {
    props.selectedKeyframeId = "d"; props.currentTime = 1.25; api.copyKey(); props.tracks[1].keyframes[0].value.r = 200;
    props.currentTime = 3; await api.pasteKey();
    const pasted = props.tracks[1].keyframes.find((key) => key.time === 3); assert.ok(pasted); assert.equal(pasted.value.r, 10);
    assert.notEqual(pasted.id, "d"); assert.equal(props.selectedKeyframeId, pasted.id);
    const count = events.length; await api.pasteKey(); assert.equal(events.length, count); assert.match(api.notice.value, /已有/);
  });
  await test("Pasting an implicit absolute key explicitly clears relative mode inherited from its new predecessor", async ({ api, props, events }) => {
    const source = props.tracks[0].keyframes[0]; delete source.relative;
    props.tracks[0].keyframes[1].relative = true;
    api.copyKey(); assert.equal(Object.hasOwn(api.clipboard.value.key, "relative"), false);
    props.currentTime = 3;
    const pending = api.pasteKey();
    const pasted = props.tracks[0].keyframes.find((item) => item.time === 3);
    assert.ok(pasted); assert.equal(pasted.relative, true, "Insertion must first reproduce the inherited-relative case");
    await pending;
    const update = events.findLast(([name, trackId, keyId]) => name === "update-keyframe" && trackId === "scale" && keyId === pasted.id);
    assert.ok(update); assert.equal(Object.hasOwn(update[3], "relative"), true);
    assert.equal(update[3].relative, false); assert.equal(pasted.relative, false);
    assert.equal(pasted.value, source.value);
  });
  await test("Delete and clipboard keep native input editing untouched", ({ api, props, events }) => {
    const event = { key: "Delete", target: { closest: () => ({}) }, preventDefault() { assert.fail("Native input action stolen"); } };
    api.handleKeyDown(event); assert.equal(events.length, 0);
    api.handleKeyDown({ key: "Delete", target: { closest: () => null }, preventDefault() {}, stopPropagation() {} });
    assert.equal(props.tracks[0].keyframes.some((key) => key.id === "a"), false);
  });
  await test("Clicking a property lane seeks then selects that track; node lanes only seek", ({ api, props, lane, pointer, dispatch, events }) => {
    const row = api.rows.value.find(row=>row.kind==='track' && row.track.id==='color');
    api.startRowSeek(pointer(350,{currentTarget:lane}),row);
    assert.equal(props.currentTime,2.5);
    assert.deepEqual(events.slice(-2),[['seek',2.5],['select-track','color']]);
    dispatch('pointermove',pointer(400)); assert.equal(props.currentTime,3);
    dispatch('pointerup',pointer(400));
    const count=events.length;
    api.startRowSeek(pointer(200,{button:2,currentTarget:lane}),row); assert.equal(events.length,count);
    api.startRowSeek(pointer(200,{currentTarget:lane}),api.rows.value.find(row=>row.kind==='node'));
    assert.equal(events.slice(count).some(e=>e[0]==='select-track'),false);
    dispatch('pointerup',pointer(200));
  });
  await test("Timeline line is noninteractive and key handlers stop pointer propagation", () => {
    assert.match(descriptor.template.content, /@pointerdown\.stop="startKeyDrag/);
    assert.match(descriptor.styles[0].content, /\.kf-playhead\s*\{[^}]*pointer-events:\s*none/);
    assert.match(descriptor.styles[0].content, /\.kf-playhead-area\s*\{[^}]*pointer-events:\s*none/);
    assert.match(descriptor.styles[0].content, /\.kf-key\s*\{[^}]*touch-action:\s*none/);
  });
  await test("Keyframe inspector inputs and interpolation controls carry the red animated treatment", () => {
    const template = descriptor.template.content;
    for (const label of ["关键帧时间", "关键帧属性值"]) {
      const input = template.match(new RegExp(`<ScrubbableNumberInput\\b[^>]*aria-label="${label}"[^>]*>`))?.[0];
      assert.ok(input); assert.match(input, /:animated="true"/);
      assert.doesNotMatch(input, /(?:\s|:)allow-empty(?:\s|=)/);
    }
    assert.match(template, /<ColorRGBAField\b[^>]*:animated="true"/);
    for (const label of ["关键帧插值方式"]) {
      const select = template.match(new RegExp(`<select\\b[^>]*aria-label="${label}"[^>]*>`))?.[0];
      assert.ok(select); assert.match(select, /data-animated="true"/);
    }
    assert.match(template, /class="kf-relative is-animated" data-animated="true"/);
    assert.match(template, /<EasePicker\b[^>]*:model-value="selection.key.easeType"/);
    const picker = fs.readFileSync(path.join(editor, "EasePicker.vue"), "utf8");
    assert.match(picker, /background:#442f3a/);
    assert.match(descriptor.styles[0].content, /input\.is-animated[^}]*background:\s*#533843\s*!important/);
  });
  await test("The control inspector permits empty numeric values only on nonanimated properties", () => {
    const inspectorPath = path.join(editor, "ControlPropertiesInspector.vue");
    const inspector = parse(fs.readFileSync(inspectorPath, "utf8"), { filename: inspectorPath }).descriptor.template.content;
    const input = inspector.match(/<ScrubbableNumberInput\b[^>]*v-else-if="field.kind === 'number'"[^>]*>/)?.[0];
    assert.ok(input); assert.match(input, /:animated="isAnimated\(field\)"/);
    assert.match(input, /:allow-empty="!isAnimated\(field\)"/);
    assert.doesNotMatch(input, /:allow-empty="true"/);
  });
  console.log(`\n${passed} keyframe timeline component checks passed.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { if (originalTs) Module._extensions[".ts"] = originalTs; else delete Module._extensions[".ts"]; });
