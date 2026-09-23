const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { parse } = require('@vue/compiler-sfc');
const file = 'src/views/ClientUIAnimationEditor/ClientUIAnimationEditor.vue';
const { descriptor } = parse(fs.readFileSync(file, 'utf8'));
const ast = ts.createSourceFile(file, descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const factory = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'createPsdProject');
assert.ok(factory);
const code = ts.transpileModule(factory.getText(ast) + '\nglobalThis.create = createPsdProject;', {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
async function check(width, height) {
  const imported = { width, height, folders: 1, layers: 1, hidden: 0, warnings: [], resources: [{ id: 'image' }], nodes: [
    { id: 'root', parentId: null, x: width / 2, y: height / 2, width, height, anchorMinX: 0, anchorMinY: 0, anchorMaxX: 1, anchorMaxY: 1, anchorOffsetX: 0, anchorOffsetY: 0, sizeDeltaX: 0, sizeDeltaY: 0 },
    { id: 'group', parentId: 'root', x: width / 2 + 20, y: height / 2 - 10, width: 100, height: 80, anchorMinX: .5, anchorMinY: .5, anchorMaxX: .5, anchorMaxY: .5, anchorOffsetX: 20, anchorOffsetY: -10 },
    { id: 'leaf', parentId: 'group', x: 15, y: 25, width: 20, height: 30 },
  ] };
  const originalLeaf = { ...imported.nodes[2] };
  const context = {
    deviceMode: { value: 'mobile' }, previewPresetId: { value: 'mobile-custom' },
    canvasWidth: { value: 1600 }, canvasHeight: { value: 900 },
    psdImportProgress: { value: '' }, TIMELINE_MODEL_VERSION: 1,
    require: name => {
      assert.equal(name, './psdImporter');
      return { importPsdFile: async () => {
        // Settings are captured before the asynchronous decoder runs.
        context.canvasWidth.value = 800; context.canvasHeight.value = 600;
        context.deviceMode.value = 'pc'; context.previewPresetId.value = 'pc-default';
        return imported;
      } };
    },
  };
  vm.runInNewContext(code, context);
  const project = JSON.parse(await context.create({ name: 'layout.psd' }));
  assert.deepEqual([project.canvasWidth, project.canvasHeight, project.deviceMode, project.previewPresetId], [1600, 900, 'mobile', 'mobile-custom']);
  const [root, group, leaf] = project.nodes;
  assert.deepEqual([root.x, root.y, root.width, root.height], [800, 450, 1600, 900]);
  assert.deepEqual([group.x, group.y, group.width, group.height], [820, 440, 100, 80]);
  assert.equal(group.x, root.width / 2 + group.anchorOffsetX);
  assert.equal(group.y, root.height / 2 + group.anchorOffsetY);
  assert.deepEqual(leaf, originalLeaf);
  assert.deepEqual(project.primitiveResources, imported.resources);
}
(async () => {
  for (const [width, height] of [[100, 80], [3000, 2000], [1600, 900]]) await check(width, height);
  console.log('PASS PSD imports preserve canvas/device/preset snapshots, centered unscaled layers, nested layouts and resources');
})().catch(error => { console.error(error); process.exitCode = 1; });
