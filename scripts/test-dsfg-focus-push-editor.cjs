/* Run with: node scripts/test-dsfg-focus-push-editor.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const Vue = require("vue");
const { renderToString } = require("vue/server-renderer");
const { parse, compileScript, compileStyle } = require("@vue/compiler-sfc");

async function main() {
  const filename = path.resolve(__dirname, "../src/views/DSFGStudio/components/DialogueEditor/components/clip-editors/FocusPushClipEditor.vue");
  const { descriptor, errors } = parse(fs.readFileSync(filename, "utf8"), { filename });
  assert.deepEqual(errors, []);
  const script = compileScript(descriptor, { id: "focus-push-editor", inlineTemplate: true, templateOptions: { ssr: true } });
  for (const style of descriptor.styles) {
    assert.deepEqual(compileStyle({ filename, id: "focus-push-editor", source: style.content, scoped: true }).errors, []);
  }
  const originalExtension = Module._extensions[".ts"];
  const compile = (source, filename) => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
  }).outputText;
  Module._extensions[".ts"] = (module, filename) => module._compile(compile(fs.readFileSync(filename, "utf8"), filename), filename);
  try {
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    loaded._compile(compile(script.content, filename), filename);
    const component = loaded.exports.default;
    const clip = { id: "focus", startTime: 2, outputMode: "Self", sharedOutletIndex: 0 };
    const node = { focusPush: clip, dialogue: { advanceMode: "PlayerInput" } };
    async function render() {
      const before = JSON.stringify(node);
      const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component, { node, clip }) }));
      assert.equal(JSON.stringify(node), before);
      return html;
    }
    let html = await render();
    assert.ok(/value="Self"[^>]* selected/.test(html));
    assert.ok(!html.includes('aria-label="Focus Push 共用出口"'));
    clip.outputMode = "Shared";
    html = await render();
    assert.ok(/value="Shared"[^>]* selected/.test(html));
    assert.ok(/value="0"[^>]* selected/.test(html));
    assert.ok(html.includes("0 · 玩家按下"));
    node.dialogue.advanceMode = "None";
    node.select = { options: [{ id: "a", content: "去蒙德" }, { id: "b", content: "去璃月" }] };
    clip.sharedOutletIndex = 1;
    html = await render();
    assert.ok(html.includes("0 · 选项 1：去蒙德"));
    assert.ok(html.includes("1 · 选项 2：去璃月"));
    assert.ok(/value="1"[^>]* selected/.test(html));
    node.select.options.pop();
    html = await render();
    assert.ok(html.includes("原出口序号已不可用"));
    node.select.options = [];
    html = await render();
    assert.ok(html.includes("暂无可共用的出口"));
    assert.ok(/<select[^>]*disabled[^>]*aria-label="Focus Push 共用出口"/.test(html));
    console.log("PASS Focus Push panel compiles and renders Self/Shared modes, labeled indices, selections and invalid/empty states");
  } finally {
    if (originalExtension) Module._extensions[".ts"] = originalExtension;
    else delete Module._extensions[".ts"];
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
