/* Run against the dev server: node scripts/test-client-ui-canvas-masks.cjs [playwright module] [browser executable] [native.gia]. Override CLIENT_UI_TEST_URL when needed. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require(process.argv[2] || 'playwright');
const dir = path.resolve(__dirname, '../src/views/ClientUIAnimationEditor');
const Module = require('node:module');
const oldTs = Module._extensions['.ts'];
Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
const { canvasImageMaskTransform, canvasImageMaskId, buildCanvasMaskLayers } = require(path.join(dir, 'canvasMasks.ts'));
if (oldTs) Module._extensions['.ts'] = oldTs; else delete Module._extensions['.ts'];

// The mask texture must follow exactly the same world-space corners as the image.
let poses = 0;
for (const matrix of [{ a: 1, b: 0, c: 0, d: 1 }, { a: -2, b: .6, c: .4, d: 1 }, { a: .5, b: -.8, c: 1.2, d: -.3 }]) {
  for (const [pivotX, pivotY] of [[0, 0], [.5, .5], [1, 1], [.3, .8]]) {
    const node = { width: 120, height: 70, pivotX, pivotY };
    const world = { x: 340, y: 210, matrix };
    const values = canvasImageMaskTransform(node, world, 900).slice(7, -1).split(',').map(Number);
    for (const [x, y] of [[0, 0], [120, 0], [0, 70], [120, 70]]) {
      const dx = x - 120 * pivotX, dy = 70 * (1 - pivotY) - y;
      const actual = [values[0] * x + values[2] * y + values[4], values[1] * x + values[3] * y + values[5]];
      const expected = [world.x + matrix.a * dx + matrix.c * dy, 900 - world.y - matrix.b * dx - matrix.d * dy];
      actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-8));
      poses++;
    }
  }
}
assert.notEqual(canvasImageMaskId('a:b'), canvasImageMaskId('a_b'));
const ordered = [{ id: 'root', parentId: null }, { id: 'mask', parentId: 'root' }, { id: 'child', parentId: 'mask' }, { id: 'sibling', parentId: 'root' }];
const layers = buildCanvasMaskLayers(ordered, new Set(['mask']));
const flatten = items => items.flatMap(item => [item.node.id, ...flatten(item.children)]);
assert.deepEqual(flatten(layers), ordered.map(n => n.id));
assert.ok(layers[0].children[0].maskId);
assert.equal(layers[0].children[1].maskId, null);
console.log(`PASS ${poses} mask corner poses, reflected/sheared transforms, unique mask IDs and sibling paint order`);

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 2200, height: 1300 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/Public/CustomUIImage/data.json?*', route => route.fulfill({ json: {
      imageData: Object.fromEntries([100001,100002,100003,100004,100005].map(id => [id, { id, img: `fixture-${id}.png`, border: '' }])),
      category: { '1': { id: 1, images: [100001,100002,100003,100004,100005] } },
    } }));
    await page.route('**/ClientUIAnimationEditor/i18n/*.json?*', route => route.fulfill({ json: {} }));
    await page.route('**/Public/CustomUIImage/fixture-*.png', route => {
      const id = Number(route.request().url().match(/fixture-(\d+)\.png/)[1]);
      const circleOpacity = id === 100004 ? .5 : id === 100005 ? 1 / 255 : 1;
      const shape = [100002,100004,100005].includes(id) ? `<circle cx="50" cy="50" r="50" opacity="${circleOpacity}" />` : id === 100003 ? '<path d="M50 0L100 100H0Z" />' : '<rect width="100" height="100" />';
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100" fill="white">${shape}</svg>` });
    });
    await page.goto(process.env.CLIENT_UI_TEST_URL || 'http://localhost:8080/ClientUIAnimationEditor');
    await page.waitForSelector('.animation-editor');
    await page.waitForFunction(() => document.querySelector('.animation-editor').__vueParentComponent.setupState.archive.ready.value);
    await page.waitForFunction(() => document.querySelector('.animation-editor').__vueParentComponent.setupState.getImageAsset(100005));
    await page.evaluate(async () => {
      const s = document.querySelector('.animation-editor').__vueParentComponent.setupState;
      // Fixed catalog fixtures keep pixel checks independent of remote images.
      for (const id of [100001,100002,100003,100004,100005]) s.getImageAsset(id).metadata = { width: 100, height: 100, left: 0, bottom: 0, right: 0, top: 0, pixelsPerUnit: 1 };
      await Promise.all([100004,100005].map(async id => { const texture = new Image(); texture.src = s.getImageAsset(id).src; await texture.decode(); }));
      await s.archive.createWorkspace('遮罩回归');
      const root = s.makeRootContainer(1600, 900, 'root');
      const circle = s.makeNode('image', 'circle', { id: 'circle', parentId: 'root', x: 800, y: 450, width: 100, height: 100, properties: { imageId: 100002, imageColor: { r: 255, g: 255, b: 255, a: 0 }, enableMask: true } });
      const triangle = s.makeNode('image', 'triangle', { id: 'triangle', parentId: 'circle', x: 50, y: 50, width: 100, height: 100, anchorOffsetX: 0, anchorOffsetY: 0, properties: { imageId: 100003, imageColor: { r: 255, g: 255, b: 255, a: 0 }, enableMask: false } });
      const fill = s.makeNode('image', 'fill', { id: 'fill', parentId: 'triangle', x: 50, y: 50, width: 200, height: 200, anchorOffsetX: 0, anchorOffsetY: 0, properties: { imageId: 100001, imageColor: { r: 255, g: 0, b: 0, a: 1 } } });
      const text = JSON.stringify({ version: 12, hierarchyLayoutVersion: 2, controlModelVersion: 2, name: 'mask-test', canvasWidth: 1600, canvasHeight: 900, nodes: [root, circle, triangle, fill] });
      await s.archive.createDocument('mask-test', text);
      s.workspacePanelOpen = false; s.selectedId = null;
    });
    await page.waitForTimeout(1200);
    const stage = page.locator('.canvas-stage');
    if (process.env.CLIENT_UI_MASK_SCREENSHOT) await stage.screenshot({ path: process.env.CLIENT_UI_MASK_SCREENSHOT });
    async function pixelsAt(points) {
      const png = await stage.screenshot();
      return page.evaluate(async ({ png, points }) => {
        const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        return points.map(([x, y]) => {
          return Array.from(ctx.getImageData(Math.round((800 + x) / 1600 * image.width), Math.round((450 - y) / 900 * image.height), 1, 1).data);
        });
      }, { png: png.toString('base64'), points });
    }
    async function redAt(points) {
      return (await pixelsAt(points)).map(rgba => rgba[0] > 240 && rgba[1] < 15 && rgba[2] < 15);
    }
    assert.deepEqual(await redAt([[0, 0], [45, 45], [35, 25]]), [true, false, true], 'transparent circular parent clips overflowing child pixels');
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'triangle').properties.enableMask = true; });
    assert.deepEqual(await redAt([[0, -10], [35, 25], [45, 45]]), [true, false, false], 'nested triangle and circle masks intersect');
    const maskBaseline = await page.evaluate(() => {
      const s = document.querySelector('.animation-editor').__vueParentComponent.setupState;
      return JSON.stringify(s.nodes.filter(n => n.id === 'circle' || n.id === 'triangle' || n.id === 'fill'));
    });
    await page.evaluate(() => {
      const s = document.querySelector('.animation-editor').__vueParentComponent.setupState;
      s.nodes.find(n => n.id === 'triangle').properties.enableMask = false;
      const properties = s.nodes.find(n => n.id === 'circle').properties;
      Object.assign(properties, { reverseMaskArea: true, enableSoftEdge: false, enableFill: false });
    });
    assert.deepEqual(await redAt([[0, 0], [45, 45], [75, 0]]), [false, true, false], 'inverting the final texture mask reveals transparent corners within the control rectangle and clips overflowing descendants');
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'circle').rotation = 45; });
    // [65, 0] is inside the rotated square and outside the circle; [65, 40] is only inside its axis-aligned bounds.
    assert.deepEqual(await redAt([[65, 0], [65, 40]]), [true, false], 'the inverted mask is bounded by its rotated rectangle, not an unrotated rectangle or axis-aligned bounding box');
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'circle').scaleX = -1; });
    assert.deepEqual(await redAt([[65, 0], [65, 40]]), [true, false], 'reflection preserves the rotated rectangle and inverted texture bounds');
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; const n = s.nodes.find(n => n.id === 'circle'); n.rotation = 0; n.scaleX = 1; });
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'triangle').properties.enableMask = true; });
    assert.deepEqual(await redAt([[0, -10], [40, -40], [45, 45], [75, 0]]), [false, true, false, false], 'an ordinary nested triangle intersects the inverted circle, including its transparent texture contour');
    await page.evaluate(() => {
      const s = document.querySelector('.animation-editor').__vueParentComponent.setupState;
      s.nodes.find(n => n.id === 'triangle').properties.enableMask = false;
      Object.assign(s.nodes.find(n => n.id === 'circle').properties, {
        enableFill: true, fillType: 'horizontal', fillHorizontalType: 'left', fillAmount: .5,
        enableSoftEdge: true, softEdgeMode: 'pixel', softEdgeWidthX: 20, softEdgeWidthY: 20,
      });
    });
    assert.deepEqual(await redAt([[-20, 0], [20, 0], [-45, 45], [75, 0]]), [false, true, true, false], 'texture alpha, horizontal fill and feathering are combined before inversion within the control rectangle');
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'fill').visible = false; });
    const [featherBackground] = await pixelsAt([[-40, 0]]);
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'fill').visible = true; });
    const [hidden, feathered, visible] = await pixelsAt([[-20, 0], [-40, 0], [20, 0]]);
    assert.deepEqual(feathered, featherBackground, `inverse feathering completely cuts out every nonzero feather alpha: ${JSON.stringify({featherBackground, feathered})}`);
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'circle').properties.reverseMaskArea = false; });
    const [normalVisible, normalFeathered, normalHidden] = await pixelsAt([[-20, 0], [-40, 0], [20, 0]]);
    assert.ok(normalFeathered[1] > normalVisible[1] + 40 && normalFeathered[1] < normalHidden[1] - 40, `ordinary masking preserves the feather alpha transition: ${JSON.stringify({normalVisible, normalFeathered, normalHidden})}`);
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'circle').properties.reverseMaskArea = true; });
    await page.evaluate(() => {
      const s = document.querySelector('.animation-editor').__vueParentComponent.setupState;
      const n = s.nodes.find(n => n.id === 'circle');
      n.properties.enableSoftEdge = false; n.anchorOffsetX += 130; n.rotation = 90; s.applyNodeLayout(n);
    });
    assert.deepEqual(await redAt([[0, 0], [130, -20], [130, 20], [175, 45], [205, 0]]), [false, false, true, true, false], 'the asymmetric inverted mask moves and rotates with its descendants while clipping beyond its rectangle');
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'circle').properties.reverseMaskArea = false; });
    assert.deepEqual(await redAt([[130, -20], [130, 20], [175, 45]]), [true, false, false], 'turning inversion off restores the ordinary rotated texture and fill mask');
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'circle').properties.enableMask = false; });
    assert.deepEqual(await redAt([[130, -20], [130, 20], [175, 45], [205, 0]]), [true, true, true, true], 'turning masking off restores the entire descendant including pixels beyond the control rectangle');
    await page.evaluate(baseline => {
      const s = document.querySelector('.animation-editor').__vueParentComponent.setupState;
      JSON.parse(baseline).forEach(node => Object.assign(s.nodes.find(n => n.id === node.id), node));
      const circle = s.nodes.find(n => n.id === 'circle');
      circle.sizeDeltaX = 240; circle.sizeDeltaY = 80; s.applyNodeLayout(circle);
      Object.assign(circle.properties, { reverseMaskArea: true, enableSoftEdge: false, enableFill: false });
      const triangle = s.nodes.find(n => n.id === 'triangle');
      triangle.properties.enableMask = false; s.applyNodeLayout(triangle);
      const fill = s.nodes.find(n => n.id === 'fill');
      fill.anchorOffsetX = 80; fill.anchorOffsetY = -30; s.applyNodeLayout(fill);
    }, maskBaseline);
    assert.deepEqual(await redAt([[110, -30], [130, -30], [80, -60], [80, -20]]), [true, false, false, false], 'a child shifted right and down is clipped to its long rectangular parent while the inverted ellipse reveals only corners within that rectangle');
    await page.evaluate(baseline => {
      const s = document.querySelector('.animation-editor').__vueParentComponent.setupState;
      JSON.parse(baseline).forEach(node => Object.assign(s.nodes.find(n => n.id === node.id), node));
      const circle = s.nodes.find(n => n.id === 'circle');
      Object.assign(circle.properties, { reverseMaskArea: true, enableSoftEdge: false, enableFill: false });
      s.nodes.find(n => n.id === 'triangle').properties.enableMask = false;
    }, maskBaseline);
    const [maskBackground] = await pixelsAt([[0, 0]]);
    function assertRedMix(pixel, opacity, message) {
      const expected = maskBackground.slice(0, 3).map((channel, i) => channel * (1 - opacity) + (i === 0 ? 255 : 0) * opacity);
      assert.ok(expected.every((channel, i) => Math.abs(pixel[i] - channel) <= 3), `${message}: ${JSON.stringify({ pixel, expected })}`);
    }
    await page.evaluate(() => {
      const s = document.querySelector('.animation-editor').__vueParentComponent.setupState;
      Object.assign(s.nodes.find(n => n.id === 'circle').properties, { imageId: 100004, reverseMaskArea: false });
    });
    assertRedMix((await pixelsAt([[0, 0]]))[0], .5, 'ordinary masking preserves a half-transparent texture alpha');
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'circle').properties.reverseMaskArea = true; });
    assert.deepEqual((await pixelsAt([[0, 0]]))[0], maskBackground, 'a half-transparent texture completely cuts out inverted descendant pixels');
    assert.deepEqual(await redAt([[45, 45], [75, 0]]), [true, false], 'transparent texture corners remain fully visible only within the inverted control rectangle');
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'circle').properties.imageId = 100005; });
    assert.deepEqual((await pixelsAt([[0, 0]]))[0], maskBackground, 'even texture alpha 1/255 cuts out descendants completely without residual color');
    await page.evaluate(() => {
      const s = document.querySelector('.animation-editor').__vueParentComponent.setupState;
      s.nodes.find(n => n.id === 'fill').visible = false;
      Object.assign(s.nodes.find(n => n.id === 'circle').properties, { imageId: 100004, imageColor: { r: 255, g: 0, b: 0, a: 1 } });
    });
    assert.deepEqual((await pixelsAt([[0, 0]]))[0], maskBackground, 'the half-transparent image itself is completely hidden inside its inverted contour');
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'circle').properties.imageId = 100002; });
    assertRedMix((await pixelsAt([[0, 0]]))[0], 0, 'an opaque circle also hides its own image inside the inverted contour');
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'circle').properties.enableMask = false; });
    assertRedMix((await pixelsAt([[0, 0]]))[0], 1, 'disabling the mask restores the original image itself');
    await page.evaluate(baseline => {
      const s = document.querySelector('.animation-editor').__vueParentComponent.setupState;
      JSON.parse(baseline).forEach(node => Object.assign(s.nodes.find(n => n.id === node.id), node));
    }, maskBaseline);
    assert.deepEqual(await redAt([[0, -10], [35, 25], [45, 45]]), [true, false, false], 'inversion cases restore the original nested masks for selection regressions');
    console.log('PASS actual inverted-mask pixels: binary texture/feather cutout, control rectangle bounds, nested intersection, fill composition, movement, rotated bounds, shifted child in a long parent, alpha 1/255, own image, ordinary alpha/feather preservation and disabling');
    async function checkSelection(id) {
      await page.evaluate(id => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.selectedId = id; s.canvasTool = 'combined'; }, id);
      assert.equal(await page.locator('.canvas-selection .selection-corner').count(), 4);
      assert.equal(await page.locator('.canvas-selection .selection-edge').count(), 4);
      assert.equal(await page.locator('.canvas-selection .selection-tag').count(), 1);
      const state = await page.evaluate(() => {
        const overlay = document.querySelector('.canvas-selection'), content = document.querySelector('.canvas-node.selected');
        const style = getComputedStyle(overlay), contentStyle = getComputedStyle(content);
        return { masked: Boolean(overlay.closest('.canvas-masked-subtree')), width: style.width, contentWidth: contentStyle.width,
          height: style.height, contentHeight: contentStyle.height, transform: style.transform, contentTransform: contentStyle.transform,
          pointerEvents: style.pointerEvents, outline: style.outlineColor };
      });
      assert.equal(state.masked, false, 'selection chrome must have no masked ancestor');
      assert.equal(state.width, state.contentWidth); assert.equal(state.height, state.contentHeight);
      assert.equal(state.transform, state.contentTransform, 'selection and content use the same preview transform');
      assert.equal(state.pointerEvents, 'none', 'the selection overlay must not block canvas hit testing');
      assert.equal(state.outline, 'rgb(92, 229, 238)');
      const corners = await page.locator('.canvas-selection .selection-corner').evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }));
      const bounds = await stage.boundingBox(), png = await stage.screenshot();
      const pixels = await page.evaluate(async ({ png, bounds, corners }) => {
        const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        return corners.map(point => Array.from(ctx.getImageData(Math.round((point.x - bounds.x) / bounds.width * image.width), Math.round((point.y - bounds.y) / bounds.height * image.height), 1, 1).data));
      }, { png: png.toString('base64'), bounds, corners });
      assert.ok(pixels.every(pixel => pixel[0] > 210 && pixel[1] > 210 && pixel[2] > 210), 'all four resize handles are painted outside the mask silhouette');
    }
    await checkSelection('circle');
    await checkSelection('fill');
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'circle').rotation = 30; });
    await checkSelection('fill');
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'circle').rotation = 0; });
    const beforeResize = await page.evaluate(() => JSON.stringify(document.querySelector('.animation-editor').__vueParentComponent.setupState.nodes.find(n => n.id === 'fill')));
    const handle = await page.locator('.canvas-selection .corner-br').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2 + 30, handle.y + handle.height / 2 + 20); await page.mouse.up();
    const afterResize = await page.evaluate(() => { const n = document.querySelector('.animation-editor').__vueParentComponent.setupState.nodes.find(n => n.id === 'fill'); return { width: n.width, height: n.height }; });
    assert.ok(afterResize.width > 200 && afterResize.height > 200, 'resize handle outside nested masks remains interactive');
    await page.evaluate(before => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; Object.assign(s.nodes.find(n => n.id === 'fill'), JSON.parse(before)); s.selectedId = null; }, beforeResize);
    assert.deepEqual(await redAt([[0, -10], [35, 25], [45, 45]]), [true, false, false], 'selection overlay and resizing do not disable content clipping');
    console.log('PASS full selection frame, label and four visible handles outside parent/nested masks, rotated alignment and actual resize dragging');
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'triangle').properties.enableMask = false; const n = s.nodes.find(n => n.id === 'circle'); n.anchorOffsetX += 130; s.applyNodeLayout(n); });
    assert.deepEqual(await redAt([[0, 0], [130, 0], [175, 45]]), [false, true, false], 'mask and descendants move together');
    await page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.nodes.find(n => n.id === 'circle').properties.enableMask = false; });
    assert.equal((await redAt([[175, 45]]))[0], true, 'disabling a mask reveals overflowing child pixels');
    console.log('PASS actual editor pixels: transparent masks, nested masks, moving the parent and disabling clipping');

    if (process.argv[4]) {
      const bytes = Array.from(fs.readFileSync(process.argv[4]));
      const expected = await page.evaluate(async bytes => {
        const s = document.querySelector('.animation-editor').__vueParentComponent.setupState;
        const data = JSON.parse(await s.createGiaProject(new File([Uint8Array.from(bytes)], 'native-mask.gia')));
        const expected = { count: data.nodes.filter(n => n.type === 'image' && n.properties.enableMask).length, nodes: data.nodes.length };
        // Simulate the already saved project from the previous importer.
        delete data.giaSource.imageMaskVersion;
        data.nodes.forEach(n => { if (n.type === 'image') n.properties.enableMask = false; });
        data.giaSource.baseline = JSON.parse(JSON.stringify(data.nodes));
        await s.archive.createDocument('legacy-mask-test', JSON.stringify(data));
        s.workspacePanelOpen = false; s.selectedId = null;
        return expected;
      }, bytes);
      assert.ok(expected.count > 0, 'the supplied single native UI/template fixture must contain a mask');
      async function maskState() { return page.evaluate(() => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; return { count: s.nodes.filter(n => n.type === 'image' && n.properties.enableMask).length, version: s.giaSource.imageMaskVersion }; }); }
      assert.deepEqual(await maskState(), { count: expected.count, version: 1 });
      await page.waitForTimeout(700);
      await page.reload(); await page.waitForSelector('.animation-editor');
      await page.waitForFunction(count => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; return s.nodes.length === count && s.archive.ready.value && !s.archive.busy.value; }, expected.nodes);
      assert.deepEqual(await maskState(), { count: expected.count, version: 1 });
      await page.evaluate(async () => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; s.workspacePanelOpen = false; s.selectedId = null; s.nodes.find(n => n.type === 'image' && n.properties.enableMask).properties.enableMask = false; await s.archive.save(); });
      await page.reload(); await page.waitForSelector('.animation-editor');
      await page.waitForFunction(count => { const s = document.querySelector('.animation-editor').__vueParentComponent.setupState; return s.nodes.length === count && s.archive.ready.value && !s.archive.busy.value; }, expected.nodes);
      assert.deepEqual(await maskState(), { count: expected.count - 1, version: 1 }, 'later user edits must not be reset by migration');
      console.log('PASS single native UI/template: legacy masks restored, archive reload and later edits preserved');
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
