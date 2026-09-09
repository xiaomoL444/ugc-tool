/* Run with: node scripts/test-dsfg-timeline-appearance.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const ts = require("typescript");
const { parse, compileScript, compileTemplate, compileStyle } = require("@vue/compiler-sfc");

async function main() {
  const root = path.resolve(__dirname, "..");
  const editor = path.join(root, "src/views/DSFGStudio/components/DialogueEditor");
  const filename = path.join(editor, "GroupTimelineV3.vue");
  const parsed = parse(fs.readFileSync(filename, "utf8"), { filename });
  const descriptor = parsed.descriptor;
  let passed = 0;
  function test(name, check) { check(); passed += 1; console.log(`PASS ${name}`); }

  test("The real Timeline script, template and scoped CSS compile", () => {
    assert.deepEqual(parsed.errors, []);
    const script = compileScript(descriptor, { id: "timeline-appearance-test" });
    const template = compileTemplate({
      filename,
      id: "timeline-appearance-test",
      source: descriptor.template.content,
      compilerOptions: { bindingMetadata: script.bindings },
    });
    assert.deepEqual(template.errors, []);
    for (const style of descriptor.styles) {
      assert.deepEqual(compileStyle({ filename, id: "timeline-appearance-test", source: style.content, scoped: style.scoped }).errors, []);
    }
  });

  function findAll(node, predicate) {
    return [...(predicate(node) ? [node] : []), ...(node.children ?? []).flatMap((child) => findAll(child, predicate))];
  }
  function hasClass(node, value) {
    return node.type === 1 && node.props?.some((prop) => prop.type === 6 && prop.name === "class" && prop.value?.content.split(/\s+/).includes(value));
  }
  function elementWithClass(value) {
    const elements = findAll(descriptor.template.ast, (node) => hasClass(node, value));
    assert.equal(elements.length, 1, `Expected one ${value} element`);
    return elements[0];
  }
  function directive(node, name, argument) {
    return node.props?.find((prop) => prop.type === 7 && prop.name === name && prop.arg?.content === argument);
  }
  function evaluateStyle(node, bindings) {
    const expression = directive(node, "bind", "style")?.exp?.content;
    assert.ok(expression, "Clip must bind its time-based position");
    return JSON.parse(JSON.stringify(vm.runInNewContext(`(${expression})`, { labelWidth: 118, pixelsPerSecond: 80, ...bindings }, { timeout: 1000 })));
  }
  const css = compileStyle({ filename, id: "timeline-appearance-test", source: descriptor.styles.map((style) => style.content).join("\n") });
  function declarations(selector) {
    const result = {};
    css.rawResult.root.walkRules((rule) => {
      if (rule.selectors?.includes(selector)) {
        rule.walkDecls((declaration) => { result[declaration.prop] = declaration.value; });
      }
    });
    return result;
  }

  for (const kind of ["dialogue", "select"]) {
    const clipElement = elementWithClass(`${kind}-clip`);
    test(`${kind} keeps its start in seconds and extends to the row's right edge`, () => {
      for (const startTime of [0, 2.9, 25]) {
        const style = evaluateStyle(clipElement, { node: { [kind]: { startTime } } });
        assert.deepEqual(style, { left: `${118 + startTime * 80}px` });
      }
      assert.equal(declarations(`.${kind}-clip`).right, "0");
      assert.equal(declarations(`.${kind}-clip`).width, undefined);
      assert.equal(declarations(".timeline-clip").position, "absolute");
      assert.equal(declarations(".timeline-row").position, "relative");
      assert.equal(declarations(".timeline-canvas")["min-width"], "100%");
    });
    test(`${kind} labels the visual end and retains only its left resize handle`, () => {
      const markup = clipElement.loc.source;
      assert.ok(markup.includes("时间轴末尾"));
      assert.equal(markup.includes("contentDuration.toFixed"), false);
      const handles = findAll(clipElement, (node) => hasClass(node, "clip-resize-handle"));
      assert.equal(handles.length, 1);
      assert.ok(hasClass(handles[0], "resize-start"));
      assert.equal(directive(handles[0], "on", "pointerdown")?.exp?.content, `startResize($event, node.${kind}, 'start')`);
      assert.equal(directive(clipElement, "on", "pointerdown")?.exp?.content, `startDrag($event, node.${kind})`);
    });
    test(`${kind} keeps the independent ContinueDelayTime marker in seconds`, () => {
      const handles = findAll(clipElement, (node) => hasClass(node, "continue-delay-handle"));
      assert.equal(handles.length, 1);
      for (const continueDelayTime of [0, 0.5, 2.9]) {
        assert.deepEqual(evaluateStyle(handles[0], { node: { [kind]: { continueDelayTime } } }), { left: `${continueDelayTime * 80}px` });
      }
      assert.equal(directive(handles[0], "on", "pointerdown")?.exp?.content, `startContinueDelayDrag($event, node.${kind})`);
    });
  }

  test("Performance Clips retain duration-based width and both resize boundaries", () => {
    const clip = findAll(descriptor.template.ast, (node) => hasClass(node, "timeline-clip") && !hasClass(node, "dialogue-clip") && !hasClass(node, "select-clip"));
    assert.equal(clip.length, 1);
    assert.deepEqual(evaluateStyle(clip[0], { clip: { startTime: 2.9, duration: 1.25 } }), { left: "350px", width: "100px" });
    assert.deepEqual(evaluateStyle(clip[0], { clip: { startTime: 0, duration: 0 } }), { left: "118px", width: "8px" });
    assert.equal(findAll(clip[0], (node) => hasClass(node, "resize-start")).length, 1);
    assert.equal(findAll(clip[0], (node) => hasClass(node, "resize-end")).length, 1);
    assert.equal(declarations(".timeline-clip").right, undefined);
  });

  const scriptAst = ts.createSourceFile(filename + ".ts", descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  function functionText(name) {
    const declaration = scriptAst.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
    assert.ok(declaration, `Missing ${name}`);
    return declaration.getText(scriptAst);
  }
  test("Delay input and drag bounds continue using business duration, not viewport width", () => {
    for (const name of ["updateContinueDelay", "startContinueDelayDrag", "clipDisplayDuration"]) {
      const code = functionText(name);
      assert.ok(code.includes("getFlowClipDuration(props.node, clip)"));
      assert.equal(/innerWidth|clientWidth|timelineWidth|timelineDuration/.test(code), false);
    }
    assert.ok(functionText("startResize").includes("clipDisplayDuration(clip)"));
    assert.equal(/props\.node\.timeline\.duration\s*=/.test(descriptor.scriptSetup.content), false);
  });

  const variableLibrary = await import("miliastra-variable");
  const originalLoad = Module._load;
  const originalExtension = Module._extensions[".ts"];
  Module._load = function (request, parent, isMain) {
    if (request === "miliastra-variable") return variableLibrary;
    return originalLoad.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, isMain);
  };
  Module._extensions[".ts"] = (module, sourcePath) => {
    const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: sourcePath,
    });
    module._compile(compiled.outputText, sourcePath);
  };
  try {
    const { createDialogueNode, createSelectClip, createPerformanceClip, createEmptyDialogueProject } = require(path.join(editor, "utils/dialogueProject.ts"));
    const { getGroupTimelineEnd, getFlowClipDuration } = require(path.join(editor, "utils/groupTimeline.ts"));
    const { exportQxqyPerformance } = require(path.join(editor, "utils/qxqyPerformanceExporter.ts"));
    const { createQxqyStructWorkspace } = require(path.join(editor, "utils/qxqyStructWorkspace.ts"));
    test("New Group and flow Clip defaults remain 2 seconds and 0.5 seconds of delay", () => {
      const group = createDialogueNode("defaults");
      group.select = createSelectClip();
      assert.equal(group.timeline.duration, 2);
      assert.equal(group.dialogue.continueDelayTime, 0.5);
      assert.equal(group.select.continueDelayTime, 0.5);
      assert.equal(getGroupTimelineEnd(group), 2);
      assert.equal(getFlowClipDuration(group, group.dialogue), 2);
      assert.equal(getFlowClipDuration(group, group.select), 2);
      assert.equal(Object.hasOwn(group.dialogue, "duration"), false);
      assert.equal(Object.hasOwn(group.select, "duration"), false);
    });
    test("Late starts and Camera durations still determine actual flow duration without mutation", () => {
      const group = createDialogueNode("late");
      group.select = createSelectClip();
      group.select.startTime = 2.9;
      group.dialogue.startTime = 1;
      const camera = createPerformanceClip("Camera", 5);
      camera.duration = 3;
      group.lines[0].clips.push(camera);
      const before = JSON.stringify(group);
      assert.equal(getGroupTimelineEnd(group), 8);
      assert.equal(getFlowClipDuration(group, group.dialogue), 7);
      assert.equal(getFlowClipDuration(group, group.select), 5.1);
      assert.equal(JSON.stringify(group), before);
      group.lines[0].clips.length = 0;
      assert.equal(getGroupTimelineEnd(group), 3.4);
      assert.equal(getFlowClipDuration(group, group.select), 0.5);
    });
    test("Runtime export retains actual Dialogue duration and independent Select delay", () => {
      const project = createEmptyDialogueProject();
      const group = createDialogueNode("group");
      group.dialogue.advanceMode = "None";
      group.select = createSelectClip();
      group.select.startTime = 2.9;
      project.dialogue.nodes[group.id] = group;
      project.graph.nodes.push({ id: group.id, type: "group", position: { x: 320, y: 0 }, data: { dialogueNodeId: group.id } });
      project.graph.edges.push({ id: "entry-group", source: project.dialogue.entryNodeId, sourceHandle: "output", target: group.id, targetHandle: "input" });
      const before = JSON.stringify(project);
      const result = exportQxqyPerformance(project);
      const decoded = createQxqyStructWorkspace(project.exportSettings.qxqyStructIds).parse(JSON.parse(result.json));
      assert.deepEqual(decoded.issues, []);
      const table = (dictionary) => dictionary.value.flatMap((item) => item.value.value);
      const exportedGroup = table(decoded.value.ActionGroup)[0].value;
      const actions = table(exportedGroup.ActionClip);
      assert.equal(actions.find((action) => action.value.actionType.value === "NOLOC_DIALOG").value.duration.value, "3.40");
      assert.equal(actions.find((action) => action.value.actionType.value === "NOLOC_DIALOG_SELECT").value.duration.value, "0.50");
      assert.deepEqual(exportedGroup.Timer.value.map((item) => item.value.value), ["0.00", "2.90"]);
      assert.equal(table(decoded.value.DialogueDate)[0].value.continueDelay.value, "-1.00");
      assert.equal(JSON.stringify(project), before);
    });
  } finally {
    Module._load = originalLoad;
    if (originalExtension) Module._extensions[".ts"] = originalExtension;
    else delete Module._extensions[".ts"];
  }
  console.log(`\n${passed} DSFG Timeline appearance checks passed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
