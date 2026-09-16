const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { normalizeImageCatalog, createImageCatalog, clientImageCatalog } = require('../src/views/ClientUIAnimationEditor/imageAssets.ts');
const optionCatalog = createImageCatalog('Public/CustomUIImage');
const optionAssets = optionCatalog.normalizeImageCatalog({ imageData: { 100160: { id: 100160, img: 'sprite/100160.png', border: '' } }, category: { 1: { id: 1, images: [100160] } } });
assert.match(optionAssets[0].src, /Public\/CustomUIImage\/sprite\/100160.png$/);
assert.notEqual(optionCatalog.imageAssetById, clientImageCatalog.imageAssetById);
assert.notEqual(optionCatalog.imageAssets, clientImageCatalog.imageAssets);
const { parseSpriteMetadata, isStretchable, spriteSlices } = require('../src/views/ClientUIAnimationEditor/spriteGeometry.ts');
const assets = normalizeImageCatalog({ imageData: { 104001: { id: 104001, img: 'sprite/104001.png', border: 'border/104001.json' }, 104004: { id: 104004, img: '', border: '' } }, category: { 5: { id: 5, images: [104001, 104004, 104005] } } });
assert.deepEqual(assets.map(asset => asset.id), [104001, 104004, 104005]);
assert.match(assets[0].src, /Public\/CustomUIImage\/sprite\/104001.png$/);
assert.equal(assets[1].src, '');
assert.equal(assets[2].src, '');
assert.deepEqual(assets[2].categories, ['5']);
const metadata = parseSpriteMetadata({ m_Rect: { width: 100, height: 80 }, m_Border: { X: 10, Y: 20, Z: 30, W: 5 }, m_PixelsToUnits: 1 });
assert.equal(isStretchable(metadata), true);
const slices = spriteSlices(metadata, 400, 200, true);
assert.equal(slices.length, 9);
assert.deepEqual(slices[0], { x: 0, y: 0, width: 10, height: 5, viewBox: '0 0 10 5' });
assert.deepEqual(slices[4], { x: 10, y: 5, width: 360, height: 175, viewBox: '10 5 60 55' });
assert.deepEqual(slices[8], { x: 370, y: 180, width: 30, height: 20, viewBox: '70 60 30 20' });
assert.equal(spriteSlices(metadata, 400, 200, false).length, 1);
const small = spriteSlices(metadata, 20, 10, true);
assert.equal(small.length, 4);
assert.equal(small.reduce((sum, slice) => sum + slice.width * slice.height, 0), 200);
const partial = parseSpriteMetadata({ m_Rect: { width: 8, height: 8 }, m_Border: { X: 0, Y: 2, Z: 0, W: 2 }, m_PixelsToUnits: 1 });
assert.equal(spriteSlices(partial, 150, 150, true).length, 3);
assert.equal(spriteSlices({ ...metadata, pixelsPerUnit: 2 }, 400, 200, true)[0].width, 5);
assert.equal(isStretchable(parseSpriteMetadata({ m_Rect: { width: 32, height: 32 }, m_Border: { X: 0, Y: 0, Z: 0, W: 0 } })), false);
assert.equal(parseSpriteMetadata({ m_Rect: { width: Infinity, height: 80 } }), undefined);
assert.equal(parseSpriteMetadata(null), undefined);
// OSS sprite 106004: opposite borders consume the full source dimensions.
// The game extends the seam samples into four continuous edges, not just corners.
const ring = parseSpriteMetadata({ m_Rect: { width: 36, height: 36 }, m_Border: { X: 18, Y: 18, Z: 18, W: 18 }, m_PixelsToUnits: 1 });
const ringSlices = spriteSlices(ring, 158, 150, true);
assert.equal(ringSlices.length, 9);
assert.deepEqual(ringSlices[1], { x: 18, y: 0, width: 122, height: 18, viewBox: '17.5 0 1 18' });
assert.deepEqual(ringSlices[3], { x: 0, y: 18, width: 18, height: 114, viewBox: '0 17.5 18 1' });
assert.deepEqual(ringSlices[4], { x: 18, y: 18, width: 122, height: 114, viewBox: '17.5 17.5 1 1' });
assert.equal(ringSlices.reduce((area, slice) => area + slice.width * slice.height, 0), 158 * 150);
assert.equal(spriteSlices(ring, 20, 20, true).length, 4);
assert.equal(spriteSlices(ring, 158, 150, false).length, 1);
const collapsedX = { ...ring, top: 5, bottom: 5 };
assert.equal(spriteSlices(collapsedX, 158, 150, true).length, 9);
console.log('PASS image IDs, missing entries, OSS paths, Unity border order, nine-slice corners, small sizes, partial borders and pixels per unit');
console.log('PASS sprite 106004 continuous edges with zero-width/height source center, small targets and basic mode');

async function testCatalogRefresh() {
  const originalFetch = global.fetch;
  const requests = [];
  let revision = 'first';
  let failCatalog = false;
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/data.json')) return {
      ok: !failCatalog, status: failCatalog ? 503 : 200,
      json: async () => ({ imageData: { 100160: { id: 100160, img: `${revision}.png`, border: 'border/100160.json' } }, category: {} }),
    };
    return { ok: true, json: async () => url.includes('/border/')
      ? { m_Rect: { width: 32, height: 32 }, m_Border: { X: 1, Y: 1, Z: 1, W: 1 } }
      : {} };
  };
  try {
    const first = clientImageCatalog.loadImageCatalog();
    assert.equal(clientImageCatalog.loadImageCatalog(true), first, 'Concurrent loads share the pending request');
    await first;
    assert.match(clientImageCatalog.imageAssetById.get(100160).src, /Public\/CustomUIImage\/first.png$/);
    revision = 'updated';
    await clientImageCatalog.loadImageCatalog();
    assert.equal(requests.filter(request => request.url.includes('/data.json')).length, 1);
    await clientImageCatalog.loadImageCatalog(true);
    const updated = clientImageCatalog.imageAssetById.get(100160);
    assert.match(updated.src, /Public\/CustomUIImage\/updated.png$/);
    assert.ok(await clientImageCatalog.loadSpriteMetadata(updated));
    assert.ok(requests.some(request => /Public\/CustomUIImage\/border\/100160.json\?/.test(request.url)));
    assert.ok(requests.filter(request => request.url.includes('/data.json')).every(request => request.options.cache === 'no-store' && /\?_t=\d+$/.test(request.url)));
    failCatalog = true;
    await clientImageCatalog.loadImageCatalog(true);
    assert.equal(clientImageCatalog.imageAssetById.get(100160), updated, 'A failed refresh preserves loaded assets');
    assert.ok(clientImageCatalog.imageCatalogError.value);
    failCatalog = false;
    await clientImageCatalog.loadImageCatalog();
    assert.equal(clientImageCatalog.imageCatalogError.value, '');
    console.log('PASS shared public catalog refresh, request deduplication, relative sprite/border paths and failed refresh recovery');
  } finally {
    global.fetch = originalFetch;
  }
}
testCatalogRefresh().catch(error => { console.error(error); process.exitCode = 1; });
