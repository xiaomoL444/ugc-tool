const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { computed, ref } = require('vue');
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc');

const root = path.resolve(__dirname, '../src/views/DSFGStudio/components/DialogueEditor');
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const api = { exports: {} };
vm.runInNewContext(transpile(fs.readFileSync(path.join(root, 'utils/dialogueMinimap.ts'), 'utf8')), api);
const { fitDialogueMinimap, clipMinimapViewport, minimapPointToCanvas } = api.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function sfc(name) {
  const filename = path.join(root, name);
  const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  assert.deepEqual(errors, []);
  const script = compileScript(descriptor, { id: 'minimap-test' });
  assert.deepEqual(compileTemplate({ filename, id: 'minimap-test', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
  for (const style of descriptor.styles) assert.deepEqual(compileStyle({ filename, id: 'minimap-test', source: style.content, scoped: style.scoped }).errors, []);
  const ast = ts.createSourceFile(filename + '.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return names => ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name.text)).map(node => node.getText(ast)).join('\n');
}
const previewFunctions = sfc('DialogueTextPreview.vue');
const minimapFunctions = sfc('components/DialogueMinimap.vue');
console.log('PASS Minimap and text canvas scripts, templates and styles compile');

for (const [width, height] of [[560, 5000], [3000, 600], [184, 124]]) {
  const projection = fitDialogueMinimap(width, height, 184, 124);
  const point = minimapPointToCanvas(projection.x + width * projection.scale / 2, projection.y + height * projection.scale / 2, projection);
  near(point.x, width / 2); near(point.y, height / 2);
  assert.ok(projection.x >= 0 && projection.y >= 0);
  assert.ok(width * projection.scale <= 184 && height * projection.scale <= 124);
}
assert.deepEqual(plain(clipMinimapViewport({ x: -50, y: -24, width: 900, height: 900 }, 560, 800)), { x: 0, y: 0, width: 560, height: 800 });
assert.deepEqual(plain(clipMinimapViewport({ x: 500, y: 780, width: 300, height: 100 }, 560, 800)), { x: 500, y: 780, width: 60, height: 20 });
console.log('PASS Tall/wide maps fit correctly, letterboxing maps back to canvas, and visible frame clips to content');

for (const scale of [.5, 1, 1.5]) {
  const moves = [];
  const context = { zoom: { value: scale }, minimapViewport: { value: {} }, scheduleMinimapSync() {},
    viewport: { value: { clientLeft: 0, clientTop: 0, clientWidth: 600, clientHeight: 400,
      getBoundingClientRect: () => ({ left: 100, top: 80 }), scrollBy: move => moves.push(move) } },
    surface: { value: { getBoundingClientRect: () => ({ left: 124, top: -120 }) } } };
  vm.createContext(context);
  vm.runInContext(transpile(previewFunctions(['syncMinimapViewport', 'navigateMinimap'])), context);
  context.syncMinimapViewport();
  assert.deepEqual(plain(context.minimapViewport.value), { x: -24 / scale, y: 200 / scale, width: 600 / scale, height: 400 / scale });
  context.navigateMinimap({ x: context.minimapViewport.value.x + 100, y: context.minimapViewport.value.y + 200 });
  near(moves[0].left, 100 * scale); near(moves[0].top, 200 * scale);
  assert.equal(moves[0].behavior, 'auto');
}
console.log('PASS Navigation respects canvas padding, centering and 50%/100%/150% zoom');

const moves = [], view = { x: 100, y: 200, width: 200, height: 300 };
let captured = false;
const svg = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 184, height: 124 }), setPointerCapture() { captured = true; }, hasPointerCapture() { return captured; }, releasePointerCapture() { captured = false; } };
const projection = fitDialogueMinimap(1000, 1000, 184, 124);
const context = { props: { viewport: view }, visible: computed(() => clipMinimapViewport(view, 1000, 1000)),
  dragging: ref(false), projection: { value: projection }, mapWidth: 184, mapHeight: 124, minimapPointToCanvas,
  emit(event, position) { assert.equal(event, 'navigate'); moves.push(plain(position)); } };
vm.createContext(context);
vm.runInContext('var drag;\n' + transpile(minimapFunctions(['point', 'start', 'move', 'end', 'keydown'])), context);
const event = (x, y, pointerId = 1) => ({ button: 0, pointerId, currentTarget: svg, clientX: 10 + projection.x + x * projection.scale, clientY: 20 + projection.y + y * projection.scale });
context.start(event(150, 250));
assert.equal(moves.length, 0, 'Grabbing inside the viewport must not jump');
context.move(event(200, 350, 2)); assert.equal(moves.length, 0);
context.move(event(200, 350)); near(moves[0].x, 150); near(moves[0].y, 300);
context.end(event(200, 350)); assert.equal(captured, false); assert.equal(context.dragging.value, false);
context.start(event(800, 800)); near(moves[1].x, 700); near(moves[1].y, 650);
context.end(event(800, 800));
context.keydown({ key: 'ArrowDown', preventDefault() {} }); assert.deepEqual(moves[2], { x: 100, y: 260 });
assert.deepEqual(view, { x: 100, y: 200, width: 200, height: 300 });
console.log('PASS Actual pointer handlers preserve grab offset, ignore other pointers, click to locate, release capture and support keyboard navigation');
