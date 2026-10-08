/* Isolated real Vue/SVG rendering: node scripts/benchmark-client-ui-primitive-drag.cjs [playwright path] [browser executable] */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { parse, compileScript } = require('@vue/compiler-sfc');
const { chromium } = require(process.argv[2] || 'playwright');
const directory = path.resolve(__dirname, '../src/views/ClientUIAnimationEditor');
const transpile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
function moduleSource(file) {
  return transpile(fs.readFileSync(path.join(directory, file), 'utf8'));
}
function component(file) {
  const { descriptor, errors } = parse(fs.readFileSync(path.join(directory, file), 'utf8'), { filename: file });
  assert.deepEqual(errors, []);
  return { code: transpile(compileScript(descriptor, { id: file, inlineTemplate: true }).content), css: descriptor.styles.map(style => style.content).join('\n') };
}
const primitive = component('PrimitiveImage.vue'), sprite = component('SpriteImage.vue');
const editor = parse(fs.readFileSync(path.join(directory, 'ClientUIAnimationEditor.vue'), 'utf8')).descriptor;
const ast = ts.createSourceFile('editor.ts', editor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const currentStyle = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'nodeStyle').getText(ast);

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<style>body{margin:0;background:white}#stage{position:relative;width:1100px;height:800px}.canvas-node{position:absolute;box-sizing:border-box;display:flex;border:1.5px solid transparent;align-items:center;justify-content:center}${primitive.css}${sprite.css}</style><div id="stage"></div>`);
    await page.addScriptTag({ path: require.resolve('vue/dist/vue.global.prod.js') });
    await page.evaluate(({ primitive, sprite, geometry, data, feather, currentStyle }) => {
      const modules = { vue: Vue };
      const load = (name, code) => { const module = { exports: {} }; new Function('require', 'module', 'exports', code)(name => modules[name], module, module.exports); modules[name] = module.exports; return module.exports; };
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.beginPath(); ctx.ellipse(32, 32, 30, 30, 0, 0, Math.PI * 2); ctx.fill();
      const asset = Vue.reactive({ id: 100002, src: canvas.toDataURL(), metadata: { width: 64, height: 64, left: 0, bottom: 0, right: 0, top: 0, pixelsPerUnit: 1 } });
      modules['./imageAssets'] = { imageAssetById: Vue.reactive(new Map([[100002, asset]])), loadImageCatalog: async () => {}, loadSpriteMetadata: async () => {} };
      modules['./primitiveControl'] = { primitiveImageSource: source => source };
      load('./primitiveData', data); load('./spriteGeometry', geometry); load('./imageFeatherPreview', feather);
      modules['./SpriteImage.vue'] = load('sprite', sprite);
      const PrimitiveImage = load('primitive', primitive).default;
      const previewNode = node => node, canvasHeight = { value: 800 };
      const previewWorldTransforms = { value: new Map() }, controlTemplateByIndex = { value: new Map() };
      const localMatrix = () => ({ a: 1, b: 0, c: 0, d: 1 });
      const editorTypeColors = { primitive: { r: 180, g: 140, b: 220, a: 1 } };
      const colorToCss = color => `rgba(${color.r},${color.g},${color.b},${color.a})`, safeColor = color => color, colorFromHex = () => ({});
      const style = new Function('previewNode', 'canvasHeight', 'previewWorldTransforms', 'controlTemplateByIndex', 'localMatrix', 'editorTypeColors', 'colorToCss', 'safeColor', 'colorFromHex', `${currentStyle}; return nodeStyle;`)(previewNode, canvasHeight, previewWorldTransforms, controlTemplateByIndex, localMatrix, editorTypeColors, colorToCss, safeColor, colorFromHex);
      let app, pose, mode;
      window.mountPrimitives = (count, nextMode) => {
        app?.unmount(); mode = nextMode;
        pose = Vue.reactive({ id: 'primitive', type: 'primitive', properties: {}, x: 400, y: 400, width: 512, height: 512, pivotX: .5, pivotY: .5 });
        const fitData = Vue.markRaw({ version: 1, width: 512, height: 512, elements: Array.from({ length: count }, (_, i) => ({
          type: 'ellipse', imageId: 100002, x: (i * 137 % 440) - 220, y: (i * 193 % 440) - 220,
          width: 20 + i % 90, height: 20 + i % 60, rotation: i % 180,
          color: { r: i * 19 % 256, g: i * 31 % 256, b: i * 47 % 256, a: .45 + (i % 50) / 100 },
        })) });
        app = Vue.createApp({ render() {
          previewWorldTransforms.value.set(pose.id, { x: pose.x, y: pose.y, matrix: localMatrix() });
          const current = style(pose);
          const positioning = mode === 'legacy' ? { ...current, left: `${pose.x - pose.width * pose.pivotX}px`, top: `${800 - pose.y - pose.height * (1 - pose.pivotY)}px`, transform: 'matrix(1, 0, 0, 1, 0, 0)', willChange: '' } : current;
          return Vue.h('div', { class: 'canvas-node type-primitive', style: positioning }, [Vue.h(PrimitiveImage, { imageUrl: '', previewMode: 'primitives', fitData, width: pose.width, height: pose.height })]);
        } });
        app.mount('#stage');
      };
      window.dragFrames = async count => {
        const times = [];
        for (let i = 0; i < count; i++) {
          const start = performance.now();
          pose.x = 400 + Math.sin(i / 10) * 120; pose.y = 400 + Math.cos(i / 10) * 80;
          await Vue.nextTick(); await new Promise(requestAnimationFrame);
          times.push(performance.now() - start);
        }
        return { mean: times.reduce((a, b) => a + b, 0) / times.length, p95: times.slice().sort((a, b) => a - b)[Math.floor(times.length * .95)] };
      };
    }, { primitive: primitive.code, sprite: sprite.code, geometry: moduleSource('spriteGeometry.ts'), data: moduleSource('primitiveData.ts'), feather: moduleSource('imageFeatherPreview.ts'), currentStyle: transpile(currentStyle) });
    const session = await context.newCDPSession(page);
    await session.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
    const results = [];
    for (const count of [400, 1000]) {
      let legacyBounds;
      for (const mode of ['legacy', 'current']) {
        await page.evaluate(({ count, mode }) => window.mountPrimitives(count, mode), { count, mode });
        await page.waitForTimeout(100);
        const bounds = await page.locator('.canvas-node').boundingBox();
        if (mode === 'legacy') legacyBounds = bounds;
        else assert.deepEqual(bounds, legacyBounds, 'composited positioning must preserve browser geometry');
        await page.evaluate(() => window.dragFrames(8));
        const trace = [];
        const collect = event => trace.push(...event.value);
        session.on('Tracing.dataCollected', collect);
        await session.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' });
        const before = await metrics();
        const frames = await page.evaluate(() => window.dragFrames(60));
        const after = await metrics();
        const complete = new Promise(resolve => session.once('Tracing.tracingComplete', resolve));
        await session.send('Tracing.end'); await complete;
        session.off('Tracing.dataCollected', collect);
        const duration = name => trace.filter(event => event.name === name && event.ph === 'X').reduce((sum, event) => sum + (event.dur || 0), 0) / 1000;
        const result = { count, mode, frameMeanMs: +frames.mean.toFixed(2), frameP95Ms: +frames.p95.toFixed(2),
          layoutMs: +((after.LayoutDuration - before.LayoutDuration) * 1000).toFixed(2), paintMs: +duration('Paint').toFixed(2),
          styleMs: +((after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000).toFixed(2),
          layoutCount: after.LayoutCount - before.LayoutCount, paintCount: trace.filter(event => event.name === 'Paint' && event.ph === 'X').length };
        results.push(result);
        console.log(JSON.stringify(result));
      }
    }
    for (const count of [400, 1000]) {
      const legacy = results.find(result => result.count === count && result.mode === 'legacy');
      const current = results.find(result => result.count === count && result.mode === 'current');
      assert.equal(current.layoutCount, 0, 'translation of a fixed-size primitive control must avoid layout');
      assert.ok(current.paintCount < legacy.paintCount, 'filtered sprites must not be repainted for every movement');
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
