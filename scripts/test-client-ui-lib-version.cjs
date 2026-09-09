/* Run: node scripts/test-client-ui-lib-version.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { parse: parseSfc } = require("@vue/compiler-sfc");
const { parse: parseTemplate } = Module.createRequire(require.resolve("@vue/compiler-sfc"))("@vue/compiler-dom");

const originalTsExtension = Module._extensions[".ts"];
function compile(source, filename) {
  return ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
Module._extensions[".ts"] = (module, filename) => {
  module._compile(compile(fs.readFileSync(filename, "utf8"), filename), filename);
};

try {
  const editor = path.resolve(__dirname, "../src/views/ClientUIAnimationEditor");
  const exporterPath = path.join(editor, "luaTweenExporter.ts");
  const exporterSource = fs.readFileSync(exporterPath, "utf8");
  const exporter = require(exporterPath);
  const { createControlProperties } = require(path.join(editor, "controlRegistry.ts"));
  const { TWEEN_TIMELINE_LIB_VERSION: version, buildTweenTimelineLibLua, buildTweenTimelineDataLua } = exporter;
  const library = buildTweenTimelineLibLua();
  const schema = library.code.match(/TweenTimelineLib\.Schema = "([^"]+)"/)?.[1];
  const vueSource = fs.readFileSync(path.join(editor, "ClientUIAnimationEditor.vue"), "utf8");
  const { descriptor, errors } = parseSfc(vueSource);
  assert.deepEqual(errors, []);
  const template = parseTemplate(descriptor.template.content);
  const elements = [];
  function visit(node, ancestors = []) {
    if (node.type === 1) elements.push({ node, ancestors });
    for (const child of node.children || []) visit(child, [...ancestors, node]);
  }
  visit(template);
  function hasClass(node, name) {
    return (node.props || []).some((prop) => prop.type === 6 && prop.name === "class"
      && prop.value.content.split(/\s+/).includes(name));
  }
  function usesVersionInterpolation(node) {
    return (node.children || []).some((child) => child.type === 5
      && child.content.content.trim() === "TWEEN_TIMELINE_LIB_VERSION");
  }
  function conditional(node) {
    return (node.props || []).some((prop) => prop.type === 7
      && ["if", "else-if", "else", "show"].includes(prop.name));
  }
  const badge = elements.find(({ node }) => hasClass(node, "lua-lib-version"));
  let passed = 0;
  function test(name, check) { check(); passed += 1; console.log(`PASS ${name}`); }

  test("The runtime version is derived from the current Timeline Data schema number", () => {
    assert.equal(typeof version, "string");
    assert.equal(schema, "ClientUIAnimationEditor.TweenTimeline@7");
    assert.equal(version, "7");
    assert.equal(version, schema.split("@").at(-1));
  });
  test("Generated Lua header uses the schema version without a separate public Version field", () => {
    assert.ok(library.code.split("\n")[0].startsWith("-- "));
    assert.ok(library.code.split("\n")[0].includes(`v${version}`));
    assert.doesNotMatch(library.code, /TweenTimelineLib\.Version\s*=/);
  });
  test("Runtime filename and Create entry point remain unchanged while @7 retains legacy schemas", () => {
    assert.equal(library.fileName, "TweenTimelineLib.lua");
    assert.match(library.code, /function TweenTimelineLib\.Create\(/);
    assert.match(library.code, /return TweenTimelineLib\s*$/);
    assert.match(library.code, /TweenTimelineLib\.Schema = "ClientUIAnimationEditor\.TweenTimeline@7"/);
    for (const schema of [3, 4, 5, 6, 7]) assert.ok(library.code.includes(`TweenTimeline@${schema}`));
  });
  test("Changing only the schema changes the shared version and generated Lua header", () => {
    const source = ts.createSourceFile(exporterPath, exporterSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let initializer;
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.name.getText(source) === "TWEEN_TIMELINE_SCHEMA") initializer = declaration.initializer;
      }
    }
    assert.ok(initializer && ts.isStringLiteral(initializer));
    const alternateVersion = "77";
    const alternateSchema = `ClientUIAnimationEditor.TweenTimeline@${alternateVersion}`;
    const altered = exporterSource.slice(0, initializer.getStart(source)) + JSON.stringify(alternateSchema)
      + exporterSource.slice(initializer.end);
    const alternateModule = new Module(exporterPath, module);
    alternateModule.filename = exporterPath;
    alternateModule.paths = Module._nodeModulePaths(editor);
    alternateModule._compile(compile(altered, exporterPath), exporterPath);
    const result = alternateModule.exports.buildTweenTimelineLibLua();
    assert.equal(alternateModule.exports.TWEEN_TIMELINE_LIB_VERSION, alternateVersion);
    assert.ok(result.code.split("\n")[0].includes(`v${alternateVersion}`));
    assert.ok(result.code.includes(`TweenTimelineLib.Schema = "${alternateSchema}"`));
    assert.doesNotMatch(result.code, /TweenTimelineLib\.Version\s*=/);
    assert.equal(result.fileName, library.fileName);
  });
  test("Data export uses @7 for multi-Clip data and retains the single-Clip schema and filenames", () => {
    const root = { id: "root", name: "Root", type: "container", parentId: null,
      anchorOffsetX: 100, anchorOffsetY: 200, scaleX: 1, scaleY: 1, scaleZ: 1,
      properties: createControlProperties("container") };
    const first = { id: "first", nodeId: "root", fieldKey: "anchoredPositionX", startTime: 0,
      duration: 1, initialValue: 0, endValue: 40, easeType: "Linear" };
    const options = { projectName: "VersionTest", rootNodeId: "root", nodes: [root], tracks: [first] };
    const single = buildTweenTimelineDataLua(options);
    const multi = buildTweenTimelineDataLua({ ...options, tracks: [first, { ...first, id: "second", startTime: 2 }] });
    assert.match(single.code, /schema = "ClientUIAnimationEditor\.TweenTimeline@3"/);
    assert.match(multi.code, /schema = "ClientUIAnimationEditor\.TweenTimeline@7"/);
    assert.equal(single.fileName, "VersionTest-Root-TweenTimelineData.lua");
    assert.equal(multi.fileName, single.fileName);
    assert.deepEqual(single.warnings, []);
    assert.deepEqual(multi.warnings, []);
    assert.equal(multi.trackCount, 2);
  });
  test("The editor imports the same version constant from the actual exporter", () => {
    const script = ts.createSourceFile("Editor.ts", descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const found = script.statements.some((statement) => ts.isImportDeclaration(statement)
      && statement.moduleSpecifier.text === "./luaTweenExporter"
      && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
      && statement.importClause.namedBindings.elements.some((binding) => binding.name.text === "TWEEN_TIMELINE_LIB_VERSION"
        && (!binding.propertyName || binding.propertyName.text === "TWEEN_TIMELINE_LIB_VERSION")));
    assert.equal(found, true);
  });
  test("The visible Lib badge interpolates the shared constant instead of a hardcoded version", () => {
    assert.ok(badge, "The toolbar must contain a version badge");
    assert.equal(usesVersionInterpolation(badge.node), true);
    assert.equal(badge.node.children.filter((child) => child.type === 2).map((child) => child.content).join("").trim(), "Lib:v");
    assert.ok(!badge.node.children.some((child) => child.type === 2 && /\d+\.\d+\.\d+/.test(child.content)));
  });
  test("The badge remains outside the conditional export menu, even without an open document", () => {
    assert.ok(badge);
    assert.equal(hasClass(badge.ancestors.at(-1), "lua-export-wrap"), true);
    assert.ok(![...badge.ancestors, badge.node].some(conditional));
    assert.ok(!badge.ancestors.some((node) => hasClass(node, "lua-export-menu")));
  });
  test("The tooltip distinguishes the exportable runtime version from the game's installed copy", () => {
    const title = badge.node.props.find((prop) => prop.type === 7 && prop.name === "bind" && prop.arg?.content === "title");
    assert.ok(title);
    assert.match(title.exp.content, /TWEEN_TIMELINE_LIB_VERSION/);
    assert.match(title.exp.content, /可导出/);
    assert.match(title.exp.content, /不代表.*游戏.*已安装/);
  });
  test("The runtime export menu also shows the shared version next to its stable filename", () => {
    const description = elements.find(({ node, ancestors }) => node.tag === "small"
      && ancestors.some((parent) => hasClass(parent, "lua-export-menu"))
      && node.loc.source.includes("TweenTimelineLib.lua"));
    assert.ok(description);
    assert.equal(usesVersionInterpolation(description.node), true);
  });
  console.log(`${passed} Lib version checks passed.`);
} finally {
  if (originalTsExtension) Module._extensions[".ts"] = originalTsExtension;
  else delete Module._extensions[".ts"];
}
