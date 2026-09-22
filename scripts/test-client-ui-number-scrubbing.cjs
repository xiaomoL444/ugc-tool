/* Run: node scripts/test-client-ui-number-scrubbing.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const vue = require("vue");
const { parse } = require("@vue/compiler-sfc");

const directory = path.resolve(__dirname, "../src/views/ClientUIAnimationEditor");
const filename = path.join(directory, "ScrubbableNumberInput.vue");
const { descriptor } = parse(fs.readFileSync(filename, "utf8"), { filename });
const ast = ts.createSourceFile(filename + ".ts", descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const source = ast.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getText(ast)).join("\n");
const transpile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const mathContext = { exports: {} };
vm.runInNewContext(transpile(fs.readFileSync(path.join(directory, "numberScrubbing.ts"), "utf8")), mathContext);
const script = transpile(`${source}\nglobalThis.api = { inputElement, startScrub, scrubbing, draft, stop: () => stopScrub?.() };`);

function event(type, values = {}) {
  return Object.assign(new Event(type, { cancelable: true }), {
    pointerId: 1, pointerType: "mouse", button: 0, buttons: 1,
    clientX: 1000, movementX: 0, shiftKey: false, ctrlKey: false, metaKey: false, ...values,
  });
}

function fixture(options = {}) {
  const document = Object.assign(new EventTarget(), { pointerLockElement: null, body: { style: { cursor: "", userSelect: "" } } });
  const window = Object.assign(new EventTarget(), { innerWidth: 1600 });
  const props = vue.reactive({ modelValue: 0, ...options });
  const updates = [], changes = [], frames = new Map();
  let frameId = 0, captured = false, lockRequests = 0;
  const input = vue.markRaw({
    setPointerCapture() { captured = true; }, hasPointerCapture() { return captured; }, releasePointerCapture() { captured = false; },
    requestPointerLock() { lockRequests++; },
  });
  document.exitPointerLock = () => { document.pointerLockElement = null; document.dispatchEvent(event("pointerlockchange")); };
  const scope = vue.effectScope();
  const context = vm.createContext({
    ...vue, ...mathContext.exports, document, window, AbortController,
    defineProps: () => props,
    withDefaults: (target, defaults) => { for (const [key, value] of Object.entries(defaults)) if (target[key] === undefined) target[key] = value; return target; },
    defineEmits: () => (type, value) => { if (type === "update:modelValue") { updates.push(value); props.modelValue = value; } else if (type === "change") changes.push(value); },
    onBeforeUnmount() {},
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  scope.run(() => vm.runInContext(script, context, { filename }));
  const api = context.api; api.inputElement.value = input;
  return {
    ...api, props, updates, changes, document, input,
    get lockRequests() { return lockRequests; },
    dispatch(type, values) { window.dispatchEvent(event(type, values)); },
    lock(notify = true) { document.pointerLockElement = input; if (notify) document.dispatchEvent(event("pointerlockchange")); },
    close() { api.stop(); scope.stop(); },
  };
}

async function main() {
  let passed = 0;
  async function test(name, run) { const api = fixture(); try { await run(api); passed++; console.log(`PASS ${name}`); } finally { api.close(); } }

  await test("Default dragging never enters pointer lock or consumes coordinate-reset mouse movements", api => {
    assert.equal(api.props.pointerLock, false);
    api.startScrub(event("pointerdown"));
    api.dispatch("pointermove", {clientX:1004});
    assert.equal(api.lockRequests, 0); assert.equal(api.props.modelValue, 4);
    api.dispatch("mousemove", {movementX:0});
    api.dispatch("mousemove", {movementX:800});
    assert.equal(api.props.modelValue, 4);
    api.dispatch("pointermove", {clientX:1007}); assert.equal(api.props.modelValue,7);
    api.dispatch("pointerup"); assert.deepEqual(api.changes,[7]);
  });
  await test("Pointer-lock handover never adds the browser's coordinate-reset jump to the starting value", api => {
    api.props.pointerLock = true;
    api.startScrub(event("pointerdown"));
    api.dispatch("pointermove", { clientX: 1004 });
    assert.equal(api.props.modelValue, 4); assert.equal(api.lockRequests, 1);
    // Lock ownership can change before pointerlockchange is delivered.
    api.lock(false); api.dispatch("mousemove", { movementX: -804 });
    assert.equal(api.props.modelValue, 4, "Pre-notification compatibility movement must not become a -800 value");
    api.lock(); api.dispatch("mousemove", { movementX: -804 });
    assert.equal(api.props.modelValue, 4, "The first locked sample may reset its coordinate origin");
    api.dispatch("mousemove", { movementX: 6 });
    assert.equal(api.props.modelValue, 10);
    api.dispatch("mouseup"); assert.deepEqual(api.changes, [10]);
  });

  await test("Established locked dragging retains negative values, large movements, and precision/acceleration modifiers", api => {
    api.props.pointerLock = true;
    api.startScrub(event("pointerdown")); api.dispatch("pointermove", { clientX: 1004 });
    api.lock(); api.dispatch("mousemove", { movementX: 0 });
    api.dispatch("mousemove", { movementX: 10, shiftKey: true }); assert.equal(api.props.modelValue, 5);
    api.dispatch("mousemove", { movementX: -2, ctrlKey: true }); assert.equal(api.props.modelValue, -15);
    api.dispatch("mousemove", { movementX: -800 }); assert.equal(api.props.modelValue, -815);
  });

  await test("Ordinary dragging without pointer lock remains anchored to the initial value and ignores other pointers", api => {
    delete api.input.requestPointerLock;
    api.startScrub(event("pointerdown"));
    api.dispatch("pointermove", { clientX: 200, pointerId: 2 }); assert.equal(api.props.modelValue, 0);
    api.dispatch("pointermove", { clientX: 1002 }); assert.equal(api.props.modelValue, 0);
    api.dispatch("pointermove", { clientX: 1005 }); assert.equal(api.props.modelValue, 5);
    api.dispatch("pointermove", { clientX: 1003 }); assert.equal(api.props.modelValue, 3);
    api.dispatch("pointerup"); assert.deepEqual(api.changes, [3]);
  });

  await test("Clicking a numeric field does not write a value or request pointer lock", api => {
    api.startScrub(event("pointerdown")); api.dispatch("pointerup");
    assert.deepEqual(api.updates, []); assert.equal(api.lockRequests, 0); assert.equal(api.scrubbing.value, false);
  });

  await test("A lock granted after pointer release is released without changing the value", async api => {
    api.props.pointerLock = true;
    api.startScrub(event("pointerdown")); api.dispatch("pointermove", { clientX: 1004 }); api.dispatch("pointerup");
    api.lock(); await Promise.resolve(); await Promise.resolve();
    assert.equal(api.document.pointerLockElement, null);
    api.dispatch("mousemove", { movementX: -804 }); assert.equal(api.props.modelValue, 4);
  });

  await test("Lost mouseup is recovered on the next locked movement without applying its delta", api => {
    api.props.pointerLock = true;
    api.startScrub(event("pointerdown")); api.dispatch("pointermove", { clientX: 1004 }); api.lock();
    api.dispatch("mousemove", { movementX: 0 }); api.dispatch("mousemove", { movementX: 10, buttons: 0 });
    assert.equal(api.props.modelValue, 4); assert.equal(api.scrubbing.value, false); assert.equal(api.document.pointerLockElement, null);
  });
  console.log(`\n${passed} numeric dragging checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
