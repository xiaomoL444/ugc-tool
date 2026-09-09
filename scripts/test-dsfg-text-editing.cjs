/* Run with: node scripts/test-dsfg-text-editing.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const previousExtension = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

try {
  const { applyDialogueTextEdit: apply, shouldShowDialogueSpeaker: show } = require(path.resolve(__dirname, "../src/views/DSFGStudio/components/DialogueEditor/utils/dialogueTextEditing.ts"));
  let passed = 0;
  const test = (name, run) => { run(); passed++; console.log(`PASS ${name}`); };
  const copy = (value) => JSON.parse(JSON.stringify(value));
  function freeze(value) {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  function project() {
    return {
      schemaVersion: 12,
      exportSettings: { qxqyStructIds: { performance: "123456" } },
      dialogue: {
        entryNodeId: "start", tree: { unchanged: "tree" }, conditionBranches: { Q: { id: "Q", name: "条件", nodeType: "ConditionBranch", outputs: [{ id: "exit", label: "一", condition: "value == 1" }] } },
        nodes: {
          A: {
            id: "A", name: "原 Group 名称", nodeType: "Dialogue", durationMode: "Fixed", duration: 8,
            dialogue: { id: "clip-A", style: "Black_Screen", speaker: "原说话人", subtitle: "原字幕", content: "原台词", startTime: 1.2, continueDelayTime: 0.5, advanceMode: "PlayerInput", nodeGraphEvent: ["event-A"] },
            select: { id: "select-A", style: "Default_UI", startTime: 2.9, continueDelayTime: 0.5, options: [{ id: "option-1", content: "选项文本", icon: 99 }] },
            lines: [{ id: "camera-line", name: "运镜", type: "Camera", clips: [{ id: "camera-clip", type: "Camera", name: "镜头", startTime: 0, duration: 8, components: [{ id: "camera-component", templateId: "camera-v2", name: "相机", enabled: true, properties: { cameraName: "Default", offset: { x: 1, y: 2, z: 3 } } }] }] }],
            timeline: { duration: 8, maxLines: 10 }, next: ["B"],
          },
          B: { id: "B", name: "无台词 Group", nodeType: "Dialogue", durationMode: "Auto", lines: [], timeline: { duration: 1, maxLines: 8 } },
        },
      },
      graph: {
        nodes: [{ id: "start", type: "entry", position: { x: 0, y: 0 }, data: {}, draggable: false }, { id: "view-A", type: "group", position: { x: 320, y: 120 }, data: { dialogueNodeId: "A" }, selected: true }],
        edges: [{ id: "edge-start-A", source: "start", target: "view-A", sourceHandle: "next", targetHandle: "input" }],
      },
    };
  }
  const line = (speaker = "说话人", subtitle = "字幕", hasDialogue = true) => ({ nodeId: "A", name: "Group", content: "台词", speaker, subtitle, hasDialogue });

  for (const field of ["speaker", "content", "subtitle"]) {
    test(`${field} updates only its existing Dialogue text property`, () => {
      const source = project();
      const expected = copy(source);
      expected.dialogue.nodes.A.dialogue[field] = `新的 ${field}`;
      const node = source.dialogue.nodes.A;
      const clip = node.dialogue;
      const graph = source.graph;
      const lines = node.lines;
      assert.equal(apply(source, { nodeId: "A", field, value: `新的 ${field}` }), true);
      assert.deepEqual(source, expected);
      assert.equal(source.dialogue.nodes.A, node);
      assert.equal(source.dialogue.nodes.A.dialogue, clip);
      assert.equal(source.dialogue.nodes.A.lines, lines);
      assert.equal(source.graph, graph);
    });
  }

  test("Unchanged value returns false without writing even when the project is frozen", () => {
    const source = freeze(project());
    for (const field of ["speaker", "content", "subtitle"]) {
      assert.equal(apply(source, { nodeId: "A", field, value: source.dialogue.nodes.A.dialogue[field] }), false);
    }
  });

  test("Unknown IDs, graph aliases and nodes without Dialogue never create data", () => {
    const source = freeze(project());
    for (const nodeId of ["missing", "view-A", "start", "B", "Q", "", "constructor", "__proto__", "toString"]) {
      assert.equal(apply(source, { nodeId, field: "content", value: "不应该写入" }), false);
    }
    assert.equal(Object.prototype.hasOwnProperty.call(source.dialogue.nodes.B, "dialogue"), false);
  });

  test("Runtime field whitelist rejects non-text properties and malformed fields", () => {
    const source = freeze(project());
    for (const field of ["id", "name", "style", "next", "lines", "startTime", "continueDelayTime", "advanceMode", "nodeGraphEvent", "__proto__", "constructor", "speaker ", "Content", "", null, undefined, 1, {}, ["content"]]) {
      assert.equal(apply(source, { nodeId: "A", field, value: "不应该写入" }), false);
    }
  });

  test("Non-string values and malformed edit payloads are rejected without coercion", () => {
    const source = freeze(project());
    for (const value of [null, undefined, 1, true, {}, ["text"], new String("text")]) {
      assert.equal(apply(source, { nodeId: "A", field: "content", value }), false);
    }
    for (const edit of [null, undefined, 1, "text", [], {}, { field: "content", value: "text" }, { nodeId: 1, field: "content", value: "text" }]) {
      assert.equal(apply(source, edit), false);
    }
  });

  test("Special characters, whitespace, HTML-looking text and empty values remain literal", () => {
    const source = project();
    const literal = "  中文\n\r\n\t<script>globalThis.mustNotRun = 1</script>\"'\\${value}\u0000🎬  ";
    for (const field of ["speaker", "subtitle", "content"]) {
      assert.equal(apply(source, { nodeId: "A", field, value: literal }), true);
      assert.equal(source.dialogue.nodes.A.dialogue[field], literal);
      assert.equal(apply(source, { nodeId: "A", field, value: "" }), true);
      assert.equal(source.dialogue.nodes.A.dialogue[field], "");
    }
    assert.equal(globalThis.mustNotRun, undefined);
  });

  test("Malformed or inherited Dialogue targets cannot be accidentally edited", () => {
    const source = project();
    for (const malformed of [null, false, "clip", 7, []]) {
      source.dialogue.nodes.A.dialogue = malformed;
      assert.equal(apply(source, { nodeId: "A", field: "content", value: "text" }), false);
    }
    source.dialogue.nodes = Object.create({ inherited: { dialogue: { content: "原文" } } });
    assert.equal(apply(source, { nodeId: "inherited", field: "content", value: "text" }), false);
    assert.equal(source.dialogue.nodes.inherited.dialogue.content, "原文");
    source.dialogue.nodes.A = Object.create({ dialogue: { content: "继承的原文" } });
    assert.equal(apply(source, { nodeId: "A", field: "content", value: "text" }), false);
    assert.equal(source.dialogue.nodes.A.dialogue.content, "继承的原文");
  });

  test("First line is shown, and only identical adjacent speaker/subtitle pairs collapse", () => {
    const lines = [line(), line(), line("第二人"), line("第二人"), line("说话人")];
    assert.deepEqual(lines.map((_, index) => show(lines, index)), [true, false, true, false, true]);
  });

  test("Subtitle changes force a new speaker label even for the same speaker", () => {
    const lines = [line("同一人", "第一字幕"), line("同一人", "第二字幕"), line("同一人", ""), line("同一人", "")];
    assert.deepEqual(lines.map((_, index) => show(lines, index)), [true, true, true, false]);
  });

  test("Missing Dialogue on either side breaks label merging", () => {
    const lines = [line(), line("说话人", "字幕", false), line("说话人", "字幕", false), line(), line()];
    assert.deepEqual(lines.map((_, index) => show(lines, index)), [true, true, true, true, false]);
  });

  test("Label merging compares original strings without trimming or normalization", () => {
    const lines = [line("", ""), line("", ""), line(" ", ""), line(" ", "\n"), line(" ", "\n")];
    assert.deepEqual(lines.map((_, index) => show(lines, index)), [true, false, true, true, false]);
  });

  test("Label helper has no effects and returns false for indexes without a line", () => {
    const lines = freeze([line(), line()]);
    const before = copy(lines);
    assert.equal(show(lines, 0), true);
    assert.equal(show(lines, 1), false);
    for (const index of [-1, 2, 100, 0.5, NaN]) assert.equal(show(lines, index), false);
    assert.equal(show([], 0), false);
    assert.deepEqual(lines, before);
  });

  console.log(`\n${passed} text editing checks passed.`);
} finally {
  if (previousExtension) Module._extensions[".ts"] = previousExtension;
  else delete Module._extensions[".ts"];
}
