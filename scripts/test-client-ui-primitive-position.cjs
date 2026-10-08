/* Run: node scripts/test-client-ui-primitive-position.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { parse } = require('@vue/compiler-sfc');
const file = 'src/views/ClientUIAnimationEditor/ClientUIAnimationEditor.vue';
const { descriptor, errors } = parse(fs.readFileSync(file, 'utf8'));
assert.deepEqual(errors, []);
const ast = ts.createSourceFile(file, descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const source = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'nodeStyle').getText(ast);
const transforms = new Map(), canvasHeight = { value: 900 };
const context = vm.createContext({
  previewNode: node => node, previewWorldTransforms: { value: transforms }, canvasHeight,
  localMatrix: () => ({ a: 1, b: 0, c: 0, d: 1 }), controlTemplateByIndex: { value: new Map() },
  editorTypeColors: Object.fromEntries(['primitive', 'image', 'container'].map(type => [type, { r: 20, g: 40, b: 60, a: 1 }])),
  safeColor: value => value, colorToCss: color => `rgba(${color.r},${color.g},${color.b},${color.a})`,
});
vm.runInContext(ts.transpileModule(`${source}\nglobalThis.nodeStyle = nodeStyle;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, context);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const matrices = [
  { a: 1, b: 0, c: 0, d: 1 },
  { a: .6, b: .8, c: -.8, d: .6 },
  { a: -.6, b: -.8, c: -1.6, d: 1.2 },
  { a: .9, b: -.4, c: .25, d: .3 },
];
let cases = 0;
for (const type of ['primitive', 'image', 'container']) {
  for (const matrix of matrices) {
    for (const [pivotX, pivotY] of [[0, 0], [.5, .5], [1, 1], [.13, .87]]) {
      const node = { id: 'node', type, x: 300, y: 200, width: 450.5, height: 170.25, pivotX, pivotY, properties: {} };
      const world = { x: -45.75, y: 1110.125, matrix };
      transforms.set(node.id, world);
      const before = JSON.stringify(node);
      const style = context.nodeStyle(node);
      assert.equal(JSON.stringify(node), before);
      assert.equal(style.width, '450.5px'); assert.equal(style.height, '170.25px');
      assert.equal(style.transformOrigin, `${pivotX * 100}% ${(1 - pivotY) * 100}%`);
      let left = parseFloat(style.left), top = parseFloat(style.top);
      if (type === 'primitive') {
        assert.equal(left, 0); assert.equal(top, 0);
        assert.equal(style.willChange, 'transform');
        const translation = style.transform.match(/^translate\(([-.\d]+)px, ([-.\d]+)px\)/);
        assert.ok(translation);
        left += Number(translation[1]); top += Number(translation[2]);
      } else {
        assert.equal(style.willChange, undefined);
        assert.ok(style.transform.startsWith('matrix('));
      }
      const css = style.transform.match(/matrix\(([^)]+)\)/)[1].split(',').map(Number);
      const originX = node.width * pivotX, originY = node.height * (1 - pivotY);
      for (const [x, y] of [[0, 0], [node.width, 0], [0, node.height], [node.width, node.height], [originX, originY]]) {
        const dx = x - originX, dy = y - originY;
        const actualX = left + originX + css[0] * dx + css[2] * dy;
        const actualY = top + originY + css[1] * dx + css[3] * dy;
        near(actualX, world.x + matrix.a * dx - matrix.c * dy);
        near(actualY, canvasHeight.value - world.y - matrix.b * dx + matrix.d * dy);
      }
      cases++;
    }
  }
}
console.log(`PASS ${cases} canvas style cases: translation, rotation, negative scale, projected shear, pivots and unchanged saved models`);
