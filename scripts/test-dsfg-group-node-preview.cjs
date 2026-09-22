/* Run with: node scripts/test-dsfg-group-node-preview.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Vue = require("vue");
const { renderToString } = require("vue/server-renderer");
const { parse, compileScript, compileTemplate, compileStyle } = require("@vue/compiler-sfc");

async function main() {
  const filename = path.resolve(__dirname, "../src/views/DSFGStudio/components/DialogueEditor/GroupNode.vue");
  const parsed = parse(fs.readFileSync(filename, "utf8"), { filename });
  assert.deepEqual(parsed.errors, []);
  const descriptor = parsed.descriptor;
  const script = compileScript(descriptor, { id: "group-preview" });
  const template = compileTemplate({ filename, id: "group-preview", source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  for (const style of descriptor.styles) assert.deepEqual(compileStyle({ filename, id: "group-preview", source: style.content, scoped: style.scoped }).errors, []);
  const runtime = compileTemplate({ filename, id: "group-preview", source: descriptor.template.content, compilerOptions: { mode: "function" } });
  assert.deepEqual(runtime.errors, []);
  const render = new Function("Vue", runtime.code)(Vue);
  const fixture = () => ({
    node: { name: "新建 Group", dialogue: { style: "Default_UI", speaker: "123456", content: "新建台词" }, lines: [{ clips: [] }], select: null },
    selected: false, durationLabel: "2.0s", outletWarnings: [],
    outlets: [{ id: "dialogue", kind: "Dialogue", label: "玩家按下" }],
    performanceClips: [], previewSegments: [], Position: { Left: "left", Right: "right" },
  });
  async function html(state) {
    const before = JSON.stringify(state);
    const app = Vue.createSSRApp({ setup: () => state, render });
    app.component("Handle", { props: ["id", "type", "position"], setup: props => () => Vue.h("i", { "data-handle": props.id, "data-type": props.type, "data-position": props.position }) });
    const output = await renderToString(app);
    assert.equal(JSON.stringify(state), before, "Rendering must not change node data");
    return output;
  }
  const basic = await html(fixture());
  for (const removed of ["新建 Group", "Default_UI", "默认样式", "Lines", "已连接", "暂无演出", "group-title", "group-type", "timeline-empty"]) assert.ok(!basic.includes(removed), `Unexpected display: ${removed}`);
  assert.ok(!basic.includes("timeline-preview"), "Empty timeline container should not occupy space");
  for (const retained of ["普通事件节点", "2.0s", "123456：新建台词", "0 演出", "0 选项", "玩家按下", 'data-position="left"', 'data-position="right"']) assert.ok(basic.includes(retained), `Missing retained display: ${retained}`);
  const performance = fixture();
  performance.performanceClips = [{ id: "camera" }];
  performance.previewSegments = [{ id: "camera", left: "20%", width: "30%" }];
  const withPerformance = await html(performance);
  assert.ok(withPerformance.includes("1 演出")); assert.ok(withPerformance.includes("timeline-segment"));
  assert.ok(withPerformance.includes("left:20%;width:30%"));
  const missing = fixture(); missing.node.dialogue = null; missing.outlets = []; missing.outletWarnings = ["没有出口"];
  const withoutDialogue = await html(missing);
  assert.ok(withoutDialogue.includes("暂无 Dialogue Clip")); assert.ok(withoutDialogue.includes("无流程出口"));
  assert.ok(withoutDialogue.includes('data-handle="input"')); assert.ok(withoutDialogue.includes("group-warning"));
  const select = fixture(); select.selected = true; select.node.select = { options: ["A", "B"] };
  select.outlets = [{ id: "a", kind: "Select", label: "选项 1" }, { id: "b", kind: "Select", label: "选项 2" }];
  const withSelect = await html(select);
  for (const retained of ["2 选项", "选项 1", "选项 2", 'data-handle="a"', 'data-handle="b"', "group-node selected"]) assert.ok(withSelect.includes(retained));
  const focus = fixture();
  focus.outlets.push({ id: "focus-push", kind: "FocusPush", label: "Focus Push（强制跳过）" });
  const withFocus = await html(focus);
  for (const retained of ["玩家按下", "Focus Push（强制跳过）", 'data-handle="dialogue"', 'data-handle="focus-push"', "outlet-focuspush"]) assert.ok(withFocus.includes(retained));
  console.log("PASS Focus Push renders alongside the existing Dialogue outlet");
  console.log("PASS GroupNode script/template/styles compile");
  console.log("PASS Removed labels and empty preview are absent from rendered markup");
  console.log("PASS Dialogue, duration, counts and connection handles remain");
  console.log("PASS Nonempty performance preview, outlet warnings and select outlets remain");
  console.log("PASS Rendering leaves underlying node data unchanged");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
