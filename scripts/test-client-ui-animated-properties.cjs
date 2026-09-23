/* Run: node scripts/test-client-ui-animated-properties.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const vue = require("vue");
const { renderToString } = Module.createRequire(require.resolve("vue"))("@vue/server-renderer");
const { parse, compileScript, compileStyle } = require("@vue/compiler-sfc");
const oldTs = Module._extensions[".ts"];
const oldVue = Module._extensions[".vue"];
const editor = path.resolve(__dirname, "../src/views/ClientUIAnimationEditor");
function transpile(source, filename) {
  return ts.transpileModule(source, { fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
}
Module._extensions[".ts"] = (module, filename) => module._compile(transpile(fs.readFileSync(filename, "utf8"), filename), filename);
Module._extensions[".vue"] = (module, filename) => {
  const { descriptor, errors } = parse(fs.readFileSync(filename, "utf8"), { filename });
  assert.deepEqual(errors, []);
  const script = compileScript(descriptor, { id: path.basename(filename), inlineTemplate: true });
  for (const style of descriptor.styles) {
    assert.deepEqual(compileStyle({ id: `data-v-${path.basename(filename)}`, filename, source: style.content, scoped: style.scoped }).errors, []);
  }
  module._compile(transpile(script.content, filename), filename);
};

async function main() {
  const Inspector = require(path.join(editor, "ControlPropertiesInspector.vue")).default;
  const Color = require(path.join(editor, "ColorRGBAField.vue")).default;
  const NumberInput = require(path.join(editor, "ScrubbableNumberInput.vue")).default;
  const { controlRegistry, createControlProperties } = require(path.join(editor, "controlRegistry.ts"));
  const render = (component, props) => renderToString(vue.createSSRApp({ render: () => vue.h(component, props) }));
  const inspect = (type, animatedFields) => render(Inspector, {
    definition: controlRegistry[type], modelValue: createControlProperties(type),
    ...(animatedFields === undefined ? {} : { animatedFields }),
  });
  function field(html, key) {
    const pieces = html.split('<div class="control-field');
    const found = pieces.find((piece) => piece.includes(`data-field="${key}"`));
    assert.ok(found, `Missing ${key} inspector field`);
    return found;
  }
  let passed = 0;
  async function test(name, check) { await check(); passed++; console.log(`PASS ${name}`); }

  await test("Inspectors and both underlying input components compile and default to no animation styling", async () => {
    const html = await inspect("text");
    assert.doesNotMatch(html, /data-animated="true"|已加入动画|class="[^\"]*is-animated/);
    const number = await render(NumberInput, { modelValue: 20 });
    assert.doesNotMatch(number, /data-animated|已加入动画|is-animated/);
    assert.match(number, /title="左右拖动调整数值/);
    const color = await render(Color, { label: "颜色", modelValue: { r: 255, g: 255, b: 255, a: 0.5 } });
    assert.doesNotMatch(color, /data-animated|已加入动画|is-animated/);
  });
  await test("Animated numeric fields propagate to the actual scrubbable input and explain current-time recording", async () => {
    const html = field(await inspect("text", ["fontSize"]), "fontSize");
    assert.match(html, /is-animated-field/);
    assert.match(html, /scrubbable-number-input is-animated/);
    assert.match(html, /data-animated="true"/);
    assert.match(html, /aria-description="此属性已加入动画；修改会在当前时间记帧"/);
    assert.match(html, /◆ 已加入动画/);
  });
  await test("Text, background and outline color animation reaches the swatch group and opacity input", async () => {
    const html = await inspect("text", ["fontColor", "bgColor", "outlineColor"]);
    for (const key of ["fontColor", "bgColor", "outlineColor"]) {
      const markup = field(html, key);
      assert.match(markup, /rgba-control is-animated/);
      assert.match(markup, /scrubbable-number-input is-animated rgba-alpha/);
      assert.match(markup, /rgba-animation-badge/);
      assert.match(markup, /此属性已加入动画；修改会在当前时间记帧/);
    }
    assert.doesNotMatch(field(html, "fontSize"), /is-animated|已加入动画/);
  });
  await test("Image colors and numeric tween properties support the same animated feedback", async () => {
    const html = await inspect("image", ["imageColor", "fillAmount"]);
    assert.match(field(html, "imageColor"), /rgba-control is-animated/);
    assert.match(field(html, "fillAmount"), /scrubbable-number-input is-animated/);
    assert.doesNotMatch(field(html, "softEdgeWidthX"), /is-animated|已加入动画/);
  });
  await test("Non-tween, runtime-read-only and unrelated fields never turn red due to a supplied name", async () => {
    const image = await inspect("image", ["imageId", "imageSource", "enableMask", "unknown"]);
    assert.doesNotMatch(image, /is-animated|已加入动画/);
    const text = await inspect("text", ["text", "minimumFontSize", "horizontalAlignment", "adaptiveFontSize"]);
    assert.doesNotMatch(text, /is-animated|已加入动画/);
  });
  await test("Underlying animated styling and explanatory attributes disappear when the prop is false", async () => {
    for (const animated of [true, false]) {
      const markup = await render(NumberInput, { modelValue: 30, animated });
      assert.equal(markup.includes('data-animated="true"'), animated);
      assert.equal(markup.includes("此属性已加入动画"), animated);
      const color = await render(Color, { label: "颜色", modelValue: { r: 20, g: 30, b: 40, a: 0.5 }, animated });
      assert.equal(color.includes('rgba-control is-animated'), animated);
      assert.equal(color.includes('rgba-animation-badge'), animated);
      assert.match(color, /value="141E28"/);
    }
  });
  await test("Red input and color-group rules are scoped to animated classes and retain visible focus", () => {
    for (const file of ["ScrubbableNumberInput.vue", "ColorRGBAField.vue"]) {
      const { descriptor } = parse(fs.readFileSync(path.join(editor, file), "utf8"));
      assert.ok(descriptor.styles.every((style) => style.scoped));
      assert.ok(descriptor.styles.some((style) => /\.is-animated[^{}]*\{[^}]*background:\s*#533843/.test(style.content)));
      assert.ok(descriptor.styles.some((style) => /\.is-animated[^{}]*(?:focus-visible|focus-within)[^{}]*\{[^}]*box-shadow/.test(style.content)));
    }
  });
  console.log(`${passed} animated property inspector checks passed.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (oldTs) Module._extensions[".ts"] = oldTs; else delete Module._extensions[".ts"];
  if (oldVue) Module._extensions[".vue"] = oldVue; else delete Module._extensions[".vue"];
});
