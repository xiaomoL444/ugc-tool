/* Run with: node scripts/test-dsfg-timeline-drag.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const vue = require("vue");
const { parse } = require("@vue/compiler-sfc");

const root = path.resolve(__dirname, "..");
const editor = path.join(root, "src/views/DSFGStudio/components/DialogueEditor");
const filename = path.join(editor, "GroupTimelineV3.vue");
const parsed = parse(fs.readFileSync(filename, "utf8"), { filename });
assert.deepEqual(parsed.errors, []);

function transpile(source, sourcePath) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText;
}

// Run the real timing helpers and the complete component script. Vue's reactive
// computed values reproduce the feedback loop that isolated handler mocks miss.
const helpers = { exports: {} };
vm.runInNewContext(transpile(fs.readFileSync(path.join(editor, "utils/groupTimeline.ts"), "utf8")), { exports: helpers.exports });
const scriptAst = ts.createSourceFile(filename + ".ts", parsed.descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const componentScript = scriptAst.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getText(scriptAst)).join("\n");
const exposed = `globalThis.api = {
  timelineDuration, pixelsPerSecond, timelineWidth, contentDuration,
  viewportWidth, timelineScrollRef, editorOpen, selectedId,
  startDrag, dragClip, stopDrag, startResize, resizeClip, stopResize,
  startContinueDelayDrag, dragContinueDelay, stopContinueDelayDrag,
  openEditor,
};`;

function performanceClip(type = "Camera", startTime = 7, duration = 3) {
  return { id: `clip-${type}`, type, name: type, startTime, duration, components: [] };
}

function group(clip = performanceClip()) {
  return { id: "group-a", timeline: { duration: 2 }, lines: [{ id: "line", type: clip.type, name: clip.type, clips: [clip] }] };
}

function harness(node = group()) {
  const props = vue.reactive({ node });
  const mounted = [];
  const unmounted = [];
  const listeners = new Map();
  const timers = new Map();
  let timerId = 0;
  const capture = options => options === true || !!options?.capture;
  const window = {
    addEventListener(type, callback, options) {
      const entries = listeners.get(type) ?? [];
      if (!entries.some(entry => entry.callback === callback && entry.capture === capture(options))) {
        entries.push({ callback, capture: capture(options), once: !!options?.once });
      }
      listeners.set(type, entries);
    },
    removeEventListener(type, callback, options) {
      listeners.set(type, (listeners.get(type) ?? []).filter(entry => entry.callback !== callback || entry.capture !== capture(options)));
    },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  const scope = vue.effectScope();
  const context = vm.createContext({
    ...helpers.exports,
    computed: vue.computed, ref: vue.ref, watch: vue.watch,
    onMounted: callback => mounted.push(callback),
    onBeforeUnmount: callback => unmounted.push(callback),
    defineProps: () => props, defineEmits: () => () => {},
    usePublicEventPresets: () => ({ availablePresets: vue.ref([]) }),
    getLineDefinitions: () => [],
    getGroupOutletWarnings: () => [],
    timelineClipClipboard: vue.ref(),
    window,
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  scope.run(() => vm.runInContext(transpile(componentScript, filename + ".ts") + exposed, context));
  const api = context.api;
  api.timelineScrollRef.value = { scrollLeft: 0, clientWidth: 918 };
  mounted.forEach(callback => callback());
  function event(clientX = 100, pointerId = 1, button = 0) {
    return { clientX, pointerId, button, preventDefault() {}, stopPropagation() {}, composedPath: () => [] };
  }
  function dispatch(type, input = event()) {
    input.type = type;
    for (const entry of [...(listeners.get(type) ?? [])]) {
      if (!(listeners.get(type) ?? []).includes(entry)) continue;
      if (entry.once) window.removeEventListener(type, entry.callback, entry.capture);
      entry.callback(input);
    }
  }
  function flushTimers() {
    for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
  }
  function dispose() {
    unmounted.forEach(callback => callback());
    scope.stop();
  }
  return { api, props, event, dispatch, flushTimers, dispose, listeners };
}

let passed = 0;
async function test(name, check) {
  await check();
  passed += 1;
  console.log(`PASS ${name}`);
}

async function main() {
  await test("Auto duration thresholds cannot change drag scale or repeat the feedback loop", () => {
    const h = harness();
    try {
      const clip = h.props.node.lines[0].clips[0];
      assert.equal(h.api.timelineDuration.value, 12);
      const scale = h.api.pixelsPerSecond.value;
      h.api.startDrag(h.event(), clip);
      for (const delta of [0.5, 3, 4, 1, -2, 4]) {
        const event = h.event(100 + delta * scale);
        h.dispatch("pointermove", event);
        const expected = 7 + delta;
        assert.equal(clip.startTime, expected);
        assert.equal(h.api.timelineDuration.value, 12);
        assert.equal(h.api.pixelsPerSecond.value, scale);
        for (let repeat = 0; repeat < 8; repeat++) {
          h.dispatch("pointermove", event);
          assert.equal(clip.startTime, expected, "An unchanged pointer must keep an unchanged Clip position");
        }
        assert.ok(h.api.timelineWidth.value >= 118 + h.api.contentDuration.value * scale + 24);
      }
      h.dispatch("pointerup", h.event());
      assert.equal(clip.startTime, 11);
      assert.equal(h.api.timelineDuration.value, 16);
      assert.equal(h.api.pixelsPerSecond.value, (918 - 118 - 24) / 16);
      h.api.startDrag(h.event(), clip);
      const nextScale = h.api.pixelsPerSecond.value;
      h.dispatch("pointermove", h.event(100 - nextScale));
      assert.equal(clip.startTime, 10, "A new gesture must use the newly fitted scale");
    } finally { h.dispose(); }
  });

  for (const kind of ["dialogue", "select", "focusPush", "performance"]) {
    await test(`${kind} dragging keeps the captured scale through viewport and scroll changes`, () => {
      const node = group(performanceClip("Camera", 5, 4));
      if (kind !== "performance") node[kind] = { id: kind, startTime: 7, ...(kind === "focusPush" ? {} : { continueDelayTime: 0.5 }) };
      const h = harness(node);
      try {
        const clip = kind === "performance" ? h.props.node.lines[0].clips[0] : h.props.node[kind];
        const scale = h.api.pixelsPerSecond.value;
        const duration = h.api.timelineDuration.value;
        const start = clip.startTime;
        h.api.timelineScrollRef.value.scrollLeft = 80;
        h.api.startDrag(h.event(), clip);
        h.api.viewportWidth.value = 1200;
        h.api.timelineScrollRef.value.scrollLeft = 80 + 2 * scale;
        h.dispatch("pointermove", h.event(100 + scale));
        assert.equal(clip.startTime, start + 3);
        assert.equal(h.api.pixelsPerSecond.value, scale, "Rendering and pointer conversion must share the captured scale");
        assert.equal(h.api.timelineDuration.value, duration);
        h.api.timelineScrollRef.value.scrollLeft = 80;
        h.dispatch("pointermove", h.event(100));
        assert.equal(clip.startTime, start);
        h.dispatch("pointermove", h.event(-10000));
        assert.equal(clip.startTime, 0);
        h.dispatch("pointerup", h.event());
        assert.equal(h.api.pixelsPerSecond.value, (1200 - 118 - 24) / h.api.timelineDuration.value);
      } finally { h.dispose(); }
    });
  }

  await test("End resize crosses auto duration thresholds using one stable scale", () => {
    const h = harness();
    try {
      const clip = h.props.node.lines[0].clips[0];
      const scale = h.api.pixelsPerSecond.value;
      h.api.startResize(h.event(), clip, "end");
      for (const delta of [3, 4, 1, 4]) {
        h.dispatch("pointermove", h.event(100 + delta * scale));
        assert.equal(clip.duration, 3 + delta);
        assert.equal(clip.startTime, 7);
        assert.equal(h.api.timelineDuration.value, 12);
        assert.equal(h.api.pixelsPerSecond.value, scale);
        h.dispatch("pointermove", h.event(100 + delta * scale));
        assert.equal(clip.duration, 3 + delta);
      }
      h.dispatch("pointerup", h.event());
      assert.equal(h.api.timelineDuration.value, 16);
    } finally { h.dispose(); }
  });

  await test("Shrinking content during a drag cannot shrink the canvas and clamp its scroll offset", () => {
    const h = harness();
    try {
      const clip = h.props.node.lines[0].clips[0];
      const scale = h.api.pixelsPerSecond.value;
      h.api.startDrag(h.event(), clip);
      h.dispatch("pointermove", h.event(100 + 15 * scale));
      const expandedWidth = h.api.timelineWidth.value;
      h.api.timelineScrollRef.value.scrollLeft = 8 * scale;
      h.dispatch("pointermove", h.event(100 - 13 * scale));
      assert.equal(clip.startTime, 2);
      assert.equal(h.api.timelineWidth.value, expandedWidth, "The canvas keeps the largest reached extent until pointer release");
      h.dispatch("pointerup", h.event());
      assert.ok(h.api.timelineWidth.value < expandedWidth, "Automatic fitting resumes after release");
    } finally { h.dispose(); }
  });

  for (const boundary of ["start", "end"]) {
    await test(`${boundary} resize accounts for scrolling, preserves its boundary and clamps duration`, () => {
      const h = harness();
      try {
        const clip = h.props.node.lines[0].clips[0];
        const scale = h.api.pixelsPerSecond.value;
        h.api.timelineScrollRef.value.scrollLeft = 40;
        h.api.startResize(h.event(), clip, boundary);
        h.api.viewportWidth.value = 1200;
        h.api.timelineScrollRef.value.scrollLeft = 40 + scale;
        h.dispatch("pointermove", h.event());
        assert.equal(h.api.pixelsPerSecond.value, scale);
        if (boundary === "start") {
          assert.equal(clip.startTime, 8);
          assert.equal(clip.duration, 2);
          assert.equal(clip.startTime + clip.duration, 10);
          h.dispatch("pointermove", h.event(-10000));
          assert.equal(clip.startTime, 0);
          assert.equal(clip.duration, 10);
          h.dispatch("pointermove", h.event(10000));
          assert.equal(clip.startTime, 9.9);
          assert.equal(clip.duration, 0.1);
        } else {
          assert.equal(clip.startTime, 7);
          assert.equal(clip.duration, 4);
          h.dispatch("pointermove", h.event(-10000));
          assert.equal(clip.startTime, 7);
          assert.equal(clip.duration, 0.1);
        }
      } finally { h.dispose(); }
    });
  }

  await test("ContinueDelay uses the shared frozen scale and scroll compensation", () => {
    const node = group();
    node.dialogue = { id: "dialogue", startTime: 1, continueDelayTime: 0.5 };
    const h = harness(node);
    try {
      const clip = h.props.node.dialogue;
      const scale = h.api.pixelsPerSecond.value;
      h.api.timelineScrollRef.value.scrollLeft = 50;
      h.api.startContinueDelayDrag(h.event(), clip);
      h.api.viewportWidth.value = 1200;
      h.api.timelineScrollRef.value.scrollLeft = 50 + scale;
      h.dispatch("pointermove", h.event(100 + 15 * scale));
      assert.equal(clip.continueDelayTime, 16.5);
      assert.equal(clip.startTime, 1);
      assert.equal(h.api.pixelsPerSecond.value, scale);
      assert.equal(h.api.timelineDuration.value, 12);
      h.dispatch("pointermove", h.event(100 + 15 * scale));
      assert.equal(clip.continueDelayTime, 16.5);
      h.api.timelineScrollRef.value.scrollLeft = 50;
      h.dispatch("pointermove", h.event(-10000));
      assert.equal(clip.continueDelayTime, 0);
      h.dispatch("pointerup", h.event());
      assert.equal(h.api.pixelsPerSecond.value, (1200 - 118 - 24) / 12);
    } finally { h.dispose(); }
  });

  const gestures = [
    { name: "drag", start: (h, clip) => h.api.startDrag(h.event(), clip), value: clip => clip.startTime },
    { name: "resize", start: (h, clip) => h.api.startResize(h.event(), clip, "end"), value: clip => clip.duration },
    { name: "delay", start: (h, clip) => h.api.startContinueDelayDrag(h.event(), clip), value: clip => clip.continueDelayTime },
  ];
  for (const gesture of gestures) {
    for (const cancellation of ["pointercancel", "blur", "node change", "same-id node replacement", "unmount"]) {
      await test(`${gesture.name} stops mutating and releases its scale after ${cancellation}`, async () => {
        const node = group();
        if (gesture.name === "delay") node.dialogue = { id: "dialogue", startTime: 1, continueDelayTime: 0.5 };
        const h = harness(node);
        let disposed = false;
        try {
          const clip = gesture.name === "delay" ? h.props.node.dialogue : h.props.node.lines[0].clips[0];
          const scale = h.api.pixelsPerSecond.value;
          gesture.start(h, clip);
          h.dispatch("pointermove", h.event(100 + 15 * scale));
          const value = gesture.value(clip);
          h.api.viewportWidth.value = 1200;
          if (cancellation === "node change" || cancellation === "same-id node replacement") {
            const next = group(performanceClip("Camera", 0, 2));
            next.id = cancellation === "node change" ? "group-b" : h.props.node.id;
            h.props.node = next;
            await vue.nextTick();
          } else if (cancellation === "unmount") {
            h.dispose();
            disposed = true;
          } else {
            h.dispatch(cancellation);
          }
          assert.equal(h.api.timelineDuration.value, helpers.exports.getGroupTimelineDisplayDuration(h.props.node));
          assert.equal(h.api.pixelsPerSecond.value, (1200 - 118 - 24) / h.api.timelineDuration.value);
          h.dispatch("pointermove", h.event(100 + 25 * scale));
          assert.equal(gesture.value(clip), value, "Canceled gestures must not mutate the old Clip");
          assert.equal((h.listeners.get("pointermove") ?? []).length, 0);
          assert.equal((h.listeners.get("pointerup") ?? []).length, 0);
          if (cancellation === "unmount") {
            assert.equal([...h.listeners.values()].flat().length, 0);
          }
        } finally { if (!disposed) h.dispose(); }
      });
    }
  }

  await test("Other pointers cannot move or finish the active gesture", () => {
    const h = harness();
    try {
      const clip = h.props.node.lines[0].clips[0];
      const scale = h.api.pixelsPerSecond.value;
      h.api.startDrag(h.event(100, 1), clip);
      h.dispatch("pointermove", h.event(100 + scale, 2));
      assert.equal(clip.startTime, 7);
      h.dispatch("pointerup", h.event(100, 2));
      h.dispatch("pointermove", h.event(100 + scale, 1));
      assert.equal(clip.startTime, 8);
      h.dispatch("pointerup", h.event(100, 1));
      h.dispatch("pointermove", h.event(100 + 2 * scale, 1));
      assert.equal(clip.startTime, 8);
    } finally { h.dispose(); }
  });

  await test("A dragged Clip does not open the inspector on release, while a click still does", () => {
    const h = harness();
    try {
      const clip = h.props.node.lines[0].clips[0];
      const selected = { kind: "performance", line: h.props.node.lines[0], clip };
      h.api.startDrag(h.event(), clip);
      h.dispatch("pointermove", h.event(150));
      h.dispatch("pointerup", h.event(150));
      h.api.openEditor(h.event(150), selected);
      assert.equal(h.api.editorOpen.value, false);
      h.flushTimers();
      h.api.startDrag(h.event(), clip);
      h.dispatch("pointerup", h.event());
      h.api.openEditor(h.event(), selected);
      assert.equal(h.api.editorOpen.value, true);
    } finally { h.dispose(); }
  });

  console.log(`\n${passed} Timeline drag regression tests passed.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
