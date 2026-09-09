/* Run with: node scripts/test-dsfg-quest-main-style.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { parse, compileScript, compileTemplate } = require("@vue/compiler-sfc");

const directory = path.resolve(__dirname, "../src/views/DSFGStudio/components/QuestEditor");
const filename = path.join(directory, "QuestPanel.vue");
const parsed = parse(fs.readFileSync(filename, "utf8"), { filename });
const descriptor = parsed.descriptor;
function attribute(node, name) {
  return node.props?.find((property) => property.type === 6 && property.name === name)?.value?.content;
}
function directive(node, name) {
  return node.props?.find((property) => property.type === 7 && property.name === name);
}
function find(node, predicate, ancestors = [], matches = []) {
  if (node.type === 1 && predicate(node)) matches.push({ node, ancestors });
  for (const child of node.children ?? []) find(child, predicate, [...ancestors, node], matches);
  return matches;
}
let passed = 0;
function test(name, check) { check(); passed++; console.log(`PASS ${name}`); }

test("Actual QuestPanel main-style script and template compile", () => {
  assert.deepEqual(parsed.errors, []);
  const script = compileScript(descriptor, { id: "quest-main-style" });
  const template = compileTemplate({ filename, id: "quest-main-style", source: descriptor.template.content,
    compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
});

test("Main quest style is a free-text field bound directly to the selected main quest", () => {
  const fields = find(descriptor.template.ast, (node) => attribute(node, "aria-label") === "主任务样式");
  assert.equal(fields.length, 1);
  const { node } = fields[0];
  assert.equal(node.tag, "input");
  assert.ok([undefined, "text"].includes(attribute(node, "type")));
  assert.equal(attribute(node, "placeholder"), "Mainline");
  assert.equal(directive(node, "model").exp.content, "selectedMain.style");
  assert.equal(attribute(node, "readonly"), undefined);
  assert.equal(attribute(node, "disabled"), undefined);
  assert.equal(find(descriptor.template.ast, (element) => element.tag === "select"
    && directive(element, "model")?.exp?.content === "selectedMain.style").length, 0, "Styles must not be restricted to a hardcoded dropdown");
});

test("The style input belongs to the main quest inspector branch only", () => {
  const field = find(descriptor.template.ast, (node) => attribute(node, "aria-label") === "主任务样式")[0];
  assert.ok(field);
  assert.ok(field.ancestors.some((node) => node.type === 1 && node.tag === "template"
    && directive(node, "else-if")?.exp?.content === "selectedMain"));
});

test("QuestMain declares a required string style rather than an enum or optional value", () => {
  const typeFilename = path.join(directory, "types.ts");
  const ast = ts.createSourceFile(typeFilename, fs.readFileSync(typeFilename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = ast.statements.find((node) => ts.isInterfaceDeclaration(node) && node.name.text === "QuestMain");
  assert.ok(declaration);
  const style = declaration.members.find((member) => member.name?.getText(ast) === "style");
  assert.ok(style);
  assert.equal(style.questionToken, undefined);
  assert.equal(style.type.kind, ts.SyntaxKind.StringKeyword);
});

console.log(`${passed} main quest style UI tests passed.`);
